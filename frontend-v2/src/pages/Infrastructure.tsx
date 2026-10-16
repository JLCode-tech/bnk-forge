/**
 * Infrastructure page — D-022 P6 IA
 *
 * Top-level section for hardware infrastructure: Topology Map, Bare-Metal Hosts,
 * and DPUs / BlueField.
 */

import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
// eslint-disable-next-line no-restricted-imports -- Vertical flush sub-sidebar requires Radix TabsList + TabsTrigger
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import { ClusterPicker } from "@/components/k8s/ClusterPicker";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import { useProjects } from "@/hooks/useProjects";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { cn } from "@/lib/utils";
import { CircuitBoard, Network, RefreshCw, Server } from "lucide-react";

function readClusterScope(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CLUSTER_SCOPE);
    if (!raw || raw === "all") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeClusterScope(id: number | null): void {
  try {
    if (id == null) {
      localStorage.removeItem(STORAGE_KEYS.CLUSTER_SCOPE);
    } else {
      localStorage.setItem(STORAGE_KEYS.CLUSTER_SCOPE, String(id));
    }
  } catch {
    /* ignore */
  }
}
import { DpuInfrastructurePanel } from "@/components/infrastructure/DpuInfrastructurePanel";
import { DpuConnectivityMatrixCard } from "@/components/dpu/DpuConnectivityMatrixCard";

const BareMetalPanel = lazy(() =>
  import("@/components/bare-metal/BareMetalPanel").then((m) => ({
    default: m.BareMetalPanel,
  })),
);

const DpuPanel = lazy(() =>
  import("@/components/dpu/DpuPanel").then((m) => ({
    default: m.DpuPanel,
  })),
);

type InfraView = "topology" | "bare-metal" | "dpus";

const VALID_VIEWS: InfraView[] = ["topology", "bare-metal", "dpus"];

export default function Infrastructure() {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlView = searchParams.get("tab") as InfraView | null;
  const initialView: InfraView =
    urlView && VALID_VIEWS.includes(urlView) ? urlView : "dpus";

  const [activeView, setActiveView] = useState<InfraView>(initialView);
  const dpfClusterParam = searchParams.get("cluster");
  const selectedClusterId = dpfClusterParam
    ? Number(dpfClusterParam)
    : readClusterScope();

  const handleClusterChange = useCallback(
    (id: number | null) => {
      writeClusterScope(id);
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

  // Workspace (projectId) state synced with ClusterPicker project scope
  const { data: projects = [] } = useProjects();
  const [projectScope, setProjectScope] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.PROJECT_SCOPE) || "all";
    } catch {
      return "all";
    }
  });

  useEffect(() => {
    const syncProjectScope = () => {
      try {
        setProjectScope(
          localStorage.getItem(STORAGE_KEYS.PROJECT_SCOPE) || "all",
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", syncProjectScope);
    return () => window.removeEventListener("storage", syncProjectScope);
  }, []);

  const selectedProjectId: number | null =
    projectScope !== "all" && !Number.isNaN(Number(projectScope))
      ? Number(projectScope)
      : (projects[0]?.id ?? null);

  const handleSelectView = useCallback(
    (view: string) => {
      const v = VALID_VIEWS.includes(view as InfraView)
        ? (view as InfraView)
        : "dpus";
      setActiveView(v);
      const next = new URLSearchParams(searchParams);
      next.set("tab", v);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const { refresh, isRefreshing } = usePageRefresh();

  return (
    <Tabs
      value={activeView}
      onValueChange={handleSelectView}
      orientation="vertical"
      className="flex min-h-[calc(100vh-3rem)]"
    >
      {/* Left Flush Inner Sub-Sidebar */}
      <CollapsibleInnerSidebar className="w-52 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
        <div className="px-2 py-1 space-y-1">
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            Infrastructure
          </h1>
          <p className="text-2xs text-muted-foreground leading-relaxed">
            Hardware infrastructure — Topology map, bare-metal hosts, and DPU /
            BlueField accelerators.
          </p>
        </div>

        <div className="space-y-1">
          <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            HARDWARE &amp; TOPOLOGY
          </div>
          <TabsList
            aria-label="Infrastructure views"
            className="flex flex-col items-stretch h-auto bg-transparent p-0 gap-1"
          >
            <TabsTrigger
              value="topology"
              className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <Network className="h-3.5 w-3.5 shrink-0" />
              <span>Topology Map</span>
            </TabsTrigger>
            <TabsTrigger
              value="bare-metal"
              className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <Server className="h-3.5 w-3.5 shrink-0" />
              <span>Bare-Metal Hosts</span>
            </TabsTrigger>
            <TabsTrigger
              value="dpus"
              className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <CircuitBoard className="h-3.5 w-3.5 shrink-0" />
              <span>DPUs / BlueField</span>
            </TabsTrigger>
          </TabsList>
        </div>
      </CollapsibleInnerSidebar>

      {/* Right Content Pane */}
      <div className="flex-1 min-w-0 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {activeView === "topology"
                ? "Topology Map"
                : activeView === "bare-metal"
                  ? "Bare-Metal Hosts"
                  : "DPUs / BlueField"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {activeView === "topology"
                ? "Physical host, DPU, and switch connectivity matrix"
                : activeView === "bare-metal"
                  ? "Bare-metal host inventory, BMC/IPMI credentials, and provisioning"
                  : "NVIDIA BlueField DPU fleet, DPF clusters, and hardware offloads"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ClusterPicker
              value={selectedClusterId}
              onChange={handleClusterChange}
              showProjectSelector
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={refresh}
              disabled={isRefreshing}
              aria-label="Refresh"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 mr-1.5",
                  isRefreshing && "animate-spin",
                )}
              />
              Refresh
            </Button>
          </div>
        </div>

        <TabsContent value="topology" className="mt-0 space-y-6">
          {selectedProjectId ? (
            <DpuConnectivityMatrixCard
              projectId={selectedProjectId}
              disabled={false}
            />
          ) : (
            <SectionCard>
              <EmptyState
                icon={Network}
                title="No Workspace Selected"
                description="Select a workspace in the header to view the physical host, DPU, and switch connectivity topology."
              />
            </SectionCard>
          )}
        </TabsContent>

        <TabsContent value="bare-metal" className="mt-0">
          {selectedProjectId ? (
            <Suspense fallback={<SkeletonTable rows={6} columns={5} />}>
              <BareMetalPanel projectId={selectedProjectId} isOwner={true} />
            </Suspense>
          ) : (
            <SectionCard>
              <EmptyState
                icon={Server}
                title="No Workspace Selected"
                description="Select a workspace in the header to manage bare-metal hosts, BMC/IPMI credentials, and multi-host deployments."
              />
            </SectionCard>
          )}
        </TabsContent>

        <TabsContent value="dpus" className="mt-0 space-y-6">
          <DpuInfrastructurePanel
            initialClusterId={selectedClusterId ?? undefined}
          />
          {selectedProjectId && (
            <Suspense fallback={<SkeletonTable rows={5} columns={5} />}>
              <DpuPanel projectId={selectedProjectId} isOwner={true} />
            </Suspense>
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}
