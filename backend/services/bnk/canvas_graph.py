"""
Topology Canvas graph — exact-identity BIG-IP Next relationships for the Canvas view.

Ported from Gateway Atlas (https://github.com/tareqaminul/gateway-atlas-guide) by its author, Apache-2.0:
the reference rules of internal/analyzer (analyzer.go refs, attachment.go, f5.go) and the CNE 2.4
relationship baseline (docs/networking). Rewritten for Forge's live BNK data.

Pure: ``build_canvas_graph`` consumes the dict returned by ``fetch_all_bnk_data`` and does no I/O.

- Identity is exact: ``group|version|kind|namespace|name``. References match on group, kind, namespace
  and name, so two Gateways with one name in different namespaces never share policies.
- Every edge is a declared reference (or a documented convention, marked ``inferred``) with the field it
  came from and a status: ``valid``, ``broken`` (the target is missing or the reference is rejected) or
  ``unresolved`` (Forge does not read the target kind, the target is outside the namespace filter, or
  the reference is soft and resolved later by the controller).
- Scope is BIG-IP Next-centred: F5 resources, Gateways of F5 classes, the routes attached to them, and
  whatever those reference. Secrets are never read: a Secret appears only as a reference (name and
  namespace).
"""

import re
from dataclasses import dataclass, field
from typing import Any

from core.k8s_resource_registry import get_resource_type

GATEWAY_GROUP = "gateway.networking.k8s.io"
F5_GATEWAY_GROUP = "gateway.k8s.f5.com"
F5_GATEWAY_LEGACY_GROUP = "gateway.k8s.f5net.com"
F5_NET_GROUP = "k8s.f5net.com"
F5_K8S_GROUP = "k8s.f5.com"
INFERENCE_GROUP = "inference.networking.k8s.io"
F5_INFERENCE_GROUP = "inference.k8s.f5.com"

# Resource types (``fetch_all_bnk_data`` keys) the Canvas draws or resolves references against.
CANVAS_RESOURCE_TYPES: list[str] = [
    "gatewayclass",
    "gateway",
    "httproute",
    "grpcroute",
    "tcproute",
    "udproute",
    "tlsroute",
    "l4route",
    "l4route_24",
    "referencegrant",
    "gatewaysettings",
    "egressgateway",
    "infra",
    "apppolicy",
    "secpolicy",
    "netpolicy",
    "bnksecpolicy",
    "bnknetpolicy",
    "aigatewayprofile",
    "f5bigfwpolicy",
    "f5bigcneirule",
    "f5bigcneaddresslist",
    "f5bigcneportlist",
    "f5bigpersistenceprofile",
    "f5bigloghslpub",
    "f5biglogprofile",
    "f5spkvlan",
    "cneinstance",
    "f5spkstaticroute",
    "f5spksnatpool",
    "f5spkegress",
    "inferencepool",
    "f5epp",
    "f5bnkgateway",
    "service",
]

# Canvas-only kinds Forge's resource registry does not know: (group, version, kind). The Canvas endpoint lists
# them itself (get/list only) so references to them can be checked.
CANVAS_LOCAL_TYPES: dict[str, tuple[str, str, str]] = {
    # BNK 2.4 Gateway infrastructure parameters (Gateway spec.infrastructure.parametersRef).
    "f5bnkgateway": (F5_NET_GROUP, "v1", "F5BnkGateway"),
}
CANVAS_LOCAL_PLURALS: dict[str, str] = {"f5bnkgateway": "f5-bnkgateways"}

# Which Gateways the Canvas draws: every controller side by side (BIG-IP Next next to Istio, NGINX and
# others), or only BIG-IP Next Gateways and what they touch.
CONTROLLER_SCOPES = ("all", "bnk")

GATEWAY_ROUTE_KINDS = {"HTTPRoute", "GRPCRoute", "TCPRoute", "TLSRoute", "UDPRoute"}
L4ROUTE_GROUPS = {F5_GATEWAY_GROUP, F5_GATEWAY_LEGACY_GROUP}
POLICY_KINDS = {
    (F5_GATEWAY_GROUP, "NetPolicy"),
    (F5_GATEWAY_GROUP, "SecPolicy"),
    (F5_GATEWAY_GROUP, "AppPolicy"),
    (F5_GATEWAY_LEGACY_GROUP, "BNKNetPolicy"),
    (F5_GATEWAY_LEGACY_GROUP, "BNKSecPolicy"),
}
CLUSTER_SCOPED_KINDS = {"GatewayClass", "ClusterIssuer"}

# Gateway API listener defaults (attachment.go): route kinds a protocol accepts when allowedRoutes.kinds is
# empty. Protocols outside this table are implementation-specific and are not checked.
PROTOCOL_ROUTE_KINDS = {
    "HTTP": {"HTTPRoute", "GRPCRoute"},
    "HTTPS": {"HTTPRoute", "GRPCRoute"},
    "TLS": {"TLSRoute", "TCPRoute"},
    "TCP": {"TCPRoute"},
    "UDP": {"UDPRoute"},
}
HOSTNAME_ROUTE_KINDS = {"HTTPRoute", "GRPCRoute", "TLSRoute"}
NAMESPACE_NAME_LABEL = "kubernetes.io/metadata.name"
_PARENT_INDEX = re.compile(r"^spec\.parentRefs\[(\d+)\]$")


@dataclass
class _Resource:
    group: str
    version: str
    kind: str
    namespace: str
    name: str
    obj: dict[str, Any]
    resource_type: str

    @property
    def id(self) -> str:
        return "|".join([self.group, self.version, self.kind, self.namespace, self.name])

    @property
    def spec(self) -> dict[str, Any]:
        return _map(self.obj.get("spec"))


@dataclass
class _Ref:
    group: str
    kind: str
    namespace: str
    name: str
    field: str
    type: str
    reason: str
    port: str = ""
    label: str = ""
    inferred: bool = False
    # Soft: a name the controller resolves later, so a missing target is not an error.
    soft: bool = False
    # Infra entries a GatewaySettings names that its Infra does not define.
    missing: list[str] = field(default_factory=list)
    # A resolved target, when the rule matched something other than metadata.name (spec.name, Infra entries).
    target: _Resource | None = None


@dataclass
class _Graph:
    resources: dict[str, _Resource]
    placeholders: dict[str, dict[str, Any]] = field(default_factory=dict)
    edges: list[dict[str, Any]] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Small accessors (K8s returns null, not missing keys; core objects come snake_cased)
# ---------------------------------------------------------------------------


def _map(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _maps(value: Any) -> list[dict[str, Any]]:
    return [item for item in _list(value) if isinstance(item, dict)]


def _str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _num(value: Any) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _get(obj: dict[str, Any], camel: str, snake: str) -> Any:
    value = obj.get(camel)
    return obj.get(snake) if value is None else value


# ---------------------------------------------------------------------------
# Normalization and scope
# ---------------------------------------------------------------------------


def _normalize(resources: dict[str, list[dict[str, Any]]]) -> tuple[dict[str, _Resource], set[tuple[str, str]]]:
    """Index the fetched resources by exact identity; also return the (group, kind) pairs Forge read."""
    by_id: dict[str, _Resource] = {}
    fetched: set[tuple[str, str]] = set()
    for key in CANVAS_RESOURCE_TYPES:
        try:
            registered = get_resource_type(key)
            type_group, type_version, type_kind = registered.api_group, registered.api_version, registered.kind
        except ValueError:
            if key not in CANVAS_LOCAL_TYPES:
                continue
            type_group, type_version, type_kind = CANVAS_LOCAL_TYPES[key]
        if key in resources:
            fetched.add((type_group, type_kind))
        for item in resources.get(key) or []:
            if not isinstance(item, dict):
                continue
            api_version = _str(_get(item, "apiVersion", "api_version"))
            group, _, version = api_version.rpartition("/")
            if not api_version:
                group, version = type_group, type_version
            meta = _map(item.get("metadata"))
            resource = _Resource(
                group=group,
                version=version,
                kind=_str(item.get("kind")) or type_kind,
                namespace=_str(meta.get("namespace")),
                name=_str(meta.get("name")),
                obj=item,
                resource_type=key,
            )
            if resource.name:
                by_id.setdefault(resource.id, resource)
    return by_id, fetched


def _is_f5_group(group: str) -> bool:
    return group.endswith(".f5.com") or group == "f5.com" or group.endswith(".f5net.com")


def _is_f5_class(gateway_class: _Resource) -> bool:
    controller = _str(gateway_class.spec.get("controllerName")).lower()
    return controller.startswith(("f5.com/", "f5.io/")) or ".f5.io/" in controller or ".f5.com/" in controller


# ---------------------------------------------------------------------------
# Reference rules (analyzer.go refs, f5.go, CNE 2.4 baseline)
# ---------------------------------------------------------------------------


def _refs(resource: _Resource, index: "_Index") -> list[_Ref]:
    spec = resource.spec
    ns = resource.namespace
    kind, group = resource.kind, resource.group
    out: list[_Ref] = []

    def add(
        ref_group: str,
        ref_kind: str,
        ref_ns: str,
        name: str,
        ref_field: str,
        rel: str,
        reason: str,
        **extra: Any,
    ) -> None:
        if ref_group == "core":
            ref_group = ""
        if not ref_ns and ref_kind not in CLUSTER_SCOPED_KINDS:
            ref_ns = ns
        if ref_kind in CLUSTER_SCOPED_KINDS:
            ref_ns = ""
        if name:
            out.append(_Ref(ref_group, ref_kind, ref_ns, name, ref_field, rel, reason, **extra))

    if group == GATEWAY_GROUP and kind == "GatewayClass":
        params = _map(spec.get("parametersRef"))
        add(
            _str(params.get("group")),
            _str(params.get("kind")),
            _str(params.get("namespace")),
            _str(params.get("name")),
            "spec.parametersRef",
            "configuration",
            "GatewayClass uses this implementation configuration.",
        )

    elif group == GATEWAY_GROUP and kind == "Gateway":
        add(
            GATEWAY_GROUP,
            "GatewayClass",
            "",
            _str(spec.get("gatewayClassName")),
            "spec.gatewayClassName",
            "class",
            "Gateway selects its controller class.",
        )
        params = _map(_map(spec.get("infrastructure")).get("parametersRef"))
        add(
            _str(params.get("group")),
            _str(params.get("kind")),
            _str(params.get("namespace")),
            _str(params.get("name")),
            "spec.infrastructure.parametersRef",
            "configuration",
            "Gateway uses this infrastructure configuration.",
        )
        for i, listener in enumerate(_maps(spec.get("listeners"))):
            for j, cert in enumerate(_maps(_map(listener.get("tls")).get("certificateRefs"))):
                add(
                    _str(cert.get("group")),
                    _str(cert.get("kind")) or "Secret",
                    _str(cert.get("namespace")),
                    _str(cert.get("name")),
                    f"spec.listeners[{i}].tls.certificateRefs[{j}]",
                    "tls",
                    "Listener terminates TLS with this certificate (metadata only).",
                    label=_str(listener.get("name")),
                )

    elif (group == GATEWAY_GROUP and kind in GATEWAY_ROUTE_KINDS) or (group in L4ROUTE_GROUPS and kind == "L4Route"):
        for i, parent in enumerate(_maps(spec.get("parentRefs"))):
            add(
                _str(parent.get("group")) or GATEWAY_GROUP,
                _str(parent.get("kind")) or "Gateway",
                _str(parent.get("namespace")),
                _str(parent.get("name")),
                f"spec.parentRefs[{i}]",
                "parent",
                "Route attaches through parentRefs.",
                label=_str(parent.get("sectionName")),
            )
        for i, rule in enumerate(_maps(spec.get("rules"))):
            backends = _maps(rule.get("backendRefs"))
            for j, backend in enumerate(backends):
                add(
                    _str(backend.get("group")),
                    _str(backend.get("kind")) or "Service",
                    _str(backend.get("namespace")),
                    _str(backend.get("name")),
                    f"spec.rules[{i}].backendRefs[{j}]",
                    "backend",
                    "Rule forwards to this backend.",
                    port=_num(backend.get("port")),
                    label=_backend_label(resource, rule, backends, j),
                )
            for j, flt in enumerate(_maps(rule.get("filters"))):
                ext = _map(flt.get("extensionRef"))
                add(
                    _str(ext.get("group")),
                    _str(ext.get("kind")),
                    "",
                    _str(ext.get("name")),
                    f"spec.rules[{i}].filters[{j}].extensionRef",
                    "filter",
                    "Route rule attaches an implementation filter.",
                )
                mirror = _map(_map(flt.get("requestMirror")).get("backendRef"))
                add(
                    _str(mirror.get("group")),
                    _str(mirror.get("kind")) or "Service",
                    _str(mirror.get("namespace")),
                    _str(mirror.get("name")),
                    f"spec.rules[{i}].filters[{j}].requestMirror.backendRef",
                    "mirror",
                    "Rule mirrors a copy of its requests to this backend; responses are discarded.",
                    port=_num(mirror.get("port")),
                    label="mirrored",
                )

    elif group == GATEWAY_GROUP and kind == "ReferenceGrant":
        pass  # Drawn by _add_grant_edges: a grant points at every object it authorizes.

    elif group == INFERENCE_GROUP and kind == "InferencePool":
        # analyzer.go (GA-121): the Endpoint Picker is an extension the Gateway calls for each request, not a
        # traffic backend; status.parents is controller status, shown as conditions, not a relationship.
        picker = _map(spec.get("endpointPickerRef"))
        port = _num(_map(picker.get("port")).get("number"))
        add(
            _str(picker.get("group")),
            _str(picker.get("kind")) or "Service",
            "",
            _str(picker.get("name")),
            "spec.endpointPickerRef",
            "endpoint-picker",
            "InferencePool asks this Endpoint Picker which model server takes each request.",
            port=port,
            label=port,
        )

    elif group == F5_INFERENCE_GROUP and kind == "F5EPP":
        # f5.go: F5's Endpoint Picker for BIG-IP Next runs the EPP for one InferencePool (spec.poolRef).
        pool = _map(spec.get("poolRef"))
        add(
            _str(pool.get("group")) or INFERENCE_GROUP,
            _str(pool.get("kind")) or "InferencePool",
            _str(pool.get("namespace")),
            _str(pool.get("name")),
            "spec.poolRef",
            "configuration",
            "F5EPP runs the Endpoint Picker for this InferencePool.",
        )

    elif (group, kind) in POLICY_KINDS:
        for i, target in enumerate(_maps(spec.get("targetRefs"))):
            add(
                _str(target.get("group")) or GATEWAY_GROUP,
                _str(target.get("kind")) or "Gateway",
                _str(target.get("namespace")),
                _str(target.get("name")),
                f"spec.targetRefs[{i}]",
                "policy",
                "BIG-IP Next policy attaches to this target.",
                label=_str(target.get("sectionName")),
            )
        for i, ext in enumerate(_maps(spec.get("extensionRefs"))):
            add(
                _str(ext.get("group")) or F5_NET_GROUP,
                _str(ext.get("kind")),
                "",
                _str(ext.get("name")),
                f"spec.extensionRefs[{i}]",
                "configuration",
                "BIG-IP Next policy uses this extension configuration.",
            )

    elif group == F5_GATEWAY_GROUP and kind == "EgressGateway":
        add(
            GATEWAY_GROUP,
            "GatewayClass",
            "",
            _str(spec.get("gatewayClassName")),
            "spec.gatewayClassName",
            "class",
            "EgressGateway selects its BIG-IP Next controller class.",
        )
        params = _map(_map(spec.get("infrastructure")).get("parametersRef"))
        add(
            _str(params.get("group")) or F5_GATEWAY_GROUP,
            _str(params.get("kind")) or "GatewaySettings",
            "",
            _str(params.get("name")),
            "spec.infrastructure.parametersRef",
            "configuration",
            "EgressGateway uses these BIG-IP Next gateway settings.",
            label=_str(params.get("sectionName")),
        )

    elif group == F5_GATEWAY_GROUP and kind == "GatewaySettings":
        out.extend(_infra_refs(resource, index))

    elif group == F5_K8S_GROUP and kind == "CNEInstance":
        add(
            "cert-manager.io",
            "ClusterIssuer",
            "",
            _str(_map(spec.get("certificate")).get("clusterIssuer")),
            "spec.certificate.clusterIssuer",
            "tls",
            "CNEInstance issues its certificates from this cert-manager ClusterIssuer.",
        )
        # A list in BIG-IP Next 2.4; a single object is also read.
        registry = _map(spec.get("registry"))
        pull = registry.get("imagePullSecrets")
        pull_secrets = [pull] if isinstance(pull, dict) else _maps(pull)
        for i, secret in enumerate(pull_secrets):
            add(
                "",
                "Secret",
                "",
                _str(secret.get("name")),
                f"spec.registry.imagePullSecrets[{i}]",
                "authentication",
                "CNEInstance pulls its images with this Secret (metadata only).",
            )

    elif group == F5_NET_GROUP and kind == "F5SPKEgress":
        snat = _str(spec.get("egressSnatpool"))
        if snat:
            out.append(
                _soft_ref(
                    resource,
                    index,
                    "F5SPKSnatpool",
                    snat,
                    "spec.egressSnatpool",
                    "configuration",
                    "F5SPKEgress translates egress traffic with this SNAT pool (F5SPKSnatpool spec.name).",
                )
            )
        vxlan = _map(_map(spec.get("pseudoCNIConfig")).get("vxlan"))
        vlan = _str(vxlan.get("tmmInterfaceName"))
        if vlan:
            out.append(
                _soft_ref(
                    resource,
                    index,
                    "F5SPKVlan",
                    vlan,
                    "spec.pseudoCNIConfig.vxlan.tmmInterfaceName",
                    "network",
                    "F5SPKEgress tunnels pod egress traffic to TMM over this VLAN.",
                )
            )
        for spec_field, ref_kind, rel, reason in (
            ("firewallEnforcedPolicy", "F5BigFwPolicy", "policy", "F5SPKEgress enforces this firewall policy."),
            ("logProfile", "F5BigLogProfile", "logging", "F5SPKEgress logs with this profile."),
        ):
            name = _str(spec.get(spec_field))
            if name:
                out.append(_soft_ref(resource, index, ref_kind, name, f"spec.{spec_field}", rel, reason))

    elif group == F5_NET_GROUP and kind == "F5BigFwPolicy":
        rules = _maps(spec.get("rule")) or _maps(spec.get("rules"))
        seen: set[tuple[str, str]] = set()
        for i, rule in enumerate(rules):
            for direction in ("source", "destination"):
                side = _map(rule.get(direction))
                for list_field, ref_kind in (
                    ("addressLists", "F5BigCneAddresslist"),
                    ("portLists", "F5BigCnePortlist"),
                ):
                    for name in _list(side.get(list_field)):
                        if isinstance(name, str) and name and (ref_kind, name) not in seen:
                            seen.add((ref_kind, name))
                            out.append(
                                _soft_ref(
                                    resource,
                                    index,
                                    ref_kind,
                                    name,
                                    f"spec.rule[{i}].{direction}.{list_field}",
                                    "configuration",
                                    "Firewall rule matches traffic against this list.",
                                )
                            )
    return out


def _soft_ref(
    resource: _Resource, index: "_Index", kind: str, name: str, ref_field: str, rel: str, reason: str
) -> _Ref:
    """A same-namespace k8s.f5net.com reference by name, matching spec.name first (F5SPK*), then metadata.name."""
    target = index.by_spec_name(F5_NET_GROUP, kind, resource.namespace, name)
    return _Ref(F5_NET_GROUP, kind, resource.namespace, name, ref_field, rel, reason, soft=True, target=target)


def _infra_refs(settings: _Resource, index: "_Index") -> list[_Ref]:
    """GatewaySettings names entries inside the Infra (IPAMs, networks, VRFs), not the Infra object."""
    spec = settings.spec
    wanted: dict[str, list[str]] = {"ipams": [], "networks": [], "vrfs": []}

    def collect(section: dict[str, Any]) -> None:
        wanted["ipams"] += [_str(r.get("name")) for r in _maps(section.get("ipamRefs"))]
        wanted["networks"] += [_str(r.get("name")) for r in _maps(section.get("networkRefs"))]
        for single, bucket in (("networkRef", "networks"), ("vrfRef", "vrfs")):
            name = _str(_map(section.get(single)).get("name"))
            if name:
                wanted[bucket].append(name)

    collect(_map(_map(spec.get("ingressConfig")).get("defaultListenerNetwork")))
    for pool in _maps(spec.get("sourceNATPools")):
        collect(pool)
    for config in _maps(spec.get("egressConfigs")):
        collect(config)
    names = sorted({name for bucket in wanted.values() for name in bucket if name})
    if not names:
        return []
    infras = index.of_kind(F5_GATEWAY_GROUP, "Infra")

    def defined(infra: _Resource) -> set[str]:
        return {_str(entry.get("name")) for section in wanted for entry in _maps(infra.spec.get(section))}

    # The Infra is a singleton; with several, link the one defining the most names (first by identity on a tie).
    best = max(infras, key=lambda infra: len(defined(infra) & set(names)), default=None)
    ref = _Ref(
        F5_GATEWAY_GROUP,
        "Infra",
        best.namespace if best else "",
        best.name if best else "",
        "spec (ipamRefs, networkRefs, vrfRefs)",
        "configuration",
        "GatewaySettings uses these entries of the cluster's Infra underlay.",
        label=", ".join(names),
        inferred=True,
        target=best,
    )
    ref.missing = [name for name in names if not best or name not in defined(best)]
    return [ref]


# ---------------------------------------------------------------------------
# Edge labels (edgePresentation.ts, simplified to what BNK routes carry)
# ---------------------------------------------------------------------------


def _clip(value: str, limit: int = 28) -> str:
    return value if len(value) <= limit else value[: limit - 1] + "…"


def _weight_share(backends: list[dict[str, Any]], index: int) -> str:
    if len(backends) < 2:
        return ""
    weights = []
    for backend in backends:
        weight = backend.get("weight")
        weights.append(weight if isinstance(weight, (int, float)) and not isinstance(weight, bool) else 1)
    total = sum(weights)
    return f"{round(weights[index] * 100 / total)}%" if total > 0 else ""


def _match_phrase(match: dict[str, Any], kind: str) -> str:
    parts: list[str] = []
    if kind == "GRPCRoute":
        method = _map(match.get("method"))
        service = _str(method.get("service")).split(".")[-1]
        name = _str(method.get("method"))
        if service or name:
            parts.append(f"{service or '*'}/{name or '*'}")
    else:
        method = _str(match.get("method"))
        path = _str(_map(match.get("path")).get("value"))
        if method:
            parts.append(method)
        if path and path != "/":
            parts.append(path)
    for header in _maps(match.get("headers")):
        op = "~" if _str(header.get("type")) == "RegularExpression" else "="
        parts.append(f"{_str(header.get('name'))}{op}{_str(header.get('value'))}")
    return " ".join(_clip(part) for part in parts)


def _backend_label(route: _Resource, rule: dict[str, Any], backends: list[dict[str, Any]], index: int) -> str:
    phrases = [_match_phrase(match, route.kind) for match in _maps(rule.get("matches"))]
    unique = list(dict.fromkeys(phrase for phrase in phrases if phrase))
    matches = ", ".join(unique) if len(unique) <= 2 else f"{', '.join(unique[:2])} +{len(unique) - 2}"
    port = _num(backends[index].get("port")) if route.kind == "L4Route" else ""
    return " · ".join(part for part in (matches, f":{port}" if port else "", _weight_share(backends, index)) if part)


# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------


class _Index:
    def __init__(self, resources: dict[str, _Resource]):
        self.resources = resources
        self._by_name: dict[tuple[str, str, str, str], _Resource] = {}
        for resource in sorted(resources.values(), key=lambda r: r.id):
            self._by_name.setdefault((resource.group, resource.kind, resource.namespace, resource.name), resource)

    def find(self, group: str, kind: str, namespace: str, name: str) -> _Resource | None:
        return self._by_name.get((group, kind, namespace, name))

    def of_kind(self, group: str, kind: str) -> list[_Resource]:
        return sorted((r for r in self.resources.values() if r.group == group and r.kind == kind), key=lambda r: r.id)

    def by_spec_name(self, group: str, kind: str, namespace: str, name: str) -> _Resource | None:
        candidates = [r for r in self.of_kind(group, kind) if r.namespace == namespace]
        return next((r for r in candidates if _str(r.spec.get("name")) == name), None) or next(
            (r for r in candidates if r.name == name), None
        )


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def _finding(
    severity: str,
    rule: str,
    resource: str,
    ref_field: str,
    explanation: str,
    evidence: str,
    remediation: str,
) -> dict[str, Any]:
    return {
        "severity": severity,
        "rule": rule,
        "resource": resource,
        "field": ref_field,
        "explanation": explanation,
        "evidence": evidence,
        "remediation": remediation,
    }


def _placeholder_id(ref: _Ref) -> str:
    return "|".join([ref.group, "", ref.kind, ref.namespace, ref.name])


def _scope(index: _Index, namespace: str | None, controllers: str = "all") -> list[_Resource]:
    """Seed resources: F5 objects, Gateways, and Gateway API routes attached to those Gateways.

    ``controllers="all"`` draws every Gateway whatever its controller, so BIG-IP Next runs side by side with
    Istio, NGINX and others; ``"bnk"`` keeps only Gateways of F5 classes, Gateways with F5 parameters and
    Gateways that F5 policies target.

    Under a namespace filter, a route whose parent Gateway is in another namespace stays in scope: that
    Gateway was not fetched, so the route is kept and its parent edge reported unresolved.
    """
    f5_classes = {r.name for r in index.of_kind(GATEWAY_GROUP, "GatewayClass") if _is_f5_class(r)}
    seeds = {r.id: r for r in index.resources.values() if _is_f5_group(r.group)}
    policy_targets = {
        (_str(t.get("namespace")) or p.namespace, _str(t.get("name")))
        for p in seeds.values()
        if (p.group, p.kind) in POLICY_KINDS
        for t in _maps(p.spec.get("targetRefs"))
        if (_str(t.get("kind")) or "Gateway") == "Gateway"
    }
    gateways = set()
    for gw in index.of_kind(GATEWAY_GROUP, "Gateway"):
        params = _map(_map(gw.spec.get("infrastructure")).get("parametersRef"))
        if (
            controllers == "all"
            or _str(gw.spec.get("gatewayClassName")) in f5_classes
            or _is_f5_group(_str(params.get("group")))
            or (gw.namespace, gw.name) in policy_targets
        ):
            seeds[gw.id] = gw
            gateways.add((gw.namespace, gw.name))
    for route in index.resources.values():
        if route.group == GATEWAY_GROUP and route.kind in GATEWAY_ROUTE_KINDS:
            for parent in _maps(route.spec.get("parentRefs")):
                parent_ns = _str(parent.get("namespace")) or route.namespace
                if (_str(parent.get("kind")) or "Gateway") != "Gateway":
                    continue
                if (parent_ns, _str(parent.get("name"))) in gateways or (namespace and parent_ns != namespace):
                    seeds[route.id] = route
    return sorted(seeds.values(), key=lambda r: r.id)


def build_canvas_graph(data: dict[str, Any], namespace: str | None = None, controllers: str = "all") -> dict[str, Any]:
    """Build the Canvas graph from ``fetch_all_bnk_data`` output.

    ``namespace`` is the namespace filter the data was fetched with: references into other namespaces
    cannot be checked and are reported ``unresolved`` instead of ``broken``. ``controllers`` is one of
    ``CONTROLLER_SCOPES`` (see ``_scope``).
    """
    if controllers not in CONTROLLER_SCOPES:
        raise ValueError(f"controllers must be one of {CONTROLLER_SCOPES}")
    resources, fetched = _normalize(_map(data.get("resources")))
    index = _Index(resources)
    graph = _Graph(resources={})
    queue = _scope(index, namespace, controllers)
    refs_by_source: dict[str, list[_Ref]] = {}
    while queue:
        resource = queue.pop(0)
        if resource.id in graph.resources:
            continue
        graph.resources[resource.id] = resource
        refs = _refs(resource, index)
        refs_by_source[resource.id] = refs
        for ref in refs:
            target = ref.target or index.find(ref.group, ref.kind, ref.namespace, ref.name)
            if target and target.id not in graph.resources:
                queue.append(target)

    for source_id in sorted(refs_by_source):
        for ref in refs_by_source[source_id]:
            _add_edge(graph, index, graph.resources[source_id], ref, fetched, namespace)
    _add_grant_edges(graph, index)
    rejected, attached = _validate_attachments(graph, index)
    _validate_route_parents(graph, rejected)
    _validate_listeners(graph, attached)

    warnings = []
    if data.get("partial"):
        warnings.append("Some BIG-IP Next resource types could not be read; references to them may show as missing.")
    if namespace:
        warnings.append(f"Filtered to namespace {namespace}: references into other namespaces are shown as unresolved.")
    graph.findings.sort(key=lambda f: (f["rule"], f["resource"], f["field"]))
    return {
        "resources": [_resource_out(r) for r in sorted(graph.resources.values(), key=lambda r: r.id)]
        + [graph.placeholders[key] for key in sorted(graph.placeholders)],
        "edges": graph.edges,
        "findings": graph.findings,
        "warnings": warnings,
    }


def _add_edge(
    graph: _Graph,
    index: _Index,
    source: _Resource,
    ref: _Ref,
    fetched: set[tuple[str, str]],
    namespace_filter: str | None,
) -> None:
    target = ref.target or index.find(ref.group, ref.kind, ref.namespace, ref.name)
    status = "valid"
    reason = ref.reason
    to = target.id if target else _placeholder_id(ref)
    evidence = f"{ref.namespace}/{ref.name}" if ref.namespace else ref.name
    if ref.kind == "Infra" and target and ref.missing:
        status = "broken"
        graph.findings.append(
            _finding(
                "error",
                "infra-entry-not-found",
                source.id,
                ref.field,
                "GatewaySettings names an IPAM, network or VRF entry that the Infra does not define.",
                ", ".join(ref.missing),
                "Add the entry to the Infra, or correct the reference.",
            )
        )
    elif ref.kind == "Infra" and not target:
        graph.findings.append(
            _finding(
                "warning",
                "infra-not-found",
                source.id,
                ref.field,
                "GatewaySettings names Infra entries, but no Infra was read from the cluster.",
                ref.label,
                "Create the Infra underlay, or check that Forge can read gateway.k8s.f5.com Infra.",
            )
        )
        return
    elif not target:
        if (ref.group, ref.kind) not in fetched:
            status = "unresolved"
            if ref.kind != "Secret":
                graph.findings.append(
                    _finding(
                        "info",
                        "reference-not-inspected",
                        source.id,
                        ref.field,
                        f"Forge does not read {ref.kind} resources in this view, so this reference is not checked.",
                        evidence,
                        "Verify the referenced resource in the cluster.",
                    )
                )
        elif namespace_filter and ref.namespace and ref.namespace != namespace_filter:
            status = "unresolved"
        elif ref.soft:
            status = "unresolved"
            graph.findings.append(
                _finding(
                    "info",
                    "soft-reference-absent",
                    source.id,
                    ref.field,
                    f"No {ref.kind} named {ref.name} was found; the controller resolves this name later.",
                    evidence,
                    f"Create the {ref.kind} if this configuration should take effect.",
                )
            )
        else:
            status = "broken"
            graph.findings.append(
                _finding(
                    "error",
                    "unresolved-reference",
                    source.id,
                    ref.field,
                    f"Referenced {ref.kind} was not found.",
                    evidence,
                    "Create the resource or correct the reference.",
                )
            )
    if target and ref.port and ref.kind == "Service" and not _service_has_port(target, ref.port):
        status = "broken"
        graph.findings.append(
            _finding(
                "error",
                "service-port-not-found",
                source.id,
                ref.field,
                "The referenced Service does not expose this port.",
                ref.port,
                "Use a declared Service port name or number.",
            )
        )
    if (
        target
        and target.namespace != source.namespace
        and (ref.type in ("backend", "mirror") or ref.kind == "Secret")
        and not _grant_allows(index, source, target)
    ):
        status = "broken"
        graph.findings.append(
            _finding(
                "error",
                "missing-reference-grant",
                source.id,
                ref.field,
                "Cross-namespace reference is not authorized by a ReferenceGrant.",
                evidence,
                "Add a ReferenceGrant in the target namespace.",
            )
        )
    if target and ref.type == "policy":
        status = _check_policy_section(graph, source, target, ref, status)
    if target and ref.kind == "GatewaySettings" and source.kind == "EgressGateway" and ref.label:
        configs = {_str(c.get("name")) for c in _maps(target.spec.get("egressConfigs"))}
        if ref.label not in configs:
            status = "broken"
            graph.findings.append(
                _finding(
                    "error",
                    "egress-config-not-found",
                    source.id,
                    ref.field,
                    "parametersRef.sectionName names no egressConfigs entry in the GatewaySettings.",
                    f"sectionName {ref.label}; entries: {', '.join(sorted(configs)) or 'none'}",
                    "Set sectionName to an existing egressConfigs[].name.",
                )
            )
    if not target and to not in graph.placeholders:
        graph.placeholders[to] = {
            "id": to,
            "group": ref.group,
            "version": "",
            "kind": ref.kind,
            "namespace": ref.namespace,
            "name": ref.name,
            "resourceType": None,
            "placeholder": True,
            "conditions": {},
            "facts": [],
        }
    graph.edges.append(
        {
            "id": f"{source.id}->{to}#{ref.field}",
            "source": source.id,
            "target": to,
            "type": ref.type,
            "field": ref.field,
            "reason": reason,
            "status": status,
            "inferred": ref.inferred,
            "label": ref.label,
        }
    )


def _check_policy_section(graph: _Graph, source: _Resource, target: _Resource, ref: _Ref, status: str) -> str:
    """A policy targetRef sectionName must name a listener of the target Gateway."""
    if not ref.label or target.kind != "Gateway":
        return status
    listeners = [_str(listener.get("name")) for listener in _maps(target.spec.get("listeners"))]
    if ref.label in listeners:
        return status
    graph.findings.append(
        _finding(
            "error",
            "policy-section-not-found",
            source.id,
            ref.field,
            f"targetRef sectionName names no listener on Gateway {target.namespace}/{target.name}.",
            f"sectionName {ref.label}; listeners: {', '.join(listeners) or 'none'}",
            "Set sectionName to an existing listener, or remove it to attach to the whole Gateway.",
        )
    )
    return "broken"


def _service_has_port(service: _Resource, port: str) -> bool:
    return any(_str(p.get("name")) == port or _num(p.get("port")) == port for p in _maps(service.spec.get("ports")))


def _grant_allows(index: _Index, source: _Resource, target: _Resource) -> bool:
    for grant in index.of_kind(GATEWAY_GROUP, "ReferenceGrant"):
        if grant.namespace != target.namespace:
            continue
        for origin in _maps(grant.spec.get("from")):
            if (
                _str(origin.get("namespace")) == source.namespace
                and _str(origin.get("group")) == source.group
                and _str(origin.get("kind")) == source.kind
            ):
                for to in _maps(grant.spec.get("to")):
                    to_group = "" if _str(to.get("group")) == "core" else _str(to.get("group"))
                    if (
                        to_group == target.group
                        and _str(to.get("kind")) == target.kind
                        and (not _str(to.get("name")) or _str(to.get("name")) == target.name)
                    ):
                        return True
    return False


def _add_grant_edges(graph: _Graph, index: _Index) -> None:
    """A ReferenceGrant points at each drawn object it authorizes (analyzer.go addReferenceGrantEdges)."""
    for grant in index.of_kind(GATEWAY_GROUP, "ReferenceGrant"):
        edges = []
        for i, to in enumerate(_maps(grant.spec.get("to"))):
            group = "" if _str(to.get("group")) == "core" else _str(to.get("group"))
            name = _str(to.get("name"))
            for target in sorted(graph.resources.values(), key=lambda r: r.id):
                if (
                    target.group == group
                    and target.kind == _str(to.get("kind"))
                    and target.namespace == grant.namespace
                    and (not name or target.name == name)
                ):
                    edges.append(
                        {
                            "id": f"{grant.id}->{target.id}#spec.to[{i}]",
                            "source": grant.id,
                            "target": target.id,
                            "type": "grant",
                            "field": f"spec.to[{i}]",
                            "reason": "ReferenceGrant permits references toward this object from the declared "
                            "source group, kind, and namespace.",
                            "status": "valid",
                            "inferred": True,
                            "label": "",
                        }
                    )
        if edges:
            graph.resources[grant.id] = grant
            graph.edges.extend(edges)


# ---------------------------------------------------------------------------
# Route attachment (attachment.go)
# ---------------------------------------------------------------------------


def _validate_attachments(graph: _Graph, index: _Index) -> tuple[set[str], dict[str, set[str]]]:
    """Check each valid parent edge against the Gateway's listeners.

    Returns the routes rejected by every listener, and the listener names each Gateway accepts routes on.
    """
    rejected: set[str] = set()
    attached: dict[str, set[str]] = {}
    for edge in graph.edges:
        if edge["type"] != "parent" or edge["status"] != "valid":
            continue
        route, gateway = graph.resources.get(edge["source"]), graph.resources.get(edge["target"])
        if not route or not gateway or gateway.group != GATEWAY_GROUP or gateway.kind != "Gateway":
            continue
        match = _PARENT_INDEX.match(edge["field"])
        parents = _maps(route.spec.get("parentRefs"))
        if not match or int(match.group(1)) >= len(parents):
            continue
        accepted, failures, unknown_ns = _attach(route, gateway, parents[int(match.group(1))])
        if accepted:
            attached.setdefault(gateway.id, set()).update(accepted)
            if not edge["label"]:
                edge["label"] = ", ".join(sorted(accepted))
            continue
        if unknown_ns and not failures:
            graph.findings.append(
                _finding(
                    "info",
                    "listener-namespace-unverified",
                    route.id,
                    edge["field"],
                    f"The listener admits routes by namespace label, and Forge does not read Namespace "
                    f"{route.namespace}, so the attachment cannot be confirmed.",
                    f"{gateway.namespace}/{gateway.name}",
                    "Check the namespace labels against the listener selector.",
                )
            )
            continue
        edge["status"] = "broken"
        rejected.add(route.id)
        for rule, detail in failures:
            graph.findings.append(
                _finding(
                    "error",
                    rule,
                    route.id,
                    edge["field"],
                    _failure_explanation(rule, route, gateway),
                    detail,
                    _failure_remediation(rule, route),
                )
            )
    return rejected, attached


def _attach(route: _Resource, gateway: _Resource, ref: dict[str, Any]) -> tuple[set[str], list[tuple[str, str]], bool]:
    section = _str(ref.get("sectionName"))
    port = _num(ref.get("port"))
    listeners = _maps(gateway.spec.get("listeners"))
    names = [_str(listener.get("name")) for listener in listeners]
    candidates = [
        listener
        for listener in listeners
        if (not section or _str(listener.get("name")) == section) and (not port or _num(listener.get("port")) == port)
    ]
    if not candidates:
        wanted = ", ".join(
            part for part in (f"sectionName {section}" if section else "", f"port {port}" if port else "") if part
        )
        detail = f"{wanted}; listeners: {', '.join(names)}" if names else f"{wanted}; the Gateway has no listeners"
        return set(), [("parent-listener-not-found", detail)], False
    accepted: set[str] = set()
    failures: dict[str, list[str]] = {}
    unknown_ns = False
    for listener in candidates:
        rule, detail, unknown = _check_listener(route, gateway, listener)
        if not rule:
            accepted.add(_str(listener.get("name")))
        elif unknown:
            unknown_ns = True
        else:
            failures.setdefault(rule, []).append(detail)
    if accepted:
        return accepted, [], False
    return set(), [(rule, " | ".join(details)) for rule, details in failures.items()], unknown_ns


def _check_listener(route: _Resource, gateway: _Resource, listener: dict[str, Any]) -> tuple[str, str, bool]:
    name = _str(listener.get("name"))
    allowed = _map(listener.get("allowedRoutes"))
    kinds = _maps(allowed.get("kinds"))
    if kinds:
        listed = [_str(k.get("kind")) for k in kinds]
        if not any(
            _str(k.get("kind")) == route.kind
            and (_str(k.get("group")) if "group" in k else GATEWAY_GROUP) == route.group
            for k in kinds
        ):
            return "listener-kind-not-allowed", f"listener {name} accepts {', '.join(listed)}", False
    elif route.group == GATEWAY_GROUP:
        # Protocol defaults apply to Gateway API routes only: L4Route acceptance is implementation-specific.
        defaults = PROTOCOL_ROUTE_KINDS.get(_str(listener.get("protocol")).upper())
        if defaults is not None and route.kind not in defaults:
            protocol = _str(listener.get("protocol"))
            return (
                "listener-kind-not-allowed",
                f"listener {name} ({protocol}) accepts {', '.join(sorted(defaults))}",
                False,
            )
    rule, detail, unknown = _check_namespace(route, gateway, name, _map(allowed.get("namespaces")))
    if rule:
        return rule, detail, unknown
    if route.kind in HOSTNAME_ROUTE_KINDS:
        listener_host = _str(listener.get("hostname"))
        route_hosts = [_str(h) for h in _list(route.spec.get("hostnames"))]
        if listener_host and route_hosts and not any(_hostnames_intersect(listener_host, h) for h in route_hosts):
            return (
                "listener-hostname-mismatch",
                f"listener {name}: {listener_host}; route: {', '.join(route_hosts)}",
                False,
            )
    return "", "", False


def _check_namespace(
    route: _Resource, gateway: _Resource, listener: str, rule: dict[str, Any]
) -> tuple[str, str, bool]:
    origin = _str(rule.get("from")) or "Same"
    if origin == "All":
        return "", "", False
    if origin == "Same":
        if route.namespace == gateway.namespace:
            return "", "", False
        return (
            "listener-namespace-not-allowed",
            f"listener {listener} admits only namespace {gateway.namespace} (from: Same)",
            False,
        )
    if origin == "Selector":
        # Forge does not read Namespaces: only the name label set on every Namespace can be checked.
        selector = _map(rule.get("selector"))
        labels = {NAMESPACE_NAME_LABEL: route.namespace}
        match_labels = {k: v for k, v in _map(selector.get("matchLabels")).items() if isinstance(v, str)}
        expressions = _maps(selector.get("matchExpressions"))
        only_name = (
            (match_labels or expressions)
            and all(k == NAMESPACE_NAME_LABEL for k in match_labels)
            and all(_str(e.get("key")) == NAMESPACE_NAME_LABEL for e in expressions)
        )
        if not only_name:
            return "listener-namespace-not-allowed", "", True
        if _selector_matches(match_labels, expressions, labels):
            return "", "", False
        return (
            "listener-namespace-not-allowed",
            f"listener {listener} selects namespaces by name; {route.namespace} is not selected",
            False,
        )
    return "", "", False


def _selector_matches(match_labels: dict[str, str], expressions: list[dict[str, Any]], labels: dict[str, str]) -> bool:
    if any(labels.get(k) != v for k, v in match_labels.items()):
        return False
    for expression in expressions:
        key = _str(expression.get("key"))
        values = [_str(v) for v in _list(expression.get("values"))]
        present = key in labels
        operator = _str(expression.get("operator"))
        if operator == "In" and not (present and labels[key] in values):
            return False
        if operator == "NotIn" and present and labels[key] in values:
            return False
        if operator == "Exists" and not present:
            return False
        if operator == "DoesNotExist" and present:
            return False
        if operator not in ("In", "NotIn", "Exists", "DoesNotExist"):
            return False
    return True


def _hostnames_intersect(listener: str, route: str) -> bool:
    """Gateway API listener rules: a leading "*." matches one or more labels."""
    a, b = listener.lower(), route.lower()
    if a == b:
        return True
    if a.startswith("*.") and b.endswith(a[1:]) and len(b) > len(a) - 1:
        return True
    return b.startswith("*.") and a.endswith(b[1:]) and len(a) > len(b) - 1


def _failure_explanation(rule: str, route: _Resource, gateway: _Resource) -> str:
    gw = f"{gateway.namespace}/{gateway.name}"
    return {
        "parent-listener-not-found": f"The parentRef selects no listener on Gateway {gw}, so the route is not attached.",
        "listener-kind-not-allowed": f"No selected listener on Gateway {gw} accepts {route.kind}, so the route is not "
        "attached.",
        "listener-namespace-not-allowed": f"No selected listener on Gateway {gw} admits routes from namespace "
        f"{route.namespace}, so the route is not attached.",
        "listener-hostname-mismatch": "The route's hostnames do not intersect the hostname of any selected listener "
        f"on Gateway {gw}, so the route is not attached.",
    }.get(rule, f"The route is not attached to Gateway {gw}.")


def _failure_remediation(rule: str, route: _Resource) -> str:
    return {
        "parent-listener-not-found": "Set sectionName (and port) to an existing listener, or remove them to attach to "
        "every compatible listener.",
        "listener-kind-not-allowed": f"Attach to a listener whose protocol or allowedRoutes.kinds accepts {route.kind}.",
        "listener-namespace-not-allowed": "Change the listener's allowedRoutes.namespaces, or label namespace "
        f"{route.namespace} to match its selector.",
        "listener-hostname-mismatch": "Use a route hostname inside the listener hostname, or attach to a listener that "
        "serves it.",
    }.get(rule, "Check the route's parentRefs.")


def _validate_route_parents(graph: _Graph, rejected: set[str]) -> None:
    """Routes with no working parent; routes a listener rejected already carry that finding."""
    for route in graph.resources.values():
        is_route = (route.group == GATEWAY_GROUP and route.kind in GATEWAY_ROUTE_KINDS) or (
            route.group in L4ROUTE_GROUPS and route.kind == "L4Route"
        )
        if not is_route or route.id in rejected:
            continue
        if not any(
            e["source"] == route.id and e["type"] == "parent" and e["status"] in ("valid", "unresolved")
            for e in graph.edges
        ):
            graph.findings.append(
                _finding(
                    "error",
                    "route-no-valid-parent",
                    route.id,
                    "spec.parentRefs",
                    "Route has no resolvable parent.",
                    "No valid Gateway edge",
                    "Add or correct parentRefs.",
                )
            )


def _validate_listeners(graph: _Graph, attached: dict[str, set[str]]) -> None:
    """A listener of a drawn Gateway that no route attaches to."""
    for gateway in graph.resources.values():
        if gateway.group != GATEWAY_GROUP or gateway.kind != "Gateway":
            continue
        for i, listener in enumerate(_maps(gateway.spec.get("listeners"))):
            name = _str(listener.get("name"))
            if name and name not in attached.get(gateway.id, set()):
                graph.findings.append(
                    _finding(
                        "info",
                        "listener-no-routes",
                        gateway.id,
                        f"spec.listeners[{i}]",
                        f"No route attaches to listener {name}.",
                        f"{name} {_str(listener.get('protocol'))}:{_num(listener.get('port'))}",
                        "Attach a route, or remove the listener if it is unused.",
                    )
                )


# ---------------------------------------------------------------------------
# Card output: conditions and facts (cardFacts.ts plus BIG-IP Next data-plane facts)
# ---------------------------------------------------------------------------


def _conditions(resource: _Resource) -> dict[str, str]:
    out: dict[str, str] = {}
    status = _map(resource.obj.get("status"))
    if resource.group == INFERENCE_GROUP and resource.kind == "InferencePool":
        # Pools report per parent Gateway; a condition is True only when every parent reports it True.
        for parent in _maps(status.get("parents")):
            for condition in _maps(parent.get("conditions")):
                kind = _str(condition.get("type"))
                value = _str(condition.get("status")) or "Unknown"
                if kind and out.get(kind, "True") == "True":
                    out[kind] = value
        return out
    for condition in _maps(status.get("conditions")):
        kind = _str(condition.get("type"))
        if kind:
            out[kind] = _str(condition.get("status")) or "Unknown"
    return out


def _facts(resource: _Resource) -> list[dict[str, str]]:
    spec, status = resource.spec, _map(resource.obj.get("status"))
    facts: list[tuple[str, str]] = []

    def add(label: str, values: list[str] | str) -> None:
        items = [values] if isinstance(values, str) else values
        text = ", ".join(v for v in items if v)
        if text:
            facts.append((label, text))

    kind, group = resource.kind, resource.group
    if kind == "GatewayClass":
        add("controller", _str(spec.get("controllerName")))
    elif kind == "Gateway" and group == GATEWAY_GROUP:
        addresses = _maps(status.get("addresses")) or _maps(spec.get("addresses"))
        add("address", [_str(a.get("value")) for a in addresses])
        for listener in _maps(spec.get("listeners")):
            host = _str(listener.get("hostname"))
            add(
                "listener",
                f"{_str(listener.get('name'))} {_str(listener.get('protocol'))}:{_num(listener.get('port'))}"
                + (f" {host}" if host else ""),
            )
    elif kind in GATEWAY_ROUTE_KINDS:
        hosts = [_str(h) for h in _list(spec.get("hostnames")) if _str(h)]
        add("hosts", f"{hosts[0]} +{len(hosts) - 1}" if len(hosts) > 1 else hosts)
    elif kind == "L4Route":
        add("protocol", _str(spec.get("protocol")))
    elif kind == "Service":
        add("type", _str(spec.get("type")))
        for port in _maps(spec.get("ports")):
            target = _num(_get(port, "targetPort", "target_port"))
            add(
                "port",
                f"{_str(port.get('name')) + ' ' if _str(port.get('name')) else ''}{_num(port.get('port'))}"
                + (f"→{target}" if target and target != _num(port.get("port")) else ""),
            )
    elif kind == "GatewaySettings":
        listener = _map(_map(spec.get("ingressConfig")).get("defaultListenerNetwork"))
        add("listener IPAM", [_str(r.get("name")) for r in _maps(listener.get("ipamRefs"))])
        add("listener networks", [_str(r.get("name")) for r in _maps(listener.get("networkRefs"))])
        add("SNAT pools", [_str(p.get("name")) for p in _maps(spec.get("sourceNATPools"))])
        add("egress configs", [_str(c.get("name")) for c in _maps(spec.get("egressConfigs"))])
    elif kind == "Infra":
        for network in _maps(spec.get("networks")):
            vlan = _map(network.get("vlan"))
            tag = _num(vlan.get("tag"))
            add("network", f"{_str(network.get('name'))} {_str(network.get('type'))}" + (f" tag {tag}" if tag else ""))
        add("IPAM", [_str(i.get("name")) for i in _maps(spec.get("ipams"))])
        for attachment in _maps(spec.get("networkAttachments")):
            nads = [_str(n.get("name")) for n in _maps(attachment.get("networkAttachmentDefinitions"))]
            add(
                "attachment",
                f"{_str(attachment.get('name'))} → {', '.join(nads)}" if nads else _str(attachment.get("name")),
            )
        for route in _maps(spec.get("staticRoutes")):
            add(
                "route",
                f"{', '.join(_str(d) for d in _list(route.get('destinations')))} via {_str(route.get('nextHop'))}",
            )
    elif kind == "EgressGateway":
        selector = _map(spec.get("sourceSelector"))
        add("selection", _str(selector.get("selectionMode")))
        add("namespaces", [_str(n) for n in _list(_map(selector.get("namespaces")).get("matchNames"))])
    elif kind == "InferencePool" and group == INFERENCE_GROUP:
        labels = _map(_map(spec.get("selector")).get("matchLabels")) or _map(spec.get("selector"))
        add("selector", [f"{k}={_str(v)}" for k, v in sorted(labels.items()) if isinstance(v, str)])
        add("target ports", [_num(_map(p).get("number")) for p in _maps(spec.get("targetPorts"))])
        add("protocol", _str(spec.get("appProtocol")))
        add("failure mode", _str(_map(spec.get("endpointPickerRef")).get("failureMode")))
    elif kind == "F5EPP" and group == F5_INFERENCE_GROUP:
        add("engine", _str(spec.get("engine")))
        add("mode", _str(spec.get("mode")))
        add("replicas", _num(spec.get("replicas")))
    elif kind == "CNEInstance":
        add("version", _str(spec.get("manifestVersion")))
        add("size", _str(spec.get("deploymentSize")))
        add("attachments", [_str(n) for n in _list(spec.get("networkAttachments"))])
    elif kind == "F5SPKVlan":
        add("VLAN", f"{_str(spec.get('name')) or resource.name} tag {_num(spec.get('tag')) or '0'}")
        add("self IPs", [_str(ip) for ip in _list(_get(spec, "selfip_v4s", "selfipV4s"))])
        add("MTU", _num(spec.get("mtu")))
        add("interfaces", [_str(i) for i in _list(spec.get("interfaces"))])
        add("side", "internal" if spec.get("internal") else "external")
    elif kind == "F5SPKSnatpool":
        add("pool", _str(spec.get("name")))
        add("addresses", [_str(a) for group_ in _list(spec.get("addressList")) for a in _list(group_)])
    elif kind == "F5SPKEgress":
        add("SNAT", f"{_str(spec.get('snatType'))} {_str(spec.get('egressSnatpool'))}".strip())
        add("namespaces", [_str(n) for n in _list(_map(spec.get("pseudoCNIConfig")).get("namespaces"))])
    elif kind == "F5SPKStaticRoute":
        destination, prefix = _str(spec.get("destination")), _num(_get(spec, "prefixLen", "prefix_len"))
        add("route", f"{destination}/{prefix} via {_str(spec.get('gateway'))}" if destination else "")
    elif kind == "F5BigFwPolicy":
        rules = _maps(spec.get("rule")) or _maps(spec.get("rules"))
        add("rules", [f"{_str(r.get('name'))} {_str(r.get('action'))}" for r in rules[:4]])
        if len(rules) > 4:
            add("more", f"+{len(rules) - 4} rules")
    elif kind == "F5BigCneAddresslist":
        add("addresses", [_str(a) for a in _list(spec.get("addresses"))])
    elif kind == "F5BigCnePortlist":
        add("ports", [_num(p) or _str(p) for p in _list(spec.get("ports"))])
    return [{"label": label, "value": value} for label, value in facts]


def _resource_out(resource: _Resource) -> dict[str, Any]:
    return {
        "id": resource.id,
        "group": resource.group,
        "version": resource.version,
        "kind": resource.kind,
        "namespace": resource.namespace,
        "name": resource.name,
        "resourceType": resource.resource_type,
        "placeholder": False,
        "conditions": _conditions(resource),
        "facts": _facts(resource),
    }
