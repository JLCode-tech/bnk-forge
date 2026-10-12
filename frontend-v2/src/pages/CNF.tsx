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
import { useQueryClient } from "@tanstack/react-query";
import { Cpu, LayoutDashboard, Network, Radio } from "lucide-react";
import { ResourcePageHeader } from "@/components/layout/ResourcePageHeader";
import { ResourceExplorerLayout } from "@/components/layout/ResourceExplorerLayout";
import { ResourceViewTabs } from "@/components/layout/ResourceViewTabs";
import { ConnectivityGate } from "@/components/ConnectivityGate";
import { ResourceDescribeViewer } from "@/components/k8s/ResourceDescribeViewer";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProjects } from "@/hooks/useProjects";
import { useAllClusters } from "@/hooks/useK8sClusters";
import { useProjectClusters, useClusterNamespaces } from "@/hooks/useK8s";
import { useAutoSelectProjectCluster } from "@/hooks/useAutoSelectProjectCluster";
import { useClusterReachable } from "@/hooks/useConnectivity";
import { useClusterResources } from "@/hooks/useK8sResources";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import type { K8sResource } from "@/types/kubernetes";
import { CNFClusterRow } from "./cnf-parts/CNFClusterRow";

import {
  CNFOverview,
  CNFDnsPanel,
  CNFTelcoPanel,
  CNFNetworkGraph,
} from "./cnf-parts";

export default function CNF() {
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------------------
  // View mode tab: 'overview' | 'dns' | 'telco' | 'network-graph'
  // ---------------------------------------------------------------------------
  const [view, setView] = useState<
    "overview" | "dns" | "telco" | "network-graph"
  >("overview");
  const [searchQuery, setSearchQuery] = useState("");

  // ---------------------------------------------------------------------------
  // Projects & Clusters
  // ---------------------------------------------------------------------------
  const { data: projects = [] } = useProjects();
  const { data: allClustersResponse } = useAllClusters();
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
    const fromStorage = localStorage.getItem(STORAGE_KEYS.CNF_CLUSTER);
    return fromStorage ? Number(fromStorage) : null;
  });

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
  // Selection and Describe modal
  // ---------------------------------------------------------------------------
  const [selectedResource, setSelectedResource] = useState<K8sResource | null>(
    null,
  );
  const [describeOpen, setDescribeOpen] = useState(false);
  const [resourceToDescribe, setResourceToDescribe] =
    useState<K8sResource | null>(null);

  const handleDescribe = useCallback((resource: K8sResource) => {
    setResourceToDescribe(resource);
    setDescribeOpen(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Dedicated CNF Telemetry Queries
  // ---------------------------------------------------------------------------
  const nsParam =
    selectedNamespace === "all" ? undefined : { namespace: selectedNamespace };

  const { data: dnsAppsData, isLoading: dnsAppsLoading } = useClusterResources(
    selectedCluster ?? 0,
    "f5bigdnsapps",
    nsParam,
    { enabled: !!selectedCluster && isClusterReachable },
  );

  const { data: dnsCachesData, isLoading: dnsCachesLoading } =
    useClusterResources(
      selectedCluster ?? 0,
      "f5bigdnsresolvercaches",
      nsParam,
      { enabled: !!selectedCluster && isClusterReachable },
    );

  const { data: dnsZonesData, isLoading: dnsZonesLoading } =
    useClusterResources(selectedCluster ?? 0, "f5bigdnszones", nsParam, {
      enabled: !!selectedCluster && isClusterReachable,
    });

  const { data: cnatData, isLoading: cnatLoading } = useClusterResources(
    selectedCluster ?? 0,
    "f5bigcgnats",
    nsParam,
    { enabled: !!selectedCluster && isClusterReachable },
  );

  const { data: diameterData, isLoading: diameterLoading } =
    useClusterResources(selectedCluster ?? 0, "f5bigdiameters", nsParam, {
      enabled: !!selectedCluster && isClusterReachable,
    });

  const { data: ipsData, isLoading: ipsLoading } = useClusterResources(
    selectedCluster ?? 0,
    "f5bigipams",
    nsParam,
    { enabled: !!selectedCluster && isClusterReachable },
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

      {/* View-mode tab strip */}
      {selectedCluster && (
        <ResourceViewTabs
          aria-label="F5 CNF view mode"
          active={view}
          onChange={(key) =>
            setView(key as "overview" | "dns" | "telco" | "network-graph")
          }
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
              title: "Carrier-Grade NAT (CGNAT) and Diameter signaling router",
            },
            {
              key: "network-graph",
              label: "Network Graph",
              icon: Network,
              title: "Data plane packet pipeline and telco topology",
            },
          ]}
        />
      )}

      {/* Main Content Area */}
      <ResourceExplorerLayout.Body>
        {!selectedCluster ? (
          <div className="p-6 space-y-6 max-w-7xl mx-auto">
            <Card className="border-border bg-card">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Radio className="h-4 w-4 text-primary" />
                      CNF by Cluster
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Network functions installed per cluster. Select one to
                      inspect DNS, CGNAT and Diameter.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {visibleClusters.length} clusters
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-muted/40">
                      <TableHead className="text-xs font-semibold">
                        Cluster Name
                      </TableHead>
                      <TableHead className="text-xs font-semibold">
                        Cloud / Provider
                      </TableHead>
                      <TableHead className="text-xs font-semibold">
                        CNF Functions
                      </TableHead>
                      <TableHead className="text-xs font-semibold text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleClusters.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="h-24 text-center text-xs text-muted-foreground"
                        >
                          No clusters found in this project.
                        </TableCell>
                      </TableRow>
                    ) : (
                      visibleClusters.map((cluster) => (
                        <CNFClusterRow
                          key={cluster.id}
                          cluster={cluster}
                          onInspect={() => {
                            setSelectedCluster(cluster.id);
                            localStorage.setItem(
                              STORAGE_KEYS.CNF_CLUSTER,
                              String(cluster.id),
                            );
                          }}
                        />
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        ) : (
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
                crdsCount={0}
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
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                borderDefault="border-border"
              />
            )}

            {view === "network-graph" && (
              <CNFNetworkGraph
                clusterId={selectedCluster}
                dnsApps={dnsApps}
                cgnatInstances={cgnatInstances}
                diameterInstances={diameterInstances}
              />
            )}
          </ConnectivityGate>
        )}
      </ResourceExplorerLayout.Body>

      {/* Resource Describe Viewer Dialog */}
      {selectedCluster && (
        <ResourceDescribeViewer
          open={describeOpen}
          onOpenChange={setDescribeOpen}
          resource={resourceToDescribe}
          clusterId={selectedCluster}
          namespace={resourceToDescribe?.metadata?.namespace}
        />
      )}
    </ResourceExplorerLayout>
  );
}
