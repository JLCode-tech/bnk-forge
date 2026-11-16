/**
 * React Query hooks for Kubernetes Cluster Telemetry (Strangler Facade).
 * Surfaces eBPF socket flows, F5 TMM DPDK metrics, and architectural drift.
 */
import { useQuery } from '@tanstack/react-query';
import { clusterTelemetryApi } from '@/lib/api/clusterTelemetry';
import { queryKeys } from '@/lib/queryKeys';
import type {
  ClusterTelemetrySummary,
  ClusterPodFlowsResponse,
  ClusterTmmMetricsResponse,
  ClusterDriftViolationsResponse,
} from '@/types/clusterTelemetry';

export interface UseClusterTelemetryOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

/**
 * Hook to fetch cluster telemetry summary with auto-refresh (default 10s if active).
 */
export function useClusterTelemetrySummary(
  clusterId: number | string | null | undefined,
  hours: number = 1,
  options?: UseClusterTelemetryOptions
) {
  const isEnabled = Boolean(clusterId) && (options?.enabled ?? true);

  return useQuery<ClusterTelemetrySummary>({
    queryKey: queryKeys.k8s.clusters.telemetrySummary(clusterId ?? 0, hours),
    queryFn: () => clusterTelemetryApi.getClusterTelemetrySummary(clusterId!, hours),
    enabled: isEnabled,
    refetchInterval: options?.refetchInterval ?? 10_000,
    staleTime: 5_000,
  });
}

/**
 * Hook to query detailed pod flows and top talkers.
 */
export function useClusterPodFlows(
  clusterId: number | string | null | undefined,
  params?: {
    hours?: number;
    namespace?: string;
    podName?: string;
    limit?: number;
  },
  options?: UseClusterTelemetryOptions
) {
  const isEnabled = Boolean(clusterId) && (options?.enabled ?? true);

  return useQuery<ClusterPodFlowsResponse>({
    queryKey: queryKeys.k8s.clusters.telemetryFlows(clusterId ?? 0, params),
    queryFn: () => clusterTelemetryApi.getClusterPodFlows(clusterId!, params),
    enabled: isEnabled,
    refetchInterval: options?.refetchInterval ?? 15_000,
    staleTime: 5_000,
  });
}

/**
 * Hook to fetch F5 BIG-IP Next TMM DPDK microkernel telemetry.
 */
export function useClusterTmmMetrics(
  clusterId: number | string | null | undefined,
  hours: number = 1,
  options?: UseClusterTelemetryOptions
) {
  const isEnabled = Boolean(clusterId) && (options?.enabled ?? true);

  return useQuery<ClusterTmmMetricsResponse>({
    queryKey: queryKeys.k8s.clusters.telemetryTmm(clusterId ?? 0, hours),
    queryFn: () => clusterTelemetryApi.getClusterTmmMetrics(clusterId!, hours),
    enabled: isEnabled,
    refetchInterval: options?.refetchInterval ?? 10_000,
    staleTime: 5_000,
  });
}

/**
 * Hook to query architectural drift violations (TMM ingress bypass).
 */
export function useClusterDriftViolations(
  clusterId: number | string | null | undefined,
  options?: {
    hours?: number;
    limit?: number;
  } & UseClusterTelemetryOptions
) {
  const isEnabled = Boolean(clusterId) && (options?.enabled ?? true);

  return useQuery<ClusterDriftViolationsResponse>({
    queryKey: queryKeys.k8s.clusters.telemetryDrift(clusterId ?? 0, options?.hours),
    queryFn: () =>
      clusterTelemetryApi.getClusterDriftViolations(clusterId!, {
        hours: options?.hours,
        limit: options?.limit,
      }),
    enabled: isEnabled,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 10_000,
  });
}
