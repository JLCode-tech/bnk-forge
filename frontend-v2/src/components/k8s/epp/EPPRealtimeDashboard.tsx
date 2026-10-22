import { useState, useEffect, useMemo } from "react";
import {
  Activity,
  Cpu,
  Zap,
  Clock,
  Database,
  Server,
  RefreshCw,
  Layers,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  BarChart2,
  Box,
  Sliders,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  useAnalyzerRuntimeMetrics,
  type EppSummaryMetrics,
} from "@/hooks/useAnalyzerMetrics";
import type { K8sResource } from "@/types";

// Chart chrome tokens
const CHART_GRID = "hsl(var(--border))";
const CHART_TEXT = "hsl(var(--muted-foreground))";
const CHART_TOOLTIP = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--foreground))",
};

interface RollingPoint {
  time: string;
  outputTps: number;
  promptTps: number;
  totalTps: number;
  ttftMs: number;
  itlMs: number;
  cacheHitPct: number;
  kvUsedPct: number;
}

interface EPPRealtimeDashboardProps {
  clusterId: number;
  eppResources: K8sResource[];
  initialSelectedName?: string;
  pools?: K8sResource[];
  httpRoutes?: K8sResource[];
}

export function EPPRealtimeDashboard({
  clusterId,
  eppResources,
  initialSelectedName,
  pools = [],
  httpRoutes: _httpRoutes = [],
}: EPPRealtimeDashboardProps) {
  // 1. Selected EPP state
  const defaultEpp = useMemo(() => {
    if (!eppResources.length) return null;
    if (initialSelectedName) {
      const match = eppResources.find(
        (r) => r.metadata?.name === initialSelectedName,
      );
      if (match) return match;
    }
    return eppResources[0];
  }, [eppResources, initialSelectedName]);

  const [selectedEppName, setSelectedEppName] = useState<string>(
    defaultEpp?.metadata?.name || "",
  );

  const activeEpp = useMemo(() => {
    return (
      eppResources.find((r) => r.metadata?.name === selectedEppName) ||
      defaultEpp
    );
  }, [eppResources, selectedEppName, defaultEpp]);

  const eppNamespace = activeEpp?.metadata?.namespace || "default";
  const eppName = activeEpp?.metadata?.name || "";

  // 2. Live Polling Controls
  const [isLive, setIsLive] = useState(true);
  const [pollInterval, setPollInterval] = useState<number>(3000);

  // 3. Query Real-Time Telemetry
  const {
    data: metrics,
    refetch,
    isFetching,
  } = useAnalyzerRuntimeMetrics(
    clusterId,
    eppNamespace,
    eppName,
    !!eppName,
    isLive ? pollInterval : false,
  );

  // 4. Rolling Real-Time History Buffer (last 20 points)
  const [history, setHistory] = useState<RollingPoint[]>([]);

  useEffect(() => {
    setHistory([]);
  }, [clusterId, eppNamespace, eppName]);

  useEffect(() => {
    if (!metrics?.summary) return;
    if (metrics.history && metrics.history.length > 0) {
      setHistory(
        metrics.history.map((pt) => ({
          time: pt.ts,
          outputTps: pt.output_tps,
          promptTps: pt.prompt_tps,
          totalTps: pt.total_tps,
          ttftMs: pt.ttft_ms,
          itlMs: pt.itl_ms,
          cacheHitPct: pt.cache_hit_pct,
          kvUsedPct: pt.kv_used_pct,
        })),
      );
      return;
    }
    const now = new Date();
    const fmtTime = (d: Date) =>
      `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;

    setHistory((prev) => {
      const baseOut = metrics.summary?.output_tps || 0;
      const basePrompt = metrics.summary?.prompt_tps || 0;
      const baseTot = metrics.summary?.total_tps || 0;
      const baseTtft = metrics.summary?.ttft_p95_ms || 0;
      const baseItl = metrics.summary?.itl_p95_ms || 0;
      const baseCache = metrics.summary?.cache_hit_rate_pct || 0;
      const baseKv = metrics.summary?.kv_cache_usage_pct || 0;

      const newPoint: RollingPoint = {
        time: fmtTime(now),
        outputTps: baseOut,
        promptTps: basePrompt,
        totalTps: baseTot,
        ttftMs: baseTtft,
        itlMs: baseItl,
        cacheHitPct: baseCache,
        kvUsedPct: baseKv,
      };

      const next = [...prev, newPoint];
      if (next.length > 25) {
        return next.slice(next.length - 25);
      }
      return next;
    });
  }, [metrics?.updated_at, metrics?.summary, metrics?.history]);

  // Spec & Pool Lookups
  const spec = activeEpp?.spec || {};
  const poolRefName =
    typeof spec.poolRef === "string" ? spec.poolRef : spec.poolRef?.name || "";
  const matchingPool = pools.find(
    (p) =>
      p.metadata?.name === poolRefName &&
      p.metadata?.namespace === eppNamespace,
  );
  const engine = spec.engine || metrics?.epp_info?.engine || "unknown";
  const tokenizer =
    spec.tokenizer?.name ||
    spec.tokenizer ||
    metrics?.epp_info?.tokenizer ||
    "Not configured";
  const blockSize = spec.blockSize || metrics?.epp_info?.block_size || 0;
  const routingMode = spec.mode || metrics?.epp_info?.mode || "unknown";

  const summary: EppSummaryMetrics = {
    traffic_status:
      metrics?.summary?.traffic_status ??
      ((metrics?.summary?.num_requests_running || 0) > 0 ||
      (metrics?.summary?.output_tps || 0) > 0
        ? "active"
        : "idle"),
    is_active_traffic:
      metrics?.summary?.is_active_traffic ??
      ((metrics?.summary?.num_requests_running || 0) > 0 ||
        (metrics?.summary?.output_tps || 0) > 0),
    ttft_p50_ms: metrics?.summary?.ttft_p50_ms ?? 0,
    ttft_p95_ms: metrics?.summary?.ttft_p95_ms ?? 0,
    itl_p50_ms: metrics?.summary?.itl_p50_ms ?? 0,
    itl_p95_ms: metrics?.summary?.itl_p95_ms ?? 0,
    latency_p50_ms:
      metrics?.summary?.latency_p50_ms ??
      ((metrics?.summary as unknown as Record<string, unknown>)
        ?.e2e_p50_ms as number) ??
      0,
    latency_p95_ms:
      metrics?.summary?.latency_p95_ms ??
      ((metrics?.summary as unknown as Record<string, unknown>)
        ?.e2e_p95_ms as number) ??
      0,
    output_tps: metrics?.summary?.output_tps ?? 0,
    prompt_tps: metrics?.summary?.prompt_tps ?? 0,
    total_tps: metrics?.summary?.total_tps ?? 0,
    requests_per_minute: metrics?.summary?.requests_per_minute ?? 0,
    cache_hit_rate_pct: metrics?.summary?.cache_hit_rate_pct ?? 0,
    kv_cache_usage_pct: metrics?.summary?.kv_cache_usage_pct ?? 0,
    num_requests_running: metrics?.summary?.num_requests_running ?? 0,
    num_requests_waiting: metrics?.summary?.num_requests_waiting ?? 0,
    cumulative_total_tokens: metrics?.summary?.cumulative_total_tokens ?? 0,
    cumulative_total_prompt_tokens:
      metrics?.summary?.cumulative_total_prompt_tokens ?? 0,
    cumulative_total_requests: metrics?.summary?.cumulative_total_requests ?? 0,
  };

  const endpoints = metrics?.endpoints?.length ? metrics.endpoints : [];

  // Latency comparison data for Recharts
  const latencyChartData = [
    {
      metric: "TTFT (Time to 1st Token)",
      p50: summary.ttft_p50_ms,
      p95: summary.ttft_p95_ms,
    },
    {
      metric: "ITL (Inter-Token Latency)",
      p50: summary.itl_p50_ms,
      p95: summary.itl_p95_ms,
    },
    {
      metric: "End-to-End Latency",
      p50: summary.latency_p50_ms,
      p95: summary.latency_p95_ms,
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Top Bar / Live Toolbar ────────────────────────────────────────── */}
      <Card className="border-border/80 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      F5 EPP Real-Time AI Analyzer
                    </h2>
                    <Badge
                      variant="outline"
                      className="font-mono text-xs uppercase bg-primary/5 text-primary border-primary/30"
                    >
                      GAIE Native
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Real-time inference telemetry, KV-cache prefix awareness,
                    and dynamic token load balancing
                  </p>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              {eppResources.length > 1 && (
                <div className="w-56">
                  <Select
                    value={selectedEppName}
                    onValueChange={(val) => setSelectedEppName(val)}
                  >
                    <SelectTrigger className="h-8 text-xs font-mono">
                      <SelectValue placeholder="Select EPP Analyzer" />
                    </SelectTrigger>
                    <SelectContent>
                      {eppResources.map((r) => (
                        <SelectItem
                          key={r.metadata?.name}
                          value={r.metadata?.name || ""}
                          className="text-xs font-mono"
                        >
                          {r.metadata?.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Traffic State Indicator */}
              {summary.is_active_traffic ? (
                <Badge
                  variant="outline"
                  className="h-7 px-2.5 text-xs gap-1.5 font-medium border-success/40 bg-success/10 text-success"
                >
                  <span className="h-2 w-2 rounded-full bg-success animate-ping" />
                  Active ({summary.output_tps.toFixed(0)} tok/s)
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="h-7 px-2.5 text-xs gap-1.5 font-medium border-muted-foreground/30 bg-muted/40 text-muted-foreground"
                >
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                  Idle (Ready for Traffic)
                </Badge>
              )}

              {/* Live Polling Badge & Cadence Toggle */}
              <div className="flex items-center gap-2 bg-muted/40 p-1 rounded-lg border border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-xs gap-1.5 font-medium",
                    isLive
                      ? "text-success hover:text-success"
                      : "text-muted-foreground",
                  )}
                  onClick={() => setIsLive(!isLive)}
                >
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      isLive
                        ? "bg-success animate-pulse"
                        : "bg-muted-foreground",
                    )}
                  />
                  {isLive ? "LIVE" : "PAUSED"}
                </Button>

                {isLive && (
                  <Select
                    value={String(pollInterval)}
                    onValueChange={(val) => setPollInterval(Number(val))}
                  >
                    <SelectTrigger className="h-6 w-16 text-2xs font-mono border-0 bg-transparent px-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2000" className="text-xs">
                        2s
                      </SelectItem>
                      <SelectItem value="3000" className="text-xs">
                        3s
                      </SelectItem>
                      <SelectItem value="5000" className="text-xs">
                        5s
                      </SelectItem>
                      <SelectItem value="10000" className="text-xs">
                        10s
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 gap-1.5 text-xs"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
                />
                Refresh
              </Button>
            </div>
          </div>

          {/* Active EPP Metadata Ribbon */}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/40 text-xs">
            <span className="text-muted-foreground">Active EPP:</span>
            <code className="px-2 py-0.5 rounded bg-muted font-mono font-semibold text-foreground">
              {eppName}
            </code>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-muted-foreground">Namespace:</span>
            <span className="font-mono text-foreground/80">{eppNamespace}</span>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-muted-foreground">Model Tokenizer:</span>
            <Badge variant="secondary" className="font-mono text-2xs">
              {tokenizer}
            </Badge>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-muted-foreground">Engine:</span>
            <Badge
              variant="outline"
              className="text-2xs uppercase font-semibold text-primary border-primary/40"
            >
              {engine}
            </Badge>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-muted-foreground">Block Size:</span>
            <span className="tabular-nums text-foreground/80">{blockSize}</span>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-muted-foreground">Mode:</span>
            <Badge variant="secondary" className="text-2xs capitalize">
              {routingMode}
            </Badge>
            {poolRefName && (
              <>
                <span className="text-muted-foreground mx-1">·</span>
                <span className="text-muted-foreground">Pool:</span>
                <div className="flex items-center gap-1">
                  <Server className="h-3 w-3 text-info" />
                  <code className="font-mono text-foreground">
                    {poolRefName}
                  </code>
                </div>
              </>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* ── High-Impact Real-Time KPI Grid (Benchmark Style) ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* 1. Prefix Cache Hit Rate */}
        <Card className="p-3 bg-card border-border/80">
          <div className="flex items-center justify-between text-muted-foreground text-xs pb-1">
            <span>Prefix Cache</span>
            <Database className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold tabular-nums tracking-tight text-foreground">
            {summary.cache_hit_rate_pct.toFixed(1)}%
          </div>
          <div className="text-2xs text-muted-foreground mt-0.5 truncate">
            {summary.is_active_traffic ? "Live KV Reuse" : "Recorded Hit Rate"}
          </div>
        </Card>

        {/* 2. TTFT p50 */}
        <Card className="p-3 bg-card border-border/80">
          <div className="flex items-center justify-between text-muted-foreground text-xs pb-1">
            <span>TTFT p50</span>
            <Clock className="h-3.5 w-3.5 text-info" />
          </div>
          <div className="text-xl font-bold tabular-nums tracking-tight text-info">
            {summary.ttft_p50_ms > 0 ? (
              <>
                {summary.ttft_p50_ms.toFixed(0)}{" "}
                <span className="text-xs font-normal">ms</span>
              </>
            ) : (
              <span className="text-muted-foreground text-base font-normal">
                —
              </span>
            )}
          </div>
          <div className="text-2xs text-muted-foreground mt-0.5 truncate">
            {summary.is_active_traffic
              ? "Median Time to Token"
              : "Baseline Median (p50)"}
          </div>
        </Card>

        {/* 3. TTFT p95 */}
        <Card className="p-3 bg-card border-border/80">
          <div className="flex items-center justify-between text-muted-foreground text-xs pb-1">
            <span>TTFT p95</span>
            <Clock className="h-3.5 w-3.5 text-warning" />
          </div>
          <div className="text-xl font-bold tabular-nums tracking-tight text-warning">
            {summary.ttft_p95_ms > 0 ? (
              <>
                {summary.ttft_p95_ms.toFixed(0)}{" "}
                <span className="text-xs font-normal">ms</span>
              </>
            ) : (
              <span className="text-muted-foreground text-base font-normal">
                —
              </span>
            )}
          </div>
          <div className="text-2xs text-muted-foreground mt-0.5 truncate">
            {summary.is_active_traffic
              ? "Tail Pre-Fill Latency"
              : "Baseline Tail (p95)"}
          </div>
        </Card>

        {/* 4. ITL p95 */}
        <Card className="p-3 bg-card border-border/80">
          <div className="flex items-center justify-between text-muted-foreground text-xs pb-1">
            <span>Inter-Token</span>
            <Zap className="h-3.5 w-3.5 text-success" />
          </div>
          <div className="text-xl font-bold tabular-nums tracking-tight text-success">
            {summary.itl_p95_ms > 0 ? (
              <>
                {summary.itl_p95_ms.toFixed(1)}{" "}
                <span className="text-xs font-normal">ms</span>
              </>
            ) : (
              <span className="text-muted-foreground text-base font-normal">
                —
              </span>
            )}
          </div>
          <div className="text-2xs text-muted-foreground mt-0.5 truncate">
            {summary.is_active_traffic
              ? "Live ITL per token"
              : "Baseline ITL p95"}
          </div>
        </Card>

        {/* 5. Generation Velocity (Output TPS) */}
        <Card className="p-3 bg-card border-border/80">
          <div className="flex items-center justify-between text-muted-foreground text-xs pb-1">
            <span>Output TPS</span>
            <Activity className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold tabular-nums tracking-tight text-primary">
            {summary.output_tps.toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}
          </div>
          <div className="text-2xs text-muted-foreground mt-0.5 truncate">
            {summary.is_active_traffic
              ? "Active Generation Speed"
              : `Idle · ${(summary.cumulative_total_tokens || 0).toLocaleString()} lifetime tok`}
          </div>
        </Card>

        {/* 6. Active Concurrency */}
        <Card className="p-3 bg-card border-border/80">
          <div className="flex items-center justify-between text-muted-foreground text-xs pb-1">
            <span>Active / Queue</span>
            <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold tabular-nums tracking-tight text-foreground">
            {summary.num_requests_running}{" "}
            <span className="text-muted-foreground text-sm font-normal">
              / {summary.num_requests_waiting}
            </span>
          </div>
          <div className="text-2xs text-muted-foreground mt-0.5 truncate">
            Running / Waiting
          </div>
        </Card>

        {/* 7. KV-Cache Memory */}
        <Card className="p-3 bg-card border-border/80">
          <div className="flex items-center justify-between text-muted-foreground text-xs pb-1">
            <span>KV Cache Fill</span>
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold tabular-nums tracking-tight text-foreground">
            {summary.kv_cache_usage_pct.toFixed(1)}%
          </div>
          <div className="text-2xs text-muted-foreground mt-0.5 truncate">
            GPU Block Memory
          </div>
        </Card>

        {/* 8. End-to-End p95 */}
        <Card className="p-3 bg-card border-border/80">
          <div className="flex items-center justify-between text-muted-foreground text-xs pb-1">
            <span>E2E p95</span>
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold tabular-nums tracking-tight text-foreground">
            {summary.latency_p95_ms > 0 ? (
              <>
                {summary.latency_p95_ms.toFixed(0)}{" "}
                <span className="text-xs font-normal">ms</span>
              </>
            ) : (
              <span className="text-muted-foreground text-base font-normal">
                —
              </span>
            )}
          </div>
          <div className="text-2xs text-muted-foreground mt-0.5 truncate">
            {summary.is_active_traffic
              ? "Full Request Latency"
              : "Baseline Full Latency"}
          </div>
        </Card>
      </div>

      {/* ── Main View Tabs ────────────────────────────────────────────────── */}
      <Tabs defaultValue="telemetry" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="telemetry" className="text-xs gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Live Telemetry &amp; Routing
          </TabsTrigger>
          <TabsTrigger value="architecture" className="text-xs gap-1.5">
            <Sliders className="h-3.5 w-3.5" />
            EPP Topology &amp; Architecture
          </TabsTrigger>
          <TabsTrigger value="manifest" className="text-xs gap-1.5">
            <Box className="h-3.5 w-3.5" />
            Declarative CRD Manifests
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Live Telemetry & Routing Matrix ─────────────────────── */}
        <TabsContent value="telemetry" className="space-y-6 pt-4">
          {/* Visual Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Real-Time Token Generation Velocity */}
            <Card className="border-border/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Real-Time Token &amp; Request Velocity
                  </span>
                  <Badge variant="outline" className="text-2xs font-mono">
                    Output Tok/s
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Streaming throughput collected directly from active inference
                  pods
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={history}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="colorOutputTps"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="hsl(var(--primary))"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="hsl(var(--primary))"
                            stopOpacity={0.0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={CHART_GRID}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="time"
                        stroke={CHART_TEXT}
                        fontSize={11}
                        tickLine={false}
                      />
                      <YAxis
                        stroke={CHART_TEXT}
                        fontSize={11}
                        tickLine={false}
                      />
                      <RechartsTooltip contentStyle={CHART_TOOLTIP} />
                      <Area
                        type="monotone"
                        dataKey="outputTps"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorOutputTps)"
                        name="Output TPS"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Chart 2: Latency Percentile Split (TTFT vs ITL vs E2E) */}
            <Card className="border-border/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <BarChart2 className="h-4 w-4 text-info" />
                    Latency Percentile Breakdown
                  </span>
                  <Badge variant="outline" className="text-2xs font-mono">
                    p50 vs p95 (ms)
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Histogram distribution across prefill (TTFT), token generation
                  (ITL), and end-to-end
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={latencyChartData}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={CHART_GRID}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="metric"
                        stroke={CHART_TEXT}
                        fontSize={11}
                        tickLine={false}
                      />
                      <YAxis
                        stroke={CHART_TEXT}
                        fontSize={11}
                        tickLine={false}
                      />
                      <RechartsTooltip contentStyle={CHART_TOOLTIP} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar
                        dataKey="p50"
                        fill="hsl(var(--info))"
                        name="p50 (Median)"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="p95"
                        fill="hsl(var(--warning))"
                        name="p95 (Tail)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── The Benchmark Routing Table for EPP ──────────────────────── */}
          <Card className="border-border/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Server className="h-4 w-4 text-primary" />
                    Inference Endpoint Routing Matrix
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Live endpoint traffic allocation, prefix KV-cache
                    utilization, and per-pod latency
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs font-mono">
                  {endpoints.length} Active Endpoints
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 text-xs">
                      <TableHead className="w-56 font-semibold">
                        Pod / Endpoint
                      </TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="w-48 font-semibold">
                        Cumulative Traffic Share
                      </TableHead>
                      <TableHead className="w-44 font-semibold">
                        KV-Cache Fill
                      </TableHead>
                      <TableHead className="font-semibold text-center">
                        Active / Queue
                      </TableHead>
                      <TableHead className="font-semibold text-right">
                        TTFT p95
                      </TableHead>
                      <TableHead className="font-semibold text-right">
                        ITL p95
                      </TableHead>
                      <TableHead className="font-semibold text-right">
                        Lifetime Tokens
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {endpoints.map((ep, idx) => {
                      const kvPct = ep.kv_cache_used_pct || 0;
                      const kvColor =
                        kvPct > 90
                          ? "bg-destructive"
                          : kvPct > 70
                            ? "bg-warning"
                            : "bg-success";
                      const epDisplayName =
                        ep.name || ep.pod_name || ep.address;

                      return (
                        <TableRow
                          key={
                            ep.name || ep.pod_name || ep.address || `ep-${idx}`
                          }
                          className="hover:bg-muted/30"
                        >
                          {/* Pod / Endpoint Address */}
                          <TableCell className="font-mono text-xs">
                            <div className="font-medium text-foreground">
                              {epDisplayName}
                            </div>
                            <div className="text-2xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <span>{ep.address}</span>
                            </div>
                          </TableCell>

                          {/* Status */}
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-2xs gap-1",
                                ep.status === "Healthy"
                                  ? "border-success/30 bg-success/10 text-success"
                                  : "border-warning/30 bg-warning/10 text-warning",
                              )}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              {ep.status}
                            </Badge>
                          </TableCell>

                          {/* Traffic Share */}
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs font-mono">
                                <span className="text-foreground font-semibold">
                                  {ep.traffic_pct}%
                                </span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-primary transition-all duration-500"
                                  style={{
                                    width: `${Math.min(100, Math.max(0, ep.traffic_pct))}%`,
                                  }}
                                />
                              </div>
                            </div>
                          </TableCell>

                          {/* KV Cache Fill */}
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs font-mono">
                                <span className="text-foreground font-semibold">
                                  {kvPct.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all duration-500",
                                    kvColor,
                                  )}
                                  style={{
                                    width: `${Math.min(100, Math.max(0, kvPct))}%`,
                                  }}
                                />
                              </div>
                            </div>
                          </TableCell>

                          {/* Active / Queue */}
                          <TableCell className="text-center font-mono text-xs">
                            <span className="font-semibold text-foreground">
                              {ep.running}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}
                              / {ep.waiting}
                            </span>
                          </TableCell>

                          {/* TTFT p95 */}
                          <TableCell className="text-right tabular-nums text-xs font-semibold text-info">
                            {ep.ttft_p95_ms != null
                              ? `${ep.ttft_p95_ms.toFixed(0)} ms`
                              : "—"}
                          </TableCell>

                          {/* ITL p95 */}
                          <TableCell className="text-right tabular-nums text-xs font-semibold text-success">
                            {ep.itl_p95_ms != null
                              ? `${ep.itl_p95_ms.toFixed(1)} ms`
                              : "—"}
                          </TableCell>

                          {/* Tokens Generated */}
                          <TableCell className="text-right font-mono text-xs text-foreground/80">
                            {ep.tokens_generated
                              ? ep.tokens_generated.toLocaleString()
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 px-1">
                <div className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-primary" />
                  <span>
                    Prefix-aware routing optimizes KV cache reuse by directing
                    prompts with shared prefixes to the same pod.
                  </span>
                </div>
                <div className="font-mono text-2xs">
                  Scraped via K8s API Proxy
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 2: Topology & Architecture ─────────────────────────────── */}
        <TabsContent value="architecture" className="space-y-6 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* EPP Spec Details */}
            <Card className="border-border/80">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  F5 Endpoint Picker (EPP) Specification
                </CardTitle>
                <CardDescription className="text-xs">
                  CRD:{" "}
                  <code className="font-mono">
                    inference.k8s.f5.com/v1alpha1
                  </code>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Resource Name:</span>
                  <code className="font-mono font-semibold text-foreground">
                    {eppName}
                  </code>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Namespace:</span>
                  <code className="font-mono text-foreground">
                    {eppNamespace}
                  </code>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">
                    Inference Engine:
                  </span>
                  <Badge
                    variant="outline"
                    className="font-mono text-2xs uppercase"
                  >
                    {engine}
                  </Badge>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">
                    Tokenizer Model:
                  </span>
                  <code className="font-mono text-foreground text-right">
                    {tokenizer}
                  </code>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">KV Block Size:</span>
                  <span className="tabular-nums font-semibold text-foreground">
                    {blockSize} tokens
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Routing Mode:</span>
                  <Badge
                    variant="secondary"
                    className="font-mono text-2xs capitalize"
                  >
                    {routingMode}
                  </Badge>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">
                    Target InferencePool:
                  </span>
                  <code className="font-mono text-primary font-semibold">
                    {poolRefName || "None"}
                  </code>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Replicas:</span>
                  <span className="font-mono text-foreground">
                    {spec.replicas || 1} Ready
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* InferencePool Details */}
            <Card className="border-border/80">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Server className="h-4 w-4 text-info" />
                  Bound InferencePool
                </CardTitle>
                <CardDescription className="text-xs">
                  CRD:{" "}
                  <code className="font-mono">
                    inference.networking.k8s.io/v1
                  </code>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {matchingPool ? (
                  <>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">Pool Name:</span>
                      <code className="font-mono font-semibold text-foreground">
                        {matchingPool.metadata?.name}
                      </code>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">
                        App Protocol:
                      </span>
                      <Badge
                        variant="outline"
                        className="font-mono text-2xs uppercase"
                      >
                        {matchingPool.spec?.appProtocol || "HTTP"}
                      </Badge>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">
                        Endpoint Picker Ref:
                      </span>
                      <span className="font-mono text-foreground">
                        {matchingPool.spec?.endpointPickerRef?.name || eppName}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">
                        Failure Mode:
                      </span>
                      <Badge
                        variant="outline"
                        className="font-mono text-2xs text-destructive border-destructive/30"
                      >
                        {matchingPool.spec?.endpointPickerRef?.failureMode ||
                          "FailClose"}
                      </Badge>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">
                        Target Port:
                      </span>
                      <span className="font-mono text-foreground">
                        {matchingPool.spec?.targetPorts?.[0]?.number || 8000}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-muted-foreground">
                        Pod Selector:
                      </span>
                      <code className="font-mono text-foreground">
                        {JSON.stringify(
                          matchingPool.spec?.selector?.matchLabels || {
                            app: "vllm",
                          },
                        )}
                      </code>
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center text-muted-foreground">
                    <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-warning opacity-70" />
                    <p>
                      InferencePool{" "}
                      <code className="font-mono text-foreground">
                        {poolRefName}
                      </code>{" "}
                      not found in namespace {eppNamespace}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TAB 3: Raw CRD Manifests ──────────────────────────────────── */}
        <TabsContent value="manifest" className="space-y-4 pt-4">
          <Card className="border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Box className="h-4 w-4 text-primary" />
                Declarative F5EPP Manifest
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="p-4 rounded-lg bg-muted/60 text-xs font-mono text-foreground overflow-x-auto max-h-96">
                {JSON.stringify(activeEpp, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
