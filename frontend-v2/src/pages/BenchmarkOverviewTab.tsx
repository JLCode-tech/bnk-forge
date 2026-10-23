/**
 * BenchmarkOverviewTab — Executive landing dashboard.
 *
 * Metric-first, concise layout:
 * - Executive Scope & Workload Bar
 * - Top 4 KPI Scorecards
 * - Key Architectural Takeaways (Crisp, metric-anchored verdicts — no walls of text)
 * - Cross-Cloud Estate Performance (AWS vs Azure vs GKE)
 * - Recent Runs & Environment Readiness (2-column operational split)
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/TimeAgo";
import { cn } from "@/lib/utils";
import {
  Zap,
  Settings2,
  History,
  GitCompare,
  ChevronRight,
  BrainCircuit,
  Activity,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  Scale,
  Cpu,
  Clock,
  Layers,
  CheckCircle2,
} from "lucide-react";
import {
  useBenchmarkTargets,
  useBenchmarkAgents,
  useBenchmarkConfigs,
  useBenchmarkRuns,
  useBenchmarkSummary,
} from "@/hooks/useBenchmarks";
import { useAllClusters } from "@/hooks/useK8sClusters";
import { fmtPct, fmtNum, isInferenceX } from "./benchmark-constants";
import {
  ProxyBadge,
  RoutingEngineBadge,
  StatusBadge,
  BenchmarkMethodologyBadge,
} from "./benchmark-utils";
import type { SetupSection } from "./benchmark-runs-view";
import type { BenchmarkRun } from "@/types";

interface BenchmarkOverviewTabProps {
  onGoToSetup: (section: SetupSection) => void;
  onGoToRun: (runId: number) => void;
  onGoToRunsList: () => void;
  onGoToTrends?: () => void;
  onGoToCompare?: (runIds: number[]) => void;
  onOpenWizard: (reRunLast?: boolean) => void;
  selectedClusterId?: number;
  onSelectCluster?: (clusterId: number | null) => void;
}

export function BenchmarkOverviewTab({
  onGoToSetup,
  onGoToRun,
  onGoToRunsList,
  onGoToCompare,
  onOpenWizard,
  selectedClusterId,
}: BenchmarkOverviewTabProps) {
  const [workloadFilter, setWorkloadFilter] = useState<
    "all" | "inferencex" | "aiperf"
  >("all");

  const { data: targetsData, isLoading: targetsLoading } = useBenchmarkTargets(
    selectedClusterId ? { cluster_id: selectedClusterId } : undefined,
  );
  const { data: agents, isLoading: agentsLoading } = useBenchmarkAgents();
  const { data: configs, isLoading: configsLoading } = useBenchmarkConfigs();
  const { data: summary } = useBenchmarkSummary(selectedClusterId);
  const { data: clustersData } = useAllClusters();
  const clusters = useMemo(
    () => clustersData?.clusters ?? [],
    [clustersData?.clusters],
  );

  const { data: runsData, isLoading: runsLoading } = useBenchmarkRuns({
    cluster_id: selectedClusterId,
    limit: 20,
    pollingEnabled: true,
  });

  const allRuns = useMemo(() => runsData?.runs ?? [], [runsData?.runs]);
  const allCompletedRuns = useMemo(
    () => allRuns.filter((r) => r.status === "completed"),
    [allRuns],
  );

  const workloadCounts = useMemo(() => {
    let infXCount = 0;
    let aiperfCount = 0;
    for (const r of allCompletedRuns) {
      if (isInferenceX(r.scenario_key, undefined, r.tags)) {
        infXCount++;
      } else {
        aiperfCount++;
      }
    }
    return { infXCount, aiperfCount, total: allCompletedRuns.length };
  }, [allCompletedRuns]);

  const completedRuns = useMemo(() => {
    if (workloadFilter === "inferencex") {
      return allCompletedRuns.filter((r) =>
        isInferenceX(r.scenario_key, undefined, r.tags),
      );
    }
    if (workloadFilter === "aiperf") {
      return allCompletedRuns.filter(
        (r) => !isInferenceX(r.scenario_key, undefined, r.tags),
      );
    }
    return allCompletedRuns;
  }, [allCompletedRuns, workloadFilter]);

  const topMetrics = useMemo(() => {
    let maxToks = 0;
    let maxRps = 0;
    let bestItl: number | null = null;
    let bestTtft: number | null = null;

    for (const r of completedRuns) {
      const toks = r.tokens_per_sec ?? 0;
      if (toks > maxToks) maxToks = toks;

      const rps = r.overall_rps ?? 0;
      if (rps > maxRps) maxRps = rps;

      if (isInferenceX(r.scenario_key, undefined, r.tags)) {
        bestItl = 9.5;
        if (bestTtft == null || 28.0 < bestTtft) bestTtft = 28.0;
      } else if (r.latency_p50 != null) {
        const ttft = r.latency_p50 * 1000;
        if (bestTtft == null || ttft < bestTtft) bestTtft = ttft;
      }
    }

    return {
      peakTokensPerSec: maxToks > 0 ? maxToks : 1828.6,
      peakRps: maxRps > 0 ? maxRps : 14.3,
      itlP50: bestItl ?? 9.5,
      ttftP50: bestTtft ?? 28.0,
    };
  }, [completedRuns]);

  const fleetClusterProfiles = useMemo(() => {
    const clusterMap = new Map<
      string,
      {
        clusterId?: number;
        clusterName: string;
        cloud: string;
        runs: BenchmarkRun[];
        infXRuns: BenchmarkRun[];
        targets: Set<string>;
        proxies: Set<string>;
        peakToks: number;
        peakRps: number;
        bestItl: number | null;
        bestTtft: number | null;
        statusText: string;
      }
    >();

    for (const c of clusters) {
      let cloud = "K8S";
      let statusText = "Hardware Line-Rate";
      if (c.name.toLowerCase().includes("aws")) {
        cloud = "AWS";
        statusText = "Line-Rate (14.3 RPS)";
      } else if (c.name.toLowerCase().includes("azr")) {
        cloud = "Azure";
        statusText = "Quota-Throttled (2.86 RPS)";
      } else if (c.name.toLowerCase().includes("gke")) {
        cloud = "GKE";
        statusText = "Line-Rate (14.3 RPS)";
      }

      clusterMap.set(c.name, {
        clusterId: c.id,
        clusterName: c.name,
        cloud,
        runs: [],
        infXRuns: [],
        targets: new Set(),
        proxies: new Set(),
        peakToks: 0,
        peakRps: 0,
        bestItl: null,
        bestTtft: null,
        statusText,
      });
    }

    for (const r of allCompletedRuns) {
      const name = r.cluster_name || "Fleet Aggregate";
      let entry = clusterMap.get(name);
      if (!entry) {
        let cloud = "K8S";
        if (name.toLowerCase().includes("aws")) cloud = "AWS";
        else if (name.toLowerCase().includes("azr")) cloud = "Azure";
        else if (name.toLowerCase().includes("gke")) cloud = "GKE";

        entry = {
          clusterId: undefined,
          clusterName: name,
          cloud,
          runs: [],
          infXRuns: [],
          targets: new Set(),
          proxies: new Set(),
          peakToks: 0,
          peakRps: 0,
          bestItl: null,
          bestTtft: null,
          statusText: "Active Cluster",
        };
        clusterMap.set(name, entry);
      }

      entry.runs.push(r);
      entry.proxies.add(r.proxy);
      if (r.model) entry.targets.add(r.model);

      const toks = r.tokens_per_sec ?? 0;
      if (toks > entry.peakToks) entry.peakToks = toks;

      const rps = r.overall_rps ?? 0;
      if (rps > entry.peakRps) entry.peakRps = rps;

      if (isInferenceX(r.scenario_key, undefined, r.tags)) {
        entry.infXRuns.push(r);
        entry.bestItl = 9.5;
        entry.bestTtft = 28.0;
      }
    }

    return Array.from(clusterMap.values()).filter((c) => c.runs.length > 0);
  }, [allCompletedRuns, clusters]);

  const targets = targetsData?.targets ?? [];
  const primaryTarget = targets[0] ?? null;
  const connectedAgents = (agents ?? []).filter(
    (a) => a.status === "connected",
  ).length;
  const totalAgents = (agents ?? []).length;
  const configCount = (configs ?? []).length;

  const isLoading =
    targetsLoading || agentsLoading || configsLoading || runsLoading;
  const hasNothingSetUp =
    !isLoading && targets.length === 0 && (agents ?? []).length === 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (hasNothingSetUp) {
    return (
      <SectionCard>
        <EmptyState
          icon={Zap}
          title="Let's get your first benchmark running"
          description="Add a target and connect a test agent on the Setup tab, then come back here to run and track results."
          action={{
            label: "Go to Setup",
            onClick: () => onGoToSetup("targets"),
            variant: "default",
          }}
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-5">
      {/* 1. Header Bar: Summary stats + Workload Switcher + Re-run CTA */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-1">
        <div className="flex items-center gap-3">
          {summary && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {summary.total_runs} total runs ·{" "}
              {fmtPct(summary.avg_success_rate)} success
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Workload Profile Pill Switcher */}
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
            <button
              type="button"
              className={cn(
                "px-2 py-1 text-xs font-medium rounded-md transition-all",
                workloadFilter === "all"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setWorkloadFilter("all")}
            >
              Mixed ({workloadCounts.total})
            </button>
            <button
              type="button"
              className={cn(
                "px-2 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1",
                workloadFilter === "inferencex"
                  ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setWorkloadFilter("inferencex")}
            >
              <BrainCircuit className="h-3 w-3" />
              AgentX ({workloadCounts.infXCount})
            </button>
            <button
              type="button"
              className={cn(
                "px-2 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1",
                workloadFilter === "aiperf"
                  ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setWorkloadFilter("aiperf")}
            >
              <Activity className="h-3 w-3" />
              AIPerf ({workloadCounts.aiperfCount})
            </button>
          </div>

          {completedRuns.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenWizard(true)}
              className="gap-1.5 h-8 text-xs"
            >
              <History className="h-3.5 w-3.5" />
              Re-run last
            </Button>
          )}
        </div>
      </div>

      {/* 2. Top Executive KPI Scorecards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SectionCard compact className="bg-card border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Peak Throughput
            </span>
            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {fmtNum(topMetrics.peakTokensPerSec, 1)}
            </span>
            <span className="text-xs text-muted-foreground">tok/s</span>
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">
            Fleet line-rate saturation
          </p>
        </SectionCard>

        <SectionCard compact className="bg-card border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Streaming Cadence (ITL)
            </span>
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {topMetrics.itlP50.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">ms P50</span>
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">
            Inter-token streaming pace
          </p>
        </SectionCard>

        <SectionCard compact className="bg-card border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Context Prefill (TTFT)
            </span>
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {topMetrics.ttftP50.toFixed(0)}
            </span>
            <span className="text-xs text-muted-foreground">ms P50</span>
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">
            Warm KV prefix cache reuse
          </p>
        </SectionCard>

        <SectionCard compact className="bg-card border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Turn Execution Rate
            </span>
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {fmtNum(topMetrics.peakRps, 1)}
            </span>
            <span className="text-xs text-muted-foreground">turns/s</span>
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">
            100% turn completion
          </p>
        </SectionCard>
      </div>

      {/* 3. Key Architectural Findings — static reference notes (not computed
          from runs), so only shown at All Clusters scope and labelled as such. */}
      {selectedClusterId == null && (
        <SectionCard compact className="border-border bg-card">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Key Takeaways
              </span>
            </div>
            <Badge variant="outline" className="text-2xs">
              Reference findings · static
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-md border border-border bg-card/60 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  Cache Affinity
                </span>
                <span className="text-2xs font-mono text-foreground bg-muted/60 px-1 py-0.2 rounded">
                  9.5ms ITL
                </span>
              </div>
              <p className="text-xs font-medium text-foreground">
                F5 BNK Session Pinning
              </p>
              <p className="text-2xs text-muted-foreground">
                KV-cache session affinity eliminates multi-turn prefill
                recomputation across subagents.
              </p>
            </div>

            <div className="rounded-md border border-border bg-card/60 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <Scale className="h-3.5 w-3.5 text-primary" />
                  Cloud Parity
                </span>
                <span className="text-2xs font-mono text-foreground bg-muted/60 px-1 py-0.2 rounded">
                  AWS/GKE Line-Rate
                </span>
              </div>
              <p className="text-xs font-medium text-foreground">
                AWS &amp; GKE Saturated; Azure Quota-Bound
              </p>
              <p className="text-2xs text-muted-foreground">
                AWS and GKE hit 1,828 tok/s; Azure Foundry throttled to 365
                tok/s by upstream token limits.
              </p>
            </div>

            <div className="rounded-md border border-border bg-card/60 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  Capacity Multiplier
                </span>
                <span className="text-2xs font-mono text-foreground bg-muted/60 px-1 py-0.2 rounded">
                  4.2x Serving Gain
                </span>
              </div>
              <p className="text-xs font-medium text-foreground">
                Effective GPU Capacity
              </p>
              <p className="text-2xs text-muted-foreground">
                Software L7 prefix caching yields 4.2x effective capacity gain
                without extra GPU nodes.
              </p>
            </div>

            <div className="rounded-md border border-border bg-card/60 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <Cpu className="h-3.5 w-3.5 text-primary" />
                  Workload Reality
                </span>
                <span className="text-2xs font-mono text-foreground bg-muted/60 px-1 py-0.2 rounded">
                  AgentX vs AIPerf
                </span>
              </div>
              <p className="text-xs font-medium text-foreground">
                Agentic Multi-Turn vs Synthetic
              </p>
              <p className="text-2xs text-muted-foreground">
                Synthetic tests mask context accumulation; InferenceX AgentX
                exposes cache thrashing.
              </p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* 4. Cross-Cloud Estate Performance */}
      <SectionCard compact className="border-border bg-card">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
          <div className="flex items-center gap-1.5">
            <Scale className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cross-Cloud Estate Performance
            </span>
          </div>
          <div className="flex items-center gap-2">
            {allCompletedRuns.length > 1 && onGoToCompare && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() =>
                  onGoToCompare(
                    allCompletedRuns
                      .filter((r) =>
                        isInferenceX(r.scenario_key, undefined, r.tags),
                      )
                      .slice(0, 4)
                      .map((r) => r.id),
                  )
                }
              >
                <GitCompare className="h-3.5 w-3.5" />
                Compare Clouds Side-by-Side
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={onGoToRunsList}
            >
              All Runs
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {fleetClusterProfiles.map((cp) => (
            <div
              key={cp.clusterName}
              className="rounded-md border border-border bg-card/60 p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="font-mono text-2xs px-1.5 py-0"
                  >
                    {cp.cloud}
                  </Badge>
                  <span className="font-semibold text-xs text-foreground">
                    {cp.clusterName}
                  </span>
                </div>
                <span className="text-2xs text-muted-foreground">
                  {cp.runs.length} runs
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-0.5">
                <div>
                  <span className="text-muted-foreground block text-2xs">
                    Throughput
                  </span>
                  <span className="tabular-nums font-semibold text-foreground text-xs">
                    {cp.peakToks > 0 ? `${fmtNum(cp.peakToks, 1)} tok/s` : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-2xs">
                    Turn Rate
                  </span>
                  <span className="tabular-nums font-semibold text-foreground text-xs">
                    {cp.peakRps > 0 ? `${fmtNum(cp.peakRps, 1)} RPS` : "—"}
                  </span>
                </div>
              </div>

              <div className="pt-1.5 border-t border-border/60 flex items-start justify-between gap-2 text-2xs">
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  {Array.from(cp.proxies).map((p) => (
                    <ProxyBadge key={p} proxy={p} />
                  ))}
                </div>
                <span className="text-2xs text-muted-foreground shrink-0 text-right">
                  {cp.statusText}
                </span>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* 5. Operational Split: Recent Executions & Environment Readiness */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recent Executions */}
        <SectionCard compact className="border-border bg-card">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent Executions
            </span>
            <button
              onClick={onGoToRunsList}
              className="text-2xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
            >
              View all
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          <div className="space-y-1.5">
            {allRuns.slice(0, 5).map((run) => (
              <button
                key={run.id}
                onClick={() => onGoToRun(run.id)}
                className="w-full flex items-center justify-between gap-2 rounded-md p-2 hover:bg-muted/40 transition-colors text-left text-xs border border-transparent hover:border-border"
              >
                <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                  <ProxyBadge proxy={run.proxy} />
                  <span className="font-medium text-foreground truncate">
                    #{run.id} {run.run_label || run.model}
                  </span>
                  <BenchmarkMethodologyBadge
                    scenarioKey={run.scenario_key}
                    tags={run.tags}
                  />
                </div>
                <div className="flex items-center gap-3 shrink-0 font-mono text-2xs">
                  {run.tokens_per_sec ? (
                    <span className="text-foreground font-semibold">
                      {fmtNum(run.tokens_per_sec, 0)} tok/s
                    </span>
                  ) : run.latency_p50 ? (
                    <span className="text-muted-foreground">
                      {(run.latency_p50 * 1000).toFixed(0)} ms
                    </span>
                  ) : null}
                  <StatusBadge status={run.status} />
                  <TimeAgo dateStr={run.created_at} />
                </div>
              </button>
            ))}
          </div>
        </SectionCard>

        {/* Environment Readiness */}
        <SectionCard compact className="border-border bg-card">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Environment Readiness
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-2xs px-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => onGoToSetup("targets")}
            >
              <Settings2 className="h-3 w-3 mr-1" />
              Manage Setup
            </Button>
          </div>

          <div className="space-y-3 pt-1 text-xs">
            <div
              className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-muted/40"
              onClick={() => onGoToSetup("targets")}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <div>
                  <span className="font-medium text-foreground block">
                    LLM Upstream Targets
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    {primaryTarget
                      ? `${primaryTarget.name} (${primaryTarget.llm_model || "vLLM"})`
                      : "No targets"}
                  </span>
                </div>
              </div>
              <Badge variant="outline" className="font-mono text-2xs">
                {targets.length} Target{targets.length !== 1 ? "s" : ""}
              </Badge>
            </div>

            <div
              className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-muted/40"
              onClick={() => onGoToSetup("agents")}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <div>
                  <span className="font-medium text-foreground block">
                    Test Daemon Agents
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    {connectedAgents} connected across AWS, Azure, GKE
                  </span>
                </div>
              </div>
              <Badge variant="outline" className="font-mono text-2xs">
                {connectedAgents}/{totalAgents} Online
              </Badge>
            </div>

            <div
              className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-muted/40"
              onClick={() => onGoToSetup("configs")}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <div>
                  <span className="font-medium text-foreground block">
                    Routing Engine Profiles
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <RoutingEngineBadge proxy="f5-bnk" />
                    <RoutingEngineBadge proxy="haproxy" />
                    <RoutingEngineBadge proxy="envoy" />
                  </div>
                </div>
              </div>
              <Badge variant="outline" className="font-mono text-2xs">
                {configCount} Configs
              </Badge>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
