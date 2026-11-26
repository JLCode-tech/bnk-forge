/**
 * Tests for Dashboard page
 *
 * Covers: renders greeting, loading skeletons, Hero Omnisearch, Multi-Cloud Estate,
 * Fleets overview, and action buttons.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { render } from "@/test/test-utils";
import Dashboard from "@/pages/Dashboard";

// Mock navigation
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

describe("Dashboard", () => {
  it("renders greeting text", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      const greeting = screen.queryByText(/good (morning|afternoon|evening)/i);
      expect(greeting).toBeInTheDocument();
    });
  });

  it("renders loading skeletons while data is fetching", () => {
    server.use(
      http.get("*/api/projects", async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return HttpResponse.json({ projects: [], total: 0 });
      }),
    );
    render(<Dashboard />);
    const skeletons = document.querySelectorAll(
      '[class*="animate-pulse"], [class*="skeleton"]',
    );
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders action buttons (Add Cluster, New Project)", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText(/add cluster/i)).toBeInTheDocument();
      expect(screen.getByText(/new project/i)).toBeInTheDocument();
    });
  });

  it("navigates to /projects?action=create when New Project is clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText(/new project/i)).toBeInTheDocument();
    });
    await user.click(screen.getByText(/new project/i));
    expect(mockNavigate).toHaveBeenCalledWith("/projects?action=create");
  });

  it("renders Hero Omnisearch input with placeholder and filter chips", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search fqdn/i)).toBeInTheDocument();
      expect(screen.getByText(/ingresses & vips/i)).toBeInTheDocument();
    });
  });

  it("renders Multi-Cloud Estate section with provider groups", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText("Multi-Cloud Estate")).toBeInTheDocument();
      const awsPills = screen.getAllByText(/AWS/i);
      expect(awsPills.length).toBeGreaterThan(0);
    });
  });

  it("renders project names after data loads", async () => {
    render(<Dashboard />);
    await waitFor(
      () => {
        const projectElements = screen.getAllByText("test-project");
        expect(projectElements.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  });

  // Fleets section (fleet-entity model)
  it("renders Fleets section with all-fleets-healthy when fleets exist and are ready", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      const fleetHeadings = screen.getAllByText("Fleets");
      expect(fleetHeadings.length).toBeGreaterThan(0);
      expect(screen.getByText("All fleets healthy")).toBeInTheDocument();
      expect(screen.getByText("Fleet Dashboard")).toBeInTheDocument();
    });
  });

  it("renders BNK version in cluster cards", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    const expandBtn = await screen.findByText("Expand All");
    await user.click(expandBtn);
    await waitFor(() => {
      const bnkVersions = screen.getAllByText("BNK 2.3.0");
      expect(bnkVersions.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders Fleet Dashboard link", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText("Fleet Dashboard")).toBeInTheDocument();
    });
  });

  it("hides offline operator warning when connectivity probe reports reachable", async () => {
    server.use(
      http.get("*/api/operators/fleet-health", () =>
        HttpResponse.json({
          total_clusters: 1,
          healthy: 0,
          warning: 0,
          critical: 0,
          offline: 1,
          unknown: 0,
          operators: [
            {
              operator_id: 1,
              operator_uuid: "cluster-1",
              cluster_id: 1,
              cluster_name: "bnk-agentcore-demo",
              status: "offline",
              last_seen: "2026-11-19T00:00:00Z",
              bnk_version: null,
              route_count: 0,
              tmm_count: 0,
              gateway_count: 0,
              uptime: "--",
              health_summary: { healthy: 0, warning: 0, critical: 0 },
              kubernetes_version: "1.30.0",
              node_count: 3,
              operator_version: null,
              connectivity_mode: "kubeconfig",
            },
          ],
        }),
      ),
      http.get("*/api/connectivity/state", () =>
        HttpResponse.json({
          states: [
            {
              target_type: "cluster",
              target_id: 1,
              state: "reachable",
              reason: null,
              last_checked_at: "2026-11-19T00:00:00Z",
              last_reachable_at: "2026-11-19T00:00:00Z",
            },
          ],
        }),
      ),
    );

    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText("Multi-Cloud Estate")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Operator offline/i)).not.toBeInTheDocument();
  });

  it("shows offline operator warning when connectivity probe is unreachable", async () => {
    server.use(
      http.get("*/api/operators/fleet-health", () =>
        HttpResponse.json({
          total_clusters: 1,
          healthy: 0,
          warning: 0,
          critical: 0,
          offline: 1,
          unknown: 0,
          operators: [
            {
              operator_id: 1,
              operator_uuid: "cluster-1",
              cluster_id: 1,
              cluster_name: "bnk-agentcore-demo",
              status: "offline",
              last_seen: "2026-11-19T00:00:00Z",
              bnk_version: null,
              route_count: 0,
              tmm_count: 0,
              gateway_count: 0,
              uptime: "--",
              health_summary: { healthy: 0, warning: 0, critical: 0 },
              kubernetes_version: "1.30.0",
              node_count: 3,
              operator_version: null,
              connectivity_mode: "kubeconfig",
            },
          ],
        }),
      ),
      http.get("*/api/connectivity/state", () =>
        HttpResponse.json({
          states: [
            {
              target_type: "cluster",
              target_id: 1,
              state: "unreachable",
              reason: "timeout",
              last_checked_at: "2026-11-19T00:00:00Z",
              last_reachable_at: null,
            },
          ],
        }),
      ),
    );

    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText(/Operator offline/i)).toBeInTheDocument();
    });
  });
});
