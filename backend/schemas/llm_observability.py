"""
Pydantic v2 response models for AI-gateway observability (Tier 1).

Every model carries the degradation envelope so a panel can render an
"unavailable" state without the UI crashing:
  - ``available`` / ``reason`` — false + reason when Loki can't be reached.
  - ``endpoint`` — the in-cluster Loki service the query was proxied to.
  - ``updated_at`` — ISO-8601 timestamp of the response.
  - ``errors`` — per-query error map for partial failures (never raised).

Data fields default to empty/zero so an unavailable envelope validates
without supplying them. ``reason`` is declared here (not in the design's
contract table) because ``response_model`` silently drops undeclared fields.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class _Envelope(BaseModel):
    """Shared degradation fields on every observability response."""

    available: bool
    endpoint: str | None = None
    updated_at: str
    reason: str | None = None
    errors: dict[str, str] = Field(default_factory=dict)


class LlmStatsResponse(_Envelope):
    total_requests: int = 0
    success_rate: float = 0.0
    avg_latency_ms: float = 0.0
    total_tokens: int = 0
    total_cost: float = 0.0
    models: int = 0


class HistogramPoint(BaseModel):
    ts: str
    value: float


class HistogramSeries(BaseModel):
    name: str
    points: list[HistogramPoint] = Field(default_factory=list)


class LlmHistogramResponse(_Envelope):
    metric: str = ""
    step_s: int = 0
    series: list[HistogramSeries] = Field(default_factory=list)


class RankingTrend(BaseModel):
    requests: float | None = None
    tokens: float | None = None
    cost: float | None = None


class RankingRow(BaseModel):
    model: str
    provider: str
    requests: int = 0
    success_rate: float = 0.0
    tokens: int = 0
    cost: float = 0.0
    avg_latency_ms: float = 0.0
    trend: RankingTrend = Field(default_factory=RankingTrend)


class LlmRankingsResponse(_Envelope):
    rows: list[RankingRow] = Field(default_factory=list)


class LlmProviderUsageResponse(_Envelope):
    """Same envelope as histogram; series keyed by inferred provider."""

    metric: str = ""
    step_s: int = 0
    series: list[HistogramSeries] = Field(default_factory=list)


class LogRow(BaseModel):
    ts: str
    type: str
    message: str
    model: str
    latency_ms: float
    prompt_tk: int
    comp_tk: int
    total_tk: int
    cost: float
    status: str
    req_body: str
    resp_body: str
    cluster_id: int | None = None
    cluster_name: str | None = None


class LlmLogsResponse(_Envelope):
    rows: list[LogRow] = Field(default_factory=list)
    next_end: str | None = None


class LlmFilterDataResponse(_Envelope):
    models: list[str] = Field(default_factory=list)
    statuses: list[str] = Field(default_factory=list)


# =============================================================================
# BNK 2.4.1 Multi-Cluster AI Gateway & DSSM Governance Console Schemas
# =============================================================================


class AiTenantSummary(BaseModel):
    name: str
    display_name: str = ""
    cluster_id: int
    cluster_name: str = ""
    namespace: str = "f5-bnk"
    admin_secret: str = "polaris-bootstrap-admin"
    oidc_issuer: str | None = None
    ready: bool = True
    status_message: str = "AITenant is ready"
    status: str = "Ready"
    models_count: int = 0
    providers_count: int = 0

    @model_validator(mode="after")
    def _sync_aliases(self) -> AiTenantSummary:
        if not self.display_name:
            self.display_name = self.name
        self.status = "Ready" if self.ready else "Degraded"
        return self


class AiProviderSummary(BaseModel):
    name: str
    namespace: str
    tenant: str = "default"
    tenant_ref: str = ""
    cluster_id: int
    cluster_name: str = ""
    vendor: str = "Generic"
    provider_type: str = ""
    base_url: str | None = None
    endpoint_url: str | None = None
    credential_name: str | None = None
    credential_ref: str | None = None
    secret_name: str | None = None
    secret_ref: str | None = None
    enabled: bool = True
    ready: bool = True
    status_message: str = "AIProvider is ready"
    status: str = "Ready"

    @model_validator(mode="after")
    def _sync_aliases(self) -> AiProviderSummary:
        self.tenant_ref = self.tenant_ref or self.tenant
        self.provider_type = self.provider_type or self.vendor
        self.endpoint_url = self.endpoint_url or self.base_url
        self.credential_ref = self.credential_ref or self.credential_name
        self.secret_ref = self.secret_ref or self.secret_name
        self.status = "Ready" if self.ready else "Degraded"
        return self


class AiModelDeploymentItem(BaseModel):
    name: str = ""
    provider: str = ""
    provider_ref: str = ""
    upstream: str = ""
    dialects: list[str] = Field(default_factory=lambda: ["openai"])
    weight: int = 100
    state: str = "Active"
    input_per_mtok: int = 0
    output_per_mtok: int = 0

    @model_validator(mode="after")
    def _sync_aliases(self) -> AiModelDeploymentItem:
        if self.provider_ref and not self.provider:
            self.provider = self.provider_ref
        if self.provider and not self.provider_ref:
            self.provider_ref = self.provider
        if not self.name:
            self.name = self.provider or "primary"
        if not self.upstream:
            self.upstream = self.provider or "default"
        return self


class AiModelSummary(BaseModel):
    name: str
    public_name: str = ""
    model_id: str = ""
    namespace: str
    tenant: str = "default"
    tenant_ref: str = ""
    cluster_id: int
    cluster_name: str = ""
    deployments: list[AiModelDeploymentItem] = Field(default_factory=list)
    input_token_cost_micro_usd: int = 0
    output_token_cost_micro_usd: int = 0
    ready: bool = True
    status_message: str = "AIModel is ready"
    status: str = "Ready"

    @model_validator(mode="after")
    def _sync_aliases(self) -> AiModelSummary:
        if not self.public_name and self.model_id:
            self.public_name = self.model_id
        self.model_id = self.model_id or self.public_name or self.name
        self.tenant_ref = self.tenant_ref or self.tenant
        if self.deployments:
            if self.input_token_cost_micro_usd == 0:
                self.input_token_cost_micro_usd = self.deployments[0].input_per_mtok
            if self.output_token_cost_micro_usd == 0:
                self.output_token_cost_micro_usd = self.deployments[0].output_per_mtok
        self.status = "Ready" if self.ready else "Degraded"
        return self


class AiGatewayRouteSummary(BaseModel):
    name: str
    namespace: str
    tenant: str = "default"
    tenant_ref: str = ""
    cluster_id: int
    cluster_name: str = ""
    gateway_name: str
    listener_name: str = "http"
    listener_port: int = 8080
    port: int = 8080
    vip_address: str | None = None
    route_name: str = ""
    path_prefix: str = "/v1"
    ai_gateway_profile: str = ""
    app_policy_name: str = ""
    app_policy: str | None = None
    virtual_keys_enabled: bool = True
    jwt_enabled: bool = False
    jwt_audiences: list[str] = Field(default_factory=list)
    auth_mode: str = "virtual_key"
    failover_enabled: bool = True
    failover_max_attempts: int = 3
    failover_on_429: bool = True
    failover_on_5xx: bool = True
    prompt_cache_enabled: bool = False
    semantic_cache_enabled: bool = False
    semantic_cache_similarity_threshold: float = 0.92
    semantic_cache_pool_max_size: int | None = None
    semantic_cache_pool_idle_timeout: str | None = None
    model_routing_enabled: bool = False
    default_model_ref: str | None = None
    providers: list[str] = Field(default_factory=list)
    accepted: bool = True
    programmed: bool = True
    stuck_profile_bug: bool = False
    status_message: str = "Profile programmed on Gateway"
    status: str = "Programmed"

    @model_validator(mode="after")
    def _sync_aliases(self) -> AiGatewayRouteSummary:
        self.tenant_ref = self.tenant_ref or self.tenant
        self.port = self.listener_port
        self.ai_gateway_profile = self.ai_gateway_profile or self.name
        self.app_policy = self.app_policy or self.app_policy_name
        self.semantic_cache_enabled = self.prompt_cache_enabled
        if self.virtual_keys_enabled and self.jwt_enabled:
            self.auth_mode = "virtual_key+jwt"
        elif self.jwt_enabled:
            self.auth_mode = "jwt"
        elif self.virtual_keys_enabled:
            self.auth_mode = "virtual_key"
        else:
            self.auth_mode = "none"
        if self.stuck_profile_bug:
            self.status = "StuckProfile"
        elif self.programmed:
            self.status = "Programmed"
        else:
            self.status = "Pending"
        return self


class GovernanceOrgItem(BaseModel):
    id: str
    name: str
    tenant: str = "default"
    tenant_ref: str = ""
    cluster_id: int
    cluster_name: str = ""
    monthly_budget_usd: float = 500.0
    current_spend_usd: float = 0.0
    alert_threshold_pct: int = 80
    rate_limit_rpm: int = 1200
    rate_limit_tpm: int = 500000
    rpm_limit: int = 1200
    tpm_limit: int = 500000
    teams_count: int = 1

    @model_validator(mode="after")
    def _sync_aliases(self) -> GovernanceOrgItem:
        self.tenant_ref = self.tenant_ref or self.tenant
        self.rpm_limit = self.rate_limit_rpm
        self.tpm_limit = self.rate_limit_tpm
        return self


class GovernanceTeamItem(BaseModel):
    id: str
    name: str
    org_id: str
    org_name: str
    tenant: str = "default"
    cluster_id: int
    cluster_name: str = ""
    monthly_budget_usd: float = 200.0
    current_spend_usd: float = 0.0
    allowed_models: list[str] = Field(default_factory=list)
    rate_limit_rpm: int = 600
    rate_limit_tpm: int = 200000
    rpm_limit: int = 600
    tpm_limit: int = 200000

    @model_validator(mode="after")
    def _sync_aliases(self) -> GovernanceTeamItem:
        self.rpm_limit = self.rate_limit_rpm
        self.tpm_limit = self.rate_limit_tpm
        return self


class GovernancePrincipalItem(BaseModel):
    id: str
    name: str
    kind: str = "user"  # user | service | agent
    principal_type: str = "user"
    role: str = "member"  # member | team-admin | admin
    team_id: str
    team_name: str
    org_id: str = ""
    tenant: str = "default"
    cluster_id: int
    cluster_name: str = ""
    monthly_budget_usd: float = 50.0
    current_spend_usd: float = 0.0
    allowed_models: list[str] = Field(default_factory=list)
    rate_limit_rpm: int = 120
    rate_limit_tpm: int = 60000
    rpm_limit: int = 120
    tpm_limit: int = 60000
    active_keys: int = 1

    @model_validator(mode="after")
    def _sync_aliases(self) -> GovernancePrincipalItem:
        self.principal_type = self.kind
        self.rpm_limit = self.rate_limit_rpm
        self.tpm_limit = self.rate_limit_tpm
        return self


class GovernanceVirtualKeyItem(BaseModel):
    id: str
    name: str
    masked_key: str
    raw_key: str | None = None
    cleartext_key: str | None = None
    principal_id: str
    principal_name: str
    principal_type: str = "service"
    team_name: str = "Platform AI"
    org_name: str = "Enterprise AI"
    tenant: str = "default"
    cluster_id: int
    cluster_name: str = ""
    allowed_models: list[str] = Field(default_factory=list)
    rpm_limit: int = 120
    tpm_limit: int = 60000
    monthly_budget_usd: float = 50.0
    spend_usd: float = 0.0
    status: str = "active"  # active | revoked
    created_at: str
    last_used_at: str | None = None
    expires_at: str | None = None

    @model_validator(mode="after")
    def _sync_aliases(self) -> GovernanceVirtualKeyItem:
        self.cleartext_key = self.cleartext_key or self.raw_key
        return self


class AiReadinessCheckItem(BaseModel):
    id: str
    title: str
    category: str
    cluster_id: int
    cluster_name: str = ""
    status: str  # healthy | warning | error | critical
    summary: str
    remediation_action: str | None = None
    remediation_label: str | None = None
    remediation_hint: str | None = None
    details: dict[str, str | int | bool | None] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _sync_aliases(self) -> AiReadinessCheckItem:
        self.remediation_hint = self.remediation_hint or self.remediation_label
        return self


class ClickHouseRequestAuditItem(BaseModel):
    id: str = ""
    request_id: str = ""
    timestamp: str
    cluster_id: int
    cluster_name: str = ""
    tenant: str = "default"
    route_name: str = "ai-platform-profile"
    org_name: str = "Enterprise AI Platform"
    team_name: str = "Inference Platform"
    principal_name: str = "prod-rag-pipeline"
    virtual_key_id: str = ""
    virtual_key_name: str = ""
    method: str = "POST"
    path: str = "/v1/chat/completions"
    model: str = "gpt-4o"
    model_id: str = ""
    provider: str = "openai-primary"
    provider_name: str = ""
    status_code: int = 200
    latency_ms: float = 420.0
    prompt_tokens: int = 128
    completion_tokens: int = 256
    total_tokens: int = 384
    cost_usd: float = 0.00288
    cache_status: str = "MISS"  # HIT | MISS | BYPASS
    semantic_cache_status: str = ""
    failover_used: bool = False
    failover_triggered: bool = False
    error_reason: str | None = None

    @model_validator(mode="after")
    def _sync_audit_aliases(self) -> ClickHouseRequestAuditItem:
        if not self.id and self.request_id:
            self.id = self.request_id
        if not self.request_id and self.id:
            self.request_id = self.id
        if not self.model_id and self.model:
            self.model_id = self.model
        if not self.provider_name and self.provider:
            self.provider_name = self.provider
        if not self.semantic_cache_status and self.cache_status:
            self.semantic_cache_status = self.cache_status
        if self.failover_used and not self.failover_triggered:
            self.failover_triggered = True
        if self.failover_triggered and not self.failover_used:
            self.failover_used = True
        return self


class AiGovernanceOverviewResponse(_Envelope):
    namespace: str = "f5-bnk"
    tenants: list[AiTenantSummary] = Field(default_factory=list)
    providers: list[AiProviderSummary] = Field(default_factory=list)
    models: list[AiModelSummary] = Field(default_factory=list)
    routes: list[AiGatewayRouteSummary] = Field(default_factory=list)
    orgs: list[GovernanceOrgItem] = Field(default_factory=list)
    organizations: list[GovernanceOrgItem] = Field(default_factory=list)
    teams: list[GovernanceTeamItem] = Field(default_factory=list)
    principals: list[GovernancePrincipalItem] = Field(default_factory=list)
    virtual_keys: list[GovernanceVirtualKeyItem] = Field(default_factory=list)
    readiness_checks: list[AiReadinessCheckItem] = Field(default_factory=list)
    diagnostics: list[AiReadinessCheckItem] = Field(default_factory=list)
    request_audit_logs: list[ClickHouseRequestAuditItem] = Field(default_factory=list)
    topology_nodes: list[dict] = Field(default_factory=list)
    topology_edges: list[dict] = Field(default_factory=list)

    @model_validator(mode="after")
    def _sync_aliases(self) -> AiGovernanceOverviewResponse:
        if not self.organizations and self.orgs:
            self.organizations = self.orgs
        if not self.orgs and self.organizations:
            self.orgs = self.organizations
        if not self.diagnostics and self.readiness_checks:
            self.diagnostics = self.readiness_checks
        if not self.readiness_checks and self.diagnostics:
            self.readiness_checks = self.diagnostics
        return self


class CreateAiTenantRequest(BaseModel):
    cluster_id: int = 1
    name: str
    display_name: str = ""
    namespace: str = "f5-bnk"
    oidc_issuer: str | None = None
    oidc_client_id: str | None = None

    @model_validator(mode="after")
    def _normalize(self) -> CreateAiTenantRequest:
        if not self.display_name:
            self.display_name = self.name
        return self


class CreateAiProviderRequest(BaseModel):
    cluster_id: int = 1
    namespace: str = "f5-bnk"
    tenant: str = "default"
    tenant_ref: str | None = None
    name: str
    vendor: str = "Generic"  # OpenAI | Anthropic | AzureOpenAI | AzureFoundry | Bedrock | Gemini | Generic
    provider_type: str | None = None
    base_url: str | None = None
    endpoint_url: str | None = None
    api_key: str = "sk-configured-via-console"
    credential_name: str | None = None
    secret_name: str | None = None
    enabled: bool = True

    @model_validator(mode="after")
    def _normalize(self) -> CreateAiProviderRequest:
        if self.tenant_ref:
            self.tenant = self.tenant_ref
        if self.provider_type:
            self.vendor = self.provider_type
        if self.endpoint_url:
            self.base_url = self.endpoint_url
        return self


class CreateAiModelRequest(BaseModel):
    cluster_id: int = 1
    namespace: str = "f5-bnk"
    tenant: str = "default"
    tenant_ref: str | None = None
    name: str
    public_name: str = ""
    model_id: str | None = None
    deployments: list[AiModelDeploymentItem] = Field(default_factory=list)
    input_token_cost_micro_usd: int = 0
    output_token_cost_micro_usd: int = 0

    @model_validator(mode="after")
    def _normalize(self) -> CreateAiModelRequest:
        if self.tenant_ref:
            self.tenant = self.tenant_ref
        if self.model_id and not self.public_name:
            self.public_name = self.model_id
        if not self.public_name:
            self.public_name = self.name
        if self.deployments and (self.input_token_cost_micro_usd or self.output_token_cost_micro_usd):
            for d in self.deployments:
                if d.input_per_mtok == 0 and self.input_token_cost_micro_usd:
                    d.input_per_mtok = self.input_token_cost_micro_usd
                if d.output_per_mtok == 0 and self.output_token_cost_micro_usd:
                    d.output_per_mtok = self.output_token_cost_micro_usd
        return self


class CreateAiGatewayRouteRequest(BaseModel):
    cluster_id: int = 1
    namespace: str = "f5-bnk"
    tenant: str = "default"
    tenant_ref: str | None = None
    name: str
    gateway_name: str = "ai-gateway"
    listener_port: int = 8080
    port: int | None = None
    vip_address: str = "10.100.10.200"
    path_prefix: str = "/v1"
    auth_mode: str | None = None
    virtual_keys_enabled: bool = True
    jwt_enabled: bool = False
    jwt_audiences: list[str] = Field(default_factory=list)
    failover_enabled: bool = True
    failover_max_attempts: int = 3
    failover_on_429: bool = True
    failover_on_5xx: bool = True
    prompt_cache_enabled: bool = True
    semantic_cache_enabled: bool | None = None
    semantic_cache_similarity_threshold: float | None = None
    semantic_cache_pool_max_size: int = 64
    semantic_cache_pool_idle_timeout: str = "300s"
    model_routing_enabled: bool = False
    default_model_ref: str | None = None
    providers: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _normalize(self) -> CreateAiGatewayRouteRequest:
        if self.tenant_ref:
            self.tenant = self.tenant_ref
        if self.port is not None:
            self.listener_port = self.port
        if self.semantic_cache_enabled is not None:
            self.prompt_cache_enabled = self.semantic_cache_enabled
        if self.auth_mode:
            self.virtual_keys_enabled = "virtual_key" in self.auth_mode
            self.jwt_enabled = "jwt" in self.auth_mode
        return self


class CreateGovernanceOrgRequest(BaseModel):
    cluster_id: int = 1
    tenant: str = "default"
    tenant_ref: str | None = None
    name: str
    monthly_budget_usd: float = 500.0
    alert_threshold_pct: int = 80
    rate_limit_rpm: int = 1200
    rate_limit_tpm: int = 500000
    rpm_limit: int | None = None
    tpm_limit: int | None = None

    @model_validator(mode="after")
    def _normalize(self) -> CreateGovernanceOrgRequest:
        if self.tenant_ref:
            self.tenant = self.tenant_ref
        if self.rpm_limit is not None:
            self.rate_limit_rpm = self.rpm_limit
        if self.tpm_limit is not None:
            self.rate_limit_tpm = self.tpm_limit
        return self


class CreateGovernanceTeamRequest(BaseModel):
    cluster_id: int = 1
    tenant: str = "default"
    org_id: str
    name: str
    monthly_budget_usd: float = 200.0
    allowed_models: list[str] = Field(default_factory=list)
    rate_limit_rpm: int = 600
    rate_limit_tpm: int = 200000
    rpm_limit: int | None = None
    tpm_limit: int | None = None

    @model_validator(mode="after")
    def _normalize(self) -> CreateGovernanceTeamRequest:
        if self.rpm_limit is not None:
            self.rate_limit_rpm = self.rpm_limit
        if self.tpm_limit is not None:
            self.rate_limit_tpm = self.tpm_limit
        return self


class CreateGovernancePrincipalRequest(BaseModel):
    cluster_id: int = 1
    tenant: str = "default"
    team_id: str
    name: str
    kind: str = "user"  # user | service | agent
    principal_type: str | None = None
    role: str = "member"  # member | team-admin | admin
    monthly_budget_usd: float = 50.0
    allowed_models: list[str] = Field(default_factory=list)
    rate_limit_rpm: int = 120
    rate_limit_tpm: int = 60000
    rpm_limit: int | None = None
    tpm_limit: int | None = None

    @model_validator(mode="after")
    def _normalize(self) -> CreateGovernancePrincipalRequest:
        if self.principal_type:
            self.kind = self.principal_type
        if self.rpm_limit is not None:
            self.rate_limit_rpm = self.rpm_limit
        if self.tpm_limit is not None:
            self.rate_limit_tpm = self.tpm_limit
        return self


class IssueVirtualKeyRequest(BaseModel):
    cluster_id: int = 1
    tenant: str = "default"
    principal_id: str
    name: str
    allowed_models: list[str] = Field(default_factory=list)
    rpm_limit: int | None = None
    tpm_limit: int | None = None
    monthly_budget_usd: float | None = None


class RemediateAiGatewayRequest(BaseModel):
    cluster_id: int = 1
    namespace: str = "f5-bnk"
    action: str  # restart_controller | apply_dns_resolver | enable_numa_spanning | apply_default_egress
    target_name: str | None = None


class UpdateAiGatewayRoutePoliciesRequest(BaseModel):
    cluster_id: int = 1
    namespace: str = "f5-bnk"
    auth_mode: str | None = None
    virtual_keys_enabled: bool | None = None
    jwt_enabled: bool | None = None
    failover_enabled: bool | None = None
    prompt_cache_enabled: bool | None = None
    semantic_cache_enabled: bool | None = None
    semantic_cache_similarity_threshold: float | None = None
    semantic_cache_pool_max_size: int | None = None
    semantic_cache_pool_idle_timeout: str | None = None
    model_routing_enabled: bool | None = None

    @model_validator(mode="after")
    def _normalize(self) -> UpdateAiGatewayRoutePoliciesRequest:
        if self.semantic_cache_enabled is not None and self.prompt_cache_enabled is None:
            self.prompt_cache_enabled = self.semantic_cache_enabled
        if self.auth_mode:
            self.virtual_keys_enabled = "virtual_key" in self.auth_mode
            self.jwt_enabled = "jwt" in self.auth_mode
        return self


class GatewayInferenceTestRequest(BaseModel):
    cluster_id: int = 1
    namespace: str = "f5-bnk"
    route_name: str | None = "ai-platform-profile"
    method: str = "POST"  # GET | POST
    path: str = "/v1/chat/completions"  # /v1/models | /v1/chat/completions | /models (tests missing /v1 gotcha)
    virtual_key: str | None = ""
    model: str = "gpt-4o"
    model_id: str | None = None
    prompt: str = "Explain the F5 TMM + Envoy AI Gateway hybrid data plane."
    simulate_primary_failure: bool = False

    @model_validator(mode="after")
    def _normalize_test_req(self) -> GatewayInferenceTestRequest:
        if self.model_id:
            self.model = self.model_id
        else:
            self.model_id = self.model
        if not self.route_name:
            self.route_name = "ai-platform-profile"
        if self.virtual_key is None:
            self.virtual_key = ""
        return self


class GatewayInferenceTestResponse(BaseModel):
    status_code: int
    success: bool
    route_name: str
    listener_port: int
    tenant: str
    model: str
    selected_provider: str | None = None
    failover_triggered: bool = False
    cache_status: str = "BYPASS"  # HIT | MISS | BYPASS
    semantic_cache_status: str = ""
    latency_ms: float = 0.0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0
    estimated_cost_usd: float = 0.0
    auth_verified: bool = True
    principal_name: str | None = None
    team_name: str | None = None
    org_name: str | None = None
    clickhouse_logged_id: str = ""
    response_text: str = ""
    response_body: dict = Field(default_factory=dict)
    troubleshooting_hint: str | None = None
    audit_record: ClickHouseRequestAuditItem | None = None

    @model_validator(mode="after")
    def _sync_test_resp_aliases(self) -> GatewayInferenceTestResponse:
        if not self.semantic_cache_status:
            self.semantic_cache_status = self.cache_status
        self.estimated_cost_usd = self.cost_usd
        self.auth_verified = self.status_code != 401
        if not self.clickhouse_logged_id and self.audit_record:
            self.clickhouse_logged_id = self.audit_record.id or self.audit_record.request_id
        if not self.response_text:
            choices = self.response_body.get("choices")
            if isinstance(choices, list) and choices:
                msg = choices[0].get("message") if isinstance(choices[0], dict) else None
                if isinstance(msg, dict) and msg.get("content"):
                    self.response_text = str(msg["content"])
            if not self.response_text and self.troubleshooting_hint:
                self.response_text = self.troubleshooting_hint
        return self


class AiGovernanceMutationResponse(BaseModel):
    status: str = "success"
    success: bool = True
    action: str = ""
    message: str
    cluster_id: int
    manifests_applied: list[dict] = Field(default_factory=list)
    applied_yaml: str = ""
    entity: dict | None = None
    details: dict = Field(default_factory=dict)
    id: str | None = None
    name: str | None = None
    masked_key: str | None = None
    cleartext_key: str | None = None

    @model_validator(mode="after")
    def _populate_entity_shortcuts(self) -> AiGovernanceMutationResponse:
        if self.manifests_applied and not self.applied_yaml:
            import yaml

            self.applied_yaml = yaml.safe_dump_all(self.manifests_applied, sort_keys=False)
        if self.entity:
            if not self.id and "id" in self.entity:
                self.id = str(self.entity["id"])
            if not self.name and "name" in self.entity:
                self.name = str(self.entity["name"])
            if not self.masked_key and "masked_key" in self.entity:
                self.masked_key = str(self.entity["masked_key"])
            if not self.cleartext_key and ("raw_key" in self.entity or "cleartext_key" in self.entity):
                self.cleartext_key = self.entity.get("cleartext_key") or self.entity.get("raw_key")
        return self
