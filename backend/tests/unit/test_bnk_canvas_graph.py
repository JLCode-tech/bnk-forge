"""
Unit tests for services.bnk.canvas_graph — the Topology Canvas relationship rules.

Table-driven: one row per relationship rule, built from small K8s dicts, asserting the exact edges and
findings. A golden JSON pins the whole graph for the anonymized sample cluster
(tests/fixtures/bnk_canvas/sample_cluster.yaml). Regenerate it with UPDATE_GOLDEN=1.
"""

import json
import os
from pathlib import Path
from typing import Any

import pytest
import yaml

from core.k8s_resource_registry import get_resource_type
from schemas.bnk import BnkCanvasResponse
from services.bnk.canvas_graph import CANVAS_LOCAL_TYPES, CANVAS_RESOURCE_TYPES, build_canvas_graph

pytestmark = pytest.mark.unit

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "bnk_canvas"
GW = "gateway.networking.k8s.io/v1"
F5GW = "gateway.k8s.f5.com/v1alpha1"
F5NET = "k8s.f5net.com/v1"
INFERENCE = "inference.networking.k8s.io/v1"
F5_INFERENCE = "inference.k8s.f5.com/v1alpha1"
CLASS = {
    "apiVersion": GW,
    "kind": "GatewayClass",
    "metadata": {"name": "f5"},
    "spec": {"controllerName": "f5.com/f5-bnk-f5-cne-controller"},
}



def _type_key(key: str) -> tuple[str, str]:
    if key in CANVAS_LOCAL_TYPES:
        return CANVAS_LOCAL_TYPES[key][0], CANVAS_LOCAL_TYPES[key][2]
    registered = get_resource_type(key)
    return registered.api_group, registered.kind


_KEYS = {_type_key(k): k for k in CANVAS_RESOURCE_TYPES}


def obj(api_version: str, kind: str, namespace: str, name: str, spec: dict | None = None, **extra: Any) -> dict:
    meta: dict[str, Any] = {"name": name}
    if namespace:
        meta["namespace"] = namespace
    return {"apiVersion": api_version, "kind": kind, "metadata": meta, "spec": spec or {}, **extra}


def gateway(namespace: str, name: str, listeners: list[dict] | None = None, **spec: Any) -> dict:
    listeners = listeners if listeners is not None else [{"name": "http", "port": 80, "protocol": "HTTP"}]
    return obj(GW, "Gateway", namespace, name, {"gatewayClassName": "f5", "listeners": listeners, **spec})


def service(namespace: str, name: str, port: int = 80) -> dict:
    return obj("v1", "Service", namespace, name, {"ports": [{"name": "http", "port": port}]})


def http_route(namespace: str, name: str, parent: dict, backends: list[dict] | None = None, **spec: Any) -> dict:
    rules = [{"backendRefs": backends}] if backends else []
    return obj(GW, "HTTPRoute", namespace, name, {"parentRefs": [parent], "rules": rules, **spec})


def inference_pool(namespace: str, name: str, picker: str = "", port: int = 9002) -> dict:
    spec: dict[str, Any] = {"selector": {"matchLabels": {"app": "model"}}, "targetPorts": [{"number": 8000}]}
    if picker:
        spec["endpointPickerRef"] = {"name": picker, "port": {"number": port}}
    return obj(INFERENCE, "InferencePool", namespace, name, spec)


POOL_BACKEND = {"group": "inference.networking.k8s.io", "kind": "InferencePool", "name": "pool"}
BNK_PARAMS = {"group": "k8s.f5net.com", "kind": "F5BnkGateway", "name": "params"}


def fetched(items: list[dict]) -> dict[str, Any]:
    """Shape items like fetch_all_bnk_data: every canvas resource type present, items grouped by type."""
    resources: dict[str, list[dict]] = {key: [] for key in CANVAS_RESOURCE_TYPES}
    for item in items:
        group = item["apiVersion"].rpartition("/")[0]
        resources[_KEYS[(group, item["kind"])]].append(item)
    return {"resources": resources}


def short(resource_id: str) -> str:
    """kind/namespace/name of an identity key."""
    _, _, kind, namespace, name = resource_id.split("|")
    return f"{kind}/{namespace}/{name}" if namespace else f"{kind}/{name}"


def edges_of(graph: dict, edge_type: str | None = None) -> set[tuple[str, str, str, str]]:
    return {
        (e["type"], short(e["source"]), short(e["target"]), e["status"])
        for e in graph["edges"]
        if edge_type is None or e["type"] == edge_type
    }


def rules_of(graph: dict) -> set[tuple[str, str]]:
    return {(f["rule"], short(f["resource"])) for f in graph["findings"]}


# ---------------------------------------------------------------------------
# One row per relationship rule
# ---------------------------------------------------------------------------

RULES = [
    pytest.param(
        [CLASS, gateway("shop", "gw")],
        {("class", "Gateway/shop/gw", "GatewayClass/f5", "valid")},
        set(),
        id="gateway-class",
    ),
    pytest.param(
        [
            CLASS,
            gateway(
                "shop",
                "gw",
                infrastructure={"parametersRef": {"group": "gateway.k8s.f5.com", "kind": "GatewaySettings", "name": "gs"}},
            ),
            obj(F5GW, "GatewaySettings", "shop", "gs"),
        ],
        {("configuration", "Gateway/shop/gw", "GatewaySettings/shop/gs", "valid")},
        set(),
        id="gateway-parameters-gatewaysettings",
    ),
    pytest.param(
        [
            CLASS,
            gateway(
                "shop",
                "gw",
                listeners=[
                    {
                        "name": "https",
                        "port": 443,
                        "protocol": "HTTPS",
                        "tls": {"certificateRefs": [{"name": "cert"}]},
                    }
                ],
            ),
        ],
        {("tls", "Gateway/shop/gw", "Secret/shop/cert", "unresolved")},
        set(),
        id="gateway-tls-secret-metadata-only",
    ),
    pytest.param(
        [CLASS, gateway("shop", "gw"), http_route("shop", "r", {"name": "gw", "sectionName": "http"})],
        {("parent", "HTTPRoute/shop/r", "Gateway/shop/gw", "valid")},
        set(),
        id="route-parent-section",
    ),
    pytest.param(
        [CLASS, gateway("shop", "gw"), http_route("shop", "r", {"name": "gw", "port": 8080})],
        {("parent", "HTTPRoute/shop/r", "Gateway/shop/gw", "broken")},
        {("parent-listener-not-found", "HTTPRoute/shop/r")},
        id="route-parent-port-mismatch",
    ),
    pytest.param(
        [CLASS, gateway("shop", "gw"), http_route("team", "r", {"name": "gw", "namespace": "shop"})],
        {("parent", "HTTPRoute/team/r", "Gateway/shop/gw", "broken")},
        {("listener-namespace-not-allowed", "HTTPRoute/team/r")},
        id="route-parent-namespace-same",
    ),
    pytest.param(
        [
            CLASS,
            gateway("shop", "gw", listeners=[{"name": "tcp", "port": 9000, "protocol": "TCP"}]),
            http_route("shop", "r", {"name": "gw"}),
        ],
        {("parent", "HTTPRoute/shop/r", "Gateway/shop/gw", "broken")},
        {("listener-kind-not-allowed", "HTTPRoute/shop/r")},
        id="route-parent-protocol-kind",
    ),
    pytest.param(
        [
            CLASS,
            gateway("shop", "gw", listeners=[{"name": "web", "port": 80, "protocol": "HTTP", "hostname": "*.a.example"}]),
            http_route("shop", "r", {"name": "gw"}, hostnames=["www.b.example"]),
        ],
        {("parent", "HTTPRoute/shop/r", "Gateway/shop/gw", "broken")},
        {("listener-hostname-mismatch", "HTTPRoute/shop/r")},
        id="route-parent-hostname",
    ),
    pytest.param(
        [CLASS, gateway("shop", "gw"), http_route("shop", "r", {"name": "gw"}, [{"name": "svc", "port": 80}]), service("shop", "svc")],
        {("backend", "HTTPRoute/shop/r", "Service/shop/svc", "valid")},
        set(),
        id="route-backend-service",
    ),
    pytest.param(
        [CLASS, gateway("shop", "gw"), http_route("shop", "r", {"name": "gw"}, [{"name": "svc", "port": 81}]), service("shop", "svc")],
        {("backend", "HTTPRoute/shop/r", "Service/shop/svc", "broken")},
        {("service-port-not-found", "HTTPRoute/shop/r")},
        id="route-backend-port-not-found",
    ),
    pytest.param(
        [CLASS, gateway("shop", "gw"), http_route("shop", "r", {"name": "gw"}, [{"name": "gone", "port": 80}])],
        {("backend", "HTTPRoute/shop/r", "Service/shop/gone", "broken")},
        {("unresolved-reference", "HTTPRoute/shop/r")},
        id="route-backend-missing",
    ),
    pytest.param(
        [
            CLASS,
            gateway("shop", "gw", listeners=[{"name": "http", "port": 80, "protocol": "HTTP", "allowedRoutes": {"namespaces": {"from": "All"}}}]),
            http_route("team", "r", {"name": "gw", "namespace": "shop"}, [{"name": "svc", "namespace": "shop", "port": 80}]),
            service("shop", "svc"),
        ],
        {
            ("parent", "HTTPRoute/team/r", "Gateway/shop/gw", "valid"),
            ("backend", "HTTPRoute/team/r", "Service/shop/svc", "broken"),
        },
        {("missing-reference-grant", "HTTPRoute/team/r")},
        id="route-backend-cross-namespace-without-grant",
    ),
    pytest.param(
        [
            CLASS,
            gateway("shop", "gw", listeners=[{"name": "http", "port": 80, "protocol": "HTTP", "allowedRoutes": {"namespaces": {"from": "All"}}}]),
            http_route("team", "r", {"name": "gw", "namespace": "shop"}, [{"name": "svc", "namespace": "shop", "port": 80}]),
            service("shop", "svc"),
            obj(
                "gateway.networking.k8s.io/v1beta1",
                "ReferenceGrant",
                "shop",
                "grant",
                {
                    "from": [{"group": "gateway.networking.k8s.io", "kind": "HTTPRoute", "namespace": "team"}],
                    "to": [{"group": "", "kind": "Service"}],
                },
            ),
        ],
        {
            ("backend", "HTTPRoute/team/r", "Service/shop/svc", "valid"),
            ("grant", "ReferenceGrant/shop/grant", "Service/shop/svc", "valid"),
        },
        set(),
        id="route-backend-cross-namespace-with-grant",
    ),
    pytest.param(
        [
            CLASS,
            gateway(
                "pay",
                "gw",
                listeners=[
                    {
                        "name": "tcp",
                        "port": 5432,
                        "protocol": "TCP",
                        "allowedRoutes": {"kinds": [{"group": "gateway.k8s.f5.com", "kind": "L4Route"}]},
                    }
                ],
            ),
            obj(
                "gateway.k8s.f5.com/v1",
                "L4Route",
                "pay",
                "db",
                {"parentRefs": [{"name": "gw", "sectionName": "tcp"}], "rules": [{"backendRefs": [{"name": "svc", "port": 5432}]}]},
            ),
            service("pay", "svc", 5432),
        ],
        {
            ("parent", "L4Route/pay/db", "Gateway/pay/gw", "valid"),
            ("backend", "L4Route/pay/db", "Service/pay/svc", "valid"),
        },
        set(),
        id="l4route-parent-and-backend",
    ),
    pytest.param(
        [
            CLASS,
            gateway("pay", "gw", listeners=[{"name": "tcp", "port": 5432, "protocol": "TCP"}]),
            obj(
                "gateway.k8s.f5net.com/v1",
                "L4Route",
                "pay",
                "legacy",
                {"parentRefs": [{"name": "gw"}], "rules": [{"backendRefs": [{"name": "svc", "port": 5432}]}]},
            ),
            service("pay", "svc", 5432),
        ],
        {
            ("parent", "L4Route/pay/legacy", "Gateway/pay/gw", "valid"),
            ("backend", "L4Route/pay/legacy", "Service/pay/svc", "valid"),
        },
        set(),
        id="l4route-legacy-group",
    ),
    pytest.param(
        [
            CLASS,
            gateway("shop", "gw"),
            obj(
                F5GW,
                "NetPolicy",
                "shop",
                "np",
                {
                    "targetRefs": [{"group": "gateway.networking.k8s.io", "kind": "Gateway", "name": "gw", "sectionName": "http"}],
                    "extensionRefs": [{"group": "k8s.f5net.com", "kind": "F5BigCneIrule", "name": "irule"}],
                },
            ),
            obj(F5NET, "F5BigCneIrule", "shop", "irule"),
        ],
        {
            ("policy", "NetPolicy/shop/np", "Gateway/shop/gw", "valid"),
            ("configuration", "NetPolicy/shop/np", "F5BigCneIrule/shop/irule", "valid"),
        },
        set(),
        id="netpolicy-target-and-irule",
    ),
    pytest.param(
        [
            CLASS,
            gateway("shop", "gw"),
            obj(F5GW, "NetPolicy", "shop", "np", {"targetRefs": [{"kind": "Gateway", "name": "gw", "sectionName": "grpc"}]}),
        ],
        {("policy", "NetPolicy/shop/np", "Gateway/shop/gw", "broken")},
        {("policy-section-not-found", "NetPolicy/shop/np")},
        id="netpolicy-section-not-found",
    ),
    pytest.param(
        [
            CLASS,
            gateway("shop", "gw"),
            obj(
                F5GW,
                "SecPolicy",
                "shop",
                "sp",
                {
                    "targetRefs": [{"kind": "Gateway", "name": "gw"}],
                    "extensionRefs": [{"kind": "F5BigFwPolicy", "name": "fw"}, {"kind": "F5BigLogProfile", "name": "log"}],
                },
            ),
            obj(F5NET, "F5BigFwPolicy", "shop", "fw"),
        ],
        {
            ("policy", "SecPolicy/shop/sp", "Gateway/shop/gw", "valid"),
            ("configuration", "SecPolicy/shop/sp", "F5BigFwPolicy/shop/fw", "valid"),
            ("configuration", "SecPolicy/shop/sp", "F5BigLogProfile/shop/log", "broken"),
        },
        {("unresolved-reference", "SecPolicy/shop/sp")},
        id="secpolicy-firewall-and-missing-log-profile",
    ),
    pytest.param(
        [
            CLASS,
            gateway("edge", "gw"),
            obj(F5GW, "SecPolicy", "sec", "sp", {"targetRefs": [{"kind": "Gateway", "name": "gw", "namespace": "edge"}]}),
        ],
        {("policy", "SecPolicy/sec/sp", "Gateway/edge/gw", "valid")},
        set(),
        id="secpolicy-declared-namespace",
    ),
    pytest.param(
        [
            CLASS,
            gateway("shop", "gw"),
            obj(
                "gateway.k8s.f5net.com/v1alpha1",
                "BNKNetPolicy",
                "shop",
                "legacy",
                {"targetRefs": [{"group": "gateway.networking.k8s.io", "kind": "Gateway", "name": "gw"}]},
            ),
        ],
        {("policy", "BNKNetPolicy/shop/legacy", "Gateway/shop/gw", "valid")},
        set(),
        id="legacy-bnknetpolicy-target",
    ),
    pytest.param(
        [
            CLASS,
            obj(
                F5GW,
                "EgressGateway",
                "apps",
                "egw",
                {"gatewayClassName": "f5", "infrastructure": {"parametersRef": {"name": "gs", "sectionName": "out"}}},
            ),
            obj(F5GW, "GatewaySettings", "apps", "gs", {"egressConfigs": [{"name": "out"}]}),
        ],
        {
            ("class", "EgressGateway/apps/egw", "GatewayClass/f5", "valid"),
            ("configuration", "EgressGateway/apps/egw", "GatewaySettings/apps/gs", "valid"),
        },
        set(),
        id="egressgateway-class-and-params",
    ),
    pytest.param(
        [
            CLASS,
            obj(F5GW, "EgressGateway", "apps", "egw", {"infrastructure": {"parametersRef": {"name": "gs", "sectionName": "nope"}}}),
            obj(F5GW, "GatewaySettings", "apps", "gs", {"egressConfigs": [{"name": "out"}]}),
        ],
        {("configuration", "EgressGateway/apps/egw", "GatewaySettings/apps/gs", "broken")},
        {("egress-config-not-found", "EgressGateway/apps/egw")},
        id="egressgateway-section-not-found",
    ),
    pytest.param(
        [
            obj(
                "k8s.f5.com/v1",
                "CNEInstance",
                "f5-bnk",
                "bnk",
                {"certificate": {"clusterIssuer": "ca"}, "registry": {"imagePullSecrets": [{"name": "pull"}]}},
            ),
        ],
        {
            ("tls", "CNEInstance/f5-bnk/bnk", "ClusterIssuer/ca", "unresolved"),
            ("authentication", "CNEInstance/f5-bnk/bnk", "Secret/f5-bnk/pull", "unresolved"),
        },
        {("reference-not-inspected", "CNEInstance/f5-bnk/bnk")},
        id="cneinstance-issuer-and-pull-secret",
    ),
    pytest.param(
        [obj("k8s.f5.com/v1", "CNEInstance", "f5-bnk", "bnk", {"registry": {"imagePullSecrets": {"name": "pull"}}})],
        {("authentication", "CNEInstance/f5-bnk/bnk", "Secret/f5-bnk/pull", "unresolved")},
        set(),
        id="cneinstance-single-pull-secret-object",
    ),
    pytest.param(
        [
            obj(F5GW, "GatewaySettings", "shop", "gs", {"ingressConfig": {"defaultListenerNetwork": {"ipamRefs": [{"name": "pool"}]}}}),
            obj(F5GW, "Infra", "f5-utils", "infra", {"ipams": [{"name": "pool"}]}),
        ],
        {("configuration", "GatewaySettings/shop/gs", "Infra/f5-utils/infra", "valid")},
        set(),
        id="gatewaysettings-infra-entry",
    ),
    pytest.param(
        [
            obj(F5GW, "GatewaySettings", "shop", "gs", {"sourceNATPools": [{"name": "snat", "ipamRefs": [{"name": "nope"}]}]}),
            obj(F5GW, "Infra", "f5-utils", "infra", {"ipams": [{"name": "pool"}]}),
        ],
        {("configuration", "GatewaySettings/shop/gs", "Infra/f5-utils/infra", "broken")},
        {("infra-entry-not-found", "GatewaySettings/shop/gs")},
        id="gatewaysettings-infra-entry-missing",
    ),
    pytest.param(
        [obj(F5GW, "GatewaySettings", "shop", "gs", {"ingressConfig": {"defaultListenerNetwork": {"ipamRefs": [{"name": "pool"}]}}})],
        set(),
        {("infra-not-found", "GatewaySettings/shop/gs")},
        id="gatewaysettings-without-infra",
    ),
    pytest.param(
        [
            obj(
                "k8s.f5net.com/v3",
                "F5SPKEgress",
                "f5-bnk",
                "egress",
                {"egressSnatpool": "snat-a", "pseudoCNIConfig": {"vxlan": {"tmmInterfaceName": "internal"}}},
            ),
            obj(F5NET, "F5SPKSnatpool", "f5-bnk", "pool-object", {"name": "snat-a"}),
            obj(F5NET, "F5SPKVlan", "f5-bnk", "vlan-object", {"name": "internal"}),
        ],
        {
            ("configuration", "F5SPKEgress/f5-bnk/egress", "F5SPKSnatpool/f5-bnk/pool-object", "valid"),
            ("network", "F5SPKEgress/f5-bnk/egress", "F5SPKVlan/f5-bnk/vlan-object", "valid"),
        },
        set(),
        id="egress-snatpool-and-vlan-by-spec-name",
    ),
    pytest.param(
        [obj("k8s.f5net.com/v3", "F5SPKEgress", "f5-bnk", "egress", {"egressSnatpool": "later"})],
        {("configuration", "F5SPKEgress/f5-bnk/egress", "F5SPKSnatpool/f5-bnk/later", "unresolved")},
        {("soft-reference-absent", "F5SPKEgress/f5-bnk/egress")},
        id="egress-snatpool-soft-missing",
    ),
    pytest.param(
        [
            obj(
                F5NET,
                "F5BigFwPolicy",
                "shop",
                "fw",
                {"rule": [{"source": {"addressLists": ["nets"]}, "destination": {"portLists": ["ports"]}}]},
            ),
            obj(F5NET, "F5BigCneAddresslist", "shop", "nets"),
            obj(F5NET, "F5BigCnePortlist", "shop", "ports"),
        ],
        {
            ("configuration", "F5BigFwPolicy/shop/fw", "F5BigCneAddresslist/shop/nets", "valid"),
            ("configuration", "F5BigFwPolicy/shop/fw", "F5BigCnePortlist/shop/ports", "valid"),
        },
        set(),
        id="firewall-address-and-port-lists",
    ),
    pytest.param(
        [
            CLASS,
            gateway("ai", "gw"),
            http_route("ai", "r", {"name": "gw"}, [POOL_BACKEND]),
            inference_pool("ai", "pool", picker="pool-epp"),
            service("ai", "pool-epp", 9002),
        ],
        {
            ("backend", "HTTPRoute/ai/r", "InferencePool/ai/pool", "valid"),
            ("endpoint-picker", "InferencePool/ai/pool", "Service/ai/pool-epp", "valid"),
        },
        set(),
        id="inferencepool-endpoint-picker",
    ),
    pytest.param(
        [
            CLASS,
            gateway("ai", "gw"),
            http_route("ai", "r", {"name": "gw"}, [POOL_BACKEND]),
            inference_pool("ai", "pool", picker="pool-epp"),
        ],
        {("endpoint-picker", "InferencePool/ai/pool", "Service/ai/pool-epp", "broken")},
        {("unresolved-reference", "InferencePool/ai/pool")},
        id="inferencepool-endpoint-picker-missing",
    ),
    pytest.param(
        [
            CLASS,
            gateway("ai", "gw"),
            http_route("ai", "r", {"name": "gw"}, [POOL_BACKEND]),
            inference_pool("ai", "pool", picker="pool-epp", port=9003),
            service("ai", "pool-epp", 9002),
        ],
        {("endpoint-picker", "InferencePool/ai/pool", "Service/ai/pool-epp", "broken")},
        {("service-port-not-found", "InferencePool/ai/pool")},
        id="inferencepool-endpoint-picker-wrong-port",
    ),
    pytest.param(
        [
            inference_pool("ai", "pool"),
            obj(F5_INFERENCE, "F5EPP", "ai", "epp", {"poolRef": {"group": "inference.networking.k8s.io", "kind": "InferencePool", "name": "pool"}}),
        ],
        {("configuration", "F5EPP/ai/epp", "InferencePool/ai/pool", "valid")},
        set(),
        id="f5epp-pool",
    ),
    pytest.param(
        [obj(F5_INFERENCE, "F5EPP", "ai", "epp", {"poolRef": {"name": "gone"}})],
        {("configuration", "F5EPP/ai/epp", "InferencePool/ai/gone", "broken")},
        {("unresolved-reference", "F5EPP/ai/epp")},
        id="f5epp-pool-missing",
    ),
    pytest.param(
        [CLASS, gateway("ai", "gw", infrastructure={"parametersRef": BNK_PARAMS}), obj(F5NET, "F5BnkGateway", "ai", "params")],
        {("configuration", "Gateway/ai/gw", "F5BnkGateway/ai/params", "valid")},
        set(),
        id="gateway-parameters-f5bnkgateway",
    ),
    pytest.param(
        [CLASS, gateway("ai", "gw", infrastructure={"parametersRef": BNK_PARAMS})],
        {("configuration", "Gateway/ai/gw", "F5BnkGateway/ai/params", "broken")},
        {("unresolved-reference", "Gateway/ai/gw")},
        id="gateway-parameters-f5bnkgateway-missing",
    ),
]


@pytest.mark.parametrize(("items", "expected_edges", "expected_findings"), RULES)
def test_rule_drawsExactEdgesAndFindings(items, expected_edges, expected_findings):
    graph = build_canvas_graph(fetched(items))
    assert expected_edges <= edges_of(graph)
    errors = {(rule, resource) for rule, resource in rules_of(graph) if rule != "listener-no-routes"}
    assert expected_findings <= errors
    # Rows that expect no finding expect no error.
    if not expected_findings:
        assert not [f for f in graph["findings"] if f["severity"] == "error"]


def test_policyMatching_isNamespaceScoped_forSameNameGateways():
    """The Forge tree matches policies by Gateway name; the Canvas matches namespace and name."""
    items = [
        CLASS,
        gateway("shop", "edge-gw"),
        gateway("payments", "edge-gw"),
        obj(F5GW, "SecPolicy", "shop", "shop-sec", {"targetRefs": [{"kind": "Gateway", "name": "edge-gw"}]}),
        obj(F5GW, "NetPolicy", "payments", "pay-net", {"targetRefs": [{"kind": "Gateway", "name": "edge-gw"}]}),
    ]
    policies = edges_of(build_canvas_graph(fetched(items)), "policy")
    assert policies == {
        ("policy", "SecPolicy/shop/shop-sec", "Gateway/shop/edge-gw", "valid"),
        ("policy", "NetPolicy/payments/pay-net", "Gateway/payments/edge-gw", "valid"),
    }


def _other_controller_items() -> list[dict]:
    other = obj(GW, "GatewayClass", "", "other", {"controllerName": "example.com/other"})
    return [
        CLASS,
        other,
        gateway("shop", "gw"),
        obj(GW, "Gateway", "team", "other-gw", {"gatewayClassName": "other", "listeners": [{"name": "h", "port": 80, "protocol": "HTTP"}]}),
        http_route("team", "other-route", {"name": "other-gw"}, [{"name": "other-svc", "port": 80}]),
        service("team", "other-svc"),
        service("shop", "unused"),
    ]


def test_scope_bnk_leavesOutOtherControllersAndUnreferencedServices():
    ids = {short(r["id"]) for r in build_canvas_graph(fetched(_other_controller_items()), controllers="bnk")["resources"]}
    assert ids == {"GatewayClass/f5", "Gateway/shop/gw"}


def test_scope_all_drawsOtherControllersBesideBigIpNext():
    """The default: every Gateway and what its routes reach, so controllers can run side by side."""
    graph = build_canvas_graph(fetched(_other_controller_items()))
    assert {short(r["id"]) for r in graph["resources"]} == {
        "GatewayClass/f5",
        "GatewayClass/other",
        "Gateway/shop/gw",
        "Gateway/team/other-gw",
        "HTTPRoute/team/other-route",
        "Service/team/other-svc",
    }
    assert ("backend", "HTTPRoute/team/other-route", "Service/team/other-svc", "valid") in edges_of(graph)


def test_scope_rejectsUnknownControllers():
    with pytest.raises(ValueError):
        build_canvas_graph(fetched([CLASS]), controllers="istio")


def test_inferencePool_conditionsAggregateParents_andFacts():
    pool = inference_pool("ai", "pool", picker="epp")
    ok = {"type": "Accepted", "status": "True"}
    pool["status"] = {
        "parents": [
            {"parentRef": {"name": "a"}, "conditions": [ok, {"type": "ResolvedRefs", "status": "True"}]},
            {"parentRef": {"name": "b"}, "conditions": [ok, {"type": "ResolvedRefs", "status": "False"}]},
        ]
    }
    items = [CLASS, gateway("ai", "gw"), http_route("ai", "r", {"name": "gw"}, [POOL_BACKEND]), pool, service("ai", "epp", 9002)]
    card = next(r for r in build_canvas_graph(fetched(items))["resources"] if r["kind"] == "InferencePool")
    assert card["conditions"] == {"Accepted": "True", "ResolvedRefs": "False"}
    assert {"label": "selector", "value": "app=model"} in card["facts"]
    assert {"label": "target ports", "value": "8000"} in card["facts"]


def test_f5BnkGateway_notListed_isNotInspected():
    """If the Canvas could not list F5BnkGateways (CRD absent or forbidden), a reference to one is not broken."""
    data = fetched([CLASS, gateway("ai", "gw", infrastructure={"parametersRef": BNK_PARAMS})])
    del data["resources"]["f5bnkgateway"]
    graph = build_canvas_graph(data)
    assert ("configuration", "Gateway/ai/gw", "F5BnkGateway/ai/params", "unresolved") in edges_of(graph)
    assert ("reference-not-inspected", "Gateway/ai/gw") in rules_of(graph)


def test_secrets_areReferencesOnly_neverData():
    items = [
        CLASS,
        gateway("shop", "gw", listeners=[{"name": "https", "port": 443, "protocol": "HTTPS", "tls": {"certificateRefs": [{"name": "c"}]}}]),
    ]
    data = fetched(items)
    # Even if a Secret reached the fetch dict, the Canvas would neither read nor return it.
    data["resources"]["secret"] = [{"apiVersion": "v1", "kind": "Secret", "metadata": {"name": "c", "namespace": "shop"}, "data": {"tls.key": "c2VjcmV0"}}]
    graph = build_canvas_graph(data)
    secret = next(r for r in graph["resources"] if r["kind"] == "Secret")
    assert secret["placeholder"] is True and secret["facts"] == [] and secret["resourceType"] is None
    assert "c2VjcmV0" not in json.dumps(graph)


def test_coreServices_inSnakeCaseFromTheKubernetesClient_areRead():
    snake_service = {
        "api_version": "v1",
        "kind": "Service",
        "metadata": {"name": "svc", "namespace": "shop"},
        "spec": {"ports": [{"name": "http", "port": 80, "target_port": 8080}], "type": "ClusterIP"},
    }
    data = fetched([CLASS, gateway("shop", "gw"), http_route("shop", "r", {"name": "gw"}, [{"name": "svc", "port": 80}])])
    data["resources"]["service"] = [snake_service]
    graph = build_canvas_graph(data)
    assert ("backend", "HTTPRoute/shop/r", "Service/shop/svc", "valid") in edges_of(graph)
    svc = next(r for r in graph["resources"] if r["kind"] == "Service")
    assert {"label": "port", "value": "http 80→8080"} in svc["facts"]


def test_namespaceFilter_reportsCrossNamespaceTargetsUnresolved():
    items = [CLASS, http_route("team", "r", {"name": "gw", "namespace": "shop"})]
    graph = build_canvas_graph(fetched(items), namespace="team")
    assert ("parent", "HTTPRoute/team/r", "Gateway/shop/gw", "unresolved") in edges_of(graph)
    assert not [f for f in graph["findings"] if f["severity"] == "error"]
    assert graph["warnings"]


def test_listenerWithoutRoutes_isNoted():
    items = [CLASS, gateway("shop", "gw", listeners=[{"name": "a", "port": 80, "protocol": "HTTP"}, {"name": "b", "port": 81, "protocol": "HTTP"}]), http_route("shop", "r", {"name": "gw", "sectionName": "a"})]
    assert ("listener-no-routes", "Gateway/shop/gw") in rules_of(build_canvas_graph(fetched(items)))


def test_edgeLabels_carrySectionMatchesAndWeights():
    items = [
        CLASS,
        gateway("shop", "gw"),
        obj(
            GW,
            "HTTPRoute",
            "shop",
            "r",
            {
                "parentRefs": [{"name": "gw"}],
                "rules": [
                    {
                        "matches": [{"path": {"type": "PathPrefix", "value": "/api"}}],
                        "backendRefs": [{"name": "a", "port": 80, "weight": 3}, {"name": "b", "port": 80, "weight": 1}],
                    }
                ],
            },
        ),
        service("shop", "a"),
        service("shop", "b"),
    ]
    labels = {(e["type"], short(e["target"])): e["label"] for e in build_canvas_graph(fetched(items))["edges"]}
    assert labels[("parent", "Gateway/shop/gw")] == "http"
    assert labels[("backend", "Service/shop/a")] == "/api · 75%"
    assert labels[("backend", "Service/shop/b")] == "/api · 25%"


def test_partialFetch_addsWarning():
    data = fetched([CLASS])
    data["partial"] = True
    assert build_canvas_graph(data)["warnings"]


# ---------------------------------------------------------------------------
# Golden: the anonymized sample cluster
# ---------------------------------------------------------------------------


def test_sampleCluster_matchesGolden():
    items = [i for i in yaml.safe_load((FIXTURES / "sample_cluster.yaml").read_text())["items"] if i["kind"] != "Namespace"]
    graph = build_canvas_graph(fetched(items))
    BnkCanvasResponse.model_validate({**graph, "generatedAt": "2026-01-01T00:00:00+00:00", "cluster_id": 1})
    golden = FIXTURES / "sample_cluster.golden.json"
    rendered = json.dumps(graph, indent=1, sort_keys=True) + "\n"
    if os.environ.get("UPDATE_GOLDEN") == "1":
        golden.write_text(rendered)
    assert rendered == golden.read_text()
