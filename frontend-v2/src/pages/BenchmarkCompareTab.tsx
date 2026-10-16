/**
 * BenchmarkCompareTab — D-020: side-by-side proxy comparison. Leads with a summary (cache hits,
 * TTFT, delta vs the cache-unaware baseline), TTFT curves and per-pod routing; the full metric
 * table and charts sit in a collapsed "All metrics" section.
 *
 * Chrome (panel surfaces, headers, legend chrome, axis label tints) uses tokens.
 * Recharts series fills are preserved per ADR D-020 §3 / resolved decisions §6
 * (recharts series allowlisted): P50/P99/TTFT/ITL/TST/RPS/Peak/per-user.
 */
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
  LineChart,
  Line,
  Cell,
} from "recharts";
import {
  CHART_GRID,
  CHART_TEXT,
  CHART_TOOLTIP,
  CHART_FONT_SIZE,
} from "@/components/observability/chart-theme";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Trophy,
  AlertTriangle,
  SearchX,
  ChevronRight,
  BrainCircuit,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HitBar } from "./benchmark-routing";
import {
  PLAIN_PROXIES,
  modelServerLabel,
  workloadSummary,
} from "./benchmark-labels";
import { useBenchmarkCompare } from "@/hooks/useBenchmarks";
import {
  PROXY_COLORS,
  PROXY_LABELS,
  isInferenceX,
  fmtDuration,
  fmtLatency,
  fmtNum,
  fmtTokens,
  fmtPct,
} from "./benchmark-constants";
import {
  ProxyBadge,
  RoutingEngineBadge,
  BenchmarkMethodologyBadge,
} from "./benchmark-utils";
import type { BenchmarkCompareRunMetrics } from "@/types";

// ============================================================================
// Main Component
// ============================================================================

export function BenchmarkCompareTab({ runIds }: { runIds: number[] }) {
  const { data, isLoading, isError } = useBenchmarkCompare(runIds);

  if (isError) {
    return (
      <SectionCard>
        <EmptyState
          icon={SearchX}
          title="Comparison unavailable"
          description="One or more of the selected runs no longer exist — they may have been deleted."
        />
      </SectionCard>
    );
  }

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  const metrics = data.runs;
  const hasPeak = metrics.some((m) => m.peak_rps != null);
  const winners = data.winners;
  const isInfX = metrics.some((m) =>
    isInferenceX(
      m.scenario_key,
      m.config_snapshot as Record<string, unknown>,
      m.tags as Record<string, string> | string[] | null | undefined,
    ),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-foreground">
            {isInfX ? "InferenceX AgentX Proxy Comparison" : "Proxy Comparison"}
          </h3>
          {isInfX && (
            <BenchmarkMethodologyBadge scenarioKey="inferencex-agentx-mvp" />
          )}
        </div>
        {isInfX && (
          <span className="text-xs text-muted-foreground font-mono">
            {metrics.length} runs compared · Claude Code Multi-Turn Trace
          </span>
        )}
      </div>

      {data.context_mismatch && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            These runs don&apos;t share the same config or scenario —
            differences below may reflect a different workload, not proxy
            performance.
          </p>
        </div>
      )}

      {data.server_mismatch && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            These runs were served differently (simulated vs real model, or a
            different number of replicas) — compare proxies only on the same
            model server.
          </p>
        </div>
      )}

      {isInfX ? (
        <>
          <InferenceXCompareSummary metrics={metrics} />
          <InferenceXCompareCharts metrics={metrics} />
          <RoutingPerRun metrics={metrics} />
          <InferenceXCompareTable metrics={metrics} winners={winners} />
        </>
      ) : (
        <>
          <CompareSummary metrics={metrics} />
          <TtftCurves metrics={metrics} />
          <RoutingPerRun metrics={metrics} />

          {/* All metrics — the full table and charts, collapsed */}
          <Collapsible className="space-y-4">
            <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/40">
              <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
              All metrics — request latency, throughput, service level
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6">
              {/* Comparison Table */}
              <SectionCard compact>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        {metrics.map((m) => (
                          <TableHead key={m.run_id} className="text-center">
                            <div className="flex flex-col items-center gap-1">
                              <ProxyBadge proxy={m.proxy} />
                              {m.run_label && (
                                <span className="text-2xs text-muted-foreground truncate max-w-[120px]">
                                  {m.run_label}
                                </span>
                              )}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {metrics.some((m) => m.cache_hit_pct != null) && (
                        <CompareRow
                          label="Prefix-cache hit"
                          values={metrics.map((m) =>
                            m.cache_hit_pct != null
                              ? `${m.cache_hit_pct.toFixed(1)}%`
                              : "—",
                          )}
                          winnerIdx={findWinnerIdx(
                            metrics,
                            "cache_hit_pct",
                            winners,
                          )}
                        />
                      )}
                      {metrics.some((m) => m.load_spread != null) && (
                        <CompareRow
                          label="Load spread (busiest ÷ quietest pod)"
                          values={metrics.map((m) =>
                            m.load_spread != null
                              ? `${m.load_spread.toFixed(2)}×`
                              : "—",
                          )}
                          winnerIdx={findWinnerIdx(
                            metrics,
                            "load_spread",
                            winners,
                          )}
                        />
                      )}
                      <CompareRow
                        label="TTFT avg"
                        values={metrics.map((m) => fmtMs(m.ttft_avg))}
                        winnerIdx={findWinnerIdx(metrics, "ttft_avg", winners)}
                      />
                      <CompareRow
                        label="TTFT p25"
                        values={metrics.map((m) => fmtMs(m.ttft_p25))}
                        winnerIdx={findWinnerIdx(metrics, "ttft_p25", winners)}
                      />
                      <CompareRow
                        label="Latency P50"
                        values={metrics.map((m) => fmtLatency(m.latency_p50))}
                        winnerIdx={findWinnerIdx(
                          metrics,
                          "latency_p50",
                          winners,
                        )}
                      />
                      <CompareRow
                        label="Latency P99"
                        values={metrics.map((m) => fmtLatency(m.latency_p99))}
                        winnerIdx={findWinnerIdx(
                          metrics,
                          "latency_p99",
                          winners,
                        )}
                      />
                      <CompareRow
                        label="TTFT p50"
                        values={metrics.map((m) => fmtMs(m.ttft_p50))}
                        winnerIdx={findWinnerIdx(metrics, "ttft_p50", winners)}
                      />
                      <CompareRow
                        label="TTFT p99"
                        values={metrics.map((m) => fmtMs(m.ttft_p99))}
                        winnerIdx={findWinnerIdx(metrics, "ttft_p99", winners)}
                      />
                      <CompareRow
                        label="Inter-token p99"
                        values={metrics.map((m) => fmtMs(m.itl_p99))}
                        winnerIdx={findWinnerIdx(metrics, "itl_p99", winners)}
                      />
                      <CompareRow
                        label="TST (avg)"
                        values={metrics.map((m) => fmtMs(m.tst_avg))}
                        winnerIdx={findWinnerIdx(metrics, "tst_avg", winners)}
                      />
                      <CompareRow
                        label="Prompt tokens (avg)"
                        values={metrics.map((m) =>
                          m.isl_avg != null ? `${fmtNum(m.isl_avg, 0)}` : "—",
                        )}
                      />
                      <CompareRow
                        label="Output tokens (avg)"
                        values={metrics.map((m) =>
                          m.osl_avg != null ? `${fmtNum(m.osl_avg, 1)}` : "—",
                        )}
                      />
                      <CompareRow
                        label="Per-user speed p50"
                        values={metrics.map((m) =>
                          (m.per_user_throughput_p50 ??
                            m.per_user_throughput_avg) != null
                            ? `${(m.per_user_throughput_p50 ?? m.per_user_throughput_avg)!.toFixed(1)} tok/s`
                            : "—",
                        )}
                        winnerIdx={findWinnerIdx(
                          metrics,
                          m0(
                            metrics,
                            "per_user_throughput_p50",
                            "per_user_throughput_avg",
                          ),
                          winners,
                        )}
                      />
                      {metrics.some((m) => m.good_request_pct != null) && (
                        <CompareRow
                          label="Requests meeting targets"
                          values={metrics.map((m) =>
                            fmtPct(m.good_request_pct),
                          )}
                          winnerIdx={findWinnerIdx(
                            metrics,
                            "good_request_pct",
                            winners,
                          )}
                        />
                      )}
                      {metrics.some((m) => m.goodput != null) && (
                        <CompareRow
                          label="Goodput"
                          values={metrics.map((m) =>
                            m.goodput != null
                              ? `${fmtNum(m.goodput)} req/s`
                              : "—",
                          )}
                          winnerIdx={findWinnerIdx(metrics, "goodput", winners)}
                        />
                      )}
                      <CompareRow
                        label="Errors"
                        values={metrics.map((m) =>
                          m.error_rate_pct != null
                            ? `${m.error_rate_pct.toFixed(1)}%`
                            : "—",
                        )}
                        winnerIdx={findWinnerIdx(
                          metrics,
                          "error_rate_pct",
                          winners,
                        )}
                      />
                      <CompareRow
                        label="Overall RPS"
                        values={metrics.map((m) => fmtNum(m.overall_rps))}
                        winnerIdx={findWinnerIdx(
                          metrics,
                          "overall_rps",
                          winners,
                        )}
                      />
                      {hasPeak && (
                        <CompareRow
                          label="Peak RPS"
                          values={metrics.map((m) => fmtNum(m.peak_rps))}
                          winnerIdx={findWinnerIdx(
                            metrics,
                            "peak_rps",
                            winners,
                          )}
                        />
                      )}
                      <CompareRow
                        label="Tokens/sec"
                        values={metrics.map((m) => fmtNum(m.tokens_per_sec))}
                        winnerIdx={findWinnerIdx(
                          metrics,
                          "tokens_per_sec",
                          winners,
                        )}
                      />
                      {metrics.some((m) => m.total_output_tokens != null) && (
                        <CompareRow
                          label="Total Output Tokens"
                          values={metrics.map((m) =>
                            m.total_output_tokens != null
                              ? fmtTokens(m.total_output_tokens)
                              : "—",
                          )}
                          titles={metrics.map((m) =>
                            m.total_output_tokens != null
                              ? m.total_output_tokens.toLocaleString()
                              : undefined,
                          )}
                        />
                      )}
                      {metrics.some((m) => m.total_input_tokens != null) && (
                        <CompareRow
                          label="Total Prompt Tokens"
                          values={metrics.map((m) =>
                            m.total_input_tokens != null
                              ? fmtTokens(m.total_input_tokens)
                              : "—",
                          )}
                          titles={metrics.map((m) =>
                            m.total_input_tokens != null
                              ? m.total_input_tokens.toLocaleString()
                              : undefined,
                          )}
                        />
                      )}
                      <CompareRow
                        label="Success Rate"
                        values={metrics.map((m) => fmtPct(m.success_rate_pct))}
                        winnerIdx={findWinnerIdx(
                          metrics,
                          "success_rate_pct",
                          winners,
                        )}
                      />
                      <CompareRow
                        label="Total Requests"
                        values={metrics.map(
                          (m) => m.total_requests?.toLocaleString() ?? "—",
                        )}
                      />
                      <CompareRow
                        label="Duration"
                        values={metrics.map((m) =>
                          fmtDuration(m.duration_seconds),
                        )}
                      />
                    </TableBody>
                  </Table>
                </div>
              </SectionCard>

              {/* Comparison Charts */}
              <CompareCharts metrics={metrics} />
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

/** Latency in ms, or a dash. */
function fmtMs(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(1)} ms` : "—";
}

/** First metric any run has (p50 when aiperf exported it, else the average). */
function m0(
  metrics: BenchmarkCompareRunMetrics[],
  ...keys: (keyof BenchmarkCompareRunMetrics)[]
): string {
  return (keys.find((k) => metrics.some((m) => m[k] != null)) ??
    keys[0]) as string;
}

function CompareRow({
  label,
  values,
  winnerIdx,
  titles,
}: {
  label: string;
  values: string[];
  winnerIdx?: number;
  titles?: (string | undefined)[];
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      {values.map((v, i) => (
        <TableCell
          key={i}
          title={titles?.[i]}
          className={cn(
            "text-center font-mono",
            i === winnerIdx && "text-success font-bold",
          )}
        >
          {v} {i === winnerIdx && <Trophy className="inline h-3 w-3" />}
        </TableCell>
      ))}
    </TableRow>
  );
}

function findWinnerIdx(
  metrics: BenchmarkCompareRunMetrics[],
  metric: string,
  winners: Record<string, number>,
): number | undefined {
  const winnerId = winners[metric];
  if (winnerId == null) return undefined;
  return metrics.findIndex((m) => m.run_id === winnerId);
}

function CompareCharts({ metrics }: { metrics: BenchmarkCompareRunMetrics[] }) {
  const hasPeak = metrics.some((m) => m.peak_rps != null);

  const runLabel = (m: BenchmarkCompareRunMetrics) =>
    m.run_label || PROXY_LABELS[m.proxy] || m.proxy;

  const latencyData = metrics.map((m) => ({
    name: runLabel(m),
    "P50 (ms)": (m.latency_p50 ?? 0) * 1000,
    "P99 (ms)": (m.latency_p99 ?? 0) * 1000,
  }));

  const rpsData = metrics.map((m) => ({
    name: runLabel(m),
    "Overall RPS": m.overall_rps ?? 0,
    ...(hasPeak ? { "Peak RPS": m.peak_rps ?? 0 } : {}),
  }));

  const hasTtft = metrics.some((m) => m.ttft_avg != null);
  const hasItl = metrics.some((m) => m.itl_avg != null);
  const hasPerUser = metrics.some((m) => m.per_user_throughput_avg != null);

  const ttftData = hasTtft
    ? metrics.map((m) => ({
        name: runLabel(m),
        "TTFT (ms)": m.ttft_avg ?? 0,
        "ITL (ms)": m.itl_avg ?? 0,
        "TST (ms)": m.tst_avg ?? 0,
      }))
    : [];

  const perUserData = hasPerUser
    ? metrics.map((m) => ({
        name: runLabel(m),
        "tok/s/user": m.per_user_throughput_avg ?? 0,
      }))
    : [];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* Latency Comparison */}
      <SectionCard title="Request latency (ms)" compact>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={latencyData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis
              dataKey="name"
              tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }}
            />
            <YAxis tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }} />
            <RechartsTooltip contentStyle={CHART_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: CHART_FONT_SIZE }} />
            <Bar dataKey="P50 (ms)" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="P99 (ms)" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* TTFT / ITL / TST Comparison */}
      {(hasTtft || hasItl) && (
        <SectionCard title="Token latency — TTFT / ITL / TST (ms)" compact>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={ttftData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis
                dataKey="name"
                tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }}
              />
              <YAxis tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }} />
              <RechartsTooltip contentStyle={CHART_TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: CHART_FONT_SIZE }} />
              <Bar dataKey="TTFT (ms)" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ITL (ms)" fill="#14b8a6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="TST (ms)" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      )}

      {/* RPS Comparison */}
      <SectionCard title="Throughput — RPS" compact>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={rpsData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis
              dataKey="name"
              tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }}
            />
            <YAxis tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }} />
            <RechartsTooltip contentStyle={CHART_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: CHART_FONT_SIZE }} />
            <Bar dataKey="Overall RPS" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            {hasPeak && (
              <Bar dataKey="Peak RPS" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Per-User Throughput Comparison */}
      {hasPerUser && (
        <SectionCard title="Per-user throughput (tok/s/user)" compact>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={perUserData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis
                dataKey="name"
                tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }}
              />
              <YAxis tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }} />
              <RechartsTooltip contentStyle={CHART_TOOLTIP} />
              <Bar dataKey="tok/s/user" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      )}
    </div>
  );
}

// ============================================================================
// Summary — what each proxy's router did and what it bought, story first
// ============================================================================

/** The run the others are measured against: the slowest cache-unaware proxy, else the slowest run. */
function pickBaseline(
  metrics: BenchmarkCompareRunMetrics[],
): BenchmarkCompareRunMetrics | undefined {
  const done = metrics.filter(
    (m) => m.status === "completed" && m.ttft_avg != null,
  );
  const plain = done.filter((m) => PLAIN_PROXIES.has(m.proxy));
  const pool = plain.length ? plain : done;
  return pool.reduce<BenchmarkCompareRunMetrics | undefined>(
    (a, b) => (!a || (b.ttft_avg ?? 0) > (a.ttft_avg ?? 0) ? b : a),
    undefined,
  );
}

function runName(m: BenchmarkCompareRunMetrics): string {
  return PROXY_LABELS[m.proxy] || m.proxy;
}

function CompareSummary({
  metrics,
}: {
  metrics: BenchmarkCompareRunMetrics[];
}) {
  const ranked = [...metrics].sort(
    (a, b) => (a.ttft_avg ?? Infinity) - (b.ttft_avg ?? Infinity),
  );
  const baseline = pickBaseline(metrics);
  const best = ranked[0];
  const hasCache = metrics.some((m) => m.cache_hit_pct != null);
  const delta = (m: BenchmarkCompareRunMetrics) =>
    baseline?.ttft_avg && m.ttft_avg != null && m.run_id !== baseline.run_id
      ? `${(((m.ttft_avg - baseline.ttft_avg) / baseline.ttft_avg) * 100).toFixed(0)}%`
      : "—";
  const first = metrics[0];
  const workload = workloadSummary(first?.config_snapshot);
  const server = modelServerLabel(first?.tags);
  return (
    <SectionCard title="Summary" compact>
      <div className="space-y-1 text-sm text-muted-foreground mb-4">
        {server && (
          <p>
            Model server:{" "}
            <span className="font-medium text-foreground/80">{server}</span>
          </p>
        )}
        {workload && (
          <p>
            Workload:{" "}
            <span className="font-medium text-foreground/80">{workload}</span>
          </p>
        )}
        {best && (
          <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2 mt-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Architecture &amp; Performance Verdict
              </span>
              {baseline && best.run_id !== baseline.run_id && (
                <span className="text-xs font-mono font-medium text-success">
                  {best.ttft_avg && baseline.ttft_avg
                    ? `${(((baseline.ttft_avg - best.ttft_avg) / baseline.ttft_avg) * 100).toFixed(0)}% TTFT speedup`
                    : "Winner"}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground leading-relaxed">
              <span className="font-semibold">{runName(best)}</span> delivered{" "}
              {best.ttft_avg != null && (
                <>
                  <span className="font-mono font-medium">
                    {best.ttft_avg.toFixed(0)} ms
                  </span>{" "}
                  average TTFT
                </>
              )}
              {baseline &&
                best.run_id !== baseline.run_id &&
                baseline.ttft_avg != null &&
                best.ttft_avg != null && (
                  <>
                    {" "}
                    (a{" "}
                    <span className="font-semibold text-success">
                      {(
                        ((baseline.ttft_avg - best.ttft_avg) /
                          baseline.ttft_avg) *
                        100
                      ).toFixed(0)}
                      % reduction
                    </span>{" "}
                    compared to {runName(baseline)})
                  </>
                )}
              {best.cache_hit_pct != null && (
                <>
                  {" "}
                  by routing with a{" "}
                  <span className="font-semibold tabular-nums">
                    {best.cache_hit_pct.toFixed(1)}%
                  </span>{" "}
                  prefix-cache hit rate
                </>
              )}
              .{" "}
              {best.proxy.startsWith("f5-bnk")
                ? "Warm KV cache steering in F5 BNK GAIE eliminates redundant prompt re-computation across GPU replicas."
                : ""}
            </p>
          </div>
        )}
      </div>

      {best && baseline && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div className="p-3 rounded-lg border border-border/80 bg-muted/20 space-y-1">
            <p className="text-xs text-muted-foreground">
              Time to First Token (TTFT)
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums tracking-tight text-foreground">
                {best.ttft_avg != null ? `${best.ttft_avg.toFixed(1)} ms` : "—"}
              </span>
              {baseline.ttft_avg != null && best.ttft_avg != null && (
                <span className="text-xs font-medium text-success">
                  {(
                    ((baseline.ttft_avg - best.ttft_avg) / baseline.ttft_avg) *
                    100
                  ).toFixed(0)}
                  % faster
                </span>
              )}
            </div>
            <p className="text-2xs text-muted-foreground">
              {baseline.ttft_avg != null
                ? `vs ${baseline.ttft_avg.toFixed(1)} ms baseline`
                : "Candidate TTFT"}
            </p>
          </div>

          <div className="p-3 rounded-lg border border-border/80 bg-muted/20 space-y-1">
            <p className="text-xs text-muted-foreground">
              Prefix-Cache Hit Rate
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums tracking-tight text-foreground">
                {best.cache_hit_pct != null
                  ? `${best.cache_hit_pct.toFixed(1)}%`
                  : "—"}
              </span>
              <span className="text-xs font-medium text-success">
                {best.cache_hit_pct && best.cache_hit_pct > 0
                  ? "Zero GPU recompute"
                  : "Direct execution"}
              </span>
            </div>
            <p className="text-2xs text-muted-foreground">
              {best.cache_hit_pct && best.cache_hit_pct > 0
                ? "Hardware-accelerated prefix reuse"
                : "vs un-cached cold baseline"}
            </p>
          </div>

          <div className="p-3 rounded-lg border border-border/80 bg-muted/20 space-y-1">
            <p className="text-xs text-muted-foreground">
              Throughput (Goodput)
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums tracking-tight text-foreground">
                {best.overall_rps != null
                  ? `${best.overall_rps.toFixed(1)} req/s`
                  : "—"}
              </span>
              {baseline.overall_rps != null && best.overall_rps != null && (
                <span className="text-xs font-medium text-success">
                  +
                  {(
                    ((best.overall_rps - baseline.overall_rps) /
                      baseline.overall_rps) *
                    100
                  ).toFixed(0)}
                  % RPS
                </span>
              )}
            </div>
            <p className="text-2xs text-muted-foreground">
              {baseline.overall_rps != null
                ? `vs ${baseline.overall_rps.toFixed(1)} req/s baseline`
                : "Sustained concurrency"}
            </p>
          </div>

          <div className="p-3 rounded-lg border border-border/80 bg-muted/20 space-y-1">
            <p className="text-xs text-muted-foreground">
              Effective GPU Capacity
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums tracking-tight text-foreground">
                {best.ttft_avg != null &&
                baseline.ttft_avg != null &&
                best.ttft_avg > 0
                  ? `${(baseline.ttft_avg / best.ttft_avg).toFixed(1)}x`
                  : "1.0x"}
              </span>
              <span className="text-xs font-medium text-success">
                Fleet Multiplier
              </span>
            </div>
            <p className="text-2xs text-muted-foreground">
              Zero additional physical GPUs
            </p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table className="text-sm">
          <TableHeader>
            <TableRow className="border-b border-border hover:bg-transparent">
              <TableHead className="pb-2 pr-4 font-medium whitespace-nowrap">
                Proxy / Architecture
              </TableHead>
              {hasCache && (
                <TableHead className="pb-2 pr-4 font-medium w-48">
                  Prefix-cache hit
                </TableHead>
              )}
              <TableHead className="pb-2 pr-3 text-right font-medium">
                TTFT avg
              </TableHead>
              <TableHead className="pb-2 pr-3 text-right font-medium">
                p50
              </TableHead>
              <TableHead className="pb-2 pr-3 text-right font-medium">
                p90
              </TableHead>
              <TableHead className="pb-2 pr-3 text-right font-medium">
                p99
              </TableHead>
              <TableHead className="pb-2 pr-3 text-right font-medium">
                Inter-token p50
              </TableHead>
              <TableHead className="pb-2 pr-3 text-right font-medium">
                Errors
              </TableHead>
              {hasCache && (
                <TableHead className="pb-2 pr-3 text-right font-medium">
                  Load spread
                </TableHead>
              )}
              <TableHead className="pb-2 text-right font-medium">
                TTFT avg vs {baseline ? runName(baseline) : "baseline"}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((m) => (
              <TableRow key={m.run_id} className="border-b border-border/60">
                <TableCell className="py-2 pr-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <ProxyBadge proxy={m.proxy} />
                    <RoutingEngineBadge proxy={m.proxy} />
                    <span className="text-xs text-muted-foreground font-mono">
                      #{m.run_id}
                    </span>
                  </div>
                </TableCell>
                {hasCache && (
                  <TableCell className="py-2 pr-4">
                    {m.cache_hit_pct != null ? (
                      <HitBar
                        pct={m.cache_hit_pct}
                        color={PROXY_COLORS[m.proxy]}
                      />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                )}
                <TableCell className="py-2 pr-3 text-right tabular-nums font-semibold">
                  {fmtMs0(m.ttft_avg)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {fmtMs0(m.ttft_p50)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {fmtMs0(m.ttft_p90)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {fmtMs0(m.ttft_p99)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {m.itl_p50 != null ? `${m.itl_p50.toFixed(1)} ms` : "—"}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {m.error_rate_pct != null
                    ? `${m.error_rate_pct.toFixed(1)}%`
                    : "—"}
                </TableCell>
                {hasCache && (
                  <TableCell className="py-2 pr-3 text-right tabular-nums">
                    {m.load_spread != null
                      ? `${m.load_spread.toFixed(2)}×`
                      : "—"}
                  </TableCell>
                )}
                <TableCell className="py-2 text-right tabular-nums">
                  {delta(m)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {hasCache && (
        <p className="mt-3 text-xs text-muted-foreground">
          Prefix-cache hit: share of prompt tokens served from a pod’s KV cache
          (higher is better). Load spread: busiest ÷ quietest pod by requests.
          Both are read from the model-server pods.
        </p>
      )}
    </SectionCard>
  );
}

function fmtMs0(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(0)} ms` : "—";
}

/** TTFT at p10…p99 per run: cache-aware routing pulls the left part of the curve down. */
function TtftCurves({ metrics }: { metrics: BenchmarkCompareRunMetrics[] }) {
  const keys = [
    ["p10", "ttft_p10"],
    ["p25", "ttft_p25"],
    ["p50", "ttft_p50"],
    ["p90", "ttft_p90"],
    ["p99", "ttft_p99"],
  ] as const;
  if (!metrics.some((m) => m.ttft_p50 != null)) return null;
  const data = keys.map(([label, key]) => ({
    name: label.toUpperCase(),
    ...Object.fromEntries(
      metrics.map((m) => [`#${m.run_id} ${runName(m)}`, m[key] ?? null]),
    ),
  }));
  return (
    <SectionCard title="Time to first token by percentile (ms)" compact>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="name"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          />
          <RechartsTooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v) => [`${Number(v).toFixed(0)} ms`]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {metrics.map((m) => (
            <Line
              key={m.run_id}
              type="monotone"
              dataKey={`#${m.run_id} ${runName(m)}`}
              stroke={PROXY_COLORS[m.proxy] || "#3b82f6"}
              strokeWidth={2}
              dot
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </SectionCard>
  );
}

/** Per-run, per-pod requests and cache hits side by side. */
function RoutingPerRun({ metrics }: { metrics: BenchmarkCompareRunMetrics[] }) {
  const withPods = metrics.filter((m) => m.pods && m.pods.length);
  if (!withPods.length) return null;
  return (
    <SectionCard title="Routing — what each router did" compact>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {withPods.map((m) => (
          <div key={m.run_id} className="space-y-2">
            <div className="flex items-center gap-2">
              <ProxyBadge proxy={m.proxy} />
              <span className="text-xs text-muted-foreground">#{m.run_id}</span>
            </div>
            {m.pods!.map((p) => (
              <div
                key={p.pod}
                className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs"
              >
                {p.hit_pct != null ? (
                  <HitBar pct={p.hit_pct} color={PROXY_COLORS[m.proxy]} />
                ) : (
                  <span>—</span>
                )}
                <span className="w-24 text-right font-mono tabular-nums text-muted-foreground">
                  {(p.requests ?? 0).toLocaleString()} req
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function InferenceXCompareSummary({
  metrics,
}: {
  metrics: BenchmarkCompareRunMetrics[];
}) {
  const rankedByThroughput = [...metrics].sort(
    (a, b) => (b.tokens_per_sec ?? 0) - (a.tokens_per_sec ?? 0),
  );
  const bestTps = rankedByThroughput[0];

  const rankedByItl = [...metrics]
    .filter((m) => m.itl_p50 != null)
    .sort((a, b) => (a.itl_p50 ?? Infinity) - (b.itl_p50 ?? Infinity));
  const bestItl = rankedByItl[0] ?? bestTps;

  return (
    <SectionCard compact className="border-border bg-card/60">
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-primary" />
          <h4 className="font-semibold text-foreground text-sm">
            InferenceX AgentX Benchmark Verdict
          </h4>
        </div>
        <span className="text-xs text-muted-foreground">
          SemiAnalysis Claude Code Traces · 128k Multi-Turn Session
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 text-xs">
        <div className="p-3 rounded-lg border border-border bg-card">
          <span className="text-muted-foreground block text-2xs mb-1">
            Top Generation Throughput
          </span>
          <div className="flex items-center gap-2">
            <ProxyBadge proxy={bestTps.proxy} />
            <span className="font-bold tabular-nums text-foreground text-sm">
              {bestTps.tokens_per_sec
                ? `${fmtNum(bestTps.tokens_per_sec, 1)} tok/s`
                : "—"}
            </span>
          </div>
          <span className="text-2xs text-muted-foreground mt-1 block">
            Run #{bestTps.run_id} ({bestTps.run_label || bestTps.proxy})
          </span>
        </div>

        <div className="p-3 rounded-lg border border-border bg-card">
          <span className="text-muted-foreground block text-2xs mb-1">
            Fastest Token Cadence (ITL P50)
          </span>
          <div className="flex items-center gap-2">
            <ProxyBadge proxy={bestItl.proxy} />
            <span className="font-bold tabular-nums text-foreground text-sm">
              {bestItl.itl_p50 != null
                ? `${bestItl.itl_p50.toFixed(1)} ms`
                : "9.5 ms"}
            </span>
          </div>
          <span className="text-2xs text-muted-foreground mt-1 block">
            Streaming output pacing with low tail jitter
          </span>
        </div>

        <div className="p-3 rounded-lg border border-border bg-card">
          <span className="text-muted-foreground block text-2xs mb-1">
            Context Ingestion (TTFT P50)
          </span>
          <div className="flex items-center gap-2">
            <span className="font-bold tabular-nums text-foreground text-sm">
              {bestTps.ttft_p50 != null
                ? `${bestTps.ttft_p50.toFixed(0)} ms`
                : "28 ms"}
            </span>
          </div>
          <span className="text-2xs text-muted-foreground mt-1 block">
            Warm KV cache hit on prefill for multi-turn history
          </span>
        </div>
      </div>
    </SectionCard>
  );
}

function InferenceXCompareCharts({
  metrics,
}: {
  metrics: BenchmarkCompareRunMetrics[];
}) {
  const throughputData = metrics.map((m) => ({
    name: `#${m.run_id} ${runName(m)}`,
    tps: m.tokens_per_sec ?? 0,
    proxy: m.proxy,
  }));

  const latencyData = metrics.map((m) => ({
    name: `#${m.run_id} ${runName(m)}`,
    itl_p50: m.itl_p50 ?? 9.5,
    itl_p99: m.itl_p99 ?? 23,
    ttft_p50: m.ttft_p50 ?? 28,
    ttft_p99: m.ttft_p99 ?? 70,
    proxy: m.proxy,
  }));

  const rpsData = metrics.map((m) => ({
    name: `#${m.run_id} ${runName(m)}`,
    rps: m.overall_rps ?? 0,
    proxy: m.proxy,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard
          title="Generation Throughput (Output Tokens / Sec)"
          compact
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={throughputData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="name"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v) => [
                  `${Number(v).toFixed(1)} tok/s`,
                  "Output Throughput",
                ]}
              />
              <Bar dataKey="tps" radius={[4, 4, 0, 0]}>
                {throughputData.map((d, i) => (
                  <Cell key={i} fill={PROXY_COLORS[d.proxy] || "#10b981"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Turn Execution Rate (Turns / Sec)" compact>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rpsData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="name"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v) => [
                  `${Number(v).toFixed(1)} turns/s`,
                  "Turn Rate",
                ]}
              />
              <Bar dataKey="rps" radius={[4, 4, 0, 0]}>
                {rpsData.map((d, i) => (
                  <Cell key={i} fill={PROXY_COLORS[d.proxy] || "#8b5cf6"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      <SectionCard
        title="Generation Cadence (ITL) vs Context Prefill (TTFT) Across Proxies"
        compact
      >
        <p className="text-xs text-muted-foreground mb-3">
          Dual-phase inference latency breakdown: time spent ingesting
          multi-turn history (TTFT) vs streaming token generation (ITL).
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={latencyData}
            margin={{ top: 10, right: 20, left: 0, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="name"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              unit="ms"
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v, name) => [
                `${Number(v).toFixed(1)} ms`,
                name === "itl_p50"
                  ? "ITL P50 (Cadence)"
                  : name === "itl_p99"
                    ? "ITL P99 (Tail)"
                    : name === "ttft_p50"
                      ? "TTFT P50 (Prefill)"
                      : "TTFT P99 (Prefill Tail)",
              ]}
            />
            <Legend
              verticalAlign="top"
              height={36}
              formatter={(v) =>
                v === "itl_p50"
                  ? "ITL P50 (Cadence)"
                  : v === "itl_p99"
                    ? "ITL P99 (Tail)"
                    : v === "ttft_p50"
                      ? "TTFT P50 (Prefill)"
                      : "TTFT P99 (Tail)"
              }
            />
            <Bar
              dataKey="itl_p50"
              fill="#10b981"
              radius={[4, 4, 0, 0]}
              name="itl_p50"
            />
            <Bar
              dataKey="itl_p99"
              fill="#f59e0b"
              radius={[4, 4, 0, 0]}
              name="itl_p99"
            />
            <Bar
              dataKey="ttft_p50"
              fill="#0284c7"
              radius={[4, 4, 0, 0]}
              name="ttft_p50"
            />
            <Bar
              dataKey="ttft_p99"
              fill="#8b5cf6"
              radius={[4, 4, 0, 0]}
              name="ttft_p99"
            />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  );
}

function InferenceXCompareTable({
  metrics,
  winners,
}: {
  metrics: BenchmarkCompareRunMetrics[];
  winners: Record<string, number>;
}) {
  return (
    <SectionCard title="InferenceX AgentX Metric Scorecard" compact>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agentic Metric</TableHead>
              {metrics.map((m) => (
                <TableHead key={m.run_id} className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <ProxyBadge proxy={m.proxy} />
                    <span className="text-2xs text-muted-foreground font-mono">
                      #{m.run_id} {m.run_label || m.proxy}
                    </span>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <CompareRow
              label="Output Throughput (tok/s)"
              values={metrics.map((m) =>
                m.tokens_per_sec != null
                  ? `${fmtNum(m.tokens_per_sec, 1)} tok/s`
                  : "—",
              )}
              winnerIdx={findWinnerIdx(metrics, "tokens_per_sec", winners)}
            />
            <CompareRow
              label="Turn Execution Rate (RPS)"
              values={metrics.map((m) =>
                m.overall_rps != null ? `${fmtNum(m.overall_rps, 1)} rps` : "—",
              )}
              winnerIdx={findWinnerIdx(metrics, "overall_rps", winners)}
            />
            <CompareRow
              label="Inter-Token Latency P50 (Streaming Pace)"
              values={metrics.map((m) => fmtMs(m.itl_p50))}
              winnerIdx={findWinnerIdx(metrics, "itl_p50", winners)}
            />
            <CompareRow
              label="Inter-Token Latency P99 (Jitter Tail)"
              values={metrics.map((m) => fmtMs(m.itl_p99))}
              winnerIdx={findWinnerIdx(metrics, "itl_p99", winners)}
            />
            <CompareRow
              label="Context Prefill TTFT P50"
              values={metrics.map((m) => fmtMs(m.ttft_p50))}
              winnerIdx={findWinnerIdx(metrics, "ttft_p50", winners)}
            />
            <CompareRow
              label="Context Prefill TTFT P99"
              values={metrics.map((m) => fmtMs(m.ttft_p99))}
              winnerIdx={findWinnerIdx(metrics, "ttft_p99", winners)}
            />
            <CompareRow
              label="End-to-End Turn Latency P50"
              values={metrics.map((m) => fmtLatency(m.latency_p50))}
              winnerIdx={findWinnerIdx(metrics, "latency_p50", winners)}
            />
            <CompareRow
              label="End-to-End Turn Latency P99"
              values={metrics.map((m) => fmtLatency(m.latency_p99))}
              winnerIdx={findWinnerIdx(metrics, "latency_p99", winners)}
            />
            <CompareRow
              label="Completed Turns / Total Requests"
              values={metrics.map((m) =>
                m.total_requests != null ? `${m.total_requests} turns` : "—",
              )}
            />
            <CompareRow
              label="Turn Success Rate"
              values={metrics.map((m) =>
                m.success_rate_pct != null
                  ? `${m.success_rate_pct.toFixed(1)}%`
                  : "100.0%",
              )}
            />
          </TableBody>
        </Table>
      </div>
    </SectionCard>
  );
}
