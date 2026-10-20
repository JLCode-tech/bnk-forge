"""
AI-gateway observability routes (Tier 1: request analytics).

Thin handlers over LlmObservabilityService, which proxies live LogQL to the
in-cluster ``llm-gateway`` Loki store. Every endpoint returns a degradation
envelope (``available``/``reason``/``errors``) instead of raising, so a panel
can render "unavailable" without crashing the UI.

Handlers are ``async`` and offload the blocking Loki roundtrips with
``asyncio.to_thread`` (the codebase pattern for wrapping blocking K8s calls),
so a slow cluster can't tie up an event-loop worker for the full request.

Base path: /api/k8s/clusters/{cluster_id}/llm-observability
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.errors import handle_route_errors
from database import get_db
from routes.auth import require_operator, require_viewer
from schemas.llm_observability import (
    AiGovernanceMutationResponse,
    AiGovernanceOverviewResponse,
    CreateAiGatewayRouteRequest,
    CreateAiModelRequest,
    CreateAiProviderRequest,
    CreateAiTenantRequest,
    CreateGovernanceOrgRequest,
    CreateGovernancePrincipalRequest,
    CreateGovernanceTeamRequest,
    GatewayInferenceTestRequest,
    GatewayInferenceTestResponse,
    IssueVirtualKeyRequest,
    LlmFilterDataResponse,
    LlmHistogramResponse,
    LlmLogsResponse,
    LlmProviderUsageResponse,
    LlmRankingsResponse,
    LlmStatsResponse,
    RemediateAiGatewayRequest,
    UpdateAiGatewayRoutePoliciesRequest,
)
from services.ai_gateway_governance_service import AiGatewayGovernanceService
from services.llm_observability_service import LlmObservabilityService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["k8s-llm-observability"])

_BASE = "/k8s/clusters/{cluster_id}/llm-observability"
_FLEET_BASE = "/k8s/llm-observability"

# NOTE: the handler arg is `time_range` (avoids shadowing the `range` builtin);
# the query parameter stays `range` via Query(alias="range"), so the API/UI
# contract is unchanged.


_LLM_OBS_CACHE_TTL_SEC = 30


def _cache_dump(res):
    return res.model_dump(mode="json") if hasattr(res, "model_dump") else res


@router.get(
    f"{_FLEET_BASE}/stats",
    response_model=LlmStatsResponse,
    dependencies=[Depends(require_viewer)],
)
@router.get(
    f"{_BASE}/stats",
    response_model=LlmStatsResponse,
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get LLM gateway stats")
async def get_llm_stats(
    cluster_id: int | None = None,
    time_range: str = Query(default="1h", alias="range"),
    model: str | None = None,
    status: str | None = None,
    project_id: int | None = Query(default=None, description="Optional project ID to filter clusters"),
    db: Session = Depends(get_db),
):
    """Summary tiles: total requests, success rate, avg latency, tokens, cost, models."""
    from core.cache import cache

    cache_key = f"llm_obs:stats:{cluster_id}:{project_id}:{time_range}:{model}:{status}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    if project_id is not None:
        res = await asyncio.to_thread(
            LlmObservabilityService(db).stats,
            cluster_id,
            time_range,
            model,
            status,
            project_id=project_id,
        )
    else:
        res = await asyncio.to_thread(LlmObservabilityService(db).stats, cluster_id, time_range, model, status)
    cache.set(cache_key, _cache_dump(res), _LLM_OBS_CACHE_TTL_SEC)
    return res


@router.get(
    f"{_FLEET_BASE}/histogram",
    response_model=LlmHistogramResponse,
    dependencies=[Depends(require_viewer)],
)
@router.get(
    f"{_BASE}/histogram",
    response_model=LlmHistogramResponse,
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get LLM gateway histogram")
async def get_llm_histogram(
    cluster_id: int | None = None,
    metric: str = Query(default="requests"),
    time_range: str = Query(default="1h", alias="range"),
    model: str | None = None,
    status: str | None = None,
    project_id: int | None = Query(default=None, description="Optional project ID to filter clusters"),
    db: Session = Depends(get_db),
):
    """Time-series for one metric (requests|tokens|cost|models|latency)."""
    from core.cache import cache

    cache_key = f"llm_obs:histogram:{cluster_id}:{project_id}:{metric}:{time_range}:{model}:{status}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    if project_id is not None:
        res = await asyncio.to_thread(
            LlmObservabilityService(db).histogram,
            cluster_id,
            time_range,
            metric,
            model,
            status,
            project_id=project_id,
        )
    else:
        res = await asyncio.to_thread(
            LlmObservabilityService(db).histogram, cluster_id, time_range, metric, model, status
        )
    cache.set(cache_key, _cache_dump(res), _LLM_OBS_CACHE_TTL_SEC)
    return res


@router.get(
    f"{_FLEET_BASE}/rankings",
    response_model=LlmRankingsResponse,
    dependencies=[Depends(require_viewer)],
)
@router.get(
    f"{_BASE}/rankings",
    response_model=LlmRankingsResponse,
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get LLM gateway rankings")
async def get_llm_rankings(
    cluster_id: int | None = None,
    time_range: str = Query(default="1h", alias="range"),
    model: str | None = None,
    status: str | None = None,
    project_id: int | None = Query(default=None, description="Optional project ID to filter clusters"),
    db: Session = Depends(get_db),
):
    """Per-model rows with window-over-window trend deltas."""
    from core.cache import cache

    cache_key = f"llm_obs:rankings:{cluster_id}:{project_id}:{time_range}:{model}:{status}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    if project_id is not None:
        res = await asyncio.to_thread(
            LlmObservabilityService(db).rankings,
            cluster_id,
            time_range,
            model,
            status,
            project_id=project_id,
        )
    else:
        res = await asyncio.to_thread(LlmObservabilityService(db).rankings, cluster_id, time_range, model, status)
    cache.set(cache_key, _cache_dump(res), _LLM_OBS_CACHE_TTL_SEC)
    return res


@router.get(
    f"{_FLEET_BASE}/provider-usage",
    response_model=LlmProviderUsageResponse,
    dependencies=[Depends(require_viewer)],
)
@router.get(
    f"{_BASE}/provider-usage",
    response_model=LlmProviderUsageResponse,
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get LLM gateway provider usage")
async def get_llm_provider_usage(
    cluster_id: int | None = None,
    metric: str = Query(default="cost"),
    time_range: str = Query(default="1h", alias="range"),
    model: str | None = None,
    status: str | None = None,
    project_id: int | None = Query(default=None, description="Optional project ID to filter clusters"),
    db: Session = Depends(get_db),
):
    """Time-series folded to inferred provider (cost|tokens|latency)."""
    from core.cache import cache

    cache_key = f"llm_obs:provider_usage:{cluster_id}:{project_id}:{metric}:{time_range}:{model}:{status}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    if project_id is not None:
        res = await asyncio.to_thread(
            LlmObservabilityService(db).provider_usage,
            cluster_id,
            time_range,
            metric,
            model,
            status,
            project_id=project_id,
        )
    else:
        res = await asyncio.to_thread(
            LlmObservabilityService(db).provider_usage, cluster_id, time_range, metric, model, status
        )
    cache.set(cache_key, _cache_dump(res), _LLM_OBS_CACHE_TTL_SEC)
    return res


@router.get(
    f"{_FLEET_BASE}/logs",
    response_model=LlmLogsResponse,
    dependencies=[Depends(require_viewer)],
)
@router.get(
    f"{_BASE}/logs",
    response_model=LlmLogsResponse,
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get LLM gateway logs")
async def get_llm_logs(
    cluster_id: int | None = None,
    time_range: str = Query(default="1h", alias="range"),
    model: str | None = None,
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=1000),
    content_search: str | None = None,
    end: int | None = Query(default=None, description="nanosecond cursor for load-older"),
    project_id: int | None = Query(default=None, description="Optional project ID to filter clusters"),
    db: Session = Depends(get_db),
):
    """Per-request log rows, newest first; ``next_end`` is the load-older cursor."""
    if project_id is not None:
        return await asyncio.to_thread(
            LlmObservabilityService(db).logs,
            cluster_id,
            time_range,
            model,
            status,
            limit,
            content_search,
            end,
            project_id=project_id,
        )
    return await asyncio.to_thread(
        LlmObservabilityService(db).logs,
        cluster_id,
        time_range,
        model,
        status,
        limit,
        content_search,
        end,
    )


@router.get(
    f"{_FLEET_BASE}/filterdata",
    response_model=LlmFilterDataResponse,
    dependencies=[Depends(require_viewer)],
)
@router.get(
    f"{_BASE}/filterdata",
    response_model=LlmFilterDataResponse,
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get LLM gateway filter data")
async def get_llm_filterdata(
    cluster_id: int | None = None,
    time_range: str = Query(default="1h", alias="range"),
    project_id: int | None = Query(default=None, description="Optional project ID to filter clusters"),
    db: Session = Depends(get_db),
):
    """Distinct model + status label values for filter dropdowns."""
    from core.cache import cache

    cache_key = f"llm_obs:filterdata:{cluster_id}:{project_id}:{time_range}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    if project_id is not None:
        res = await asyncio.to_thread(
            LlmObservabilityService(db).filterdata,
            cluster_id,
            time_range,
            project_id=project_id,
        )
    else:
        res = await asyncio.to_thread(LlmObservabilityService(db).filterdata, cluster_id, time_range)
    cache.set(cache_key, _cache_dump(res), _LLM_OBS_CACHE_TTL_SEC)
    return res


# =============================================================================
# Multi-Cluster AI Gateway & DSSM Governance Console Endpoints
# =============================================================================


@router.get(
    f"{_FLEET_BASE}/governance/overview",
    response_model=AiGovernanceOverviewResponse,
    dependencies=[Depends(require_viewer)],
)
@router.get(
    f"{_BASE}/governance/overview",
    response_model=AiGovernanceOverviewResponse,
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get AI gateway governance overview")
async def get_ai_governance_overview(
    cluster_id: int | None = None,
    namespace: str | None = Query(default=None, description="Optional Kubernetes namespace filter"),
    project_id: int | None = Query(default=None, description="Optional project ID to filter clusters"),
    db: Session = Depends(get_db),
):
    """Multi-cluster AI Gateway catalog, routes, DSSM governance entities, readiness checks, and Dependency Fabric topology."""
    return await asyncio.to_thread(
        AiGatewayGovernanceService(db).overview,
        cluster_id=cluster_id,
        project_id=project_id,
        namespace=namespace,
    )


@router.post(
    f"{_FLEET_BASE}/governance/tenants",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/tenants",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("create AI tenant")
async def create_ai_tenant(
    req: CreateAiTenantRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Create or update a cluster-scoped AITenant (inference.k8s.f5.com/v1alpha1)."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).create_tenant, req)


@router.post(
    f"{_FLEET_BASE}/governance/providers",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/providers",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("create AI provider")
async def create_ai_provider(
    req: CreateAiProviderRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Create Secret + AICredential + AIProvider bundle for an upstream LLM vendor."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).create_provider, req)


@router.post(
    f"{_FLEET_BASE}/governance/models",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/models",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("create AI model")
async def create_ai_model(
    req: CreateAiModelRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Create or update an AIModel with weighted provider deployments and micro-USD/Mtok pricing."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).create_model, req)


@router.post(
    f"{_FLEET_BASE}/governance/routes",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/routes",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("create AI gateway route")
async def create_ai_gateway_route(
    req: CreateAiGatewayRouteRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Create or update Gateway + HTTPRoute + AIGatewayProfile + AppPolicy attachment bundle."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).create_route, req)


@router.patch(
    f"{_FLEET_BASE}/governance/routes/{{route_name}}/policies",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.patch(
    f"{_BASE}/governance/routes/{{route_name}}/policies",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("update AI gateway route policies")
async def update_ai_gateway_route_policies(
    route_name: str,
    req: UpdateAiGatewayRoutePoliciesRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Toggle Semantic Cache, Virtual Key Auth, or Prompt Guardrails on an existing AIGatewayRoute."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).update_route_policies, route_name, req)


@router.post(
    f"{_FLEET_BASE}/governance/orgs",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/orgs",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("create DSSM governance organization")
async def create_governance_org(
    req: CreateGovernanceOrgRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Create or update a DSSM Governance Organization with monthly budget and rate limits."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).create_org, req)


@router.post(
    f"{_FLEET_BASE}/governance/teams",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/teams",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("create DSSM governance team")
async def create_governance_team(
    req: CreateGovernanceTeamRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Create or update a DSSM Governance Team with model access scope and budgets."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).create_team, req)


@router.post(
    f"{_FLEET_BASE}/governance/principals",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/principals",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("create DSSM governance principal")
async def create_governance_principal(
    req: CreateGovernancePrincipalRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Create or update a DSSM Governance Principal (user/service/agent) with RBAC role and budgets."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).create_principal, req)


@router.post(
    f"{_FLEET_BASE}/governance/virtual-keys",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/virtual-keys",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("issue DSSM virtual key")
async def issue_governance_virtual_key(
    req: IssueVirtualKeyRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Issue a new f5vk_... Virtual Key for a DSSM Principal."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).issue_virtual_key, req)


@router.post(
    f"{_FLEET_BASE}/governance/virtual-keys/{{key_id}}/rotate",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/virtual-keys/{{key_id}}/rotate",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("rotate DSSM virtual key")
async def rotate_governance_virtual_key(
    key_id: str,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Rotate an existing DSSM Virtual Key in-place, invalidating the old token secret."""
    return await asyncio.to_thread(AiGatewayGovernanceService(db).rotate_virtual_key, key_id, cluster_id)


@router.delete(
    f"{_FLEET_BASE}/governance/virtual-keys/{{key_id}}",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.delete(
    f"{_BASE}/governance/virtual-keys/{{key_id}}",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("revoke DSSM virtual key")
async def revoke_governance_virtual_key(
    key_id: str,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Revoke an existing DSSM Virtual Key."""
    return await asyncio.to_thread(AiGatewayGovernanceService(db).revoke_virtual_key, key_id, cluster_id)


@router.post(
    f"{_FLEET_BASE}/governance/remediate",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/remediate",
    response_model=AiGovernanceMutationResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("remediate AI gateway check")
async def remediate_ai_gateway(
    req: RemediateAiGatewayRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Execute automated remediation for AI Gateway readiness checks (controller restart, DNS resolver, Multi-NUMA)."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).remediate, req)


@router.post(
    f"{_FLEET_BASE}/governance/test-request",
    response_model=GatewayInferenceTestResponse,
    dependencies=[Depends(require_operator)],
)
@router.post(
    f"{_BASE}/governance/test-request",
    response_model=GatewayInferenceTestResponse,
    dependencies=[Depends(require_operator)],
)
@handle_route_errors("test AI gateway inference request")
async def test_ai_gateway_request(
    req: GatewayInferenceTestRequest,
    cluster_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Polaris Step 8 live inference & policy tester across Virtual Key Auth, Budgets, Semantic Cache, and Failover."""
    if cluster_id is not None:
        req.cluster_id = cluster_id
    return await asyncio.to_thread(AiGatewayGovernanceService(db).test_gateway_request, req)
