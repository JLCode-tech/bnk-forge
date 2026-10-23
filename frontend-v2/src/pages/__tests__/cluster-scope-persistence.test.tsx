/**
 * Integration test: Cluster Scope Persistence Across Navigation (Phase 0 / B-1)
 *
 * Verifies that navigating from /kubernetes (with cluster X selected) to
 * /cnf or /bnk (with a different stored project) preserves cluster X in the
 * shared cluster scope (STORAGE_KEYS.CLUSTER_SCOPE) rather than wiping it.
 * The page instead widens/clears its project selection so cluster X remains valid.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { render } from "@/test/test-utils";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import CNF from "@/pages/CNF";
import F5BNK from "@/pages/F5BNK";
import KubernetesV2 from "@/pages/KubernetesV2";

// Mocks for components/hooks that perform deep DOM operations or shortcut timers
vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: vi.fn((value: string) => value),
}));

vi.mock("@/hooks/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock("@/components/k8s/ResourceDescribeViewer", () => ({
  ResourceDescribeViewer: () => null,
}));

vi.mock("@/components/k8s/ResourceDeleteDialog", () => ({
  ResourceDeleteDialog: () => null,
}));

// Two distinct projects, each with their own cluster
const mockProjects = [
  { id: 1, name: "Project Alpha", cluster_ids: [10] },
  { id: 2, name: "Project Beta", cluster_ids: [20] },
];

const mockClusters = [
  {
    id: 10,
    name: "cluster-alpha",
    project_id: 1,
    status: "active",
    context: "cluster-alpha-ctx",
    api_server: "https://cluster-alpha.local",
    cloud_provider: "aws",
    detected_platform_profile: "eks",
    detected_platform_provider: "aws",
    platform_capabilities: {},
    platform_constraints: {},
    region: "us-west-2",
    default_namespace: "default",
    version: "1.29",
    ssh_tunnel_enabled: false,
    ssh_remote_k8s_host: null,
    ssh_remote_k8s_port: null,
    ssh_credential_id: null,
    ssh_host_override: null,
    last_synced_at: null,
    created_at: null,
  },
  {
    id: 20,
    name: "cluster-beta",
    project_id: 2,
    status: "active",
    context: "cluster-beta-ctx",
    api_server: "https://cluster-beta.local",
    cloud_provider: "azure",
    detected_platform_profile: "aks",
    detected_platform_provider: "azure",
    platform_capabilities: {},
    platform_constraints: {},
    region: "eastus",
    default_namespace: "default",
    version: "1.29",
    ssh_tunnel_enabled: false,
    ssh_remote_k8s_host: null,
    ssh_remote_k8s_port: null,
    ssh_credential_id: null,
    ssh_host_override: null,
    last_synced_at: null,
    created_at: null,
  },
];

function setupApiMocks() {
  server.use(
    http.get("*/api/projects", () => {
      return HttpResponse.json({ projects: mockProjects, total: 2 });
    }),
    http.get("*/api/k8s/clusters", () => {
      return HttpResponse.json({ clusters: mockClusters, count: 2 });
    }),
    http.get("*/api/projects/:projectId/k8s/clusters", ({ params }) => {
      const pId = Number(params.projectId);
      const filtered = mockClusters.filter((c) => c.project_id === pId);
      return HttpResponse.json({ clusters: filtered, count: filtered.length });
    }),
    http.get("*/api/k8s/clusters/:clusterId/namespaces", ({ params }) => {
      return HttpResponse.json({
        namespaces: [{ name: "default", status: "Active" }],
        count: 1,
        cluster_id: Number(params.clusterId),
      });
    }),
    http.get("*/api/k8s/clusters/:clusterId/nodes/count", ({ params }) => {
      return HttpResponse.json({
        cluster_id: Number(params.clusterId),
        node_count: 3,
      });
    }),
    http.get("*/api/k8s/clusters/:id/resource-summary", ({ params }) => {
      return HttpResponse.json({
        cluster_id: Number(params.id),
        summary: {},
      });
    }),
    http.get("*/api/k8s/clusters/:id/resources/:type", ({ params }) => {
      return HttpResponse.json({
        resources: [],
        count: 0,
        resource_type: String(params.type),
        namespace: "default",
        cluster_id: Number(params.id),
      });
    }),
    http.get("*/api/k8s/clusters/:id/f5bnk/data", () => {
      return HttpResponse.json({
        cluster_id: 10,
        cluster_name: "cluster-alpha",
        namespaces: ["default"],
        gateway_classes: [],
        gateways: [],
        http_routes: [],
        tls_routes: [],
        tcp_routes: [],
        udp_routes: [],
        backend_traffic_policies: [],
        reference_grants: [],
        load_balancer_pools: [],
        ingress_records: [],
        security_policies: [],
        ipams: [],
        dns_records: [],
      });
    }),
    http.get("*/api/k8s/clusters/:id/crds", () => {
      return HttpResponse.json({
        crds: [],
        cluster_id: 10,
      });
    }),
  );
}

describe("Cluster Scope Persistence Across Navigation (Phase 0 / B-1)", () => {
  beforeEach(() => {
    localStorage.clear();
    setupApiMocks();
  });

  it("keeps cluster X when navigating /kubernetes (cluster 10) -> /cnf (stored project 2) -> /kubernetes", async () => {
    // 1. User starts on /kubernetes with Cluster 10 (Project 1) selected
    localStorage.setItem(STORAGE_KEYS.CLUSTER_SCOPE, "10");
    localStorage.setItem(STORAGE_KEYS.K8S_PROJECT, "1");

    // Simulate prior /cnf visit where Project 2 (Beta) was selected
    localStorage.setItem(STORAGE_KEYS.CNF_PROJECT, "2");

    // 2. User navigates to /cnf
    const cnfRender = render(<CNF />, { initialRoute: "/cnf" });

    // Wait for CNF to load projects and clusters
    await waitFor(() => {
      expect(screen.getByText("F5 CNF")).toBeInTheDocument();
    });

    // Verify CNF widens (clears project) rather than wiping the shared cluster scope
    await waitFor(() => {
      // Cluster scope must remain untouched (still Cluster 10)
      expect(localStorage.getItem(STORAGE_KEYS.CLUSTER_SCOPE)).toBe("10");
      // Conflicting CNF project must be cleared/removed
      expect(localStorage.getItem(STORAGE_KEYS.CNF_PROJECT)).toBeNull();
    });

    cnfRender.unmount();

    // 3. User navigates back to /kubernetes
    const k8sRender = render(<KubernetesV2 />, { initialRoute: "/kubernetes" });

    await waitFor(() => {
      expect(screen.getAllByText(/kubernetes/i).length).toBeGreaterThan(0);
    });

    // Cluster scope is still preserved as Cluster 10
    expect(localStorage.getItem(STORAGE_KEYS.CLUSTER_SCOPE)).toBe("10");

    k8sRender.unmount();
  });

  it("keeps cluster X when navigating /kubernetes (cluster 10) -> /bnk (stored project 2)", async () => {
    // 1. Cluster 10 is selected globally
    localStorage.setItem(STORAGE_KEYS.CLUSTER_SCOPE, "10");
    // Prior visit to F5BNK stored Project 2
    localStorage.setItem(STORAGE_KEYS.BNK_PROJECT, "2");

    // 2. User navigates to /bnk
    const bnkRender = render(<F5BNK />, { initialRoute: "/bnk" });

    // Wait for F5BNK to render
    await waitFor(() => {
      expect(screen.getByText("F5 BNK")).toBeInTheDocument();
    });

    // Verify F5BNK widens project rather than clearing selected cluster
    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEYS.CLUSTER_SCOPE)).toBe("10");
      expect(localStorage.getItem(STORAGE_KEYS.BNK_PROJECT)).toBeNull();
    });

    bnkRender.unmount();
  });
});
