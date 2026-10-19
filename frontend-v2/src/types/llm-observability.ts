/**
 * AI Gateway Observability (Tier 1: request analytics).
 *
 * Local TS types matching the backend response-shape contract in
 * `docs/superpowers/specs/…-ai-gateway-observability-design.md` §"Response shapes".
 * These are hand-written; they will be reconciled to `api-generated.ts`
 * after the backend routes land and `make openapi-types` runs.
 *
 * Every response carries the degradation envelope (`available`, `endpoint`,
 * `updated_at`, `errors`) so panels can render an unavailable state instead
 * of crashing when Loki is unreachable.
 */

/** Time-range presets mapped to Loki start/end nanosecond bounds server-side. */
export type LlmTimeRange = "1h" | "6h" | "24h" | "7d";

/** Shared degradation envelope on every observability response. */
export interface LlmEnvelope {
  available: boolean;
  endpoint: string | null;
  updated_at: string;
  reason?: string | null;
  errors: Record<string, string>;
}

export interface LlmStats extends LlmEnvelope {
  total_requests: number;
  success_rate: number;
  avg_latency_ms: number;
  total_tokens: number;
  total_cost: number;
  models: number;
}

export interface LlmSeriesPoint {
  ts: string;
  value: number;
}

export interface LlmSeries {
  name: string;
  points: LlmSeriesPoint[];
}

/** Metrics selectable on the histogram endpoint. */
export type LlmHistogramMetric =
  | "requests"
  | "tokens"
  | "cost"
  | "models"
  | "latency";

export interface LlmHistogram extends LlmEnvelope {
  metric: string;
  step_s: number;
  series: LlmSeries[];
}

export interface LlmRankingTrend {
  requests: number | null;
  tokens: number | null;
  cost: number | null;
}

export interface LlmRankingRow {
  model: string;
  provider: string;
  requests: number;
  success_rate: number;
  tokens: number;
  cost: number;
  avg_latency_ms: number;
  trend: LlmRankingTrend;
}

export interface LlmRankings extends LlmEnvelope {
  rows: LlmRankingRow[];
}

/** Provider-usage shares the histogram envelope; series are keyed by provider. */
export type LlmProviderMetric = "cost" | "tokens" | "latency";
export type LlmProviderUsage = LlmHistogram;

export interface LlmLogRow {
  ts: string;
  type: string;
  message: string;
  model: string;
  latency_ms: number;
  prompt_tk: number;
  comp_tk: number;
  total_tk: number;
  cost: number;
  status: string;
  req_body: string;
  resp_body: string;
  cluster_id?: number;
  cluster_name?: string;
}

export interface LlmLogs extends LlmEnvelope {
  rows: LlmLogRow[];
  next_end: string | null;
}

export interface LlmFilterData extends LlmEnvelope {
  models: string[];
  statuses: string[];
}

/** Shared query params accepted by every dashboard endpoint. */
export interface LlmObservabilityParams {
  range?: LlmTimeRange;
  model?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// BNK 2.4.1 Multi-Cluster AI Gateway & DSSM Governance Types
// ---------------------------------------------------------------------------

export interface AiTenantSummary {
  name: string;
  cluster_id: number;
  cluster_name?: string | null;
  status: string;
  models_count: number;
  providers_count: number;
}

export interface AiProviderSummary {
  name: string;
  namespace: string;
  cluster_id: number;
  cluster_name?: string | null;
  tenant_ref: string;
  provider_type: string;
  endpoint_url?: string | null;
  credential_ref?: string | null;
  secret_ref?: string | null;
  status: string;
}

export interface AiModelDeploymentWeight {
  provider_ref: string;
  weight: number;
}

export interface AiModelSummary {
  name: string;
  namespace: string;
  cluster_id: number;
  cluster_name?: string | null;
  tenant_ref: string;
  model_id: string;
  deployments: AiModelDeploymentWeight[];
  input_token_cost_micro_usd: number;
  output_token_cost_micro_usd: number;
  status: string;
}

export interface AiGatewayRouteSummary {
  name: string;
  namespace: string;
  cluster_id: number;
  cluster_name?: string | null;
  gateway_name: string;
  vip_address?: string | null;
  port: number;
  path_prefix: string;
  ai_gateway_profile: string;
  app_policy?: string | null;
  tenant_ref: string;
  auth_mode: string;
  failover_enabled: boolean;
  semantic_cache_enabled: boolean;
  semantic_cache_similarity_threshold: number;
  semantic_cache_pool_max_size: number;
  semantic_cache_pool_idle_timeout: string;
  model_routing_enabled: boolean;
  programmed: boolean;
  status: string;
}

export interface DssmOrganization {
  id: string;
  name: string;
  cluster_id: number;
  tenant_ref: string;
  monthly_budget_usd: number;
  current_spend_usd: number;
  rpm_limit: number;
  tpm_limit: number;
  teams_count: number;
}

export interface DssmTeam {
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  cluster_id: number;
  monthly_budget_usd: number;
  current_spend_usd: number;
  rpm_limit: number;
  tpm_limit: number;
  allowed_models: string[];
}

export interface DssmPrincipal {
  id: string;
  name: string;
  principal_type: "user" | "service" | "agent";
  team_id: string;
  team_name: string;
  org_id: string;
  cluster_id: number;
  rpm_limit: number;
  tpm_limit: number;
  active_keys: number;
}

export interface DssmVirtualKey {
  id: string;
  name: string;
  masked_key: string;
  cleartext_key?: string | null;
  principal_id: string;
  principal_name: string;
  principal_type: string;
  team_name: string;
  org_name: string;
  cluster_id: number;
  allowed_models: string[];
  rpm_limit: number;
  tpm_limit: number;
  monthly_budget_usd: number;
  spend_usd: number;
  status: string;
  created_at: string;
  expires_at?: string | null;
}

export interface Bnk241DiagnosticCheck {
  id: string;
  title: string;
  category: string;
  status: "healthy" | "warning" | "critical";
  summary: string;
  remediation_hint?: string | null;
  remediation_action?: string | null;
}

export interface AiGatewayGovernanceOverview {
  cluster_id?: number | null;
  namespace: string;
  updated_at: string;
  tenants: AiTenantSummary[];
  providers: AiProviderSummary[];
  models: AiModelSummary[];
  routes: AiGatewayRouteSummary[];
  organizations: DssmOrganization[];
  teams: DssmTeam[];
  principals: DssmPrincipal[];
  virtual_keys: DssmVirtualKey[];
  diagnostics: Bnk241DiagnosticCheck[];
}

export interface CreateAiTenantRequest {
  name: string;
}

export interface CreateAiProviderRequest {
  name: string;
  namespace?: string;
  tenant_ref?: string;
  provider_type?: string;
  endpoint_url?: string | null;
  api_key?: string | null;
}

export interface CreateAiModelRequest {
  name: string;
  namespace?: string;
  tenant_ref?: string;
  model_id: string;
  deployments: AiModelDeploymentWeight[];
  input_token_cost_micro_usd?: number;
  output_token_cost_micro_usd?: number;
}

export interface CreateAiGatewayRouteRequest {
  name: string;
  namespace?: string;
  gateway_name?: string;
  vip_address?: string;
  port?: number;
  path_prefix?: string;
  tenant_ref?: string;
  auth_mode?: string;
  failover_enabled?: boolean;
  semantic_cache_enabled?: boolean;
  semantic_cache_similarity_threshold?: number;
  semantic_cache_pool_max_size?: number;
  semantic_cache_pool_idle_timeout?: string;
  model_routing_enabled?: boolean;
}

export interface CreateDssmOrgRequest {
  name: string;
  tenant_ref?: string;
  monthly_budget_usd?: number;
  rpm_limit?: number;
  tpm_limit?: number;
}

export interface CreateDssmTeamRequest {
  name: string;
  org_id: string;
  monthly_budget_usd?: number;
  rpm_limit?: number;
  tpm_limit?: number;
  allowed_models?: string[];
}

export interface CreateDssmPrincipalRequest {
  name: string;
  principal_type?: "user" | "service" | "agent";
  team_id: string;
  rpm_limit?: number;
  tpm_limit?: number;
}

export interface IssueVirtualKeyRequest {
  name: string;
  principal_id: string;
  allowed_models?: string[];
  rpm_limit?: number;
  tpm_limit?: number;
  monthly_budget_usd?: number;
}

export interface RemediationRequest {
  action: string;
  namespace?: string;
  target_name?: string | null;
}

export interface RemediationResponse {
  success: boolean;
  action: string;
  message: string;
  details: Record<string, unknown>;
}
