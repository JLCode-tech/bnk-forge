/**
 * TypeScript definitions for Kubernetes Cluster Strangler Telemetry.
 * Matches backend FastAPI endpoints at /api/k8s/clusters/{id}/telemetry/*.
 */

export type TelemetrySource = "AGENT_PUSH" | "LEGACY_PULL";

export interface EbpfFlowsSummary {
  total_flows: number;
  inbound_flows: number;
  outbound_flows: number;
  total_bytes_sent: number;
  total_bytes_received: number;
  avg_handshake_duration_us: number;
  avg_smoothed_rtt_us: number;
  total_retransmissions: number;
  tmm_bypass_violations: number;
}

export interface PodTalker {
  namespace: string;
  pod_name: string;
  flow_count: number;
  total_bytes: number;
  bytes_sent: number;
  bytes_received: number;
  bypass_violations: number;
}

export interface TmmMetricsSummary {
  total_rx_packets: number;
  total_tx_packets: number;
  total_rx_bytes: number;
  total_tx_bytes: number;
  total_rx_drops: number;
  total_tx_drops: number;
  avg_rx_ring_occupancy: number;
  avg_tx_ring_occupancy: number;
  avg_cpu_utilization_pct: number;
  max_hugepage_used_bytes: number;
}

export interface DriftViolation {
  timestamp: string;
  node_name: string;
  pod_name: string;
  namespace: string;
  src_ip: string;
  dst_ip: string;
  dst_port: number;
  bytes_sent: number;
  bytes_received: number;
}

export interface ClusterTelemetrySummary {
  cluster_id: number | string;
  cluster_name: string;
  cluster_uuid: string;
  source: TelemetrySource;
  status: string;
  has_active_agent: boolean;
  connection_mode: string;
  last_heartbeat_at?: string | null;
  uptime_seconds?: number;
  flows?: EbpfFlowsSummary | null;
  top_talkers?: PodTalker[];
  tmm?: TmmMetricsSummary | null;
  drift_violations_count: number;
  recent_drift_alerts?: DriftViolation[];
  cloud_provider?: string;
  node_count?: number;
  api_server?: string;
}

export interface RecentEbpfFlow {
  timestamp: string;
  node_name: string;
  pod_name: string;
  namespace: string;
  src_ip: string;
  src_port: number;
  dst_ip: string;
  dst_port: number;
  direction: "INBOUND" | "OUTBOUND";
  handshake_duration_us: number;
  bytes_sent: number;
  bytes_received: number;
  retransmissions: number;
  smoothed_rtt_us: number;
  tmm_bypass_violation: number;
}

export interface ClusterPodFlowsResponse {
  cluster_id: number | string;
  source: TelemetrySource;
  summary: Partial<EbpfFlowsSummary>;
  flows: RecentEbpfFlow[];
  top_talkers: PodTalker[];
}

export interface ClusterTmmMetricsResponse {
  cluster_id: number | string;
  source: TelemetrySource;
  metrics: TmmMetricsSummary | Record<string, never>;
}

export interface ClusterDriftViolationsResponse {
  cluster_id: number | string;
  source: TelemetrySource;
  violations: DriftViolation[];
  count: number;
}
