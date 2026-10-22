"""Tests for BNK 2.4.1 AI Gateway Governance, CRD Registry, and Dependency Fabric Topology."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from core.k8s_resource_registry import RESOURCE_REGISTRY, get_resource_type
from core.k8s_types import ApiGroups
from schemas.llm_observability import (
    AiModelDeploymentItem,
    CreateAiGatewayRouteRequest,
    CreateAiModelRequest,
    CreateAiProviderRequest,
    CreateAiTenantRequest,
    CreateGovernanceOrgRequest,
    CreateGovernancePrincipalRequest,
    CreateGovernanceTeamRequest,
    GatewayInferenceTestRequest,
    IssueVirtualKeyRequest,
    RemediateAiGatewayRequest,
    UpdateAiGatewayRoutePoliciesRequest,
)
from services.ai_gateway_governance_service import AiGatewayGovernanceService
from services.topology_builder_service import _assemble_custom_fabric_topology


def test_bnk_241_crd_registry_entries():
    """Verify BNK 2.4.1 AI Gateway, AppPolicy, Metrics, and GA v1 GSLB CRDs are registered."""
    assert ApiGroups.F5_INFERENCE == "inference.k8s.f5.com"
    assert ApiGroups.F5_METRICS == "metrics.f5.com"

    # AI Gateway CRDs (inference.k8s.f5.com/v1alpha1)
    tenant_cfg = get_resource_type("aitenant")
    assert tenant_cfg is not None
    assert tenant_cfg.api_group == "inference.k8s.f5.com"
    assert tenant_cfg.api_version == "v1alpha1"
    assert tenant_cfg.plural == "aitenants"
    assert tenant_cfg.namespaced is False

    for kind_key, plural in [
        ("aicredential", "aicredentials"),
        ("aiprovider", "aiproviders"),
        ("aimodel", "aimodels"),
        ("aigatewayprofile", "aigatewayprofiles"),
        ("aigateway", "aigateways"),
    ]:
        cfg = get_resource_type(kind_key)
        assert cfg is not None, f"Missing {kind_key}"
        assert cfg.api_group == "inference.k8s.f5.com"
        assert cfg.api_version == "v1alpha1"
        assert cfg.plural == plural
        assert cfg.namespaced is True

    # AppPolicy (gateway.k8s.f5.com/v1alpha1)
    app_policy_cfg = get_resource_type("apppolicy")
    assert app_policy_cfg is not None
    assert app_policy_cfg.api_group == "gateway.k8s.f5.com"
    assert app_policy_cfg.plural == "apppolicies"

    # BNK 2.4.1 Renamed Metric Scraping CRDs (metrics.f5.com/v1alpha1)
    for kind_key, plural in [
        ("scrapetemplate", "scrapetemplates"),
        ("scrapeclass", "scrapeclasses"),
        ("scrape", "scrapes"),
    ]:
        cfg = get_resource_type(kind_key)
        assert cfg is not None
        assert cfg.api_group == "metrics.f5.com"
        assert cfg.plural == plural

    # BNK 2.4.1 GA v1 GSLB & F5BigDnsCache CRDs
    for kind_key in [
        "f5bigdnscache",
        "f5biggslbinstance",
        "f5biggslbzone",
        "f5biggslbpool",
        "f5biggslbwideip",
    ]:
        cfg = get_resource_type(kind_key)
        assert cfg is not None
        assert cfg.api_version == "v1"
        assert kind_key in RESOURCE_REGISTRY


def test_dependency_fabric_cross_crd_assembly():
    """Verify _assemble_custom_fabric_topology links AI Gateway, CNF, GSLB, CGNAT, and Telemetry CRDs."""
    nodes = []
    edges = []

    custom_resources = {
        "gateway": [
            {
                "metadata": {"name": "ai-edge-gw", "namespace": "default"},
                "spec": {"addresses": [{"value": "10.10.20.90"}]},
                "status": {"conditions": [{"type": "Programmed", "status": "True"}]},
            }
        ],
        "httproute": [
            {
                "metadata": {"name": "ai-edge-route", "namespace": "default"},
                "spec": {
                    "parentRefs": [{"name": "ai-edge-gw"}],
                    "rules": [{"backendRefs": [{"name": "vllm-svc"}]}],
                },
            }
        ],
        "apppolicy": [
            {
                "metadata": {"name": "ai-edge-apppolicy", "namespace": "default"},
                "spec": {
                    "targetRefs": [{"kind": "Gateway", "name": "ai-edge-gw"}],
                    "extensionRefs": [{"kind": "AIGatewayProfile", "name": "ai-edge-profile"}],
                },
            }
        ],
        "aigatewayprofile": [
            {
                "metadata": {"name": "ai-edge-profile", "namespace": "default"},
                "spec": {
                    "tenantRef": {"name": "enterprise-ai"},
                    "providers": [{"providerRef": {"name": "openai-primary"}}],
                    "modelRouting": {"defaultModelRef": {"name": "gpt-4o"}},
                },
                "status": {"conditions": [{"type": "Programmed", "status": "True"}]},
            }
        ],
        "aitenant": [{"metadata": {"name": "enterprise-ai"}}],
        "aimodel": [
            {
                "metadata": {"name": "gpt-4o", "namespace": "default"},
                "spec": {
                    "tenantRef": {"name": "enterprise-ai"},
                    "deployments": [{"providerRef": {"name": "openai-primary"}, "weight": 80}],
                },
            }
        ],
        "aiprovider": [
            {
                "metadata": {"name": "openai-primary", "namespace": "default"},
                "spec": {
                    "tenantRef": {"name": "enterprise-ai"},
                    "credentialRef": {"name": "openai-cred"},
                    "openAI": {"baseURL": "https://api.openai.com/v1"},
                },
            }
        ],
        "aicredential": [
            {
                "metadata": {"name": "openai-cred", "namespace": "default"},
                "spec": {
                    "tenantRef": {"name": "enterprise-ai"},
                    "secretRef": {"name": "openai-api-secret"},
                },
            }
        ],
        "secret": [
            {
                "metadata": {"name": "openai-api-secret", "namespace": "default"},
                "type": "Opaque",
            }
        ],
        "f5biggslbzone": [
            {
                "metadata": {"name": "ai-global-zone", "namespace": "default"},
                "spec": {"wideIps": [{"name": "ai-global-wideip"}]},
            }
        ],
        "f5biggslbwideip": [
            {
                "metadata": {"name": "ai-global-wideip", "namespace": "default"},
                "spec": {"pools": [{"name": "ai-global-pool"}]},
            }
        ],
        "f5biggslbpool": [{"metadata": {"name": "ai-global-pool", "namespace": "default"}}],
        "f5bigcgnat": [
            {
                "metadata": {"name": "carrier-cgnat", "namespace": "default"},
                "spec": {"natPool": "egress-nat-pool"},
            }
        ],
        "f5bignatpool": [{"metadata": {"name": "egress-nat-pool", "namespace": "default"}}],
        "cneinstance": [{"metadata": {"name": "tmm-cne", "namespace": "default"}, "spec": {"vlans": ["ext-vlan"]}}],
        "f5spkvlan": [{"metadata": {"name": "ext-vlan", "namespace": "default"}}],
        "f5spkstaticroute": [{"metadata": {"name": "llm-egress-route", "namespace": "default"}}],
        "scrape": [
            {
                "metadata": {"name": "tmm-scrape", "namespace": "default"},
                "spec": {"scrapeClassName": "tmm-scrape-class"},
            }
        ],
        "scrapeclass": [
            {
                "metadata": {"name": "tmm-scrape-class", "namespace": "default"},
                "spec": {"scrapeTemplateName": "tmm-scrape-tpl"},
            }
        ],
        "scrapetemplate": [{"metadata": {"name": "tmm-scrape-tpl", "namespace": "default"}}],
    }

    _assemble_custom_fabric_topology(
        custom_resources=custom_resources,
        namespace="default",
        nodes=nodes,
        edges=edges,
    )

    node_ids = {n.id for n in nodes}
    assert "Gateway/default/ai-edge-gw" in node_ids
    assert "HTTPRoute/default/ai-edge-route" in node_ids
    assert "AppPolicy/default/ai-edge-apppolicy" in node_ids
    assert "AIGatewayProfile/default/ai-edge-profile" in node_ids
    assert "AITenant/cluster/enterprise-ai" in node_ids
    assert "AIModel/default/gpt-4o" in node_ids
    assert "AIProvider/default/openai-primary" in node_ids
    assert "AICredential/default/openai-cred" in node_ids
    assert "Secret/default/openai-api-secret" in node_ids
    assert "F5BigGslbZone/default/ai-global-zone" in node_ids
    assert "F5BigGslbWideip/default/ai-global-wideip" in node_ids
    assert "F5BigGslbPool/default/ai-global-pool" in node_ids
    assert "F5BigCgnat/default/carrier-cgnat" in node_ids
    assert "F5BigNatPool/default/egress-nat-pool" in node_ids
    assert "Scrape/default/tmm-scrape" in node_ids
    assert "ScrapeClass/default/tmm-scrape-class" in node_ids
    assert "ScrapeTemplate/default/tmm-scrape-tpl" in node_ids

    edge_pairs = {(e.source, e.target, e.kind) for e in edges}
    assert (
        "AppPolicy/default/ai-edge-apppolicy",
        "Gateway/default/ai-edge-gw",
        "attaches",
    ) in edge_pairs
    assert (
        "AppPolicy/default/ai-edge-apppolicy",
        "AIGatewayProfile/default/ai-edge-profile",
        "attaches",
    ) in edge_pairs
    assert (
        "AIModel/default/gpt-4o",
        "AIProvider/default/openai-primary",
        "references",
    ) in edge_pairs
    assert (
        "AICredential/default/openai-cred",
        "Secret/default/openai-api-secret",
        "references",
    ) in edge_pairs
    assert (
        "F5BigGslbZone/default/ai-global-zone",
        "F5BigGslbWideip/default/ai-global-wideip",
        "routes",
    ) in edge_pairs
    assert (
        "F5BigCgnat/default/carrier-cgnat",
        "F5BigNatPool/default/egress-nat-pool",
        "references",
    ) in edge_pairs
    assert (
        "CNEInstance/default/tmm-cne",
        "F5SPKStaticRoute/default/llm-egress-route",
        "routes",
    ) in edge_pairs
    assert (
        "Scrape/default/tmm-scrape",
        "ScrapeClass/default/tmm-scrape-class",
        "references",
    ) in edge_pairs
    assert (
        "ScrapeClass/default/tmm-scrape-class",
        "ScrapeTemplate/default/tmm-scrape-tpl",
        "references",
    ) in edge_pairs


def test_ai_gateway_governance_service_end_to_end():
    """Verify multi-cluster AI Gateway & DSSM Governance CRUD, /v1 normalization, and remediation."""
    db_mock = MagicMock()
    db_mock.query.return_value.filter.return_value.all.return_value = []
    db_mock.query.return_value.all.return_value = []

    svc = AiGatewayGovernanceService(db=db_mock)

    # 1. Overview starts with zero pre-seeded dummy data when nothing is deployed on cluster
    overview = svc.overview(cluster_id=1)
    assert len(overview.tenants) == 0
    assert len(overview.providers) == 0
    assert len(overview.models) == 0
    assert len(overview.routes) == 0
    assert len(overview.orgs) == 0
    assert len(overview.teams) == 0
    assert len(overview.principals) == 0
    assert len(overview.virtual_keys) == 0
    assert len(overview.readiness_checks) >= 4
    assert len(overview.topology_nodes) == 0
    assert len(overview.topology_edges) == 0
    assert len(overview.request_audit_logs) == 0

    # 2. Create AITenant
    tenant_res = svc.create_tenant(
        CreateAiTenantRequest(
            cluster_id=1,
            name="telco-ai-tenant",
            display_name="Telco AI Tenant",
        )
    )
    assert tenant_res.status == "success"
    assert tenant_res.entity["name"] == "telco-ai-tenant"

    # 3. Create AIProvider with Generic type automatically normalizes /v1 suffix
    provider_res = svc.create_provider(
        CreateAiProviderRequest(
            cluster_id=1,
            name="vllm-cluster-pool",
            namespace="f5-bnk",
            tenant="telco-ai-tenant",
            vendor="Generic",
            base_url="http://vllm.default.svc.cluster.local:8000",
            api_key="sk-test-1234",
        )
    )
    assert provider_res.status == "success"
    assert provider_res.entity["name"] == "vllm-cluster-pool"
    assert provider_res.entity["base_url"] == "http://vllm.default.svc.cluster.local:8000/v1"
    assert "generic:" in provider_res.applied_yaml

    # Verify OpenAI vendor uses openAI: block in generated YAML
    openai_prov_res = svc.create_provider(
        CreateAiProviderRequest(
            cluster_id=1,
            name="openai-telco",
            namespace="f5-bnk",
            tenant="telco-ai-tenant",
            vendor="OpenAI",
            base_url="https://api.openai.com/v1",
            api_key="sk-openai-test",
        )
    )
    assert "openAI:" in openai_prov_res.applied_yaml

    # 4. Create AIModel with weighted deployments & micro-USD pricing
    model_res = svc.create_model(
        CreateAiModelRequest(
            cluster_id=1,
            name="llama-3-3-70b",
            public_name="meta-llama/Llama-3.3-70B-Instruct",
            namespace="f5-bnk",
            tenant="telco-ai-tenant",
            deployments=[
                AiModelDeploymentItem(
                    name="vllm-primary",
                    provider="vllm-cluster-pool",
                    upstream="meta-llama/Llama-3.3-70B-Instruct",
                    weight=80,
                    input_per_mtok=400000,
                    output_per_mtok=800000,
                ),
                AiModelDeploymentItem(
                    name="openai-fallback",
                    provider="openai-telco",
                    upstream="gpt-4o",
                    weight=20,
                    input_per_mtok=2500000,
                    output_per_mtok=10000000,
                ),
            ],
        )
    )
    assert model_res.status == "success"
    assert model_res.entity["name"] == "llama-3-3-70b"
    assert model_res.entity["deployments"][0]["weight"] == 80

    # 5. Create Gateway Route with BNK 2.4.1 Semantic Cache connection pooling
    route_res = svc.create_route(
        CreateAiGatewayRouteRequest(
            cluster_id=1,
            name="telco-llm-edge",
            namespace="f5-bnk",
            gateway_name="telco-llm-gw",
            vip_address="10.20.30.40",
            listener_port=8080,
            tenant="telco-ai-tenant",
            prompt_cache_enabled=True,
            semantic_cache_pool_max_size=128,
            semantic_cache_pool_idle_timeout="600s",
        )
    )
    assert route_res.status == "success"
    assert route_res.entity["name"] == "telco-llm-edge"
    assert route_res.entity["semantic_cache_pool_max_size"] == 128
    assert route_res.entity["semantic_cache_pool_idle_timeout"] == "600s"
    assert "backendRequest: 300s" in route_res.applied_yaml

    # BNK 2.4.1 Rule: "The listener chooses the tenant" — reject binding another tenant to same gateway:port
    with pytest.raises(ValueError, match="listener chooses the tenant"):
        svc.create_route(
            CreateAiGatewayRouteRequest(
                cluster_id=1,
                name="conflicting-tenant-route",
                namespace="f5-bnk",
                gateway_name="telco-llm-gw",
                vip_address="10.20.30.40",
                listener_port=8080,
                tenant="enterprise-ai",
            )
        )

    # Toggle route policies in-place
    policy_res = svc.update_route_policies(
        "telco-llm-edge",
        UpdateAiGatewayRoutePoliciesRequest(
            cluster_id=1,
            failover_enabled=False,
            semantic_cache_enabled=True,
            model_routing_enabled=False,
        ),
    )
    assert policy_res.entity["failover_enabled"] is False
    assert policy_res.entity["model_routing_enabled"] is False

    # Re-enable failover and model routing for live gateway testing
    svc.update_route_policies(
        "telco-llm-edge",
        UpdateAiGatewayRoutePoliciesRequest(
            cluster_id=1,
            failover_enabled=True,
            semantic_cache_enabled=True,
            model_routing_enabled=True,
        ),
    )

    # 6. DSSM Org, Team, Principal, and Virtual Key lifecycle
    org_res = svc.create_org(CreateGovernanceOrgRequest(cluster_id=1, tenant="telco-ai-tenant", name="Core Network AI"))
    team_res = svc.create_team(
        CreateGovernanceTeamRequest(
            cluster_id=1,
            tenant="telco-ai-tenant",
            name="RAN Copilots",
            org_id=org_res.entity["id"],
        )
    )
    principal_res = svc.create_principal(
        CreateGovernancePrincipalRequest(
            cluster_id=1,
            tenant="telco-ai-tenant",
            name="ran-remediation-agent",
            kind="agent",
            team_id=team_res.entity["id"],
        )
    )
    vk_res = svc.issue_virtual_key(
        IssueVirtualKeyRequest(
            cluster_id=1,
            tenant="telco-ai-tenant",
            name="ran-agent-prod-key",
            principal_id=principal_res.entity["id"],
            allowed_models=["meta-llama/Llama-3.3-70B-Instruct", "gpt-4o"],
        )
    )
    assert vk_res.status == "success"
    assert vk_res.entity["raw_key"] is not None
    assert vk_res.entity["raw_key"].startswith("f5vk_")
    assert vk_res.entity["status"] == "active"
    assert vk_res.entity["principal_type"] == "agent"
    assert vk_res.entity["team_name"] == "RAN Copilots"
    assert vk_res.entity["org_name"] == "Core Network AI"
    assert vk_res.entity["spend_to_date_usd"] == 0.0

    # Rotate Virtual Key in-place
    rotated_res = svc.rotate_virtual_key(vk_res.entity["id"], cluster_id=1)
    assert rotated_res.status == "success"
    assert rotated_res.cleartext_key is not None
    assert rotated_res.cleartext_key != vk_res.cleartext_key

    # 7. Polaris Step 8: Live Gateway Inference & Policy Tester
    # Missing /v1 prefix returns 404 diagnostic
    bad_path_test = svc.test_gateway_request(
        GatewayInferenceTestRequest(
            cluster_id=1,
            route_name="telco-llm-edge",
            model_id="meta-llama/Llama-3.3-70B-Instruct",
            prompt="Check BNK 2.4.1 readiness",
            path="/chat/completions",
            virtual_key=rotated_res.cleartext_key,
        )
    )
    assert bad_path_test.status_code == 404

    # First valid request -> Semantic Cache MISS; second identical request -> HIT
    first_test = svc.test_gateway_request(
        GatewayInferenceTestRequest(
            cluster_id=1,
            route_name="telco-llm-edge",
            model_id="meta-llama/Llama-3.3-70B-Instruct",
            prompt="Check BNK 2.4.1 readiness",
            path="/v1/chat/completions",
            virtual_key=rotated_res.cleartext_key,
        )
    )
    assert first_test.status_code == 200
    assert first_test.semantic_cache_status == "MISS"

    second_test = svc.test_gateway_request(
        GatewayInferenceTestRequest(
            cluster_id=1,
            route_name="telco-llm-edge",
            model_id="meta-llama/Llama-3.3-70B-Instruct",
            prompt="Check BNK 2.4.1 readiness",
            path="/v1/chat/completions",
            virtual_key=rotated_res.cleartext_key,
        )
    )
    assert second_test.status_code == 200
    assert second_test.semantic_cache_status == "HIT"
    assert second_test.estimated_cost_usd == 0.0

    # Simulate primary failure -> triggers automatic failover
    failover_test = svc.test_gateway_request(
        GatewayInferenceTestRequest(
            cluster_id=1,
            route_name="telco-llm-edge",
            model_id="meta-llama/Llama-3.3-70B-Instruct",
            prompt="Different prompt triggering failover",
            path="/v1/chat/completions",
            virtual_key=rotated_res.cleartext_key,
            simulate_primary_failure=True,
        )
    )
    assert failover_test.status_code == 200
    assert failover_test.failover_triggered is True
    assert failover_test.selected_provider == "openai-telco"

    revoked_res = svc.revoke_virtual_key(vk_res.entity["id"], cluster_id=1)
    assert revoked_res.status == "success"
    assert revoked_res.entity["status"] == "revoked"

    # 8. BNK 2.4.1 Remediation actions
    for action in [
        "restart_controller",
        "apply_dns_resolver",
        "enable_numa_spanning",
        "apply_default_egress",
    ]:
        res = svc.remediate(RemediateAiGatewayRequest(cluster_id=1, action=action, namespace="f5-bnk"))
        assert res.status == "success"
        assert res.success is True
        if action == "apply_dns_resolver":
            assert "cacheType: net-resolver" in (res.applied_yaml or "")
            assert "useIpv4: true" in (res.applied_yaml or "")
            assert "forwardZone: ." in (res.applied_yaml or "")
            assert "ipAddress: 8.8.8.8" in (res.applied_yaml or "")
        if action == "apply_default_egress":
            assert "kind: F5SPKStaticRoute" in (res.applied_yaml or "")

    # 9. Verify frontend-contract fields on overview and mutation responses
    updated_overview = svc.overview(cluster_id=1)
    assert len(updated_overview.organizations) == len(updated_overview.orgs)
    assert len(updated_overview.diagnostics) == len(updated_overview.readiness_checks)
    assert updated_overview.providers[0].provider_type != ""
    assert updated_overview.models[0].model_id != ""
    assert updated_overview.routes[0].port > 0
    assert len(updated_overview.topology_nodes) >= 1
    assert len(updated_overview.topology_edges) >= 1
    assert vk_res.cleartext_key is not None and vk_res.cleartext_key.startswith("f5vk_")


def test_governance_routes_enforce_operator_rbac():
    """Verify all mutating governance routes require operator role rather than viewer."""
    from routes.auth import require_operator, require_viewer
    from routes.k8s.llm_observability import router

    mutating_routes = [
        r
        for r in router.routes
        if getattr(r, "methods", None) and any(m in r.methods for m in ("POST", "PATCH", "DELETE"))
    ]
    assert len(mutating_routes) >= 10
    for route in mutating_routes:
        dep_callables = [d.call for d in route.dependant.dependencies]
        assert require_operator in dep_callables, f"Route {route.path} missing require_operator"
        assert require_viewer not in dep_callables, f"Mutating route {route.path} must not use require_viewer"


def test_live_crd_sync_and_no_topology_pollution_without_ai_gateway(monkeypatch):
    """Verify non-AI clusters with general F5BigDnsCache/F5SPKStaticRoute do not pollute AI Gateway topology,
    and clusters with live AIProvider/AIModel/AIGatewayProfile CRDs sync all resources."""
    from services.ai_gateway_governance_service import (
        _build_k8s_custom_resources_from_state,
        _ensure_cluster_seed,
    )

    db_mock = MagicMock()
    svc = AiGatewayGovernanceService(db=db_mock)
    state_no_ai = _ensure_cluster_seed(99, "non-ai-cluster")
    state_no_ai["dns_resolver_applied"] = True
    state_no_ai["egress_route_applied"] = True
    state_no_ai["live_dns_resolvers"] = ["general-dns"]
    state_no_ai["live_static_routes"] = ["egress-default"]
    custom_no_ai = _build_k8s_custom_resources_from_state(state_no_ai)
    assert custom_no_ai.get("f5bigdnscache", []) == []
    assert custom_no_ai.get("f5spkstaticroute", []) == []

    def fake_get_resources(cluster_id, resource_type, namespace=None):
        if cluster_id != 100:
            return []
        if resource_type == "aitenant":
            return [
                {
                    "metadata": {"name": "live-tenant", "namespace": "f5-bnk"},
                    "spec": {
                        "gatewayClassName": "f5-gateway-class",
                        "governance": {"host": "f5-cne-controller-api.f5-bnk.svc", "port": 8443},
                    },
                    "status": {"conditions": [{"type": "Ready", "status": "True"}]},
                }
            ]
        if resource_type == "aiprovider":
            return [
                {
                    "metadata": {"name": "live-provider", "namespace": "f5-bnk"},
                    "spec": {
                        "tenantRef": {"name": "live-tenant"},
                        "generic": {"baseURL": "http://vllm.f5-bnk.svc:8000/v1"},
                    },
                    "status": {"conditions": [{"type": "Ready", "status": "True"}]},
                }
            ]
        if resource_type == "aimodel":
            return [
                {
                    "metadata": {"name": "live-model", "namespace": "f5-bnk"},
                    "spec": {
                        "name": "meta-llama/Llama-3.3-70B-Instruct",
                        "tenantRef": {"name": "live-tenant"},
                        "deployments": [
                            {
                                "name": "primary",
                                "providerRef": {"name": "live-provider"},
                                "upstream": "meta-llama/Llama-3.3-70B-Instruct",
                                "weight": 100,
                            }
                        ],
                    },
                    "status": {"conditions": [{"type": "Ready", "status": "True"}]},
                }
            ]
        if resource_type == "aigatewayprofile":
            return [
                {
                    "metadata": {"name": "live-profile", "namespace": "f5-bnk"},
                    "spec": {
                        "targetRef": {"kind": "Gateway", "name": "live-gw", "port": 8080},
                        "tenantRef": {"name": "live-tenant"},
                        "promptCache": {
                            "enabled": True,
                            "connectionPool": {"maxSize": 128, "idleTimeout": "600s"},
                        },
                    },
                    "status": {"conditions": [{"type": "Accepted", "status": "True"}]},
                }
            ]
        if resource_type == "cneinstance":
            return [
                {
                    "metadata": {"name": "cne-main", "namespace": "f5-bnk"},
                    "spec": {"aiGateway": {"enabled": True}},
                }
            ]
        if resource_type == "f5bigdnscache":
            return [{"metadata": {"name": "custom-dns-cache", "namespace": "f5-bnk"}, "spec": {}}]
        if resource_type == "f5spkstaticroute":
            return [{"metadata": {"name": "custom-egress-route", "namespace": "f5-bnk"}, "spec": {}}]
        return []

    from types import SimpleNamespace

    db_mock.query.return_value.filter.return_value.first.return_value = SimpleNamespace(
        id=100, connectivity_status="connected"
    )
    svc._k8s = SimpleNamespace(get_resources=fake_get_resources)
    state_live = _ensure_cluster_seed(100, "live-ai-cluster")
    svc._sync_live_cluster_resources(100, "live-ai-cluster", state_live)

    assert len(state_live["tenants"]) == 1
    assert state_live["tenants"][0]["name"] == "live-tenant"
    assert len(state_live["providers"]) == 1
    assert state_live["providers"][0]["name"] == "live-provider"
    assert len(state_live["models"]) == 1
    assert state_live["models"][0]["name"] == "live-model"
    assert len(state_live["routes"]) == 1
    assert state_live["routes"][0]["name"] == "live-profile"
    assert state_live["routes"][0]["semantic_cache_pool_max_size"] == 128
    assert state_live["dns_resolver_applied"] is True
    assert state_live["egress_route_applied"] is True

    custom_live = _build_k8s_custom_resources_from_state(state_live)
    assert len(custom_live["f5bigdnscache"]) == 1
    assert custom_live["f5bigdnscache"][0]["metadata"]["name"] == "custom-dns-cache"
    assert custom_live["f5bigdnscache"][0]["spec"]["netResolver"]["useIpv4"] is True
    assert custom_live["f5bigdnscache"][0]["spec"]["netResolver"]["useIpv6"] is False
    assert custom_live["f5bigdnscache"][0]["spec"]["netResolver"]["forwardZones"][0]["forwardZone"] == "."
    assert len(custom_live["f5bigdnscache"][0]["spec"]["netResolver"]["forwardZones"][0]["nameServers"]) == 3
    assert len(custom_live["f5spkstaticroute"]) == 1
    assert custom_live["f5spkstaticroute"][0]["metadata"]["name"] == "custom-egress-route"

    # Verify namespace filtering on overview()
    ov_f5 = svc.overview(cluster_id=100, namespace="f5-bnk")
    assert ov_f5.namespace == "f5-bnk"
    assert len(ov_f5.providers) == 1
    assert len(ov_f5.models) == 1
    assert len(ov_f5.routes) == 1

    ov_other = svc.overview(cluster_id=100, namespace="other-ns")
    assert ov_other.namespace == "other-ns"
    assert len(ov_other.providers) == 0
    assert len(ov_other.models) == 0
    assert len(ov_other.routes) == 0

    # Verify filtering by f5-bnk does not leak resources that live in another namespace (e.g. ai-prod)
    state_custom_ns = _ensure_cluster_seed(101, "custom-ns-cluster")
    state_custom_ns["providers"] = [
        {
            "name": "prod-provider",
            "cluster_id": 101,
            "cluster_name": "custom-ns-cluster",
            "namespace": "ai-prod",
            "tenant": "prod-tenant",
            "vendor": "OpenAI",
            "base_url": "https://api.openai.com/v1",
            "credential_name": "openai-cred",
            "secret_name": "openai-sec",
            "ready": True,
        }
    ]
    state_custom_ns["models"] = []
    state_custom_ns["routes"] = []
    ov_f5_empty = svc.overview(cluster_id=101, namespace="f5-bnk")
    assert len(ov_f5_empty.providers) == 0
    ov_ai_prod = svc.overview(cluster_id=101, namespace="ai-prod")
    assert len(ov_ai_prod.providers) == 1
    assert ov_ai_prod.providers[0].name == "prod-provider"
    ov_all_ns = svc.overview(cluster_id=101, namespace="all")
    assert len(ov_all_ns.providers) == 1

    # Verify multi-cluster overview when cluster_id=None aggregates across all target clusters
    svc._target_clusters = lambda cluster_id=None, project_id=None: [
        (100, "live-ai-cluster"),
        (101, "custom-ns-cluster"),
    ]
    ov_multi = svc.overview(cluster_id=None, namespace="all")
    assert len(ov_multi.providers) == 2
    assert {p.cluster_id for p in ov_multi.providers} == {100, 101}
    assert any(n["id"].startswith("c100:") for n in ov_multi.topology_nodes)


def test_bnk_241_manual_full_feature_alignment():
    """Verify BNK 2.4.1 Manual alignment: all 7 AIProvider types & dialects, full JWT auth,
    semanticRouter.serviceRef + cross-namespace ExternalName Service/vllmsr, and route-scoped providers filter."""
    import yaml

    from schemas.llm_observability import AiRouteProviderOverride
    from services.ai_gateway_governance_service import (
        _build_k8s_custom_resources_from_state,
        _ensure_cluster_seed,
    )

    db_mock = MagicMock()
    db_mock.query.return_value.filter.return_value.all.return_value = []
    db_mock.query.return_value.all.return_value = []
    svc = AiGatewayGovernanceService(db=db_mock)

    svc.create_tenant(
        CreateAiTenantRequest(
            cluster_id=202,
            name="manual-241-tenant",
            display_name="Manual 2.4.1 Tenant",
        )
    )

    # 1. All 7 AIProvider types + dialect normalization (OpenAIChat & AnthropicMessages)
    provider_cases = [
        ("prov-openai", "OpenAI", "https://api.openai.com/v1", None, "openAI"),
        ("prov-anthropic", "Anthropic", "https://api.anthropic.com", None, "anthropic"),
        ("prov-azure-openai", "AzureOpenAI", "https://my-resource.openai.azure.com", None, "azureOpenAI"),
        ("prov-azure-foundry", "AzureFoundry", "https://my-foundry.services.ai.azure.com/models", None, "azureFoundry"),
        ("prov-bedrock", "Bedrock", "", None, "bedrock"),
        ("prov-gemini", "Gemini", "https://generativelanguage.googleapis.com", None, "gemini"),
        ("prov-generic-anthropic", "Generic", "http://claude-proxy.ai.svc:8080", "anthropic", "generic"),
    ]
    for p_name, p_type, base_url, dialect, expected_block in provider_cases:
        res = svc.create_provider(
            CreateAiProviderRequest(
                cluster_id=202,
                name=p_name,
                namespace="default",
                tenant="manual-241-tenant",
                vendor=p_type,
                base_url=base_url,
                dialect=dialect,
                region="us-east-1" if p_type == "Bedrock" else None,
                deployment="gpt-4o" if p_type == "AzureOpenAI" else None,
                api_version="2024-10-21" if p_type == "AzureOpenAI" else None,
                api_key=f"key-{p_name}",
            )
        )
        assert res.status == "success"
        docs = [d for d in yaml.safe_load_all(res.applied_yaml or "") if d]
        prov_doc = next(d for d in docs if d.get("kind") == "AIProvider")
        assert prov_doc["spec"]["type"] == p_type
        assert expected_block in prov_doc["spec"]
        if p_name == "prov-generic-anthropic":
            assert prov_doc["spec"]["generic"]["dialect"] == "AnthropicMessages"
            # AnthropicMessages dialect does not force a /v1 suffix
            assert prov_doc["spec"]["generic"]["baseURL"] == "http://claude-proxy.ai.svc:8080"

    # 2. Route with omitted providers filter (all tenant providers active) + modelRouting + cross-ns vllmsr + full JWT
    route_all_prov = svc.create_route(
        CreateAiGatewayRouteRequest(
            cluster_id=202,
            name="route-all-providers",
            namespace="default",
            gateway_name="ai-gw-main",
            vip_address="10.20.30.50",
            listener_port=8080,
            tenant="manual-241-tenant",
            virtual_keys_enabled=True,
            jwt_enabled=True,
            jwt_issuer="https://idp.enterprise.internal",
            jwt_audiences=["ai-gateway", "inference-clients"],
            jwks_uri="https://idp.enterprise.internal/.well-known/jwks.json",
            jwks_refresh_interval="10m",
            jwt_secret_ref="jwt-hmac-secret",
            jwt_header="X-Auth-Token",
            jwt_scheme="Bearer",
            jwt_clock_skew="30s",
            jwt_principal_claim="sub",
            jwt_team_claim="groups",
            jwt_org_claim="org_id",
            model_routing_enabled=True,
            semantic_router_service="vllmsr",
            semantic_router_port=8000,
            semantic_router_timeout="5s",
            semantic_router_namespace="f5-utils",
        )
    )
    assert route_all_prov.status == "success"
    route_docs = [d for d in yaml.safe_load_all(route_all_prov.applied_yaml or "") if d]
    prof_doc = next(d for d in route_docs if d.get("kind") == "AIGatewayProfile")

    # Verify spec.providers is omitted when no allowed_providers / provider_credentials are given
    assert "providers" not in prof_doc["spec"]

    # Verify full spec.auth.jwt and spec.auth.virtualKeys
    auth_spec = prof_doc["spec"]["auth"]
    assert auth_spec["virtualKeys"] == {"required": True}
    jwt_spec = auth_spec["jwt"]
    assert jwt_spec["issuer"] == "https://idp.enterprise.internal"
    assert jwt_spec["audiences"] == ["ai-gateway", "inference-clients"]
    assert jwt_spec["jwksUri"] == "https://idp.enterprise.internal/.well-known/jwks.json"
    assert jwt_spec["jwksRefreshInterval"] == "10m"
    assert jwt_spec["secretRef"] == {"name": "jwt-hmac-secret"}
    assert jwt_spec["header"] == "X-Auth-Token"
    assert jwt_spec["scheme"] == "Bearer"
    assert jwt_spec["clockSkew"] == "30s"
    assert jwt_spec["principalClaim"] == "sub"
    assert jwt_spec["teamClaim"] == "groups"
    assert jwt_spec["orgClaim"] == "org_id"

    # Verify modelRouting.semanticRouter.serviceRef & cross-namespace ExternalName Service/vllmsr
    assert prof_doc["spec"]["modelRouting"] == {
        "semanticRouter": {
            "serviceRef": {"name": "vllmsr", "port": 8000},
            "timeout": "5s",
        }
    }
    svc_doc = next((d for d in route_docs if d.get("kind") == "Service"), None)
    assert svc_doc is not None
    assert svc_doc["metadata"] == {"name": "vllmsr", "namespace": "default"}
    assert svc_doc["spec"]["type"] == "ExternalName"
    assert svc_doc["spec"]["externalName"] == "vllmsr.f5-utils.svc.cluster.local"

    # 3. Route with explicit route-scoped providers filter and credentialRef overrides
    route_filtered = svc.create_route(
        CreateAiGatewayRouteRequest(
            cluster_id=202,
            name="route-filtered-providers",
            namespace="default",
            gateway_name="ai-gw-filtered",
            vip_address="10.20.30.51",
            listener_port=8081,
            tenant="manual-241-tenant",
            allowed_providers=["prov-openai", "prov-anthropic"],
            provider_credentials={"prov-openai": "alt-openai-cred"},
            provider_overrides=[
                AiRouteProviderOverride(name="prov-openai", credential_ref="alt-openai-cred"),
                AiRouteProviderOverride(name="prov-anthropic"),
            ],
        )
    )
    filtered_docs = [d for d in yaml.safe_load_all(route_filtered.applied_yaml or "") if d]
    filtered_prof = next(d for d in filtered_docs if d.get("kind") == "AIGatewayProfile")
    assert filtered_prof["spec"]["providers"] == [
        {"name": "prov-openai", "credentialRef": {"name": "alt-openai-cred"}},
        {"name": "prov-anthropic"},
    ]

    # 4. Verify _build_k8s_custom_resources_from_state and topology assembly for both routes
    state_202 = _ensure_cluster_seed(202, "manual-241-cluster")
    custom_res = _build_k8s_custom_resources_from_state(state_202)
    nodes = []
    edges = []
    _assemble_custom_fabric_topology(
        custom_resources=custom_res,
        namespace="default",
        nodes=nodes,
        edges=edges,
    )
    node_ids = {n.id for n in nodes}
    edge_pairs = {(e.source, e.target, e.kind) for e in edges}

    assert "Service/default/vllmsr" in node_ids
    assert (
        "AIGatewayProfile/default/route-all-providers",
        "Service/default/vllmsr",
        "routes",
    ) in edge_pairs
    # Omitted providers filter still links profile to tenant providers
    assert (
        "AIGatewayProfile/default/route-all-providers",
        "AIProvider/default/prov-openai",
        "references",
    ) in edge_pairs
    # Explicit providers filter links profile to selected providers
    assert (
        "AIGatewayProfile/default/route-filtered-providers",
        "AIProvider/default/prov-anthropic",
        "references",
    ) in edge_pairs

    # Verify _build_k8s_custom_resources_from_state preserves vendor-specific AIProvider fields
    prov_by_name = {p["metadata"]["name"]: p for p in custom_res["aiprovider"]}
    assert prov_by_name["prov-generic-anthropic"]["spec"]["generic"]["dialect"] == "AnthropicMessages"
    assert prov_by_name["prov-bedrock"]["spec"]["bedrock"]["region"] == "us-east-1"
    assert prov_by_name["prov-azure-openai"]["spec"]["azureOpenAI"]["deployment"] == "gpt-4o"
    assert prov_by_name["prov-azure-openai"]["spec"]["azureOpenAI"]["apiVersion"] == "2024-10-21"

    # 5. Verify default semantic_router_timeout="5s" & default_model_ref fallback alias
    alias_req = CreateAiGatewayRouteRequest(
        cluster_id=202,
        name="route-alias-test",
        namespace="default",
        gateway_name="ai-gw-alias",
        vip_address="10.20.30.52",
        listener_port=8082,
        tenant="manual-241-tenant",
        model_routing_enabled=True,
        default_model_ref="vsr-service",
    )
    assert alias_req.semantic_router_timeout == "5s"
    assert alias_req.semantic_router_port == 8000
    assert alias_req.semantic_router_service == "vsr-service"

    # 6. Verify update_route_policies clearing providers=[] also clears stale provider_credentials/overrides
    cleared = svc.update_route_policies(
        "route-filtered-providers",
        UpdateAiGatewayRoutePoliciesRequest(
            cluster_id=202,
            providers=[],
        ),
    )
    assert cleared.entity["providers"] == []
    assert cleared.entity["provider_credentials"] == {}
    assert cleared.entity["provider_overrides"] == []
