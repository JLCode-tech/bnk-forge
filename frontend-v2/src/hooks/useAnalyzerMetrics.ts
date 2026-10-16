/**
 * Runtime-metrics hook for an F5BigAnalyzer.
 *
 * Fetches aggregated Prometheus metrics per backend for the given analyzer.
 * The backend service-proxies PromQL through the K8s API server, so no
 * external Prometheus exposure is required.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface EppEndpointMetric {
  name: string;
  pod_name?: string;
  address: string;
  phase: string;
  status: string;
  running: number;
  waiting: number;
  kv_cache_used_pct: number;
  ttft_p95_ms: number | null;
  itl_p95_ms: number | null;
  tokens_generated: number;
  requests_success: number;
  traffic_pct: number;
}

export interface EppSummaryMetrics {
  traffic_status?: 'active' | 'idle';
  is_active_traffic?: boolean;
  ttft_p50_ms: number;
  ttft_p95_ms: number;
  itl_p50_ms: number;
  itl_p95_ms: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  output_tps: number;
  prompt_tps: number;
  total_tps: number;
  requests_per_minute: number;
  cache_hit_rate_pct: number;
  kv_cache_usage_pct: number;
  num_requests_running: number;
  num_requests_waiting: number;
  cumulative_total_tokens?: number;
  cumulative_total_prompt_tokens?: number;
  cumulative_total_requests?: number;
}

export interface EppInfo {
  engine: string;
  block_size: number;
  tokenizer: string;
  mode: string;
  pool_name: string;
  target_port: number;
  replicas: number;
  status_conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
}

export interface AnalyzerRuntimeMetrics {
  available: boolean;
  reason?: string;
  kind?: 'F5BigAnalyzer' | 'F5EPP';
  name?: string;
  namespace?: string;
  endpoint?: string | null;
  backends?: string[];
  per_backend?: Record<string, Record<string, number | null>>;
  epp_info?: EppInfo;
  summary?: EppSummaryMetrics;
  endpoints?: EppEndpointMetric[];
  errors?: Record<string, string>;
  updated_at?: string;
}

export function useAnalyzerRuntimeMetrics(
  clusterId: number | null | undefined,
  namespace: string | null | undefined,
  name: string | null | undefined,
  enabled = true,
  pollIntervalMs: number | false = 4000,
) {
  return useQuery<AnalyzerRuntimeMetrics>({
    queryKey: ['analyzer-metrics', clusterId, namespace, name],
    queryFn: () =>
      apiClient
        .get<AnalyzerRuntimeMetrics>(
          `/api/k8s/clusters/${clusterId}/analyzers/${namespace}/${name}/runtime-metrics`,
        )
        .then((res) => res.data),
    enabled: enabled && !!clusterId && !!namespace && !!name,
    refetchInterval: pollIntervalMs,
    staleTime: pollIntervalMs ? Math.min(2000, pollIntervalMs) : 10000,
    retry: 1,
  });
}
