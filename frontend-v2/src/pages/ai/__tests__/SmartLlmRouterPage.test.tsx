/**
 * Unit tests for SmartLlmRouterPage — Intelligent Inference (EPP & GAIE KV-Cache Routing).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@/test/test-utils";
import userEvent from "@testing-library/user-event";
import SmartLlmRouterPage from "../SmartLlmRouterPage";

vi.mock("@/hooks/useK8sClusters", () => ({
  useAllClusters: () => ({
    data: {
      clusters: [
        {
          id: 1,
          name: "bnk-prod-eu",
          status: "active",
          provider: "bare-metal",
        },
        {
          id: 2,
          name: "bnk-edge-us",
          status: "active",
          provider: "bare-metal",
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useClusterScope", () => ({
  useClusterScope: () => [null, vi.fn()],
}));

vi.mock("@/hooks/useLlmObservability", () => ({
  useLlmStats: () => ({
    data: {
      available: true,
      total_requests: 1200,
      total_tokens: 450000,
      avg_latency_ms: 340,
      total_cost: 12.5,
      success_rate: 0.992,
      models: 2,
    },
    isLoading: false,
  }),
}));

vi.mock("@/components/k8s/F5AIAnalyzerViewer", () => ({
  F5AIAnalyzerViewer: ({ clusterId }: { clusterId: number }) => (
    <div data-testid="f5-ai-analyzer-viewer">
      EPP Viewer for cluster {clusterId}
    </div>
  ),
}));

describe("SmartLlmRouterPage (Intelligent Inference — EPP & GAIE)", () => {
  it("renders the 4 Intelligent Inference views and switches cleanly", async () => {
    const user = userEvent.setup();
    render(<SmartLlmRouterPage />);

    expect(
      screen.getAllByText(/Intelligent Inference/i).length,
    ).toBeGreaterThan(0);

    const overviewBtn = screen.getByRole("button", { name: /Fleet Overview/i });
    const topologyBtn = screen.getByRole("button", {
      name: /Routing Topology/i,
    });
    const poolsBtn = screen.getByRole("button", {
      name: /Inference Pools & Models/i,
    });
    const policiesBtn = screen.getByRole("button", {
      name: /EPP Policies & Scoring/i,
    });

    expect(overviewBtn).toBeInTheDocument();
    expect(topologyBtn).toBeInTheDocument();
    expect(poolsBtn).toBeInTheDocument();
    expect(policiesBtn).toBeInTheDocument();

    // Fleet Overview shows connected clusters
    expect(screen.getAllByText(/bnk-prod-eu/i).length).toBeGreaterThan(0);

    // Switch to Routing Topology view
    await user.click(topologyBtn);
    await waitFor(() => {
      expect(screen.getByTestId("f5-ai-analyzer-viewer")).toHaveTextContent(
        "EPP Viewer for cluster 1",
      );
      expect(
        screen.getByText(/Dependency Fabric & Routing Topology/i),
      ).toBeInTheDocument();
    });

    // Switch to Inference Pools & Models view
    await user.click(poolsBtn);
    await waitFor(() => {
      expect(
        screen.getByText(/Inference Pools \(InferencePool\)/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Inference Models & LoRA Adapters \(InferenceModel\)/i,
        ),
      ).toBeInTheDocument();
    });

    // Switch to EPP Policies & Scoring view
    await user.click(policiesBtn);
    await waitFor(() => {
      expect(
        screen.getByText(/EPP Scoring Weights & Queue Policies/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/TMM Data-Plane & Infrastructure Readiness/i),
      ).toBeInTheDocument();
    });

    // Ensure no legacy "BNK 2.4.1" version clutter is rendered
    expect(screen.queryByText(/2\.4\.1/i)).not.toBeInTheDocument();
  });
});
