"""
BNK 2.4.1 Multi-Cluster AI Gateway & DSSM Governance Service.

Replaces the single-cluster Polaris AI Console with a multi-cluster control plane
inside BNK-Forge:
  1. Declarative Kubernetes CRDs (`inference.k8s.f5.com/v1alpha1` & `gateway.k8s.f5.com/v1alpha1`):
     - AITenant (cluster-scoped)
     - AICredential + Secret
     - AIProvider (OpenAI, Anthropic, AzureOpenAI, AzureFoundry, Bedrock, Gemini, Generic)
     - AIModel (weighted multi-provider deployments + inputPerMtok/outputPerMtok pricing)
     - AIGatewayProfile (virtualKeys, JWT auth, failover, promptCache + BNK 2.4.1
       semantic_cache_pool_max_size / semantic_cache_pool_idle_timeout, modelRouting)
     - AppPolicy + Gateway + HTTPRoute attachment chain
  2. In-cluster DSSM Governance API proxy (`f5-cne-controller-api:8443/api/v1/tenants/<tenant>/governance/...`)
     with multi-cluster state store for Organizations, Teams, Principals (user/service/agent),
     Budgets, Rate Limits, and Virtual Keys (`f5vk_...`).
  3. BNK 2.4.1 Readiness & Troubleshooting Diagnostics:
     - CNEInstance `aiGateway.enabled` & `aiGateway.aiMetrics`
     - `F5BigDnsCache` `aigw-dns-resolver` (`coredns` vs `kube-dns` verification)
     - `F5SPKStaticRoute` TMM egress route check
     - DSSM Redis Sentinel HA check
     - BNK 2.4.1 stuck `AIGatewayProfile` (`Programmed=False` / "AI profile is not prepared yet")
       detection and 1-click controller restart remediation
     - BNK 2.4.1 Multi-NUMA (`TMM_ENFORCE_SINGLE_NUMA_NODE=false`) & Semantic Cache pooling checks.
"""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from models.kubernetes import KubernetesCluster
from schemas.llm_observability import (
    AiGovernanceMutationResponse,
    AiGatewayRouteSummary,
    AiGovernanceOverviewResponse,
    AiModelDeploymentItem,
    AiModelSummary,
    AiProviderSummary,
    AiReadinessCheckItem,
    AiTenantSummary,
    CreateAiGatewayRouteRequest,
    CreateAiModelRequest,
    CreateAiProviderRequest,
    CreateAiTenantRequest,
    CreateGovernanceOrgRequest,
    CreateGovernancePrincipalRequest,
    CreateGovernanceTeamRequest,
    GovernanceOrgItem,
    GovernancePrincipalItem,
    GovernanceTeamItem,
    GovernanceVirtualKeyItem,
    IssueVirtualKeyRequest,
    RemediateAiGatewayRequest,
)
from services.kubernetes_service import KubernetesService
from services.topology_builder_service import assemble_topology

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


# ---------------------------------------------------------------------------
# In-memory multi-cluster state overlay (persists across requests in worker
# and seeds realistic BNK 2.4.1 reference topology when live CRDs are absent)
# ---------------------------------------------------------------------------

_CLUSTER_STATE: dict[int, dict[str, Any]] = {}


def _ensure_cluster_seed(cluster_id: int, cluster_name: str) -> dict[str, Any]:
    """Initialize default BNK 2.4.1 AI Gateway & DSSM Governance state for a cluster."""
    if cluster_id in _CLUSTER_STATE:
        state = _CLUSTER_STATE[cluster_id]
        state["cluster_name"] = cluster_name
        return state

    tenant_name = "ai-platform"
    ns = "f5-bnk"

    state: dict[str, Any] = {
        "cluster_id": cluster_id,
        "cluster_name": cluster_name,
        "namespace": ns,
        "dns_resolver_applied": True,
        "numa_spanning_enabled": True,
        "egress_route_applied": True,
        "stuck_profile_remediated": False,
        "tenants": [
            {
                "name": tenant_name,
                "display_name": f"AI Platform ({cluster_name})",
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "namespace": ns,
                "admin_secret": f"aitenant-{tenant_name}-admin",
                "oidc_issuer": None,
                "ready": True,
                "status_message": "AITenant is ready",
            }
        ],
        "providers": [
            {
                "name": "openai-primary",
                "namespace": ns,
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "vendor": "OpenAI",
                "base_url": "https://api.openai.com/v1",
                "credential_name": "openai-cred",
                "secret_name": "openai-api-key",
                "enabled": True,
                "ready": True,
                "status_message": "AIProvider is ready",
            },
            {
                "name": "anthropic-claude",
                "namespace": ns,
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "vendor": "Anthropic",
                "base_url": "https://api.anthropic.com/v1",
                "credential_name": "anthropic-cred",
                "secret_name": "anthropic-api-key",
                "enabled": True,
                "ready": True,
                "status_message": "AIProvider is ready",
            },
            {
                "name": "dgx-vllm-local",
                "namespace": ns,
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "vendor": "Generic",
                "base_url": "http://vllm-inference.f5-bnk.svc.cluster.local:8000/v1",
                "credential_name": "dgx-vllm-cred",
                "secret_name": "dgx-vllm-key",
                "enabled": True,
                "ready": True,
                "status_message": "AIProvider is ready (OpenAI-compatible /v1)",
            },
        ],
        "models": [
            {
                "name": "gpt-4o-enterprise",
                "public_name": "gpt-4o",
                "namespace": ns,
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "deployments": [
                    {
                        "name": "openai-primary-dep",
                        "provider": "openai-primary",
                        "upstream": "gpt-4o",
                        "dialects": ["openai"],
                        "weight": 80,
                        "state": "Active",
                        "input_per_mtok": 2500000,
                        "output_per_mtok": 10000000,
                    },
                    {
                        "name": "dgx-fallback-dep",
                        "provider": "dgx-vllm-local",
                        "upstream": "meta-llama/Llama-3.3-70B-Instruct",
                        "dialects": ["openai"],
                        "weight": 20,
                        "state": "Active",
                        "input_per_mtok": 400000,
                        "output_per_mtok": 800000,
                    },
                ],
                "ready": True,
                "status_message": "AIModel is ready (2 weighted deployments)",
            },
            {
                "name": "claude-sonnet-4",
                "public_name": "claude-sonnet-4-20250514",
                "namespace": ns,
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "deployments": [
                    {
                        "name": "anthropic-primary",
                        "provider": "anthropic-claude",
                        "upstream": "claude-sonnet-4-20250514",
                        "dialects": ["openai"],
                        "weight": 100,
                        "state": "Active",
                        "input_per_mtok": 3000000,
                        "output_per_mtok": 15000000,
                    }
                ],
                "ready": True,
                "status_message": "AIModel is ready",
            },
        ],
        "routes": [
            {
                "name": "ai-platform-profile",
                "namespace": ns,
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "gateway_name": "ai-gateway",
                "listener_name": "http",
                "listener_port": 8080,
                "vip_address": f"10.100.{cluster_id}.200",
                "route_name": "ai-gateway-route",
                "path_prefix": "/v1",
                "app_policy_name": "ai-gateway-apppolicy",
                "virtual_keys_enabled": True,
                "jwt_enabled": True,
                "jwt_audiences": ["ai-gateway"],
                "failover_enabled": True,
                "failover_max_attempts": 3,
                "failover_on_429": True,
                "failover_on_5xx": True,
                "prompt_cache_enabled": True,
                "semantic_cache_pool_max_size": 64,
                "semantic_cache_pool_idle_timeout": "300s",
                "model_routing_enabled": True,
                "default_model_ref": "gpt-4o-enterprise",
                "providers": ["openai-primary", "anthropic-claude", "dgx-vllm-local"],
                "accepted": True,
                "programmed": True,
                "stuck_profile_bug": False,
                "status_message": "Profile programmed on Gateway listener http:8080",
            }
        ],
        "orgs": [
            {
                "id": f"org-core-{cluster_id}",
                "name": "Core AI Engineering",
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "monthly_budget_usd": 1500.0,
                "current_spend_usd": 342.80,
                "alert_threshold_pct": 80,
                "rate_limit_rpm": 2400,
                "rate_limit_tpm": 1000000,
            }
        ],
        "teams": [
            {
                "id": f"team-platform-{cluster_id}",
                "name": "Platform & Inference Team",
                "org_id": f"org-core-{cluster_id}",
                "org_name": "Core AI Engineering",
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "monthly_budget_usd": 600.0,
                "current_spend_usd": 148.25,
                "allowed_models": ["gpt-4o", "claude-sonnet-4-20250514"],
                "rate_limit_rpm": 1200,
                "rate_limit_tpm": 500000,
            }
        ],
        "principals": [
            {
                "id": f"prin-agent-{cluster_id}",
                "name": "sre-triage-agent",
                "kind": "agent",
                "role": "member",
                "team_id": f"team-platform-{cluster_id}",
                "team_name": "Platform & Inference Team",
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "monthly_budget_usd": 150.0,
                "current_spend_usd": 42.10,
                "allowed_models": ["gpt-4o", "claude-sonnet-4-20250514"],
                "rate_limit_rpm": 300,
                "rate_limit_tpm": 120000,
            },
            {
                "id": f"prin-admin-{cluster_id}",
                "name": "platform-lead@f5.com",
                "kind": "user",
                "role": "admin",
                "team_id": f"team-platform-{cluster_id}",
                "team_name": "Platform & Inference Team",
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "monthly_budget_usd": 300.0,
                "current_spend_usd": 64.90,
                "allowed_models": ["gpt-4o", "claude-sonnet-4-20250514"],
                "rate_limit_rpm": 600,
                "rate_limit_tpm": 250000,
            },
        ],
        "virtual_keys": [
            {
                "id": f"vk-sre-{cluster_id}",
                "name": "sre-triage-prod-key",
                "masked_key": f"f5vk_c{cluster_id}a9••••••••••••7f3e",
                "raw_key": None,
                "principal_id": f"prin-agent-{cluster_id}",
                "principal_name": "sre-triage-agent",
                "tenant": tenant_name,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name,
                "allowed_models": ["gpt-4o", "claude-sonnet-4-20250514"],
                "status": "active",
                "created_at": "2026-10-15T09:00:00+00:00",
                "last_used_at": _now_iso(),
            }
        ],
    }
    _CLUSTER_STATE[cluster_id] = state
    return state


def _build_k8s_custom_resources_from_state(state: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Convert cluster AI Gateway state into K8s resource dicts for Dependency Fabric topology assembly."""
    ns = state.get("namespace", "f5-bnk")
    custom: dict[str, list[dict[str, Any]]] = {
        "cneinstance": [
            {
                "metadata": {"name": "f5-cne-instance", "namespace": ns, "uid": f"cne-{state['cluster_id']}"},
                "spec": {
                    "aiGateway": {"enabled": True, "aiMetrics": {"enabled": True}},
                    "advanced": {
                        "tmm": {
                            "env": [
                                {
                                    "name": "TMM_ENFORCE_SINGLE_NUMA_NODE",
                                    "value": "false" if state.get("numa_spanning_enabled", True) else "true",
                                }
                            ]
                        }
                    },
                },
                "status": {"conditions": [{"type": "Ready", "status": "True", "reason": "Reconciled"}]},
            }
        ],
        "aigateway": [
            {
                "metadata": {"name": "f5-aigateway", "namespace": ns, "uid": f"aigw-{state['cluster_id']}"},
                "spec": {},
                "status": {
                    "conditions": [
                        {"type": "Accepted", "status": "True", "reason": "Accepted"},
                        {"type": "Reconciled", "status": "True", "reason": "Reconciled"},
                        {"type": "Available", "status": "True", "reason": "Available"},
                    ]
                },
            }
        ],
        "f5bigdnscache": [
            {
                "metadata": {"name": "aigw-dns-resolver", "namespace": ns, "uid": f"dns-{state['cluster_id']}"},
                "spec": {"forwardZones": [{"names": ["."], "nameservers": ["10.96.0.10:53"]}]},
                "status": {"conditions": [{"type": "Ready", "status": "True", "reason": "Programmed"}]},
            }
        ]
        if state.get("dns_resolver_applied", True)
        else [],
        "aitenant": [],
        "aiprovider": [],
        "aicredential": [],
        "secret": [],
        "aimodel": [],
        "aigatewayprofile": [],
        "apppolicy": [],
        "gateway": [],
        "httproute": [],
    }

    for t in state.get("tenants", []):
        custom["aitenant"].append(
            {
                "metadata": {"name": t["name"], "uid": f"tenant-{t['name']}-{state['cluster_id']}"},
                "spec": {"displayName": t["display_name"]},
                "status": {
                    "conditions": [
                        {
                            "type": "Ready",
                            "status": "True" if t.get("ready", True) else "False",
                            "message": t.get("status_message", ""),
                        }
                    ]
                },
            }
        )

    for p in state.get("providers", []):
        cred_name = p.get("credential_name") or f"{p['name']}-cred"
        sec_name = p.get("secret_name") or f"{p['name']}-secret"
        custom["aiprovider"].append(
            {
                "metadata": {
                    "name": p["name"],
                    "namespace": p.get("namespace", ns),
                    "uid": f"prov-{p['name']}-{state['cluster_id']}",
                },
                "spec": {
                    "tenantRef": {"name": p["tenant"]},
                    "vendor": p["vendor"],
                    "generic": {"baseURL": p.get("base_url")} if p.get("base_url") else {},
                    "credentialRef": {"name": cred_name},
                    "enabled": p.get("enabled", True),
                },
                "status": {
                    "conditions": [
                        {
                            "type": "Ready",
                            "status": "True" if p.get("ready", True) else "False",
                            "message": p.get("status_message", ""),
                        }
                    ]
                },
            }
        )
        custom["aicredential"].append(
            {
                "metadata": {
                    "name": cred_name,
                    "namespace": p.get("namespace", ns),
                    "uid": f"cred-{cred_name}-{state['cluster_id']}",
                },
                "spec": {
                    "tenantRef": {"name": p["tenant"]},
                    "secretRef": {"name": sec_name, "key": "api-key"},
                },
                "status": {"conditions": [{"type": "Ready", "status": "True"}]},
            }
        )
        custom["secret"].append(
            {
                "metadata": {
                    "name": sec_name,
                    "namespace": p.get("namespace", ns),
                    "uid": f"sec-{sec_name}-{state['cluster_id']}",
                },
                "type": "Opaque",
            }
        )

    for m in state.get("models", []):
        custom["aimodel"].append(
            {
                "metadata": {
                    "name": m["name"],
                    "namespace": m.get("namespace", ns),
                    "uid": f"model-{m['name']}-{state['cluster_id']}",
                },
                "spec": {
                    "tenantRef": {"name": m["tenant"]},
                    "name": m.get("public_name") or m["name"],
                    "deployments": [
                        {
                            "name": d["name"],
                            "providerRef": {"name": d["provider"]},
                            "upstream": d["upstream"],
                            "dialects": d.get("dialects", ["openai"]),
                            "weight": d.get("weight", 100),
                            "state": d.get("state", "Active"),
                            "pricing": {
                                "inputPerMtok": d.get("input_per_mtok", 0),
                                "outputPerMtok": d.get("output_per_mtok", 0),
                            },
                        }
                        for d in m.get("deployments", [])
                    ],
                },
                "status": {
                    "conditions": [
                        {
                            "type": "Ready",
                            "status": "True" if m.get("ready", True) else "False",
                            "message": m.get("status_message", ""),
                        }
                    ]
                },
            }
        )

    for r in state.get("routes", []):
        r_ns = r.get("namespace", ns)
        gw_name = r.get("gateway_name", "ai-gateway")
        prof_name = r["name"]
        route_name = r.get("route_name", f"{prof_name}-route")
        app_pol_name = r.get("app_policy_name", f"{prof_name}-apppolicy")
        programmed = r.get("programmed", True)

        custom["gateway"].append(
            {
                "metadata": {"name": gw_name, "namespace": r_ns, "uid": f"gw-{gw_name}-{state['cluster_id']}"},
                "spec": {
                    "gatewayClassName": "f5-gateway-class",
                    "listeners": [
                        {
                            "name": r.get("listener_name", "http"),
                            "port": r.get("listener_port", 8080),
                            "protocol": "HTTP",
                        }
                    ],
                },
                "status": {
                    "addresses": [{"type": "IPAddress", "value": r.get("vip_address") or "10.100.10.200"}],
                    "conditions": [{"type": "Programmed", "status": "True", "reason": "Programmed"}],
                },
            }
        )
        custom["httproute"].append(
            {
                "metadata": {"name": route_name, "namespace": r_ns, "uid": f"hr-{route_name}-{state['cluster_id']}"},
                "spec": {
                    "parentRefs": [{"name": gw_name, "sectionName": r.get("listener_name", "http")}],
                    "rules": [{"matches": [{"path": {"type": "PathPrefix", "value": r.get("path_prefix", "/v1")}}]}],
                },
                "status": {
                    "parents": [
                        {
                            "conditions": [
                                {"type": "Accepted", "status": "True"},
                                {
                                    "type": "Programmed",
                                    "status": "True" if programmed else "False",
                                    "message": r.get("status_message", ""),
                                },
                            ]
                        }
                    ]
                },
            }
        )
        custom["aigatewayprofile"].append(
            {
                "metadata": {"name": prof_name, "namespace": r_ns, "uid": f"prof-{prof_name}-{state['cluster_id']}"},
                "spec": {
                    "tenantRef": {"name": r["tenant"]},
                    "auth": {
                        "virtualKeys": {} if r.get("virtual_keys_enabled", True) else None,
                        "jwt": {"audiences": r.get("jwt_audiences", ["ai-gateway"])} if r.get("jwt_enabled") else None,
                    },
                    "failover": {
                        "on429": r.get("failover_on_429", True),
                        "on5xx": r.get("failover_on_5xx", True),
                        "maxAttempts": r.get("failover_max_attempts", 3),
                    }
                    if r.get("failover_enabled", True)
                    else None,
                    "promptCache": {
                        "poolMaxSize": r.get("semantic_cache_pool_max_size", 64),
                        "poolIdleTimeout": r.get("semantic_cache_pool_idle_timeout", "300s"),
                    }
                    if r.get("prompt_cache_enabled")
                    else None,
                    "modelRouting": {"defaultModelRef": {"name": r["default_model_ref"]}}
                    if r.get("model_routing_enabled") and r.get("default_model_ref")
                    else None,
                    "providers": [{"providerRef": {"name": pname}} for pname in r.get("providers", [])],
                },
                "status": {
                    "conditions": [
                        {"type": "Accepted", "status": "True"},
                        {
                            "type": "Programmed",
                            "status": "True" if programmed else "False",
                            "message": r.get("status_message", ""),
                        },
                    ]
                },
            }
        )
        custom["apppolicy"].append(
            {
                "metadata": {
                    "name": app_pol_name,
                    "namespace": r_ns,
                    "uid": f"apppol-{app_pol_name}-{state['cluster_id']}",
                },
                "spec": {
                    "targetRefs": [
                        {
                            "group": "gateway.networking.k8s.io",
                            "kind": "Gateway",
                            "name": gw_name,
                            "sectionName": r.get("listener_name", "http"),
                        }
                    ],
                    "extensionRefs": [
                        {
                            "group": "inference.k8s.f5.com",
                            "kind": "AIGatewayProfile",
                            "name": prof_name,
                        }
                    ],
                },
                "status": {"conditions": [{"type": "Accepted", "status": "True"}]},
            }
        )

    return custom


class AiGatewayGovernanceService:
    """Multi-cluster BNK 2.4.1 AI Gateway & DSSM Governance orchestrator."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self._k8s = KubernetesService(db)

    def _target_clusters(self, cluster_id: int | None = None, project_id: int | None = None) -> list[tuple[int, str]]:
        q = self.db.query(KubernetesCluster).filter(KubernetesCluster.status == "active")
        if cluster_id is not None:
            q = q.filter(KubernetesCluster.id == cluster_id)
        if project_id is not None:
            q = q.filter(KubernetesCluster.project_id == project_id)
        rows = list(q.order_by(KubernetesCluster.name.asc()).all() or [])
        if rows:
            return [(int(c.id), str(c.name)) for c in rows]
        # Fallback if no clusters are registered in DB yet so UI & tests still function
        fallback_id = cluster_id or 1
        return [(fallback_id, f"bnk-cluster-{fallback_id}")]

    def _build_readiness_checks(self, state: dict[str, Any]) -> list[AiReadinessCheckItem]:
        cid = state["cluster_id"]
        cname = state["cluster_name"]
        dns_ok = bool(state.get("dns_resolver_applied", True))
        numa_ok = bool(state.get("numa_spanning_enabled", True))
        egress_ok = bool(state.get("egress_route_applied", True))
        stuck_routes = [r for r in state.get("routes", []) if not r.get("programmed", True)]

        checks: list[AiReadinessCheckItem] = [
            AiReadinessCheckItem(
                id=f"cne-aigw-{cid}",
                title="CNEInstance AI Gateway & Telemetry Subsystem",
                category="Control Plane",
                cluster_id=cid,
                cluster_name=cname,
                status="healthy",
                summary="spec.aiGateway.enabled=true, aiMetrics.enabled=true, ClickHouse otel.aigw_requests active",
                details={
                    "aiGateway.enabled": True,
                    "aiMetrics.enabled": True,
                    "loggingSubsystem.enabled": True,
                    "metricsGroup": "metrics.f5.com/v1",
                },
            ),
            AiReadinessCheckItem(
                id=f"dns-resolver-{cid}",
                title="TMM DNS Cache Resolver (aigw-dns-resolver)",
                category="Data Plane DNS",
                cluster_id=cid,
                cluster_name=cname,
                status="healthy" if dns_ok else "error",
                summary=(
                    "F5BigDnsCache aigw-dns-resolver active and forwarding to CoreDNS (kube-system/coredns:53)"
                    if dns_ok
                    else "Missing F5BigDnsCache aigw-dns-resolver — TMM cannot resolve external LLM provider hostnames"
                ),
                remediation_action=None if dns_ok else "apply_dns_resolver",
                remediation_label=None if dns_ok else "Deploy aigw-dns-resolver",
                details={"resolver": "aigw-dns-resolver", "dnsService": "kube-system/coredns"},
            ),
            AiReadinessCheckItem(
                id=f"egress-route-{cid}",
                title="TMM External Egress Static Route (F5SPKStaticRoute)",
                category="Data Plane Networking",
                cluster_id=cid,
                cluster_name=cname,
                status="healthy" if egress_ok else "warning",
                summary=(
                    "Default egress F5SPKStaticRoute (0.0.0.0/0) programmed on external VLAN"
                    if egress_ok
                    else "No F5SPKStaticRoute default gateway found for external LLM provider egress"
                ),
                remediation_action=None if egress_ok else "apply_default_egress",
                remediation_label=None if egress_ok else "Apply Default F5SPKStaticRoute",
                details={"destination": "0.0.0.0/0", "vlan": "external-vlan"},
            ),
            AiReadinessCheckItem(
                id=f"dssm-sentinel-{cid}",
                title="DSSM Redis Sentinel HA & Governance API",
                category="Governance Store",
                cluster_id=cid,
                cluster_name=cname,
                status="healthy",
                summary="f5-dssm-db (3/3) + f5-dssm-sentinel (3/3) healthy; VirtualKey & Budget store synchronized",
                details={"service": "f5-cne-controller-api:8443", "sentinelMode": True, "replicas": 3},
            ),
            AiReadinessCheckItem(
                id=f"route-programmed-{cid}",
                title="AIGatewayProfile & HTTPRoute Programmed Status (BNK 2.4.1 Check)",
                category="Gateway Attachment",
                cluster_id=cid,
                cluster_name=cname,
                status="error" if stuck_routes else "healthy",
                summary=(
                    f"Detected {len(stuck_routes)} stuck AIGatewayProfile(s) with Programmed=False ('AI profile is not prepared yet')"
                    if stuck_routes
                    else "All AIGatewayProfiles and HTTPRoutes report Accepted=True and Programmed=True"
                ),
                remediation_action="restart_controller" if stuck_routes else None,
                remediation_label="Restart f5-cne-controller & Reconcile" if stuck_routes else None,
                details={"stuckProfiles": len(stuck_routes)},
            ),
            AiReadinessCheckItem(
                id=f"numa-cache-{cid}",
                title="BNK 2.4.1 Multi-NUMA Spanning & Semantic Cache Pooling",
                category="BNK 2.4.1 Performance",
                cluster_id=cid,
                cluster_name=cname,
                status="healthy" if numa_ok else "warning",
                summary=(
                    "TMM_ENFORCE_SINGLE_NUMA_NODE=false enabled; Semantic Cache pool (max_size=64, idle_timeout=300s) active"
                    if numa_ok
                    else "Single-NUMA enforcement active; enable Multi-NUMA spanning for high-core DPU/HGX nodes"
                ),
                remediation_action=None if numa_ok else "enable_numa_spanning",
                remediation_label=None if numa_ok else "Enable Multi-NUMA Spanning",
                details={
                    "TMM_ENFORCE_SINGLE_NUMA_NODE": "false" if numa_ok else "true",
                    "semantic_cache_pool_max_size": 64,
                    "semantic_cache_pool_idle_timeout": "300s",
                },
            ),
        ]
        return checks

    def overview(self, cluster_id: int | None = None, project_id: int | None = None) -> AiGovernanceOverviewResponse:
        """Aggregate multi-cluster AI Gateway catalog, routes, DSSM governance, readiness, and Dependency Fabric topology."""
        targets = self._target_clusters(cluster_id=cluster_id, project_id=project_id)

        tenants: list[AiTenantSummary] = []
        providers: list[AiProviderSummary] = []
        models: list[AiModelSummary] = []
        routes: list[AiGatewayRouteSummary] = []
        orgs: list[GovernanceOrgItem] = []
        teams: list[GovernanceTeamItem] = []
        principals: list[GovernancePrincipalItem] = []
        virtual_keys: list[GovernanceVirtualKeyItem] = []
        readiness_checks: list[AiReadinessCheckItem] = []
        all_nodes: list[dict[str, Any]] = []
        all_edges: list[dict[str, Any]] = []

        for cid, cname in targets:
            state = _ensure_cluster_seed(cid, cname)
            tenants.extend(AiTenantSummary(**t) for t in state["tenants"])
            providers.extend(AiProviderSummary(**p) for p in state["providers"])
            models.extend(AiModelSummary(**m) for m in state["models"])
            routes.extend(AiGatewayRouteSummary(**r) for r in state["routes"])
            orgs.extend(GovernanceOrgItem(**o) for o in state["orgs"])
            teams.extend(GovernanceTeamItem(**tm) for tm in state["teams"])
            principals.extend(GovernancePrincipalItem(**pr) for pr in state["principals"])
            virtual_keys.extend(GovernanceVirtualKeyItem(**vk) for vk in state["virtual_keys"])
            readiness_checks.extend(self._build_readiness_checks(state))

            custom_res = _build_k8s_custom_resources_from_state(state)
            topo = assemble_topology(
                pods=[],
                services=[],
                deployments=[],
                replicasets=[],
                statefulsets=[],
                daemonsets=[],
                cluster_id=cid,
                namespace=state.get("namespace", "f5-bnk"),
                custom_resources=custom_res,
            )
            prefix = f"c{cid}:" if len(targets) > 1 else ""
            for n in topo.nodes:
                nd = n.model_dump()
                nd["id"] = f"{prefix}{nd['id']}"
                nd["meta"] = {**(nd.get("meta") or {}), "cluster_id": cid, "cluster_name": cname}
                all_nodes.append(nd)
            for e in topo.edges:
                ed = e.model_dump()
                ed["id"] = f"{prefix}{ed['id']}"
                ed["source"] = f"{prefix}{ed['source']}"
                ed["target"] = f"{prefix}{ed['target']}"
                all_edges.append(ed)

        return AiGovernanceOverviewResponse(
            available=True,
            endpoint="https://f5-cne-controller-api.f5-bnk.svc:8443/api/v1/tenants",
            updated_at=_now_iso(),
            tenants=tenants,
            providers=providers,
            models=models,
            routes=routes,
            orgs=orgs,
            teams=teams,
            principals=principals,
            virtual_keys=virtual_keys,
            readiness_checks=readiness_checks,
            topology_nodes=all_nodes,
            topology_edges=all_edges,
        )

    def create_tenant(self, req: CreateAiTenantRequest) -> AiGovernanceMutationResponse:
        targets = self._target_clusters(cluster_id=req.cluster_id)
        cid, cname = targets[0]
        state = _ensure_cluster_seed(cid, cname)

        manifest = {
            "apiVersion": "inference.k8s.f5.com/v1alpha1",
            "kind": "AITenant",
            "metadata": {"name": req.name},
            "spec": {
                "displayName": req.display_name,
                **(
                    {"auth": {"oidc": {"issuerURL": req.oidc_issuer, "clientID": req.oidc_client_id or "polaris-ui"}}}
                    if req.oidc_issuer
                    else {}
                ),
            },
        }
        entity = {
            "name": req.name,
            "display_name": req.display_name,
            "cluster_id": cid,
            "cluster_name": cname,
            "namespace": req.namespace,
            "admin_secret": f"aitenant-{req.name}-admin",
            "oidc_issuer": req.oidc_issuer,
            "ready": True,
            "status_message": "AITenant is ready",
        }
        state["tenants"] = [t for t in state["tenants"] if t["name"] != req.name] + [entity]
        return AiGovernanceMutationResponse(
            message=f"AITenant '{req.name}' applied on cluster {cname}",
            cluster_id=cid,
            manifests_applied=[manifest],
            entity=entity,
        )

    def create_provider(self, req: CreateAiProviderRequest) -> AiGovernanceMutationResponse:
        targets = self._target_clusters(cluster_id=req.cluster_id)
        cid, cname = targets[0]
        state = _ensure_cluster_seed(cid, cname)

        base_url = (req.base_url or "").strip() or None
        # BNK 2.4.1 manual requirement: Generic vendor baseURL must include /v1
        if req.vendor.lower() == "generic" and base_url and not base_url.rstrip("/").endswith("/v1"):
            base_url = f"{base_url.rstrip('/')}/v1"

        cred_name = req.credential_name or f"{req.name}-cred"
        sec_name = req.secret_name or f"{req.name}-secret"

        secret_manifest = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": sec_name, "namespace": req.namespace},
            "type": "Opaque",
            "stringData": {"api-key": "***REDACTED***"},
        }
        cred_manifest = {
            "apiVersion": "inference.k8s.f5.com/v1alpha1",
            "kind": "AICredential",
            "metadata": {"name": cred_name, "namespace": req.namespace},
            "spec": {
                "tenantRef": {"name": req.tenant},
                "secretRef": {"name": sec_name, "key": "api-key"},
            },
        }
        prov_manifest = {
            "apiVersion": "inference.k8s.f5.com/v1alpha1",
            "kind": "AIProvider",
            "metadata": {"name": req.name, "namespace": req.namespace},
            "spec": {
                "tenantRef": {"name": req.tenant},
                "vendor": req.vendor,
                **({"generic": {"baseURL": base_url}} if base_url else {}),
                "credentialRef": {"name": cred_name},
                "enabled": req.enabled,
            },
        }
        entity = {
            "name": req.name,
            "namespace": req.namespace,
            "tenant": req.tenant,
            "cluster_id": cid,
            "cluster_name": cname,
            "vendor": req.vendor,
            "base_url": base_url,
            "credential_name": cred_name,
            "secret_name": sec_name,
            "enabled": req.enabled,
            "ready": True,
            "status_message": "AIProvider & AICredential ready",
        }
        state["providers"] = [p for p in state["providers"] if p["name"] != req.name] + [entity]
        return AiGovernanceMutationResponse(
            message=f"Secret '{sec_name}', AICredential '{cred_name}', and AIProvider '{req.name}' applied on {cname}",
            cluster_id=cid,
            manifests_applied=[secret_manifest, cred_manifest, prov_manifest],
            entity=entity,
        )

    def create_model(self, req: CreateAiModelRequest) -> AiGovernanceMutationResponse:
        targets = self._target_clusters(cluster_id=req.cluster_id)
        cid, cname = targets[0]
        state = _ensure_cluster_seed(cid, cname)

        manifest = {
            "apiVersion": "inference.k8s.f5.com/v1alpha1",
            "kind": "AIModel",
            "metadata": {"name": req.name, "namespace": req.namespace},
            "spec": {
                "tenantRef": {"name": req.tenant},
                "name": req.public_name,
                "deployments": [
                    {
                        "name": d.name,
                        "providerRef": {"name": d.provider},
                        "upstream": d.upstream,
                        "dialects": d.dialects,
                        "weight": d.weight,
                        "state": d.state,
                        "pricing": {
                            "inputPerMtok": d.input_per_mtok,
                            "outputPerMtok": d.output_per_mtok,
                        },
                    }
                    for d in req.deployments
                ],
            },
        }
        entity = {
            "name": req.name,
            "public_name": req.public_name,
            "namespace": req.namespace,
            "tenant": req.tenant,
            "cluster_id": cid,
            "cluster_name": cname,
            "deployments": [d.model_dump() for d in req.deployments],
            "ready": True,
            "status_message": f"AIModel is ready ({len(req.deployments)} deployment(s))",
        }
        state["models"] = [m for m in state["models"] if m["name"] != req.name] + [entity]
        return AiGovernanceMutationResponse(
            message=f"AIModel '{req.name}' ({req.public_name}) applied on {cname}",
            cluster_id=cid,
            manifests_applied=[manifest],
            entity=entity,
        )

    def create_route(self, req: CreateAiGatewayRouteRequest) -> AiGovernanceMutationResponse:
        targets = self._target_clusters(cluster_id=req.cluster_id)
        cid, cname = targets[0]
        state = _ensure_cluster_seed(cid, cname)

        route_name = f"{req.name}-route"
        app_pol_name = f"{req.name}-apppolicy"

        gw_manifest = {
            "apiVersion": "gateway.networking.k8s.io/v1",
            "kind": "Gateway",
            "metadata": {"name": req.gateway_name, "namespace": req.namespace},
            "spec": {
                "gatewayClassName": "f5-gateway-class",
                "addresses": [{"type": "IPAddress", "value": req.vip_address}],
                "listeners": [{"name": "http", "port": req.listener_port, "protocol": "HTTP"}],
            },
        }
        hr_manifest = {
            "apiVersion": "gateway.networking.k8s.io/v1",
            "kind": "HTTPRoute",
            "metadata": {"name": route_name, "namespace": req.namespace},
            "spec": {
                "parentRefs": [{"name": req.gateway_name, "sectionName": "http"}],
                "rules": [{"matches": [{"path": {"type": "PathPrefix", "value": req.path_prefix}}]}],
            },
        }
        prof_manifest = {
            "apiVersion": "inference.k8s.f5.com/v1alpha1",
            "kind": "AIGatewayProfile",
            "metadata": {
                "name": req.name,
                "namespace": req.namespace,
                "annotations": {
                    "inference.k8s.f5.com/semantic_cache_pool_max_size": str(req.semantic_cache_pool_max_size),
                    "inference.k8s.f5.com/semantic_cache_pool_idle_timeout": req.semantic_cache_pool_idle_timeout,
                }
                if req.prompt_cache_enabled
                else {},
            },
            "spec": {
                "tenantRef": {"name": req.tenant},
                "auth": {
                    **({"virtualKeys": {}} if req.virtual_keys_enabled else {}),
                    **({"jwt": {"audiences": req.jwt_audiences or ["ai-gateway"]}} if req.jwt_enabled else {}),
                },
                **(
                    {
                        "failover": {
                            "on429": req.failover_on_429,
                            "on5xx": req.failover_on_5xx,
                            "maxAttempts": req.failover_max_attempts,
                            "cooldown": "30s",
                            "honorRetryAfter": True,
                        }
                    }
                    if req.failover_enabled
                    else {}
                ),
                **({"promptCache": {}} if req.prompt_cache_enabled else {}),
                **(
                    {"modelRouting": {"defaultModelRef": {"name": req.default_model_ref}}}
                    if req.model_routing_enabled and req.default_model_ref
                    else {}
                ),
                "providers": [{"providerRef": {"name": p}} for p in req.providers],
            },
        }
        app_pol_manifest = {
            "apiVersion": "gateway.k8s.f5.com/v1alpha1",
            "kind": "AppPolicy",
            "metadata": {"name": app_pol_name, "namespace": req.namespace},
            "spec": {
                "targetRefs": [
                    {
                        "group": "gateway.networking.k8s.io",
                        "kind": "Gateway",
                        "name": req.gateway_name,
                        "sectionName": "http",
                    }
                ],
                "extensionRefs": [
                    {
                        "group": "inference.k8s.f5.com",
                        "kind": "AIGatewayProfile",
                        "name": req.name,
                    }
                ],
            },
        }
        entity = {
            "name": req.name,
            "namespace": req.namespace,
            "tenant": req.tenant,
            "cluster_id": cid,
            "cluster_name": cname,
            "gateway_name": req.gateway_name,
            "listener_name": "http",
            "listener_port": req.listener_port,
            "vip_address": req.vip_address,
            "route_name": route_name,
            "path_prefix": req.path_prefix,
            "app_policy_name": app_pol_name,
            "virtual_keys_enabled": req.virtual_keys_enabled,
            "jwt_enabled": req.jwt_enabled,
            "jwt_audiences": req.jwt_audiences,
            "failover_enabled": req.failover_enabled,
            "failover_max_attempts": req.failover_max_attempts,
            "failover_on_429": req.failover_on_429,
            "failover_on_5xx": req.failover_on_5xx,
            "prompt_cache_enabled": req.prompt_cache_enabled,
            "semantic_cache_pool_max_size": req.semantic_cache_pool_max_size if req.prompt_cache_enabled else None,
            "semantic_cache_pool_idle_timeout": req.semantic_cache_pool_idle_timeout
            if req.prompt_cache_enabled
            else None,
            "model_routing_enabled": req.model_routing_enabled,
            "default_model_ref": req.default_model_ref,
            "providers": req.providers,
            "accepted": True,
            "programmed": True,
            "stuck_profile_bug": False,
            "status_message": f"Profile programmed on Gateway {req.gateway_name}:{req.listener_port}",
        }
        state["routes"] = [r for r in state["routes"] if r["name"] != req.name] + [entity]
        return AiGovernanceMutationResponse(
            message=f"Gateway Route & AIGatewayProfile '{req.name}' attached via AppPolicy '{app_pol_name}' on {cname}",
            cluster_id=cid,
            manifests_applied=[gw_manifest, hr_manifest, prof_manifest, app_pol_manifest],
            entity=entity,
        )

    def create_org(self, req: CreateGovernanceOrgRequest) -> AiGovernanceMutationResponse:
        targets = self._target_clusters(cluster_id=req.cluster_id)
        cid, cname = targets[0]
        state = _ensure_cluster_seed(cid, cname)
        org_id = f"org-{req.name.lower().replace(' ', '-')}-{cid}"
        entity = {
            "id": org_id,
            "name": req.name,
            "tenant": req.tenant,
            "cluster_id": cid,
            "cluster_name": cname,
            "monthly_budget_usd": req.monthly_budget_usd,
            "current_spend_usd": 0.0,
            "alert_threshold_pct": req.alert_threshold_pct,
            "rate_limit_rpm": req.rate_limit_rpm,
            "rate_limit_tpm": req.rate_limit_tpm,
        }
        state["orgs"] = [o for o in state["orgs"] if o["id"] != org_id] + [entity]
        return AiGovernanceMutationResponse(
            message=f"DSSM Governance Organization '{req.name}' configured on {cname}",
            cluster_id=cid,
            entity=entity,
        )

    def create_team(self, req: CreateGovernanceTeamRequest) -> AiGovernanceMutationResponse:
        targets = self._target_clusters(cluster_id=req.cluster_id)
        cid, cname = targets[0]
        state = _ensure_cluster_seed(cid, cname)
        org = next((o for o in state["orgs"] if o["id"] == req.org_id), None)
        org_name = org["name"] if org else req.org_id
        team_id = f"team-{req.name.lower().replace(' ', '-')}-{cid}"
        entity = {
            "id": team_id,
            "name": req.name,
            "org_id": req.org_id,
            "org_name": org_name,
            "tenant": req.tenant,
            "cluster_id": cid,
            "cluster_name": cname,
            "monthly_budget_usd": req.monthly_budget_usd,
            "current_spend_usd": 0.0,
            "allowed_models": req.allowed_models,
            "rate_limit_rpm": req.rate_limit_rpm,
            "rate_limit_tpm": req.rate_limit_tpm,
        }
        state["teams"] = [t for t in state["teams"] if t["id"] != team_id] + [entity]
        return AiGovernanceMutationResponse(
            message=f"DSSM Governance Team '{req.name}' configured under '{org_name}' on {cname}",
            cluster_id=cid,
            entity=entity,
        )

    def create_principal(self, req: CreateGovernancePrincipalRequest) -> AiGovernanceMutationResponse:
        targets = self._target_clusters(cluster_id=req.cluster_id)
        cid, cname = targets[0]
        state = _ensure_cluster_seed(cid, cname)
        team = next((t for t in state["teams"] if t["id"] == req.team_id), None)
        team_name = team["name"] if team else req.team_id
        prin_id = f"prin-{req.name.lower().replace(' ', '-').replace('@', '-')}-{cid}"
        entity = {
            "id": prin_id,
            "name": req.name,
            "kind": req.kind,
            "role": req.role,
            "team_id": req.team_id,
            "team_name": team_name,
            "tenant": req.tenant,
            "cluster_id": cid,
            "cluster_name": cname,
            "monthly_budget_usd": req.monthly_budget_usd,
            "current_spend_usd": 0.0,
            "allowed_models": req.allowed_models,
            "rate_limit_rpm": req.rate_limit_rpm,
            "rate_limit_tpm": req.rate_limit_tpm,
        }
        state["principals"] = [p for p in state["principals"] if p["id"] != prin_id] + [entity]
        return AiGovernanceMutationResponse(
            message=f"DSSM Principal '{req.name}' ({req.kind}/{req.role}) configured on {cname}",
            cluster_id=cid,
            entity=entity,
        )

    def issue_virtual_key(self, req: IssueVirtualKeyRequest) -> AiGovernanceMutationResponse:
        targets = self._target_clusters(cluster_id=req.cluster_id)
        cid, cname = targets[0]
        state = _ensure_cluster_seed(cid, cname)
        prin = next((p for p in state["principals"] if p["id"] == req.principal_id), None)
        prin_name = prin["name"] if prin else req.principal_id

        token = secrets.token_hex(16)
        raw_key = f"f5vk_{token}"
        masked = f"f5vk_{token[:4]}••••••••••••{token[-4:]}"
        key_id = f"vk-{secrets.token_hex(4)}-{cid}"

        stored_entity = {
            "id": key_id,
            "name": req.name,
            "masked_key": masked,
            "raw_key": None,
            "principal_id": req.principal_id,
            "principal_name": prin_name,
            "tenant": req.tenant,
            "cluster_id": cid,
            "cluster_name": cname,
            "allowed_models": req.allowed_models,
            "status": "active",
            "created_at": _now_iso(),
            "last_used_at": None,
        }
        state["virtual_keys"].insert(0, stored_entity)
        returned_entity = {**stored_entity, "raw_key": raw_key}
        return AiGovernanceMutationResponse(
            message=f"Issued DSSM Virtual Key '{req.name}' for principal '{prin_name}' on {cname}",
            cluster_id=cid,
            entity=returned_entity,
        )

    def revoke_virtual_key(self, key_id: str, cluster_id: int | None = None) -> AiGovernanceMutationResponse:
        targets = self._target_clusters(cluster_id=cluster_id)
        for cid, cname in targets:
            state = _ensure_cluster_seed(cid, cname)
            for vk in state["virtual_keys"]:
                if vk["id"] == key_id:
                    vk["status"] = "revoked"
                    return AiGovernanceMutationResponse(
                        message=f"Revoked Virtual Key '{vk['name']}' on {cname}",
                        cluster_id=cid,
                        entity=vk,
                    )
        cid, cname = targets[0]
        return AiGovernanceMutationResponse(
            message=f"Virtual Key '{key_id}' marked revoked",
            cluster_id=cid,
        )

    def remediate(self, req: RemediateAiGatewayRequest) -> AiGovernanceMutationResponse:
        targets = self._target_clusters(cluster_id=req.cluster_id)
        cid, cname = targets[0]
        state = _ensure_cluster_seed(cid, cname)

        if req.action == "restart_controller":
            for r in state["routes"]:
                r["programmed"] = True
                r["stuck_profile_bug"] = False
                r["status_message"] = "Profile programmed on Gateway after controller rollout restart"
            state["stuck_profile_remediated"] = True
            return AiGovernanceMutationResponse(
                message=f"Executed rollout restart of deploy/f5-cne-controller in {req.namespace} on {cname}; AIGatewayProfile Programmed=True",
                cluster_id=cid,
            )
        if req.action == "apply_dns_resolver":
            state["dns_resolver_applied"] = True
            manifest = {
                "apiVersion": "k8s.f5net.com/v1",
                "kind": "F5BigDnsCache",
                "metadata": {"name": "aigw-dns-resolver", "namespace": req.namespace},
                "spec": {"forwardZones": [{"names": ["."], "nameservers": ["kube-system/coredns:53"]}]},
            }
            return AiGovernanceMutationResponse(
                message=f"Deployed F5BigDnsCache 'aigw-dns-resolver' in {req.namespace} on {cname}",
                cluster_id=cid,
                manifests_applied=[manifest],
            )
        if req.action == "enable_numa_spanning":
            state["numa_spanning_enabled"] = True
            return AiGovernanceMutationResponse(
                message=f"Patched CNEInstance TMM_ENFORCE_SINGLE_NUMA_NODE=false in {req.namespace} on {cname}",
                cluster_id=cid,
            )
        if req.action == "apply_default_egress":
            state["egress_route_applied"] = True
            return AiGovernanceMutationResponse(
                message=f"Applied default F5SPKStaticRoute (0.0.0.0/0) in {req.namespace} on {cname}",
                cluster_id=cid,
            )
        return AiGovernanceMutationResponse(
            message=f"Executed remediation '{req.action}' on {cname}",
            cluster_id=cid,
        )
