"""
BNK topology analysis — builds the gateway topology tree.

Maps gateways → listeners → routes → backends with security policies,
network policies, iRules, data plane resources (VLANs, CNE instances,
static routes, SNAT pools, egresses), and reference grants.

Pure data transformation: takes the dict from ``fetch_all_bnk_data``
and returns a structured topology dict.
"""

import re
from typing import Any

from core.k8s_types import ApiGroups
from services.bnk.helpers import (
    get_policy_operational_status,
    has_condition,
    make_resource_map,
    resolve_egress_config,
    resolve_list_refs,
    resource_name,
    resource_ns,
)

# ---------------------------------------------------------------------------
# Route types — single source of truth for kind labels and resource keys
# ---------------------------------------------------------------------------

_ROUTE_KINDS: list[tuple[str, str]] = [
    ("httproute", "HTTPRoute"),
    ("grpcroute", "GRPCRoute"),
    ("tcproute", "TCPRoute"),
    ("udproute", "UDPRoute"),
    ("tlsroute", "TLSRoute"),
    ("l4route", "L4Route"),
    ("l4route_24", "L4Route"),
]


# ---------------------------------------------------------------------------
# Operational-state helpers
# ---------------------------------------------------------------------------


def _listener_status(gw_status: dict, listener_name: str) -> dict:
    """Find the Gateway status entry for a listener by name."""
    for entry in gw_status.get("listeners", []) or []:
        if isinstance(entry, dict) and entry.get("name") == listener_name:
            return entry
    return {}


def _route_parent_status(route: dict, gw_name: str, gw_ns: str, listener_name: str) -> dict | None:
    """Find the route's parent status entry matching a gateway/listener."""
    status = route.get("status", {}) or {}
    parents = status.get("parents") or status.get("parentRefs") or []
    for parent in parents:
        if not isinstance(parent, dict):
            continue
        ref = parent.get("parentRef", parent)
        if not isinstance(ref, dict):
            continue
        parent_ns = ref.get("namespace", route.get("metadata", {}).get("namespace", ""))
        if ref.get("name") == gw_name and parent_ns == gw_ns:
            section = ref.get("sectionName")
            if section and section != listener_name:
                continue
            return parent
    # Fallback: legacy controllers may put conditions directly on status
    if status.get("conditions"):
        return status
    return None


def _first_condition_message(conditions: list) -> str:
    """Return the first non-empty condition message, or an empty string."""
    for cond in conditions:
        if isinstance(cond, dict):
            msg = cond.get("message")
            if msg:
                return str(msg)
    return ""


def _policy_status(resource: dict) -> dict[str, Any]:
    """Derive resolved/programmed operational state from a BNK policy resource."""
    return get_policy_operational_status(resource)


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------


def analyze_topology(data: dict[str, Any]) -> dict[str, Any]:
    """Build the gateway topology response from raw BNK data."""
    resources = data["resources"]

    gateways = resources.get("gateway", [])
    referencegrants = resources.get("referencegrant", [])
    all_sec_policies = resources.get("secpolicy", []) + resources.get("bnksecpolicy", [])
    all_net_policies = resources.get("netpolicy", []) + resources.get("bnknetpolicy", [])
    app_policies = resources.get("apppolicy", [])
    gatewaysettings = resources.get("gatewaysettings", [])

    # Unify all route types for topology matching
    all_routes: list[tuple[dict, str, str]] = []
    route_counts: dict[str, int] = {}
    for res_key, kind in _ROUTE_KINDS:
        items = resources.get(res_key, [])
        route_counts[res_key] = len(items)
        all_routes.extend((r, kind, res_key) for r in items)

    # Build lookup maps
    fw_map = make_resource_map(resources.get("f5bigfwpolicy", []))
    irule_map = make_resource_map(resources.get("f5bigcneirule", []))
    addr_map = make_resource_map(resources.get("f5bigcneaddresslist", []))
    port_map = make_resource_map(resources.get("f5bigcneportlist", []))
    gs_map = make_resource_map(gatewaysettings)
    ai_profile_map = make_resource_map(resources.get("aigatewayprofile", []))
    ai_model_map = make_resource_map(resources.get("aimodel", []))
    ai_provider_map = make_resource_map(resources.get("aiprovider", []))
    ai_cred_map = make_resource_map(resources.get("aicredential", []))
    ai_tenant_map = make_resource_map(resources.get("aitenant", []))
    analyzers = resources.get("f5biganalyzer", [])

    ai_maps = {
        "profile": ai_profile_map,
        "model": ai_model_map,
        "provider": ai_provider_map,
        "credential": ai_cred_map,
        "tenant": ai_tenant_map,
    }

    # Build topology per gateway
    topology = [
        _build_gateway_node(
            gw,
            all_routes,
            analyzers,
            all_net_policies,
            irule_map,
            all_sec_policies,
            fw_map,
            addr_map,
            port_map,
            gs_map,
            app_policies=app_policies,
            ai_maps=ai_maps,
        )
        for gw in gateways
    ]

    # Data Plane section
    data_plane = _build_data_plane(resources)
    ai_gateway_chain = _build_ai_gateway_topology(resources, app_policies, ai_maps)
    data_plane["aiGateway"] = ai_gateway_chain

    # ReferenceGrant summary
    ref_grants = [
        {
            "name": resource_name(rg),
            "namespace": resource_ns(rg),
            "from": rg.get("spec", {}).get("from", []),
            "to": rg.get("spec", {}).get("to", []),
        }
        for rg in referencegrants
    ]

    return {
        "topology": topology,
        "dataPlane": data_plane,
        "aiGateway": ai_gateway_chain,
        "referenceGrants": ref_grants,
        "counts": _build_counts(resources, gateways, route_counts, referencegrants, data_plane),
    }


# ---------------------------------------------------------------------------
# Gateway node builder
# ---------------------------------------------------------------------------


def _build_gateway_node(
    gw: dict,
    all_routes: list[tuple[dict, str, str]],
    analyzers: list[dict],
    bnknetpolicies: list[dict],
    irule_map: dict[str, dict],
    bnksecpolicies: list[dict],
    fw_map: dict[str, dict],
    addr_map: dict[str, dict],
    port_map: dict[str, dict],
    gs_map: dict[str, dict] | None = None,
    app_policies: list[dict] | None = None,
    ai_maps: dict[str, dict[str, dict]] | None = None,
) -> dict[str, Any]:
    """Build a single gateway topology node with listeners, policies, and tenant settings."""
    gw_meta = gw.get("metadata", {})
    gw_spec = gw.get("spec", {})
    gw_status = gw.get("status", {})
    gw_name = gw_meta.get("name", "")
    gw_ns = gw_meta.get("namespace", "")

    listeners_data = [
        _build_listener_node(
            listener,
            all_routes,
            analyzers,
            bnknetpolicies,
            irule_map,
            gw_name,
            gw_ns,
            gw_status,
            app_policies=app_policies,
            ai_maps=ai_maps,
        )
        for listener in gw_spec.get("listeners", [])
    ]

    sec_policies_data = _match_sec_policies(
        bnksecpolicies,
        fw_map,
        addr_map,
        port_map,
        gw_name,
        gw_ns=gw_ns,
    )
    app_policies_data = _match_app_policies(
        app_policies or [],
        irule_map,
        ai_maps or {},
        target_name=gw_name,
        target_kind="Gateway",
        target_ns=gw_ns,
    )

    # Resolve 2.4 GatewaySettings (a Gateway parametersRef is local to its namespace)
    params_ref = (gw_spec.get("infrastructure") or {}).get("parametersRef") or {}
    gw_settings_data = None
    if gs_map and params_ref.get("kind") == "GatewaySettings" and params_ref.get("group") == ApiGroups.F5_GATEWAY:
        gs_name = params_ref.get("name", "")
        gs_obj = gs_map.get(f"{gw_ns}/{gs_name}")
        if gs_obj:
            gs_spec = gs_obj.get("spec", {}) or {}
            gw_settings_data = {
                "name": gs_name,
                "namespace": resource_ns(gs_obj),
                "ingressConfig": gs_spec.get("ingressConfig") or {},
                "sourceNATPools": gs_spec.get("sourceNATPools") or [],
                "egressConfigs": gs_spec.get("egressConfigs") or [],
            }

    return {
        "name": gw_name,
        "namespace": gw_ns,
        "gatewayClassName": gw_spec.get("gatewayClassName", ""),
        "addresses": [a.get("value", "") for a in gw_status.get("addresses", [])],
        "accepted": has_condition(gw, "Accepted"),
        "programmed": has_condition(gw, "Programmed"),
        "conditions": gw_status.get("conditions", []) or [],
        "listeners": listeners_data,
        "securityPolicies": sec_policies_data,
        "appPolicies": app_policies_data,
        "gatewaySettings": gw_settings_data,
    }


# ---------------------------------------------------------------------------
# Listener node builder
# ---------------------------------------------------------------------------


def _build_listener_node(
    listener: dict,
    all_routes: list[tuple[dict, str, str]],
    analyzers: list[dict],
    bnknetpolicies: list[dict],
    irule_map: dict[str, dict],
    gw_name: str,
    gw_ns: str,
    gw_status: dict,
    app_policies: list[dict] | None = None,
    ai_maps: dict[str, dict[str, dict]] | None = None,
) -> dict[str, Any]:
    """Build a single listener node with routes and network policies."""
    listener_name = listener.get("name", "")
    status = _listener_status(gw_status, listener_name)
    return {
        "name": listener_name,
        "protocol": listener.get("protocol", ""),
        "port": listener.get("port"),
        "attachedRouteCount": status.get("attachedRoutes", 0) or 0,
        "conditions": status.get("conditions", []) or [],
        "routes": _match_routes_to_listener(
            all_routes,
            analyzers,
            gw_name,
            gw_ns,
            listener_name,
            app_policies=app_policies,
            irule_map=irule_map,
            ai_maps=ai_maps,
        ),
        "networkPolicies": _match_net_policies(
            bnknetpolicies,
            irule_map,
            gw_name,
            listener_name,
            gw_ns=gw_ns,
        ),
        "appPolicies": _match_app_policies(
            app_policies or [],
            irule_map,
            ai_maps or {},
            target_name=gw_name,
            target_kind="Gateway",
            section_name=listener_name,
            target_ns=gw_ns,
        ),
    }


# ---------------------------------------------------------------------------
# Route matching
# ---------------------------------------------------------------------------


def _match_routes_to_listener(
    all_routes: list[tuple[dict, str, str]],
    analyzers: list[dict],
    gw_name: str,
    gw_ns: str,
    listener_name: str,
    app_policies: list[dict] | None = None,
    irule_map: dict[str, dict] | None = None,
    ai_maps: dict[str, dict[str, dict]] | None = None,
) -> list[dict]:
    """Find all routes (HTTP, GRPC, TCP, UDP, TLS, L4) targeting a gateway/listener."""
    routes_data: list[dict] = []
    for route, route_kind, route_key in all_routes:
        route_meta = route.get("metadata", {})
        route_spec = route.get("spec", {})
        route_ns = route_meta.get("namespace", "")

        for parent in route_spec.get("parentRefs", []):
            parent_ns = parent.get("namespace", route_ns)
            if parent.get("name") != gw_name or parent_ns != gw_ns:
                continue
            section = parent.get("sectionName")
            if section and section != listener_name:
                continue

            backends = [
                {
                    "name": br.get("name", ""),
                    "namespace": br.get("namespace"),
                    "port": br.get("port"),
                    "weight": br.get("weight"),
                    "kind": br.get("kind", "Service"),
                    "group": br.get("group", ""),
                }
                for rule in route_spec.get("rules", [])
                for br in rule.get("backendRefs", [])
            ]

            route_name = route_meta.get("name", "")
            parent_status = _route_parent_status(route, gw_name, gw_ns, listener_name)
            parent_conditions = parent_status.get("conditions", []) if parent_status else []
            accepted = (
                (
                    has_condition(parent_status, "Accepted")
                    or has_condition(parent_status, "Programmed")
                    or has_condition(parent_status, "Ready")
                    or has_condition(route, "Accepted")
                    or has_condition(route, "Programmed")
                )
                if parent_status
                else (has_condition(route, "Accepted") or has_condition(route, "Programmed"))
            )

            # MCP endpoint detection (aligned with awsbnkctl bnkscan)
            annotations = route_meta.get("annotations", {}) or {}
            is_mcp = annotations.get("bnk.f5.com/protocol") == "mcp" or any(
                isinstance(m, dict)
                and isinstance(m.get("path"), dict)
                and "/mcp" in str(m.get("path", {}).get("value", ""))
                for rule in route_spec.get("rules", [])
                for m in rule.get("matches", [])
            )
            mcp_info = None
            if is_mcp:
                raw_tools = annotations.get("bnk.f5.com/mcp-tools", "")
                tools = [t.strip() for t in raw_tools.split(",") if t.strip()] if raw_tools else []
                mcp_info = {
                    "auth": annotations.get("bnk.f5.com/auth", "unknown"),
                    "tools": tools,
                }

            route_app_policies = _match_app_policies(
                app_policies or [],
                irule_map or {},
                ai_maps or {},
                target_name=route_name,
                target_kind=route_kind,
                target_ns=route_ns,
            )

            routes_data.append(
                {
                    "name": route_name,
                    "namespace": route_ns,
                    "kind": route_kind,
                    "resourceType": route_key,
                    "hostnames": route_spec.get("hostnames", []),
                    "backends": backends,
                    "analyzers": _match_analyzers(
                        analyzers,
                        route_name,
                        route_kind,
                        route_ns,
                        gw_ns,
                    ),
                    "appPolicies": route_app_policies,
                    "accepted": accepted,
                    "conditions": parent_conditions,
                    "conditionMessage": _first_condition_message(parent_conditions) if not accepted else "",
                    "isMcp": is_mcp,
                    "mcpInfo": mcp_info,
                }
            )

    return routes_data


def _match_analyzers(
    analyzers: list[dict],
    route_name: str,
    route_kind: str,
    route_ns: str,
    gw_ns: str,
) -> list[dict]:
    """Check if any analyzer monitors a specific route."""
    result: list[dict] = []
    for analyzer in analyzers:
        a_spec = analyzer.get("spec", {})
        for app in a_spec.get("applications", []):
            if (
                app.get("name") == route_name
                and app.get("kind") == route_kind
                and app.get("namespace", gw_ns) == route_ns
            ):
                script = a_spec.get("script", {})
                params = script.get("custom", {}).get("parameters", [])
                # F5BigAnalyzer spec.schedule is an object ({"every": "5m"}).
                schedule = a_spec.get("schedule") or ""
                if isinstance(schedule, dict):
                    schedule = schedule.get("every") or ""
                result.append(
                    {
                        "name": resource_name(analyzer),
                        "schedule": str(schedule),
                        "scriptType": script.get("type", ""),
                        "dataSources": [ds.get("name", "") for ds in a_spec.get("dataSources", [])],
                        "parameters": {p.get("key", ""): p.get("value", "") for p in params},
                    }
                )
    return result


# ---------------------------------------------------------------------------
# Policy matching
# ---------------------------------------------------------------------------


def _match_net_policies(
    bnknetpolicies: list[dict],
    irule_map: dict[str, dict],
    gw_name: str,
    listener_name: str,
    gw_ns: str = "",
) -> list[dict]:
    """Find BNKNetPolicies targeting a specific gateway/listener."""
    result: list[dict] = []
    for np_item in bnknetpolicies:
        np_spec = np_item.get("spec", {})
        np_ns = resource_ns(np_item)

        for target in np_spec.get("targetRefs", []):
            target_ns = target.get("namespace") or np_ns
            if not (
                target.get("name") == gw_name
                and target.get("sectionName") == listener_name
                and target.get("kind") == "Gateway"
                and (not gw_ns or target_ns == gw_ns)
            ):
                continue

            extensions = _build_extensions(np_spec.get("extensionRefs", []), np_ns, irule_map)
            descendants = np_item.get("status", {}).get("descendants", [])
            resolved_count = sum(
                1 for d in descendants if any(c.get("status") == "True" for c in d.get("conditions", []))
            )

            status = _policy_status(np_item)
            result.append(
                {
                    "name": resource_name(np_item),
                    "kind": np_item.get("kind", ""),
                    "namespace": np_ns,
                    "extensions": extensions,
                    "resolvedCount": resolved_count,
                    "totalExtensions": len(extensions),
                    "resolved": status["resolved"],
                    "programmed": status["programmed"],
                    "messages": status["messages"],
                }
            )

    return result


def _resolve_ai_gateway_profile(
    profile_obj: dict,
    ai_maps: dict[str, dict[str, dict]],
) -> dict[str, Any]:
    """Resolve an AIGatewayProfile CR into its full BNK 2.4.1 LLM Gateway chain."""
    p_name = resource_name(profile_obj)
    p_ns = resource_ns(profile_obj)
    p_spec = profile_obj.get("spec") or {}
    model_map = ai_maps.get("model") or {}
    provider_map = ai_maps.get("provider") or {}
    cred_map = ai_maps.get("credential") or {}
    tenant_map = ai_maps.get("tenant") or {}

    resolved_models: list[dict[str, Any]] = []
    raw_model_refs = p_spec.get("modelRefs") or p_spec.get("models") or []
    for m_ref in raw_model_refs:
        m_name = m_ref.get("name", "") if isinstance(m_ref, dict) else str(m_ref)
        m_ns = (m_ref.get("namespace") if isinstance(m_ref, dict) else None) or p_ns
        m_obj = model_map.get(f"{m_ns}/{m_name}") or model_map.get(f"/{m_name}")
        m_spec = (m_obj or {}).get("spec") or {}
        resolved_providers: list[dict[str, Any]] = []
        for pr_ref in m_spec.get("providerRefs") or m_spec.get("providers") or []:
            pr_name = pr_ref.get("name", "") if isinstance(pr_ref, dict) else str(pr_ref)
            pr_ns = (pr_ref.get("namespace") if isinstance(pr_ref, dict) else None) or m_ns
            pr_obj = provider_map.get(f"{pr_ns}/{pr_name}") or provider_map.get(f"/{pr_name}")
            pr_spec = (pr_obj or {}).get("spec") or {}
            cred_ref = pr_spec.get("credentialRef") or {}
            cred_name = cred_ref.get("name", "") if isinstance(cred_ref, dict) else str(cred_ref or "")
            cred_ns = (cred_ref.get("namespace") if isinstance(cred_ref, dict) else None) or pr_ns
            cred_obj = cred_map.get(f"{cred_ns}/{cred_name}") if cred_name else None
            cred_spec = (cred_obj or {}).get("spec") or {}
            resolved_providers.append(
                {
                    "name": pr_name,
                    "namespace": pr_ns,
                    "type": pr_spec.get("type", ""),
                    "endpoint": pr_spec.get("endpoint", ""),
                    "credential": {
                        "name": cred_name,
                        "namespace": cred_ns,
                        "secretRef": cred_spec.get("secretRef"),
                        "resolved": cred_obj is not None,
                    }
                    if cred_name
                    else None,
                    "resolved": pr_obj is not None,
                }
            )
        resolved_models.append(
            {
                "name": m_name,
                "namespace": m_ns,
                "modelName": m_spec.get("modelName", m_name),
                "routingMode": m_spec.get("routingMode", ""),
                "providers": resolved_providers,
                "resolved": m_obj is not None,
            }
        )

    resolved_tenants: list[dict[str, Any]] = []
    for t_ref in p_spec.get("tenantRefs") or p_spec.get("tenants") or []:
        t_name = t_ref.get("name", "") if isinstance(t_ref, dict) else str(t_ref)
        t_ns = (t_ref.get("namespace") if isinstance(t_ref, dict) else None) or p_ns
        t_obj = tenant_map.get(f"{t_ns}/{t_name}") or tenant_map.get(f"/{t_name}")
        t_spec = (t_obj or {}).get("spec") or {}
        resolved_tenants.append(
            {
                "name": t_name,
                "namespace": t_ns,
                "rateLimits": t_spec.get("rateLimits") or {},
                "tokenBudget": t_spec.get("tokenBudget") or {},
                "resolved": t_obj is not None,
            }
        )

    return {
        "name": p_name,
        "namespace": p_ns,
        "defaultModelRef": p_spec.get("defaultModelRef"),
        "smartRouting": p_spec.get("smartRouting") or {},
        "models": resolved_models,
        "tenants": resolved_tenants,
        "ready": has_condition(profile_obj, "Accepted")
        or has_condition(profile_obj, "Programmed")
        or has_condition(profile_obj, "Ready"),
    }


def _match_app_policies(
    app_policies: list[dict],
    irule_map: dict[str, dict],
    ai_maps: dict[str, dict[str, dict]],
    target_name: str,
    target_kind: str,
    section_name: str | None = None,
    target_ns: str = "",
) -> list[dict[str, Any]]:
    """Find BNK 2.4.1 AppPolicies targeting a Gateway, Listener, or Route and resolve extensionRefs -> AIGatewayProfile."""
    result: list[dict[str, Any]] = []
    profile_map = ai_maps.get("profile") or {}
    for ap in app_policies:
        ap_spec = ap.get("spec") or {}
        ap_ns = resource_ns(ap)
        for target in ap_spec.get("targetRefs") or []:
            ref_ns = target.get("namespace") or ap_ns
            if (
                target.get("name") != target_name
                or target.get("kind") != target_kind
                or (target_ns and ref_ns != target_ns)
            ):
                continue
            target_sec = target.get("sectionName")
            if section_name is not None and target_sec != section_name:
                continue
            if section_name is None and target_kind == "Gateway" and target_sec:
                continue

            ext_refs = ap_spec.get("extensionRefs") or []
            extensions = _build_extensions(ext_refs, ap_ns, irule_map, ai_maps=ai_maps)
            ai_profiles: list[dict[str, Any]] = []
            for ext in ext_refs:
                if ext.get("kind") == "AIGatewayProfile":
                    ext_ns = ext.get("namespace") or ap_ns
                    prof_obj = profile_map.get(f"{ext_ns}/{ext.get('name', '')}")
                    if prof_obj:
                        ai_profiles.append(_resolve_ai_gateway_profile(prof_obj, ai_maps))

            status = _policy_status(ap)
            result.append(
                {
                    "name": resource_name(ap),
                    "kind": ap.get("kind", "AppPolicy"),
                    "namespace": ap_ns,
                    "targetSectionName": target_sec or "",
                    "extensions": extensions,
                    "aiGatewayProfiles": ai_profiles,
                    "resolved": status["resolved"],
                    "programmed": status["programmed"],
                    "messages": status["messages"],
                }
            )
    return result


def _build_ai_gateway_topology(
    resources: dict[str, list],
    app_policies: list[dict],
    ai_maps: dict[str, dict[str, dict]],
) -> dict[str, Any]:
    """Build the BNK 2.4.1 LLM Gateway chain summary (AppPolicy -> AIGatewayProfile -> AITenant/AIModel -> AIProvider -> AICredential)."""
    profiles = [_resolve_ai_gateway_profile(p, ai_maps) for p in resources.get("aigatewayprofile", [])]
    irule_map = make_resource_map(resources.get("f5bigcneirule", []))
    resolved_app_policies: list[dict[str, Any]] = []
    profile_map = ai_maps.get("profile") or {}
    for ap in app_policies:
        ap_spec = ap.get("spec") or {}
        ap_ns = resource_ns(ap)
        ext_refs = ap_spec.get("extensionRefs") or []
        ai_profiles = []
        for ext in ext_refs:
            if ext.get("kind") == "AIGatewayProfile":
                ext_ns = ext.get("namespace") or ap_ns
                prof_obj = profile_map.get(f"{ext_ns}/{ext.get('name', '')}")
                if prof_obj:
                    ai_profiles.append(_resolve_ai_gateway_profile(prof_obj, ai_maps))
        status = _policy_status(ap)
        resolved_app_policies.append(
            {
                "name": resource_name(ap),
                "namespace": ap_ns,
                "targetRefs": ap_spec.get("targetRefs") or [],
                "extensions": _build_extensions(ext_refs, ap_ns, irule_map, ai_maps=ai_maps),
                "aiGatewayProfiles": ai_profiles,
                "resolved": status["resolved"],
                "programmed": status["programmed"],
            }
        )
    return {
        "appPolicies": resolved_app_policies,
        "profiles": profiles,
        "models": [
            {
                "name": resource_name(m),
                "namespace": resource_ns(m),
                "modelName": (m.get("spec") or {}).get("modelName", resource_name(m)),
                "providerRefs": (m.get("spec") or {}).get("providerRefs") or [],
            }
            for m in resources.get("aimodel", [])
        ],
        "providers": [
            {
                "name": resource_name(pr),
                "namespace": resource_ns(pr),
                "type": (pr.get("spec") or {}).get("type", ""),
                "endpoint": (pr.get("spec") or {}).get("endpoint", ""),
                "credentialRef": (pr.get("spec") or {}).get("credentialRef"),
            }
            for pr in resources.get("aiprovider", [])
        ],
        "tenants": [
            {
                "name": resource_name(t),
                "namespace": resource_ns(t),
                "rateLimits": (t.get("spec") or {}).get("rateLimits") or {},
            }
            for t in resources.get("aitenant", [])
        ],
        "credentials": [
            {
                "name": resource_name(c),
                "namespace": resource_ns(c),
                "secretRef": (c.get("spec") or {}).get("secretRef"),
            }
            for c in resources.get("aicredential", [])
        ],
        "gateways": [
            {
                "name": resource_name(g),
                "namespace": resource_ns(g),
                "profileRef": (g.get("spec") or {}).get("profileRef"),
            }
            for g in resources.get("aigateway", [])
        ],
    }


def _build_extensions(
    extension_refs: list[dict],
    policy_ns: str,
    irule_map: dict[str, dict],
    ai_maps: dict[str, dict[str, dict]] | None = None,
) -> list[dict[str, Any]]:
    """Build extension data with optional iRule and AIGatewayProfile enrichment."""
    extensions: list[dict[str, Any]] = []
    profile_map = (ai_maps or {}).get("profile") or {}
    for ext in extension_refs:
        ext_data: dict[str, Any] = {
            "kind": ext.get("kind", ""),
            "name": ext.get("name", ""),
            "group": ext.get("group", ""),
        }
        if ext.get("kind") == "F5BigCneIrule":
            irule_obj = irule_map.get(f"{policy_ns}/{ext.get('name', '')}")
            if irule_obj:
                code = irule_obj.get("spec", {}).get("iRule", "")
                ext_data["lineCount"] = len(code.split("\n")) if code else 0
                ext_data["eventHandlers"] = re.findall(r"when\s+(\w+)", code)
        elif ext.get("kind") == "AIGatewayProfile":
            ext_ns = ext.get("namespace") or policy_ns
            prof_obj = profile_map.get(f"{ext_ns}/{ext.get('name', '')}")
            if prof_obj and ai_maps:
                ext_data["aiGatewayProfile"] = _resolve_ai_gateway_profile(prof_obj, ai_maps)
        extensions.append(ext_data)
    return extensions


def _match_sec_policies(
    bnksecpolicies: list[dict],
    fw_map: dict[str, dict],
    addr_map: dict[str, dict],
    port_map: dict[str, dict],
    gw_name: str,
    gw_ns: str = "",
) -> list[dict]:
    """Find BNKSecPolicies targeting a specific gateway."""
    result: list[dict] = []
    for sp in bnksecpolicies:
        sp_spec = sp.get("spec", {})
        sp_ns = resource_ns(sp)

        for target in sp_spec.get("targetRefs", []):
            target_ns = target.get("namespace") or sp_ns
            if not (
                target.get("name") == gw_name and target.get("kind") == "Gateway" and (not gw_ns or target_ns == gw_ns)
            ):
                continue

            fw_refs = _build_firewall_refs(
                sp_spec.get("extensionRefs", []),
                fw_map,
                addr_map,
                port_map,
                sp_ns,
            )
            status = _policy_status(sp)
            result.append(
                {
                    "name": resource_name(sp),
                    "kind": sp.get("kind", ""),
                    "namespace": sp_ns,
                    "targetListener": target.get("sectionName", ""),
                    "firewallPolicies": fw_refs,
                    "resolved": status["resolved"],
                    "programmed": status["programmed"],
                    "messages": status["messages"],
                }
            )

    return result


def _build_firewall_refs(
    extension_refs: list[dict],
    fw_map: dict[str, dict],
    addr_map: dict[str, dict],
    port_map: dict[str, dict],
    policy_ns: str,
) -> list[dict[str, Any]]:
    """Build firewall policy references with enriched rule details."""
    fw_refs: list[dict[str, Any]] = []
    for ext in extension_refs:
        if ext.get("kind") != "F5BigFwPolicy":
            continue

        fw_obj = fw_map.get(f"{policy_ns}/{ext.get('name', '')}")
        rules: list[dict] = []
        referenced_addr_lists: set[str] = set()
        referenced_port_lists: set[str] = set()

        if fw_obj:
            fw_rules = fw_obj.get("spec", {}).get("rule") or fw_obj.get("spec", {}).get("rules") or []
            for rule in fw_rules:
                rules.append(
                    {
                        "name": rule.get("name", ""),
                        "action": rule.get("action", ""),
                        "ipProtocol": rule.get("ipProtocol", ""),
                        "logging": rule.get("logging", False),
                    }
                )
                # Collect referenced address/port lists from both source and destination
                for direction in ("source", "destination"):
                    dir_spec = rule.get(direction, {})
                    referenced_addr_lists.update(dir_spec.get("addressLists", []))
                    referenced_port_lists.update(dir_spec.get("portLists", []))

        fw_refs.append(
            {
                "name": ext.get("name", ""),
                "rules": rules,
                "addressLists": resolve_list_refs(referenced_addr_lists, addr_map, policy_ns, "addresses"),
                "portLists": resolve_list_refs(referenced_port_lists, port_map, policy_ns, "ports"),
            }
        )

    return fw_refs


# ---------------------------------------------------------------------------
# Data plane builder
# ---------------------------------------------------------------------------


def _is_internal_network(name: str) -> bool:
    """Infra networks carry no internal/external flag; read it from whole name tokens (int-vlan, internal)."""
    return any(token in ("int", "internal") for token in re.split(r"[^a-z0-9]+", name.lower()))


def _build_infra_entry(infra: dict) -> dict[str, Any]:
    """Build a single Infra underlay entry for the data plane section."""
    spec = infra.get("spec", {}) or {}
    status = infra.get("status", {}) or {}
    return {
        "name": resource_name(infra),
        "namespace": resource_ns(infra),
        "networks": spec.get("networks") or [],
        "ipams": spec.get("ipams") or [],
        "networkAttachments": spec.get("networkAttachments") or [],
        "staticRoutes": spec.get("staticRoutes") or [],
        "vrfs": spec.get("vrfs") or [],
        "egressDefaults": spec.get("egressDefaults") or {},
        "ready": has_condition(infra, "Programmed") or has_condition(infra, "Ready"),
        "conditions": status.get("conditions", []) or [],
    }


def _build_gateway_settings_entry(gs: dict) -> dict[str, Any]:
    """Build a single GatewaySettings entry for the data plane section."""
    spec = gs.get("spec", {}) or {}
    status = gs.get("status", {}) or {}
    return {
        "name": resource_name(gs),
        "namespace": resource_ns(gs),
        "ingressConfig": spec.get("ingressConfig") or {},
        "sourceNATPools": spec.get("sourceNATPools") or [],
        "egressConfigs": spec.get("egressConfigs") or [],
        "ready": has_condition(gs, "Programmed") or has_condition(gs, "Accepted"),
        "conditions": status.get("conditions", []) or [],
    }


def _build_egress_gateway(
    eg: dict,
    gs_map: dict[str, dict] | None = None,
    sec_policies: list[dict] | None = None,
) -> dict[str, Any]:
    """Build a single EgressGateway entry normalized for data plane and flow views."""
    spec = eg.get("spec") or {}
    eg_name = resource_name(eg)
    eg_ns = resource_ns(eg)

    source_selector = spec.get("sourceSelector") or {}
    # NamespaceSelector captures exactly the namespaces listed in matchNames
    namespaces = (source_selector.get("namespaces") or {}).get("matchNames") or []

    params_ref = (spec.get("infrastructure") or {}).get("parametersRef") or {}
    egress_config = resolve_egress_config(eg, gs_map or {}) or {}
    snat_config = egress_config.get("sourceNATConfig") or {}

    fw_policy_name = None
    for sp in sec_policies or []:
        if resource_ns(sp) != eg_ns:
            continue
        sp_spec = sp.get("spec") or {}
        if not any(
            t.get("kind") == "EgressGateway" and t.get("name") == eg_name for t in sp_spec.get("targetRefs") or []
        ):
            continue
        fw_policy_name = next(
            (ext.get("name") for ext in sp_spec.get("extensionRefs") or [] if ext.get("kind") == "F5BigFwPolicy"),
            None,
        )
        if fw_policy_name:
            break

    return {
        "name": eg_name,
        "namespace": eg_ns,
        "kind": "EgressGateway",
        "gatewayClassName": spec.get("gatewayClassName", ""),
        "snatType": snat_config.get("type", ""),
        "egressSnatpool": (snat_config.get("sourceNATPoolRef") or {}).get("name"),
        "firewallEnforcedPolicy": fw_policy_name,
        "logProfile": None,
        "capturedNamespaces": namespaces,
        "parametersRef": params_ref,
        "sourceSelector": source_selector,
        "vxlan": None,
        "ready": has_condition(eg, "Programmed") or has_condition(eg, "Accepted") or has_condition(eg, "Ready"),
    }


def _build_data_plane(resources: dict[str, list]) -> dict[str, Any]:
    """Build the data plane section of the topology response."""
    vlans = resources.get("f5spkvlan", [])
    cneinstances = resources.get("cneinstance", [])
    staticroutes = resources.get("f5spkstaticroute", [])
    snatpools = resources.get("f5spksnatpool", [])
    egresses = resources.get("f5spkegress", [])
    hslpubs = resources.get("f5bigloghslpub", [])
    logprofiles = resources.get("f5biglogprofile", [])
    infras = resources.get("infra", [])
    gatewaysettings = resources.get("gatewaysettings", [])
    egressgateways = resources.get("egressgateway", [])
    all_sec_policies = resources.get("secpolicy", []) + resources.get("bnksecpolicy", [])
    gs_map = make_resource_map(gatewaysettings)

    infra_entries = [_build_infra_entry(infra) for infra in infras]
    gs_entries = [_build_gateway_settings_entry(gs) for gs in gatewaysettings]
    egress_gw_entries = [_build_egress_gateway(eg, gs_map, all_sec_policies) for eg in egressgateways]

    # Project networks from 2.4 Infra if legacy VLANs are absent. Clicks open the
    # parent Infra (infraName); self IPs come from IPAM pools, so none are listed.
    projected_vlans: list[dict[str, Any]] = []
    if not vlans and infras:
        for infra in infras:
            infra_ns = resource_ns(infra)
            infra_ready = has_condition(infra, "Programmed") or has_condition(infra, "Ready")
            for net in (infra.get("spec") or {}).get("networks") or []:
                v_cfg = net.get("vlan") or {}
                att_ref = (v_cfg.get("networkAttachmentRef") or {}).get("name", "")
                projected_vlans.append(
                    {
                        "name": net.get("name", ""),
                        "namespace": infra_ns,
                        "kind": "Infra",
                        "infraName": resource_name(infra),
                        "interfaces": [att_ref] if att_ref else [],
                        "selfipV4s": [],
                        "prefixLen": None,
                        "mtu": v_cfg.get("mtu", 1500),
                        "internal": _is_internal_network(net.get("name", "")),
                        "autoLasthop": "",
                        "ready": infra_ready,
                        "type": net.get("type", "vlan"),
                        "tag": v_cfg.get("tag", 0),
                    }
                )

    # Project static routes from 2.4 Infra if legacy static routes are absent
    projected_static_routes: list[dict[str, Any]] = []
    if not staticroutes and infras:
        for infra in infras:
            infra_ns = resource_ns(infra)
            for sr in (infra.get("spec") or {}).get("staticRoutes") or []:
                projected_static_routes.append(
                    {
                        "name": sr.get("name", ""),
                        "namespace": infra_ns,
                        "kind": "Infra",
                        "infraName": resource_name(infra),
                        "destination": ", ".join(sr.get("destinations") or []),
                        "gateway": sr.get("nextHop", ""),
                    }
                )

    combined_egresses = [_build_egress(eg) for eg in egresses] + egress_gw_entries

    return {
        "vlans": [_build_vlan(v) for v in vlans] if vlans else projected_vlans,
        "cneInstances": [_build_cne_instance(c) for c in cneinstances],
        "staticRoutes": [
            {
                "name": resource_name(sr),
                "namespace": resource_ns(sr),
                "destination": sr.get("spec", {}).get("destination", ""),
                "gateway": sr.get("spec", {}).get("gateway", ""),
            }
            for sr in staticroutes
        ]
        if staticroutes
        else projected_static_routes,
        "snatPools": [
            {
                "name": resource_name(sp),
                "namespace": resource_ns(sp),
                "addresses": sp.get("spec", {}).get("addresses", sp.get("spec", {}).get("members", [])),
            }
            for sp in snatpools
        ],
        "egresses": combined_egresses,
        "infra": infra_entries,
        "gatewaySettings": gs_entries,
        "egressGateways": egress_gw_entries,
        "logging": {
            "hslPublishers": [
                {
                    "name": resource_name(hsl),
                    "namespace": resource_ns(hsl),
                    "pool": hsl.get("spec", {}).get("pool", {}),
                    "protocol": hsl.get("spec", {}).get("protocol", ""),
                }
                for hsl in hslpubs
            ],
            "logProfiles": [
                {
                    "name": resource_name(lp),
                    "namespace": resource_ns(lp),
                    "publishers": lp.get("spec", {}).get("publishers", []),
                }
                for lp in logprofiles
            ],
        },
    }


def _build_vlan(vlan: dict) -> dict[str, Any]:
    """Build a single VLAN entry for the data plane section."""
    v_spec = vlan.get("spec", {})
    return {
        "name": resource_name(vlan),
        "namespace": resource_ns(vlan),
        "kind": "F5SPKVlan",
        "interfaces": v_spec.get("interfaces", []),
        "selfipV4s": v_spec.get("selfip_v4s", v_spec.get("selfipV4s", [])),
        "prefixLen": v_spec.get("prefixlen_v4", v_spec.get("prefix_len", v_spec.get("prefixLen"))),
        "mtu": v_spec.get("mtu"),
        "internal": v_spec.get("internal", False),
        "autoLasthop": v_spec.get("auto_lasthop", v_spec.get("autoLasthop", "")),
        "ready": has_condition(vlan, "Ready") or has_condition(vlan, "Programmed"),
    }


def _build_cne_instance(cne: dict) -> dict[str, Any]:
    """Build a single CNE instance entry for the data plane section."""
    c_spec = cne.get("spec", {})
    # Derive feature flags from live spec — any key whose value is a dict
    # containing 'enabled' is a feature flag. This avoids a hardcoded key list
    # that would drop newly-added features (e.g. coreCollection, envDiscovery).
    features: dict[str, bool] = {
        key: bool(val.get("enabled")) for key, val in c_spec.items() if isinstance(val, dict) and "enabled" in val
    }
    c_status = cne.get("status", {}) or {}
    phase = c_status.get("phase", "")
    ready = (
        has_condition(cne, "Programmed")
        or has_condition(cne, "Ready")
        or has_condition(cne, "Available")
        or has_condition(cne, "Reconciled")
    )
    if not phase and ready:
        phase = "Ready" if (has_condition(cne, "Ready") or has_condition(cne, "Available")) else "Active"
    return {
        "name": resource_name(cne),
        "namespace": resource_ns(cne),
        "features": features,
        "networkAttachments": c_spec.get("networkAttachments", []),
        "containerPlatform": c_spec.get("containerPlatform", ""),
        "phase": phase,
        "ready": ready,
    }


# ---------------------------------------------------------------------------
# Counts builder
# ---------------------------------------------------------------------------


def _build_egress(egress: dict) -> dict[str, Any]:
    """Build a single F5SPKEgress entry for the data plane section."""
    eg_spec = egress.get("spec") or {}
    cni_config = eg_spec.get("pseudoCNIConfig") or {}
    vxlan_config = cni_config.get("vxlan")
    return {
        "name": resource_name(egress),
        "namespace": resource_ns(egress),
        "kind": "F5SPKEgress",
        "snatType": eg_spec.get("snatType", ""),
        "egressSnatpool": eg_spec.get("egressSnatpool"),
        "firewallEnforcedPolicy": eg_spec.get("firewallEnforcedPolicy"),
        "logProfile": eg_spec.get("logProfile"),
        "capturedNamespaces": cni_config.get("namespaces") or [],
        "vxlan": {
            "tmmInterfaceName": vxlan_config.get("tmmInterfaceName", "") or "",
            "nodeInterfaceName": vxlan_config.get("nodeInterfaceName", "") or "",
        }
        if isinstance(vxlan_config, dict) and vxlan_config
        else None,
        "ready": has_condition(egress, "Programmed"),
    }


def _build_counts(
    resources: dict[str, list],
    gateways: list[dict],
    route_counts: dict[str, int],
    referencegrants: list[dict],
    data_plane: dict[str, Any],
) -> dict[str, int]:
    """Build the counts summary for the topology response."""
    all_sec_policies = resources.get("secpolicy", []) + resources.get("bnksecpolicy", [])
    all_net_policies = resources.get("netpolicy", []) + resources.get("bnknetpolicy", [])
    return {
        "gateways": len(gateways),
        "listeners": sum(len(gw.get("spec", {}).get("listeners", [])) for gw in gateways),
        "httpRoutes": route_counts.get("httproute", 0),
        "grpcRoutes": route_counts.get("grpcroute", 0),
        "tcpRoutes": route_counts.get("tcproute", 0),
        "udpRoutes": route_counts.get("udproute", 0),
        "tlsRoutes": route_counts.get("tlsroute", 0),
        "l4Routes": route_counts.get("l4route", 0) + route_counts.get("l4route_24", 0),
        "totalRoutes": sum(route_counts.values()),
        "referenceGrants": len(referencegrants),
        "securityPolicies": len(all_sec_policies),
        "networkPolicies": len(all_net_policies),
        "firewallPolicies": len(resources.get("f5bigfwpolicy", [])),
        "iRules": len(resources.get("f5bigcneirule", [])),
        "analyzers": len(resources.get("f5biganalyzer", [])),
        "vlans": len(data_plane["vlans"]),
        "cneInstances": len(resources.get("cneinstance", [])),
        "staticRoutes": len(data_plane["staticRoutes"]),
        "snatPools": len(resources.get("f5spksnatpool", [])),
        "egresses": len(resources.get("f5spkegress", [])) + len(resources.get("egressgateway", [])),
        "hslPublishers": len(resources.get("f5bigloghslpub", [])),
        "logProfiles": len(resources.get("f5biglogprofile", [])),
        "infra": len(resources.get("infra", [])),
        "gatewaySettings": len(resources.get("gatewaysettings", [])),
        "egressGateways": len(resources.get("egressgateway", [])),
        "inferencePools": len(resources.get("inferencepool", [])),
        "f5epps": len(resources.get("f5epp", [])),
        "appPolicies": len(resources.get("apppolicy", [])),
        "aiGatewayProfiles": len(resources.get("aigatewayprofile", [])),
        "aiModels": len(resources.get("aimodel", [])),
        "aiProviders": len(resources.get("aiprovider", [])),
        "aiTenants": len(resources.get("aitenant", [])),
        "aiCredentials": len(resources.get("aicredential", [])),
        "aiGateways": len(resources.get("aigateway", [])),
    }
