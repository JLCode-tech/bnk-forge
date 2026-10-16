import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAllClusters } from "@/hooks/k8s/useClusterCRUD";
import { projectsApi } from "@/lib/api";
import { STORAGE_KEYS } from "@/lib/storage-keys";

export interface ClusterPickerProps {
  /** A cluster id, `null` for all clusters, `undefined` while unset. */
  value: number | null | undefined;
  onChange: (clusterId: number | null) => void;
  allowAll?: boolean;
  className?: string;
  placeholder?: string;
  /** Render the F5 BNK-style `All Projects / All Clusters` paired selector. */
  showProjectSelector?: boolean;
  projectId?: number | null;
  onProjectChange?: (projectId: number | null) => void;
}

export function ClusterPicker({
  value,
  onChange,
  allowAll = true,
  className,
  placeholder = "Select Cluster",
  showProjectSelector = false,
  projectId: controlledProjectId,
  onProjectChange,
}: ClusterPickerProps) {
  const [internalProjectId, setInternalProjectId] = useState<number | null>(
    () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEYS.PROJECT_SCOPE);
        if (!stored || stored === "all") return null;
        const parsed = parseInt(stored, 10);
        return Number.isNaN(parsed) ? null : parsed;
      } catch {
        return null;
      }
    },
  );

  const selectedProjectId =
    controlledProjectId !== undefined ? controlledProjectId : internalProjectId;

  const handleProjectChange = (nextProjectId: number | null) => {
    if (controlledProjectId === undefined) {
      setInternalProjectId(nextProjectId);
    }
    try {
      if (nextProjectId === null) {
        localStorage.removeItem(STORAGE_KEYS.PROJECT_SCOPE);
      } else {
        localStorage.setItem(STORAGE_KEYS.PROJECT_SCOPE, String(nextProjectId));
      }
    } catch {
      // ignore storage errors
    }
    onProjectChange?.(nextProjectId);
  };

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.getProjects(),
    enabled: showProjectSelector,
    staleTime: 30_000,
  });

  const { data } = useAllClusters();
  const allClusters = data?.clusters ?? [];
  const clusters =
    showProjectSelector && selectedProjectId !== null
      ? allClusters.filter((c) => c.project_id === selectedProjectId)
      : allClusters;

  const clusterSelect = (
    <Select
      value={value != null ? String(value) : allowAll ? "__all__" : ""}
      onValueChange={(v) => onChange(v === "__all__" ? null : Number(v))}
      disabled={!clusters.length && !allowAll}
    >
      <SelectTrigger
        data-testid="cluster-selector"
        className={cn("w-[180px] h-8 text-xs font-sans", className)}
        aria-label="Cluster"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAll && (
          <SelectItem value="__all__" className="text-xs font-medium">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 rounded-full flex-shrink-0 bg-primary" />
              <span className="truncate font-medium">All Clusters</span>
            </div>
          </SelectItem>
        )}
        {clusters.length === 0 ? (
          <div className="p-2 text-xs text-muted-foreground text-center">
            No clusters found
          </div>
        ) : (
          clusters.map((c) => (
            <SelectItem key={c.id} value={String(c.id)} className="text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full flex-shrink-0",
                    c.status === "active"
                      ? "bg-success"
                      : "bg-muted-foreground",
                  )}
                />
                <span className="truncate">{c.name}</span>
              </div>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );

  if (!showProjectSelector) {
    return clusterSelect;
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Select
          value={
            selectedProjectId !== null && selectedProjectId !== undefined
              ? selectedProjectId.toString()
              : "all"
          }
          onValueChange={(val) => {
            handleProjectChange(val === "all" ? null : parseInt(val, 10));
          }}
        >
          <SelectTrigger
            data-testid="project-selector"
            className="w-[150px] h-8 text-xs font-sans"
            aria-label="Project scope"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">
                <SelectValue placeholder="All Projects" />
              </span>
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full flex-shrink-0 bg-primary/60" />
                <span className="truncate font-medium">All Projects</span>
              </div>
            </SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id.toString()}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm font-light text-muted-foreground/50">/</span>
      </div>
      {clusterSelect}
    </div>
  );
}
