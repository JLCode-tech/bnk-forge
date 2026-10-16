/**
 * BenchmarkRunsTab — D-020: runs table + filters in a SectionCard.
 * Status conveyed via Badge variants only; action buttons are ghost icons.
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/TimeAgo";
import { SectionCard } from "@/components/ui/section-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart3,
  XCircle,
  Trash2,
  Search,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  GitCompare,
  Star,
  LineChart,
  Activity,
} from "lucide-react";
import {
  useBenchmarkRuns,
  useCancelBenchmarkRun,
  useDeleteBenchmarkRun,
  useSetBenchmarkRunBaseline,
  useUnsetBenchmarkRunBaseline,
} from "@/hooks/useBenchmarks";
import { useDebounce } from "@/hooks/useDebounce";
import { fmtLatency, fmtNum, fmtPct } from "./benchmark-constants";
import {
  StatusBadge,
  ProxyBadge,
  RoutingEngineBadge,
  RegressionBadge,
  BenchmarkMethodologyBadge,
} from "./benchmark-utils";

const PAGE_SIZE = 25;

type SortKey =
  | "created_at"
  | "latency_p50"
  | "latency_p99"
  | "overall_rps"
  | "tokens_per_sec"
  | "success_rate_pct"
  | "failed_requests"
  | "total_requests";

interface RunsTabProps {
  proxyFilter: string;
  onProxyFilterChange: (s: string) => void;
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
  searchQuery: string;
  onSearchChange: (s: string) => void;
  onSelectRun: (id: number) => void;
  compareRunIds: number[];
  onToggleCompare: (id: number) => void;
  onCompare: () => void;
  onViewTrends?: () => void;
  onViewCurves?: () => void;
  selectedClusterId?: number;
}

export function BenchmarkRunsTab({
  proxyFilter,
  onProxyFilterChange,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchChange,
  onSelectRun,
  compareRunIds,
  onToggleCompare,
  onCompare,
  onViewTrends,
  onViewCurves,
  selectedClusterId,
}: RunsTabProps) {
  const [sort, setSort] = useState<{ key: SortKey; order: "asc" | "desc" }>({
    key: "created_at",
    order: "desc",
  });
  const [page, setPage] = useState(0);
  const search = useDebounce(searchQuery.trim(), 300);
  // Any filter / search / sort change starts again from the first page.
  useEffect(
    () => setPage(0),
    [proxyFilter, statusFilter, search, selectedClusterId, sort],
  );

  // Search, sort and paging run server-side so they cover every run, not just one page.
  const { data, isLoading } = useBenchmarkRuns({
    proxy: proxyFilter || undefined,
    status: statusFilter || undefined,
    cluster_id: selectedClusterId,
    q: search || undefined,
    sort: sort.key,
    order: sort.order,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    pollingEnabled: true,
  });
  const cancelRun = useCancelBenchmarkRun();
  const deleteRun = useDeleteBenchmarkRun();
  const setBaseline = useSetBenchmarkRunBaseline();
  const unsetBaseline = useUnsetBenchmarkRunBaseline();

  const runs = data?.runs ?? [];
  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min((page + 1) * PAGE_SIZE, total);
  // Deleting the last run on the last page would otherwise strand an empty page.
  useEffect(() => {
    if (page > 0 && total > 0 && page * PAGE_SIZE >= total)
      setPage(Math.ceil(total / PAGE_SIZE) - 1);
  }, [page, total]);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, order: s.order === "desc" ? "asc" : "desc" }
        : { key, order: "desc" },
    );
  const sortHead = (
    key: SortKey,
    label: string,
    align: "left" | "right" = "right",
  ) => {
    const Icon =
      sort.key !== key
        ? ArrowUpDown
        : sort.order === "desc"
          ? ArrowDown
          : ArrowUp;
    return (
      <TableHead
        className={align === "right" ? "text-right" : undefined}
        aria-sort={
          sort.key === key
            ? sort.order === "desc"
              ? "descending"
              : "ascending"
            : "none"
        }
      >
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 hover:text-foreground transition-colors",
            sort.key === key && "text-foreground",
          )}
          onClick={() => toggleSort(key)}
        >
          {label}
          <Icon className="h-3 w-3" />
        </button>
      </TableHead>
    );
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search runs..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={proxyFilter || "all"}
          onValueChange={(v) => onProxyFilterChange(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All proxies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All proxies</SelectItem>
            <SelectItem value="envoy">Envoy</SelectItem>
            <SelectItem value="nginx">Nginx</SelectItem>
            <SelectItem value="haproxy">HAProxy</SelectItem>
            <SelectItem value="f5-bnk">F5 BNK</SelectItem>
            <SelectItem value="nodeport">NodePort</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter || "all"}
          onValueChange={(v) => onStatusFilterChange(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        {compareRunIds.length >= 2 && (
          <Button size="sm" variant="outline" onClick={onCompare}>
            <GitCompare className="h-4 w-4 mr-1" />
            Compare {compareRunIds.length} runs
          </Button>
        )}
        {onViewTrends && (
          <Button size="sm" variant="outline" onClick={onViewTrends}>
            <LineChart className="h-4 w-4 mr-1" />
            Trends
          </Button>
        )}
        {onViewCurves && (
          <Button size="sm" variant="outline" onClick={onViewCurves}>
            <Activity className="h-4 w-4 mr-1" />
            Load curves
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <SectionCard compact>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </SectionCard>
      ) : runs.length === 0 ? (
        <SectionCard>
          <div className="text-center py-8">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-foreground">No benchmark runs found</p>
            <p className="text-xs text-muted-foreground mt-1">
              Run aiperf profile, then push the JSON result — see the Agents tab
              for instructions.
            </p>
          </div>
        </SectionCard>
      ) : (
        <SectionCard title={`${total} ${total === 1 ? "run" : "runs"}`} compact>
          <div className="w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="whitespace-nowrap">
                    Proxy / Architecture
                  </TableHead>
                  <TableHead>Cluster</TableHead>
                  <TableHead>Workload</TableHead>
                  <TableHead>Status</TableHead>
                  {sortHead("latency_p50", "Latency P50")}
                  {sortHead("overall_rps", "RPS")}
                  {sortHead("tokens_per_sec", "Tok/s")}
                  {sortHead("success_rate_pct", "Success")}
                  {sortHead("failed_requests", "Errors")}
                  {sortHead("created_at", "Created", "left")}
                  <TableHead className="text-right pr-4">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow
                    key={run.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => onSelectRun(run.id)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={compareRunIds.includes(run.id)}
                        onCheckedChange={() => onToggleCompare(run.id)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-muted-foreground">
                          #{run.id}
                        </span>
                        <ProxyBadge proxy={run.proxy} />
                        <RoutingEngineBadge proxy={run.proxy} />
                        {run.status === "completed" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className={cn(
                              "h-5 w-5 p-0",
                              run.is_baseline
                                ? "text-warning"
                                : "text-muted-foreground/40 hover:text-muted-foreground",
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (run.is_baseline) {
                                unsetBaseline.mutate(run.id);
                              } else {
                                setBaseline.mutate(run.id);
                              }
                            }}
                            title={
                              run.is_baseline
                                ? "Clear baseline"
                                : "Mark as baseline"
                            }
                          >
                            <Star
                              className={cn(
                                "h-3 w-3",
                                run.is_baseline && "fill-current",
                              )}
                            />
                          </Button>
                        )}
                        <RegressionBadge run={run} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className="text-xs font-mono text-muted-foreground truncate max-w-[120px] block"
                        title={run.cluster_name ?? "Fleet Aggregate"}
                      >
                        {run.cluster_name ?? "Fleet Aggregate"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <BenchmarkMethodologyBadge
                        scenarioKey={run.scenario_key}
                        tags={run.tags}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {fmtLatency(run.latency_p50)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-semibold text-foreground">
                      {fmtNum(run.overall_rps)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-success font-semibold">
                      {run.tokens_per_sec ? fmtNum(run.tokens_per_sec, 1) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <span
                        className={cn(
                          run.success_rate_pct != null &&
                            run.success_rate_pct < 100
                            ? "text-destructive font-semibold"
                            : "text-muted-foreground",
                        )}
                      >
                        {fmtPct(run.success_rate_pct)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <span
                        className={cn(
                          (run.failed_requests ?? 0) > 0
                            ? "text-destructive font-semibold"
                            : "text-muted-foreground",
                        )}
                      >
                        {run.failed_requests ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      <TimeAgo dateStr={run.created_at} />
                    </TableCell>
                    <TableCell
                      className="text-right pr-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {run.status === "running" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-warning"
                            onClick={() => cancelRun.mutate(run.id)}
                            title="Cancel"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {run.status !== "running" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => deleteRun.mutate(run.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => onSelectRun(run.id)}
                          title="View details"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between pt-3 text-xs text-muted-foreground">
            <span>
              {first}–{last} of {total}
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Previous
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                disabled={last >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
