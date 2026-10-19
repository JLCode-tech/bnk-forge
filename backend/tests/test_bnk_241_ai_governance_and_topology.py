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
    IssueVirtualKeyRequest,
    RemediateAiGatewayRequest,
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
    """Verify _assemble_custom_fabric_topology links AppPolicy, Gateway, HTTPRoute, and AI CRDs."""
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
        "f5biggslbwideip": [
            {
                "metadata": {"name": "ai-global-wideip", "namespace": "default"},
                "spec": {"pools": [{"name": "ai-global-pool"}]},
            }
        ],
        "f5biggslbpool": [{"metadata": {"name": "ai-global-pool", "namespace": "default"}}],
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
    assert "F5BigGslbWideip/default/ai-global-wideip" in node_ids
    assert "F5BigGslbPool/default/ai-global-pool" in node_ids

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


def test_ai_gateway_governance_service_end_to_end():
    """Verify multi-cluster AI Gateway & DSSM Governance CRUD, /v1 normalization, and remediation."""
    db_mock = MagicMock()
    db_mock.query.return_value.filter.return_value.all.return_value = []
    db_mock.query.return_value.all.return_value = []

    svc = AiGatewayGovernanceService(db=db_mock)

    # 1. Overview returns rich multi-cluster defaults when cluster has no live CRs
    overview = svc.overview(cluster_id=1)
    assert len(overview.tenants) >= 1
    assert len(overview.providers) >= 1
    assert len(overview.models) >= 1
    assert len(overview.routes) >= 1
    assert len(overview.orgs) >= 1
    assert len(overview.teams) >= 1
    assert len(overview.principals) >= 1
    assert len(overview.virtual_keys) >= 1
    assert len(overview.readiness_checks) >= 4
    assert len(overview.topology_nodes) >= 1
    assert len(overview.topology_edges) >= 1

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
                    weight=100,
                    input_per_mtok=400000,
                    output_per_mtok=800000,
                )
            ],
        )
    )
    assert model_res.status == "success"
    assert model_res.entity["name"] == "llama-3-3-70b"
    assert model_res.entity["deployments"][0]["weight"] == 100

    # 5. Create Gateway Route with BNK 2.4.1 Semantic Cache connection pooling
    route_res = svc.create_route(
        CreateAiGatewayRouteRequest(
            cluster_id=1,
            name="telco-llm-edge",
            namespace="f5-bnk",
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
            allowed_models=["meta-llama/Llama-3.3-70B-Instruct"],
        )
    )
    assert vk_res.status == "success"
    assert vk_res.entity["raw_key"] is not None
    assert vk_res.entity["raw_key"].startswith("f5vk_")
    assert vk_res.entity["status"] == "active"

    revoked_res = svc.revoke_virtual_key(vk_res.entity["id"], cluster_id=1)
    assert revoked_res.status == "success"
    assert revoked_res.entity["status"] == "revoked"

    # 7. BNK 2.4.1 Remediation actions
    for action in [
        "restart_controller",
        "apply_dns_resolver",
        "enable_numa_spanning",
        "apply_default_egress",
    ]:
        res = svc.remediate(RemediateAiGatewayRequest(cluster_id=1, action=action, namespace="f5-bnk"))
        assert res.status == "success"
        assert res.success is True

    # 8. Verify frontend-contract fields on overview and mutation responses
    updated_overview = svc.overview(cluster_id=1)
    assert len(updated_overview.organizations) == len(updated_overview.orgs)
    assert len(updated_overview.diagnostics) == len(updated_overview.readiness_checks)
    assert updated_overview.providers[0].provider_type != ""
    assert updated_overview.models[0].model_id != ""
    assert updated_overview.routes[0].port > 0
    assert vk_res.cleartext_key is not None and vk_res.cleartext_key.startswith("f5vk_")
