/**
 * LlmLogs — per-request log explorer for the AI gateway (Tier 1).
 *
 * Header (refresh · live toggle · debounced search · column config) + a stat
 * strip + a zoomable request-volume histogram (drag-select to zoom, reset) +
 * a sortable request table with time-cursor "load older" + a detail drawer
 * that reconstructs the chat transcript from req_body/resp_body.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import {
  Activity,
  CheckCircle2,
  Clock,
  Hash,
  DollarSign,
  Boxes,
  Search,
  Settings2,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ListFilter,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import {
  StatTile,
  TimeRangePicker,
  ClusterPicker,
  FilterSelect,
  CHART_GRID,
  CHART_TEXT,
  CHART_TOOLTIP,
  SUCCESS_COLOR,
  fmtInt,
  fmtCompact,
  fmtCost,
  fmtLatencyMs,
  fmtPct,
} from "@/components/observability";
import {
  useLlmStats,
  useLlmHistogram,
  useLlmLogs,
  useLlmFilterData,
} from "@/hooks/useLlmObservability";
import { llmObservabilityApi } from "@/lib/api/llmObservability";
import { useObservabilityFilters } from "./use-observability-filters";
import { parseTranscript } from "./transcript";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import type { LlmLogRow } from "@/types/llm-observability";

const PAGE_LIMIT = 50;

type SortKey = "ts" | "latency_ms" | "total_tk" | "cost";
type SortDir = "asc" | "desc";

const OPTIONAL_COLUMNS = ["model", "tokens", "cost", "status"] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

const TRAFFIC_STATUS_VIEWS = [
  {
    value: "",
    label: "All Requests",
    subtitle: "Per-request audit trail across all gateway status codes.",
    icon: ListFilter,
  },
  {
    value: "200",
    label: "Successful (2xx)",
    subtitle: "Completed LLM inference requests (HTTP 200).",
    icon: CheckCircle2,
  },
  {
    value: "429",
    label: "Rate Limited (429)",
    subtitle: "Token or request quota throttled traffic (HTTP 429).",
    icon: AlertTriangle,
  },
  {
    value: "500",
    label: "Server Errors (5xx)",
    subtitle: "Upstream model or gateway error responses (HTTP 5xx).",
    icon: XCircle,
  },
] as const;

export default function LlmLogs() {
  const f = useObservabilityFilters("logs");
  const { data: filterData } = useLlmFilterData(f.clusterId, f.range);

  const [live, setLive] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput, 300);
  const [visibleCols, setVisibleCols] = useState<
    Record<OptionalColumn, boolean>
  >({
    model: true,
    tokens: true,
    cost: true,
    status: true,
  });

  const [sortKey, setSortKey] = useState<SortKey>("ts");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<number | null>(null);

  const logParams = useMemo(
    () => ({
      ...f.queryParams,
      limit: PAGE_LIMIT,
      ...(search ? { content_search: search } : {}),
    }),
    [f.queryParams, search],
  );

  const stats = useLlmStats(f.clusterId, f.queryParams);
  const histogram = useLlmHistogram(
    f.clusterId,
    { ...f.queryParams, metric: "requests" },
    true,
  );
  const logs = useLlmLogs(f.clusterId, logParams, { live });

  // Accumulated "load older" pages, reset whenever the base query changes.
  const [olderRows, setOlderRows] = useState<LlmLogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const paramKey = JSON.stringify(logParams) + String(f.clusterId);
  const prevKey = useRef(paramKey);
  useEffect(() => {
    if (prevKey.current !== paramKey) {
      prevKey.current = paramKey;
      setOlderRows([]);
      setCursor(null);
    }
  }, [paramKey]);

  const allRows = useMemo(() => {
    const seen = new Set<string>();
    const merged: LlmLogRow[] = [];
    for (const r of [...(logs.data?.rows ?? []), ...olderRows]) {
      const id = `${r.cluster_id ?? ""}-${r.ts}-${r.model}-${r.total_tk}`;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(r);
    }
    return merged;
  }, [logs.data, olderRows]);

  const sortedRows = useMemo(() => {
    const rows = [...allRows];
    rows.sort((a, b) => {
      const av = sortKey === "ts" ? Date.parse(a.ts) : a[sortKey];
      const bv = sortKey === "ts" ? Date.parse(b.ts) : b[sortKey];
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [allRows, sortKey, sortDir]);

  const nextEnd = cursor ?? logs.data?.next_end ?? null;

  const loadOlder = useCallback(async () => {
    if (f.clusterId === undefined || !nextEnd) return;
    setLoadingOlder(true);
    try {
      const res = await llmObservabilityApi.getLogs(f.clusterId ?? undefined, {
        ...logParams,
        end: nextEnd,
      });
      setOlderRows((prev) => [...prev, ...res.rows]);
      setCursor(res.next_end);
    } finally {
      setLoadingOlder(false);
    }
  }, [f.clusterId, nextEnd, logParams]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  const refresh = () => {
    setOlderRows([]);
    setCursor(null);
    void logs.refetch();
    void stats.refetch();
    void histogram.refetch();
  };

  const activeStatusMeta =
    TRAFFIC_STATUS_VIEWS.find((v) => v.value === f.status) ??
    TRAFFIC_STATUS_VIEWS[0];

  return (
    <div className="flex min-h-[calc(100vh-3rem)]">
      {/* Left Flush Inner Sub-Sidebar */}
      <CollapsibleInnerSidebar className="w-52 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
        <div className="px-2 pt-1 pb-2 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground">
            AI Traffic Logs
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Prompt/response audit trail, latency &amp; token telemetry
          </p>
        </div>

        <div className="space-y-1">
          <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            TRAFFIC VIEWS
          </div>
          <div
            role="navigation"
            aria-label="Traffic status views"
            className="flex flex-col items-stretch gap-0.5"
          >
            {TRAFFIC_STATUS_VIEWS.map((view) => {
              const Icon = view.icon;
              const isActive = f.status === view.value;
              return (
                <button
                  key={view.label}
                  type="button"
                  onClick={() => f.setStatus(view.value)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors text-left",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{view.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </CollapsibleInnerSidebar>

      {/* Right Content Pane */}
      <div className="flex-1 min-w-0 p-6 space-y-5 overflow-y-auto">
        {/* Top Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {activeStatusMeta.label}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {activeStatusMeta.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <ClusterPicker
              value={f.clusterId}
              onChange={f.setClusterId}
              showProjectSelector
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground px-2.5 h-8 rounded-md border border-border bg-card/50">
              <Switch
                checked={live}
                onCheckedChange={setLive}
                aria-label="Live"
              />
              Live
              {live && (
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              )}
            </label>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={refresh}
              disabled={logs.isFetching}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${logs.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search request text…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <FilterSelect
              value={f.model}
              onChange={f.setModel}
              options={filterData?.models ?? []}
              allLabel="All models"
              placeholder="Model"
              width="w-[150px]"
              ariaLabel="Model filter"
            />
            <TimeRangePicker value={f.range} onChange={f.setRange} />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              {OPTIONAL_COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col}
                  checked={visibleCols[col]}
                  onCheckedChange={(v) =>
                    setVisibleCols((prev) => ({ ...prev, [col]: !!v }))
                  }
                  className="capitalize"
                >
                  {col}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile
            icon={Activity}
            label="Total Requests"
            tone="primary"
            loading={stats.isLoading}
            value={fmtInt(stats.data?.total_requests)}
          />
          <StatTile
            icon={CheckCircle2}
            label="Success Rate"
            tone="success"
            loading={stats.isLoading}
            value={fmtPct(stats.data?.success_rate)}
          />
          <StatTile
            icon={Clock}
            label="Avg Latency"
            tone="info"
            loading={stats.isLoading}
            value={fmtLatencyMs(stats.data?.avg_latency_ms)}
          />
          <StatTile
            icon={Hash}
            label="Total Tokens"
            tone="warning"
            loading={stats.isLoading}
            value={fmtCompact(stats.data?.total_tokens)}
          />
          <StatTile
            icon={DollarSign}
            label="Total Cost"
            tone="success"
            loading={stats.isLoading}
            value={fmtCost(stats.data?.total_cost)}
          />
          <StatTile
            icon={Boxes}
            label="Models"
            tone="muted"
            loading={stats.isLoading}
            value={fmtInt(stats.data?.models)}
          />
        </div>

        <ZoomableHistogram
          series={histogram.data?.series ?? []}
          loading={histogram.isLoading}
          available={histogram.data?.available ?? true}
        />

        {/* Request table */}
        <SectionCard compact>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead
                    label="Time"
                    k="ts"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <TableHead>Request</TableHead>
                  {visibleCols.model && <TableHead>Model</TableHead>}
                  <SortHead
                    label="Latency"
                    k="latency_ms"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  {visibleCols.tokens && (
                    <SortHead
                      label="Tokens"
                      k="total_tk"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={toggleSort}
                      align="right"
                    />
                  )}
                  {visibleCols.cost && (
                    <SortHead
                      label="Cost"
                      k="cost"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={toggleSort}
                      align="right"
                    />
                  )}
                  {visibleCols.status && (
                    <TableHead className="text-right">Status</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-40 w-full" />
                    </TableCell>
                  </TableRow>
                ) : sortedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="p-6">
                      <EmptyState
                        icon={Activity}
                        title={
                          logs.data?.available === false
                            ? "Log source unavailable"
                            : "No requests in this window"
                        }
                        description={
                          logs.data?.available === false
                            ? logs.data?.errors?.logs ||
                              "Log telemetry source is unreachable."
                            : "No request telemetry matches the selected filter."
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedRows.map((row, i) => (
                    <TableRow
                      key={`${row.ts}-${i}`}
                      className="cursor-pointer"
                      onClick={() => setSelected(i)}
                    >
                      <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {fmtTime(row.ts)}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-foreground/90">
                        {row.cluster_name && (
                          <Badge
                            variant="outline"
                            className="mr-1.5 text-2xs font-mono py-0 px-1 text-muted-foreground"
                          >
                            {row.cluster_name}
                          </Badge>
                        )}
                        {row.message || "—"}
                      </TableCell>
                      {visibleCols.model && (
                        <TableCell className="text-xs text-foreground/80">
                          {row.model}
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums text-foreground/80">
                        {fmtLatencyMs(row.latency_ms)}
                      </TableCell>
                      {visibleCols.tokens && (
                        <TableCell className="text-right tabular-nums text-foreground/80">
                          {fmtInt(row.total_tk)}
                        </TableCell>
                      )}
                      {visibleCols.cost && (
                        <TableCell className="text-right tabular-nums text-foreground/80">
                          {fmtCost(row.cost)}
                        </TableCell>
                      )}
                      {visibleCols.status && (
                        <TableCell className="text-right">
                          <StatusBadge status={row.status} />
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {nextEnd && sortedRows.length > 0 && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={loadOlder}
                disabled={loadingOlder}
                className="h-8"
              >
                {loadingOlder ? "Loading…" : "Load older"}
              </Button>
            </div>
          )}
        </SectionCard>

        <LogDetailDrawer
          rows={sortedRows}
          index={selected}
          onIndexChange={setSelected}
          onClose={() => setSelected(null)}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Zoomable histogram
// ============================================================================

interface HistoRow {
  ts: string;
  value: number;
}

function ZoomableHistogram({
  series,
  loading,
  available,
}: {
  series: { name: string; points: { ts: string; value: number }[] }[];
  loading: boolean;
  available: boolean;
}) {
  const data: HistoRow[] = useMemo(() => {
    const byTs = new Map<string, number>();
    for (const s of series) {
      for (const p of s.points) byTs.set(p.ts, (byTs.get(p.ts) ?? 0) + p.value);
    }
    return Array.from(byTs.entries())
      .map(([ts, value]) => ({ ts, value }))
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
  }, [series]);

  const [refLeft, setRefLeft] = useState<string | null>(null);
  const [refRight, setRefRight] = useState<string | null>(null);
  const [zoom, setZoom] = useState<[string, string] | null>(null);

  const shown = useMemo(() => {
    if (!zoom) return data;
    const [a, b] = zoom;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    return data.filter((d) => d.ts >= lo && d.ts <= hi);
  }, [data, zoom]);

  const applyZoom = () => {
    if (refLeft && refRight && refLeft !== refRight)
      setZoom([refLeft, refRight]);
    setRefLeft(null);
    setRefRight(null);
  };

  if (loading) return <Skeleton className="h-[200px] w-full" />;
  if (!available) {
    return (
      <SectionCard compact>
        <p className="text-sm text-muted-foreground">Histogram unavailable.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard compact>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">
          Request Volume
        </h4>
        {zoom && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => setZoom(null)}
          >
            Reset zoom
          </Button>
        )}
      </div>
      <ResponsiveContainer
        width="100%"
        height={200}
        minWidth={0}
        minHeight={200}
      >
        <BarChart
          data={shown}
          onMouseDown={(e) =>
            e?.activeLabel && setRefLeft(String(e.activeLabel))
          }
          onMouseMove={(e) =>
            refLeft && e?.activeLabel && setRefRight(String(e.activeLabel))
          }
          onMouseUp={applyZoom}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
          <XAxis
            dataKey="ts"
            tickFormatter={fmtTime}
            tick={{ fill: CHART_TEXT, fontSize: 10 }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v) => fmtCompact(Number(v))}
            tick={{ fill: CHART_TEXT, fontSize: 10 }}
            width={44}
          />
          <RechartsTooltip
            contentStyle={CHART_TOOLTIP}
            labelFormatter={(l) => fmtTime(String(l))}
            formatter={(v) => [fmtInt(Number(v)), "requests"]}
          />
          <Bar
            dataKey="value"
            fill={SUCCESS_COLOR}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
          {refLeft && refRight && (
            <ReferenceArea x1={refLeft} x2={refRight} strokeOpacity={0.3} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </SectionCard>
  );
}

// ============================================================================
// Detail drawer
// ============================================================================

function LogDetailDrawer({
  rows,
  index,
  onIndexChange,
  onClose,
}: {
  rows: LlmLogRow[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const row = index != null ? rows[index] : undefined;
  const turns = useMemo(
    () => (row ? parseTranscript(row.req_body, row.resp_body) : []),
    [row],
  );

  return (
    <Sheet open={index != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="truncate">{row.model}</span>
                <StatusBadge status={row.status} />
                {row.cluster_name && (
                  <Badge
                    variant="outline"
                    className="font-mono text-2xs font-normal text-muted-foreground"
                  >
                    {row.cluster_name}
                  </Badge>
                )}
              </SheetTitle>
            </SheetHeader>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground tabular-nums">
                {fmtTime(row.ts)}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={index === 0}
                  onClick={() => index != null && onIndexChange(index - 1)}
                  aria-label="Previous request"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={index === rows.length - 1}
                  onClick={() => index != null && onIndexChange(index + 1)}
                  aria-label="Next request"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Metrics */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Latency" value={fmtLatencyMs(row.latency_ms)} />
              <Metric label="Prompt tk" value={fmtInt(row.prompt_tk)} />
              <Metric label="Completion tk" value={fmtInt(row.comp_tk)} />
              <Metric label="Cost" value={fmtCost(row.cost)} />
            </div>

            {/* Transcript */}
            <div className="mt-5">
              <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                Transcript
              </h5>
              <div className="space-y-2">
                {turns.map((t, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border p-2.5"
                  >
                    <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t.role}
                    </div>
                    <div className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                      {t.content || "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Raw JSON */}
            <details className="mt-5">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                Raw JSON
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-2 text-2xs leading-relaxed">
                {JSON.stringify(
                  { request: row.req_body, response: row.resp_body },
                  null,
                  2,
                )}
              </pre>
            </details>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm font-medium text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}

// ============================================================================
// Shared bits
// ============================================================================

function SortHead({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  const Icon = sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active && <Icon className="h-3 w-3" />}
      </button>
    </TableHead>
  );
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
