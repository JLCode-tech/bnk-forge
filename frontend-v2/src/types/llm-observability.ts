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
  org_name?: string;
  cluster_id: number;
  rpm_limit: number;
  tpm_limit: number;
  current_spend_usd?: number;
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

export interface ClickHouseRequestAuditItem {
  id: string;
  request_id?: string;
  timestamp: string;
  cluster_id: number;
  cluster_name: string;
  tenant: string;
  route_name?: string;
  org_name: string;
  team_name: string;
  principal_name: string;
  virtual_key_id: string;
  virtual_key_name: string;
  method?: string;
  path?: string;
  model_id: string;
  model?: string;
  provider_name: string;
  provider?: string;
  status_code: number;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  semantic_cache_status: string;
  cache_status?: string;
  failover_triggered: boolean;
  failover_used?: boolean;
  error_reason?: string | null;
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
  request_audit_logs?: ClickHouseRequestAuditItem[];
  topology_nodes?: Record<string, unknown>[];
  topology_edges?: Record<string, unknown>[];
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

export interface UpdateAiGatewayRoutePoliciesRequest {
  namespace?: string;
  auth_mode?: string;
  virtual_keys_enabled?: boolean;
  jwt_enabled?: boolean;
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

export interface GatewayInferenceTestRequest {
  namespace?: string;
  route_name?: string | null;
  method?: string;
  path?: string;
  virtual_key?: string | null;
  model?: string;
  model_id?: string;
  prompt?: string;
  simulate_primary_failure?: boolean;
}

export interface GatewayInferenceTestResponse {
  status_code: number;
  success: boolean;
  route_name: string;
  listener_port: number;
  tenant: string;
  model: string;
  selected_provider?: string | null;
  failover_triggered: boolean;
  semantic_cache_status: string;
  cache_status?: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  cost_usd?: number;
  auth_verified?: boolean;
  principal_name?: string | null;
  team_name?: string | null;
  org_name?: string | null;
  clickhouse_logged_id: string;
  response_text: string;
  response_body?: Record<string, unknown>;
  troubleshooting_hint?: string | null;
  audit_record?: ClickHouseRequestAuditItem | null;
}
