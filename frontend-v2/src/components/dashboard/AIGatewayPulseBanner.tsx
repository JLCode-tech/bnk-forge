import { Link } from "react-router-dom";
import { SectionCard } from "@/components/ui/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Bot,
  ShieldCheck,
  TrendingUp,
  Zap,
  ArrowRight,
  Server,
} from "lucide-react";
import { useAllClusters } from "@/hooks/useK8sClusters";
import { useLlmStats } from "@/hooks/useLlmObservability";
import { useBenchmarkSummary } from "@/hooks/useBenchmarks";

export function AIGatewayPulseBanner() {
  const { data: clustersData } = useAllClusters();
  const clusters = clustersData?.clusters ?? [];
  const clusterCount = clusters.length;

  const { data: llmStats, isLoading: statsLoading } = useLlmStats(null, {
    range: "24h",
  });
  const { data: benchmarkSummary } = useBenchmarkSummary();

  // Live values only — "—" when telemetry hasn't loaded or is unavailable.
  const live = llmStats?.available ? llmStats : undefined;
  const empty = statsLoading ? "…" : "—";
  const totalRequests = live ? live.total_requests.toLocaleString() : empty;
  const totalTokens = live
    ? live.total_tokens >= 1_000_000
      ? `${(live.total_tokens / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`
      : `${(live.total_tokens / 1000).toFixed(0)}k`
    : empty;
  const avgLatency = live ? `${Math.round(live.avg_latency_ms)}ms` : empty;
  const successRate = live ? Math.round(live.success_rate * 100) : null;
  const modelsCount = live ? live.models : empty;

  const benchP50 =
    benchmarkSummary?.avg_latency_p50 != null
      ? `${benchmarkSummary.avg_latency_p50.toFixed(1)}ms`
      : "—";
  const benchRps =
    benchmarkSummary?.avg_rps != null
      ? benchmarkSummary.avg_rps.toFixed(1)
      : "—";
  // avg_success_rate is already a percentage (0–100).
  const benchPassRate =
    benchmarkSummary?.avg_success_rate != null
      ? Math.round(benchmarkSummary.avg_success_rate)
      : null;

  return (
    <SectionCard compact className="border-border">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-border/60">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-semibold text-foreground tracking-tight">
                AI Infrastructure · last 24h
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 font-sans">
                <Server className="h-3.5 w-3.5" />
                {clusterCount} {clusterCount === 1 ? "Cluster" : "Clusters"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
          >
            <Link to="/ai/agents">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Agent Fleet
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant="default"
            className="h-7 text-xs gap-1.5"
          >
            <Link to="/ai/governance">
              Governance Hub
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI 3-Column Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Metric 1: Agent Fleet & Identity */}
        <Link
          to="/ai/agents"
          className="group block p-3 rounded-lg border border-border bg-card/50 hover:bg-muted/40 hover:border-border transition-colors"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-primary" />
              Models
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums text-foreground">
              {modelsCount}
            </span>
            <span className="text-xs text-muted-foreground">models in use</span>
          </div>
          <div className="mt-1.5 text-2xs text-muted-foreground">
            {totalRequests} requests
          </div>
        </Link>

        {/* Metric 2: Token Quotas & Throttling */}
        <Link
          to="/ai/governance"
          className="group block p-3 rounded-lg border border-border bg-card/50 hover:bg-muted/40 hover:border-border transition-colors"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              Tokens
            </span>
            {successRate !== null && (
              <Badge variant="outline" className="text-2xs text-foreground">
                {successRate}% Success
              </Badge>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums text-foreground">
              {totalTokens}
            </span>
            <span className="text-xs text-muted-foreground">
              tokens · avg {avgLatency}
            </span>
          </div>
          {successRate !== null ? (
            <Progress value={successRate} className="h-1 mt-2" />
          ) : (
            <p className="mt-1.5 text-2xs text-muted-foreground">
              {statsLoading
                ? "Loading telemetry…"
                : "No AI infrastructure telemetry"}
            </p>
          )}
        </Link>

        {/* Metric 3: Prefix Caching & Latency */}
        <Link
          to="/benchmarks"
          className="group block p-3 rounded-lg border border-border bg-card/50 hover:bg-muted/40 hover:border-border transition-colors"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              Benchmarks
            </span>
            {benchPassRate !== null && (
              <Badge variant="success" className="text-2xs">
                {benchPassRate}% Pass
              </Badge>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums text-success">
              {benchP50}
            </span>
            <span className="text-xs text-muted-foreground">
              p50 latency ({benchRps} req/s)
            </span>
          </div>
          <div className="mt-1.5 text-2xs text-muted-foreground">
            {benchmarkSummary?.total_runs ?? "—"} runs
          </div>
        </Link>
      </div>
    </SectionCard>
  );
}
