/**
 * ClusterTelemetryPanel
 * Production-grade telemetry visualization component consuming the Strangler Facade endpoints.
 * Displays eBPF socket flows, F5 BIG-IP Next TMM DPDK metrics, and Day 2 architectural drift.
 */

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Layers,
  Network,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { formatBytes } from "@/lib/utils";
import {
  useClusterTelemetrySummary,
  useClusterPodFlows,
  useClusterTmmMetrics,
  useClusterDriftViolations,
} from "@/hooks/useClusterTelemetry";
import { AgentEnrollmentWizard } from "@/components/fleet/AgentEnrollmentWizard";

interface ClusterTelemetryPanelProps {
  clusterId: number | string;
  clusterName?: string;
  projectId?: number;
  className?: string;
}

export function ClusterTelemetryPanel({
  clusterId,
  clusterName,
  projectId,
  className = "",
}: ClusterTelemetryPanelProps) {
  const [hours, setHours] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [enrollWizardOpen, setEnrollWizardOpen] = useState<boolean>(false);
  const [namespaceFilter, setNamespaceFilter] = useState<string>("");

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
    isRefetching: summaryRefetching,
  } = useClusterTelemetrySummary(clusterId, hours);

  const {
    data: flowsData,
    isLoading: flowsLoading,
    refetch: refetchFlows,
  } = useClusterPodFlows(
    clusterId,
    {
      hours,
      namespace: namespaceFilter.trim() || undefined,
      limit: 50,
    },
    { enabled: activeTab === "flows" || activeTab === "overview" }
  );

  const {
    data: tmmData,
    refetch: refetchTmm,
  } = useClusterTmmMetrics(clusterId, hours, {
    enabled:
      summary?.tmm_active !== false &&
      (activeTab === "tmm" || activeTab === "overview"),
  });

  const {
    data: driftData,
    refetch: refetchDrift,
  } = useClusterDriftViolations(clusterId, {
    hours: Math.max(hours, 24),
    enabled: activeTab === "drift" || activeTab === "overview",
  });

  const handleRefresh = () => {
    refetchSummary();
    if (activeTab === "flows") refetchFlows();
    if (activeTab === "tmm") refetchTmm();
    if (activeTab === "drift") refetchDrift();
  };

  if (summaryLoading) {
    return (
      <div className={`space-y-4 p-4 ${className}`} data-testid="cluster-telemetry-loading">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (summaryError) {
    return (
      <div className={`p-4 ${className}`} data-testid="cluster-telemetry-error">
        <ErrorState
          error={summaryError}
          onRetry={handleRefresh}
          title="Failed to load cluster telemetry"
        />
      </div>
    );
  }

  const isPushActive = summary?.has_active_agent || summary?.source === "AGENT_PUSH";
  const displayName = clusterName || summary?.cluster_name || `Cluster #${clusterId}`;
  const flows = summary?.flows;
  const tmm = tmmData?.metrics && "total_rx_packets" in tmmData.metrics ? tmmData.metrics : summary?.tmm;
  const tmmActive =
    summary?.tmm_active !== undefined
      ? Boolean(summary.tmm_active)
      : Boolean(tmm && (tmm.total_rx_packets > 0 || tmm.total_tx_packets > 0));
  const dpdkActive =
    summary?.dpdk_active !== undefined
      ? Boolean(summary.dpdk_active)
      : Boolean(
          tmmActive &&
            tmm &&
            (tmm.avg_rx_ring_occupancy > 0 || tmm.avg_tx_ring_occupancy > 0 || tmm.max_hugepage_used_bytes > 0)
        );
  const effectiveTab = !tmmActive && activeTab === "tmm" ? "overview" : activeTab;
  const transportLabel =
    summary?.transport_label || (isPushActive ? "Push Active" : "Pull Active");
  const driftCount = summary?.drift_violations_count ?? 0;
  const violationsList = driftData?.violations ?? summary?.recent_drift_alerts ?? [];
  const topTalkers = flowsData?.top_talkers ?? summary?.top_talkers ?? [];

  return (
    <div className={`space-y-5 p-2 sm:p-4 ${className}`} data-testid="cluster-telemetry-panel">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              {displayName} Telemetry
            </h2>
            {isPushActive ? (
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 flex items-center gap-1 font-medium"
              >
                <Zap className="h-3 w-3 fill-emerald-500/20" />
                {transportLabel}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 flex items-center gap-1 font-medium"
              >
                <Radio className="h-3 w-3" />
                {transportLabel}
              </Badge>
            )}
            <Badge variant="secondary" className="text-2xs font-mono">
              UUID: {summary?.cluster_uuid?.slice(0, 8)}...
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {isPushActive
              ? dpdkActive
                ? "Receiving streaming eBPF network flows, F5 TMM DPDK counters, and real-time architectural drift detection via Push Agent :17543."
                : "Receiving streaming eBPF network flows and real-time architectural drift detection via Push Agent :17543."
              : "Cluster is operating in pull mode. Real-time streaming eBPF telemetry is inactive."}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 self-start sm:self-center">
          <div className="flex rounded-md border border-border bg-muted/30 p-0.5 text-xs">
            {[
              { label: "1h", value: 1 },
              { label: "6h", value: 6 },
              { label: "24h", value: 24 },
              { label: "7d", value: 168 },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setHours(option.value)}
                className={`px-2.5 py-1 font-medium rounded transition-colors ${
                  hours === option.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={summaryRefetching}
            className="h-8 gap-1 text-xs"
            aria-label="Refresh telemetry"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${summaryRefetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          {!isPushActive && (
            <Button
              variant="default"
              size="sm"
              onClick={() => setEnrollWizardOpen(true)}
              className="h-8 gap-1.5 text-xs font-semibold bg-primary"
            >
              <Zap className="h-3.5 w-3.5" />
              Enroll Push Agent
            </Button>
          )}
        </div>
      </div>

      {/* Fallback Banner if Push Agent not installed */}
      {!isPushActive && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Push Agent is not active for this cluster
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  To view kernel-level socket flows and detect Day 2 architectural drift (and F5 BIG-IP Next TMM DPDK
                  telemetry when deployed), install the Forge Push Agent daemonset.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => setEnrollWizardOpen(true)}
              className="shrink-0 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Zap className="h-3.5 w-3.5" />
              Deploy Agent (:17543)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Top KPI Cards */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${tmmActive ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-3`}>
        {/* KPI 1: eBPF Flow Volume */}
        <Card className="shadow-xs border-border">
          <CardHeader className="pb-1 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              eBPF Socket Flows
            </CardTitle>
            <Network className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold tracking-tight tabular-nums">
              {flows ? flows.total_flows.toLocaleString() : "0"}
            </div>
            <div className="mt-1 flex items-center justify-between text-2xs text-muted-foreground">
              <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                <ArrowDownLeft className="h-3 w-3" />
                {flows ? flows.inbound_flows.toLocaleString() : "0"} in
              </span>
              <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
                <ArrowUpRight className="h-3 w-3" />
                {flows ? flows.outbound_flows.toLocaleString() : "0"} out
              </span>
              <span className="font-mono">
                {flows
                  ? formatBytes(flows.total_bytes_sent + flows.total_bytes_received)
                  : "0 B"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 2: Latency & RTT */}
        <Card className="shadow-xs border-border">
          <CardHeader className="pb-1 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Avg Handshake / RTT
            </CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold tracking-tight tabular-nums">
              {flows && flows.avg_handshake_duration_us > 0
                ? `${flows.avg_handshake_duration_us} µs`
                : "—"}
            </div>
            <div className="mt-1 flex items-center justify-between text-2xs text-muted-foreground">
              <span>
                RTT: {flows && flows.avg_smoothed_rtt_us > 0 ? `${flows.avg_smoothed_rtt_us} µs` : "—"}
              </span>
              <span className={flows && flows.total_retransmissions > 0 ? "text-amber-500 font-medium" : ""}>
                Retrans: {flows?.total_retransmissions ?? 0}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 3: F5 TMM (only rendered when TMM is active) */}
        {tmmActive && (
          <Card className="shadow-xs border-border">
            <CardHeader className="pb-1 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {dpdkActive ? "TMM DPDK Packet Flow" : "TMM Packet Flow"}
              </CardTitle>
              <Cpu className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold tracking-tight tabular-nums">
                {tmm && (tmm.total_rx_packets > 0 || tmm.total_tx_packets > 0)
                  ? (tmm.total_rx_packets + tmm.total_tx_packets).toLocaleString()
                  : "—"}
              </div>
              <div className="mt-1 flex items-center justify-between text-2xs text-muted-foreground">
                <span>Drops: {tmm ? (tmm.total_rx_drops + tmm.total_tx_drops).toLocaleString() : "0"}</span>
                <span>CPU: {tmm ? `${tmm.avg_cpu_utilization_pct}%` : "—"}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI 4: Architectural Drift Violations */}
        <Card className={`shadow-xs border-border ${driftCount > 0 ? "border-destructive/40 bg-destructive/5" : ""}`}>
          <CardHeader className="pb-1 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Day 2 Drift Violations
            </CardTitle>
            {driftCount > 0 ? (
              <ShieldAlert className="h-4 w-4 text-destructive" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            )}
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div
              className={`text-2xl font-bold tracking-tight tabular-nums ${
                driftCount > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {driftCount}
            </div>
            <div className="mt-1 text-2xs text-muted-foreground">
              {driftCount > 0 ? (
                <span className="text-destructive font-medium">Bypass traffic detected</span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {tmmActive ? "Strict TMM Ingress Compliant" : "No Bypass Violations"}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabbed Detail Section */}
      <Tabs value={effectiveTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="overview" className="gap-1.5 text-xs">
            <Layers className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="flows" className="gap-1.5 text-xs">
            <Network className="h-3.5 w-3.5" />
            Pod Flows & Top Talkers
          </TabsTrigger>
          {tmmActive && (
            <TabsTrigger value="tmm" className="gap-1.5 text-xs">
              <Cpu className="h-3.5 w-3.5" />
              {dpdkActive ? "F5 TMM DPDK Microkernel" : "F5 TMM Microkernel"}
            </TabsTrigger>
          )}
          <TabsTrigger value="drift" className="gap-1.5 text-xs">
            <ShieldAlert className="h-3.5 w-3.5" />
            Architectural Drift
            {driftCount > 0 && (
              <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-2xs h-4">
                {driftCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Pod Talkers Preview */}
            <Card className="border-border">
              <CardHeader className="py-3 px-4 border-b border-border">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span>Top Pod Talkers by Byte Volume</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-primary p-0"
                    onClick={() => setActiveTab("flows")}
                  >
                    View All
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {topTalkers.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    No pod flow traffic recorded in the last {hours} hour(s).
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {topTalkers.slice(0, 5).map((t, idx) => (
                      <div key={idx} className="p-3 flex items-center justify-between text-xs">
                        <div className="min-w-0 pr-2">
                          <p className="font-semibold text-foreground truncate">{t.pod_name}</p>
                          <p className="text-2xs text-muted-foreground truncate">{t.namespace}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono font-medium">{formatBytes(t.total_bytes)}</p>
                          <p className="text-2xs text-muted-foreground">{t.flow_count} flows</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Drift Alert Preview */}
            <Card className="border-border">
              <CardHeader className="py-3 px-4 border-b border-border">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span>Day 2 Architectural Drift Events</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-primary p-0"
                    onClick={() => setActiveTab("drift")}
                  >
                    View Details
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {violationsList.length === 0 ? (
                  <div className="py-6 flex flex-col items-center justify-center text-center space-y-2">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                    <p className="text-sm font-semibold text-foreground">Zero Drift Violations</p>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      {dpdkActive
                        ? "100% of ingress pod traffic is properly traversing the F5 BIG-IP Next TMM data plane. No direct service bypass detected."
                        : "All monitored ingress pod traffic conforms to policy. No direct service bypass detected."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {violationsList.slice(0, 3).map((v, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-md border border-destructive/30 bg-destructive/5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between font-medium">
                          <span className="text-destructive font-semibold truncate">
                            {v.pod_name} ({v.namespace})
                          </span>
                          <span className="text-2xs text-muted-foreground font-mono">
                            {new Date(v.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-2xs text-muted-foreground">
                          Direct bypass: {v.src_ip} → {v.dst_ip}:{v.dst_port} ({formatBytes(v.bytes_sent + v.bytes_received)})
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: Pod Flows & Top Talkers */}
        <TabsContent value="flows" className="space-y-4">
          <Card className="border-border">
            <CardHeader className="py-3 px-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">Pod Network Flows (eBPF Kernel Telemetry)</CardTitle>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filter namespace..."
                  value={namespaceFilter}
                  onChange={(e) => setNamespaceFilter(e.target.value)}
                  className="h-7 px-2 text-xs rounded border border-border bg-background focus:outline-hidden focus:ring-1 focus:ring-primary w-40"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {flowsLoading ? (
                <div className="p-6 text-center text-xs text-muted-foreground">Loading pod flows...</div>
              ) : topTalkers.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  No eBPF flows found for the selected time window and namespace filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/40 border-b border-border text-2xs uppercase text-muted-foreground font-semibold">
                      <tr>
                        <th className="py-2.5 px-4">Pod Name</th>
                        <th className="py-2.5 px-4">Namespace</th>
                        <th className="py-2.5 px-4 text-right">Flows</th>
                        <th className="py-2.5 px-4 text-right">Bytes Sent</th>
                        <th className="py-2.5 px-4 text-right">Bytes Recv</th>
                        <th className="py-2.5 px-4 text-right">Total Volume</th>
                        <th className="py-2.5 px-4 text-right">Violations</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {topTalkers.map((talker, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="py-2.5 px-4 font-semibold text-foreground truncate max-w-[200px]">
                            {talker.pod_name}
                          </td>
                          <td className="py-2.5 px-4 text-muted-foreground truncate">{talker.namespace}</td>
                          <td className="py-2.5 px-4 text-right tabular-nums">{talker.flow_count}</td>
                          <td className="py-2.5 px-4 text-right tabular-nums font-mono text-muted-foreground">
                            {formatBytes(talker.bytes_sent)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums font-mono text-muted-foreground">
                            {formatBytes(talker.bytes_received)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums font-mono font-medium">
                            {formatBytes(talker.total_bytes)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums">
                            {talker.bypass_violations > 0 ? (
                              <Badge variant="destructive" className="text-2xs py-0 px-1">
                                {talker.bypass_violations}
                              </Badge>
                            ) : (
                              <span className="text-emerald-500">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: F5 TMM Microkernel */}
        {tmmActive && (
          <TabsContent value="tmm" className="space-y-4">
            <div className={`grid grid-cols-1 ${dpdkActive ? "md:grid-cols-2" : ""} gap-4`}>
              {dpdkActive && (
                <Card className="border-border">
                  <CardHeader className="py-3 px-4 border-b border-border">
                    <CardTitle className="text-sm font-semibold">DPDK Ring Descriptor Occupancy</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-muted-foreground">RX Ring Occupancy</span>
                        <span className="font-mono tabular-nums">
                          {tmm ? `${(tmm.avg_rx_ring_occupancy * 100).toFixed(1)}%` : "0%"}
                        </span>
                      </div>
                      <Progress value={tmm ? tmm.avg_rx_ring_occupancy * 100 : 0} className="h-2" />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-muted-foreground">TX Ring Occupancy</span>
                        <span className="font-mono tabular-nums">
                          {tmm ? `${(tmm.avg_tx_ring_occupancy * 100).toFixed(1)}%` : "0%"}
                        </span>
                      </div>
                      <Progress value={tmm ? tmm.avg_tx_ring_occupancy * 100 : 0} className="h-2" />
                    </div>
                    <p className="text-2xs text-muted-foreground pt-1">
                      High ring descriptor occupancy (&gt;80%) indicates incoming packet bursts or CPU core saturation.
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card className="border-border">
                <CardHeader className="py-3 px-4 border-b border-border">
                  <CardTitle className="text-sm font-semibold">TMM Microkernel Resources</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3 text-xs">
                  <div className="flex justify-between border-b border-border pb-2">
                    <span className="text-muted-foreground">TMM CPU Utilization</span>
                    <span className="font-semibold tabular-nums">{tmm ? `${tmm.avg_cpu_utilization_pct}%` : "—"}</span>
                  </div>
                  {dpdkActive && (
                    <div className="flex justify-between border-b border-border pb-2">
                      <span className="text-muted-foreground">DPDK Hugepage Memory Used</span>
                      <span className="font-mono tabular-nums">
                        {tmm && tmm.max_hugepage_used_bytes ? formatBytes(tmm.max_hugepage_used_bytes) : "—"}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-b border-border pb-2">
                    <span className="text-muted-foreground">Total Packets (RX / TX)</span>
                    <span className="font-mono tabular-nums">
                      {tmm ? `${tmm.total_rx_packets.toLocaleString()} / ${tmm.total_tx_packets.toLocaleString()}` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Packet Drops (RX / TX)</span>
                    <span className="font-mono tabular-nums text-amber-500 font-medium">
                      {tmm ? `${tmm.total_rx_drops.toLocaleString()} / ${tmm.total_tx_drops.toLocaleString()}` : "0 / 0"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}

        {/* Tab 4: Architectural Drift Violations */}
        <TabsContent value="drift" className="space-y-4">
          <Card className="border-border">
            <CardHeader className="py-3 px-4 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Day 2 Architectural Drift Violations (TMM Ingress Bypass)</span>
                <Badge variant={driftCount > 0 ? "destructive" : "outline"} className="text-xs">
                  {driftCount} Violation{driftCount !== 1 ? "s" : ""}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {violationsList.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-2">
                  <ShieldCheck className="h-10 w-10 text-emerald-500" />
                  <p className="text-base font-semibold text-foreground">Zero Drift Violations Detected</p>
                  <p className="text-xs text-muted-foreground max-w-md">
                    {dpdkActive
                      ? "All pod ingress traffic conforms to the architectural baseline. No traffic is bypassing the F5 BIG-IP Next TMM high-speed data plane."
                      : "All monitored pod ingress traffic conforms to the architectural baseline. No direct service bypass detected."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/40 border-b border-border text-2xs uppercase text-muted-foreground font-semibold">
                      <tr>
                        <th className="py-2.5 px-4">Timestamp</th>
                        <th className="py-2.5 px-4">Pod Name</th>
                        <th className="py-2.5 px-4">Namespace</th>
                        <th className="py-2.5 px-4">Node</th>
                        <th className="py-2.5 px-4">Source IP</th>
                        <th className="py-2.5 px-4">Destination</th>
                        <th className="py-2.5 px-4 text-right">Volume</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {violationsList.map((v, idx) => (
                        <tr key={idx} className="hover:bg-destructive/5">
                          <td className="py-2.5 px-4 font-mono text-2xs text-muted-foreground">
                            {new Date(v.timestamp).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-destructive truncate max-w-[180px]">
                            {v.pod_name}
                          </td>
                          <td className="py-2.5 px-4 text-muted-foreground">{v.namespace}</td>
                          <td className="py-2.5 px-4 text-muted-foreground font-mono text-2xs">{v.node_name}</td>
                          <td className="py-2.5 px-4 font-mono text-2xs">{v.src_ip}</td>
                          <td className="py-2.5 px-4 font-mono text-2xs">
                            {v.dst_ip}:{v.dst_port}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-2xs tabular-nums">
                            {formatBytes(v.bytes_sent + v.bytes_received)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Embedded Agent Enrollment Wizard when user clicks enroll */}
      {enrollWizardOpen && (
        <AgentEnrollmentWizard
          open={enrollWizardOpen}
          onOpenChange={setEnrollWizardOpen}
          defaultProjectId={projectId}
        />
      )}
    </div>
  );
}
