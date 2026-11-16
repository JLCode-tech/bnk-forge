/**
 * Kubernetes Cluster Telemetry API Client
 * Interfaces with FastAPI endpoints at /api/k8s/clusters/{cluster_id}/telemetry/*
 * Supports transparent switching between Strangler AGENT_PUSH and LEGACY_PULL modes.
 */
import { apiClient } from './client';
import type {
  ClusterTelemetrySummary,
  ClusterPodFlowsResponse,
  ClusterTmmMetricsResponse,
  ClusterDriftViolationsResponse,
} from '@/types/clusterTelemetry';

export const clusterTelemetryApi = {
  /**
   * Fetch aggregate telemetry summary for a cluster (eBPF flows, TMM metrics, and drift violations).
   */
  getClusterTelemetrySummary: async (
    clusterId: number | string,
    hours: number = 1
  ): Promise<ClusterTelemetrySummary> => {
    const { data } = await apiClient.get<ClusterTelemetrySummary>(
      `/api/k8s/clusters/${encodeURIComponent(String(clusterId))}/telemetry/summary`,
      { params: { hours } }
    );
    return data;
  },

  /**
   * Fetch pod flows and top talkers, optionally filtered by namespace or pod name.
   */
  getClusterPodFlows: async (
    clusterId: number | string,
    options?: {
      hours?: number;
      namespace?: string;
      podName?: string;
      limit?: number;
    }
  ): Promise<ClusterPodFlowsResponse> => {
    const { data } = await apiClient.get<ClusterPodFlowsResponse>(
      `/api/k8s/clusters/${encodeURIComponent(String(clusterId))}/telemetry/flows`,
      {
        params: {
          hours: options?.hours ?? 1,
          namespace: options?.namespace || undefined,
          pod_name: options?.podName || undefined,
          limit: options?.limit ?? 50,
        },
      }
    );
    return data;
  },

  /**
   * Fetch F5 BIG-IP Next TMM DPDK microkernel telemetry.
   */
  getClusterTmmMetrics: async (
    clusterId: number | string,
    hours: number = 1
  ): Promise<ClusterTmmMetricsResponse> => {
    const { data } = await apiClient.get<ClusterTmmMetricsResponse>(
      `/api/k8s/clusters/${encodeURIComponent(String(clusterId))}/telemetry/tmm`,
      { params: { hours } }
    );
    return data;
  },

  /**
   * Fetch Day 2 architectural drift violations (pod traffic bypassing BNK TMM ingress).
   */
  getClusterDriftViolations: async (
    clusterId: number | string,
    options?: {
      hours?: number;
      limit?: number;
    }
  ): Promise<ClusterDriftViolationsResponse> => {
    const { data } = await apiClient.get<ClusterDriftViolationsResponse>(
      `/api/k8s/clusters/${encodeURIComponent(String(clusterId))}/telemetry/drift`,
      {
        params: {
          hours: options?.hours ?? 24,
          limit: options?.limit ?? 50,
        },
      }
    );
    return data;
  },
};
