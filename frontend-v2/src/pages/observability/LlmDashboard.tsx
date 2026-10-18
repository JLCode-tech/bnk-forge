/**
 * LlmDashboard — AI Gateway observability (Tier 1: request analytics).
 *
 * Header filters (cluster · model · time range · status) + three tabs:
 * Overview (chart grid incl. gauges), Model Rankings (stacked bar + table),
 * Provider Usage (cost/tokens/latency, provider inferred from model).
 * Dashboard hooks are gated on the active tab so inactive tabs don't hit Loki.
 */
import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
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
  Bot,
  ShieldCheck,
  BarChart3,
  Trophy,
  Layers,
  RefreshCw,
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
import { useAllClusters } from "@/hooks/useK8sClusters";
import { useObservabilityFilters } from "./use-observability-filters";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import type {
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

const LLM_REFRESH_KEYS = [["llm-observability"]] as const;

export default function LlmDashboard() {
  useEffect(() => {
    document.title = "Token Governance and Intelligence | BNK-Forge";
  }, []);

  const f = useObservabilityFilters("overview");
  const { data: clustersData } = useAllClusters();
  const clusters = clustersData?.clusters ?? [];
  const { data: filterData } = useLlmFilterData(f.clusterId, f.range);
  const { refresh, isRefreshing } = usePageRefresh(LLM_REFRESH_KEYS);

  const { data: llmStats } = useLlmStats(f.clusterId, {
    range: f.range,
    model: f.model,
    status: f.status,
  });
  const { data: benchmarkSummary } = useBenchmarkSummary(
    f.clusterId ?? undefined,
  );

  // Live values only — "—" when telemetry hasn't loaded or is unavailable.
  const live = llmStats?.available ? llmStats : undefined;
  const totalTokens = live ? `${(live.total_tokens / 1000).toFixed(0)}k` : "—";
  const totalRequests = live ? live.total_requests.toLocaleString() : "—";
  const successPct = live ? `${(live.success_rate * 100).toFixed(1)}%` : "—";
  const avgLatency = live ? `${Math.round(live.avg_latency_ms)}ms` : "—";
  const modelsCount = live ? live.models : "—";

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

  const activeViewMeta =
    f.tab === "rankings"
      ? {
          title: "Model Rankings",
          subtitle:
            "Comparative token throughput, latency, and cost across LLM models.",
        }
      : f.tab === "providers"
        ? {
            title: "Provider Usage",
            subtitle:
              "Aggregated token consumption, latency, and spend by inference provider.",
          }
        : f.tab === "chargeback"
          ? {
              title: "FinOps & Chargeback",
              subtitle:
                "Token budget governance, rate-limit enforcement, and tenant cost attribution.",
            }
          : {
              title: "Token Governance and Intelligence",
              subtitle:
                "Request analytics and token intelligence from the LLM gateway (Loki-backed).",
            };

  return (
    <Tabs
      value={f.tab}
      onValueChange={f.setTab}
      orientation="vertical"
      className="flex min-h-[calc(100vh-3rem)]"
    >
      {/* Left Flush Inner Sub-Sidebar */}
      <CollapsibleInnerSidebar className="w-52 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
        <div className="px-2 pt-1 pb-2 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground">
            Token Governance and Intelligence
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Token quotas, model rankings &amp; gateway FinOps telemetry
          </p>
        </div>

        <div className="space-y-1">
          <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            GOVERNANCE VIEWS
          </div>
          <TabsList
            aria-label="AI Gateway views"
            className="flex flex-col items-stretch h-auto bg-transparent p-0 gap-1"
          >
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
            <TabsTrigger
              value="chargeback"
              className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">FinOps &amp; Chargeback</span>
            </TabsTrigger>
          </TabsList>
        </div>
      </CollapsibleInnerSidebar>

      {/* Right Content Pane */}
      <div className="flex-1 min-w-0 p-6 space-y-5 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {f.tab === "overview"
                ? "Gateway Telemetry & Token Overview"
                : activeViewMeta.title}
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
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={refresh}
              disabled={isRefreshing}
              aria-label="Refresh"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {/* BNK 2.4 Inference Acceleration & Governance Summary */}
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
              {llmStats && !llmStats.available && (
                <Badge variant="outline" className="text-2xs">
                  No telemetry{llmStats.reason ? ` · ${llmStats.reason}` : ""}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                value={f.model}
                onChange={f.setModel}
                options={filterData?.models ?? []}
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
                Spend: {live ? fmtCost(live.total_cost) : "—"}
              </p>
            </div>
          </div>
        </SectionCard>

        <TabsContent value="overview" className="mt-0">
          <OverviewTab
            clusterId={f.clusterId}
            params={f.queryParams}
            active={f.tab === "overview"}
          />
        </TabsContent>
        <TabsContent value="chargeback" className="mt-0">
          <ChargebackTab />
        </TabsContent>
        <TabsContent value="rankings" className="mt-0">
          <RankingsTab
            clusterId={f.clusterId}
            params={f.queryParams}
            active={f.tab === "rankings"}
          />
        </TabsContent>
        <TabsContent value="providers" className="mt-0">
          <ProviderUsageTab
            clusterId={f.clusterId}
            params={f.queryParams}
            active={f.tab === "providers"}
          />
        </TabsContent>
      </div>
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

function OverviewTab({ clusterId, params, active }: TabProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
      <HistogramCard
        clusterId={clusterId}
        params={params}
        metric="requests"
        title="Request Volume"
        active={active}
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

  const series = data?.series ?? [];
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
      available={data?.available ?? true}
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

function RankingsTab({ clusterId, params, active }: TabProps) {
  const { data, isLoading } = useLlmRankings(clusterId, params, active);
  const [sortKey, setSortKey] = useState<SortKey>("requests");

  const rows = useMemo(() => {
    const r = [...(data?.rows ?? [])];
    return r.sort((a, b) => b[sortKey] - a[sortKey]);
  }, [data, sortKey]);

  const topSeries = useMemo(() => buildTopModelsSeries(rows), [rows]);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data?.available) {
    return (
      <EmptyState
        icon={Info}
        title="Rankings unavailable"
        description={data?.errors?.rankings || "Rankings unavailable."}
      />
    );
  }

  const colors = topSeries.map((_, i) => seriesColor(i));

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
                <SortHead
                  label="Avg Latency"
                  k="avg_latency_ms"
                  sortKey={sortKey}
                  onSort={setSortKey}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={row.model}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {i + 1}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: providerColor(row.provider) }}
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
                  <TableCell className="text-right tabular-nums text-foreground/80">
                    {fmtLatencyMs(row.avg_latency_ms)}
                  </TableCell>
                </TableRow>
              ))}
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

function ProviderUsageTab({ clusterId, params, active }: TabProps) {
  const [provider, setProvider] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" />
        <span>Provider is inferred from the model name.</span>
        <div className="ml-2">
          <FilterSelect
            value={provider}
            onChange={setProvider}
            options={["openai", "anthropic", "google", "unknown"]}
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
          valueFormatter={fmtCost}
        />
        <ProviderCard
          clusterId={clusterId}
          params={params}
          metric="tokens"
          title="Tokens by Provider"
          active={active}
          provider={provider}
          valueFormatter={fmtCompact}
        />
        <ProviderCard
          clusterId={clusterId}
          params={params}
          metric="latency"
          title="Latency by Provider"
          active={active}
          provider={provider}
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
  valueFormatter,
}: {
  clusterId: LlmClusterScope;
  params: LlmObservabilityParams;
  metric: LlmProviderMetric;
  title: string;
  active: boolean;
  provider: string;
  valueFormatter: (v: number) => string;
}) {
  const { data, isLoading } = useLlmProviderUsage(
    clusterId,
    { ...params, metric },
    active,
  );

  // Series are keyed by provider; a model name is defensively folded too.
  const series = (data?.series ?? []).filter(
    (s) =>
      !provider || inferProvider(s.name) === provider || s.name === provider,
  );
  const colors = series.map((s) =>
    providerColor(
      inferProvider(s.name) === "unknown" ? s.name : inferProvider(s.name),
    ),
  );

  return (
    <ChartCard
      title={title}
      legend={series.map((s, i) => ({ name: s.name, color: colors[i] }))}
      loading={isLoading}
      available={data?.available ?? true}
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

// ============================================================================
// FinOps Chargeback & In-Line Quota Enforcement Tab
// ============================================================================

interface ChargebackItem {
  id: string;
  agentName: string;
  clusterId: number;
  clusterName: string;
  tenant: string;
  costCenter: string;
  monthlyBudget: number;
  currentSpend: number;
  tokensProcessed: number;
  cacheHitPct: number;
  status: "enforcing" | "active";
  targetPool: string;
  primaryModel: string;
}

const DEMO_CHARGEBACK: ChargebackItem[] = [
  {
    id: "cb-1",
    agentName: "claims-processor-v2",
    clusterId: 1,
    clusterName: "aws-us-east-1-prod",
    tenant: "Claims Automation",
    costCenter: "CC-4010-INS",
    monthlyBudget: 5000,
    currentSpend: 3420,
    tokensProcessed: 14200000,
    cacheHitPct: 81.4,
    status: "active",
    targetPool: "vllm-llama-70b-pool",
    primaryModel: "Llama-3.3-70B",
  },
  {
    id: "cb-2",
    agentName: "customer-support-bot",
    clusterId: 1,
    clusterName: "aws-us-east-1-prod",
    tenant: "Customer Success",
    costCenter: "CC-1020-CS",
    monthlyBudget: 2500,
    currentSpend: 1180,
    tokensProcessed: 8900000,
    cacheHitPct: 76.5,
    status: "active",
    targetPool: "vllm-mistral-pool",
    primaryModel: "Mistral-Large-2407",
  },
  {
    id: "cb-3",
    agentName: "dev-copilot-internal",
    clusterId: 2,
    clusterName: "azure-eastus2-prod",
    tenant: "Engineering Platform",
    costCenter: "CC-9000-ENG",
    monthlyBudget: 1000,
    currentSpend: 1024,
    tokensProcessed: 3200000,
    cacheHitPct: 64.2,
    status: "enforcing",
    targetPool: "vllm-qwen-coder-pool",
    primaryModel: "Qwen-2.5-Coder-32B",
  },
  {
    id: "cb-4",
    agentName: "finance-bi-synthesizer",
    clusterId: 2,
    clusterName: "azure-eastus2-prod",
    tenant: "Corporate Finance",
    costCenter: "CC-3050-FIN",
    monthlyBudget: 4000,
    currentSpend: 2150,
    tokensProcessed: 9600000,
    cacheHitPct: 88.0,
    status: "active",
    targetPool: "vllm-llama-70b-pool",
    primaryModel: "Llama-3.3-70B",
  },
  {
    id: "cb-5",
    agentName: "incident-triage-director",
    clusterId: 3,
    clusterName: "gke-us-central1-prod",
    tenant: "SRE & Operations",
    costCenter: "CC-7020-OPS",
    monthlyBudget: 3000,
    currentSpend: 1420,
    tokensProcessed: 5400000,
    cacheHitPct: 84.1,
    status: "active",
    targetPool: "vllm-llama-70b-pool",
    primaryModel: "Llama-3.3-70B",
  },
];

// DEMO_CHARGEBACK is illustrative (no chargeback API yet), so it is shown
// unfiltered and labelled as demo data rather than filtered by fake cluster ids.
function ChargebackTab() {
  const items = DEMO_CHARGEBACK;

  const totalBudget = items.reduce((acc, c) => acc + c.monthlyBudget, 0);
  const totalSpend = items.reduce((acc, c) => acc + c.currentSpend, 0);
  const totalTokens = items.reduce((acc, c) => acc + c.tokensProcessed, 0);
  const overallPct =
    totalBudget > 0 ? Math.round((totalSpend / totalBudget) * 100) : 0;
  const throttledCount = items.filter(
    (c) => c.status === "enforcing" || c.currentSpend >= c.monthlyBudget,
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
        <Badge variant="warning" className="text-2xs">
          Demo data
        </Badge>
        Illustrative chargeback model — not connected to live billing or quota
        enforcement.
      </div>
      {/* FinOps Stat Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SectionCard compact className="border-border">
          <span className="label-caps block">Allocated Budget</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold tabular-nums text-foreground">
              ${totalBudget.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">
              across {items.length} workloads
            </span>
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">
            Enforced in-line at BNK Gateway ingress
          </p>
        </SectionCard>

        <SectionCard compact className="border-border">
          <span className="label-caps block">Spend to Date (MTD)</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold tabular-nums text-foreground">
              ${totalSpend.toLocaleString()}
            </span>
            <span className="text-xs font-semibold text-primary tabular-nums">
              ({overallPct}% Consumed)
            </span>
          </div>
          <div className="mt-1.5">
            <Progress value={overallPct} className="h-1" />
          </div>
        </SectionCard>

        <SectionCard compact className="border-border">
          <span className="label-caps block">
            Tokens Processed &amp; Cache Hit
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold tabular-nums text-foreground">
              {fmtCompact(totalTokens)}
            </span>
            <span className="text-xs text-success font-semibold tabular-nums">
              78.2% Cache Hit
            </span>
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">
            Zero re-compute cost on warm prompt prefixes
          </p>
        </SectionCard>
      </div>

      {/* Chargeback Table */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/20 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Tenant &amp; Workload Cost Attribution
            </h3>
            <p className="text-2xs text-muted-foreground">
              In-line token quotas and cost-center allocations enforced by F5
              BNK.
            </p>
          </div>
          <Badge
            variant="outline"
            className="text-2xs font-mono gap-1 border-border"
          >
            <ShieldCheck className="h-3 w-3 text-success" />
            {throttledCount > 0
              ? `${throttledCount} In-Line 429 Throttle Active`
              : "All Quotas Within Limit"}
          </Badge>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/40">
              <TableHead className="text-xs font-semibold">
                Workload / Agent
              </TableHead>
              <TableHead className="text-xs font-semibold">
                Tenant &amp; Cost Center
              </TableHead>
              <TableHead className="text-xs font-semibold">Cluster</TableHead>
              <TableHead className="text-xs font-semibold">
                InferencePool
              </TableHead>
              <TableHead className="text-xs font-semibold text-right">
                Tokens
              </TableHead>
              <TableHead className="text-xs font-semibold text-right">
                Cache Hit
              </TableHead>
              <TableHead className="text-xs font-semibold w-[160px]">
                Budget &amp; Spend (MTD)
              </TableHead>
              <TableHead className="text-xs font-semibold">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-xs">
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-24 text-center text-xs text-muted-foreground"
                >
                  No workloads found for the selected cluster.
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => {
                const pct = Math.round(
                  (row.currentSpend / row.monthlyBudget) * 100,
                );
                const isThrottled = row.status === "enforcing" || pct >= 100;

                return (
                  <TableRow key={row.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        <Bot className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="font-mono text-sm">
                          {row.agentName}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div>{row.tenant}</div>
                      <code className="text-2xs text-muted-foreground font-mono">
                        {row.costCenter}
                      </code>
                    </TableCell>

                    <TableCell>
                      <span className="font-mono text-2xs text-muted-foreground">
                        {row.clusterName}
                      </span>
                    </TableCell>

                    <TableCell>
                      <code className="text-2xs font-mono font-medium">
                        {row.targetPool}
                      </code>
                      <div className="text-2xs text-muted-foreground">
                        {row.primaryModel}
                      </div>
                    </TableCell>

                    <TableCell className="text-right font-mono">
                      {fmtCompact(row.tokensProcessed)}
                    </TableCell>

                    <TableCell className="text-right">
                      <Badge variant="success" className="text-2xs font-mono">
                        {row.cacheHitPct}%
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex justify-between text-2xs font-mono">
                          <span>${row.currentSpend.toLocaleString()}</span>
                          <span className="text-muted-foreground">
                            / ${row.monthlyBudget.toLocaleString()}
                          </span>
                        </div>
                        <Progress
                          value={Math.min(pct, 100)}
                          className={`h-1 ${isThrottled ? "[&>div]:bg-warning" : ""}`}
                        />
                      </div>
                    </TableCell>

                    <TableCell>
                      {isThrottled ? (
                        <Badge variant="warning" className="text-2xs font-mono">
                          429 Throttled
                        </Badge>
                      ) : (
                        <Badge variant="success" className="text-2xs font-mono">
                          Active (OK)
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
