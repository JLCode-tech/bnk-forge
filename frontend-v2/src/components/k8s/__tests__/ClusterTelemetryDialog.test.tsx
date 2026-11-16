/**
 * Tests for ClusterTelemetryDialog & ClusterTelemetryPanel
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@/test/test-utils";
import userEvent from "@testing-library/user-event";
import { ClusterTelemetryDialog } from "../ClusterTelemetryDialog";
import { ClusterTelemetryPanel } from "../ClusterTelemetryPanel";
import * as useClusterTelemetryHooks from "@/hooks/useClusterTelemetry";

vi.mock("@/components/fleet/AgentEnrollmentWizard", () => ({
  AgentEnrollmentWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="mock-enrollment-wizard">Mock Agent Enrollment Wizard</div> : null,
}));

describe("ClusterTelemetryPanel & Dialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading skeleton when fetching telemetry summary", () => {
    vi.spyOn(useClusterTelemetryHooks, "useClusterTelemetrySummary").mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
    } as any);

    vi.spyOn(useClusterTelemetryHooks, "useClusterPodFlows").mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    vi.spyOn(useClusterTelemetryHooks, "useClusterTmmMetrics").mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    vi.spyOn(useClusterTelemetryHooks, "useClusterDriftViolations").mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    render(<ClusterTelemetryPanel clusterId={1} clusterName="eks-prod-us-east-1" />);
    expect(screen.getByTestId("cluster-telemetry-loading")).toBeInTheDocument();
  });

  it("renders active agent push telemetry with flows, TMM, and zero-drift verification", async () => {
    vi.spyOn(useClusterTelemetryHooks, "useClusterTelemetrySummary").mockReturnValue({
      data: {
        cluster_id: 1,
        cluster_name: "eks-prod-us-east-1",
        cluster_uuid: "abcdef12-3456-7890-abcd-ef1234567890",
        source: "AGENT_PUSH",
        status: "active",
        has_active_agent: true,
        connection_mode: "AGENT_PUSH",
        flows: {
          total_flows: 15400,
          inbound_flows: 9200,
          outbound_flows: 6200,
          total_bytes_sent: 104857600,
          total_bytes_received: 209715200,
          avg_handshake_duration_us: 125.4,
          avg_smoothed_rtt_us: 180.2,
          total_retransmissions: 3,
          tmm_bypass_violations: 0,
        },
        tmm: {
          total_rx_packets: 500000,
          total_tx_packets: 490000,
          total_rx_bytes: 200000000,
          total_tx_bytes: 190000000,
          total_rx_drops: 0,
          total_tx_drops: 0,
          avg_rx_ring_occupancy: 0.15,
          avg_tx_ring_occupancy: 0.10,
          avg_cpu_utilization_pct: 18.5,
          max_hugepage_used_bytes: 2147483648,
        },
        drift_violations_count: 0,
        recent_drift_alerts: [],
        top_talkers: [
          {
            namespace: "f5-prod",
            pod_name: "payment-api-6789",
            flow_count: 5400,
            total_bytes: 150000000,
            bytes_sent: 50000000,
            bytes_received: 100000000,
            bypass_violations: 0,
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
    } as any);

    vi.spyOn(useClusterTelemetryHooks, "useClusterPodFlows").mockReturnValue({
      data: {
        cluster_id: 1,
        source: "AGENT_PUSH",
        summary: {},
        flows: [],
        top_talkers: [
          {
            namespace: "f5-prod",
            pod_name: "payment-api-6789",
            flow_count: 5400,
            total_bytes: 150000000,
            bytes_sent: 50000000,
            bytes_received: 100000000,
            bypass_violations: 0,
          },
        ],
      },
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    vi.spyOn(useClusterTelemetryHooks, "useClusterTmmMetrics").mockReturnValue({
      data: {
        cluster_id: 1,
        source: "AGENT_PUSH",
        metrics: {
          total_rx_packets: 500000,
          total_tx_packets: 490000,
          total_rx_bytes: 200000000,
          total_tx_bytes: 190000000,
          total_rx_drops: 0,
          total_tx_drops: 0,
          avg_rx_ring_occupancy: 0.15,
          avg_tx_ring_occupancy: 0.10,
          avg_cpu_utilization_pct: 18.5,
          max_hugepage_used_bytes: 2147483648,
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    vi.spyOn(useClusterTelemetryHooks, "useClusterDriftViolations").mockReturnValue({
      data: {
        cluster_id: 1,
        source: "AGENT_PUSH",
        violations: [],
        count: 0,
      },
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    render(
      <ClusterTelemetryDialog
        open={true}
        onOpenChange={vi.fn()}
        clusterId={1}
        clusterName="eks-prod-us-east-1"
      />
    );

    expect(screen.getByText("eks-prod-us-east-1 Telemetry")).toBeInTheDocument();
    expect(screen.getByText("Strangler Push Active (ClickHouse)")).toBeInTheDocument();
    expect(screen.getByText("15,400")).toBeInTheDocument();
    expect(screen.getByText("Strict TMM Ingress Compliant")).toBeInTheDocument();
    expect(screen.getByText("payment-api-6789")).toBeInTheDocument();
  });

  it("renders fallback banner with Enroll Push Agent button when in legacy pull mode", async () => {
    vi.spyOn(useClusterTelemetryHooks, "useClusterTelemetrySummary").mockReturnValue({
      data: {
        cluster_id: 2,
        cluster_name: "legacy-aks-cluster",
        cluster_uuid: "22222222-3333-4444-5555-666666666666",
        source: "LEGACY_PULL",
        status: "active",
        has_active_agent: false,
        connection_mode: "DIRECT_KUBECONFIG",
        flows: null,
        top_talkers: [],
        tmm: null,
        drift_violations_count: 0,
        recent_drift_alerts: [],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
    } as any);

    vi.spyOn(useClusterTelemetryHooks, "useClusterPodFlows").mockReturnValue({
      data: {
        cluster_id: 2,
        source: "LEGACY_PULL",
        summary: {},
        flows: [],
        top_talkers: [],
      },
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    vi.spyOn(useClusterTelemetryHooks, "useClusterTmmMetrics").mockReturnValue({
      data: {
        cluster_id: 2,
        source: "LEGACY_PULL",
        metrics: {},
      },
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    vi.spyOn(useClusterTelemetryHooks, "useClusterDriftViolations").mockReturnValue({
      data: {
        cluster_id: 2,
        source: "LEGACY_PULL",
        violations: [],
        count: 0,
      },
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    render(
      <ClusterTelemetryPanel clusterId={2} clusterName="legacy-aks-cluster" />
    );

    expect(screen.getByText("Legacy Pull Mode (Direct Kubeconfig)")).toBeInTheDocument();
    expect(screen.getByText("Push Agent is not active for this cluster")).toBeInTheDocument();

    const enrollButtons = screen.getAllByRole("button", { name: /enroll push agent|deploy agent/i });
    expect(enrollButtons.length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(enrollButtons[0]);
    expect(screen.getByTestId("mock-enrollment-wizard")).toBeInTheDocument();
  });
});
