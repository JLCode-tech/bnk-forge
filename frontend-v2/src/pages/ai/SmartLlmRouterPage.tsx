import { useState, useEffect, useMemo } from "react";
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
  CheckCircle2,
  AlertTriangle,
  Wrench,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/observability/StatTile";
import { ErrorState } from "@/components/ui/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClusterPicker } from "@/components/observability/pickers";
import { F5AIAnalyzerViewer } from "@/components/k8s/F5AIAnalyzerViewer";
import { ResourceTopologyGraph } from "@/components/k8s/ResourceTopologyGraph";
import { ResourceDescribeViewer } from "@/components/k8s/ResourceDescribeViewer";
import { useAllClusters } from "@/hooks/useK8sClusters";
import { useLlmStats } from "@/hooks/useLlmObservability";
import { useClusterScope } from "@/hooks/useClusterScope";
import { useTopology } from "@/hooks/useTopology";
import { api } from "@/lib/api";
import { llmObservabilityApi } from "@/lib/api/llmObservability";
import { cn } from "@/lib/utils";
import type { K8sResource } from "@/types/kubernetes";
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

type InferenceViewKey = "overview" | "topology" | "pools" | "policies";

function resolveInferenceView(raw: string | null): InferenceViewKey | null {
  if (!raw) return null;
  if (raw === "epp") return "policies";
  if (
    raw === "overview" ||
    raw === "topology" ||
    raw === "pools" ||
    raw === "policies"
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
      "Gateway API Inference Extension — KV-cache, queue & LoRA-aware LLM traffic routing across clusters",
    icon: Server,
  },
  {
    key: "topology",
    label: "Routing Topology",
    subtitle:
      "Real-time Endpoint Picker (EPP) topology, F5 AI Analyzer & Gateway routing telemetry",
    icon: Network,
  },
  {
    key: "pools",
    label: "Inference Pools & Models",
    subtitle:
      "Model server pools, LoRA adapter readiness & KV-cache utilization per cluster",
    icon: Cpu,
  },
  {
    key: "policies",
    label: "EPP Policies & Scoring",
    subtitle:
      "Queue depth, KV-cache affinity & prefix-cache scoring weights for intelligent routing",
    icon: Sliders,
  },
];

export default function SmartLlmRouterPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlView = resolveInferenceView(
    searchParams.get("tab") ?? searchParams.get("view"),
  );
  const urlCluster = searchParams.get("cluster");

  const {
    data: clustersData,
    refetch,
    error: clustersError,
  } = useAllClusters();
  const clusters = useMemo(
    () => clustersData?.clusters ?? [],
    [clustersData?.clusters],
  );

  const [selectedClusterId, setSelectedClusterId] = useClusterScope();
  const [selectedSubView, setSelectedSubView] = useState<InferenceViewKey>(
    urlView ?? "topology",
  );
  const [describeResource, setDescribeResource] = useState<K8sResource | null>(
    null,
  );
  const [describeOpen, setDescribeOpen] = useState(false);
  const [remediationBanner, setRemediationBanner] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (urlCluster === "all") {
      if (selectedClusterId !== null) {
        setSelectedClusterId(null);
      }
    } else if (urlCluster && Number(urlCluster) > 0) {
      const parsedClusterId = Number(urlCluster);
      if (selectedClusterId !== parsedClusterId) {
        setSelectedClusterId(parsedClusterId);
      }
    }
  }, [urlCluster, selectedClusterId, setSelectedClusterId]);

  useEffect(() => {
    if (urlView) {
      setSelectedSubView(urlView);
      if (urlView === "overview") {
        if (selectedClusterId !== null) {
          setSelectedClusterId(null);
        }
      } else if (
        selectedClusterId === null &&
        urlCluster !== "all" &&
        clusters.length > 0
      ) {
        const parsedClusterId =
          urlCluster && Number(urlCluster) > 0
            ? Number(urlCluster)
            : clusters[0].id;
        setSelectedClusterId(parsedClusterId);
      }
    }
  }, [urlView, urlCluster, clusters, selectedClusterId, setSelectedClusterId]);

  const activeViewKey: InferenceViewKey =
    urlView ?? (selectedClusterId === null ? "overview" : selectedSubView);

  const activeViewMeta =
    INFERENCE_VIEWS.find((v) => v.key === activeViewKey) ?? INFERENCE_VIEWS[0];

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
    if (selectedClusterId === null && clusters.length > 0) {
      setSelectedClusterId(clusters[0].id);
    }
  };

  const handleClusterScopeChange = (clusterId: number | null) => {
    setSelectedClusterId(clusterId);
    const next = new URLSearchParams(searchParams);
    if (clusterId === null) {
      next.delete("tab");
      setSearchParams(next, { replace: true });
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
    { range: "6h" },
  );
  const live = llmStats?.available ? llmStats : undefined;
  const pending = statsLoading ? "…" : "—";

  const activeCluster = clusters.find((c) => c.id === selectedClusterId);
  const scopedClusterId = selectedClusterId ?? clusters[0]?.id ?? 1;

  // Dependency Fabric topology for Routing Topology view
  const { data: fabricTopology } = useTopology(scopedClusterId, "all", {
    enabled: activeViewKey === "topology" && Boolean(scopedClusterId),
  });

  // InferencePool & InferenceModel CRs for Pools & Models view
  const { data: poolData } = useQuery({
    queryKey: ["bnk-resources", scopedClusterId, "inferencepool", "all"],
    queryFn: () => api.getClusterResources(scopedClusterId, "inferencepool"),
    enabled:
      (activeViewKey === "pools" || activeViewKey === "policies") &&
      Boolean(scopedClusterId),
    staleTime: 10000,
  });

  const { data: modelData } = useQuery({
    queryKey: [
      "bnk-resources",
      scopedClusterId,
      "inferencemodelrewrite",
      "all",
    ],
    queryFn: () =>
      api.getClusterResources(scopedClusterId, "inferencemodelrewrite"),
    enabled: activeViewKey === "pools" && Boolean(scopedClusterId),
    staleTime: 10000,
  });

  // F5EPP CRs & TMM Data-Plane Readiness for EPP Policies & Scoring view
  const { data: eppData } = useQuery({
    queryKey: ["bnk-resources", scopedClusterId, "f5epp", "all"],
    queryFn: () => api.getClusterResources(scopedClusterId, "f5epp"),
    enabled: activeViewKey === "policies" && Boolean(scopedClusterId),
    staleTime: 10000,
  });

  const { data: govOverview } = useQuery({
    queryKey: ["llm-governance-overview", scopedClusterId, "all"],
    queryFn: () =>
      llmObservabilityApi.getGovernanceOverview(scopedClusterId, "all"),
    enabled: activeViewKey === "policies" && Boolean(scopedClusterId),
    staleTime: 15000,
  });

  const remediateMut = useMutation({
    mutationFn: (action: string) =>
      llmObservabilityApi.remediate(scopedClusterId, {
        action,
        namespace: "f5-bnk",
      }),
    onSuccess: (res) => {
      setRemediationBanner(res.message);
      void queryClient.invalidateQueries({
        queryKey: ["llm-governance-overview"],
      });
    },
  });

  const inferencePools = (poolData?.resources ?? []) as K8sResource[];
  const inferenceModels = (modelData?.resources ?? []) as K8sResource[];
  const eppResources = (eppData?.resources ?? []) as K8sResource[];

  return (
    <div className="flex min-h-[calc(100vh-3rem)]">
      {/* Left Flush Inner Sub-Sidebar */}
      <CollapsibleInnerSidebar className="w-52 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
        <div className="px-2 pt-1 pb-2 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground">
            Intelligent Inference
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            KV-cache, queue &amp; LoRA-aware LLM routing
          </p>
        </div>

        <div className="space-y-1">
          <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            INFERENCE ROUTING
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
              GAIE / F5 EPP
            </Badge>
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
              onClick={() => refetch()}
              disabled={statsLoading}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${statsLoading ? "animate-spin" : ""}`}
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
                subtext="Past 6 hours"
              />
              <StatTile
                label="Success Rate"
                value={
                  live ? `${(live.success_rate * 100).toFixed(1)}%` : pending
                }
                icon={Layers}
                tone="primary"
                loading={statsLoading}
                subtext="Past 6 hours"
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
                label="Scope"
                value={
                  selectedClusterId === null
                    ? "All Clusters"
                    : (activeCluster?.name ?? `Cluster ${selectedClusterId}`)
                }
                icon={Server}
                tone="primary"
                subtext={
                  selectedClusterId === null
                    ? `${clusters.length} clusters`
                    : "Single cluster"
                }
              />
            </div>

            {/* Real-Time Telemetry & EPP Dashboard vs Fleet Router Matrix */}
            {activeViewKey === "overview" ? (
              <SectionCard
                title="Clusters"
                description="Gateway telemetry per cluster, last 6h. Select one to inspect its Intelligent Inference router."
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
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="font-mono text-xs bg-primary/10 text-primary border-primary/30"
                    >
                      Scoped Cluster
                    </Badge>
                    <span className="text-xs font-semibold text-foreground">
                      {activeCluster?.name ??
                        clusters[0]?.name ??
                        `Cluster ${scopedClusterId}`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      · {activeViewMeta.label}
                    </span>
                  </div>
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

                {activeViewKey === "topology" && (
                  <>
                    <F5AIAnalyzerViewer clusterId={scopedClusterId} />
                    <SectionCard
                      title="Dependency Fabric & Routing Topology"
                      description="Gateway API Inference Extension (GAIE), F5EPP, InferencePool, and CNF Dependency Fabric"
                      compact
                    >
                      <div className="rounded-lg border border-border bg-card overflow-hidden">
                        <ResourceTopologyGraph
                          nodes={fabricTopology?.nodes ?? []}
                          edges={fabricTopology?.edges ?? []}
                          info={fabricTopology?.info}
                          defaultDomainFilter="all"
                          heightClassName="h-[460px]"
                          onDescribeResource={(res) => {
                            setDescribeResource(res);
                            setDescribeOpen(true);
                          }}
                        />
                      </div>
                    </SectionCard>
                  </>
                )}

                {activeViewKey === "pools" && (
                  <>
                    <SectionCard
                      title="Inference Pools (InferencePool)"
                      description="Model server backend pools, endpoint picker references, vLLM replica readiness, and KV-cache utilization"
                      action={
                        <Badge variant="outline" className="text-xs">
                          {inferencePools.length} pools
                        </Badge>
                      }
                      compact
                    >
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Pool Name</TableHead>
                            <TableHead className="text-xs">Namespace</TableHead>
                            <TableHead className="text-xs">
                              Target Port
                            </TableHead>
                            <TableHead className="text-xs">
                              Pod Selector
                            </TableHead>
                            <TableHead className="text-xs">
                              Endpoint Picker Ref
                            </TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {inferencePools.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={6}
                                className="text-center text-xs text-muted-foreground py-6"
                              >
                                No InferencePool resources found in this
                                cluster.
                              </TableCell>
                            </TableRow>
                          ) : (
                            inferencePools.map((pool) => {
                              const spec = (pool.spec ?? {}) as Record<
                                string,
                                unknown
                              >;
                              const selectorObj =
                                ((spec.selector as Record<string, unknown>)
                                  ?.matchLabels as Record<string, string>) ??
                                (spec.selector as Record<string, string>) ??
                                {};
                              const selectorText =
                                Object.entries(selectorObj)
                                  .map(([k, v]) => `${k}=${v}`)
                                  .join(", ") || "—";
                              const eppRef =
                                ((
                                  spec.endpointPickerRef as Record<
                                    string,
                                    unknown
                                  >
                                )?.name as string) ??
                                ((spec.extensionRef as Record<string, unknown>)
                                  ?.name as string) ??
                                "default-epp";
                              return (
                                <TableRow
                                  key={
                                    pool.metadata?.uid ?? pool.metadata?.name
                                  }
                                >
                                  <TableCell className="text-xs font-mono font-medium">
                                    {pool.metadata?.name}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    {pool.metadata?.namespace ?? "default"}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    {String(
                                      spec.targetPortNumber ??
                                        (Array.isArray(spec.targetPorts)
                                          ? (
                                              spec.targetPorts[0] as Record<
                                                string,
                                                unknown
                                              >
                                            )?.number
                                          : undefined) ??
                                        8000,
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono text-muted-foreground">
                                    {selectorText}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    {eppRef}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="default"
                                      className="text-2xs"
                                    >
                                      Ready
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
                      title="Inference Models & LoRA Adapters (InferenceModel)"
                      description="Model definitions, criticality tiers, target model weights, and LoRA adapter mappings"
                      action={
                        <Badge variant="outline" className="text-xs">
                          {inferenceModels.length} models
                        </Badge>
                      }
                      compact
                    >
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Resource</TableHead>
                            <TableHead className="text-xs">
                              Model Name
                            </TableHead>
                            <TableHead className="text-xs">Pool Ref</TableHead>
                            <TableHead className="text-xs">
                              Criticality
                            </TableHead>
                            <TableHead className="text-xs">
                              Target Models / LoRA Adapters
                            </TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {inferenceModels.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={6}
                                className="text-center text-xs text-muted-foreground py-6"
                              >
                                No InferenceModel resources found in this
                                cluster.
                              </TableCell>
                            </TableRow>
                          ) : (
                            inferenceModels.map((model) => {
                              const spec = (model.spec ?? {}) as Record<
                                string,
                                unknown
                              >;
                              const rules = Array.isArray(spec.rules)
                                ? (spec.rules as Array<Record<string, unknown>>)
                                : [];
                              const firstRule = rules[0] ?? {};
                              const matches = Array.isArray(firstRule.matches)
                                ? (firstRule.matches as Array<
                                    Record<string, unknown>
                                  >)
                                : [];
                              const matchModelVal = (
                                matches[0]?.model as Record<string, unknown>
                              )?.value as string | undefined;
                              const ruleTargets = Array.isArray(
                                firstRule.targets,
                              )
                                ? (firstRule.targets as Array<
                                    Record<string, unknown>
                                  >)
                                : [];
                              const poolRef =
                                ((spec.poolRef as Record<string, unknown>)
                                  ?.name as string) ?? "llm-inference-pool";
                              const targets = Array.isArray(spec.targetModels)
                                ? (
                                    spec.targetModels as Array<
                                      Record<string, unknown>
                                    >
                                  )
                                    .map(
                                      (t) =>
                                        `${String(t.name ?? "adapter")} (${String(t.weight ?? 100)}%)`,
                                    )
                                    .join(", ")
                                : ruleTargets.length > 0
                                  ? ruleTargets
                                      .map(
                                        (t) =>
                                          `${String(t.modelRewrite ?? t.name ?? "adapter")} (${String(t.weight ?? 100)}%)`,
                                      )
                                      .join(", ")
                                  : "Primary base model (100%)";
                              const modelDisplayName = String(
                                spec.modelName ??
                                  matchModelVal ??
                                  model.metadata?.name ??
                                  "—",
                              );
                              return (
                                <TableRow
                                  key={
                                    model.metadata?.uid ?? model.metadata?.name
                                  }
                                >
                                  <TableCell className="text-xs font-mono font-medium">
                                    {model.metadata?.name}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    {modelDisplayName}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    {poolRef}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <Badge
                                      variant="outline"
                                      className="text-2xs"
                                    >
                                      {String(spec.criticality ?? "Critical")}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs font-mono text-muted-foreground">
                                    {targets}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="default"
                                      className="text-2xs"
                                    >
                                      Ready
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </SectionCard>

                    <F5AIAnalyzerViewer clusterId={scopedClusterId} />
                  </>
                )}

                {activeViewKey === "policies" && (
                  <>
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
                      title="EPP Scoring Weights & Queue Policies"
                      description="Queue depth thresholds, KV-cache affinity, prefix-cache scoring weights, block size, and routing mode configuration"
                      action={
                        <Badge variant="outline" className="text-xs">
                          {eppResources.length} EPP policies
                        </Badge>
                      }
                      compact
                    >
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">EPP Name</TableHead>
                            <TableHead className="text-xs">Namespace</TableHead>
                            <TableHead className="text-xs">
                              Routing Mode
                            </TableHead>
                            <TableHead className="text-xs">Engine</TableHead>
                            <TableHead className="text-xs">
                              Block Size
                            </TableHead>
                            <TableHead className="text-xs">Pool Ref</TableHead>
                            <TableHead className="text-xs">
                              Scoring Policy
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {eppResources.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={7}
                                className="text-center text-xs text-muted-foreground py-6"
                              >
                                No F5EPP scoring policy resources found in this
                                cluster. Default KV-cache, queue-depth, and
                                prefix-affinity weights are active.
                              </TableCell>
                            </TableRow>
                          ) : (
                            eppResources.map((epp) => {
                              const spec = (epp.spec ?? {}) as Record<
                                string,
                                unknown
                              >;
                              const poolRef =
                                typeof spec.poolRef === "string"
                                  ? spec.poolRef
                                  : (((spec.poolRef as Record<string, unknown>)
                                      ?.name as string) ?? "—");
                              return (
                                <TableRow
                                  key={epp.metadata?.uid ?? epp.metadata?.name}
                                >
                                  <TableCell className="text-xs font-mono font-medium">
                                    {epp.metadata?.name}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    {epp.metadata?.namespace ?? "default"}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <Badge
                                      variant="secondary"
                                      className="text-2xs capitalize"
                                    >
                                      {String(spec.mode ?? "kv-cache-aware")}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    {String(spec.engine ?? "vllm")}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    {String(spec.blockSize ?? 16)}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    {poolRef}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    Queue Depth + KV-Cache Affinity + Prefix
                                    Cache
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </SectionCard>

                    <SectionCard
                      title="TMM Data-Plane & Infrastructure Readiness"
                      description="Automated verification and 1-click remediation for TMM data-plane, DNS resolution, egress routing, and multi-NUMA spanning"
                      compact
                    >
                      <div className="space-y-3 pt-1">
                        {(govOverview?.diagnostics ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground py-4 text-center">
                            No TMM data-plane readiness checks reported for this
                            cluster.
                          </p>
                        ) : (
                          (govOverview?.diagnostics ?? []).map((d) => (
                            <div
                              key={d.id}
                              className="p-3 rounded-lg border border-border bg-card flex flex-wrap items-start justify-between gap-4"
                            >
                              <div className="space-y-1 max-w-3xl">
                                <div className="flex items-center gap-2">
                                  {d.status === "healthy" ? (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                                  ) : (
                                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                                  )}
                                  <span className="text-xs font-semibold text-foreground">
                                    {d.title}
                                  </span>
                                  <Badge variant="outline" className="text-2xs">
                                    {d.category}
                                  </Badge>
                                  <Badge
                                    variant={
                                      d.status === "healthy"
                                        ? "default"
                                        : "secondary"
                                    }
                                    className="text-2xs"
                                  >
                                    {d.status}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {d.summary}
                                </p>
                              </div>
                              {d.remediation_action && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1.5"
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

                    <F5AIAnalyzerViewer clusterId={scopedClusterId} />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ResourceDescribeViewer
        resource={describeResource}
        open={describeOpen}
        onOpenChange={setDescribeOpen}
        clusterId={scopedClusterId}
      />
    </div>
  );
}
