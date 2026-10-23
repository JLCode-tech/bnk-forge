/**
 * FleetClusterPicker — dead-simple tickbox selector for Projects and Clusters.
 *
 * Allows users to tick projects (checking/unchecking all clusters in that project)
 * or individual clusters into and out of fleets.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  Folder,
  Layers,
  Loader2,
  Minus,
  RefreshCw,
  Search,
  Server,
} from "lucide-react";
import yaml from "js-yaml";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ClusterPicker } from "@/components/observability/pickers";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { getCloudProviderBadgeInfo } from "@/lib/cloud-providers";
import { useAllClusters } from "@/hooks/useK8s";
import { useProjects } from "@/hooks/useProjects";
import type { ConfigExport } from "@/types/config";

export interface FleetClusterPickerProps {
  selectedClusterIds: number[];
  onChange: (clusterIds: number[]) => void;
  disabled?: boolean;
  className?: string;
}

export function FleetClusterPicker({
  selectedClusterIds,
  onChange,
  disabled = false,
  className,
}: FleetClusterPickerProps) {
  const { data: clustersData, isLoading: clustersLoading } = useAllClusters();
  const { data: projectsData, isLoading: projectsLoading } = useProjects();

  const [search, setSearch] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState<
    Record<number, boolean>
  >({});

  const clusters = useMemo(() => clustersData?.clusters ?? [], [clustersData]);
  const projects = useMemo(() => projectsData ?? [], [projectsData]);

  // Map project ID to Project object
  const projectMap = useMemo(() => {
    const map = new Map<number, { id: number; name: string }>();
    for (const p of projects) {
      map.set(p.id, p);
    }
    return map;
  }, [projects]);

  // Group clusters by project
  const projectGroups = useMemo(() => {
    const groups: Array<{
      projectId: number;
      projectName: string;
      clusters: typeof clusters;
    }> = [];

    const clustersByProj = new Map<number, typeof clusters>();
    const unassigned: typeof clusters = [];

    for (const c of clusters) {
      if (c.project_id) {
        const list = clustersByProj.get(c.project_id) || [];
        list.push(c);
        clustersByProj.set(c.project_id, list);
      } else {
        unassigned.push(c);
      }
    }

    // Add known projects
    for (const p of projects) {
      const pClusters = clustersByProj.get(p.id) || [];
      if (pClusters.length > 0) {
        groups.push({
          projectId: p.id,
          projectName: p.name,
          clusters: pClusters,
        });
        clustersByProj.delete(p.id);
      }
    }

    // Add remaining projects or unassigned
    for (const [projId, pClusters] of clustersByProj.entries()) {
      groups.push({
        projectId: projId,
        projectName: projectMap.get(projId)?.name || `Project #${projId}`,
        clusters: pClusters,
      });
    }

    if (unassigned.length > 0) {
      groups.push({
        projectId: -1,
        projectName: "Unassigned Clusters",
        clusters: unassigned,
      });
    }

    return groups;
  }, [clusters, projects, projectMap]);

  // Filter groups by search query
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return projectGroups;
    const q = search.toLowerCase();

    return projectGroups
      .map((g) => {
        const matchesProject = g.projectName.toLowerCase().includes(q);
        const matchedClusters = g.clusters.filter(
          (c) =>
            matchesProject ||
            c.name.toLowerCase().includes(q) ||
            (c.cloud_provider && c.cloud_provider.toLowerCase().includes(q)) ||
            (c.region && c.region.toLowerCase().includes(q)),
        );
        return {
          ...g,
          clusters: matchedClusters,
        };
      })
      .filter((g) => g.clusters.length > 0);
  }, [projectGroups, search]);

  const allVisibleClusterIds = useMemo(() => {
    return filteredGroups.flatMap((g) => g.clusters.map((c) => c.id));
  }, [filteredGroups]);

  const selectedSet = useMemo(
    () => new Set(selectedClusterIds),
    [selectedClusterIds],
  );

  // Project toggle handler
  const handleToggleProject = (groupClusters: typeof clusters) => {
    if (disabled) return;
    const groupClusterIds = groupClusters.map((c) => c.id);
    const allSelected = groupClusterIds.every((id) => selectedSet.has(id));

    let next: number[];
    if (allSelected) {
      // Remove all clusters of this project
      next = selectedClusterIds.filter((id) => !groupClusterIds.includes(id));
    } else {
      // Add all clusters of this project
      const toAdd = groupClusterIds.filter((id) => !selectedSet.has(id));
      next = [...selectedClusterIds, ...toAdd];
    }
    onChange(next);
  };

  // Cluster toggle handler
  const handleToggleCluster = (clusterId: number) => {
    if (disabled) return;
    if (selectedSet.has(clusterId)) {
      onChange(selectedClusterIds.filter((id) => id !== clusterId));
    } else {
      onChange([...selectedClusterIds, clusterId]);
    }
  };

  const handleSelectAll = () => {
    if (disabled) return;
    const combined = Array.from(
      new Set([...selectedClusterIds, ...allVisibleClusterIds]),
    );
    onChange(combined);
  };

  const handleClearAll = () => {
    if (disabled) return;
    onChange([]);
  };

  const toggleCollapse = (projId: number) => {
    setCollapsedProjects((prev) => ({
      ...prev,
      [projId]: !prev[projId],
    }));
  };

  if (clustersLoading || projectsLoading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Search and bulk actions bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search clusters, projects, providers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={disabled}
            className="pl-8 h-8 text-xs bg-card"
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
            disabled={disabled || allVisibleClusterIds.length === 0}
            className="h-8 text-xs px-2"
          >
            Select All
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            disabled={disabled || selectedClusterIds.length === 0}
            className="h-8 text-xs px-2"
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Selected counter banner */}
      <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-muted/50 border border-border text-xs">
        <span className="font-medium text-foreground">
          {selectedClusterIds.length} cluster
          {selectedClusterIds.length === 1 ? "" : "s"} selected
        </span>
        <span className="text-muted-foreground text-2xs">
          Tick projects or individual clusters into/out of fleet
        </span>
      </div>

      {/* Project and cluster list */}
      <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
        {filteredGroups.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground border border-dashed border-border rounded-lg">
            No clusters match your filter.
          </div>
        ) : (
          filteredGroups.map((group) => {
            const groupClusterIds = group.clusters.map((c) => c.id);
            const selectedCount = groupClusterIds.filter((id) =>
              selectedSet.has(id),
            ).length;
            const isAllSelected =
              selectedCount === groupClusterIds.length &&
              groupClusterIds.length > 0;
            const isPartiallySelected =
              selectedCount > 0 && selectedCount < groupClusterIds.length;
            const isCollapsed = Boolean(collapsedProjects[group.projectId]);

            return (
              <div
                key={group.projectId}
                className="border border-border rounded-lg overflow-hidden bg-card transition-colors"
              >
                {/* Project Header Row */}
                <div className="flex items-center justify-between p-2.5 bg-muted/30 hover:bg-muted/50 border-b border-border/50 select-none">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => handleToggleProject(group.clusters)}
                      disabled={disabled}
                      className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        isAllSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : isPartiallySelected
                            ? "bg-primary/20 border-primary text-primary"
                            : "border-muted-foreground/40 hover:border-muted-foreground",
                      )}
                    >
                      {isAllSelected && (
                        <Check className="w-3 h-3 stroke-[2.5]" />
                      )}
                      {isPartiallySelected && (
                        <Minus className="w-3 h-3 stroke-[2.5]" />
                      )}
                    </button>

                    <div
                      className="flex items-center gap-2 cursor-pointer min-w-0"
                      onClick={() => toggleCollapse(group.projectId)}
                    >
                      <Folder className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-xs font-semibold text-foreground truncate">
                        {group.projectName}
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-2xs px-1.5 py-0 h-4"
                      >
                        {selectedCount}/{group.clusters.length}
                      </Badge>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleCollapse(group.projectId)}
                    className="text-muted-foreground hover:text-foreground p-1"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Cluster Rows */}
                {!isCollapsed && (
                  <div className="divide-y divide-border/40">
                    {group.clusters.map((cluster) => {
                      const isSelected = selectedSet.has(cluster.id);
                      const providerBadge = getCloudProviderBadgeInfo(
                        cluster.cloud_provider,
                      );
                      return (
                        <div
                          key={cluster.id}
                          onClick={() => handleToggleCluster(cluster.id)}
                          className={cn(
                            "flex items-center justify-between px-3 py-2 text-xs cursor-pointer select-none transition-colors pl-8",
                            isSelected
                              ? "bg-primary/5 hover:bg-primary/10"
                              : "hover:bg-muted/40",
                          )}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={cn(
                                "w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
                                isSelected
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : "border-muted-foreground/40 hover:border-muted-foreground",
                              )}
                            >
                              {isSelected && (
                                <Check className="w-3 h-3 stroke-[2.5]" />
                              )}
                            </div>

                            <Server className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

                            <span
                              className={cn(
                                "font-medium truncate",
                                isSelected
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {cluster.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {cluster.region && (
                              <span className="text-2xs text-muted-foreground">
                                {cluster.region}
                              </span>
                            )}
                            <Badge
                              variant={providerBadge.badgeVariant}
                              className={providerBadge.badgeClass}
                            >
                              {providerBadge.shortLabel}
                            </Badge>
                            <StatusBadge status={cluster.status || "active"} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export interface DiscoveredResourceItem {
  id: string; // `${kind}/${namespace}/${name}`
  kind: string;
  name: string;
  namespace?: string;
  category: string;
  raw: unknown;
  yamlSnippet: string;
  lineCount: number;
}

export interface ClusterResourcePickerProps {
  selectedClusterId?: number | null;
  onClusterChange?: (clusterId: number) => void;
  onSelectResource: (item: DiscoveredResourceItem) => void;
  selectedResourceId?: string | null;
  className?: string;
}

function cleanK8sResource(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  type CleanableMetadata = Record<string, unknown> & {
    annotations?: Record<string, unknown>;
  };
  const cloned = JSON.parse(JSON.stringify(raw)) as {
    status?: unknown;
    metadata?: CleanableMetadata;
    [key: string]: unknown;
  };
  delete cloned.status;
  if (cloned.metadata) {
    delete cloned.metadata.uid;
    delete cloned.metadata.resourceVersion;
    delete cloned.metadata.generation;
    delete cloned.metadata.creationTimestamp;
    delete cloned.metadata.managedFields;
    delete cloned.metadata.selfLink;
    delete cloned.metadata.ownerReferences;
    delete cloned.metadata.finalizers;
    if (cloned.metadata.annotations) {
      delete cloned.metadata.annotations[
        "kubectl.kubernetes.io/last-applied-configuration"
      ];
      if (Object.keys(cloned.metadata.annotations).length === 0) {
        delete cloned.metadata.annotations;
      }
    }
  }
  return cloned;
}

function mapKindToCategory(kind: string, rawCategory?: string): string {
  const k = kind.toLowerCase();
  if (k.includes("route")) return "routing";
  if (k.includes("gateway") && !k.includes("class")) return "gateway";
  if (
    k.includes("sec") ||
    k.includes("net") ||
    k.includes("fw") ||
    k.includes("firewall") ||
    k.includes("dos")
  )
    return "security";
  if (k.includes("inference") || k.includes("ai") || k.includes("llm"))
    return "ai";
  if (rawCategory === "gateway_api") return "routing";
  if (rawCategory === "bnk_security") return "security";
  if (rawCategory === "bnk_data_plane") return "data_plane";
  if (rawCategory === "bnk_flo") return "flo";
  return "crd";
}

function getBadgeVariant(
  category: string,
): "info" | "warning" | "success" | "secondary" | "outline" {
  switch (category) {
    case "routing":
      return "info";
    case "gateway":
      return "secondary";
    case "security":
      return "warning";
    case "ai":
      return "success";
    default:
      return "outline";
  }
}

export function ClusterResourcePicker({
  selectedClusterId,
  onClusterChange,
  onSelectResource,
  selectedResourceId,
  className,
}: ClusterResourcePickerProps) {
  const [activeClusterId, setActiveClusterId] = useState<number | null>(
    selectedClusterId ?? null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<DiscoveredResourceItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  useEffect(() => {
    if (selectedClusterId !== undefined) {
      setActiveClusterId(selectedClusterId);
    }
  }, [selectedClusterId]);

  const loadClusterResources = async (clusterId: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ConfigExport>(
        `/api/clusters/${clusterId}/bnk/export/json`,
      );
      const parsedItems: DiscoveredResourceItem[] = [];
      const multiDocSnippets: string[] = [];

      if (res.data?.resources && typeof res.data.resources === "object") {
        for (const [rawCategory, resourceList] of Object.entries(
          res.data.resources,
        )) {
          if (Array.isArray(resourceList)) {
            for (const rawRes of resourceList) {
              if (!rawRes || typeof rawRes !== "object") continue;
              const resObj = rawRes as {
                kind?: string;
                metadata?: { name?: string; namespace?: string };
              };
              const kind = resObj.kind || "Resource";
              const name = resObj.metadata?.name || "unnamed";
              const namespace = resObj.metadata?.namespace;
              const id = `${kind}/${namespace || "cluster"}/${name}`;

              const cleaned = cleanK8sResource(rawRes);
              const yamlSnippet = yaml.dump(cleaned, {
                indent: 2,
                noArrayIndent: false,
              });
              const lineCount = yamlSnippet.trim().split("\n").length;
              multiDocSnippets.push(yamlSnippet.trim());

              parsedItems.push({
                id,
                kind,
                name,
                namespace,
                category: mapKindToCategory(kind, rawCategory),
                raw: cleaned,
                yamlSnippet,
                lineCount,
              });
            }
          }
        }
      }

      if (parsedItems.length > 0 && multiDocSnippets.length > 1) {
        // Bundle option as last item
        const bundleYaml = multiDocSnippets.join("\n---\n") + "\n";
        parsedItems.push({
          id: "__all_resources__",
          kind: "All Resources (Bundle)",
          name: `All ${parsedItems.length} resources from cluster`,
          namespace: "various",
          category: "bundle",
          raw: res.data.resources,
          yamlSnippet: bundleYaml,
          lineCount: bundleYaml.trim().split("\n").length,
        });
      }

      setItems(parsedItems);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch cluster configuration",
      );
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClusterSelect = (clusterId: number) => {
    setActiveClusterId(clusterId);
    onClusterChange?.(clusterId);
    if (clusterId) {
      loadClusterResources(clusterId);
    } else {
      setItems([]);
    }
  };

  // Categories present in discovered items
  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.category !== "bundle") cats.add(item.category);
    });
    return Array.from(cats);
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedCategory !== "all" && item.category !== selectedCategory) {
        return false;
      }
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        item.name.toLowerCase().includes(term) ||
        item.kind.toLowerCase().includes(term) ||
        (item.namespace && item.namespace.toLowerCase().includes(term))
      );
    });
  }, [items, selectedCategory, searchTerm]);

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border border-border bg-card/60 p-3",
        className,
      )}
    >
      {/* Cluster selection bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1">
          <Layers className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground shrink-0">
            Source Cluster:
          </span>
          <ClusterPicker
            value={activeClusterId}
            onChange={(id) => id && handleClusterSelect(id)}
            allowAll={false}
            placeholder="Select a cluster to inspect configs..."
            className="w-full sm:w-64 bg-card"
          />
        </div>

        {activeClusterId && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => loadClusterResources(activeClusterId)}
            disabled={isLoading}
            className="h-8 text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            )}
            Reload Configs
          </Button>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="p-4 flex items-center justify-center gap-2 text-xs text-muted-foreground bg-muted/20 rounded border border-border/50">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>
            Scanning cluster for BNK configurations and Gateway API CRDs...
          </span>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="p-3 flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded border border-destructive/20">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Resource selector */}
      {!isLoading && items.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-foreground font-medium">
              <span>Discovered Config Items:</span>
              <Badge variant="outline" className="text-2xs font-normal">
                {items.length -
                  (items.some((i) => i.id === "__all_resources__")
                    ? 1
                    : 0)}{" "}
                individual resources
              </Badge>
            </div>

            {/* Quick search input */}
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-2" />
              <Input
                placeholder="Filter by kind or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-7.5 pl-7 text-xs bg-card"
              />
            </div>
          </div>

          {/* Category filter pills */}
          {categories.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => setSelectedCategory("all")}
                className={cn(
                  "px-2 py-0.5 rounded text-2xs font-medium transition-colors border",
                  selectedCategory === "all"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-border hover:bg-muted",
                )}
              >
                All ({items.length})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-2 py-0.5 rounded text-2xs font-medium capitalize transition-colors border",
                    selectedCategory === cat
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-border hover:bg-muted",
                  )}
                >
                  {cat.replace("_", " ")} (
                  {items.filter((i) => i.category === cat).length})
                </button>
              ))}
            </div>
          )}

          {/* Resource list */}
          <div className="max-h-48 overflow-y-auto rounded border border-border divide-y divide-border bg-card">
            {filteredItems.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                No matching resources found for "{searchTerm}"
              </div>
            ) : (
              filteredItems.map((item) => {
                const isSelected = selectedResourceId === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => onSelectResource(item)}
                    className={cn(
                      "p-2 flex items-center justify-between gap-2 cursor-pointer transition-colors text-xs select-none",
                      isSelected
                        ? "bg-primary/10 text-foreground font-medium"
                        : "hover:bg-muted/50 text-foreground",
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileCode
                        className={cn(
                          "w-3.5 h-3.5 shrink-0",
                          isSelected ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <Badge
                        variant={getBadgeVariant(item.category)}
                        className="text-2xs uppercase font-mono px-1.5 py-0"
                      >
                        {item.kind}
                      </Badge>
                      <span className="truncate font-mono">{item.name}</span>
                      {item.namespace && item.namespace !== "various" && (
                        <span className="text-2xs text-muted-foreground truncate">
                          ns: {item.namespace}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-2xs text-muted-foreground font-mono">
                        {item.lineCount} lines
                      </span>
                      {isSelected ? (
                        <Badge
                          variant="success"
                          className="text-2xs gap-1 px-1.5 py-0"
                        >
                          <Check className="w-3 h-3" /> Selected
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-2xs px-2 text-primary hover:text-primary hover:bg-primary/10"
                        >
                          Select
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Empty state when cluster selected but no resources returned */}
      {!isLoading && activeClusterId && items.length === 0 && !error && (
        <div className="p-3 text-center text-xs text-muted-foreground bg-muted/10 rounded border border-dashed border-border">
          No custom F5 BNK or Gateway API CRDs found on this cluster. You can
          paste custom YAML below.
        </div>
      )}
    </div>
  );
}
