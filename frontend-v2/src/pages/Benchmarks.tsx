/**
 * Benchmarks page — run-first redesign (Overview / Runs / Setup).
 *
 * 3 primary tabs. Overview (default landing) is the daily-use dashboard +
 * "Run benchmark" wizard entry point. Runs is UNCHANGED from the prior
 * entity-first redesign (drill-ins, trends, badges — do not regress it).
 * Setup hosts the existing Targets/Agents/Configs tab bodies, unmodified, as
 * sub-sections. Legacy ?tab=targets|agents|configs deep-links still resolve
 * to the right Setup sub-section (see derivePrimaryTabState).
 */
import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageRefresh } from "@/hooks/usePageRefresh";
// eslint-disable-next-line no-restricted-imports -- Vertical flush sub-sidebar requires Radix TabsList + TabsTrigger
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResourceViewTabs } from "@/components/layout/ResourceViewTabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Zap,
  GitCompare,
  Settings2,
  Activity,
  Server,
  LayoutDashboard,
  ArrowLeft,
  SearchX,
  LineChart,
  RefreshCw,
  Play,
} from "lucide-react";

import { BenchmarkTargetsTab } from "./BenchmarkTargetsTab";
import { BenchmarkAgentsTab } from "./BenchmarkAgentsTab";
import { BenchmarkConfigsTab } from "./BenchmarkConfigsTab";
import { BenchmarkRunsTab } from "./BenchmarkRunsTab";
import { BenchmarkRunDetail } from "./BenchmarkRunDetail";
import { BenchmarkCompareTab } from "./BenchmarkCompareTab";
import { BenchmarkTrendsView } from "./BenchmarkTrendsView";
import { BenchmarkRunGroupView } from "./BenchmarkRunGroupView";
import { BenchmarkCurvesView } from "./BenchmarkCurvesView";
import { BenchmarkOverviewTab } from "./BenchmarkOverviewTab";
import {
  RunBenchmarkWizard,
  type RunBenchmarkWizardLaunchResult,
} from "./RunBenchmarkWizard";
import {
  deriveRunsViewState,
  derivePrimaryTabState,
  type SetupSection,
} from "./benchmark-runs-view";
import { ClusterPicker } from "@/components/observability/pickers";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import { readClusterScope, writeClusterScope } from "@/hooks/useClusterScope";
import { useBenchmarkSummary } from "@/hooks/useBenchmarks";

// ──────────────────────────────────────────────────────────────────────────────
// Setup tab — Targets/Agents/Configs as sub-sections, existing components as-is
// ──────────────────────────────────────────────────────────────────────────────

function BenchmarkSetupSection({
  activeSection,
  onSectionChange,
  selectedClusterId,
}: {
  activeSection: SetupSection;
  onSectionChange: (section: SetupSection) => void;
  selectedClusterId?: number;
}) {
  return (
    <Tabs
      value={activeSection}
      onValueChange={(v) => onSectionChange(v as SetupSection)}
    >
      <ResourceViewTabs
        variant="inline"
        aria-label="Setup sections"
        active={activeSection}
        onChange={(key) => onSectionChange(key as SetupSection)}
        tabs={[
          { key: "targets", label: "Targets", icon: Zap },
          { key: "agents", label: "Agents", icon: Server },
          { key: "configs", label: "Configs", icon: Settings2 },
        ]}
      />
      <TabsContent value="targets" className="mt-6">
        <BenchmarkTargetsTab selectedClusterId={selectedClusterId} />
      </TabsContent>
      <TabsContent value="agents" className="mt-6">
        <BenchmarkAgentsTab />
      </TabsContent>
      <TabsContent value="configs" className="mt-6">
        <BenchmarkConfigsTab />
      </TabsContent>
    </Tabs>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Runs tab — list + Detail/Compare/Trends/Group drill-ins, URL-driven so
// refresh/back preserve context. UNCHANGED behavior from the prior redesign;
// only additive support for ?group=<id> (scenario launches from the wizard).
// ──────────────────────────────────────────────────────────────────────────────

function BenchmarkRunsSection({
  searchParams,
  setSearchParams,
  selectedClusterId,
}: {
  searchParams: URLSearchParams;
  setSearchParams: (params: URLSearchParams) => void;
  selectedClusterId?: number;
}) {
  const [proxyFilter, setProxyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingCompareIds, setPendingCompareIds] = useState<number[]>([]);

  const {
    subView,
    selectedRunId,
    compareRunIds,
    selectedGroupId,
    curveGroupIds,
  } = deriveRunsViewState(searchParams);

  const goToList = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("run");
    next.delete("group");
    next.delete("compare");
    next.delete("view");
    next.set("tab", "runs");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const goToDetail = useCallback(
    (id: number) => {
      const next = new URLSearchParams();
      next.set("tab", "runs");
      next.set("run", String(id));
      setSearchParams(next);
    },
    [setSearchParams],
  );

  const goToCompare = useCallback(
    (ids: number[]) => {
      if (ids.length < 2) return;
      const next = new URLSearchParams(searchParams);
      next.delete("run");
      next.delete("group");
      next.delete("view");
      next.set("tab", "runs");
      next.set("compare", ids.join(","));
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const goToTrends = useCallback(() => {
    const next = new URLSearchParams();
    next.set("tab", "runs");
    next.set("view", "trends");
    setSearchParams(next);
  }, [setSearchParams]);

  const goToCurves = useCallback(
    (ids: number[]) => {
      const next = new URLSearchParams();
      next.set("tab", "runs");
      next.set("view", "curves");
      if (ids.length) next.set("groups", ids.join(","));
      setSearchParams(next);
    },
    [setSearchParams],
  );

  const toggleCompare = useCallback((id: number) => {
    setPendingCompareIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    );
  }, []);

  if (subView === "detail") {
    if (selectedRunId == null) {
      return (
        <EmptyState
          icon={SearchX}
          title="Invalid run id"
          description="The run id in the URL isn't valid."
          action={{
            label: "Back to runs",
            onClick: goToList,
            variant: "outline",
          }}
        />
      );
    }
    return <BenchmarkRunDetail runId={selectedRunId} onBack={goToList} />;
  }

  if (subView === "group") {
    if (selectedGroupId == null) {
      return (
        <EmptyState
          icon={SearchX}
          title="Invalid run-group id"
          description="The run-group id in the URL isn't valid."
          action={{
            label: "Back to runs",
            onClick: goToList,
            variant: "outline",
          }}
        />
      );
    }
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={goToList}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to runs
        </Button>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => goToCurves([selectedGroupId])}
          >
            <LineChart className="h-3.5 w-3.5" />
            Load curves
          </Button>
        </div>
        <BenchmarkRunGroupView groupId={selectedGroupId} />
      </div>
    );
  }

  if (subView === "compare") {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={goToList}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to runs
        </Button>
        {compareRunIds.length >= 2 ? (
          <BenchmarkCompareTab runIds={compareRunIds} />
        ) : (
          <EmptyState
            icon={GitCompare}
            title="Nothing to compare"
            description="Pick at least 2 runs from the Runs list to compare them side-by-side."
            action={{
              label: "Back to runs",
              onClick: goToList,
              variant: "outline",
            }}
          />
        )}
      </div>
    );
  }

  if (subView === "curves") {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={goToList}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to runs
        </Button>
        <BenchmarkCurvesView
          groupIds={curveGroupIds}
          onGroupIdsChange={goToCurves}
        />
      </div>
    );
  }

  if (subView === "trends") {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={goToList}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to runs
        </Button>
        <BenchmarkTrendsView />
      </div>
    );
  }

  return (
    <BenchmarkRunsTab
      proxyFilter={proxyFilter}
      onProxyFilterChange={setProxyFilter}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onSelectRun={goToDetail}
      compareRunIds={pendingCompareIds}
      onToggleCompare={toggleCompare}
      onCompare={() => goToCompare(pendingCompareIds)}
      onViewTrends={goToTrends}
      onViewCurves={() => goToCurves([])}
      selectedClusterId={selectedClusterId}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────────────

export default function Benchmarks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardReRunLast, setWizardReRunLast] = useState(false);

  const clusterParam = searchParams.get("cluster");
  // No ?cluster= → fall back to the shared cluster scope; "all" is explicit.
  const selectedClusterId =
    clusterParam === "all"
      ? undefined
      : clusterParam
        ? Number(clusterParam)
        : (readClusterScope() ?? undefined);

  const handleClusterChange = useCallback(
    (id: number | null | undefined) => {
      writeClusterScope(id ?? null);
      const next = new URLSearchParams(searchParams);
      if (id != null) {
        next.set("cluster", String(id));
      } else {
        next.delete("cluster");
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const { primaryTab, setupSection } = derivePrimaryTabState(searchParams);

  const goToPrimaryTab = useCallback(
    (tab: string) => {
      const next = new URLSearchParams(searchParams);
      next.delete("run");
      next.delete("group");
      next.delete("compare");
      next.delete("view");
      if (tab === "runs") {
        next.set("tab", "runs");
      } else if (tab === "setup") {
        next.set("tab", "setup");
        next.set("section", setupSection);
      } else {
        next.set("tab", "overview");
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams, setupSection],
  );

  const goToSetupSection = useCallback(
    (section: SetupSection) => {
      const next = new URLSearchParams(searchParams);
      next.delete("run");
      next.delete("group");
      next.delete("compare");
      next.delete("view");
      next.set("tab", "setup");
      next.set("section", section);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const goToRunDetail = useCallback(
    (runId: number) => {
      const next = new URLSearchParams(searchParams);
      next.delete("group");
      next.delete("compare");
      next.delete("view");
      next.set("tab", "runs");
      next.set("run", String(runId));
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const goToRunGroup = useCallback(
    (groupId: number) => {
      const next = new URLSearchParams(searchParams);
      next.delete("run");
      next.delete("compare");
      next.delete("view");
      next.set("tab", "runs");
      next.set("group", String(groupId));
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const goToTrends = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("run");
    next.delete("group");
    next.delete("compare");
    next.set("tab", "runs");
    next.set("view", "trends");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const goToCompare = useCallback(
    (ids: number[]) => {
      if (ids.length < 2) return;
      const next = new URLSearchParams(searchParams);
      next.delete("run");
      next.delete("group");
      next.delete("view");
      next.set("tab", "runs");
      next.set("compare", ids.join(","));
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const openWizard = useCallback((reRunLast = false) => {
    setWizardReRunLast(reRunLast);
    setWizardOpen(true);
  }, []);

  const handleWizardLaunched = useCallback(
    (result: RunBenchmarkWizardLaunchResult) => {
      if (result.runId != null) {
        goToRunDetail(result.runId);
      } else if (result.groupId != null) {
        goToRunGroup(result.groupId);
      }
    },
    [goToRunDetail, goToRunGroup],
  );

  const { refresh: handleRefresh, isRefreshing } = usePageRefresh();
  const { data: summaryData } = useBenchmarkSummary(selectedClusterId);
  const totalRuns = summaryData?.total_runs ?? 0;

  const activeViewMeta =
    primaryTab === "runs"
      ? {
          title: "Benchmark Runs",
          subtitle:
            "Inspect individual runs, compare proxy profiles, and analyze performance trends.",
        }
      : primaryTab === "setup"
        ? {
            title: "Target Setup & Readiness",
            subtitle:
              "Configure LLM inference targets, load-test agents, and benchmark profiles.",
          }
        : {
            title: "Overview & Trends",
            subtitle:
              "Compare proxy and load-balancer performance for LLM inference traffic.",
          };

  return (
    <>
      <Tabs
        value={primaryTab}
        onValueChange={goToPrimaryTab}
        orientation="vertical"
        className="flex min-h-[calc(100vh-3rem)]"
      >
        {/* Left Flush Inner Sub-Sidebar */}
        <CollapsibleInnerSidebar className="w-52 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
          <div className="px-2 pt-1 pb-2 border-b border-border">
            <h1 className="text-sm font-semibold text-foreground">
              Benchmarks
            </h1>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Cluster network &amp; data-plane performance benchmarks
            </p>
          </div>

          <div className="space-y-1">
            <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              BENCHMARK VIEWS
            </div>
            <TabsList
              aria-label="Benchmark sections"
              className="flex flex-col items-stretch h-auto bg-transparent p-0 gap-0.5"
            >
              <TabsTrigger
                value="overview"
                className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Overview &amp; Trends</span>
              </TabsTrigger>
              <TabsTrigger
                value="runs"
                className="w-full justify-between gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Activity className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Benchmark Runs</span>
                </span>
                <Badge
                  variant="secondary"
                  className="text-2xs px-1.5 py-0 h-4 tabular-nums"
                >
                  {totalRuns}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="setup"
                className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <Settings2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Target Setup &amp; Readiness</span>
              </TabsTrigger>
            </TabsList>
          </div>
        </CollapsibleInnerSidebar>

        {/* Right Content Pane */}
        <div className="flex-1 min-w-0 p-6 space-y-6 overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {activeViewMeta.title}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeViewMeta.subtitle}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ClusterPicker
                value={selectedClusterId ?? null}
                onChange={handleClusterChange}
                showProjectSelector
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => openWizard(false)}
              >
                <Play className="h-3.5 w-3.5" />
                Run Benchmark
              </Button>
            </div>
          </div>

          <TabsContent value="overview" className="mt-0">
            <BenchmarkOverviewTab
              onGoToSetup={goToSetupSection}
              onGoToRun={goToRunDetail}
              onGoToRunsList={() => goToPrimaryTab("runs")}
              onGoToTrends={goToTrends}
              onGoToCompare={goToCompare}
              onOpenWizard={openWizard}
              selectedClusterId={selectedClusterId}
              onSelectCluster={handleClusterChange}
            />
          </TabsContent>
          <TabsContent value="runs" className="mt-0">
            <BenchmarkRunsSection
              searchParams={searchParams}
              setSearchParams={setSearchParams}
              selectedClusterId={selectedClusterId}
            />
          </TabsContent>
          <TabsContent value="setup" className="mt-0">
            <BenchmarkSetupSection
              activeSection={setupSection}
              onSectionChange={goToSetupSection}
              selectedClusterId={selectedClusterId}
            />
          </TabsContent>
        </div>
      </Tabs>

      <RunBenchmarkWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onLaunched={handleWizardLaunched}
        onGoToSetup={goToSetupSection}
        initialReRunLast={wizardReRunLast}
      />
    </>
  );
}
