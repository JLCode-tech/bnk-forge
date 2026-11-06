/**
 * Unit tests for ClusterRouterRow — gateway telemetry per cluster in Intelligent Inference.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test/test-utils";
import userEvent from "@testing-library/user-event";
import { ClusterRouterRow } from "../ClusterRouterRow";
import type { K8sCluster } from "@/types/kubernetes";

const mockUseLlmStats = vi.fn();
vi.mock("@/hooks/useLlmObservability", () => ({
  useLlmStats: (clusterId: number, params: unknown) => mockUseLlmStats(clusterId, params),
}));

const testCluster: K8sCluster = {
  id: 53,
  name: "agent-core-singapore",
  cloud_provider: "aws",
  region: "ap-southeast-1",
  status: "active",
  project_id: 68,
} as unknown as K8sCluster;

describe("ClusterRouterRow", () => {
  it("renders live metrics when cluster has traffic", () => {
    mockUseLlmStats.mockReturnValue({
      data: {
        available: true,
        total_requests: 1250,
        success_rate: 0.992,
        avg_latency_ms: 145.4,
      },
      isLoading: false,
    });

    render(
      <table>
        <tbody>
          <ClusterRouterRow cluster={testCluster} onInspect={vi.fn()} />
        </tbody>
      </table>,
    );

    expect(screen.getByText("agent-core-singapore")).toBeInTheDocument();
    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.getByText("99.2%")).toBeInTheDocument();
    expect(screen.getByText("145ms")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("renders dash for success rate/latency and 'Idle (6h)' badge when traffic is 0 (Singapore case)", () => {
    mockUseLlmStats.mockReturnValue({
      data: {
        available: true,
        total_requests: 0,
        success_rate: 0.0,
        avg_latency_ms: 0.0,
      },
      isLoading: false,
    });

    render(
      <table>
        <tbody>
          <ClusterRouterRow cluster={testCluster} onInspect={vi.fn()} />
        </tbody>
      </table>,
    );

    expect(screen.getByText("agent-core-singapore")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    // Neither 0.0% nor 0ms should be rendered
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
    expect(screen.queryByText("0ms")).not.toBeInTheDocument();
    // Two em-dashes for success rate and latency
    expect(screen.getAllByText("—").length).toBe(2);
    expect(screen.getByText("Idle (6h)")).toBeInTheDocument();
  });

  it("renders 'No telemetry' when provider telemetry is unavailable", () => {
    mockUseLlmStats.mockReturnValue({
      data: {
        available: false,
        reason: "Loki query timed out",
      },
      isLoading: false,
    });

    render(
      <table>
        <tbody>
          <ClusterRouterRow cluster={testCluster} onInspect={vi.fn()} />
        </tbody>
      </table>,
    );

    expect(screen.getByText("No telemetry")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBe(3);
  });

  it("calls onInspect when Inspect button is clicked", async () => {
    const user = userEvent.setup();
    const handleInspect = vi.fn();
    mockUseLlmStats.mockReturnValue({
      data: { available: true, total_requests: 10, success_rate: 1.0, avg_latency_ms: 50 },
      isLoading: false,
    });

    render(
      <table>
        <tbody>
          <ClusterRouterRow cluster={testCluster} onInspect={handleInspect} />
        </tbody>
      </table>,
    );

    const inspectBtn = screen.getByRole("button", { name: /Inspect/i });
    await user.click(inspectBtn);
    expect(handleInspect).toHaveBeenCalledTimes(1);
  });
});
