/**
 * LlmDashboard — Token Governance and Intelligence (/ai/token-governance).
 *
 * Unifies AI Gateway token telemetry (Loki + ClickHouse otel.aigw_requests),
 * model rankings & spend share, provider usage, and multi-cluster AI Gateway
 * & DSSM Governance (AITenant, AIGatewayProfile, AIModel, AIProvider, AICredential,
 * Organizations, Teams, Principals, Virtual Keys, Dependency Fabric Topology, and
 * Readiness Diagnostics).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// eslint-disable-next-line no-restricted-imports -- Vertical flush sub-sidebar requires Radix TabsList + TabsTrigger
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Info,
  ArrowUpDown,
  Zap,
  BarChart3,
  Trophy,
  Layers,
  RefreshCw,
  Sliders,
  Cpu,
  KeyRound,
  FileText,
  Network,
  Wrench,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import {
  ChartCard,
  ChartTypeToggle,
  TimeSeriesChart,
  TimeRangePicker,
  TrendBadge,
  ClusterPicker,
  FilterSelect,
  seriesColor,
  providerColor,
  SUCCESS_COLOR,
  ERROR_COLOR,
  fmtInt,
  fmtCompact,
  fmtCost,
  fmtLatencyMs,
  fmtPct,
  inferProvider,
  type ChartType,
} from "@/components/observability";
import {
  useLlmHistogram,
  useLlmFilterData,
  useLlmProviderUsage,
  useLlmRankings,
  useLlmStats,
  type LlmClusterScope,
} from "@/hooks/useLlmObservability";
import { useBenchmarkSummary } from "@/hooks/useBenchmarks";
import { useAllClusters, useClusterNamespaces } from "@/hooks/useK8sClusters";
import { useTopology } from "@/hooks/useTopology";
import { ResourceTopologyGraph } from "@/components/k8s/ResourceTopologyGraph";
import { ResourceDescribeViewer } from "@/components/k8s/ResourceDescribeViewer";
import { llmObservabilityApi } from "@/lib/api/llmObservability";
import { useObservabilityFilters } from "./use-observability-filters";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import type { K8sResource } from "@/types/kubernetes";
import type {
  AiGatewayGovernanceOverview as AiGatewayGovernanceOverviewResponse,
  ClickHouseRequestAuditItem as AiGatewayRequestLogItem,
  LlmHistogramMetric,
  LlmObservabilityParams,
  LlmProviderMetric,
  LlmRankingRow,
  LlmSeries,
} from "@/types/llm-observability";

const sumSeries = (series: LlmSeries[]): number =>
  series.reduce((acc, s) => acc + s.points.reduce((a, p) => a + p.value, 0), 0);

const requestSeriesColor = (name: string): string =>
  name.toLowerCase().includes("error") ? ERROR_COLOR : SUCCESS_COLOR;

const LLM_REFRESH_KEYS = [
  ["llm-observability"],
  ["llm-governance-overview"],
] as const;

function filterAuditLogs(
  logs: AiGatewayRequestLogItem[],
  modelFilter: string,
  statusFilter: string,
): AiGatewayRequestLogItem[] {
  return logs.filter((log) => {
    if (modelFilter && log.model_id !== modelFilter) return false;
    if (statusFilter) {
      const s = statusFilter.toLowerCase();
      if (s === "success" || s === "200") {
        if (log.status_code < 200 || log.status_code >= 400) return false;
      } else if (s === "error" || s === "500" || s === "429") {
        if (log.status_code < 400) return false;
      } else if (String(log.status_code) !== statusFilter) {
        return false;
      }
    }
    return true;
  });
}

function buildHistogramSeriesFromAuditLogs(
  logs: AiGatewayRequestLogItem[],
  metric: LlmHistogramMetric,
): LlmSeries[] {
  if (logs.length === 0) return [];
  if (metric === "requests") {
    const okPoints = logs.map((l) => ({
      ts: l.timestamp,
      value: l.status_code >= 200 && l.status_code < 400 ? 1 : 0,
    }));
    const errPoints = logs.map((l) => ({
      ts: l.timestamp,
      value: l.status_code >= 400 ? 1 : 0,
    }));
    const series: LlmSeries[] = [{ name: "success", points: okPoints }];
    if (errPoints.some((p) => p.value > 0)) {
      series.push({ name: "error", points: errPoints });
    }
    return series;
  }
  if (metric === "tokens") {
    return [
      {
        name: "prompt",
        points: logs.map((l) => ({ ts: l.timestamp, value: l.prompt_tokens })),
      },
      {
        name: "completion",
        points: logs.map((l) => ({
          ts: l.timestamp,
          value: l.completion_tokens,
        })),
      },
    ];
  }
  if (metric === "cost") {
    return [
      {
        name: "cost",
        points: logs.map((l) => ({ ts: l.timestamp, value: l.cost_usd })),
      },
    ];
  }
  if (metric === "models") {
    const byModel = new Map<string, Array<{ ts: string; value: number }>>();
    for (const l of logs) {
      const list = byModel.get(l.model_id) ?? [];
      list.push({ ts: l.timestamp, value: 1 });
      byModel.set(l.model_id, list);
    }
    return Array.from(byModel.entries()).map(([name, points]) => ({
      name,
      points,
    }));
  }
  // latency
  return [
    {
      name: "latency",
      points: logs.map((l) => ({ ts: l.timestamp, value: l.latency_ms })),
    },
  ];
}

function buildRankingsFromGovernance(
  govOverview: AiGatewayGovernanceOverviewResponse | undefined,
  modelFilter: string,
  statusFilter: string,
): LlmRankingRow[] {
  if (!govOverview) return [];
  const logs = filterAuditLogs(
    govOverview.request_audit_logs ?? [],
    modelFilter,
    statusFilter,
  );
  const byModel = new Map<
    string,
    {
      provider: string;
      requests: number;
      ok: number;
      tokens: number;
      cost: number;
      latencySum: number;
    }
  >();

  for (const log of logs) {
    const cur = byModel.get(log.model_id) ?? {
      provider:
        inferProvider(log.model_id) !== "unknown"
          ? inferProvider(log.model_id)
          : log.provider_name || "openai",
      requests: 0,
      ok: 0,
      tokens: 0,
      cost: 0,
      latencySum: 0,
    };
    cur.requests += 1;
    if (log.status_code >= 200 && log.status_code < 400) cur.ok += 1;
    cur.tokens += log.prompt_tokens + log.completion_tokens;
    cur.cost += log.cost_usd;
    cur.latencySum += log.latency_ms;
    byModel.set(log.model_id, cur);
  }

  for (const m of govOverview.models ?? []) {
    if (modelFilter && m.model_id !== modelFilter) continue;
    if (!byModel.has(m.model_id)) {
      const provRef = m.deployments?.[0]?.provider_ref ?? "";
      const inferred = inferProvider(m.model_id);
      byModel.set(m.model_id, {
        provider: inferred !== "unknown" ? inferred : provRef || "openai",
        requests: 0,
        ok: 0,
        tokens: 0,
        cost: 0,
        latencySum: 0,
      });
    }
  }

  return Array.from(byModel.entries()).map(([model, agg]) => ({
    model,
    provider: agg.provider,
    requests: agg.requests,
    success_rate: agg.requests > 0 ? agg.ok / agg.requests : 1,
    tokens: agg.tokens,
    cost: agg.cost,
    avg_latency_ms: agg.requests > 0 ? agg.latencySum / agg.requests : 0,
    trend: { requests: null, tokens: null, cost: null },
  }));
}

const VIEW_META: Record<string, { title: string; subtitle: string }> = {
  overview: {
    title: "Gateway Telemetry & Token Overview",
    subtitle:
      "Request analytics, token throughput, latency, and spend across AI Gateway & Loki telemetry.",
  },
  rankings: {
    title: "Model Rankings & Spend Attribution",
    subtitle:
      "Comparative token throughput, latency, cost, and relative spend share across governed LLM models.",
  },
  providers: {
    title: "Provider Usage",
    subtitle:
      "Aggregated token consumption, latency, and spend by inference provider.",
  },
  tenants: {
    title: "Tenants, Gateway Profiles & Route Policies",
    subtitle:
      "AITenant, AIGatewayProfile & AppPolicy provisioning, semantic cache connection pooling, and live inference policy testing.",
  },
  catalog: {
    title: "Model & Provider Catalog",
    subtitle:
      "AIProvider, AICredential & AIModel catalog with weighted multi-provider deployments and micro-USD token pricing.",
  },
  governance: {
    title: "Access Control & DSSM Virtual Keys",
    subtitle:
      "Organizations, Teams, Principals (User/Service/Agent), monthly budgets, RPM/TPM rate limits & f5vk_ Virtual Keys.",
  },
  audit: {
    title: "Request Audit & Spend Attribution Logs",
    subtitle:
      "Per-request token usage, micro-USD cost attribution, semantic cache HIT/MISS, and provider failover audit trail.",
  },
  topology: {
    title: "AI Gateway Dependency Fabric Topology",
    subtitle:
      "Interactive cross-CRD reference graph (AppPolicy → Gateway ↔ HTTPRoute & AIGatewayProfile → AIModel → AIProvider → Secret).",
  },
  diagnostics: {
    title: "AI Gateway & CNF Readiness Diagnostics",
    subtitle:
      "Automated verification and 1-click remediation for AIGatewayProfile status, CoreDNS aigw-dns-resolver, and CNE readiness.",
  },
};

export default function LlmDashboard() {
  const queryClient = useQueryClient();
  const f = useObservabilityFilters("overview");
  const { data: clustersData } = useAllClusters();
  const clusters = useMemo(
    () => clustersData?.clusters ?? [],
    [clustersData?.clusters],
  );
  const [namespace, setNamespace] = useState<string>("all");
  const { data: filterData } = useLlmFilterData(f.clusterId, f.range);
  const { refresh, isRefreshing } = usePageRefresh(LLM_REFRESH_KEYS);

  const effectiveClusterId = f.clusterId ?? clusters[0]?.id ?? 1;
  const { data: namespacesData } = useClusterNamespaces(f.clusterId ?? 0, {
    enabled: !!f.clusterId,
  });

  const {
    data: govOverview,
    isLoading: govLoading,
    refetch: refetchGov,
  } = useQuery({
    queryKey: ["llm-governance-overview", f.clusterId ?? "all", namespace],
    queryFn: () =>
      llmObservabilityApi.getGovernanceOverview(
        f.clusterId ?? undefined,
        namespace,
      ),
  });

  const discoveredNamespaces = useMemo(() => {
    const nsSet = new Set<string>();
    for (const ns of namespacesData?.namespaces ?? []) {
      const nsName = typeof ns === "string" ? ns : ns?.name;
      if (nsName) nsSet.add(nsName);
    }
    const targetClusters = f.clusterId
      ? clusters.filter((c) => c.id === f.clusterId)
      : clusters;
    for (const c of targetClusters) {
      const clusterNs = (c as { discovered_namespaces?: string[] })
        .discovered_namespaces;
      if (Array.isArray(clusterNs)) {
        for (const ns of clusterNs) {
          if (ns) nsSet.add(ns);
        }
      }
    }
    for (const p of govOverview?.providers ?? []) {
      if (p.namespace) nsSet.add(p.namespace);
    }
    for (const m of govOverview?.models ?? []) {
      if (m.namespace) nsSet.add(m.namespace);
    }
    for (const r of govOverview?.routes ?? []) {
      if (r.namespace) nsSet.add(r.namespace);
    }
    return Array.from(nsSet).sort();
  }, [
    namespacesData?.namespaces,
    clusters,
    f.clusterId,
    govOverview?.providers,
    govOverview?.models,
    govOverview?.routes,
  ]);

  useEffect(() => {
    if (
      namespace !== "all" &&
      discoveredNamespaces.length > 0 &&
      !discoveredNamespaces.includes(namespace)
    ) {
      setNamespace("all");
    }
  }, [f.clusterId, discoveredNamespaces, namespace]);

  const targetNamespace = useMemo(() => {
    if (namespace !== "all") return namespace;
    const resourceNs =
      govOverview?.routes?.[0]?.namespace ||
      govOverview?.providers?.[0]?.namespace ||
      govOverview?.models?.[0]?.namespace;
    if (resourceNs) return resourceNs;
    if (discoveredNamespaces.includes("f5-bnk")) return "f5-bnk";
    return discoveredNamespaces[0] ?? "default";
  }, [
    namespace,
    govOverview?.routes,
    govOverview?.providers,
    govOverview?.models,
    discoveredNamespaces,
  ]);

  const { data: llmStats } = useLlmStats(f.clusterId, {
    range: f.range,
    model: f.model,
    status: f.status,
  });
  const { data: benchmarkSummary } = useBenchmarkSummary(
    f.clusterId ?? undefined,
  );

  const hasGovTopology = (govOverview?.topology_nodes?.length ?? 0) > 0;
  const { data: fabricTopology, refetch: refetchTopology } = useTopology(
    effectiveClusterId,
    targetNamespace,
    {
      enabled: f.tab === "topology" && !!effectiveClusterId && hasGovTopology,
    },
  );

  // Form states for AI Gateway & DSSM Governance tabs
  const [newTenantName, setNewTenantName] = useState("");
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderType, setNewProviderType] = useState("Generic");
  const [newProviderEndpoint, setNewProviderEndpoint] = useState("");
  const [newProviderApiKey, setNewProviderApiKey] = useState("");

  const [newModelName, setNewModelName] = useState("");
  const [newModelId, setNewModelId] = useState("");
  const [newModelProviderRef, setNewModelProviderRef] = useState("");
  const [newModelWeight, setNewModelWeight] = useState("100");
  const [newModelInputCost, setNewModelInputCost] = useState("");
  const [newModelOutputCost, setNewModelOutputCost] = useState("");

  const [newRouteName, setNewRouteName] = useState("");
  const [newRouteVip, setNewRouteVip] = useState("");
  const [newRoutePort, setNewRoutePort] = useState("8080");
  const [newRouteAuth, setNewRouteAuth] = useState("virtual-key");
  const [newRoutePoolMaxSize, setNewRoutePoolMaxSize] = useState("64");
  const [newRoutePoolIdleTimeout, setNewRoutePoolIdleTimeout] =
    useState("300s");
  const [newRouteSemanticCache, setNewRouteSemanticCache] = useState(true);
  const [newRouteFailover, setNewRouteFailover] = useState(true);
  const [newRouteModelRouting, setNewRouteModelRouting] = useState(true);

  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPrincipalId, setNewKeyPrincipalId] = useState("");
  const [newKeyRpm, setNewKeyRpm] = useState("");
  const [newKeyTpm, setNewKeyTpm] = useState("");
  const [newKeyBudget, setNewKeyBudget] = useState("");
  const [issuedCleartextKey, setIssuedCleartextKey] = useState<string | null>(
    null,
  );
  const [copiedKey, setCopiedKey] = useState(false);
  const [remediationBanner, setRemediationBanner] = useState<string | null>(
    null,
  );

  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgBudget, setNewOrgBudget] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamOrgId, setNewTeamOrgId] = useState("");
  const [newTeamBudget, setNewTeamBudget] = useState("");
  const [newPrincipalName, setNewPrincipalName] = useState("");
  const [newPrincipalType, setNewPrincipalType] = useState<
    "user" | "service" | "agent"
  >("agent");
  const [newPrincipalTeamId, setNewPrincipalTeamId] = useState("");

  const [testRouteName, setTestRouteName] = useState("");
  const [testModelId, setTestModelId] = useState("");
  const [testPath, setTestPath] = useState("/v1/chat/completions");
  const [testVirtualKey, setTestVirtualKey] = useState("");
  const [testPrompt, setTestPrompt] = useState("");
  const [testSimulateFailure, setTestSimulateFailure] = useState(false);

  const [describeResource, setDescribeResource] = useState<K8sResource | null>(
    null,
  );
  const [describeOpen, setDescribeOpen] = useState(false);

  const invalidateGov = () => {
    void queryClient.invalidateQueries({
      queryKey: ["llm-governance-overview"],
    });
    void refetchTopology();
  };

  const createTenantMut = useMutation({
    mutationFn: () =>
      llmObservabilityApi.createTenant(effectiveClusterId, {
        name: newTenantName.trim(),
      }),
    onSuccess: () => {
      setNewTenantName("");
      invalidateGov();
    },
  });

  const createProviderMut = useMutation({
    mutationFn: () =>
      llmObservabilityApi.createProvider(effectiveClusterId, {
        name: newProviderName.trim(),
        namespace: targetNamespace,
        tenant_ref: govOverview?.tenants[0]?.name ?? "",
        provider_type: newProviderType,
        endpoint_url: newProviderEndpoint.trim() || null,
        api_key: newProviderApiKey.trim() || null,
      }),
    onSuccess: () => {
      setNewProviderName("");
      setNewProviderApiKey("");
      invalidateGov();
    },
  });

  const createModelMut = useMutation({
    mutationFn: () =>
      llmObservabilityApi.createModel(effectiveClusterId, {
        name: newModelName.trim(),
        namespace: targetNamespace,
        tenant_ref: govOverview?.tenants[0]?.name ?? "",
        model_id: newModelId.trim() || newModelName.trim(),
        deployments: [
          {
            provider_ref:
              newModelProviderRef.trim() ||
              (govOverview?.providers[0]?.name ?? ""),
            weight: Number(newModelWeight) || 100,
          },
        ],
        input_token_cost_micro_usd: Number(newModelInputCost) || 0,
        output_token_cost_micro_usd: Number(newModelOutputCost) || 0,
      }),
    onSuccess: () => {
      setNewModelName("");
      invalidateGov();
    },
  });

  const createRouteMut = useMutation({
    mutationFn: () =>
      llmObservabilityApi.createRoute(effectiveClusterId, {
        name: newRouteName.trim(),
        namespace: targetNamespace,
        gateway_name: `${newRouteName.trim()}-gw`,
        vip_address: newRouteVip.trim(),
        port: Number(newRoutePort) || 8080,
        path_prefix: "/v1",
        tenant_ref: govOverview?.tenants[0]?.name ?? "",
        auth_mode: newRouteAuth,
        failover_enabled: newRouteFailover,
        semantic_cache_enabled: newRouteSemanticCache,
        semantic_cache_similarity_threshold: 0.88,
        semantic_cache_pool_max_size: Number(newRoutePoolMaxSize) || 64,
        semantic_cache_pool_idle_timeout:
          newRoutePoolIdleTimeout.trim() || "300s",
        model_routing_enabled: newRouteModelRouting,
      }),
    onSuccess: () => {
      setNewRouteName("");
      invalidateGov();
    },
  });

  const updateRoutePolicyMut = useMutation({
    mutationFn: (params: {
      clusterId: number;
      routeName: string;
      payload: Parameters<typeof llmObservabilityApi.updateRoutePolicies>[2];
    }) =>
      llmObservabilityApi.updateRoutePolicies(
        params.clusterId,
        params.routeName,
        params.payload,
      ),
    onSuccess: () => invalidateGov(),
  });

  const testRequestMut = useMutation({
    mutationFn: () =>
      llmObservabilityApi.testGatewayRequest(effectiveClusterId, {
        route_name: testRouteName || govOverview?.routes[0]?.name || null,
        model_id: testModelId.trim() || govOverview?.models[0]?.model_id || "",
        prompt: testPrompt.trim() || "Health check",
        path: testPath.trim() || "/v1/chat/completions",
        virtual_key: testVirtualKey.trim() || null,
        simulate_primary_failure: testSimulateFailure,
      }),
    onSuccess: () => invalidateGov(),
  });

  const createOrgMut = useMutation({
    mutationFn: () =>
      llmObservabilityApi.createOrg(effectiveClusterId, {
        name: newOrgName.trim(),
        tenant_ref: govOverview?.tenants[0]?.name ?? "",
        monthly_budget_usd: Number(newOrgBudget) || 0,
      }),
    onSuccess: () => {
      setNewOrgName("");
      invalidateGov();
    },
  });

  const createTeamMut = useMutation({
    mutationFn: () =>
      llmObservabilityApi.createTeam(effectiveClusterId, {
        name: newTeamName.trim(),
        org_id: newTeamOrgId || govOverview?.organizations[0]?.id || "",
        monthly_budget_usd: Number(newTeamBudget) || 0,
        allowed_models: govOverview?.models.map((m) => m.model_id) ?? [],
      }),
    onSuccess: () => {
      setNewTeamName("");
      invalidateGov();
    },
  });

  const createPrincipalMut = useMutation({
    mutationFn: () =>
      llmObservabilityApi.createPrincipal(effectiveClusterId, {
        name: newPrincipalName.trim(),
        team_id: newPrincipalTeamId || govOverview?.teams[0]?.id || "",
        principal_type: newPrincipalType,
      }),
    onSuccess: () => {
      setNewPrincipalName("");
      invalidateGov();
    },
  });

  const issueKeyMut = useMutation({
    mutationFn: () =>
      llmObservabilityApi.issueVirtualKey(effectiveClusterId, {
        name: newKeyName.trim(),
        principal_id: newKeyPrincipalId || govOverview?.principals[0]?.id || "",
        allowed_models: govOverview?.models.map((m) => m.model_id) ?? [],
        rpm_limit: Number(newKeyRpm) || 0,
        tpm_limit: Number(newKeyTpm) || 0,
        monthly_budget_usd: Number(newKeyBudget) || 0,
      }),
    onSuccess: (created) => {
      setNewKeyName("");
      setIssuedCleartextKey(created.cleartext_key ?? null);
      if (created.cleartext_key) {
        setTestVirtualKey(created.cleartext_key);
      }
      invalidateGov();
    },
  });

  const rotateKeyMut = useMutation({
    mutationFn: (keyId: string) =>
      llmObservabilityApi.rotateVirtualKey(effectiveClusterId, keyId),
    onSuccess: (rotated) => {
      setIssuedCleartextKey(rotated.cleartext_key ?? null);
      if (rotated.cleartext_key) {
        setTestVirtualKey(rotated.cleartext_key);
      }
      invalidateGov();
    },
  });

  const revokeKeyMut = useMutation({
    mutationFn: (keyId: string) =>
      llmObservabilityApi.revokeVirtualKey(effectiveClusterId, keyId),
    onSuccess: () => invalidateGov(),
  });

  const remediateMut = useMutation({
    mutationFn: (action: string) =>
      llmObservabilityApi.remediate(effectiveClusterId, {
        action,
        namespace: targetNamespace,
      }),
    onSuccess: (res) => {
      setRemediationBanner(res.message);
      invalidateGov();
    },
  });

  // Synthesize unified Loki + AI Gateway telemetry
  const filteredAuditLogs = useMemo(
    () =>
      filterAuditLogs(govOverview?.request_audit_logs ?? [], f.model, f.status),
    [govOverview?.request_audit_logs, f.model, f.status],
  );

  const govStats = useMemo(() => {
    const count = filteredAuditLogs.length;
    if (count === 0) return null;
    const totalTokens = filteredAuditLogs.reduce(
      (s, l) => s + l.prompt_tokens + l.completion_tokens,
      0,
    );
    const totalCost = filteredAuditLogs.reduce((s, l) => s + l.cost_usd, 0);
    const okCount = filteredAuditLogs.filter(
      (l) => l.status_code >= 200 && l.status_code < 400,
    ).length;
    const avgLatency =
      filteredAuditLogs.reduce((s, l) => s + l.latency_ms, 0) / count;
    const modelSet = new Set([
      ...filteredAuditLogs.map((l) => l.model_id),
      ...(govOverview?.models ?? []).map((m) => m.model_id),
    ]);
    return {
      total_requests: count,
      total_tokens: totalTokens,
      total_cost: totalCost,
      success_rate: okCount / count,
      avg_latency_ms: avgLatency,
      models: modelSet.size,
    };
  }, [filteredAuditLogs, govOverview?.models]);

  const lokiLive = llmStats?.available ? llmStats : undefined;
  const unifiedLive = useMemo(() => {
    if (
      lokiLive &&
      lokiLive.total_requests > 0 &&
      govStats &&
      govStats.total_requests > 0
    ) {
      const totalReqs = lokiLive.total_requests + govStats.total_requests;
      const totalToks = lokiLive.total_tokens + govStats.total_tokens;
      const totalCost = lokiLive.total_cost + govStats.total_cost;
      const weightedSuccess =
        (lokiLive.success_rate * lokiLive.total_requests +
          govStats.success_rate * govStats.total_requests) /
        totalReqs;
      const weightedLatency =
        (lokiLive.avg_latency_ms * lokiLive.total_requests +
          govStats.avg_latency_ms * govStats.total_requests) /
        totalReqs;
      return {
        ...lokiLive,
        total_requests: totalReqs,
        total_tokens: totalToks,
        total_cost: totalCost,
        success_rate: weightedSuccess,
        avg_latency_ms: weightedLatency,
        models: Math.max(lokiLive.models, govStats.models),
      };
    }
    if (lokiLive && lokiLive.total_requests > 0) {
      return lokiLive;
    }
    if (govStats) {
      return govStats;
    }
    return lokiLive;
  }, [lokiLive, govStats]);

  const totalTokens = unifiedLive
    ? `${(unifiedLive.total_tokens / 1000).toFixed(0)}k`
    : "—";
  const totalRequests = unifiedLive
    ? unifiedLive.total_requests.toLocaleString()
    : "—";
  const successPct = unifiedLive
    ? `${(unifiedLive.success_rate * 100).toFixed(1)}%`
    : "—";
  const avgLatency = unifiedLive
    ? `${Math.round(unifiedLive.avg_latency_ms)}ms`
    : "—";
  const modelsCount = unifiedLive
    ? unifiedLive.models
    : (govOverview?.models?.length ?? 0) > 0
      ? govOverview!.models.length
      : "—";

  const benchP50 =
    benchmarkSummary?.avg_latency_p50 != null
      ? `${benchmarkSummary.avg_latency_p50.toFixed(1)}ms`
      : "—";
  const benchRps =
    benchmarkSummary?.avg_rps != null
      ? benchmarkSummary.avg_rps.toFixed(1)
      : "—";
  const benchRuns = benchmarkSummary?.total_runs ?? "—";
  const scopeName =
    f.clusterId == null
      ? "All Clusters"
      : (clusters.find((c) => c.id === f.clusterId)?.name ??
        `Cluster ${f.clusterId}`);

  const modelFilterOptions = useMemo(() => {
    const s = new Set<string>(filterData?.models ?? []);
    for (const m of govOverview?.models ?? []) {
      if (m.model_id) s.add(m.model_id);
    }
    for (const l of govOverview?.request_audit_logs ?? []) {
      if (l.model_id) s.add(l.model_id);
    }
    return Array.from(s);
  }, [
    filterData?.models,
    govOverview?.models,
    govOverview?.request_audit_logs,
  ]);

  const mergedTopologyNodes = useMemo(() => {
    const map = new Map<
      string,
      NonNullable<typeof fabricTopology>["nodes"][number]
    >();
    for (const n of (govOverview?.topology_nodes ??
      []) as unknown as NonNullable<typeof fabricTopology>["nodes"]) {
      map.set(n.id, n);
    }
    if (f.clusterId !== null && hasGovTopology) {
      for (const n of fabricTopology?.nodes ?? []) {
        map.set(n.id, n);
      }
    }
    return Array.from(map.values());
  }, [
    govOverview?.topology_nodes,
    f.clusterId,
    hasGovTopology,
    fabricTopology?.nodes,
  ]);

  const mergedTopologyEdges = useMemo(() => {
    const map = new Map<
      string,
      NonNullable<typeof fabricTopology>["edges"][number]
    >();
    for (const e of (govOverview?.topology_edges ??
      []) as unknown as NonNullable<typeof fabricTopology>["edges"]) {
      map.set(e.id, e);
    }
    if (f.clusterId !== null && hasGovTopology) {
      for (const e of fabricTopology?.edges ?? []) {
        map.set(e.id, e);
      }
    }
    return Array.from(map.values());
  }, [
    govOverview?.topology_edges,
    f.clusterId,
    hasGovTopology,
    fabricTopology?.edges,
  ]);

  const activeTab = f.tab === "chargeback" ? "rankings" : f.tab;
  const activeViewMeta = VIEW_META[activeTab] ?? VIEW_META.overview;

  return (
    <Tabs
      value={activeTab}
      onValueChange={f.setTab}
      orientation="vertical"
      className="flex min-h-[calc(100vh-3rem)]"
    >
      {/* Left Flush Inner Sub-Sidebar */}
      <CollapsibleInnerSidebar className="w-56 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
        <div className="px-2 pt-1 pb-2 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground">
            Token Governance and Intelligence
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Token quotas, model rankings, AI Gateway CRDs &amp; DSSM governance
          </p>
        </div>

        <TabsList
          aria-label="AI Gateway views"
          className="flex flex-col items-stretch h-auto bg-transparent p-0 gap-1"
        >
          <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            TELEMETRY &amp; ANALYTICS
          </div>
          <TabsTrigger
            value="overview"
            className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <BarChart3 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Overview</span>
          </TabsTrigger>
          <TabsTrigger
            value="rankings"
            className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <Trophy className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Model Rankings</span>
          </TabsTrigger>
          <TabsTrigger
            value="providers"
            className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <Layers className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Provider Usage</span>
          </TabsTrigger>

          <div className="px-2.5 pt-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            AI GATEWAY &amp; GOVERNANCE
          </div>
          <TabsTrigger
            value="tenants"
            className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <Sliders className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Tenants &amp; Profiles</span>
          </TabsTrigger>
          <TabsTrigger
            value="catalog"
            className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <Cpu className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Models &amp; Providers</span>
          </TabsTrigger>
          <TabsTrigger
            value="governance"
            className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <KeyRound className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Access &amp; Virtual Keys</span>
          </TabsTrigger>
          <TabsTrigger
            value="audit"
            className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Request Audit Logs</span>
          </TabsTrigger>
          <TabsTrigger
            value="topology"
            className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <Network className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Gateway Topology</span>
          </TabsTrigger>
          <TabsTrigger
            value="diagnostics"
            className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <Wrench className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Gateway Diagnostics</span>
          </TabsTrigger>
        </TabsList>
      </CollapsibleInnerSidebar>

      {/* Right Content Pane */}
      <div className="flex-1 min-w-0 p-6 space-y-5 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {activeViewMeta.title}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {activeViewMeta.subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <ClusterPicker
              value={f.clusterId}
              onChange={f.setClusterId}
              showProjectSelector
            />
            <Select value={namespace} onValueChange={setNamespace}>
              <SelectTrigger
                className="h-8 w-44 text-xs"
                aria-label="Namespace"
              >
                <SelectValue placeholder="All Namespaces" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All Namespaces
                </SelectItem>
                {discoveredNamespaces.map((ns) => (
                  <SelectItem key={ns} value={ns} className="text-xs font-mono">
                    {ns}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                refresh();
                void refetchGov();
              }}
              disabled={isRefreshing || govLoading}
              aria-label="Refresh"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing || govLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {/* Gateway Telemetry & Governance Summary */}
        <SectionCard compact className="border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-border/60">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-primary/10 text-primary">
                <Zap className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Gateway Summary
              </span>
              <span className="text-xs text-muted-foreground">
                · {scopeName}
              </span>
              {!unifiedLive && llmStats && !llmStats.available && (
                <Badge variant="outline" className="text-2xs">
                  No telemetry{llmStats.reason ? ` · ${llmStats.reason}` : ""}
                </Badge>
              )}
              {(govOverview?.virtual_keys?.length ?? 0) > 0 && (
                <Badge
                  variant="outline"
                  className="text-2xs bg-primary/10 text-primary border-primary/30"
                >
                  {
                    govOverview!.virtual_keys.filter(
                      (k) => k.status === "active",
                    ).length
                  }{" "}
                  Active Virtual Keys
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                value={f.model}
                onChange={f.setModel}
                options={modelFilterOptions}
                allLabel="All models"
                placeholder="Model"
                ariaLabel="Model filter"
              />
              <TimeRangePicker value={f.range} onChange={f.setRange} />
              <FilterSelect
                value={f.status}
                onChange={f.setStatus}
                options={filterData?.statuses ?? []}
                allLabel="All statuses"
                placeholder="Status"
                width="w-[130px]"
                ariaLabel="Status filter"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-2.5 rounded-lg border border-border bg-card/50">
              <span className="label-caps block">Request Success</span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-lg font-bold tabular-nums text-success">
                  {successPct}
                </span>
              </div>
              <p className="text-2xs text-muted-foreground mt-0.5">
                {totalTokens} tokens · {modelsCount} models
              </p>
            </div>

            <div className="p-2.5 rounded-lg border border-border bg-card/50">
              <span className="label-caps block">Latency</span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-lg font-bold tabular-nums text-foreground">
                  {avgLatency}
                </span>
                <span className="text-2xs text-muted-foreground">
                  avg end-to-end
                </span>
              </div>
              <p className="text-2xs text-muted-foreground mt-0.5">
                Benchmark p50 {benchP50} · {benchRps} req/s · {benchRuns} runs
              </p>
            </div>

            <div className="p-2.5 rounded-lg border border-border bg-card/50">
              <span className="label-caps block">Requests &amp; Spend</span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-lg font-bold tabular-nums text-foreground">
                  {totalRequests}
                </span>
                <span className="text-2xs text-muted-foreground">requests</span>
              </div>
              <p className="text-2xs text-muted-foreground mt-0.5">
                Spend: {unifiedLive ? fmtCost(unifiedLive.total_cost) : "—"}
              </p>
            </div>
          </div>
        </SectionCard>

        <TabsContent value="overview" className="mt-0">
          <OverviewTab
            clusterId={f.clusterId}
            params={f.queryParams}
            active={f.tab === "overview"}
            auditLogs={filteredAuditLogs}
          />
        </TabsContent>

        <TabsContent value="rankings" className="mt-0">
          <RankingsTab
            clusterId={f.clusterId}
            params={f.queryParams}
            active={activeTab === "rankings"}
            govOverview={govOverview}
            modelFilter={f.model}
            statusFilter={f.status}
          />
        </TabsContent>

        <TabsContent value="providers" className="mt-0">
          <ProviderUsageTab
            clusterId={f.clusterId}
            params={f.queryParams}
            active={activeTab === "providers"}
            auditLogs={filteredAuditLogs}
            govOverview={govOverview}
          />
        </TabsContent>

        {/* AI Gateway Tenants, Profiles & Route Policies */}
        <TabsContent value="tenants" className="mt-0">
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <SectionCard
                title="Register AITenant"
                description="Cluster-scoped inference.k8s.f5.com/v1alpha1 tenant"
                compact
              >
                <div className="space-y-2.5 pt-1">
                  <Input
                    value={newTenantName}
                    onChange={(e) => setNewTenantName(e.target.value)}
                    placeholder="e.g. enterprise-ai-tenant"
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs gap-1.5"
                    disabled={
                      !newTenantName.trim() || createTenantMut.isPending
                    }
                    onClick={() => createTenantMut.mutate()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create AITenant
                  </Button>
                </div>
              </SectionCard>

              <div className="lg:col-span-2">
                <SectionCard
                  title="Provision Gateway Route, AIGatewayProfile & AppPolicy"
                  description="Creates Gateway + HTTPRoute + AIGatewayProfile + AppPolicy with Semantic Cache connection pooling"
                  compact
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-1">
                    <Input
                      value={newRouteName}
                      onChange={(e) => setNewRouteName(e.target.value)}
                      placeholder="Route name (e.g. prod-llm)"
                      className="h-8 text-xs"
                    />
                    <Input
                      value={newRouteVip}
                      onChange={(e) => setNewRouteVip(e.target.value)}
                      placeholder="VIP (10.10.20.90)"
                      className="h-8 text-xs font-mono"
                    />
                    <Input
                      value={newRoutePort}
                      onChange={(e) => setNewRoutePort(e.target.value)}
                      placeholder="Port (8080)"
                      className="h-8 text-xs font-mono"
                    />
                    <select
                      aria-label="Authentication Mode"
                      value={newRouteAuth}
                      onChange={(e) => setNewRouteAuth(e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="virtual-key">Auth: VirtualKey</option>
                      <option value="jwt">Auth: JWT</option>
                      <option value="none">Auth: None</option>
                    </select>
                    <Input
                      value={newRoutePoolMaxSize}
                      onChange={(e) => setNewRoutePoolMaxSize(e.target.value)}
                      placeholder="Cache Pool Max (64)"
                      title="semantic_cache_pool_max_size"
                      className="h-8 text-xs font-mono"
                    />
                    <Input
                      value={newRoutePoolIdleTimeout}
                      onChange={(e) =>
                        setNewRoutePoolIdleTimeout(e.target.value)
                      }
                      placeholder="Pool Idle (300s)"
                      title="semantic_cache_pool_idle_timeout"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newRouteSemanticCache}
                          onChange={(e) =>
                            setNewRouteSemanticCache(e.target.checked)
                          }
                        />
                        <span>Semantic Prompt Cache (Pooled)</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newRouteFailover}
                          onChange={(e) =>
                            setNewRouteFailover(e.target.checked)
                          }
                        />
                        <span>Automatic Provider Failover</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newRouteModelRouting}
                          onChange={(e) =>
                            setNewRouteModelRouting(e.target.checked)
                          }
                        />
                        <span>Semantic Model Routing</span>
                      </label>
                    </div>
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      disabled={
                        !newRouteName.trim() || createRouteMut.isPending
                      }
                      onClick={() => createRouteMut.mutate()}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Deploy Route &amp; Policies
                    </Button>
                  </div>
                </SectionCard>
              </div>
            </div>

            <SectionCard
              title="Active Gateway Routes & AIGatewayProfiles"
              description="Includes Semantic Cache connection pool parameters, AppPolicy bindings, and live policy toggles"
              compact
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Route / VIP</TableHead>
                    <TableHead className="text-xs">AIGatewayProfile</TableHead>
                    <TableHead className="text-xs">AppPolicy</TableHead>
                    <TableHead className="text-xs">Auth Mode</TableHead>
                    <TableHead className="text-xs">
                      Semantic Cache Pool
                    </TableHead>
                    <TableHead className="text-xs">
                      Live Policy Toggles
                    </TableHead>
                    <TableHead className="text-xs">Programmed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(govOverview?.routes ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-xs text-muted-foreground py-6"
                      >
                        No AI Gateway routes or AIGatewayProfiles deployed on
                        this scope.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (govOverview?.routes ?? []).map((r) => (
                      <TableRow key={`${r.cluster_id}-${r.name}`}>
                        <TableCell className="text-xs">
                          <div className="font-mono font-semibold">
                            {r.name}
                          </div>
                          <div className="text-2xs font-mono text-muted-foreground">
                            {r.vip_address ?? "0.0.0.0"}:{r.port}
                            {r.path_prefix}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {r.ai_gateway_profile}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {r.app_policy ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-2xs">
                            {r.auth_mode}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {r.semantic_cache_enabled ? (
                            <span>
                              max={r.semantic_cache_pool_max_size}, idle=
                              {r.semantic_cache_pool_idle_timeout} (sim≥
                              {r.semantic_cache_similarity_threshold})
                            </span>
                          ) : (
                            "Disabled"
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              variant={
                                r.failover_enabled ? "default" : "outline"
                              }
                              className="h-6 px-2 text-2xs"
                              disabled={updateRoutePolicyMut.isPending}
                              onClick={() =>
                                updateRoutePolicyMut.mutate({
                                  clusterId: r.cluster_id || effectiveClusterId,
                                  routeName: r.name,
                                  payload: {
                                    failover_enabled: !r.failover_enabled,
                                  },
                                })
                              }
                            >
                              Failover: {r.failover_enabled ? "ON" : "OFF"}
                            </Button>
                            <Button
                              size="sm"
                              variant={
                                r.semantic_cache_enabled ? "default" : "outline"
                              }
                              className="h-6 px-2 text-2xs"
                              disabled={updateRoutePolicyMut.isPending}
                              onClick={() =>
                                updateRoutePolicyMut.mutate({
                                  clusterId: r.cluster_id || effectiveClusterId,
                                  routeName: r.name,
                                  payload: {
                                    semantic_cache_enabled:
                                      !r.semantic_cache_enabled,
                                  },
                                })
                              }
                            >
                              SemanticCache:{" "}
                              {r.semantic_cache_enabled ? "ON" : "OFF"}
                            </Button>
                            <Button
                              size="sm"
                              variant={
                                r.model_routing_enabled ? "default" : "outline"
                              }
                              className="h-6 px-2 text-2xs"
                              disabled={updateRoutePolicyMut.isPending}
                              onClick={() =>
                                updateRoutePolicyMut.mutate({
                                  clusterId: r.cluster_id || effectiveClusterId,
                                  routeName: r.name,
                                  payload: {
                                    model_routing_enabled:
                                      !r.model_routing_enabled,
                                  },
                                })
                              }
                            >
                              ModelRouting:{" "}
                              {r.model_routing_enabled ? "ON" : "OFF"}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge
                            variant={r.programmed ? "default" : "destructive"}
                            className="text-2xs"
                          >
                            {r.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </SectionCard>

            <SectionCard
              title="Tenant, Organization & Team Budget Consumption"
              description="Live monthly budget utilization rolled up from ClickHouse otel.aigw_requests across AITenants, Organizations, Teams & Principals"
              compact
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">
                      AITenant / Organization
                    </TableHead>
                    <TableHead className="text-xs">
                      Teams &amp; Principals
                    </TableHead>
                    <TableHead className="text-xs w-[240px]">
                      Monthly Budget Utilization
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      RPM / TPM Quota
                    </TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(govOverview?.organizations ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-xs text-muted-foreground py-6"
                      >
                        No tenant organizations configured on this scope.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (govOverview?.organizations ?? []).map((o) => {
                      const orgPct =
                        o.monthly_budget_usd > 0
                          ? Math.round(
                              (o.current_spend_usd / o.monthly_budget_usd) *
                                100,
                            )
                          : 0;
                      const orgTeams = (govOverview?.teams ?? []).filter(
                        (t) => t.org_id === o.id || t.org_name === o.name,
                      );
                      const orgPrincipals = (
                        govOverview?.principals ?? []
                      ).filter(
                        (p) => p.org_id === o.id || p.org_name === o.name,
                      );
                      return (
                        <TableRow key={`tenant-org-${o.id}`}>
                          <TableCell className="text-xs">
                            <div className="font-semibold">{o.name}</div>
                            <div className="text-2xs font-mono text-muted-foreground">
                              AITenant: {o.tenant_ref}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-wrap gap-1">
                              {orgTeams.map((t) => (
                                <Badge
                                  key={t.id}
                                  variant="secondary"
                                  className="text-2xs font-mono"
                                >
                                  {t.name}: ${t.current_spend_usd.toFixed(0)}/$
                                  {t.monthly_budget_usd.toFixed(0)}
                                </Badge>
                              ))}
                              {orgPrincipals.length > 0 && (
                                <Badge variant="outline" className="text-2xs">
                                  {orgPrincipals.length} principal(s)
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="space-y-1">
                              <div className="flex justify-between text-2xs font-mono">
                                <span>
                                  ${o.current_spend_usd.toFixed(2)} / $
                                  {o.monthly_budget_usd.toFixed(0)}
                                </span>
                                <span className="text-muted-foreground">
                                  {orgPct}%
                                </span>
                              </div>
                              <Progress
                                value={Math.min(orgPct, 100)}
                                className="h-1.5"
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-xs font-mono text-right">
                            {o.rpm_limit.toLocaleString()} /{" "}
                            {o.tpm_limit.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="default" className="text-2xs">
                              Active
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </SectionCard>

            <SectionCard
              title="Live Gateway Request & Policy Tester"
              description="Verify /v1 path routing, VirtualKey ACL & budget enforcement, Semantic Prompt Cache HIT/MISS, and automatic provider failover with ClickHouse otel.aigw_requests audit attribution"
              compact
            >
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <select
                    aria-label="Test Route"
                    value={testRouteName}
                    onChange={(e) => setTestRouteName(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
                  >
                    {(govOverview?.routes ?? []).map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.name} ({r.vip_address ?? "0.0.0.0"}:{r.port}
                        {r.path_prefix})
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Test Model"
                    value={testModelId}
                    onChange={(e) => setTestModelId(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
                  >
                    {(govOverview?.models ?? []).map((m) => (
                      <option key={m.model_id} value={m.model_id}>
                        {m.model_id} ({m.name})
                      </option>
                    ))}
                  </select>
                  <Input
                    value={testPath}
                    onChange={(e) => setTestPath(e.target.value)}
                    placeholder="/v1/chat/completions"
                    className="h-8 text-xs font-mono"
                  />
                  <Input
                    value={testVirtualKey}
                    onChange={(e) => setTestVirtualKey(e.target.value)}
                    placeholder="Optional f5vk_... key (uses active key if blank)"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    placeholder="Prompt to send through AI Gateway..."
                    className="h-8 text-xs flex-1 min-w-[260px]"
                  />
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={testSimulateFailure}
                      onChange={(e) => setTestSimulateFailure(e.target.checked)}
                    />
                    <span>Simulate Primary Provider Failure</span>
                  </label>
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    disabled={
                      (govOverview?.routes?.length ?? 0) === 0 ||
                      testRequestMut.isPending
                    }
                    onClick={() => testRequestMut.mutate()}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Send Test Inference
                  </Button>
                </div>
                {testRequestMut.data && (
                  <div className="p-3 rounded-lg border border-border bg-muted/40 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          testRequestMut.data.status_code === 200
                            ? "default"
                            : "destructive"
                        }
                        className="text-2xs font-mono"
                      >
                        HTTP {testRequestMut.data.status_code}
                      </Badge>
                      <Badge variant="outline" className="text-2xs font-mono">
                        Provider: {testRequestMut.data.selected_provider}
                      </Badge>
                      <Badge
                        variant={
                          testRequestMut.data.semantic_cache_status === "HIT"
                            ? "default"
                            : "secondary"
                        }
                        className="text-2xs font-mono"
                      >
                        Cache: {testRequestMut.data.semantic_cache_status}
                      </Badge>
                      {testRequestMut.data.failover_triggered && (
                        <Badge variant="secondary" className="text-2xs">
                          Failover Triggered
                        </Badge>
                      )}
                      <span className="font-mono text-muted-foreground">
                        {testRequestMut.data.latency_ms}ms ·{" "}
                        {testRequestMut.data.prompt_tokens}+
                        {testRequestMut.data.completion_tokens} tok · $
                        {testRequestMut.data.estimated_cost_usd.toFixed(6)}
                      </span>
                      <span className="font-mono text-2xs text-muted-foreground ml-auto">
                        ClickHouse ID:{" "}
                        {testRequestMut.data.clickhouse_logged_id}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-foreground">
                      {testRequestMut.data.response_text}
                    </p>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        {/* Models & Providers Catalog */}
        <TabsContent value="catalog" className="mt-0">
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SectionCard
                title="Add AIProvider & AICredential"
                description="Generic type requires /v1 base path"
                compact
              >
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={newProviderName}
                      onChange={(e) => setNewProviderName(e.target.value)}
                      placeholder="Name (e.g. vllm-gpu)"
                      className="h-8 text-xs"
                    />
                    <select
                      aria-label="Provider Type"
                      value={newProviderType}
                      onChange={(e) => setNewProviderType(e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="Generic">Generic (/v1)</option>
                      <option value="OpenAI">OpenAI</option>
                      <option value="Anthropic">Anthropic</option>
                      <option value="Bedrock">Bedrock</option>
                      <option value="Gemini">Gemini</option>
                      <option value="Cohere">Cohere</option>
                    </select>
                  </div>
                  <Input
                    value={newProviderEndpoint}
                    onChange={(e) => setNewProviderEndpoint(e.target.value)}
                    placeholder="https://endpoint/v1"
                    className="h-8 text-xs font-mono"
                  />
                  <Input
                    type="password"
                    value={newProviderApiKey}
                    onChange={(e) => setNewProviderApiKey(e.target.value)}
                    placeholder="Bearer API Key (stored in Secret + AICredential)"
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs gap-1.5"
                    disabled={
                      !newProviderName.trim() || createProviderMut.isPending
                    }
                    onClick={() => createProviderMut.mutate()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create AIProvider + Secret
                  </Button>
                </div>
              </SectionCard>

              <SectionCard
                title="Publish AIModel"
                description="Weighted provider deployments & micro-USD/Mtok pricing"
                compact
              >
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      placeholder="CR name (e.g. gpt-4o)"
                      className="h-8 text-xs"
                    />
                    <Input
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                      placeholder="Model ID (gpt-4o)"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={newModelProviderRef}
                      onChange={(e) => setNewModelProviderRef(e.target.value)}
                      placeholder="Provider ref"
                      className="h-8 text-xs"
                    />
                    <Input
                      value={newModelWeight}
                      onChange={(e) => setNewModelWeight(e.target.value)}
                      placeholder="Weight (100)"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={newModelInputCost}
                      onChange={(e) => setNewModelInputCost(e.target.value)}
                      placeholder="In µUSD/Mtok"
                      className="h-8 text-xs font-mono"
                    />
                    <Input
                      value={newModelOutputCost}
                      onChange={(e) => setNewModelOutputCost(e.target.value)}
                      placeholder="Out µUSD/Mtok"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs gap-1.5"
                    disabled={!newModelName.trim() || createModelMut.isPending}
                    onClick={() => createModelMut.mutate()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create AIModel
                  </Button>
                </div>
              </SectionCard>
            </div>

            <SectionCard
              title="AIModel Catalog & Weighted Deployments"
              description="Models governed across AITenant and AIProvider resources"
              compact
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Model CR</TableHead>
                    <TableHead className="text-xs">Model ID</TableHead>
                    <TableHead className="text-xs">AITenant</TableHead>
                    <TableHead className="text-xs">
                      Weighted Providers
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      Input / Output ($/Mtok)
                    </TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(govOverview?.models ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-xs text-muted-foreground py-6"
                      >
                        No AIModel custom resources deployed on this scope.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (govOverview?.models ?? []).map((m) => (
                      <TableRow key={`${m.cluster_id}-${m.name}`}>
                        <TableCell className="text-xs font-mono font-semibold">
                          {m.name}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {m.model_id}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-2xs">
                            {m.tenant_ref}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {m.deployments.map((d) => (
                              <Badge
                                key={d.provider_ref}
                                variant="secondary"
                                className="text-2xs font-mono"
                              >
                                {d.provider_ref} ({d.weight}%)
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right">
                          $
                          {(m.input_token_cost_micro_usd / 1_000_000).toFixed(
                            2,
                          )}{" "}
                          / $
                          {(m.output_token_cost_micro_usd / 1_000_000).toFixed(
                            2,
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="default" className="text-2xs">
                            {m.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </SectionCard>

            <SectionCard
              title="AIProviders & AICredentials"
              description="Upstream and in-cluster inference endpoints"
              compact
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Provider</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Endpoint URL</TableHead>
                    <TableHead className="text-xs">AICredential</TableHead>
                    <TableHead className="text-xs">Secret</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(govOverview?.providers ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-xs text-muted-foreground py-6"
                      >
                        No AIProvider or AICredential resources deployed on this
                        scope.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (govOverview?.providers ?? []).map((p) => (
                      <TableRow key={`${p.cluster_id}-${p.name}`}>
                        <TableCell className="text-xs font-mono font-semibold">
                          {p.name}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-2xs">
                            {p.provider_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {p.endpoint_url ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {p.credential_ref ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {p.secret_ref ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="default" className="text-2xs">
                            {p.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </SectionCard>
          </div>
        </TabsContent>

        {/* Access Control & DSSM Virtual Keys */}
        <TabsContent value="governance" className="mt-0">
          <div className="space-y-6">
            {issuedCleartextKey && (
              <div className="p-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-emerald-400">
                    Virtual Key Issued — Copy Secret Key Now (Shown Only Once)
                  </div>
                  <code className="text-xs font-mono text-foreground bg-background/80 px-2 py-1 rounded border">
                    {issuedCleartextKey}
                  </code>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => {
                      void navigator.clipboard?.writeText(issuedCleartextKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                  >
                    {copiedKey ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedKey ? "Copied" : "Copy Key"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setIssuedCleartextKey(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <SectionCard
                title="1. Create Organization"
                description="Bind multi-tenant monthly budget & rate limits to an AITenant"
                compact
              >
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      placeholder="Org name (e.g. Core Telco)"
                      className="h-8 text-xs"
                    />
                    <Input
                      value={newOrgBudget}
                      onChange={(e) => setNewOrgBudget(e.target.value)}
                      placeholder="Budget USD (2500)"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs gap-1.5"
                    disabled={!newOrgName.trim() || createOrgMut.isPending}
                    onClick={() => createOrgMut.mutate()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create Organization
                  </Button>
                </div>
              </SectionCard>

              <SectionCard
                title="2. Create Team"
                description="Allocate team sub-budgets and model ACLs within an Organization"
                compact
              >
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      placeholder="Team name (e.g. RAN Ops)"
                      className="h-8 text-xs"
                    />
                    <select
                      aria-label="Team Organization"
                      value={newTeamOrgId}
                      onChange={(e) => setNewTeamOrgId(e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {(govOverview?.organizations ?? []).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={newTeamBudget}
                      onChange={(e) => setNewTeamBudget(e.target.value)}
                      placeholder="Team Budget USD (1000)"
                      className="h-8 text-xs font-mono"
                    />
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5 shrink-0"
                      disabled={!newTeamName.trim() || createTeamMut.isPending}
                      onClick={() => createTeamMut.mutate()}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create Team
                    </Button>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="3. Create Principal"
                description="Register User, Service, or Autonomous AI Agent under a Team"
                compact
              >
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={newPrincipalName}
                      onChange={(e) => setNewPrincipalName(e.target.value)}
                      placeholder="Principal (e.g. ran-agent)"
                      className="h-8 text-xs"
                    />
                    <select
                      aria-label="Principal Type"
                      value={newPrincipalType}
                      onChange={(e) =>
                        setNewPrincipalType(
                          e.target.value as "user" | "service" | "agent",
                        )
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="agent">Autonomous Agent</option>
                      <option value="service">Microservice</option>
                      <option value="user">Human User</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Principal Team"
                      value={newPrincipalTeamId}
                      onChange={(e) => setNewPrincipalTeamId(e.target.value)}
                      className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {(govOverview?.teams ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.org_name})
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5 shrink-0"
                      disabled={
                        !newPrincipalName.trim() || createPrincipalMut.isPending
                      }
                      onClick={() => createPrincipalMut.mutate()}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create Principal
                    </Button>
                  </div>
                </div>
              </SectionCard>
            </div>

            <SectionCard
              title="Issue DSSM Virtual Key (f5vk_...)"
              description="Bind rate limits (RPM/TPM), monthly spend budgets, and model ACLs to a User, Service, or AI Agent principal"
              compact
            >
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-1">
                <Input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Key label (e.g. prod-agent-vk)"
                  className="h-8 text-xs"
                />
                <select
                  aria-label="Principal"
                  value={newKeyPrincipalId}
                  onChange={(e) => setNewKeyPrincipalId(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {(govOverview?.principals ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.principal_type} · {p.team_name})
                    </option>
                  ))}
                </select>
                <Input
                  value={newKeyRpm}
                  onChange={(e) => setNewKeyRpm(e.target.value)}
                  placeholder="RPM Limit (600)"
                  className="h-8 text-xs font-mono"
                />
                <Input
                  value={newKeyTpm}
                  onChange={(e) => setNewKeyTpm(e.target.value)}
                  placeholder="TPM Limit (150000)"
                  className="h-8 text-xs font-mono"
                />
                <div className="flex items-center gap-2">
                  <Input
                    value={newKeyBudget}
                    onChange={(e) => setNewKeyBudget(e.target.value)}
                    placeholder="Budget USD (500)"
                    className="h-8 text-xs font-mono"
                  />
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1 shrink-0"
                    disabled={!newKeyName.trim() || issueKeyMut.isPending}
                    onClick={() => issueKeyMut.mutate()}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Issue Key
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Active DSSM Virtual Keys"
              description="Synchronized into DSSM shared state across clusters for TMM/Envoy enforcement"
              compact
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Key Name</TableHead>
                    <TableHead className="text-xs">Masked Token</TableHead>
                    <TableHead className="text-xs">
                      Principal &amp; Team
                    </TableHead>
                    <TableHead className="text-xs">Allowed Models</TableHead>
                    <TableHead className="text-xs text-right">
                      RPM / TPM
                    </TableHead>
                    <TableHead className="text-xs w-[190px]">
                      Budget Utilization
                    </TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(govOverview?.virtual_keys ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center text-xs text-muted-foreground py-6"
                      >
                        No DSSM Virtual Keys issued on this scope.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (govOverview?.virtual_keys ?? []).map((vk) => {
                      const vkPct =
                        vk.monthly_budget_usd > 0
                          ? Math.round(
                              (vk.spend_usd / vk.monthly_budget_usd) * 100,
                            )
                          : 0;
                      return (
                        <TableRow key={vk.id}>
                          <TableCell className="text-xs font-semibold">
                            {vk.name}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {vk.masked_key}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div>{vk.principal_name}</div>
                            <div className="text-2xs text-muted-foreground">
                              {vk.principal_type} · {vk.team_name} (
                              {vk.org_name})
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-wrap gap-1">
                              {vk.allowed_models.map((m) => (
                                <Badge
                                  key={m}
                                  variant="secondary"
                                  className="text-2xs font-mono"
                                >
                                  {m}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs font-mono text-right">
                            {vk.rpm_limit.toLocaleString()} /{" "}
                            {vk.tpm_limit.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="space-y-1">
                              <div className="flex justify-between text-2xs font-mono">
                                <span>
                                  ${vk.spend_usd.toFixed(2)} / $
                                  {vk.monthly_budget_usd.toFixed(0)}
                                </span>
                                <span className="text-muted-foreground">
                                  {vkPct}%
                                </span>
                              </div>
                              <Progress
                                value={Math.min(vkPct, 100)}
                                className="h-1"
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge
                              variant={
                                vk.status === "active" ? "default" : "outline"
                              }
                              className="text-2xs"
                            >
                              {vk.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-right">
                            {vk.status === "active" && (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-2xs gap-1"
                                  title="Rotate Virtual Key in-place"
                                  disabled={rotateKeyMut.isPending}
                                  onClick={() => rotateKeyMut.mutate(vk.id)}
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  Rotate
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                  title="Revoke Virtual Key"
                                  onClick={() => revokeKeyMut.mutate(vk.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </SectionCard>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SectionCard
                title="Organizations & Monthly Budgets"
                description="Multi-tenant spend & rate governance"
                compact
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Organization</TableHead>
                      <TableHead className="text-xs">AITenant</TableHead>
                      <TableHead className="text-xs w-[180px]">
                        Budget Utilization
                      </TableHead>
                      <TableHead className="text-xs text-right">
                        RPM / TPM
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(govOverview?.organizations ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center text-xs text-muted-foreground py-6"
                        >
                          No organizations configured on this scope.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (govOverview?.organizations ?? []).map((o) => {
                        const orgPct =
                          o.monthly_budget_usd > 0
                            ? Math.round(
                                (o.current_spend_usd / o.monthly_budget_usd) *
                                  100,
                              )
                            : 0;
                        return (
                          <TableRow key={o.id}>
                            <TableCell className="text-xs font-semibold">
                              <div>{o.name}</div>
                              <div className="text-2xs font-normal text-muted-foreground">
                                {o.teams_count} team(s)
                              </div>
                            </TableCell>
                            <TableCell className="text-xs font-mono">
                              {o.tenant_ref}
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="space-y-1">
                                <div className="flex justify-between text-2xs font-mono">
                                  <span>
                                    ${o.current_spend_usd.toFixed(2)} / $
                                    {o.monthly_budget_usd.toFixed(0)}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {orgPct}%
                                  </span>
                                </div>
                                <Progress
                                  value={Math.min(orgPct, 100)}
                                  className="h-1"
                                />
                              </div>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-right">
                              {o.rpm_limit.toLocaleString()} /{" "}
                              {o.tpm_limit.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </SectionCard>

              <SectionCard
                title="Teams & Principals"
                description="Team sub-budgets, Users, Services, and Autonomous Agents"
                compact
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">
                        Team / Principal
                      </TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">
                        Scope &amp; Budget
                      </TableHead>
                      <TableHead className="text-xs text-right">
                        RPM / TPM
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(govOverview?.teams ?? []).length === 0 &&
                    (govOverview?.principals ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center text-xs text-muted-foreground py-6"
                        >
                          No principals or teams configured on this scope.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {(govOverview?.teams ?? []).map((t) => {
                          const teamPct =
                            t.monthly_budget_usd > 0
                              ? Math.round(
                                  (t.current_spend_usd / t.monthly_budget_usd) *
                                    100,
                                )
                              : 0;
                          return (
                            <TableRow key={`team-${t.id}`}>
                              <TableCell className="text-xs font-semibold">
                                <div>{t.name}</div>
                                <div className="text-2xs font-normal text-muted-foreground">
                                  {t.org_name}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                <Badge variant="outline" className="text-2xs">
                                  team
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">
                                <div className="space-y-1">
                                  <div className="flex justify-between text-2xs font-mono">
                                    <span>
                                      ${t.current_spend_usd.toFixed(2)} / $
                                      {t.monthly_budget_usd.toFixed(0)}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {teamPct}%
                                    </span>
                                  </div>
                                  <Progress
                                    value={Math.min(teamPct, 100)}
                                    className="h-1"
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="text-xs font-mono text-right">
                                {t.rpm_limit.toLocaleString()} /{" "}
                                {t.tpm_limit.toLocaleString()}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {(govOverview?.principals ?? []).map((p) => {
                          const pVks = (govOverview?.virtual_keys ?? []).filter(
                            (k) =>
                              k.principal_id === p.id ||
                              k.principal_name === p.name,
                          );
                          const pBudget =
                            pVks.reduce(
                              (acc, k) => acc + (k.monthly_budget_usd || 0),
                              0,
                            ) ||
                            (govOverview?.teams ?? []).find(
                              (t) =>
                                t.id === p.team_id || t.name === p.team_name,
                            )?.monthly_budget_usd ||
                            500;
                          const pSpend =
                            p.current_spend_usd ||
                            pVks.reduce(
                              (acc, k) => acc + (k.spend_usd || 0),
                              0,
                            );
                          const pPct =
                            pBudget > 0
                              ? Math.round((pSpend / pBudget) * 100)
                              : 0;
                          return (
                            <TableRow key={p.id}>
                              <TableCell className="text-xs font-semibold">
                                <div>{p.name}</div>
                                <div className="text-2xs font-normal text-muted-foreground">
                                  {p.team_name}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                <Badge variant="outline" className="text-2xs">
                                  {p.principal_type}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">
                                <div className="space-y-1">
                                  <div className="flex justify-between text-2xs font-mono">
                                    <span>
                                      ${pSpend.toFixed(2)} / $
                                      {pBudget.toFixed(0)}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {pPct}%
                                    </span>
                                  </div>
                                  <Progress
                                    value={Math.min(pPct, 100)}
                                    className="h-1"
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="text-xs font-mono text-right">
                                {p.rpm_limit.toLocaleString()} /{" "}
                                {p.tpm_limit.toLocaleString()}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </>
                    )}
                  </TableBody>
                </Table>
              </SectionCard>
            </div>
          </div>
        </TabsContent>

        {/* Request Audit Logs */}
        <TabsContent value="audit" className="mt-0">
          <SectionCard
            title="ClickHouse Request Audit & Spend Attribution (otel.aigw_requests)"
            description="Per-request token usage, micro-USD cost attribution, Semantic Cache HIT/MISS, and failover events"
            compact
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Audit ID</TableHead>
                  <TableHead className="text-xs">
                    Principal &amp; Team
                  </TableHead>
                  <TableHead className="text-xs">Model / Provider</TableHead>
                  <TableHead className="text-xs">Path / Status</TableHead>
                  <TableHead className="text-xs">
                    Cache &amp; Failover
                  </TableHead>
                  <TableHead className="text-xs text-right">
                    Tokens (In/Out)
                  </TableHead>
                  <TableHead className="text-xs text-right">
                    Cost (USD)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAuditLogs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-xs text-muted-foreground py-6"
                    >
                      No gateway request audit logs recorded yet for this scope.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAuditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {log.id}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-semibold">
                          {log.principal_name}
                        </div>
                        <div className="text-2xs text-muted-foreground">
                          {log.team_name} · {log.org_name}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        <div>{log.model_id}</div>
                        <div className="text-2xs text-muted-foreground">
                          {log.provider_name}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        <Badge
                          variant={
                            log.status_code === 200 ? "default" : "destructive"
                          }
                          className="text-2xs mr-1.5"
                        >
                          {log.status_code}
                        </Badge>
                        {log.path}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap gap-1">
                          <Badge
                            variant={
                              log.semantic_cache_status === "HIT"
                                ? "default"
                                : "outline"
                            }
                            className="text-2xs font-mono"
                          >
                            {log.semantic_cache_status}
                          </Badge>
                          {log.failover_triggered && (
                            <Badge variant="secondary" className="text-2xs">
                              Failover
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-right">
                        {log.prompt_tokens.toLocaleString()} /{" "}
                        {log.completion_tokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-right">
                        ${log.cost_usd.toFixed(6)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>

        {/* Gateway Dependency Fabric Topology */}
        <TabsContent value="topology" className="mt-0">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="font-mono text-xs bg-primary/10 text-primary border-primary/30"
                >
                  Gateway Fabric Topology
                </Badge>
                <span className="text-xs font-semibold text-foreground">
                  {scopeName}
                </span>
                <span className="text-xs text-muted-foreground">
                  · Cross-CRD Dependency Fabric{" "}
                  {namespace === "all" ? (
                    "across all namespaces"
                  ) : (
                    <>
                      in namespace{" "}
                      <code className="font-mono text-foreground">
                        {namespace}
                      </code>
                    </>
                  )}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <ResourceTopologyGraph
                nodes={mergedTopologyNodes}
                edges={mergedTopologyEdges}
                info={fabricTopology?.info}
                defaultDomainFilter="ai-gateway"
                heightClassName="h-[520px]"
                onDescribeResource={(res) => {
                  setDescribeResource(res);
                  setDescribeOpen(true);
                }}
              />
            </div>
          </div>
        </TabsContent>

        {/* Gateway Readiness Diagnostics */}
        <TabsContent value="diagnostics" className="mt-0">
          <div className="space-y-4">
            {remediationBanner && (
              <div className="p-3 rounded-lg border border-primary/40 bg-primary/10 text-xs text-foreground flex items-center justify-between">
                <span>{remediationBanner}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => setRemediationBanner(null)}
                >
                  Dismiss
                </Button>
              </div>
            )}

            <SectionCard
              title="AI Gateway & CNF Readiness Diagnostics"
              description="Automated verification and 1-click remediation for operational checks"
              compact
            >
              <div className="space-y-3 pt-1">
                {(govOverview?.diagnostics ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    No readiness diagnostics reported for this scope.
                  </p>
                ) : (
                  (govOverview?.diagnostics ?? []).map((d) => (
                    <div
                      key={d.id}
                      className="p-4 rounded-lg border border-border bg-card flex flex-wrap items-start justify-between gap-4"
                    >
                      <div className="space-y-1 max-w-3xl">
                        <div className="flex items-center gap-2">
                          {d.status === "healthy" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                          )}
                          <span className="text-sm font-semibold text-foreground">
                            {d.title}
                          </span>
                          <Badge variant="outline" className="text-2xs">
                            {d.category}
                          </Badge>
                          <Badge
                            variant={
                              d.status === "healthy" ? "default" : "secondary"
                            }
                            className="text-2xs"
                          >
                            {d.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {d.summary}
                        </p>
                        {d.remediation_hint && (
                          <p className="text-2xs font-mono text-muted-foreground/90 pt-0.5">
                            Hint: {d.remediation_hint}
                          </p>
                        )}
                      </div>
                      {d.remediation_action && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1.5"
                          disabled={remediateMut.isPending}
                          onClick={() =>
                            remediateMut.mutate(d.remediation_action!)
                          }
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          Auto-Remediate
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        </TabsContent>
      </div>

      <ResourceDescribeViewer
        resource={describeResource}
        open={describeOpen}
        onOpenChange={setDescribeOpen}
        clusterId={effectiveClusterId}
      />
    </Tabs>
  );
}

// ============================================================================
// Overview
// ============================================================================

interface TabProps {
  clusterId: LlmClusterScope;
  params: LlmObservabilityParams;
  active: boolean;
}

function OverviewTab({
  clusterId,
  params,
  active,
  auditLogs,
}: TabProps & { auditLogs: AiGatewayRequestLogItem[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
      <HistogramCard
        clusterId={clusterId}
        params={params}
        metric="requests"
        title="Request Volume"
        active={active}
        auditLogs={auditLogs}
        stacked
        colorFor={requestSeriesColor}
        valueFormatter={fmtCompact}
        totalFormatter={fmtInt}
      />
      <HistogramCard
        clusterId={clusterId}
        params={params}
        metric="tokens"
        title="Token Usage"
        active={active}
        auditLogs={auditLogs}
        stacked
        valueFormatter={fmtCompact}
        totalFormatter={fmtCompact}
      />
      <HistogramCard
        clusterId={clusterId}
        params={params}
        metric="cost"
        title="Cost"
        active={active}
        auditLogs={auditLogs}
        stacked
        valueFormatter={fmtCost}
        totalFormatter={fmtCost}
      />
      <HistogramCard
        clusterId={clusterId}
        params={params}
        metric="models"
        title="Model Usage"
        active={active}
        auditLogs={auditLogs}
        stacked
        valueFormatter={fmtCompact}
        totalFormatter={fmtInt}
      />
      <HistogramCard
        clusterId={clusterId}
        params={params}
        metric="latency"
        title="Latency"
        active={active}
        auditLogs={auditLogs}
        forceType="line"
        valueFormatter={fmtLatencyMs}
      />
    </div>
  );
}

interface HistogramCardProps {
  clusterId: LlmClusterScope;
  params: LlmObservabilityParams;
  metric: LlmHistogramMetric;
  title: string;
  active: boolean;
  auditLogs: AiGatewayRequestLogItem[];
  stacked?: boolean;
  forceType?: "line";
  colorFor?: (name: string) => string;
  valueFormatter: (v: number) => string;
  totalFormatter?: (v: number) => string;
}

function HistogramCard({
  clusterId,
  params,
  metric,
  title,
  active,
  auditLogs,
  stacked,
  forceType,
  colorFor,
  valueFormatter,
  totalFormatter,
}: HistogramCardProps) {
  const [chartType, setChartType] = useState<ChartType>("bar");
  const { data, isLoading } = useLlmHistogram(
    clusterId,
    { ...params, metric },
    active,
  );

  const lokiSeries = useMemo(() => data?.series ?? [], [data?.series]);
  const auditSeries = useMemo(
    () => buildHistogramSeriesFromAuditLogs(auditLogs, metric),
    [auditLogs, metric],
  );
  const series = useMemo(() => {
    if (lokiSeries.length > 0) return lokiSeries;
    return auditSeries;
  }, [lokiSeries, auditSeries]);
  const available = (data?.available ?? true) || auditSeries.length > 0;
  const colors = series.map((s, i) =>
    colorFor ? colorFor(s.name) : seriesColor(i),
  );
  const legend = series.map((s, i) => ({ name: s.name, color: colors[i] }));
  const total = totalFormatter ? totalFormatter(sumSeries(series)) : undefined;
  const type = forceType ?? chartType;

  return (
    <ChartCard
      title={title}
      total={total}
      legend={legend}
      loading={isLoading}
      available={available}
      unavailableReason={data?.errors?.[metric] || "Data source unavailable"}
      controls={
        forceType ? undefined : (
          <ChartTypeToggle value={chartType} onChange={setChartType} />
        )
      }
    >
      <TimeSeriesChart
        series={series}
        colors={colors}
        type={type}
        stacked={stacked}
        valueFormatter={valueFormatter}
      />
    </ChartCard>
  );
}

// ============================================================================
// Model Rankings
// ============================================================================

type SortKey =
  | "requests"
  | "tokens"
  | "cost"
  | "avg_latency_ms"
  | "success_rate";

function RankingsTab({
  clusterId,
  params,
  active,
  govOverview,
  modelFilter,
  statusFilter,
}: TabProps & {
  govOverview: AiGatewayGovernanceOverviewResponse | undefined;
  modelFilter: string;
  statusFilter: string;
}) {
  const { data, isLoading } = useLlmRankings(clusterId, params, active);
  const { data: modelsHist } = useLlmHistogram(
    clusterId,
    { ...params, metric: "models" },
    active,
  );
  const [sortKey, setSortKey] = useState<SortKey>("requests");

  const govRows = useMemo(
    () => buildRankingsFromGovernance(govOverview, modelFilter, statusFilter),
    [govOverview, modelFilter, statusFilter],
  );

  const rows = useMemo(() => {
    const map = new Map<string, LlmRankingRow>();
    for (const r of data?.rows ?? []) {
      map.set(r.model, { ...r });
    }
    for (const gr of govRows) {
      const existing = map.get(gr.model);
      if (!existing) {
        map.set(gr.model, gr);
      } else if (existing.requests === 0 && gr.requests > 0) {
        map.set(gr.model, gr);
      }
    }
    return Array.from(map.values()).sort((a, b) => b[sortKey] - a[sortKey]);
  }, [data?.rows, govRows, sortKey]);

  const topSeries = useMemo(() => {
    const histSeries = modelsHist?.series ?? [];
    if (histSeries.length > 0) {
      return [...histSeries]
        .sort((a, b) => sumSeries([b]) - sumSeries([a]))
        .slice(0, 6);
    }
    return buildTopModelsSeries(rows);
  }, [modelsHist?.series, rows]);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data?.available && rows.length === 0) {
    return (
      <EmptyState
        icon={Info}
        title="Rankings unavailable"
        description={data?.errors?.rankings || "Rankings unavailable."}
      />
    );
  }

  const colors = topSeries.map((_, i) => seriesColor(i));
  const totalSpend = rows.reduce((acc, r) => acc + r.cost, 0);

  return (
    <div className="space-y-4">
      <ChartCard
        title="Top Models by Requests"
        legend={topSeries.map((s, i) => ({ name: s.name, color: colors[i] }))}
        maxLegend={6}
      >
        <TimeSeriesChart
          series={topSeries}
          colors={colors}
          type="bar"
          stacked
          valueFormatter={fmtCompact}
        />
      </ChartCard>

      <SectionCard compact>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Model</TableHead>
                <SortHead
                  label="Requests"
                  k="requests"
                  sortKey={sortKey}
                  onSort={setSortKey}
                />
                <SortHead
                  label="Success"
                  k="success_rate"
                  sortKey={sortKey}
                  onSort={setSortKey}
                />
                <SortHead
                  label="Tokens"
                  k="tokens"
                  sortKey={sortKey}
                  onSort={setSortKey}
                />
                <SortHead
                  label="Cost"
                  k="cost"
                  sortKey={sortKey}
                  onSort={setSortKey}
                />
                <TableHead className="w-[150px]">Spend Share</TableHead>
                <SortHead
                  label="Avg Latency"
                  k="avg_latency_ms"
                  sortKey={sortKey}
                  onSort={setSortKey}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => {
                const sharePct =
                  totalSpend > 0
                    ? Math.round((row.cost / totalSpend) * 100)
                    : 0;
                return (
                  <TableRow key={row.model}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {i + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: providerColor(row.provider),
                          }}
                          title={row.provider}
                        />
                        <span className="font-medium text-foreground">
                          {row.model}
                        </span>
                        <span className="text-2xs text-muted-foreground uppercase">
                          {row.provider}
                        </span>
                      </div>
                    </TableCell>
                    <NumCell
                      value={fmtInt(row.requests)}
                      delta={row.trend.requests}
                    />
                    <TableCell className="text-right tabular-nums text-foreground/80">
                      {fmtPct(row.success_rate)}
                    </TableCell>
                    <NumCell
                      value={fmtCompact(row.tokens)}
                      delta={row.trend.tokens}
                    />
                    <NumCell value={fmtCost(row.cost)} delta={row.trend.cost} />
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex justify-between text-2xs font-mono">
                          <span>{fmtCost(row.cost)}</span>
                          <span className="text-muted-foreground">
                            {sharePct}%
                          </span>
                        </div>
                        <Progress
                          value={Math.min(sharePct, 100)}
                          className="h-1"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground/80">
                      {fmtLatencyMs(row.avg_latency_ms)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </div>
  );
}

function SortHead({
  label,
  k,
  sortKey,
  onSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  onSort: (k: SortKey) => void;
}) {
  return (
    <TableHead className="text-right">
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          sortKey === k ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </TableHead>
  );
}

function NumCell({ value, delta }: { value: string; delta: number | null }) {
  return (
    <TableCell className="text-right">
      <div className="flex items-center justify-end gap-1.5">
        <span className="tabular-nums text-foreground/80">{value}</span>
        <TrendBadge delta={delta} />
      </div>
    </TableCell>
  );
}

/** Build a single-bucket stacked series (top-N models + "Other") for the bar. */
function buildTopModelsSeries(rows: LlmRankingRow[], topN = 6): LlmSeries[] {
  const sorted = [...rows].sort((a, b) => b.requests - a.requests);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const bucket = "total";
  const series: LlmSeries[] = top.map((r) => ({
    name: r.model,
    points: [{ ts: bucket, value: r.requests }],
  }));
  if (rest.length > 0) {
    series.push({
      name: "Other",
      points: [{ ts: bucket, value: rest.reduce((a, r) => a + r.requests, 0) }],
    });
  }
  return series;
}

// ============================================================================
// Provider Usage
// ============================================================================

function ProviderUsageTab({
  clusterId,
  params,
  active,
  auditLogs,
  govOverview,
}: TabProps & {
  auditLogs: AiGatewayRequestLogItem[];
  govOverview: AiGatewayGovernanceOverviewResponse | undefined;
}) {
  const [provider, setProvider] = useState("");

  const providerOptions = useMemo(() => {
    const s = new Set<string>(["openai", "anthropic", "google", "unknown"]);
    for (const p of govOverview?.providers ?? []) {
      if (p.name) s.add(p.name);
    }
    for (const l of auditLogs) {
      if (l.provider_name) s.add(l.provider_name);
    }
    return Array.from(s);
  }, [govOverview?.providers, auditLogs]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" />
        <span>
          Provider usage is aggregated from AI Gateway provider bindings and
          model telemetry.
        </span>
        <div className="ml-2">
          <FilterSelect
            value={provider}
            onChange={setProvider}
            options={providerOptions}
            allLabel="All providers"
            placeholder="Provider"
            width="w-[150px]"
            ariaLabel="Provider filter"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
        <ProviderCard
          clusterId={clusterId}
          params={params}
          metric="cost"
          title="Cost by Provider"
          active={active}
          provider={provider}
          auditLogs={auditLogs}
          valueFormatter={fmtCost}
        />
        <ProviderCard
          clusterId={clusterId}
          params={params}
          metric="tokens"
          title="Tokens by Provider"
          active={active}
          provider={provider}
          auditLogs={auditLogs}
          valueFormatter={fmtCompact}
        />
        <ProviderCard
          clusterId={clusterId}
          params={params}
          metric="latency"
          title="Latency by Provider"
          active={active}
          provider={provider}
          auditLogs={auditLogs}
          valueFormatter={fmtLatencyMs}
        />
      </div>
    </div>
  );
}

function ProviderCard({
  clusterId,
  params,
  metric,
  title,
  active,
  provider,
  auditLogs,
  valueFormatter,
}: {
  clusterId: LlmClusterScope;
  params: LlmObservabilityParams;
  metric: LlmProviderMetric;
  title: string;
  active: boolean;
  provider: string;
  auditLogs: AiGatewayRequestLogItem[];
  valueFormatter: (v: number) => string;
}) {
  const { data, isLoading } = useLlmProviderUsage(
    clusterId,
    { ...params, metric },
    active,
  );

  const auditSeries = useMemo(() => {
    if (auditLogs.length === 0) return [];
    const byProv = new Map<string, Array<{ ts: string; value: number }>>();
    for (const l of auditLogs) {
      const pName = l.provider_name || inferProvider(l.model_id);
      const list = byProv.get(pName) ?? [];
      const val =
        metric === "cost"
          ? l.cost_usd
          : metric === "tokens"
            ? l.prompt_tokens + l.completion_tokens
            : l.latency_ms;
      list.push({ ts: l.timestamp, value: val });
      byProv.set(pName, list);
    }
    return Array.from(byProv.entries()).map(([name, points]) => ({
      name,
      points,
    }));
  }, [auditLogs, metric]);

  const rawSeries = useMemo(() => {
    const lokiSeries = data?.series ?? [];
    if (lokiSeries.length > 0) return lokiSeries;
    return auditSeries;
  }, [data?.series, auditSeries]);

  const series = rawSeries.filter(
    (s) =>
      !provider || inferProvider(s.name) === provider || s.name === provider,
  );
  const available = (data?.available ?? true) || auditSeries.length > 0;
  const colors = series.map((s, i) => {
    const inferred = inferProvider(s.name);
    return inferred !== "unknown" ? providerColor(inferred) : seriesColor(i);
  });

  return (
    <ChartCard
      title={title}
      legend={series.map((s, i) => ({ name: s.name, color: colors[i] }))}
      loading={isLoading}
      available={available}
      unavailableReason={data?.errors?.[metric] || "Data source unavailable"}
    >
      <TimeSeriesChart
        series={series}
        colors={colors}
        type="area"
        valueFormatter={valueFormatter}
      />
    </ChartCard>
  );
}
