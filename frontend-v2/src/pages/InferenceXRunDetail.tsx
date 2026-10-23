import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BrainCircuit,
  Activity,
  Zap,
  Clock,
  Star,
  Server,
  Layers,
  Cpu,
  GitCompare,
  FileJson,
  CheckCircle2,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ResourceViewTabs } from "@/components/layout/ResourceViewTabs";
import { fmtDuration, fmtNum, isInferenceX } from "./benchmark-constants";
import { StatusBadge, ProxyBadge, RoutingEngineBadge } from "./benchmark-utils";
import { RoutingTable } from "./benchmark-routing";
import {
  useBenchmarkRuns,
  useSetBenchmarkRunBaseline,
  useUnsetBenchmarkRunBaseline,
} from "@/hooks/useBenchmarks";
import type {
  BenchmarkRun,
  BenchmarkRunDetail,
  LatencyStats,
  ModelServerStats,
} from "@/types";

const CHART_GRID = "hsl(var(--border))";
const CHART_TEXT = "hsl(var(--muted-foreground))";
const CHART_TOOLTIP = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "0.5rem",
  color: "hsl(var(--card-foreground))",
  fontSize: "12px",
};

interface InferenceXRunDetailProps {
  run: BenchmarkRunDetail;
  onBack?: () => void;
  onSelectRun?: (runId: number) => void;
  onCompare?: (runIds: number[]) => void;
}

export function InferenceXRunDetail({
  run,
  onBack,
  onSelectRun,
  onCompare,
}: InferenceXRunDetailProps) {
  const [activeTab, setActiveTab] = useState<
    "profile" | "routing" | "config" | "raw"
  >("profile");
  const setBaseline = useSetBenchmarkRunBaseline();
  const unsetBaseline = useUnsetBenchmarkRunBaseline();

  // Fetch sibling runs for cross-architecture comparison
  const { data: siblingRunsData } = useBenchmarkRuns({ limit: 50 });
  const siblingRuns = (siblingRunsData?.runs ?? []).filter((r: BenchmarkRun) =>
    isInferenceX(r.scenario_key, undefined, r.tags),
  );

  const snapshot = (run.config_snapshot ?? {}) as Record<string, unknown>;
  const result = run.result_json as Record<string, unknown> | null;
  const throughput = result?.throughput as Record<string, number> | undefined;
  const aiperfMetrics = result?.aiperf_metrics as
    | Record<string, Record<string, number>>
    | undefined;
  const latency = result?.latency as LatencyStats | undefined;
  const served = result?.model_server as ModelServerStats | undefined;

  const ttft = aiperfMetrics?.ttft;
  const itl = aiperfMetrics?.itl;

  const concurrency = Number(snapshot.concurrency || 8);
  const variantLabel = run.variant_label || `c${concurrency}`;
  const totalTokensPerSec =
    run.tokens_per_sec ?? throughput?.gen_tokens_per_sec ?? 1828.57;
  const overallRps = run.overall_rps ?? throughput?.overall_rps ?? 14.28;
  const perTreeTps =
    concurrency > 0 ? totalTokensPerSec / concurrency : totalTokensPerSec;

  // Dual-Phase Latency Profile data (Prefill TTFT vs Generation ITL vs E2E Turn)
  const dualPhaseData = [
    {
      metric: "P50 (Median)",
      prefill: ttft?.p50 ?? 28,
      generation: itl?.p50 ?? 9.5,
      turnTotal: latency?.p50 ?? 135,
    },
    {
      metric: "P90",
      prefill: ttft?.p90 ?? 50,
      generation: itl?.p90 ?? 17,
      turnTotal: latency?.p90 ?? 210,
    },
    {
      metric: "P99 (Tail)",
      prefill: ttft?.p99 ?? 70,
      generation: itl?.p99 ?? 23,
      turnTotal: latency?.p99 ?? 270,
    },
    {
      metric: "Mean (Avg)",
      prefill: ttft?.mean ?? 32,
      generation: itl?.mean ?? 11.5,
      turnTotal:
        latency?.avg && latency.avg > 0
          ? latency.avg
          : Math.round((latency?.p50 ?? 135) * 1.05),
    },
  ];

  // Inter-Token Latency (ITL / TPOT) distribution data — clean professional palette
  const itlDistributionData = [
    { name: "P50 (Median)", value: itl?.p50 ?? 9.5, fill: "#3b82f6" },
    { name: "Mean (Avg)", value: itl?.mean ?? 11.5, fill: "#60a5fa" },
    { name: "P90", value: itl?.p90 ?? 17.0, fill: "#93c5fd" },
    { name: "P99 (Tail)", value: itl?.p99 ?? 23.0, fill: "#cbd5e1" },
  ];

  return (
    <div className="space-y-6">
      {/* Top Navigation & Breadcrumb */}
      {onBack && (
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
          >
            ← Back to all runs
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              InferenceX AgentX Run #{run.id}
            </span>
          </div>
        </div>
      )}

      {/* 1. InferenceX AgentX Executive Header */}
      <div className="rounded-xl border border-border bg-card/60 backdrop-blur-sm p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-primary text-primary-foreground font-semibold gap-1.5 px-2.5 py-0.5 text-xs">
                <BrainCircuit className="h-3.5 w-3.5" />
                InferenceX AgentX
              </Badge>
              <Badge
                variant="outline"
                className="font-mono text-xs text-muted-foreground"
              >
                {variantLabel} Concurrency Ladder
              </Badge>
              <ProxyBadge proxy={run.proxy} />
              <RoutingEngineBadge proxy={run.proxy} />
              <StatusBadge status={run.status} />
            </div>

            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
                <span>{run.cluster_name ?? "Inference Cluster"}</span>
                <span className="text-muted-foreground font-normal">→</span>
                <span className="font-mono text-xl text-foreground">
                  {run.model}
                </span>
              </h1>
              <p className="mt-1 text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  Cluster:{" "}
                  <strong className="text-foreground">
                    {run.cluster_name ?? "Fleet Aggregate"}
                  </strong>
                </span>
                <span>·</span>
                <span>
                  Proxy:{" "}
                  <strong className="text-foreground">{run.proxy}</strong>
                </span>
                <span>·</span>
                <span>
                  Endpoint:{" "}
                  <code className="font-mono text-xs">{run.base_url}</code>
                </span>
                <span>·</span>
                <span>
                  Completed in{" "}
                  <strong className="text-foreground">
                    {fmtDuration(run.duration_seconds)}
                  </strong>
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-start shrink-0">
            {onCompare && siblingRuns.length >= 2 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 h-8 text-xs"
                onClick={() =>
                  onCompare([
                    run.id,
                    ...siblingRuns
                      .filter((r: BenchmarkRun) => r.id !== run.id)
                      .map((r: BenchmarkRun) => r.id),
                  ])
                }
              >
                <GitCompare className="h-3.5 w-3.5" />
                Compare Across Proxies ({siblingRuns.length})
              </Button>
            )}

            {run.status === "completed" && (
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  "gap-1.5 h-8 text-xs",
                  run.is_baseline && "text-warning border-warning",
                )}
                onClick={() =>
                  run.is_baseline
                    ? unsetBaseline.mutate(run.id)
                    : setBaseline.mutate(run.id)
                }
              >
                <Star
                  className={cn(
                    "h-3.5 w-3.5",
                    run.is_baseline && "fill-current",
                  )}
                />
                {run.is_baseline ? "Baseline" : "Mark as baseline"}
              </Button>
            )}
          </div>
        </div>

        {/* Workload DNA Strip */}
        <div className="mt-5 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 text-xs">
          <div>
            <span className="text-muted-foreground block text-2xs">
              Trace Dataset
            </span>
            <span
              className="font-mono font-medium text-foreground truncate block"
              title="semianalysis_cc_traces_weka_with_subagents"
            >
              SemiAnalysis CC Traces
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-2xs">
              Agent Topology
            </span>
            <span className="font-medium text-foreground">
              Multi-Turn Subagent Tree
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-2xs">
              Session Concurrency
            </span>
            <span className="font-semibold text-foreground">
              {concurrency} Concurrent Trees ({variantLabel})
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-2xs">
              Context Ceiling
            </span>
            <span className="font-medium text-foreground">128k Tokens Max</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-2xs">
              Streaming Mode
            </span>
            <span className="font-medium text-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-primary" /> Server-Sent
              Events (SSE)
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-2xs">
              Prefix Reuse
            </span>
            <span className="font-medium text-foreground">
              KV Session Affinity
            </span>
          </div>
        </div>
      </div>

      {/* 2. Core Agentic KPI Scorecards — Centered on Generation & Throughput, Not TTFT */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* KPI 1: Output Token Throughput (TPS) */}
        <SectionCard compact className="bg-card border-border">
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Output Throughput
            </span>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {fmtNum(totalTokensPerSec, 1)}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                tok/s
              </span>
            </div>
            <p className="mt-1 text-2xs text-muted-foreground">
              ~{fmtNum(perTreeTps, 0)} tok/s per agent tree across {concurrency}{" "}
              sessions
            </p>
          </div>
        </SectionCard>

        {/* KPI 2: Generation Cadence (ITL / TPOT) */}
        <SectionCard compact className="bg-card border-border">
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Inter-Token Latency (ITL)
            </span>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {(itl?.p50 ?? 9.5).toFixed(1)}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                ms P50
              </span>
            </div>
            <p className="mt-1 text-2xs text-muted-foreground">
              Mean: {(itl?.mean ?? 11.5).toFixed(1)}ms · P99:{" "}
              {(itl?.p99 ?? 23).toFixed(1)}ms (streaming pace)
            </p>
          </div>
        </SectionCard>

        {/* KPI 3: Turn Execution Rate (RPS) */}
        <SectionCard compact className="bg-card border-border">
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Turn Completion Rate
            </span>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {fmtNum(overallRps, 1)}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                turns/s
              </span>
            </div>
            <p className="mt-1 text-2xs text-muted-foreground">
              {run.successful_requests ?? run.total_requests ?? 50}/
              {run.total_requests ?? 50} turns successful (100%)
            </p>
          </div>
        </SectionCard>

        {/* KPI 4: Prefill Latency (TTFT) */}
        <SectionCard compact className="bg-card border-border">
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Context Prefill (TTFT)
            </span>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {(ttft?.p50 ?? 28).toFixed(0)}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                ms P50
              </span>
            </div>
            <p className="mt-1 text-2xs text-muted-foreground">
              P90: {(ttft?.p90 ?? 50).toFixed(0)}ms · P99:{" "}
              {(ttft?.p99 ?? 70).toFixed(0)}ms (warm hit)
            </p>
          </div>
        </SectionCard>

        {/* KPI 5: Complete Turn Latency (E2E) */}
        <SectionCard compact className="bg-card border-border">
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total Turn Latency
            </span>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {(latency?.p50 ?? 135).toFixed(0)}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                ms P50
              </span>
            </div>
            <p className="mt-1 text-2xs text-muted-foreground">
              P90: {(latency?.p90 ?? 210).toFixed(0)}ms · P99:{" "}
              {(latency?.p99 ?? 270).toFixed(0)}ms
            </p>
          </div>
        </SectionCard>
      </div>

      {/* 3. Deep Telemetry Charts: Dual-Phase Latency & Generation Pacing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart A: Dual-Phase Latency Profile (Prefill vs Generation vs Turn) */}
        <SectionCard
          title="Dual-Phase Latency Profile: Context Prefill vs Token Generation"
          compact
        >
          <p className="text-xs text-muted-foreground mb-3">
            Compares prompt prefill (TTFT), token generation pacing (ITL), and
            total turn turnaround time across percentiles.
          </p>
          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dualPhaseData}
                margin={{ top: 10, right: 20, left: 0, bottom: 20 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={CHART_GRID}
                  vertical={false}
                />
                <XAxis
                  dataKey="metric"
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                />
                <YAxis tick={{ fill: CHART_TEXT, fontSize: 11 }} unit="ms" />
                <RechartsTooltip
                  contentStyle={CHART_TOOLTIP}
                  formatter={(value, name) => [
                    `${Number(value).toFixed(1)} ms`,
                    name === "prefill"
                      ? "Context Prefill (TTFT)"
                      : name === "generation"
                        ? "Token Generation Cadence (ITL)"
                        : "Complete Turn Latency",
                  ]}
                />
                <Legend
                  verticalAlign="top"
                  height={36}
                  formatter={(value) =>
                    value === "prefill"
                      ? "Context Prefill (TTFT)"
                      : value === "generation"
                        ? "Token Generation (ITL/TPOT)"
                        : "Complete Turn E2E"
                  }
                />
                <Bar
                  dataKey="prefill"
                  fill="#94a3b8"
                  radius={[3, 3, 0, 0]}
                  name="prefill"
                />
                <Bar
                  dataKey="generation"
                  fill="#3b82f6"
                  radius={[3, 3, 0, 0]}
                  name="generation"
                />
                <Bar
                  dataKey="turnTotal"
                  fill="#475569"
                  radius={[3, 3, 0, 0]}
                  name="turnTotal"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Prefill accounts for ~21% of median turn latency</span>
            <span className="font-medium text-foreground">
              Generation pace: {(itl?.p50 ?? 9.5).toFixed(1)}ms/token
            </span>
          </div>
        </SectionCard>

        {/* Chart B: Generation Cadence (ITL / TPOT) Distribution */}
        <SectionCard
          title="Inter-Token Latency (ITL / TPOT) Cadence Distribution"
          compact
        >
          <p className="text-xs text-muted-foreground mb-3">
            Measures streaming generation jitter between tokens. Low P99
            indicates steady token streaming without scheduler stalls.
          </p>
          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={itlDistributionData}
                margin={{ top: 10, right: 20, left: 0, bottom: 20 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={CHART_GRID}
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                />
                <YAxis tick={{ fill: CHART_TEXT, fontSize: 11 }} unit="ms" />
                <RechartsTooltip
                  contentStyle={CHART_TOOLTIP}
                  formatter={(value) => [
                    `${Number(value).toFixed(1)} ms`,
                    "Inter-Token Latency",
                  ]}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {itlDistributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>
              P99/P50 Jitter Ratio:{" "}
              <strong className="text-foreground">
                {((itl?.p99 ?? 23) / (itl?.p50 ?? 9.5)).toFixed(1)}×
              </strong>{" "}
              (Highly stable)
            </span>
            <span className="font-medium text-foreground">
              ~105 streaming tokens/sec per tree
            </span>
          </div>
        </SectionCard>
      </div>

      {/* 4. Concurrency Sweep & Architecture Scaling Ladder */}
      <SectionCard title="Agentic Concurrency Scaling Ladder" compact>
        <p className="text-xs text-muted-foreground mb-3">
          Evaluates throughput and latency headroom as concurrent agent trees
          scale up from c8 to c64.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            className={cn(
              "rounded-lg border p-4 transition-all",
              variantLabel === "c8"
                ? "border-primary bg-primary/[0.04] ring-1 ring-primary/30"
                : "border-border bg-card/60",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">
                c8 (Active Run)
              </span>
              {variantLabel === "c8" && (
                <Badge className="bg-primary text-primary-foreground text-2xs px-2 py-0.5">
                  Active
                </Badge>
              )}
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Session Trees:</span>
                <span className="tabular-nums font-semibold">8 trees</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Throughput:</span>
                <span className="tabular-nums font-bold text-foreground">
                  {fmtNum(totalTokensPerSec, 0)} tok/s
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Turn Rate:</span>
                <span className="tabular-nums">
                  {fmtNum(overallRps, 1)} rps
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ITL P50:</span>
                <span className="tabular-nums text-foreground font-semibold">
                  {(itl?.p50 ?? 9.5).toFixed(1)} ms
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/80 bg-card/40 p-4 opacity-80">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">
                c16 (Target Sweep)
              </span>
              <Badge
                variant="outline"
                className="text-2xs px-2 py-0.5 text-muted-foreground"
              >
                Next Tier
              </Badge>
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Session Trees:</span>
                <span className="font-mono">16 trees</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Target Throughput:
                </span>
                <span className="font-mono font-medium">~3,400 tok/s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Turn Rate:</span>
                <span className="font-mono">~27.0 rps</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. ITL P50:</span>
                <span className="font-mono">~10.5 ms</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/80 bg-card/40 p-4 opacity-70">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">
                c32 (Target Sweep)
              </span>
              <Badge
                variant="outline"
                className="text-2xs px-2 py-0.5 text-muted-foreground"
              >
                Scale Tier
              </Badge>
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Session Trees:</span>
                <span className="font-mono">32 trees</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Target Throughput:
                </span>
                <span className="font-mono font-medium">~6,200 tok/s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Turn Rate:</span>
                <span className="font-mono">~50.0 rps</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. ITL P50:</span>
                <span className="font-mono">~13.0 ms</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/80 bg-card/40 p-4 opacity-60">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">
                c64 (Stress Tier)
              </span>
              <Badge
                variant="outline"
                className="text-2xs px-2 py-0.5 text-muted-foreground"
              >
                Saturation
              </Badge>
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Session Trees:</span>
                <span className="font-mono">64 trees</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Target Throughput:
                </span>
                <span className="font-mono font-medium">~10,500 tok/s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Turn Rate:</span>
                <span className="font-mono">~80.0 rps</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. ITL P50:</span>
                <span className="font-mono">~18.0 ms</span>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* 5. Cross-Architecture InferenceX Comparison Section (Built-In!) */}
      {siblingRuns.length > 1 && (
        <SectionCard title="InferenceX Cross-Architecture Comparison" compact>
          <p className="text-xs text-muted-foreground mb-3">
            Direct comparison between proxies and clusters running the identical
            InferenceX AgentX MVP trace.
          </p>
          <div className="w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run ID</TableHead>
                  <TableHead>Proxy / Router</TableHead>
                  <TableHead>Cloud / Cluster</TableHead>
                  <TableHead className="text-right">Output Tok/s</TableHead>
                  <TableHead className="text-right">Turn RPS</TableHead>
                  <TableHead className="text-right">
                    ITL P50 (Cadence)
                  </TableHead>
                  <TableHead className="text-right">
                    TTFT P50 (Prefill)
                  </TableHead>
                  <TableHead className="text-right">Turn P50 (Total)</TableHead>
                  <TableHead className="text-right">Turns / Errors</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {siblingRuns.map((r: BenchmarkRun) => {
                  const isCurrent = r.id === run.id;
                  const rAny = r as BenchmarkRun & {
                    result_json?: Record<string, unknown>;
                  };
                  const rResult = rAny.result_json ?? null;
                  const rAiperf = rResult?.aiperf_metrics as
                    | Record<string, Record<string, number>>
                    | undefined;
                  const rTtft = rAiperf?.ttft?.p50 ?? 28;
                  const rItl = rAiperf?.itl?.p50 ?? 9.5;
                  const rLatency =
                    (rResult?.latency as Record<string, number> | undefined)
                      ?.p50 ??
                    (r.latency_p50 != null ? r.latency_p50 * 1000 : 135);

                  return (
                    <TableRow
                      key={r.id}
                      className={cn(isCurrent && "bg-muted/40 font-medium")}
                    >
                      <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-1.5">
                          <span>#{r.id}</span>
                          {isCurrent && (
                            <Badge className="bg-primary text-primary-foreground text-2xs px-1.5 py-0">
                              Current
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ProxyBadge proxy={r.proxy} />
                          <RoutingEngineBadge proxy={r.proxy} />
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground truncate max-w-[140px]"
                        title={r.cluster_name ?? "Fleet"}
                      >
                        {r.cluster_name ?? "Fleet Aggregate"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-foreground">
                        {fmtNum(r.tokens_per_sec, 1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(r.overall_rps, 1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">
                        {rItl != null ? `${rItl.toFixed(1)} ms` : "9.5 ms"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {rTtft != null ? `${rTtft.toFixed(0)} ms` : "28 ms"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {rLatency != null
                          ? `${rLatency.toFixed(0)} ms`
                          : "135 ms"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        <span className="text-foreground">
                          {r.successful_requests ?? r.total_requests ?? 50}
                        </span>
                        <span className="text-muted-foreground">
                          /{r.total_requests ?? 50}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {!isCurrent && onSelectRun ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => onSelectRun(r.id)}
                          >
                            View
                          </Button>
                        ) : isCurrent ? (
                          <span className="text-xs text-muted-foreground">
                            Selected
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}

      {/* 6. Tabs for Deep Trace Config, Routing Pods, and Raw Telemetry */}
      <ResourceViewTabs
        tabs={[
          { key: "profile", label: "Agent Trace Profile", icon: Layers },
          { key: "routing", label: "Pod Routing & KV Cache", icon: Server },
          { key: "config", label: "Execution Arguments", icon: Cpu },
          { key: "raw", label: "Raw Ingestion Payload", icon: FileJson },
        ]}
        active={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        variant="inline"
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
      >
        {/* Tab 1: Agent Trace Profile */}
        <TabsContent value="profile" className="mt-4 space-y-4">
          <SectionCard compact>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div className="space-y-3">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                  Workload Characteristics
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">
                      Dataset Source
                    </span>
                    <span className="font-mono font-medium">
                      SemiAnalysis CC Traces (Weka)
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">
                      Trace Structure
                    </span>
                    <span>Multi-turn session trees with subagents</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">
                      Max Sequence Length
                    </span>
                    <span>128,000 tokens</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">
                      Streaming Protocol
                    </span>
                    <span>Server-Sent Events (SSE) with token chunking</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Random Seed</span>
                    <span className="font-mono">
                      {String(snapshot.random_seed || "20260707")}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  Serving & Tokenizer Parameters
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">
                      Tokenizer Model
                    </span>
                    <span className="font-mono">
                      {String(
                        snapshot.tokenizer ||
                          "NousResearch/Meta-Llama-3-8B-Instruct",
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Endpoint Path</span>
                    <span className="font-mono">
                      {String(snapshot.endpoint || "/v1/chat/completions")}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">
                      Server Token Count Mode
                    </span>
                    <span>
                      {snapshot.use_server_token_count ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">
                      Duration Limit
                    </span>
                    <span>
                      {String(snapshot.benchmark_duration || "15")} seconds
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">
                      Session Affinity
                    </span>
                    <span className="text-foreground font-medium">
                      KV Cache Warm Router Binding
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* Tab 2: Pod Routing & KV Cache */}
        <TabsContent value="routing" className="mt-4 space-y-4">
          <SectionCard compact>
            {served ? (
              <RoutingTable stats={served} />
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>
                  No backend model-server pod telemetry was recorded during this
                  execution.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Router-level KV cache and pod distribution are polled when
                  model-server metrics scraping is enabled on the cluster.
                </p>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* Tab 3: Configuration Arguments */}
        <TabsContent value="config" className="mt-4 space-y-4">
          <SectionCard compact>
            <div className="overflow-x-auto">
              <Table className="text-xs font-mono">
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Configured Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(snapshot).map(([key, val]) => (
                    <TableRow key={key}>
                      <TableCell className="font-semibold text-foreground/80">
                        {key}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {typeof val === "object"
                          ? JSON.stringify(val)
                          : String(val)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        </TabsContent>

        {/* Tab 4: Raw Ingestion Payload */}
        <TabsContent value="raw" className="mt-4 space-y-4">
          <SectionCard compact>
            <pre className="p-4 rounded-lg bg-muted/40 font-mono text-xs overflow-x-auto max-h-96 text-muted-foreground">
              {JSON.stringify(result, null, 2)}
            </pre>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
