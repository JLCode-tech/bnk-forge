/**
 * Tests for System page, SystemUpgrade (min_upgrade_from), and ContainerManagement
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { render } from "@/test/test-utils";
import System from "@/pages/System";
import SystemUpgrade from "@/components/settings/SystemUpgrade";
import ContainerManagement from "@/components/settings/ContainerManagement";
import * as useSystemHooks from "@/hooks/useSystem";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    getUpgradeStatus: vi.fn().mockResolvedValue({ status: "idle", log: [] }),
    getSystemVersion: vi.fn(),
    getContainerStatus: vi.fn(),
    restartContainers: vi.fn(),
    triggerSystemUpgrade: vi.fn(),
    verifyPostUpgrade: vi.fn(),
    getSystemHealth: vi.fn().mockResolvedValue({
      services: {
        backend: { status: "healthy", response_time_ms: 4 },
        database: { status: "healthy", response_time_ms: 2 },
        redis: { status: "healthy", response_time_ms: 1 },
        celery: { status: "healthy", workers: 2, active_tasks: 0 },
      },
      timestamp: "2026-10-23T00:00:00Z",
    }),
    getQueueMetrics: vi.fn().mockResolvedValue({
      queues: {
        default: { pending: 0, active: 0 },
        opentofu: { pending: 0, active: 0 },
      },
      workers: { total: 2, active: 2, offline: 0 },
      tasks: { pending: 0, active: 0, completed_last_hour: 5 },
    }),
    getPerformanceMetrics: vi.fn().mockResolvedValue({
      api: {
        avg_response_time_ms: 12,
        requests_last_hour: 120,
        failed_requests_last_hour: 0,
      },
      database: { size_mb: 42, connections: 5, slow_queries_last_hour: 0 },
      tasks: { avg_duration_seconds: 1.5, longest_running: null },
    }),
    getRecentErrors: vi.fn().mockResolvedValue({ errors: [], total: 0 }),
    getDatabaseStats: vi.fn().mockResolvedValue({
      size_mb: 42,
      tables: {
        tasks: { rows: 10, size_mb: 1 },
        deployment_logs: { rows: 100, size_mb: 5 },
        audit_logs: { rows: 50, size_mb: 2 },
      },
    }),
  },
}));

describe("System Page & Operational Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SystemUpgrade component", () => {
    it("renders current version and minimum upgrade floor (min_upgrade_from)", () => {
      vi.spyOn(useSystemHooks, "useSystemVersion").mockReturnValue({
        data: {
          current_version: "3.1.0",
          latest_version: "3.1.0",
          min_upgrade_from: "3.0.0",
          update_available: false,
          commits_behind: 0,
          upgrade_readiness: {
            host_repo_path_set: false,
            docker_socket_available: false,
            upgrade_ready: false,
            upgrade_in_progress: false,
            deployment_mode: "local",
            recommended_command: "make local-deploy",
            recommended_label: "Run from repo root",
            gui_upgrade_supported: false,
          },
        },
        isLoading: false,
        isRefetching: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useSystemHooks.useSystemVersion>);

      render(<SystemUpgrade />);

      expect(screen.getByText("v3.1.0")).toBeInTheDocument();
      expect(screen.getByText("Up to date")).toBeInTheDocument();
      expect(screen.getByText(/Minimum upgrade floor:/i)).toBeInTheDocument();
      expect(screen.getByText("v3.0.0")).toBeInTheDocument();
      expect(
        screen.getByText(/Local upgrade is command-driven/i),
      ).toBeInTheDocument();
    });

    it("omits minimum upgrade floor badge when min_upgrade_from is undefined", () => {
      vi.spyOn(useSystemHooks, "useSystemVersion").mockReturnValue({
        data: {
          current_version: "4.0.0",
          latest_version: "4.0.0",
          update_available: false,
          commits_behind: 0,
        },
        isLoading: false,
        isRefetching: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useSystemHooks.useSystemVersion>);

      render(<SystemUpgrade />);

      expect(screen.getByText("v4.0.0")).toBeInTheDocument();
      expect(
        screen.queryByText(/Minimum upgrade floor:/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("ContainerManagement component", () => {
    it("expands container list and enforces restricted service safety guards", async () => {
      vi.spyOn(useSystemHooks, "useContainerStatus").mockReturnValue({
        data: {
          containers: [
            {
              service: "backend",
              container_name: "bnk-forge-backend",
              state: "running",
              status: "Up 2 hours (healthy)",
            },
            {
              service: "frontend",
              container_name: "bnk-forge-frontend",
              state: "running",
              status: "Up 2 hours (healthy)",
            },
            {
              service: "postgres",
              container_name: "bnk-forge-postgres",
              state: "running",
              status: "Up 2 hours (healthy)",
            },
            {
              service: "docker-socket-proxy",
              container_name: "bnk-forge-docker-socket-proxy",
              state: "running",
              status: "Up 2 hours (healthy)",
            },
          ],
          total: 4,
          available: true,
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useSystemHooks.useContainerStatus>);

      vi.spyOn(useSystemHooks, "useRestartContainers").mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof useSystemHooks.useRestartContainers>);

      render(<ContainerManagement />);

      // Expand the collapsible section
      const trigger = screen.getByRole("button", {
        name: /Container management/i,
      });
      fireEvent.click(trigger);

      await waitFor(() => {
        expect(screen.getByText("bnk-forge-backend")).toBeInTheDocument();
      });

      expect(screen.getByText("bnk-forge-frontend")).toBeInTheDocument();
      expect(screen.getByText("bnk-forge-postgres")).toBeInTheDocument();
      expect(
        screen.getByText("bnk-forge-docker-socket-proxy"),
      ).toBeInTheDocument();

      // Checkboxes for postgres and docker-socket-proxy should be disabled
      const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(checkboxes).toHaveLength(4);
      expect(checkboxes[0].disabled).toBe(false); // backend
      expect(checkboxes[1].disabled).toBe(false); // frontend
      expect(checkboxes[2].disabled).toBe(true); // postgres
      expect(checkboxes[3].disabled).toBe(true); // docker-socket-proxy

      // Clicking backend selects it and updates the "Restart Selected (1)" button
      fireEvent.click(screen.getByText("bnk-forge-backend"));
      expect(
        screen.getByRole("button", { name: /Restart Selected \(1\)/i }),
      ).not.toBeDisabled();
      expect(screen.getByText("System Diagnostics")).toBeInTheDocument();
      expect(screen.getByText("4 / 4 running")).toBeInTheDocument();
    });
  });

  describe("System page navigation", () => {
    it("renders System tabs and monitor panels", () => {
      vi.spyOn(useSystemHooks, "useSystemVersion").mockReturnValue({
        data: {
          current_version: "3.1.0",
          latest_version: "3.1.0",
          min_upgrade_from: "3.0.0",
          update_available: false,
          commits_behind: 0,
        },
        isLoading: false,
        isRefetching: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useSystemHooks.useSystemVersion>);

      vi.spyOn(useSystemHooks, "useContainerStatus").mockReturnValue({
        data: { containers: [], total: 0, available: true },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useSystemHooks.useContainerStatus>);

      render(<System />);

      expect(
        screen.getByRole("tab", { name: /System Monitor/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: /MCP Server/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: /Audit Log/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: /Backup & Restore/i }),
      ).toBeInTheDocument();
      expect(screen.getByText("v3.1.0")).toBeInTheDocument();
      expect(screen.getByText("v3.0.0")).toBeInTheDocument();
      expect(api.getUpgradeStatus).toBeDefined();
    });
  });
});
