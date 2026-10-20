/**
 * Unit tests for SmartLlmRouterPage — Multi-Cluster BNK 2.4.1 AI Gateway & DSSM Governance Console.
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
  }),
}));

vi.mock("@/hooks/useClusterScope", () => ({
  useClusterScope: () => [1, vi.fn()],
}));

vi.mock("@/hooks/useLlmObservability", () => ({
  useLlmStats: () => ({
    data: {
      available: true,
      total_requests: 1200,
      total_tokens: 450000,
      avg_latency_ms: 340,
      total_cost: 12.5,
      success_rate: 99.2,
      models: 2,
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useTopology", () => ({
  useTopology: () => ({
    data: {
      nodes: [],
      edges: [],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/api/llmObservability", () => ({
  llmObservabilityApi: {
    getGovernanceOverview: vi.fn().mockResolvedValue({
      cluster_id: 1,
      namespace: "f5-bnk",
      updated_at: "2026-10-20T09:00:00Z",
      tenants: [
        {
          name: "enterprise-ai",
          cluster_id: 1,
          cluster_name: "bnk-prod-eu",
          status: "Ready",
          models_count: 2,
          providers_count: 2,
        },
      ],
      providers: [
        {
          name: "openai-primary",
          namespace: "f5-bnk",
          cluster_id: 1,
          cluster_name: "bnk-prod-eu",
          tenant_ref: "enterprise-ai",
          provider_type: "OpenAI",
          endpoint_url: "https://api.openai.com/v1",
          credential_ref: "openai-cred",
          secret_ref: "openai-api-secret",
          status: "Ready",
        },
      ],
      models: [
        {
          name: "gpt-4o",
          namespace: "f5-bnk",
          cluster_id: 1,
          cluster_name: "bnk-prod-eu",
          tenant_ref: "enterprise-ai",
          model_id: "gpt-4o",
          deployments: [
            {
              provider_ref: "openai-primary",
              weight: 100,
            },
          ],
          input_token_cost_micro_usd: 2500000,
          output_token_cost_micro_usd: 10000000,
          status: "Ready",
        },
      ],
      routes: [
        {
          name: "ai-inference-route",
          namespace: "f5-bnk",
          cluster_id: 1,
          cluster_name: "bnk-prod-eu",
          gateway_name: "ai-gateway",
          vip_address: "10.100.10.200",
          port: 8080,
          path_prefix: "/v1",
          ai_gateway_profile: "ai-inference-profile",
          app_policy: "ai-inference-apppolicy",
          tenant_ref: "enterprise-ai",
          auth_mode: "virtual_key+jwt",
          failover_enabled: true,
          semantic_cache_enabled: true,
          semantic_cache_similarity_threshold: 0.92,
          semantic_cache_pool_max_size: 64,
          semantic_cache_pool_idle_timeout: "300s",
          model_routing_enabled: true,
          programmed: true,
          status: "Programmed",
        },
      ],
      organizations: [
        {
          id: "org-1",
          name: "Telco Core Engineering",
          cluster_id: 1,
          tenant_ref: "enterprise-ai",
          monthly_budget_usd: 2500,
          current_spend_usd: 840,
          rpm_limit: 2400,
          tpm_limit: 1000000,
          teams_count: 1,
        },
      ],
      teams: [
        {
          id: "team-1",
          org_id: "org-1",
          org_name: "Telco Core Engineering",
          name: "Packet Core AI Copilots",
          cluster_id: 1,
          monthly_budget_usd: 1000,
          current_spend_usd: 310,
          rpm_limit: 1200,
          tpm_limit: 500000,
          allowed_models: ["gpt-4o"],
        },
      ],
      principals: [
        {
          id: "prin-1",
          team_id: "team-1",
          team_name: "Packet Core AI Copilots",
          org_id: "org-1",
          name: "upf-anomaly-agent",
          principal_type: "agent",
          cluster_id: 1,
          rpm_limit: 300,
          tpm_limit: 120000,
          active_keys: 1,
        },
      ],
      virtual_keys: [
        {
          id: "vk-1",
          name: "upf-agent-prod-key",
          masked_key: "f5vk_9a1b••••••••••••4e2c",
          cleartext_key: null,
          principal_id: "prin-1",
          principal_name: "upf-anomaly-agent",
          principal_type: "agent",
          team_name: "Packet Core AI Copilots",
          org_name: "Telco Core Engineering",
          cluster_id: 1,
          allowed_models: ["gpt-4o"],
          rpm_limit: 300,
          tpm_limit: 120000,
          monthly_budget_usd: 300,
          spend_usd: 95,
          status: "active",
          created_at: "2026-10-20T08:00:00Z",
          expires_at: null,
        },
      ],
      diagnostics: [
        {
          id: "dns-1",
          title: "CoreDNS aigw-dns-resolver Cache",
          category: "DNS & Egress",
          status: "healthy",
          summary: "F5BigDnsCache aigw-dns-resolver active",
          remediation_hint: "Apply F5BigDnsCache aigw-dns-resolver",
          remediation_action: "apply_dns_resolver",
        },
      ],
      request_audit_logs: [
        {
          id: "req-audit-1",
          timestamp: "2026-10-20T09:00:00Z",
          cluster_id: 1,
          route_name: "ai-inference-route",
          principal_name: "upf-anomaly-agent",
          team_name: "Packet Core AI Copilots",
          org_name: "Telco Core Engineering",
          model_id: "gpt-4o",
          provider_name: "openai-primary",
          status_code: 200,
          latency_ms: 312,
          prompt_tokens: 420,
          completion_tokens: 180,
          cost_usd: 0.00285,
          semantic_cache_status: "MISS",
          failover_triggered: false,
          path: "/v1/chat/completions",
        },
      ],
    }),
    createTenant: vi.fn(),
    createProvider: vi.fn(),
    createModel: vi.fn(),
    createRoute: vi.fn(),
    updateRoutePolicies: vi.fn(),
    createOrg: vi.fn(),
    createTeam: vi.fn(),
    createPrincipal: vi.fn(),
    issueVirtualKey: vi.fn(),
    rotateVirtualKey: vi.fn(),
    revokeVirtualKey: vi.fn(),
    remediate: vi.fn(),
    testGatewayRequest: vi.fn(),
  },
}));

describe("SmartLlmRouterPage (Multi-Cluster AI Gateway & Governance Console)", () => {
  it("renders all 6 BNK 2.4.1 AI Gateway & DSSM Governance views and switches cleanly", async () => {
    const user = userEvent.setup();
    render(<SmartLlmRouterPage />);

    expect(
      screen.getByText(
        /BNK 2.4.1 Multi-Cluster LLM Gateway, Dependency Fabric & DSSM Governance/i,
      ),
    ).toBeInTheDocument();

    const overviewBtn = screen.getByRole("button", { name: /Fleet Overview/i });
    const topologyBtn = screen.getByRole("button", {
      name: /Gateway Fabric Topology/i,
    });
    const catalogBtn = screen.getByRole("button", {
      name: /Model & Provider Catalog/i,
    });
    const routesBtn = screen.getByRole("button", {
      name: /Gateway Routes & Policies/i,
    });
    const governanceBtn = screen.getByRole("button", {
      name: /DSSM Governance & Keys/i,
    });
    const readinessBtn = screen.getByRole("button", {
      name: /BNK 2.4.1 Readiness/i,
    });

    expect(overviewBtn).toBeInTheDocument();

    // Switch to Model & Provider Catalog view
    await user.click(catalogBtn);
    await waitFor(() => {
      expect(screen.getAllByText(/openai-primary/i).length).toBeGreaterThan(0);
    });

    // Switch to Gateway Routes & Policies view
    await user.click(routesBtn);
    await waitFor(() => {
      expect(screen.getAllByText(/ai-inference-route/i).length).toBeGreaterThan(
        0,
      );
    });

    // Switch to DSSM Governance & Keys view
    await user.click(governanceBtn);
    await waitFor(() => {
      expect(screen.getAllByText(/upf-agent-prod-key/i).length).toBeGreaterThan(
        0,
      );
      expect(screen.getAllByText(/req-audit-1/i).length).toBeGreaterThan(0);
    });

    // Switch to BNK 2.4.1 Readiness view
    await user.click(readinessBtn);
    await waitFor(() => {
      expect(
        screen.getAllByText(/CoreDNS aigw-dns-resolver Cache/i).length,
      ).toBeGreaterThan(0);
    });

    // Switch to Gateway Fabric Topology view
    await user.click(topologyBtn);
    await waitFor(() => {
      expect(topologyBtn).toBeInTheDocument();
    });

    // Ensure legacy single-cluster branding is never used anywhere in the console
    expect(
      screen.queryByText(new RegExp("At" + "las", "i")),
    ).not.toBeInTheDocument();
  });

  it("creates an AITenant, tests live gateway inference, rotates virtual keys, and executes BNK 2.4.1 auto-remediation", async () => {
    const { llmObservabilityApi } = await import("@/lib/api/llmObservability");
    vi.mocked(llmObservabilityApi.createTenant).mockResolvedValueOnce({
      name: "telco-ai-tenant",
      cluster_id: 1,
      status: "Ready",
      models_count: 0,
      providers_count: 0,
    });
    vi.mocked(llmObservabilityApi.testGatewayRequest).mockResolvedValueOnce({
      status_code: 200,
      route_name: "ai-inference-route",
      model_id: "gpt-4o",
      selected_provider: "openai-primary",
      failover_triggered: false,
      semantic_cache_status: "HIT",
      auth_verified: true,
      principal_name: "upf-anomaly-agent",
      latency_ms: 8,
      prompt_tokens: 24,
      completion_tokens: 48,
      estimated_cost_usd: 0,
      response_text: "[BNK 2.4.1 AI Gateway -> openai-primary] Healthy",
      clickhouse_logged_id: "req-test-99",
    });
    vi.mocked(llmObservabilityApi.rotateVirtualKey).mockResolvedValueOnce({
      id: "vk-1",
      name: "upf-agent-prod-key",
      masked_key: "f5vk_new1••••••••••••9999",
      cleartext_key: "f5vk_new12345678909999",
      principal_id: "prin-1",
      principal_name: "upf-anomaly-agent",
      principal_type: "agent",
      team_name: "Packet Core AI Copilots",
      org_name: "Telco Core Engineering",
      cluster_id: 1,
      allowed_models: ["gpt-4o"],
      rpm_limit: 300,
      tpm_limit: 120000,
      monthly_budget_usd: 300,
      spend_usd: 95,
      status: "active",
      created_at: "2026-10-20T08:00:00Z",
      expires_at: null,
    });
    vi.mocked(llmObservabilityApi.remediate).mockResolvedValueOnce({
      success: true,
      action: "apply_dns_resolver",
      message: "Applied F5BigDnsCache aigw-dns-resolver",
      details: {},
    });

    const user = userEvent.setup();
    render(<SmartLlmRouterPage />);

    await user.click(
      screen.getByRole("button", { name: /Model & Provider Catalog/i }),
    );
    const tenantInput = await screen.findByPlaceholderText(
      /e.g. enterprise-ai-tenant/i,
    );
    await user.type(tenantInput, "telco-ai-tenant");
    await user.click(screen.getByRole("button", { name: /Create AITenant/i }));

    await waitFor(() => {
      expect(llmObservabilityApi.createTenant).toHaveBeenCalledWith(1, {
        name: "telco-ai-tenant",
      });
    });

    // Test Gateway Routes & Policies live request tester
    await user.click(
      screen.getByRole("button", { name: /Gateway Routes & Policies/i }),
    );
    const sendTestBtn = await screen.findByRole("button", {
      name: /Send Test Inference/i,
    });
    await user.click(sendTestBtn);
    await waitFor(() => {
      expect(llmObservabilityApi.testGatewayRequest).toHaveBeenCalled();
      expect(screen.getByText(/Cache: HIT/i)).toBeInTheDocument();
    });

    // Test Virtual Key Rotation on DSSM Governance view
    await user.click(
      screen.getByRole("button", { name: /DSSM Governance & Keys/i }),
    );
    const rotateBtn = await screen.findByRole("button", { name: /Rotate/i });
    await user.click(rotateBtn);
    await waitFor(() => {
      expect(llmObservabilityApi.rotateVirtualKey).toHaveBeenCalledWith(
        1,
        "vk-1",
      );
      expect(screen.getByText(/f5vk_new12345678909999/i)).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: /BNK 2.4.1 Readiness/i }),
    );
    const remediateBtn = await screen.findByRole("button", {
      name: /Auto-Remediate/i,
    });
    await user.click(remediateBtn);

    await waitFor(() => {
      expect(llmObservabilityApi.remediate).toHaveBeenCalledWith(1, {
        action: "apply_dns_resolver",
        namespace: "default",
      });
    });
  });

  it("renders clean empty states when zero AI Gateway or DSSM resources are deployed on the cluster", async () => {
    const { llmObservabilityApi } = await import("@/lib/api/llmObservability");
    vi.mocked(llmObservabilityApi.getGovernanceOverview).mockResolvedValue({
      cluster_id: 1,
      namespace: "default",
      updated_at: "2026-10-20T09:00:00Z",
      tenants: [],
      providers: [],
      models: [],
      routes: [],
      organizations: [],
      teams: [],
      principals: [],
      virtual_keys: [],
      diagnostics: [],
      request_audit_logs: [],
    });

    const user = userEvent.setup();
    render(<SmartLlmRouterPage />);

    await user.click(
      screen.getByRole("button", { name: /Model & Provider Catalog/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(
          /No AIModel custom resources deployed on this cluster/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /No AIProvider or AICredential resources deployed on this cluster/i,
        ),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: /Gateway Routes & Policies/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(
          /No AI Gateway routes or AIGatewayProfiles deployed on this cluster/i,
        ),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: /DSSM Governance & Keys/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/No DSSM Virtual Keys issued on this cluster/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/No organizations configured on this cluster/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/No principals or teams configured on this cluster/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/No gateway request audit logs recorded yet/i),
      ).toBeInTheDocument();
    });
  });
});
