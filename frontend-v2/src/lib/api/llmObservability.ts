/**
 * AI Gateway Observability API (Tier 1: request analytics).
 *
 * Thin axios wrappers on the shared `apiClient` for the cluster-scoped
 * Loki-proxy endpoints under
 * `/api/k8s/clusters/{clusterId}/llm-observability/*`.
 * All params go on the query string; the backend maps `range` to Loki
 * start/end nanosecond bounds.
 */
import { apiClient } from "./client";
import type {
  AiGatewayGovernanceOverview,
  AiGatewayRouteSummary,
  AiModelSummary,
  AiProviderSummary,
  AiTenantSummary,
  CreateAiGatewayRouteRequest,
  CreateAiModelRequest,
  CreateAiProviderRequest,
  CreateAiTenantRequest,
  CreateDssmOrgRequest,
  CreateDssmPrincipalRequest,
  CreateDssmTeamRequest,
  DssmOrganization,
  DssmPrincipal,
  DssmTeam,
  DssmVirtualKey,
  IssueVirtualKeyRequest,
  LlmFilterData,
  LlmHistogram,
  LlmHistogramMetric,
  LlmLogs,
  LlmObservabilityParams,
  LlmProviderMetric,
  LlmProviderUsage,
  LlmRankings,
  LlmStats,
  RemediationRequest,
  RemediationResponse,
} from "@/types/llm-observability";

const base = (clusterId?: number) =>
  clusterId
    ? `/api/k8s/clusters/${clusterId}/llm-observability`
    : `/api/k8s/llm-observability`;

export const llmObservabilityApi = {
  getStats: (clusterId?: number, params?: LlmObservabilityParams) =>
    apiClient
      .get<LlmStats>(`${base(clusterId)}/stats`, { params })
      .then((res) => res.data),

  getHistogram: (
    clusterId?: number,
    params?: LlmObservabilityParams & { metric?: LlmHistogramMetric },
  ) =>
    apiClient
      .get<LlmHistogram>(`${base(clusterId)}/histogram`, { params })
      .then((res) => res.data),

  getRankings: (clusterId?: number, params?: LlmObservabilityParams) =>
    apiClient
      .get<LlmRankings>(`${base(clusterId)}/rankings`, { params })
      .then((res) => res.data),

  getProviderUsage: (
    clusterId?: number,
    params?: LlmObservabilityParams & { metric?: LlmProviderMetric },
  ) =>
    apiClient
      .get<LlmProviderUsage>(`${base(clusterId)}/provider-usage`, { params })
      .then((res) => res.data),

  getLogs: (
    clusterId?: number,
    params?: LlmObservabilityParams & {
      limit?: number;
      end?: string;
      content_search?: string;
    },
  ) =>
    apiClient
      .get<LlmLogs>(`${base(clusterId)}/logs`, { params })
      .then((res) => res.data),

  getFilterData: (
    clusterId?: number,
    params?: { range?: LlmObservabilityParams["range"] },
  ) =>
    apiClient
      .get<LlmFilterData>(`${base(clusterId)}/filterdata`, { params })
      .then((res) => res.data),

  getGovernanceOverview: (clusterId?: number, namespace = "default") =>
    apiClient
      .get<AiGatewayGovernanceOverview>(
        `${base(clusterId)}/governance/overview`,
        {
          params: { namespace },
        },
      )
      .then((res) => res.data),

  createTenant: (clusterId: number, payload: CreateAiTenantRequest) =>
    apiClient
      .post<AiTenantSummary>(`${base(clusterId)}/governance/tenants`, payload)
      .then((res) => res.data),

  createProvider: (clusterId: number, payload: CreateAiProviderRequest) =>
    apiClient
      .post<AiProviderSummary>(
        `${base(clusterId)}/governance/providers`,
        payload,
      )
      .then((res) => res.data),

  createModel: (clusterId: number, payload: CreateAiModelRequest) =>
    apiClient
      .post<AiModelSummary>(`${base(clusterId)}/governance/models`, payload)
      .then((res) => res.data),

  createRoute: (clusterId: number, payload: CreateAiGatewayRouteRequest) =>
    apiClient
      .post<AiGatewayRouteSummary>(
        `${base(clusterId)}/governance/routes`,
        payload,
      )
      .then((res) => res.data),

  createOrg: (clusterId: number, payload: CreateDssmOrgRequest) =>
    apiClient
      .post<DssmOrganization>(`${base(clusterId)}/governance/orgs`, payload)
      .then((res) => res.data),

  createTeam: (clusterId: number, payload: CreateDssmTeamRequest) =>
    apiClient
      .post<DssmTeam>(`${base(clusterId)}/governance/teams`, payload)
      .then((res) => res.data),

  createPrincipal: (clusterId: number, payload: CreateDssmPrincipalRequest) =>
    apiClient
      .post<DssmPrincipal>(`${base(clusterId)}/governance/principals`, payload)
      .then((res) => res.data),

  issueVirtualKey: (clusterId: number, payload: IssueVirtualKeyRequest) =>
    apiClient
      .post<DssmVirtualKey>(
        `${base(clusterId)}/governance/virtual-keys`,
        payload,
      )
      .then((res) => res.data),

  revokeVirtualKey: (clusterId: number, keyId: string) =>
    apiClient
      .delete<{
        status: string;
        key_id: string;
      }>(`${base(clusterId)}/governance/virtual-keys/${encodeURIComponent(keyId)}`)
      .then((res) => res.data),

  remediate: (clusterId: number, payload: RemediationRequest) =>
    apiClient
      .post<RemediationResponse>(
        `${base(clusterId)}/governance/remediate`,
        payload,
      )
      .then((res) => res.data),
};
