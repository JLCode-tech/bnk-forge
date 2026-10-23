import React, { useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, RefreshCw, LayoutGrid } from "lucide-react";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useHeaderMetadata } from "./Header";

interface Cluster {
  id: number;
  name: string;
  status?: string;
}

interface Project {
  id: number;
  name: string;
}

interface ResourcePageHeaderProps {
  title?: string;
  titleBadge?: React.ReactNode;
  subtitle?: React.ReactNode;
  projects?: Project[];
  selectedProjectId?: number | null;
  onProjectChange?: (id: number | null) => void;
  clusters: Cluster[];
  selectedClusterId: number | null;
  onClusterChange: (id: number | null) => void;
  allowAllClusters?: boolean;
  namespaces: { name: string }[] | string[];
  selectedNamespace: string;
  onNamespaceChange: (ns: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function ResourcePageHeader({
  title: propTitle,
  titleBadge,
  subtitle,
  projects,
  selectedProjectId,
  onProjectChange,
  clusters,
  selectedClusterId,
  onClusterChange,
  allowAllClusters = false,
  namespaces,
  selectedNamespace,
  onNamespaceChange,
  searchQuery,
  onSearchChange,
  onRefresh,
  isRefreshing,
  children,
  className,
}: ResourcePageHeaderProps) {
  const routeHandle = useHeaderMetadata();
  const title = propTitle ?? routeHandle?.title;
  const searchInputRef = useRef<HTMLInputElement>(null);

  useKeyboardShortcuts([
    {
      key: "/",
      action: (e) => {
        e.preventDefault();
        searchInputRef.current?.focus();
      },
      allowInInput: false,
    },
  ]);

  // Normalize namespaces to strings
  const namespaceList = namespaces.map((ns) =>
    typeof ns === "string" ? ns : ns.name,
  );

  return (
    <div
      data-testid="resource-page-header"
      className={cn(
        "border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75 px-4 py-2 sticky top-0 z-20",
        className,
      )}
    >
      {/* Compact single-row: title + search on left, scope selectors + actions on right */}
      <div className="flex items-center justify-between gap-2.5 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {title && (
            <div className="flex items-center gap-2 min-w-0 shrink-0">
              <h1 className="text-sm font-semibold tracking-tight text-foreground whitespace-nowrap">
                {title}
              </h1>
              {titleBadge}
              {subtitle &&
                (typeof subtitle === "string" ? (
                  <span className="text-xs text-muted-foreground truncate hidden xl:inline max-w-[260px]">
                    {subtitle}
                  </span>
                ) : (
                  <div className="text-xs text-muted-foreground truncate hidden xl:block max-w-[260px]">
                    {subtitle}
                  </div>
                ))}
            </div>
          )}

          {/* Search Input */}
          <div className="relative min-w-[180px] max-w-xs flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              data-testid="resource-search-input"
              placeholder="Search... (/)"
              aria-label="Search resources"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 h-8 text-xs transition-all focus:w-full"
            />
          </div>
        </div>

        {/* Right-Aligned Scope Selectors + Actions */}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* Optional Project Selector */}
          {projects && onProjectChange && (
            <div className="flex items-center gap-1.5">
              <Select
                value={
                  selectedProjectId !== null && selectedProjectId !== undefined
                    ? selectedProjectId.toString()
                    : "all"
                }
                onValueChange={(value) => {
                  if (value === "all") {
                    onProjectChange(null);
                  } else {
                    onProjectChange(parseInt(value));
                  }
                }}
              >
                <SelectTrigger
                  data-testid="project-selector"
                  className="w-[150px] h-8 text-xs"
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
              <span className="text-sm font-light text-muted-foreground/50">
                /
              </span>
            </div>
          )}

          {/* Cluster Scope Selector */}
          <Select
            value={
              selectedClusterId !== null && selectedClusterId !== undefined
                ? selectedClusterId.toString()
                : allowAllClusters
                  ? "all"
                  : ""
            }
            onValueChange={(value) => {
              if (value === "all") {
                onClusterChange(null);
              } else {
                onClusterChange(parseInt(value));
              }
            }}
            disabled={!clusters.length && !allowAllClusters}
          >
            <SelectTrigger
              data-testid="cluster-selector"
              className="w-[180px] h-8 text-xs"
            >
              <SelectValue placeholder="Select Cluster" />
            </SelectTrigger>
            <SelectContent>
              {allowAllClusters && (
                <SelectItem value="all">
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
                clusters.map((cluster) => (
                  <SelectItem key={cluster.id} value={cluster.id.toString()}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full flex-shrink-0",
                          cluster.status === "active"
                            ? "bg-success"
                            : "bg-muted-foreground",
                        )}
                      />
                      <span className="truncate">{cluster.name}</span>
                    </div>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          <span className="text-sm font-light text-muted-foreground/50">/</span>

          {/* Namespace Selector */}
          <Select
            value={selectedNamespace}
            onValueChange={onNamespaceChange}
            disabled={!selectedClusterId}
          >
            <SelectTrigger
              data-testid="namespace-selector"
              className="w-[150px] h-8 text-xs font-medium"
            >
              <span className="truncate">
                {selectedNamespace === "all"
                  ? "All Namespaces"
                  : selectedNamespace}
              </span>
            </SelectTrigger>
            <SelectContent>
              {selectedNamespace === "all" && (
                <SelectItem value="all" className="font-semibold text-warning">
                  All Namespaces (cluster-wide)
                </SelectItem>
              )}
              {namespaceList.map((ns) => (
                <SelectItem key={ns} value={ns}>
                  {ns}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Actions Area */}
          <div className="flex items-center gap-1.5">
            {children}

            {onRefresh && (
              <Button
                data-testid="refresh-button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={onRefresh}
                disabled={isRefreshing || !selectedClusterId}
                title="Refresh Resources"
                aria-label="Refresh resources"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
                  aria-hidden="true"
                />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
