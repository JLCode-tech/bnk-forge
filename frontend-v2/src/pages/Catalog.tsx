/**
 * Catalog page — Streamlined 4-tab architecture.
 *
 * Unified home for shared, reusable building blocks behind 4 clear primary tabs:
 *   • Blueprints & Stacks — browsable blueprint catalog with source management
 *   • Modules             — browsable module catalog with source management
 *   • Helm Charts & Repos — chart repositories & registries
 *   • System & DPU Images — DOCA/BFB releases, BNK releases, and bf.conf templates
 */
import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
// eslint-disable-next-line no-restricted-imports -- Vertical flush sub-sidebar requires Radix TabsList + TabsTrigger
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, Package, HardDrive, Library, RefreshCw } from "lucide-react";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import { cn } from "@/lib/utils";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import type { SystemSubTab } from "@/components/catalog/SystemImagesPanel";

const Modules = lazy(() => import("@/pages/Modules"));
const BlueprintCatalogPanel = lazy(
  () => import("@/components/catalog/BlueprintCatalogPanel"),
);
const HelmReposPanel = lazy(
  () => import("@/components/catalog/HelmReposPanel"),
);
const SystemImagesPanel = lazy(
  () => import("@/components/catalog/SystemImagesPanel"),
);

const VALID_TABS = [
  "blueprints",
  "modules",
  "helm-repos",
  "system-images",
] as const;
type CatalogTab = (typeof VALID_TABS)[number];

const DEFAULT_TAB: CatalogTab = "blueprints";

function TabFallback() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export default function Catalog() {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlTab = searchParams.get("tab");
  // Map legacy / deep-link subtab values to primary tab + initial system subtab
  let initialSystemSubTab: SystemSubTab = "doca";
  let resolvedTab = urlTab;
  if (
    urlTab === "bfb-images" ||
    urlTab === "doca-images" ||
    urlTab === "doca-releases"
  ) {
    resolvedTab = "system-images";
    initialSystemSubTab = "doca";
  } else if (urlTab === "bnk-releases") {
    resolvedTab = "system-images";
    initialSystemSubTab = "bnk";
  } else if (urlTab === "bf-conf-templates") {
    resolvedTab = "system-images";
    initialSystemSubTab = "bfconf";
  } else if (urlTab === "module-library") {
    resolvedTab = "modules";
  }

  const activeTab: CatalogTab = VALID_TABS.includes(resolvedTab as CatalogTab)
    ? (resolvedTab as CatalogTab)
    : DEFAULT_TAB;

  const handleTabChange = (tab: string) => {
    if (tab === DEFAULT_TAB) {
      searchParams.delete("tab");
    } else {
      searchParams.set("tab", tab);
    }
    setSearchParams(searchParams);
  };

  const { refresh, isRefreshing } = usePageRefresh();

  const tabs = [
    { key: "blueprints" as const, label: "Blueprints & Stacks", icon: Library },
    { key: "modules" as const, label: "Modules", icon: Layers },
    { key: "helm-repos" as const, label: "Helm Charts & Repos", icon: Package },
    {
      key: "system-images" as const,
      label: "System & DPU Images",
      icon: HardDrive,
    },
  ];

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      orientation="vertical"
      className="flex min-h-[calc(100vh-3rem)]"
    >
      {/* Left Flush Inner Sub-Sidebar */}
      <CollapsibleInnerSidebar className="w-52 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
        <div className="border-b border-border pb-3 px-1">
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            Catalog &amp; Blueprints
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            Deployable multi-module blueprints, stacks, Terraform modules, and
            Helm charts
          </p>
        </div>

        <div className="space-y-1">
          <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            CATALOG
          </div>
          <TabsList
            aria-label="Catalog sections"
            className="flex flex-col items-stretch h-auto bg-transparent p-0 gap-1"
          >
            {tabs.map(({ key, label, icon: Icon }) => (
              <TabsTrigger
                key={key}
                value={key}
                className="w-full justify-start gap-2 px-2.5 py-1.5 text-xs font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </CollapsibleInnerSidebar>

      {/* Right Content Pane */}
      <div className="flex-1 min-w-0 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {tabs.find((t) => t.key === activeTab)?.label ??
                "Catalog & Blueprints"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Deployable multi-module blueprints, stacks, Terraform modules, and
              Helm charts
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 shrink-0"
            onClick={refresh}
            disabled={isRefreshing}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5 mr-1.5",
                isRefreshing && "animate-spin",
              )}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>

        <TabsContent value="blueprints" className="mt-0">
          <Suspense fallback={<TabFallback />}>
            <BlueprintCatalogPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="modules" className="mt-0">
          <Suspense fallback={<TabFallback />}>
            <Modules embedded />
          </Suspense>
        </TabsContent>

        <TabsContent value="helm-repos" className="mt-0">
          <Suspense fallback={<TabFallback />}>
            <HelmReposPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="system-images" className="mt-0">
          <Suspense fallback={<TabFallback />}>
            <SystemImagesPanel initialSubTab={initialSystemSubTab} />
          </Suspense>
        </TabsContent>
      </div>
    </Tabs>
  );
}
