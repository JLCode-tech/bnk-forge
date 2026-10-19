import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
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
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/observability/StatTile";
import { ErrorState } from "@/components/ui/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClusterPicker } from "@/components/observability/pickers";
import { F5AIAnalyzerViewer } from "@/components/k8s/F5AIAnalyzerViewer";
import { useAllClusters } from "@/hooks/useK8sClusters";
import { useLlmStats } from "@/hooks/useLlmObservability";
import { useClusterScope } from "@/hooks/useClusterScope";
import { cn } from "@/lib/utils";
import { ClusterRouterRow } from "./ClusterRouterRow";
import {
  Table,
  TableBody,
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

  useEffect(() => {
    if (urlView) {
      setSelectedSubView(urlView);
      if (urlView === "overview") {
        if (selectedClusterId !== null) {
          setSelectedClusterId(null);
        }
      } else if (selectedClusterId === null && clusters.length > 0) {
        setSelectedClusterId(clusters[0].id);
      }
    }
  }, [urlView, clusters, selectedClusterId, setSelectedClusterId]);

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
    { range: "24h" },
  );
  const live = llmStats?.available ? llmStats : undefined;
  const pending = statsLoading ? "…" : "—";

  const activeCluster = clusters.find((c) => c.id === selectedClusterId);

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
                subtext="Past 24 hours"
              />
              <StatTile
                label="Success Rate"
                value={
                  live ? `${(live.success_rate * 100).toFixed(1)}%` : pending
                }
                icon={Layers}
                tone="primary"
                loading={statsLoading}
                subtext="Past 24 hours"
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
                description="Gateway telemetry per cluster, last 24h. Select one to inspect its Intelligent Inference router."
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
                        `Cluster ${selectedClusterId ?? 1}`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      · F5 AI Analyzer and EPP telemetry
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
                <F5AIAnalyzerViewer
                  clusterId={selectedClusterId ?? clusters[0]?.id ?? 1}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
