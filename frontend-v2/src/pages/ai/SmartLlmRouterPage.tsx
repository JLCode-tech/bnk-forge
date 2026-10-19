import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Layers,
  Zap,
  Server,
  Activity,
  ArrowLeft,
  Network,
  Cpu,
  Sliders,
  RefreshCw,
  KeyRound,
  ShieldCheck,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Copy,
  Check,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/observability/StatTile";
import { ErrorState } from "@/components/ui/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClusterPicker } from "@/components/observability/pickers";
import { F5AIAnalyzerViewer } from "@/components/k8s/F5AIAnalyzerViewer";
import { ResourceTopologyGraph } from "@/components/k8s/ResourceTopologyGraph";
import { ResourceDescribeViewer } from "@/components/k8s/ResourceDescribeViewer";
import { useAllClusters } from "@/hooks/useK8sClusters";
import { useLlmStats } from "@/hooks/useLlmObservability";
import { useClusterScope } from "@/hooks/useClusterScope";
import { useTopology } from "@/hooks/useTopology";
import { llmObservabilityApi } from "@/lib/api/llmObservability";
import { cn } from "@/lib/utils";
import { ClusterRouterRow } from "./ClusterRouterRow";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import type { K8sResource } from "@/types/kubernetes";

type InferenceViewKey =
  | "overview"
  | "topology"
  | "pools"
  | "policies"
  | "governance"
  | "diagnostics";

function resolveInferenceView(raw: string | null): InferenceViewKey | null {
  if (!raw) return null;
  if (raw === "epp") return "policies";
  if (
    raw === "overview" ||
    raw === "topology" ||
    raw === "pools" ||
    raw === "policies" ||
    raw === "governance" ||
    raw === "diagnostics"
  ) {
    return raw;
  }
  return null;
}

const INFERENCE_VIEWS: Array<{
  key: InferenceViewKey;
  label: string;
  subtitle: string;
  icon: typeof Layers;
}> = [
  {
    key: "overview",
    label: "Fleet Overview",
    subtitle:
      "Multi-cluster BNK 2.4.1 AI Gateway & GAIE routing telemetry across Kubernetes clusters",
    icon: Server,
  },
  {
    key: "topology",
    label: "Gateway Fabric Topology",
    subtitle:
      "Interactive cross-CRD Dependency Fabric (AppPolicy → Gateway ↔ HTTPRoute & AIGatewayProfile → AIModel → AIProvider → Secret)",
    icon: Network,
  },
  {
    key: "pools",
    label: "Model & Provider Catalog",
    subtitle:
      "AITenant, AIProvider, AICredential & AIModel catalog with weighted multi-provider deployments and token pricing",
    icon: Cpu,
  },
  {
    key: "policies",
    label: "Gateway Routes & Policies",
    subtitle:
      "AIGatewayProfile & AppPolicy builder — VIPs, VirtualKey/JWT auth, Failover, Semantic Cache pooling & Model Routing",
    icon: Sliders,
  },
  {
    key: "governance",
    label: "DSSM Governance & Keys",
    subtitle:
      "Multi-cluster Organizations, Teams, Principals (User/Service/Agent), Budgets, Rate Limits & f5vk_ Virtual Keys",
    icon: KeyRound,
  },
  {
    key: "diagnostics",
    label: "BNK 2.4.1 Readiness",
    subtitle:
      "Live BNK 2.4.1 AI Gateway & CNF diagnostics — AIGatewayProfile Programmed check, CoreDNS aigw-dns-resolver & Multi-NUMA",
    icon: ShieldCheck,
  },
];

export default function SmartLlmRouterPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlView = resolveInferenceView(searchParams.get("tab"));

  const {
    data: clustersData,
    refetch,
    error: clustersError,
  } = useAllClusters();
  const clusters = clustersData?.clusters ?? [];

  const [selectedClusterId, setSelectedClusterId] = useClusterScope();
  const [selectedSubView, setSelectedSubView] = useState<InferenceViewKey>(
    urlView ?? "topology",
  );
  const [namespace, setNamespace] = useState<string>("default");
  const [showEppAnalyzer, setShowEppAnalyzer] = useState<boolean>(false);
  const [describeResource, setDescribeResource] = useState<K8sResource | null>(
    null,
  );
  const [describeOpen, setDescribeOpen] = useState(false);

  // Form states for Model Catalog, Routes, and DSSM Governance
  const [newTenantName, setNewTenantName] = useState("");
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderType, setNewProviderType] = useState("Generic");
  const [newProviderEndpoint, setNewProviderEndpoint] = useState(
    "https://api.openai.com/v1",
  );
  const [newProviderApiKey, setNewProviderApiKey] = useState("");

  const [newModelName, setNewModelName] = useState("");
  const [newModelId, setNewModelId] = useState("gpt-4o");
  const [newModelProviderRef, setNewModelProviderRef] =
    useState("openai-primary");
  const [newModelWeight, setNewModelWeight] = useState("100");
  const [newModelInputCost, setNewModelInputCost] = useState("2500000");
  const [newModelOutputCost, setNewModelOutputCost] = useState("10000000");

  const [newRouteName, setNewRouteName] = useState("");
  const [newRouteVip, setNewRouteVip] = useState("10.10.20.90");
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
  const [newKeyRpm, setNewKeyRpm] = useState("600");
  const [newKeyTpm, setNewKeyTpm] = useState("150000");
  const [newKeyBudget, setNewKeyBudget] = useState("500");
  const [issuedCleartextKey, setIssuedCleartextKey] = useState<string | null>(
    null,
  );
  const [copiedKey, setCopiedKey] = useState(false);
  const [remediationBanner, setRemediationBanner] = useState<string | null>(
    null,
  );

  // DSSM Organization, Team, and Principal form states
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgBudget, setNewOrgBudget] = useState("2500");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamOrgId, setNewTeamOrgId] = useState("");
  const [newTeamBudget, setNewTeamBudget] = useState("1000");
  const [newPrincipalName, setNewPrincipalName] = useState("");
  const [newPrincipalType, setNewPrincipalType] = useState<
    "user" | "service" | "agent"
  >("agent");
  const [newPrincipalTeamId, setNewPrincipalTeamId] = useState("");

  // Polaris Step 8 Live Gateway Inference & Policy Tester state
  const [testRouteName, setTestRouteName] = useState("");
  const [testModelId, setTestModelId] = useState("gpt-4o");
  const [testPath, setTestPath] = useState("/v1/chat/completions");
  const [testVirtualKey, setTestVirtualKey] = useState("");
  const [testPrompt, setTestPrompt] = useState(
    "Summarize BNK 2.4.1 CNEInstance Multi-NUMA and CoreDNS readiness.",
  );
  const [testSimulateFailure, setTestSimulateFailure] = useState(false);

  useEffect(() => {
    if (urlView) {
      setSelectedSubView(urlView);
      if (urlView === "overview" && selectedClusterId !== null) {
        setSelectedClusterId(null);
      }
    }
  }, [urlView, selectedClusterId, setSelectedClusterId]);

  const activeViewKey: InferenceViewKey =
    urlView ?? (selectedClusterId === null ? "overview" : selectedSubView);

  const activeViewMeta =
    INFERENCE_VIEWS.find((v) => v.key === activeViewKey) ?? INFERENCE_VIEWS[0];

  const effectiveClusterId = selectedClusterId ?? clusters[0]?.id ?? 1;

  const handleSelectView = (viewKey: InferenceViewKey) => {
    const next = new URLSearchParams(searchParams);
    if (viewKey === "overview") {
      next.delete("tab");
      setSearchParams(next, { replace: true });
      setSelectedClusterId(null);
      return;
    }
    next.set("tab", viewKey);
    setSearchParams(next, { replace: true });
    setSelectedSubView(viewKey);
  };

  const handleClusterScopeChange = (clusterId: number | null) => {
    setSelectedClusterId(clusterId);
    const next = new URLSearchParams(searchParams);
    if (clusterId === null) {
      if (!urlView) {
        next.delete("tab");
        setSearchParams(next, { replace: true });
      }
      return;
    }
    const targetView =
      selectedSubView === "overview" ? "topology" : selectedSubView;
    setSelectedSubView(targetView);
    if (!urlView || urlView === "overview") {
      next.set("tab", targetView);
      setSearchParams(next, { replace: true });
    }
  };

  const { data: llmStats, isLoading: statsLoading } = useLlmStats(
    selectedClusterId,
    { range: "24h" },
  );
  const live = llmStats?.available ? llmStats : undefined;
  const pending = statsLoading ? "…" : "—";

  const {
    data: govOverview,
    isLoading: govLoading,
    refetch: refetchGov,
  } = useQuery({
    queryKey: [
      "llm-governance-overview",
      selectedClusterId ?? "all",
      namespace,
    ],
    queryFn: () =>
      llmObservabilityApi.getGovernanceOverview(
        selectedClusterId ?? undefined,
        namespace,
      ),
  });

  const { data: fabricTopology, refetch: refetchTopology } = useTopology(
    effectiveClusterId,
    namespace,
    { enabled: activeViewKey === "topology" && !!effectiveClusterId },
  );

  // Merge live cluster topology with governance CRD fabric nodes/edges (supports single & multi-cluster)
  const mergedTopologyNodes = (() => {
    const map = new Map<
      string,
      NonNullable<typeof fabricTopology>["nodes"][number]
    >();
    for (const n of (govOverview?.topology_nodes ??
      []) as unknown as NonNullable<typeof fabricTopology>["nodes"]) {
      map.set(n.id, n);
    }
    if (selectedClusterId !== null) {
      for (const n of fabricTopology?.nodes ?? []) {
        map.set(n.id, n);
      }
    }
    return Array.from(map.values());
  })();

  const mergedTopologyEdges = (() => {
    const map = new Map<
      string,
      NonNullable<typeof fabricTopology>["edges"][number]
    >();
    for (const e of (govOverview?.topology_edges ??
      []) as unknown as NonNullable<typeof fabricTopology>["edges"]) {
      map.set(e.id, e);
    }
    if (selectedClusterId !== null) {
      for (const e of fabricTopology?.edges ?? []) {
        map.set(e.id, e);
      }
    }
    return Array.from(map.values());
  })();

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
        namespace,
        tenant_ref: govOverview?.tenants[0]?.name ?? "default-ai-tenant",
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
        namespace,
        tenant_ref: govOverview?.tenants[0]?.name ?? "default-ai-tenant",
        model_id: newModelId.trim(),
        deployments: [
          {
            provider_ref: newModelProviderRef.trim() || "openai-primary",
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
        namespace,
        gateway_name: `${newRouteName.trim()}-gw`,
        vip_address: newRouteVip.trim(),
        port: Number(newRoutePort) || 8080,
        path_prefix: "/v1",
        tenant_ref: govOverview?.tenants[0]?.name ?? "default-ai-tenant",
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
        model_id: testModelId.trim() || "gpt-4o",
        prompt: testPrompt.trim(),
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
        tenant_ref: govOverview?.tenants[0]?.name ?? "enterprise-ai",
        monthly_budget_usd: Number(newOrgBudget) || 2500,
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
        org_id: newTeamOrgId || govOverview?.organizations[0]?.id || "org-1",
        monthly_budget_usd: Number(newTeamBudget) || 1000,
        allowed_models: govOverview?.models.map((m) => m.model_id) ?? [
          "gpt-4o",
        ],
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
        team_id: newPrincipalTeamId || govOverview?.teams[0]?.id || "team-1",
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
        principal_id:
          newKeyPrincipalId ||
          govOverview?.principals[0]?.id ||
          "princ-agent-1",
        allowed_models: govOverview?.models.map((m) => m.model_id) ?? [
          "gpt-4o",
        ],
        rpm_limit: Number(newKeyRpm) || 600,
        tpm_limit: Number(newKeyTpm) || 150000,
        monthly_budget_usd: Number(newKeyBudget) || 500,
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
        namespace,
      }),
    onSuccess: (res) => {
      setRemediationBanner(res.message);
      invalidateGov();
    },
  });

  const activeCluster = clusters.find((c) => c.id === selectedClusterId);

  return (
    <div className="flex min-h-[calc(100vh-3rem)]">
      {/* Left Flush Inner Sub-Sidebar */}
      <CollapsibleInnerSidebar className="w-56 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
        <div className="px-2 pt-1 pb-2 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground">
            AI Gateway &amp; Governance
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            BNK 2.4.1 Multi-Cluster LLM Gateway, Dependency Fabric &amp; DSSM
            Governance
          </p>
        </div>

        <div className="space-y-1">
          <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            AI GATEWAY CONSOLE
          </div>
          <div
            role="navigation"
            aria-label="Intelligent Inference views"
            className="flex flex-col items-stretch gap-0.5"
          >
            {INFERENCE_VIEWS.map((item) => {
              const Icon = item.icon;
              const isActive = activeViewKey === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleSelectView(item.key)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors text-left",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.key === "overview" && (
                    <Badge
                      variant="secondary"
                      className="text-2xs px-1.5 py-0 h-4"
                    >
                      {clusters.length}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </CollapsibleInnerSidebar>

      {/* Right Content Pane */}
      <div className="flex-1 min-w-0 p-6 space-y-6 overflow-y-auto">
        {/* Top Header Bar with Right-Side Cluster Scope Selector */}
        <div className="flex items-start justify-between gap-4 pb-3 border-b border-border">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">
              {activeViewMeta.label}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {activeViewMeta.subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <Badge
              variant="outline"
              className="text-2xs bg-primary/10 text-primary border-primary/30"
            >
              BNK 2.4.1 AI Gateway
            </Badge>
            <Input
              value={namespace}
              onChange={(e) => setNamespace(e.target.value || "default")}
              placeholder="Namespace"
              className="h-8 w-28 text-xs font-mono"
              title="Kubernetes Namespace"
            />
            <ClusterPicker
              value={selectedClusterId}
              onChange={handleClusterScopeChange}
              allowAll={true}
              showProjectSelector
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                void refetch();
                void refetchGov();
                void refetchTopology();
              }}
              disabled={statsLoading || govLoading}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${statsLoading || govLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {clustersError ? (
          <ErrorState
            error={clustersError}
            onRetry={() => refetch()}
            title="Failed to load clusters"
          />
        ) : (
          <>
            {/* Crisp Architecture KPI Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile
                label="Total Inferences"
                value={live ? live.total_requests.toLocaleString() : pending}
                icon={Zap}
                tone="primary"
                loading={statsLoading}
                subtext="Past 24 hours"
              />
              <StatTile
                label="AI Models & Providers"
                value={`${govOverview?.models.length ?? 0} / ${govOverview?.providers.length ?? 0}`}
                icon={Layers}
                tone="primary"
                loading={govLoading}
                subtext={`${govOverview?.tenants.length ?? 0} AITenant(s)`}
              />
              <StatTile
                label="Average Latency"
                value={live ? `${Math.round(live.avg_latency_ms)}ms` : pending}
                icon={Activity}
                tone="success"
                loading={statsLoading}
                subtext="Mean end-to-end"
              />
              <StatTile
                label="DSSM Virtual Keys"
                value={`${govOverview?.virtual_keys.filter((k) => k.status === "active").length ?? 0} Active`}
                icon={KeyRound}
                tone="primary"
                subtext={
                  selectedClusterId === null
                    ? `Across ${clusters.length} clusters`
                    : (activeCluster?.name ?? `Cluster ${selectedClusterId}`)
                }
              />
            </div>

            {activeViewKey === "overview" && (
              <SectionCard
                title="Clusters"
                description="AI Gateway telemetry and DSSM governance per cluster. Select one to inspect its Gateway Fabric Topology, Model Catalog, Routes & Virtual Keys."
                action={
                  <Badge variant="outline" className="text-xs">
                    {clusters.length} clusters
                  </Badge>
                }
                compact
              >
                <div className="overflow-x-auto -mx-4">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent bg-muted/40">
                        <TableHead className="text-xs font-semibold">
                          Cluster Name
                        </TableHead>
                        <TableHead className="text-xs font-semibold">
                          Cloud Provider
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-right">
                          Requests
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-right">
                          Success
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-right">
                          Avg Latency
                        </TableHead>
                        <TableHead className="text-xs font-semibold">
                          Telemetry
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-right">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clusters.map((c) => (
                        <ClusterRouterRow
                          key={c.id}
                          cluster={c}
                          onInspect={() => {
                            setSelectedClusterId(c.id);
                            handleSelectView("topology");
                          }}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </SectionCard>
            )}

            {activeViewKey === "topology" && (
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
                      {selectedClusterId === null
                        ? `All Clusters (${clusters.length})`
                        : (activeCluster?.name ??
                          clusters[0]?.name ??
                          `Cluster ${effectiveClusterId}`)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      · Cross-CRD Dependency Fabric in namespace{" "}
                      <code className="font-mono text-foreground">
                        {namespace}
                      </code>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={showEppAnalyzer ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowEppAnalyzer((v) => !v)}
                    >
                      {showEppAnalyzer
                        ? "Hide F5 AI Analyzer"
                        : "Show F5 AI Analyzer"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => handleSelectView("overview")}
                    >
                      <ArrowLeft className="h-3 w-3" />
                      All Clusters
                    </Button>
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

                {showEppAnalyzer && (
                  <F5AIAnalyzerViewer clusterId={effectiveClusterId} />
                )}
              </div>
            )}

            {activeViewKey === "pools" && (
              <div className="space-y-6">
                {/* Create Tenant + Provider + Model Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <SectionCard
                    title="1. Register AITenant"
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

                  <SectionCard
                    title="2. Add AIProvider & AICredential"
                    description="Generic type requires /v1 base path in BNK 2.4.1"
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
                    title="3. Publish AIModel"
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
                          onChange={(e) =>
                            setNewModelProviderRef(e.target.value)
                          }
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
                          onChange={(e) =>
                            setNewModelOutputCost(e.target.value)
                          }
                          placeholder="Out µUSD/Mtok"
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="w-full h-8 text-xs gap-1.5"
                        disabled={
                          !newModelName.trim() || createModelMut.isPending
                        }
                        onClick={() => createModelMut.mutate()}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Create AIModel
                      </Button>
                    </div>
                  </SectionCard>
                </div>

                {/* Catalog Tables */}
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
                      {(govOverview?.models ?? []).map((m) => (
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
                            {(
                              m.output_token_cost_micro_usd / 1_000_000
                            ).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="default" className="text-2xs">
                              {m.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
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
                      {(govOverview?.providers ?? []).map((p) => (
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
                      ))}
                    </TableBody>
                  </Table>
                </SectionCard>
              </div>
            )}

            {activeViewKey === "policies" && (
              <div className="space-y-6">
                <SectionCard
                  title="Provision Gateway Route, AIGatewayProfile & AppPolicy (BNK 2.4.1)"
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
                      title="BNK 2.4.1 semantic_cache_pool_max_size"
                      className="h-8 text-xs font-mono"
                    />
                    <Input
                      value={newRoutePoolIdleTimeout}
                      onChange={(e) =>
                        setNewRoutePoolIdleTimeout(e.target.value)
                      }
                      placeholder="Pool Idle (300s)"
                      title="BNK 2.4.1 semantic_cache_pool_idle_timeout"
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
                        <span>Semantic Prompt Cache (BNK 2.4.1 Pooled)</span>
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

                <SectionCard
                  title="Active Gateway Routes & AIGatewayProfiles"
                  description="Includes BNK 2.4.1 Semantic Cache connection pool parameters, AppPolicy bindings, and live policy toggles"
                  compact
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Route / VIP</TableHead>
                        <TableHead className="text-xs">
                          AIGatewayProfile
                        </TableHead>
                        <TableHead className="text-xs">AppPolicy</TableHead>
                        <TableHead className="text-xs">Auth Mode</TableHead>
                        <TableHead className="text-xs">
                          Semantic Cache Pool (2.4.1)
                        </TableHead>
                        <TableHead className="text-xs">
                          Live Policy Toggles
                        </TableHead>
                        <TableHead className="text-xs">Programmed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(govOverview?.routes ?? []).map((r) => (
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
                                    clusterId:
                                      r.cluster_id || effectiveClusterId,
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
                                  r.semantic_cache_enabled
                                    ? "default"
                                    : "outline"
                                }
                                className="h-6 px-2 text-2xs"
                                disabled={updateRoutePolicyMut.isPending}
                                onClick={() =>
                                  updateRoutePolicyMut.mutate({
                                    clusterId:
                                      r.cluster_id || effectiveClusterId,
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
                                  r.model_routing_enabled
                                    ? "default"
                                    : "outline"
                                }
                                className="h-6 px-2 text-2xs"
                                disabled={updateRoutePolicyMut.isPending}
                                onClick={() =>
                                  updateRoutePolicyMut.mutate({
                                    clusterId:
                                      r.cluster_id || effectiveClusterId,
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
                      ))}
                    </TableBody>
                  </Table>
                </SectionCard>

                {/* Polaris Step 8: Live Gateway Request & Policy Tester */}
                <SectionCard
                  title="Live Gateway Request & Policy Tester (BNK 2.4.1 Step 8)"
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
                          onChange={(e) =>
                            setTestSimulateFailure(e.target.checked)
                          }
                        />
                        <span>Simulate Primary Provider Failure</span>
                      </label>
                      <Button
                        size="sm"
                        className="h-8 text-xs gap-1.5"
                        disabled={
                          !testPrompt.trim() || testRequestMut.isPending
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
                          <Badge
                            variant="outline"
                            className="text-2xs font-mono"
                          >
                            Provider: {testRequestMut.data.selected_provider}
                          </Badge>
                          <Badge
                            variant={
                              testRequestMut.data.semantic_cache_status ===
                              "HIT"
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
            )}

            {activeViewKey === "governance" && (
              <div className="space-y-6">
                {issuedCleartextKey && (
                  <div className="p-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-emerald-400">
                        Virtual Key Issued — Copy Secret Key Now (Shown Only
                        Once)
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
                          void navigator.clipboard?.writeText(
                            issuedCleartextKey,
                          );
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

                {/* DSSM Hierarchy Provisioning: Organization -> Team -> Principal */}
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
                          disabled={
                            !newTeamName.trim() || createTeamMut.isPending
                          }
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
                          onChange={(e) =>
                            setNewPrincipalTeamId(e.target.value)
                          }
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
                            !newPrincipalName.trim() ||
                            createPrincipalMut.isPending
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
                        <TableHead className="text-xs">
                          Allowed Models
                        </TableHead>
                        <TableHead className="text-xs text-right">
                          RPM / TPM
                        </TableHead>
                        <TableHead className="text-xs text-right">
                          Spend / Budget
                        </TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs text-right">
                          Action
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(govOverview?.virtual_keys ?? []).map((vk) => (
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
                          <TableCell className="text-xs font-mono text-right">
                            ${vk.spend_usd.toFixed(2)} / $
                            {vk.monthly_budget_usd.toFixed(0)}
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
                      ))}
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
                          <TableHead className="text-xs">
                            Organization
                          </TableHead>
                          <TableHead className="text-xs">AITenant</TableHead>
                          <TableHead className="text-xs text-right">
                            Spend / Budget
                          </TableHead>
                          <TableHead className="text-xs text-right">
                            RPM / TPM
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(govOverview?.organizations ?? []).map((o) => (
                          <TableRow key={o.id}>
                            <TableCell className="text-xs font-semibold">
                              {o.name}
                            </TableCell>
                            <TableCell className="text-xs font-mono">
                              {o.tenant_ref}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-right">
                              ${o.current_spend_usd.toLocaleString()} / $
                              {o.monthly_budget_usd.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-right">
                              {o.rpm_limit.toLocaleString()} /{" "}
                              {o.tpm_limit.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </SectionCard>

                  <SectionCard
                    title="Teams & Principals"
                    description="Users, Services, and Autonomous Agents"
                    compact
                  >
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Principal</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs">Team</TableHead>
                          <TableHead className="text-xs text-right">
                            RPM / TPM
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(govOverview?.principals ?? []).map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs font-semibold">
                              {p.name}
                            </TableCell>
                            <TableCell className="text-xs">
                              <Badge variant="outline" className="text-2xs">
                                {p.principal_type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              {p.team_name}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-right">
                              {p.rpm_limit.toLocaleString()} /{" "}
                              {p.tpm_limit.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </SectionCard>
                </div>

                {/* ClickHouse otel.aigw_requests Request Audit & Spend Attribution */}
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
                        <TableHead className="text-xs">
                          Model / Provider
                        </TableHead>
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
                      {(govOverview?.request_audit_logs ?? []).map((log) => (
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
                                log.status_code === 200
                                  ? "default"
                                  : "destructive"
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
                      ))}
                    </TableBody>
                  </Table>
                </SectionCard>
              </div>
            )}

            {activeViewKey === "diagnostics" && (
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
                  title="BNK 2.4.1 AI Gateway & CNF Readiness Diagnostics"
                  description="Automated verification and 1-click remediation for BNK 2.4.1 operational gotchas"
                  compact
                >
                  <div className="space-y-3 pt-1">
                    {(govOverview?.diagnostics ?? []).map((d) => (
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
                            className="h-8 text-xs gap-1.5 shrink-0"
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
                    ))}
                  </div>
                </SectionCard>
              </div>
            )}
          </>
        )}
      </div>

      <ResourceDescribeViewer
        open={describeOpen}
        onOpenChange={setDescribeOpen}
        resource={describeResource}
        clusterId={effectiveClusterId}
        namespace={describeResource?.metadata?.namespace ?? namespace}
      />
    </div>
  );
}
