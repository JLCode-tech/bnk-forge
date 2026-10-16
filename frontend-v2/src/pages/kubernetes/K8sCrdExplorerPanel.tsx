import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useCrds, type CRDInfo } from "@/hooks/useCrds";
import { useClusterResources, useClusterNamespaces } from "@/hooks/useK8s";
import { useTopology } from "@/hooks/useTopology";
import { api } from "@/lib/api";
import { parseApiError } from "@/lib/error-handler";
import { notify } from "@/lib/notify";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Skeleton } from "@/components/ui/skeleton";
import { ResourceTopologyGraph } from "@/components/k8s/ResourceTopologyGraph";
import { ResourceDescribeViewer } from "@/components/k8s/ResourceDescribeViewer";
import { ResourceCreateDialog } from "@/components/k8s/ResourceCreateDialog";
import { ResourceEditDialog } from "@/components/k8s/ResourceEditDialog";
import { ResourceDeleteDialog } from "@/components/k8s/ResourceDeleteDialog";
import { CNFDetailPanel } from "../cnf-parts";
import {
  Search,
  Database,
  Eye,
  RefreshCw,
  Network,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { K8sResource } from "@/types";

interface K8sCrdExplorerPanelProps {
  clusterId: number | null;
  initialCrd?: string | null;
}

export function K8sCrdExplorerPanel({
  clusterId,
  initialCrd,
}: K8sCrdExplorerPanelProps) {
  const [searchParams] = useSearchParams();
  const initialMode =
    searchParams.get("crdMode") === "topology" ||
    searchParams.get("view") === "topology"
      ? "topology"
      : "browser";
  const [viewMode, setViewMode] = useState<"browser" | "topology">(initialMode);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedCrd, setSelectedCrd] = useState<CRDInfo | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState<string>("all");
  const [selectedInstance, setSelectedInstance] = useState<K8sResource | null>(
    null,
  );

  // Dialog states
  const [describeOpen, setDescribeOpen] = useState(false);
  const [resourceToDescribe, setResourceToDescribe] =
    useState<K8sResource | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [resourceToEdit, setResourceToEdit] = useState<K8sResource | null>(
    null,
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resourceToDelete, setResourceToDelete] = useState<K8sResource | null>(
    null,
  );

  const handleDescribe = useCallback((resource: K8sResource) => {
    setResourceToDescribe(resource);
    setDescribeOpen(true);
  }, []);

  const {
    data: crdsData,
    isLoading: crdsLoading,
    refetch: refetchCrds,
  } = useCrds(clusterId ?? 0, {
    enabled: !!clusterId,
  });

  const crds = useMemo(() => crdsData?.crds ?? [], [crdsData]);

  // When initialCrd is provided, auto-select the matching CRD once crds are loaded
  useEffect(() => {
    if (initialCrd && crds.length > 0 && !selectedCrd) {
      const match = crds.find(
        (c) =>
          c.name.toLowerCase() === initialCrd.toLowerCase() ||
          c.kind.toLowerCase() === initialCrd.toLowerCase(),
      );
      if (match) {
        setSelectedCrd(match);
        if (match.group) setSelectedGroup(match.group);
      }
    }
  }, [initialCrd, crds, selectedCrd]);

  const { data: namespacesData } = useClusterNamespaces(clusterId ?? 0);
  const namespaces = useMemo(
    () => namespacesData?.namespaces ?? [],
    [namespacesData],
  );

  const topologyNamespace = useMemo(() => {
    if (selectedNamespace && selectedNamespace !== "all") {
      return selectedNamespace;
    }
    return namespaces[0]?.name ?? "default";
  }, [selectedNamespace, namespaces]);

  const {
    data: topologyData,
    isLoading: topologyLoading,
    error: topologyError,
  } = useTopology(clusterId ?? 0, topologyNamespace, {
    enabled: !!clusterId && viewMode === "topology",
  });

  const {
    data: instancesData,
    isLoading: instancesLoading,
    refetch: refetchInstances,
  } = useClusterResources(
    clusterId ?? 0,
    selectedCrd ? selectedCrd.name : "",
    { namespace: selectedNamespace === "all" ? undefined : selectedNamespace },
    { enabled: !!clusterId && !!selectedCrd },
  );

  const groups = useMemo(() => {
    const map = new Map<string, number>();
    for (const crd of crds) {
      const g = crd.group || "other";
      map.set(g, (map.get(g) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [crds]);

  const filteredCrds = useMemo(() => {
    return crds.filter((crd) => {
      if (selectedGroup && crd.group !== selectedGroup) return false;
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        crd.name.toLowerCase().includes(term) ||
        crd.kind.toLowerCase().includes(term) ||
        crd.group.toLowerCase().includes(term) ||
        (crd.display_name && crd.display_name.toLowerCase().includes(term))
      );
    });
  }, [crds, selectedGroup, searchTerm]);

  if (!clusterId) {
    return (
      <EmptyState
        icon={Database}
        title="No Cluster Selected"
        description="Select a Kubernetes cluster above to browse its Custom Resource Definitions (CRDs)."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Toolbar: Mode Toggle, Search & Groups Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5"
          role="tablist"
          aria-label="CRD Explorer mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "browser"}
            onClick={() => setViewMode("browser")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors",
              viewMode === "browser"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Database className="h-3.5 w-3.5" />
            CRD Browser
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "topology"}
            onClick={() => setViewMode("topology")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors",
              viewMode === "topology"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Network className="h-3.5 w-3.5" />
            CRD Topology
          </button>
        </div>

        {viewMode === "browser" ? (
          <>
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search CRDs by kind or group..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            {groups.length > 0 && (
              <Select
                value={selectedGroup || "all"}
                onValueChange={(val) =>
                  setSelectedGroup(val === "all" ? null : val)
                }
              >
                <SelectTrigger
                  className="h-9 text-sm bg-card min-w-[200px]"
                  aria-label="Filter by API Group"
                >
                  <SelectValue placeholder="All API Groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    All API Groups ({crds.length})
                  </SelectItem>
                  {groups.map(([group, count]) => (
                    <SelectItem key={group} value={group}>
                      {group} ({count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="ml-auto text-xs text-muted-foreground">
              Showing{" "}
              <span className="font-semibold text-foreground">
                {filteredCrds.length}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-foreground">
                {crds.length}
              </span>{" "}
              CRDs
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 ml-auto">
            {namespaces.length > 0 && (
              <Select
                value={selectedNamespace}
                onValueChange={setSelectedNamespace}
              >
                <SelectTrigger
                  className="h-9 text-xs bg-card min-w-[180px]"
                  aria-label="Filter topology by namespace"
                >
                  <SelectValue placeholder="Select Namespace" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    Default ({topologyNamespace})
                  </SelectItem>
                  {namespaces.map((ns) => (
                    <SelectItem key={ns.name} value={ns.name}>
                      {ns.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>

      {viewMode === "topology" ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
            <span>
              CRD Relationship Topology in namespace:{" "}
              <strong className="text-foreground">{topologyNamespace}</strong>
            </span>
          </div>
          {topologyLoading ? (
            <div className="space-y-4 p-6">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-96 w-full rounded-xl" />
            </div>
          ) : topologyError ? (
            <ErrorState
              error={topologyError}
              title="Failed to load CRD topology"
            />
          ) : (
            <ResourceTopologyGraph
              nodes={topologyData?.nodes ?? []}
              edges={topologyData?.edges ?? []}
              info={topologyData?.info}
              onDescribeResource={handleDescribe}
            />
          )}
        </div>
      ) : crdsLoading ? (
        <SkeletonTable rows={8} columns={4} />
      ) : crds.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No CRDs Found"
          description="No Custom Resource Definitions are currently installed or discovered on this cluster."
          action={{
            label: "Refresh CRDs",
            onClick: () => void refetchCrds(),
            icon: <RefreshCw className="h-4 w-4 mr-1.5" />,
          }}
        />
      ) : (
        /* 2-Column Master-Detail Layout */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: CRD Directory */}
          <div className="lg:col-span-5 rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-3 border-b border-border bg-muted/30 font-medium text-xs text-muted-foreground flex items-center justify-between">
              <span>Custom Resource Definitions</span>
              <Badge variant="outline" className="text-xs">
                {filteredCrds.length}
              </Badge>
            </div>
            <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
              {filteredCrds.map((crd) => {
                const isSelected = selectedCrd?.name === crd.name;
                return (
                  <button
                    key={crd.name}
                    type="button"
                    onClick={() => {
                      setSelectedCrd(crd);
                      setSelectedInstance(null);
                    }}
                    className={cn(
                      "w-full text-left p-3 transition-colors flex items-start justify-between gap-2",
                      isSelected
                        ? "bg-primary/10 border-l-4 border-l-primary"
                        : "hover:bg-muted/40",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground truncate">
                          {crd.display_name || crd.kind}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-2xs px-1.5 py-0 font-mono"
                        >
                          {crd.namespaced ? "Namespaced" : "Cluster"}
                        </Badge>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground truncate mt-0.5">
                        {crd.name}
                      </div>
                      <div className="text-2xs text-muted-foreground truncate mt-1">
                        Group:{" "}
                        <span className="text-foreground/80">{crd.group}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Instances & Definition Inspector */}
          <div className="lg:col-span-7 space-y-4">
            {selectedCrd ? (
              <div className="rounded-lg border border-border bg-card p-4 space-y-4">
                <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                  <div>
                    <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                      <Database className="h-4 w-4 text-primary" />
                      {selectedCrd.display_name || selectedCrd.kind}
                    </h3>
                    <div className="text-xs font-mono text-muted-foreground mt-0.5">
                      {selectedCrd.name} • {selectedCrd.group}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedCrd.namespaced && namespaces.length > 0 && (
                      <Select
                        value={selectedNamespace}
                        onValueChange={setSelectedNamespace}
                      >
                        <SelectTrigger
                          className="h-8 text-xs bg-background min-w-[150px]"
                          aria-label="Filter instances by namespace"
                        >
                          <SelectValue placeholder="All Namespaces" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Namespaces</SelectItem>
                          {namespaces.map((ns) => (
                            <SelectItem key={ns.name} value={ns.name}>
                              {ns.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      variant="default"
                      size="sm"
                      className="h-8"
                      onClick={() => setCreateDialogOpen(true)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Create Instance
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => void refetchInstances()}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Refresh
                    </Button>
                  </div>
                </div>

                {/* Instances list */}
                <div>
                  {(() => {
                    const liveResources: K8sResource[] =
                      instancesData?.resources ?? [];
                    return (
                      <>
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          Live Resource Instances ({liveResources.length})
                        </div>

                        {instancesLoading ? (
                          <SkeletonTable rows={4} columns={3} />
                        ) : liveResources.length > 0 ? (
                          <div className="divide-y divide-border border border-border rounded-md overflow-hidden max-h-64 overflow-y-auto">
                            {liveResources.map((inst) => {
                              const isInstSelected =
                                selectedInstance?.metadata?.name ===
                                inst.metadata?.name;
                              return (
                                <div
                                  key={
                                    inst.metadata?.uid || inst.metadata?.name
                                  }
                                  className={cn(
                                    "p-2.5 flex items-center justify-between gap-3 text-xs cursor-pointer transition-colors",
                                    isInstSelected
                                      ? "bg-primary/10"
                                      : "hover:bg-muted/40",
                                  )}
                                  onClick={() => setSelectedInstance(inst)}
                                >
                                  <div>
                                    <span className="font-semibold text-foreground">
                                      {inst.metadata?.name}
                                    </span>
                                    {inst.metadata?.namespace && (
                                      <span className="text-muted-foreground ml-2">
                                        ns: {inst.metadata.namespace}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-2xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDescribe(inst);
                                      }}
                                    >
                                      <Eye className="h-3 w-3 mr-1" />
                                      Describe
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-2xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setResourceToEdit(inst);
                                        setEditDialogOpen(true);
                                      }}
                                    >
                                      <Pencil className="h-3 w-3 mr-1" />
                                      Edit
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-2xs text-destructive hover:text-destructive"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setResourceToDelete(inst);
                                        setDeleteDialogOpen(true);
                                      }}
                                    >
                                      <Trash2 className="h-3 w-3 mr-1" />
                                      Delete
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-6 text-center border border-dashed border-border rounded-md text-xs text-muted-foreground">
                            No instances of{" "}
                            <code className="text-foreground">
                              {selectedCrd.kind}
                            </code>{" "}
                            found in this cluster / namespace scope.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Rich Instance Detail Viewer */}
                {selectedInstance && (
                  <div className="border-t border-border pt-3">
                    <CNFDetailPanel
                      resource={selectedInstance}
                      onClose={() => setSelectedInstance(null)}
                      onDescribe={handleDescribe}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="h-96 rounded-lg border border-dashed border-border flex flex-col items-center justify-center p-8 text-center">
                <Database className="h-10 w-10 text-muted-foreground mb-3" />
                <div className="text-sm font-semibold text-foreground">
                  Select a Custom Resource Definition
                </div>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  Choose a CRD from the directory on the left to inspect its
                  live instances, namespaces, and schema attributes.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dialogs */}
      {clusterId && (
        <>
          <ResourceDescribeViewer
            open={describeOpen}
            onOpenChange={setDescribeOpen}
            resource={resourceToDescribe}
            clusterId={clusterId}
            namespace={resourceToDescribe?.metadata?.namespace}
            resourceType={selectedCrd?.name}
          />

          {selectedCrd && (
            <ResourceCreateDialog
              open={createDialogOpen}
              onOpenChange={setCreateDialogOpen}
              resourceType={selectedCrd.name}
              namespace={
                selectedNamespace === "all" ? "default" : selectedNamespace
              }
              onSubmit={async (resourceYaml, dryRun) => {
                try {
                  await api.createK8sResource(clusterId, selectedCrd.name, {
                    resource_yaml: resourceYaml,
                    namespace:
                      selectedNamespace === "all"
                        ? "default"
                        : selectedNamespace,
                    dry_run: dryRun,
                  });
                  if (dryRun) {
                    notify.success(
                      "Dry run successful - no changes applied",
                      undefined,
                      { category: "cluster" },
                    );
                  } else {
                    setCreateDialogOpen(false);
                    void refetchInstances();
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

          {resourceToEdit && selectedCrd && (
            <ResourceEditDialog
              open={editDialogOpen}
              onOpenChange={setEditDialogOpen}
              resource={resourceToEdit}
              onSubmit={async (resourceYaml, dryRun) => {
                try {
                  await api.updateK8sResource(
                    clusterId,
                    selectedCrd.name,
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
                    void refetchInstances();
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

          {resourceToDelete && selectedCrd && (
            <ResourceDeleteDialog
              open={deleteDialogOpen}
              onOpenChange={setDeleteDialogOpen}
              resource={resourceToDelete}
              onConfirm={async () => {
                try {
                  await api.deleteK8sResource(
                    clusterId,
                    selectedCrd.name,
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
                  setSelectedInstance(null);
                  void refetchInstances();
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
    </div>
  );
}

export default K8sCrdExplorerPanel;
