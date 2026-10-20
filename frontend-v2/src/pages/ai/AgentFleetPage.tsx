import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  Bot,
  Search,
  ShieldCheck,
  Cpu,
  Zap,
  RefreshCw,
  Layers,
  Code2,
  BookOpen,
} from "lucide-react";
import { StatTile } from "@/components/observability/StatTile";
import { ErrorState } from "@/components/ui/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
// eslint-disable-next-line no-restricted-imports -- Vertical flush sub-sidebar requires Radix TabsList + TabsTrigger
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClusterPicker } from "@/components/observability/pickers";
import { useAllClusters } from "@/hooks/useK8sClusters";
import type { K8sCluster } from "@/types/kubernetes";

const EMPTY_CLUSTERS: K8sCluster[] = [];
import { useLlmStats } from "@/hooks/useLlmObservability";
import { useClusterScope } from "@/hooks/useClusterScope";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { A2AAgentDiscovery } from "@/components/k8s/A2AAgentDiscovery";
import { A2ATemplates } from "@/components/k8s/A2ATemplates";
import { A2AIRuleLibrary } from "@/components/k8s/A2AIRuleLibrary";
import { A2AProtocolReference } from "@/components/k8s/A2AProtocolReference";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";

interface FleetAgent {
  id: string;
  name: string;
  version: string;
  clusterId: number;
  clusterName: string;
  namespace: string;
  service: string;
  gateway: string;
  status: "active" | "throttled" | "degraded";
  targetPool: string;
  eppName: string;
  tokenizer: string;
  blockSize: number;
  cacheHitRate: number;
  ttftMs: number;
  authMethod: string;
  monthlyBudget: number;
  currentSpend: number;
  sessionPersistence: string;
  description: string;
  cardJson: Record<string, unknown>;
}

type AgentFleetTab =
  | "fleet"
  | "discovery"
  | "templates"
  | "irules"
  | "reference";

function resolveAgentFleetTab(raw: string | null): AgentFleetTab {
  if (raw === "scanner" || raw === "discovery") return "discovery";
  if (raw === "templates") return "templates";
  if (raw === "irules") return "irules";
  if (raw === "protocol" || raw === "reference") return "reference";
  return "fleet";
}

export default function AgentFleetPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = resolveAgentFleetTab(searchParams.get("tab"));
  const { refresh, isRefreshing } = usePageRefresh([
    ["k8s", "clusters"],
    ["llm-observability"],
  ]);
  const { data: clustersData, error: clustersError } = useAllClusters();
  const clusters = useMemo(
    () => clustersData?.clusters ?? EMPTY_CLUSTERS,
    [clustersData?.clusters],
  );

  const [selectedClusterId, setSelectedClusterId] = useClusterScope();
  const effectiveClusterId = selectedClusterId ?? clusters[0]?.id ?? 1;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "throttled"
  >("all");
  const [selectedAgent, setSelectedAgent] = useState<FleetAgent | null>(null);
  const [activeTab, setActiveTab] = useState<AgentFleetTab>(urlTab);

  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab]);

  const handleTabChange = (nextTab: string) => {
    const valid = resolveAgentFleetTab(nextTab);
    setActiveTab(valid);
    const next = new URLSearchParams(searchParams);
    if (valid === "fleet") {
      next.delete("tab");
    } else {
      next.set("tab", valid);
    }
    setSearchParams(next, { replace: true });
  };

  // Query live discovered agents via A2A endpoint across active cluster scope
  const targetClusterIds = useMemo(() => {
    if (selectedClusterId !== null) return [selectedClusterId];
    return clusters.map((c) => c.id);
  }, [selectedClusterId, clusters]);

  const agentQueries = useQueries({
    queries: targetClusterIds.map((cid) => ({
      queryKey: queryKeys.k8s.clusters.a2aAgents(cid, { probe: false }),
      queryFn: () => api.getA2AAgents(cid, { probe: false }),
      enabled: !!cid && activeTab === "fleet",
    })),
  });

  const discoveredAgents = useMemo((): FleetAgent[] => {
    const clusterNameMap = new Map(clusters.map((c) => [c.id, c.name]));
    const list: FleetAgent[] = [];
    targetClusterIds.forEach((cid, index) => {
      const data = agentQueries[index]?.data;
      if (!data?.agents) return;
      const cName = clusterNameMap.get(cid) || `Cluster ${cid}`;
      for (const a of data.agents) {
        list.push({
          id: `${cid}-${a.namespace}-${a.name}`,
          name: a.agentCard?.name || a.name,
          version: a.agentCard?.version || "1.0.0",
          clusterId: cid,
          clusterName: cName,
          namespace: a.namespace,
          service: `${a.name}${a.ports.length > 0 && a.ports[0].port ? `:${a.ports[0].port}` : ""}`,
          gateway:
            a.gateways.length > 0 ? a.gateways.join(", ") : "bnk-gateway",
          status:
            a.probeStatus === "error"
              ? "degraded"
              : a.probeStatus === "skipped"
                ? "throttled"
                : "active",
          targetPool:
            a.routeRefs.length > 0
              ? a.routeRefs.map((r) => r.name).join(", ")
              : "HTTPRoute",
          eppName: a.gateways.length > 0 ? a.gateways[0] : "gateway-listener",
          tokenizer: a.agentCard?.version
            ? `A2A v${a.agentCard.version}`
            : "A2A JSON-RPC",
          blockSize: 0,
          cacheHitRate: 0,
          ttftMs: 0,
          authMethod:
            a.agentCard?.securitySchemes &&
            Object.keys(a.agentCard.securitySchemes).length > 0
              ? Object.keys(a.agentCard.securitySchemes).join(", ")
              : "mTLS / Token",
          monthlyBudget: 0,
          currentSpend: 0,
          sessionPersistence: "None configured",
          description:
            a.agentCard?.description ||
            `Discovered A2A/MCP service behind ${a.routeRefs.length} HTTPRoute(s)`,
          cardJson: (a.agentCard as unknown as Record<string, unknown>) || {
            name: a.name,
            namespace: a.namespace,
            cluster: cName,
            gateways: a.gateways,
            routeRefs: a.routeRefs,
            ports: a.ports,
            probeStatus: a.probeStatus,
          },
        });
      }
    });
    return list;
  }, [targetClusterIds, agentQueries, clusters]);

  // Filter agents by cluster, search, and status
  const filteredAgents = useMemo(() => {
    return discoveredAgents.filter((agent) => {
      if (selectedClusterId !== null && agent.clusterId !== selectedClusterId) {
        return false;
      }
      if (statusFilter !== "all" && agent.status !== statusFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          agent.name.toLowerCase().includes(q) ||
          agent.namespace.toLowerCase().includes(q) ||
          agent.targetPool.toLowerCase().includes(q) ||
          agent.clusterName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [discoveredAgents, selectedClusterId, search, statusFilter]);

  // Query live observability stats for selected cluster scope
  const { data: llmStats, isLoading: statsLoading } = useLlmStats(
    selectedClusterId,
    { range: "24h" },
    activeTab === "fleet",
  );

  // Aggregate stats based on currently filtered scope
  const activeCount = filteredAgents.filter(
    (a) => a.status === "active",
  ).length;
  const throttledCount = filteredAgents.filter(
    (a) => a.status === "throttled",
  ).length;
  const live = llmStats?.available ? llmStats : undefined;
  const empty = statsLoading ? "…" : "—";
  const successRate = live ? `${(live.success_rate * 100).toFixed(1)}%` : empty;
  const avgTtft = live ? `${Math.round(live.avg_latency_ms)}ms` : empty;

  const activeTabMeta =
    activeTab === "discovery"
      ? {
          title: "A2A Discovery Scanner",
          subtitle:
            "Scan Kubernetes namespaces for A2A Agent Card endpoints and MCP tool servers.",
        }
      : activeTab === "templates"
        ? {
            title: "Agent Deployment Templates",
            subtitle:
              "Ready-to-deploy A2A agent and gateway routing manifests for BNK.",
          }
        : activeTab === "irules"
          ? {
              title: "F5 In-Line iRules",
              subtitle:
                "Curated programmable traffic inspection and A2A policy iRules.",
            }
          : activeTab === "reference"
            ? {
                title: "A2A Protocol Reference",
                subtitle:
                  "Agent-to-Agent (A2A) specification, identity schemas, and capability cards.",
              }
            : {
                title: "Discovered Agent Fleet",
                subtitle:
                  "Discovered A2A agents and MCP tool services behind F5 BIG-IP Next for Kubernetes gateways.",
              };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      orientation="vertical"
      className="flex min-h-[calc(100vh-3rem)]"
    >
      {/* Left Flush Inner Sub-Sidebar */}
      <CollapsibleInnerSidebar className="w-52 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
        <div className="px-2 pt-1 pb-2 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground">
            Agent Fleet &amp; Identity
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Discovered A2A agents &amp; MCP tool services
          </p>
        </div>

        <div className="space-y-1">
          <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            AGENT VIEWS
          </div>
          <TabsList
            aria-label="Agent fleet tabs"
            className="flex flex-col items-stretch h-auto bg-transparent p-0 gap-1"
          >
            <TabsTrigger
              value="fleet"
              className="w-full justify-between px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <span className="flex items-center gap-2 truncate">
                <Bot className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate tabular-nums">
                  Discovered Fleet ({filteredAgents.length})
                </span>
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="discovery"
              className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">A2A Discovery Scanner</span>
            </TabsTrigger>
            <TabsTrigger
              value="templates"
              className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Templates</span>
            </TabsTrigger>
            <TabsTrigger
              value="irules"
              className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <Code2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">F5 In-Line iRules</span>
            </TabsTrigger>
            <TabsTrigger
              value="reference"
              className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">A2A Protocol Reference</span>
            </TabsTrigger>
          </TabsList>
        </div>
      </CollapsibleInnerSidebar>

      {/* Right Content Pane */}
      <div className="flex-1 min-w-0 p-6 space-y-5 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {activeTabMeta.title}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {activeTabMeta.subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ClusterPicker
              value={selectedClusterId}
              onChange={setSelectedClusterId}
              allowAll={true}
              showProjectSelector
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={refresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground",
                  isRefreshing && "animate-spin",
                )}
              />
              Sync Fleet
            </Button>
          </div>
        </div>

        {clustersError ? (
          <ErrorState
            error={clustersError}
            onRetry={refresh}
            title="Failed to load agent fleet"
          />
        ) : (
          <>
            {/* Crisp Stat Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile
                label="Registered Agents"
                value={filteredAgents.length}
                icon={Bot}
                tone="primary"
                subtext={
                  selectedClusterId === null
                    ? "Across All Clusters"
                    : "Selected Cluster Scope"
                }
              />
              <StatTile
                label="Gateway Requests"
                value={live ? live.total_requests.toLocaleString() : empty}
                icon={ShieldCheck}
                tone="success"
                loading={statsLoading}
                subtext="Past 24 hours"
              />
              <StatTile
                label="Delivery Success Rate"
                value={successRate}
                icon={Zap}
                tone="primary"
                loading={statsLoading}
                subtext={
                  live
                    ? `${avgTtft} avg latency`
                    : statsLoading
                      ? "Loading telemetry…"
                      : "No gateway telemetry"
                }
              />
              <StatTile
                label="Quota Enforcement"
                value={
                  throttledCount > 0 ? `${throttledCount} Throttled` : "Nominal"
                }
                icon={Cpu}
                tone={throttledCount > 0 ? "warning" : "success"}
                subtext={`${activeCount} Active Policy Targets`}
              />
            </div>

            {/* Tab 1: Agent Fleet Table */}
            <TabsContent value="fleet" className="space-y-4 mt-0">
              {/* Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Filter by agent name, namespace, or inference pool..."
                    className="pl-8 text-xs h-8"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1">
                    Status:
                  </span>
                  <Button
                    variant={statusFilter === "all" ? "default" : "outline"}
                    size="sm"
                    className="text-xs h-7 px-2.5"
                    onClick={() => setStatusFilter("all")}
                  >
                    All
                  </Button>
                  <Button
                    variant={statusFilter === "active" ? "default" : "outline"}
                    size="sm"
                    className="text-xs h-7 px-2.5"
                    onClick={() => setStatusFilter("active")}
                  >
                    Active
                  </Button>
                  <Button
                    variant={
                      statusFilter === "throttled" ? "default" : "outline"
                    }
                    size="sm"
                    className="text-xs h-7 px-2.5"
                    onClick={() => setStatusFilter("throttled")}
                  >
                    Throttled (429)
                  </Button>
                </div>
              </div>

              {/* Clean Enterprise Data Table */}
              <div className="rounded-md border border-border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-muted/40">
                      <TableHead className="text-xs font-semibold">
                        Agent Name
                      </TableHead>
                      <TableHead className="text-xs font-semibold">
                        Cluster &amp; Namespace
                      </TableHead>
                      <TableHead className="text-xs font-semibold">
                        InferencePool / EPP
                      </TableHead>
                      <TableHead className="text-xs font-semibold">
                        Auth Enforcement
                      </TableHead>
                      <TableHead className="text-xs font-semibold">
                        Session Policy
                      </TableHead>
                      <TableHead className="text-xs font-semibold">
                        Status
                      </TableHead>
                      <TableHead className="text-xs font-semibold text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAgents.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="h-32 text-center text-xs text-muted-foreground"
                        >
                          <div className="flex flex-col items-center justify-center gap-2 py-4">
                            <span>
                              No agents found matching the selected filters.
                            </span>
                            {selectedClusterId !== null && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-7"
                                onClick={() => setSelectedClusterId(null)}
                              >
                                View All Clusters
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAgents.map((agent) => {
                        return (
                          <TableRow
                            key={agent.id}
                            className="hover:bg-muted/30"
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Bot className="h-3.5 w-3.5 text-primary shrink-0" />
                                <div>
                                  <div className="font-medium text-xs text-foreground">
                                    {agent.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground font-mono">
                                    {agent.service}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedClusterId(agent.clusterId)
                                }
                                className="text-xs text-primary hover:underline text-left"
                                title={`Scope to ${agent.clusterName}`}
                              >
                                {agent.clusterName}
                              </button>
                              <div className="text-xs text-muted-foreground">
                                {agent.namespace}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-xs font-medium">
                                {agent.targetPool}
                              </div>
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {agent.eppName} (Block {agent.blockSize})
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="text-xs border-border"
                              >
                                {agent.authMethod}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {agent.sessionPersistence}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  agent.status === "active"
                                    ? "success"
                                    : agent.status === "throttled"
                                      ? "warning"
                                      : "destructive"
                                }
                                className="text-xs capitalize font-medium"
                              >
                                {agent.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={() => setSelectedAgent(agent)}
                              >
                                Inspect Card
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* Tab 2: Discovery Scanner */}
            <TabsContent value="discovery" className="mt-0">
              <A2AAgentDiscovery
                clusterId={effectiveClusterId}
                namespace={undefined}
              />
            </TabsContent>

            {/* Tab 3: Templates */}
            <TabsContent value="templates" className="mt-0">
              <A2ATemplates
                clusterId={effectiveClusterId}
                namespace={undefined}
              />
            </TabsContent>

            {/* Tab 4: Curated iRules */}
            <TabsContent value="irules" className="mt-0">
              <A2AIRuleLibrary
                clusterId={effectiveClusterId}
                namespace={undefined}
              />
            </TabsContent>

            {/* Tab 5: Spec Reference */}
            <TabsContent value="reference" className="mt-0">
              <A2AProtocolReference
                clusterId={effectiveClusterId}
                namespace={undefined}
              />
            </TabsContent>
          </>
        )}

        {/* Agent Card Detail Modal */}
        <Dialog
          open={!!selectedAgent}
          onOpenChange={(open) => !open && setSelectedAgent(null)}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base tabular-nums">
                <Bot className="h-4 w-4 text-primary" />
                {selectedAgent?.name} (v{selectedAgent?.version})
              </DialogTitle>
            </DialogHeader>

            {selectedAgent && (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3 text-xs border p-3 rounded-md bg-muted/20">
                  <div>
                    <span className="text-muted-foreground block text-2xs">
                      Cluster:
                    </span>
                    <span className="font-medium">
                      {selectedAgent.clusterName}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-2xs">
                      Namespace:
                    </span>
                    <span className="font-medium">
                      {selectedAgent.namespace}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-2xs">
                      Inference Pool:
                    </span>
                    <span className="font-medium">
                      {selectedAgent.targetPool}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-2xs">
                      EPP Picker:
                    </span>
                    <span className="font-medium">{selectedAgent.eppName}</span>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold mb-1 text-foreground">
                    A2A Agent Card Spec (JSON):
                  </p>
                  <pre className="p-3 rounded-md bg-muted font-mono text-xs overflow-x-auto border text-foreground/90 max-h-72">
                    {JSON.stringify(selectedAgent.cardJson, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Tabs>
  );
}
