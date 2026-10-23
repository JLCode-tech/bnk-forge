/**
 * F5 CNF Dashboard — Cloud-Native Network Functions.
 *
 * Operational portal and telco data plane center:
 * - Overview: Fleet summary, KPI metrics, architectural pillars, function status cards
 * - DNS Services: Dedicated DNS Express, resolver caches, and listener management
 * - Network Functions: Carrier-Grade NAT (CGNAT) and Diameter signaling routing
 * - Network Graph: Interactive Telco data plane graph (BGP -> SR-IOV/DPDK -> TMM Core -> CNF Engines -> 5G Core)
 *
 * Cluster/namespace selection is persisted to localStorage under CNF-specific keys.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Cpu, LayoutDashboard, Network, Radio } from "lucide-react";
import { ResourcePageHeader } from "@/components/layout/ResourcePageHeader";
import { ResourceExplorerLayout } from "@/components/layout/ResourceExplorerLayout";
import { ResourceSidebarViewTabs } from "@/components/layout/ResourceCategorySidebar";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import { ConnectivityGate } from "@/components/ConnectivityGate";
import { ResourceDescribeViewer } from "@/components/k8s/ResourceDescribeViewer";
import { ResourceCreateDialog } from "@/components/k8s/ResourceCreateDialog";
import { ResourceEditDialog } from "@/components/k8s/ResourceEditDialog";
import { ResourceDeleteDialog } from "@/components/k8s/ResourceDeleteDialog";
import { ClusterScopePickerCard } from "@/components/k8s/ClusterScopePickerCard";
import { ErrorState } from "@/components/ui/error-state";
import { TableHead } from "@/components/ui/table";
import { useProjects } from "@/hooks/useProjects";
import { useAllClusters } from "@/hooks/useK8sClusters";
import { useProjectClusters, useClusterNamespaces } from "@/hooks/useK8s";
import { useAutoSelectProjectCluster } from "@/hooks/useAutoSelectProjectCluster";
import { useClusterReachable } from "@/hooks/useConnectivity";
import { useClusterResources } from "@/hooks/useK8sResources";
import { useCrds } from "@/hooks/useCrds";
import { api } from "@/lib/api";
import { parseApiError } from "@/lib/error-handler";
import { notify } from "@/lib/notify";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import type { K8sResource } from "@/types/kubernetes";
import { CNFClusterRow } from "./cnf-parts/CNFClusterRow";

import {
  CNFOverview,
  CNFDnsPanel,
  CNFTelcoPanel,
  CNFNetworkGraph,
  YAML_TEMPLATES,
} from "./cnf-parts";

export default function CNF() {
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------------------
  // View mode tab: 'overview' | 'dns' | 'telco' | 'network-graph'
  // ---------------------------------------------------------------------------
  const [searchParams, setSearchParams] = useSearchParams();
  const rawView = searchParams.get("view");
  const validViews = ["overview", "dns", "telco", "network-graph"] as const;
  type CNFView = (typeof validViews)[number];
  const view: CNFView = validViews.includes(rawView as CNFView)
    ? (rawView as CNFView)
    : "overview";

  const setView = useCallback(
    (nextView: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextView === "overview") {
            next.delete("view");
          } else {
            next.set("view", nextView);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [searchQuery, setSearchQuery] = useState("");

  // ---------------------------------------------------------------------------
  // Projects & Clusters
  // ---------------------------------------------------------------------------
  const { data: projects = [] } = useProjects();
  const {
    data: allClustersResponse,
    error: allClustersError,
    isLoading: allClustersLoading,
  } = useAllClusters();
  const allClusters = useMemo(
    () => allClustersResponse?.clusters ?? [],
    [allClustersResponse?.clusters],
  );

  const [selectedProject, setSelectedProject] = useState<number | null>(() => {
    const fromStorage = localStorage.getItem(STORAGE_KEYS.CNF_PROJECT);
    return fromStorage ? Number(fromStorage) : null;
  });

  const { data: projectClusters = [] } = useProjectClusters(
    selectedProject || 0,
  );

  const visibleClusters = useMemo(() => {
    if (!selectedProject) return allClusters;
    return allClusters.filter((c) => c.project_id === selectedProject);
  }, [selectedProject, allClusters]);

  const [selectedCluster, setSelectedCluster] = useState<number | null>(() => {
    const fromUrl = searchParams.get("cluster");
    if (fromUrl) {
      const parsed = Number(fromUrl);
      if (Number.isFinite(parsed) && parsed > 0) {
        localStorage.setItem(STORAGE_KEYS.CNF_CLUSTER, String(parsed));
        return parsed;
      }
    }
    const fromStorage = localStorage.getItem(STORAGE_KEYS.CNF_CLUSTER);
    return fromStorage ? Number(fromStorage) : null;
  });

  // Sync URL ?cluster= changes after initial mount
  useEffect(() => {
    const clusterParam = searchParams.get("cluster");
    if (clusterParam) {
      const parsed = Number(clusterParam);
      if (Number.isFinite(parsed) && parsed > 0 && parsed !== selectedCluster) {
        setSelectedCluster(parsed);
        localStorage.setItem(STORAGE_KEYS.CNF_CLUSTER, String(parsed));
      }
    }
  }, [searchParams, selectedCluster]);

  // Keep cluster selection valid: if cluster isn't in selected project, clear project (widen)
  // rather than wiping the shared cluster scope across the app (B-1 fix)
  useEffect(() => {
    if (selectedCluster && selectedProject && visibleClusters.length > 0) {
      const exists = visibleClusters.some((c) => c.id === selectedCluster);
      if (!exists) {
        setSelectedProject(null);
        localStorage.removeItem(STORAGE_KEYS.CNF_PROJECT);
      }
    }
  }, [selectedCluster, selectedProject, visibleClusters]);

  useAutoSelectProjectCluster({
    projects,
    allClusters,
    visibleClusters,
    selectedProject,
    selectedCluster,
    setSelectedProject,
    setSelectedCluster,
  });

  const isClusterReachable = useClusterReachable(selectedCluster ?? undefined);

  // ---------------------------------------------------------------------------
  // Namespaces
  // ---------------------------------------------------------------------------
  const { data: namespacesData } = useClusterNamespaces(selectedCluster ?? 0);
  const namespaces = useMemo(
    () => namespacesData?.namespaces ?? [],
    [namespacesData],
  );

  const [selectedNamespace, setSelectedNamespace] = useState<string>("all");

  // ---------------------------------------------------------------------------
  // Selection, Describe, and CRUD modals
  // ---------------------------------------------------------------------------
  const [selectedResource, setSelectedResource] = useState<K8sResource | null>(
    null,
  );
  const [describeOpen, setDescribeOpen] = useState(false);
  const [resourceToDescribe, setResourceToDescribe] =
    useState<K8sResource | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createResourceType, setCreateResourceType] =
    useState<string>("f5bigdnsapps");

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [resourceToEdit, setResourceToEdit] = useState<K8sResource | null>(
    null,
  );
  const [editResourceType, setEditResourceType] =
    useState<string>("f5bigdnsapps");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resourceToDelete, setResourceToDelete] = useState<K8sResource | null>(
    null,
  );
  const [deleteResourceType, setDeleteResourceType] =
    useState<string>("f5bigdnsapps");

  const handleDescribe = useCallback((resource: K8sResource) => {
    setResourceToDescribe(resource);
    setDescribeOpen(true);
  }, []);

  const handleCreateResource = useCallback((resourceType: string) => {
    setCreateResourceType(resourceType);
    setCreateDialogOpen(true);
  }, []);

  const handleEditResource = useCallback(
    (resource: K8sResource, resourceType: string) => {
      setResourceToEdit(resource);
      setEditResourceType(resourceType);
      setEditDialogOpen(true);
    },
    [],
  );

  const handleDeleteResource = useCallback(
    (resource: K8sResource, resourceType: string) => {
      setResourceToDelete(resource);
      setDeleteResourceType(resourceType);
      setDeleteDialogOpen(true);
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Dedicated CNF Telemetry Queries
  // ---------------------------------------------------------------------------
  const nsParam =
    selectedNamespace === "all" ? undefined : { namespace: selectedNamespace };

  const { data: crdsData } = useCrds(selectedCluster ?? 0, {
    group: ["k8s.f5net.com"],
    enabled: !!selectedCluster && isClusterReachable && view === "overview",
  });

  const { data: dnsAppsData, isLoading: dnsAppsLoading } = useClusterResources(
    selectedCluster ?? 0,
    "f5bigdnsapps",
    nsParam,
    {
      enabled:
        !!selectedCluster &&
        isClusterReachable &&
        (view === "overview" || view === "dns" || view === "network-graph"),
    },
  );

  const { data: dnsCachesData, isLoading: dnsCachesLoading } =
    useClusterResources(
      selectedCluster ?? 0,
      "f5bigdnsresolvercaches",
      nsParam,
      {
        enabled:
          !!selectedCluster &&
          isClusterReachable &&
          (view === "overview" || view === "dns"),
      },
    );

  const { data: dnsZonesData, isLoading: dnsZonesLoading } =
    useClusterResources(selectedCluster ?? 0, "f5bigdnszones", nsParam, {
      enabled:
        !!selectedCluster &&
        isClusterReachable &&
        (view === "overview" || view === "dns"),
    });

  const { data: cnatData, isLoading: cnatLoading } = useClusterResources(
    selectedCluster ?? 0,
    "f5bigcgnats",
    nsParam,
    {
      enabled:
        !!selectedCluster &&
        isClusterReachable &&
        (view === "overview" || view === "telco" || view === "network-graph"),
    },
  );

  const { data: diameterData, isLoading: diameterLoading } =
    useClusterResources(selectedCluster ?? 0, "f5bigdiameters", nsParam, {
      enabled:
        !!selectedCluster &&
        isClusterReachable &&
        (view === "overview" || view === "telco" || view === "network-graph"),
    });

  const { data: ipsData, isLoading: ipsLoading } = useClusterResources(
    selectedCluster ?? 0,
    "f5bigipams",
    nsParam,
    {
      enabled:
        !!selectedCluster &&
        isClusterReachable &&
        (view === "overview" || view === "telco"),
    },
  );

  const dnsApps: K8sResource[] = useMemo(() => {
    if (!dnsAppsData) return [];
    if (Array.isArray(dnsAppsData)) return dnsAppsData;
    const items = (dnsAppsData as { items?: K8sResource[] }).items;
    return Array.isArray(items) ? items : [];
  }, [dnsAppsData]);

  const dnsCaches: K8sResource[] = useMemo(() => {
    if (!dnsCachesData) return [];
    if (Array.isArray(dnsCachesData)) return dnsCachesData;
    const items = (dnsCachesData as { items?: K8sResource[] }).items;
    return Array.isArray(items) ? items : [];
  }, [dnsCachesData]);

  const dnsZones: K8sResource[] = useMemo(() => {
    if (!dnsZonesData) return [];
    if (Array.isArray(dnsZonesData)) return dnsZonesData;
    const items = (dnsZonesData as { items?: K8sResource[] }).items;
    return Array.isArray(items) ? items : [];
  }, [dnsZonesData]);

  const cgnatInstances: K8sResource[] = useMemo(() => {
    if (!cnatData) return [];
    if (Array.isArray(cnatData)) return cnatData;
    const items = (cnatData as { items?: K8sResource[] }).items;
    return Array.isArray(items) ? items : [];
  }, [cnatData]);

  const diameterInstances: K8sResource[] = useMemo(() => {
    if (!diameterData) return [];
    if (Array.isArray(diameterData)) return diameterData;
    const items = (diameterData as { items?: K8sResource[] }).items;
    return Array.isArray(items) ? items : [];
  }, [diameterData]);

  const ipamInstances: K8sResource[] = useMemo(() => {
    if (!ipsData) return [];
    if (Array.isArray(ipsData)) return ipsData;
    const items = (ipsData as { items?: K8sResource[] }).items;
    return Array.isArray(items) ? items : [];
  }, [ipsData]);

  const activeCnfResourcesCount =
    dnsCaches.length +
    dnsApps.length +
    dnsZones.length +
    cgnatInstances.length +
    diameterInstances.length +
    ipamInstances.length;
  const discoveredCrdsCount = useMemo(() => {
    const crds = crdsData?.crds ?? [];
    return crds.filter(
      (crd) =>
        crd.group === "k8s.f5net.com" ||
        crd.group?.endsWith(".f5net.com") ||
        crd.group?.endsWith(".f5.com") ||
        Boolean(YAML_TEMPLATES[crd.plural]),
    ).length;
  }, [crdsData]);

  // ---------------------------------------------------------------------------
  // Refresh Handler
  // ---------------------------------------------------------------------------
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (!selectedCluster) return;
    setIsManualRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: ["k8s", "clusters", selectedCluster, "resources"],
      });
    } finally {
      setIsManualRefreshing(false);
    }
  }, [queryClient, selectedCluster]);

  const isRefreshing =
    isManualRefreshing ||
    dnsAppsLoading ||
    dnsCachesLoading ||
    dnsZonesLoading ||
    cnatLoading ||
    diameterLoading ||
    ipsLoading;

  const currentCluster = projectClusters.find((c) => c.id === selectedCluster);

  return (
    <ResourceExplorerLayout>
      <ResourcePageHeader
        title="F5 CNF"
        subtitle="Carrier-grade telco network functions and high-speed packet processing"
        projects={projects || []}
        selectedProjectId={selectedProject}
        onProjectChange={(id) => {
          setSelectedProject(id);
          if (id) {
            localStorage.setItem(STORAGE_KEYS.CNF_PROJECT, String(id));
          } else {
            localStorage.removeItem(STORAGE_KEYS.CNF_PROJECT);
          }
        }}
        clusters={visibleClusters}
        selectedClusterId={selectedCluster}
        allowAllClusters={true}
        onClusterChange={(id) => {
          setSelectedCluster(id);
          if (id) {
            localStorage.setItem(STORAGE_KEYS.CNF_CLUSTER, String(id));
          } else {
            localStorage.removeItem(STORAGE_KEYS.CNF_CLUSTER);
          }
        }}
        namespaces={namespaces}
        selectedNamespace={selectedNamespace}
        onNamespaceChange={setSelectedNamespace}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {/* Main Content Area */}
      <ResourceExplorerLayout.Body>
        {/* Persistent Flush Left Inner Sub-Sidebar */}
        <CollapsibleInnerSidebar className="w-52 shrink-0 border-r border-border bg-card/30 flex flex-col">
          <ResourceSidebarViewTabs
            aria-label="F5 CNF view mode"
            active={view}
            onChange={(key) => {
              setView(key as "overview" | "dns" | "telco" | "network-graph");
              if (!selectedCluster && visibleClusters.length > 0) {
                const firstId = visibleClusters[0].id;
                setSelectedCluster(firstId);
                localStorage.setItem(STORAGE_KEYS.CNF_CLUSTER, String(firstId));
              }
            }}
            tabs={[
              {
                key: "overview",
                label: "Overview",
                icon: LayoutDashboard,
                title: "Executive summary, telco KPIs, and functional status",
              },
              {
                key: "dns",
                label: "DNS Services",
                icon: Radio,
                title:
                  "DNS Express resolution metrics, resolver caches, and listener status",
              },
              {
                key: "telco",
                label: "Network Functions",
                icon: Cpu,
                title:
                  "Carrier-Grade NAT (CGNAT) and Diameter signaling router",
              },
              {
                key: "network-graph",
                label: "Network Graph",
                icon: Network,
                title: "Data plane packet pipeline and telco topology",
              },
            ]}
          />
        </CollapsibleInnerSidebar>

        {!selectedCluster ? (
          <ResourceExplorerLayout.Content className="p-6 space-y-6 w-full overflow-y-auto">
            {allClustersError ? (
              <ErrorState
                error={allClustersError}
                title="Failed to load clusters"
                onRetry={handleRefresh}
              />
            ) : (
              <ClusterScopePickerCard
                title="CNF by Cluster"
                description="Network functions installed per cluster. Select one to inspect DNS, CGNAT and Diameter."
                clusters={visibleClusters}
                isLoading={allClustersLoading}
                onSelectCluster={(id) => {
                  setSelectedCluster(id);
                  localStorage.setItem(STORAGE_KEYS.CNF_CLUSTER, String(id));
                }}
                actionLabel="Inspect CNF"
                showStatusColumn={false}
                extraColumnCount={1}
                extraHeaders={
                  <TableHead className="text-xs font-semibold">
                    CNF Functions
                  </TableHead>
                }
                renderRow={(cluster, onSelect) => (
                  <CNFClusterRow
                    key={cluster.id}
                    cluster={cluster}
                    onInspect={() => onSelect(cluster.id)}
                  />
                )}
              />
            )}
          </ResourceExplorerLayout.Content>
        ) : (
          <>
            <ResourceExplorerLayout.Content className="flex flex-col overflow-y-auto">
              <ConnectivityGate
                target={{
                  type: "cluster",
                  id: selectedCluster ?? 0,
                  displayName: currentCluster?.name,
                }}
              >
                {view === "overview" && (
                  <CNFOverview
                    clusterName={currentCluster?.name}
                    crdsCount={
                      discoveredCrdsCount > 0
                        ? discoveredCrdsCount
                        : activeCnfResourcesCount
                    }
                    dnsCachesCount={dnsCaches.length}
                    dnsAppsCount={dnsApps.length}
                    dnsZonesCount={dnsZones.length}
                    cnatCount={cgnatInstances.length}
                    diameterCount={diameterInstances.length}
                    ipsCount={ipamInstances.length}
                    onNavigateTab={(tab) => setView(tab)}
                  />
                )}

                {view === "dns" && (
                  <CNFDnsPanel
                    caches={dnsCaches}
                    apps={dnsApps}
                    zones={dnsZones}
                    isLoading={
                      dnsAppsLoading || dnsCachesLoading || dnsZonesLoading
                    }
                    selectedResource={selectedResource}
                    onSelectResource={setSelectedResource}
                    onDescribe={handleDescribe}
                    onCreateResource={handleCreateResource}
                    onEditResource={handleEditResource}
                    onDeleteResource={handleDeleteResource}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    borderDefault="border-border"
                  />
                )}

                {view === "telco" && (
                  <CNFTelcoPanel
                    cnatPolicies={cgnatInstances}
                    diameterEndpoints={diameterInstances}
                    ipsPolicies={ipamInstances}
                    isLoading={cnatLoading || diameterLoading || ipsLoading}
                    selectedResource={selectedResource}
                    onSelectResource={setSelectedResource}
                    onDescribe={handleDescribe}
                    onCreateResource={handleCreateResource}
                    onEditResource={handleEditResource}
                    onDeleteResource={handleDeleteResource}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    borderDefault="border-border"
                  />
                )}

                {view === "network-graph" && (
                  <CNFNetworkGraph
                    clusterId={selectedCluster}
                    namespace={selectedNamespace}
                    dnsApps={dnsApps}
                    cgnatInstances={cgnatInstances}
                    diameterInstances={diameterInstances}
                    onDescribeResource={handleDescribe}
                  />
                )}
              </ConnectivityGate>
            </ResourceExplorerLayout.Content>
          </>
        )}
      </ResourceExplorerLayout.Body>

      {/* Resource Describe & CRUD Dialogs */}
      {selectedCluster && (
        <>
          <ResourceDescribeViewer
            open={describeOpen}
            onOpenChange={setDescribeOpen}
            resource={resourceToDescribe}
            clusterId={selectedCluster}
            namespace={resourceToDescribe?.metadata?.namespace}
          />

          <ResourceCreateDialog
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            resourceType={createResourceType}
            namespace={
              selectedNamespace === "all" ? "default" : selectedNamespace
            }
            onSubmit={async (resourceYaml, dryRun) => {
              try {
                await api.createK8sResource(
                  selectedCluster,
                  createResourceType,
                  {
                    resource_yaml: resourceYaml,
                    namespace:
                      selectedNamespace === "all"
                        ? "default"
                        : selectedNamespace,
                    dry_run: dryRun,
                  },
                );
                if (dryRun) {
                  notify.success(
                    "Dry run successful - no changes applied",
                    undefined,
                    { category: "cluster" },
                  );
                } else {
                  setCreateDialogOpen(false);
                  void handleRefresh();
                }
              } catch (error: unknown) {
                const parsed = parseApiError(error);
                notify.error(parsed.title, parsed.message, {
                  category: "cluster",
                });
              }
            }}
          />

          {resourceToEdit && (
            <ResourceEditDialog
              open={editDialogOpen}
              onOpenChange={setEditDialogOpen}
              resource={resourceToEdit}
              onSubmit={async (resourceYaml, dryRun) => {
                try {
                  await api.updateK8sResource(
                    selectedCluster,
                    editResourceType,
                    resourceToEdit.metadata.name,
                    {
                      resource_yaml: resourceYaml,
                      namespace: resourceToEdit.metadata.namespace,
                      dry_run: dryRun,
                    },
                  );
                  if (dryRun) {
                    notify.success(
                      "Dry run successful - no changes applied",
                      undefined,
                      { category: "cluster" },
                    );
                  } else {
                    setEditDialogOpen(false);
                    setResourceToEdit(null);
                    void handleRefresh();
                  }
                } catch (error: unknown) {
                  const parsed = parseApiError(error);
                  notify.error(parsed.title, parsed.message, {
                    category: "cluster",
                  });
                }
              }}
            />
          )}

          {resourceToDelete && (
            <ResourceDeleteDialog
              open={deleteDialogOpen}
              onOpenChange={setDeleteDialogOpen}
              resource={resourceToDelete}
              onConfirm={async () => {
                try {
                  await api.deleteK8sResource(
                    selectedCluster,
                    deleteResourceType,
                    resourceToDelete.metadata.name,
                    { namespace: resourceToDelete.metadata.namespace },
                  );
                  notify.success(
                    `${resourceToDelete.kind} deleted successfully`,
                    undefined,
                    { category: "cluster" },
                  );
                  setDeleteDialogOpen(false);
                  setResourceToDelete(null);
                  setSelectedResource(null);
                  void handleRefresh();
                } catch (error: unknown) {
                  const parsed = parseApiError(error);
                  notify.error(parsed.title, parsed.message, {
                    category: "cluster",
                  });
                }
              }}
            />
          )}
        </>
      )}
    </ResourceExplorerLayout>
  );
}
