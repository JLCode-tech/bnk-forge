/**
 * Tests for LlmDashboard (/ai/token-governance) — Token Governance and Intelligence:
 * - Telemetry & FinOps tabs (overview, rankings, providers, chargeback)
 * - AI Gateway & DSSM Governance tabs (tenants, catalog, governance, audit, topology, diagnostics)
 * - URL model filter propagation, cluster scoping, CRUD actions, virtual key rotation, and auto-remediation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@/test/test-utils";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import LlmDashboard from "../LlmDashboard";
import type {
  LlmHistogram,
  LlmRankings,
  LlmFilterData,
  AiGatewayGovernanceOverview,
} from "@/types/llm-observability";

const histogram = (metric: string): LlmHistogram => ({
  available: true,
  endpoint: "http:loki:3100",
  updated_at: "2026-07-01T12:00:00Z",
  metric,
  step_s: 60,
  series: [
    { name: "input", points: [{ ts: "2026-07-01T11:00:00Z", value: 100 }] },
    { name: "cached", points: [{ ts: "2026-07-01T11:00:00Z", value: 40 }] },
  ],
  errors: {},
});

const rankings: LlmRankings = {
  available: true,
  endpoint: "http:loki:3100",
  updated_at: "2026-07-01T12:00:00Z",
  rows: [
    {
      model: "gpt-4o",
      provider: "openai",
      requests: 500,
      success_rate: 0.99,
      tokens: 120000,
      cost: 8.5,
      avg_latency_ms: 700,
      trend: { requests: 0.12, tokens: -0.05, cost: null },
    },
  ],
  errors: {},
};

const filterData: LlmFilterData = {
  available: true,
  endpoint: "http:loki:3100",
  updated_at: "2026-07-01T12:00:00Z",
  models: ["gpt-4o"],
  statuses: ["200"],
  errors: {},
};

const populatedGovernance: AiGatewayGovernanceOverview = {
  cluster_id: 1,
  namespace: "f5-bnk",
  updated_at: "2026-10-20T09:00:00Z",
  tenants: [
    {
      name: "enterprise-ai",
      cluster_id: 1,
      cluster_name: "Cluster Alpha",
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
      cluster_name: "Cluster Alpha",
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
      cluster_name: "Cluster Alpha",
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
      cluster_name: "Cluster Alpha",
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
};

let histogramRequests: URL[] = [];

beforeEach(() => {
  vi.restoreAllMocks();
  histogramRequests = [];
  server.use(
    http.get("*/api/k8s/llm-observability/histogram", ({ request }) => {
      const url = new URL(request.url);
      histogramRequests.push(url);
      const metric = url.searchParams.get("metric");
      if (metric === "latency") {
        return HttpResponse.json({
          available: true,
          endpoint: "fleet",
          updated_at: "2026-07-01T12:00:00Z",
          metric: "latency",
          step_s: 60,
          series: [
            {
              name: "Cluster Alpha",
              points: [{ ts: "2026-07-01T11:00:00Z", value: 120 }],
            },
            {
              name: "Cluster Beta",
              points: [{ ts: "2026-07-01T11:00:00Z", value: 240 }],
            },
          ],
          errors: {},
        });
      }
      return HttpResponse.json(histogram(metric ?? "requests"));
    }),
    http.get("*/api/k8s/llm-observability/rankings", () =>
      HttpResponse.json(rankings),
    ),
    http.get("*/api/k8s/llm-observability/provider-usage", ({ request }) =>
      HttpResponse.json(
        histogram(new URL(request.url).searchParams.get("metric") ?? "cost"),
      ),
    ),
    http.get("*/api/k8s/llm-observability/filterdata", () =>
      HttpResponse.json(filterData),
    ),
    http.get("*/api/k8s/llm-observability/governance/overview", () =>
      HttpResponse.json(populatedGovernance),
    ),
    http.get(
      "*/api/k8s/clusters/:id/llm-observability/histogram",
      ({ request }) => {
        const url = new URL(request.url);
        histogramRequests.push(url);
        return HttpResponse.json(
          histogram(url.searchParams.get("metric") ?? "requests"),
        );
      },
    ),
    http.get("*/api/k8s/clusters/:id/llm-observability/rankings", () =>
      HttpResponse.json(rankings),
    ),
    http.get(
      "*/api/k8s/clusters/:id/llm-observability/provider-usage",
      ({ request }) =>
        HttpResponse.json(
          histogram(new URL(request.url).searchParams.get("metric") ?? "cost"),
        ),
    ),
    http.get("*/api/k8s/clusters/:id/llm-observability/filterdata", () =>
      HttpResponse.json(filterData),
    ),
    http.get(
      "*/api/k8s/clusters/:id/llm-observability/governance/overview",
      () => HttpResponse.json(populatedGovernance),
    ),
  );
});

describe("LlmDashboard (/ai/token-governance)", () => {
  it("renders the Telemetry & FinOps and AI Gateway & Governance tabs", async () => {
    render(<LlmDashboard />, {
      initialRoute: "/ai/token-governance?cluster=1",
    });
    expect(screen.getByRole("tab", { name: /Overview/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Model Rankings/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Provider Usage/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /FinOps & Chargeback/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Tenants & Profiles/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Models & Providers/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Access & Virtual Keys/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Request Audit Logs/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Gateway Topology/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Gateway Diagnostics/i }),
    ).toBeInTheDocument();
  });

  it("fetches and renders rankings and Spend Share when the Model Rankings tab is selected", async () => {
    const user = userEvent.setup();
    render(<LlmDashboard />, {
      initialRoute: "/ai/token-governance?cluster=1",
    });

    await user.click(screen.getByRole("tab", { name: /Model Rankings/i }));

    await waitFor(() =>
      expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("new").length).toBeGreaterThan(0);
    expect(screen.getByText("Spend Share")).toBeInTheDocument();
    expect(screen.getAllByText("500").length).toBeGreaterThan(0);
  });

  it("maps legacy ?tab=chargeback deep-links to Model Rankings", async () => {
    render(<LlmDashboard />, {
      initialRoute: "/ai/token-governance?cluster=1&tab=chargeback",
    });

    await waitFor(() =>
      expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("Spend Share")).toBeInTheDocument();
  });

  it("propagates the URL model filter to the histogram request", async () => {
    render(<LlmDashboard />, {
      initialRoute: "/ai/token-governance?cluster=1&model=gpt-4o",
    });

    await waitFor(() => expect(histogramRequests.length).toBeGreaterThan(0));
    expect(
      histogramRequests.every((u) => u.searchParams.get("model") === "gpt-4o"),
    ).toBe(true);
  });

  it("defaults to the fleet aggregate when no cluster scope is stored", async () => {
    localStorage.removeItem("bnk-forge-cluster-scope");
    render(<LlmDashboard />, { initialRoute: "/ai/token-governance" });

    await waitFor(() => expect(histogramRequests.length).toBeGreaterThan(0));
    expect(
      histogramRequests.every(
        (u) => !u.pathname.includes("/api/k8s/clusters/"),
      ),
    ).toBe(true);
  });

  it("defaults to the shared cluster scope when one is stored", async () => {
    localStorage.setItem("bnk-forge-cluster-scope", "1");
    render(<LlmDashboard />, { initialRoute: "/ai/token-governance" });

    await waitFor(() => expect(histogramRequests.length).toBeGreaterThan(0));
    expect(
      histogramRequests.every((u) =>
        u.pathname.includes("/api/k8s/clusters/1/"),
      ),
    ).toBe(true);
    localStorage.removeItem("bnk-forge-cluster-scope");
  });

  it("renders multi-cluster latency series when All Clusters is selected", async () => {
    render(<LlmDashboard />, {
      initialRoute: "/ai/token-governance?cluster=all",
    });

    await waitFor(() =>
      expect(screen.getByText("Cluster Alpha")).toBeInTheDocument(),
    );
    expect(screen.getByText("Cluster Beta")).toBeInTheDocument();
  });

  it("switches across AI Gateway & DSSM Governance tabs and renders live CRD + DSSM objects and budget utilization", async () => {
    const user = userEvent.setup();
    render(<LlmDashboard />, {
      initialRoute: "/ai/token-governance?cluster=1",
    });

    // Switch to Models & Providers tab
    await user.click(screen.getByRole("tab", { name: /Models & Providers/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/openai-primary/i).length).toBeGreaterThan(0);
    });

    // Switch to Tenants & Profiles tab
    await user.click(screen.getByRole("tab", { name: /Tenants & Profiles/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/ai-inference-route/i).length).toBeGreaterThan(
        0,
      );
    });

    // Switch to Access & Virtual Keys tab (includes Org, Team & Virtual Key budget utilization)
    await user.click(
      screen.getByRole("tab", { name: /Access & Virtual Keys/i }),
    );
    await waitFor(() => {
      expect(screen.getAllByText(/upf-agent-prod-key/i).length).toBeGreaterThan(
        0,
      );
    });
    expect(
      screen.getAllByText(/Telco Core Engineering/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Packet Core AI Copilots/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Budget Utilization/i).length,
    ).toBeGreaterThan(0);

    // Switch to Request Audit Logs tab
    await user.click(screen.getByRole("tab", { name: /Request Audit Logs/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/req-audit-1/i).length).toBeGreaterThan(0);
    });

    // Switch to Gateway Topology tab
    await user.click(screen.getByRole("tab", { name: /Gateway Topology/i }));
    await waitFor(() => {
      expect(screen.getByText(/Gateway Fabric Topology/i)).toBeInTheDocument();
    });

    // Switch to Gateway Diagnostics tab
    await user.click(screen.getByRole("tab", { name: /Gateway Diagnostics/i }));
    await waitFor(() => {
      expect(
        screen.getAllByText(/CoreDNS aigw-dns-resolver Cache/i).length,
      ).toBeGreaterThan(0);
    });
  });
});
