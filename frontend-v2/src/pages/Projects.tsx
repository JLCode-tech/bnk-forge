/**
 * Projects page — D-020 redesign.
 *
 * One coherent surface, bnkhealth shape: bold heading, chip-filter row,
 * single SectionCard holding a flat table. No in-page sidebar, no per-status
 * color tints — status conveyed by small Badge variants only.
 */

import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCard } from "@/components/ui/section-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProjects } from "@/hooks/useProjects";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import { useProjectDriftCounts } from "@/hooks/useDrift";
import { cn } from "@/lib/utils";
import {
  Plus,
  FolderGit2,
  Search,
  MoreVertical,
  Eye,
  Settings,
  Clock,
  Layers,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Server,
  CheckCircle2,
  AlertTriangle,
  Cloud,
  Globe,
} from "lucide-react";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import type { Project } from "@/types";
import { getProjectLocationInfo } from "@/lib/aws-regions";
import {
  normalizeProvider,
  getCloudProviderBadgeInfo,
  type NormalizedCloudProvider,
} from "@/lib/cloud-providers";
import { formatTimeAgo } from "@/lib/time-utils";
import { useAuthStore } from "@/stores/authStore";
import {
  getPlatformProfileLabel,
  getProjectTargetPlatform,
} from "@/lib/platform-context";

const INITIAL_PROJECTS_LIMIT = 20;

type ProjectFilter = "all" | "mine" | "active" | "inactive" | "has_failed";

const FILTER_CONFIG: Record<ProjectFilter, { label: string }> = {
  all: { label: "All Workspaces" },
  mine: { label: "My Workspaces" },
  active: { label: "Active Deployments" },
  inactive: { label: "Inactive" },
  has_failed: { label: "Has failures" },
};

const PROVIDER_DEFS: Array<{
  id: NormalizedCloudProvider;
  name: string;
  shortLabel: string;
  badgeClass: string;
  badgeVariant: "default" | "secondary" | "outline";
}> = [
  {
    id: "aws",
    name: "Amazon Web Services (EKS)",
    shortLabel: "AWS",
    badgeClass:
      "border-warning/40 text-warning bg-warning/10 font-semibold text-2xs px-1.5 py-0.5",
    badgeVariant: "outline",
  },
  {
    id: "azure",
    name: "Microsoft Azure (AKS)",
    shortLabel: "AZR",
    badgeClass:
      "border-info/40 text-info bg-info/10 font-semibold text-2xs px-1.5 py-0.5",
    badgeVariant: "outline",
  },
  {
    id: "gke",
    name: "Google Cloud Platform (GKE)",
    shortLabel: "GKE",
    badgeClass:
      "border-primary/40 text-primary bg-primary/10 font-semibold text-2xs px-1.5 py-0.5",
    badgeVariant: "outline",
  },
  {
    id: "metal",
    name: "Bare-Metal & On-Premises",
    shortLabel: "METAL",
    badgeClass:
      "border-success/40 text-success bg-success/10 font-semibold text-2xs px-1.5 py-0.5",
    badgeVariant: "outline",
  },
  {
    id: "ibm",
    name: "IBM Cloud (ROKS)",
    shortLabel: "IBM",
    badgeClass:
      "border-secondary text-secondary-foreground bg-secondary/30 font-semibold text-2xs px-1.5 py-0.5",
    badgeVariant: "outline",
  },
  {
    id: "other",
    name: "Other Infrastructure",
    shortLabel: "OTHER",
    badgeClass: "font-semibold text-2xs px-1.5 py-0.5",
    badgeVariant: "secondary",
  },
];

function projectTypeLabel(project: Project): string {
  const p = (project.cloud_provider || "").toLowerCase().trim();
  const pt = (project.project_type || "").toLowerCase().trim();
  if (pt === "kubernetes" || p === "kubernetes") return "Kubernetes";
  if (pt === "cloud-aws" || pt === "aws" || p === "aws" || p === "eks")
    return "AWS";
  if (pt === "cloud-azure" || pt === "azure" || p === "azure" || p === "aks")
    return "Azure";
  if (
    pt === "cloud-gcp" ||
    pt === "gcp" ||
    p === "gcp" ||
    p === "gke" ||
    p === "google"
  )
    return "GCP (GKE)";
  if (pt === "cloud-ibm" || pt === "ibm" || p === "ibm" || p === "roks")
    return "IBM Cloud";
  if (p === "on-prem" || p === "bare-metal" || p === "metal")
    return "Bare-Metal";
  if (project.credential_template?.provider === "ssh") return "SSH";
  if (project.credential_template) return project.credential_template.name;
  if (p) return p.toUpperCase();
  if (pt) return pt.toUpperCase();
  return "—";
}

export default function Projects() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useAuthStore((s) => s.user);
  const { data: projects, isLoading, isError, error, refetch } = useProjects();
  const projectDriftCounts = useProjectDriftCounts(20);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<ProjectFilter>("all");
  const [selectedProvider, setSelectedProvider] = useState<
    NormalizedCloudProvider | "all"
  >("all");
  const [viewLayout, setViewLayout] = useState<"grouped" | "flat">("grouped");
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [showAll, setShowAll] = useState(false);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  // Open create dialog when navigated with ?action=create (Command Palette path).
  useEffect(() => {
    if (searchParams.get("action") === "create") {
      setCreateDialogOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const isActive = (p: Project) =>
    p.has_deployments ||
    (p.module_count || 0) > 0 ||
    (p.cluster_count || 0) > 0;

  const filteredProjects = useMemo(() => {
    return (projects || [])
      .filter((p) => {
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          if (
            !p.name.toLowerCase().includes(q) &&
            !p.description?.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        switch (activeFilter) {
          case "mine":
            return p.user_id === currentUser?.id;
          case "active":
            return isActive(p);
          case "inactive":
            return !isActive(p);
          case "has_failed":
            return (p.failed_count || 0) > 0;
          default:
            return true;
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, searchQuery, activeFilter, currentUser?.id]);

  const counts = useMemo(() => {
    const c: Record<ProjectFilter, number> = {
      all: projects?.length || 0,
      mine: 0,
      active: 0,
      inactive: 0,
      has_failed: 0,
    };
    projects?.forEach((p) => {
      if (p.user_id === currentUser?.id) c.mine++;
      if (isActive(p)) c.active++;
      else c.inactive++;
      if ((p.failed_count || 0) > 0) c.has_failed++;
    });
    return c;
  }, [projects, currentUser?.id]);

  const providerCounts = useMemo(() => {
    const c: Record<string, number> = { all: filteredProjects.length };
    for (const p of filteredProjects) {
      const prov = normalizeProvider(p.cloud_provider || p.project_type);
      c[prov] = (c[prov] || 0) + 1;
    }
    return c;
  }, [filteredProjects]);

  const providerFilteredProjects = useMemo(() => {
    if (selectedProvider === "all") return filteredProjects;
    return filteredProjects.filter(
      (p) =>
        normalizeProvider(p.cloud_provider || p.project_type) ===
        selectedProvider,
    );
  }, [filteredProjects, selectedProvider]);

  const groupedProjects = useMemo(() => {
    const map = new Map<NormalizedCloudProvider, Project[]>();
    for (const p of providerFilteredProjects) {
      const prov = normalizeProvider(p.cloud_provider || p.project_type);
      const list = map.get(prov) || [];
      list.push(p);
      map.set(prov, list);
    }
    return PROVIDER_DEFS.map((def) => ({
      ...def,
      projects: map.get(def.id) || [],
    })).filter((g) => g.projects.length > 0);
  }, [providerFilteredProjects]);

  const limited = showAll
    ? providerFilteredProjects
    : providerFilteredProjects.slice(0, INITIAL_PROJECTS_LIMIT);
  const hasMore = providerFilteredProjects.length > INITIAL_PROJECTS_LIMIT;

  const handleView = (project: Project) => navigate(`/projects/${project.id}`);

  // Visible filter items in the left sub-sidebar: always show all/mine/active, plus inactive/has_failed when non-zero.
  const chipFilters: ProjectFilter[] = (
    ["all", "mine", "active", "inactive", "has_failed"] as ProjectFilter[]
  ).filter(
    (k) =>
      k === "all" || k === "mine" || k === "active" || (counts[k] || 0) > 0,
  );

  const { refresh, isRefreshing } = usePageRefresh();

  function renderProjectTable(projectsList: Project[]) {
    return (
      <div className="overflow-x-auto -mx-4 px-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-left font-medium px-4 py-2">
                Project
              </TableHead>
              <TableHead className="text-left font-medium px-4 py-2">
                Status
              </TableHead>
              <TableHead className="text-left font-medium px-4 py-2">
                Platform
              </TableHead>
              <TableHead className="text-left font-medium px-4 py-2">
                Modules
              </TableHead>
              <TableHead className="text-left font-medium px-4 py-2">
                Last activity
              </TableHead>
              <TableHead className="text-right font-medium px-4 py-2 w-16">
                {/* actions */}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projectsList.map((project) => {
              const active = isActive(project);
              const failed = (project.failed_count || 0) > 0;
              const statusVariant: "success" | "destructive" | "muted" = failed
                ? "destructive"
                : active
                  ? "success"
                  : "muted";
              const statusLabel = failed
                ? "Has failures"
                : active
                  ? "Active"
                  : "Inactive";
              const location = getProjectLocationInfo(
                project.cloud_provider,
                project.region,
                project.credential_template?.provider,
                project.project_type,
              );
              const providerBadge = getCloudProviderBadgeInfo(
                project.cloud_provider || project.project_type,
              );
              const driftCount = projectDriftCounts[project.id] || 0;

              return (
                <TableRow
                  key={project.id}
                  data-testid="project-card"
                  className="cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => handleView(project)}
                >
                  <TableCell className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {project.name}
                      </span>
                      {project.description && (
                        <span className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {project.description}
                        </span>
                      )}
                      {project.user_id !== currentUser?.id && (
                        <span className="text-xs text-muted-foreground mt-0.5">
                          Owner: {project.owner_username || "System / CLI"}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <Badge variant={statusVariant} className="text-xs">
                      {statusLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={providerBadge.badgeVariant}
                          className={providerBadge.badgeClass}
                        >
                          {providerBadge.shortLabel}
                        </Badge>
                        <span className="text-foreground/80 font-medium text-xs">
                          {projectTypeLabel(project)}
                        </span>
                      </div>
                      {location && (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1 font-mono">
                          <span>{location.flag}</span>
                          <span>{location.display}</span>
                          {location.label !== location.display && (
                            <span className="font-sans text-muted-foreground/70">
                              ({location.label})
                            </span>
                          )}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Target:{" "}
                        {getPlatformProfileLabel(
                          getProjectTargetPlatform(project),
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-foreground/80 tabular-nums">
                        {project.module_count || 0}
                      </span>
                      {(project.deployed_count || 0) > 0 && (
                        <Badge variant="success" className="text-2xs">
                          {project.deployed_count} deployed
                        </Badge>
                      )}
                      {failed && (
                        <Badge variant="destructive" className="text-2xs">
                          {project.failed_count} failed
                        </Badge>
                      )}
                      {driftCount > 0 && (
                        <Badge variant="warning" className="text-2xs">
                          {driftCount} drifted
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span className="text-xs">
                        {formatTimeAgo(
                          project.updated_at || project.created_at,
                        ) || "Never"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        asChild
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          aria-label="Project actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleView(project);
                          }}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Project
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/projects/${project.id}?tab=settings`);
                          }}
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Settings
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  const platformFilterItems: Array<{
    id: NormalizedCloudProvider | "all";
    label: string;
    count: number;
  }> = [
    { id: "all", label: "All Platforms", count: filteredProjects.length },
    { id: "aws", label: "AWS (EKS)", count: providerCounts.aws ?? 0 },
    { id: "azure", label: "Azure (AKS)", count: providerCounts.azure ?? 0 },
    { id: "gke", label: "Google Cloud (GKE)", count: providerCounts.gke ?? 0 },
    ...PROVIDER_DEFS.filter(
      (def) =>
        def.id !== "aws" &&
        def.id !== "azure" &&
        def.id !== "gke" &&
        (providerCounts[def.id] || 0) > 0,
    ).map((def) => ({
      id: def.id,
      label: def.name,
      count: providerCounts[def.id] || 0,
    })),
  ];

  return (
    <div className="flex min-h-[calc(100vh-3rem)]">
      {/* Left Sub-Sidebar */}
      <CollapsibleInnerSidebar className="w-52 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
        <div className="px-2 pt-1 pb-2 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground">
            Workspaces
            <span className="sr-only">Projects</span>
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            IaC workspaces, modules, variables &amp; state
          </p>
        </div>

        {/* Group 1: VIEWS */}
        <div className="space-y-1">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            VIEWS
          </p>
          <div className="space-y-0.5">
            {chipFilters.map((key) => {
              const selected = activeFilter === key;
              const ViewIcon =
                key === "all"
                  ? Layers
                  : key === "active"
                    ? CheckCircle2
                    : key === "has_failed"
                      ? AlertTriangle
                      : FolderGit2;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setActiveFilter(key);
                    setShowAll(false);
                  }}
                  aria-pressed={selected}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-xs transition-colors cursor-pointer text-left",
                    selected
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <ViewIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate flex-1">
                    {FILTER_CONFIG[key].label}
                  </span>
                  <span
                    className={cn(
                      "text-[11px] tabular-nums px-1.5 py-0.5 rounded",
                      selected
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {counts[key]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Group 2: PLATFORMS */}
        <div className="space-y-1 pt-2 border-t border-border/60">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            PLATFORMS
          </p>
          <div className="space-y-0.5">
            {platformFilterItems.map((item) => {
              const selected = selectedProvider === item.id;
              const PlatformIcon =
                item.id === "all"
                  ? Globe
                  : item.id === "metal"
                    ? Server
                    : Cloud;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedProvider(item.id)}
                  aria-pressed={selected}
                  aria-label={`Platform: ${item.label}`}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-xs transition-colors cursor-pointer text-left",
                    selected
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <PlatformIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate flex-1">{item.label}</span>
                  <span
                    className={cn(
                      "text-[11px] tabular-nums px-1.5 py-0.5 rounded",
                      selected
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </CollapsibleInnerSidebar>

      {/* Right Content Pane */}
      <div className="flex-1 min-w-0 p-6 space-y-5 overflow-y-auto">
        {/* Top Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search projects…"
                aria-label="Search projects"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            <div className="flex items-center bg-muted/60 p-1 rounded-lg text-xs border border-border/50">
              <button
                type="button"
                onClick={() => setViewLayout("grouped")}
                title="Grouped by Cloud Provider"
                aria-label="Grouped by Cloud Provider"
                className={cn(
                  "p-1.5 rounded-md transition-colors cursor-pointer",
                  viewLayout === "grouped"
                    ? "bg-card text-primary shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewLayout("flat")}
                title="Flat View"
                aria-label="Flat View"
                className={cn(
                  "p-1.5 rounded-md transition-colors cursor-pointer",
                  viewLayout === "flat"
                    ? "bg-card text-primary shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
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
            <Button
              variant="default"
              onClick={() => setCreateDialogOpen(true)}
              size="sm"
              className="h-9 shrink-0"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              New Workspace
              <span className="sr-only">New project</span>
            </Button>
          </div>
        </div>

        {/* Content */}
        {isError ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : isLoading ? (
          <SectionCard compact>
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          </SectionCard>
        ) : providerFilteredProjects.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No projects found"
            description={
              searchQuery
                ? `No projects match "${searchQuery}"`
                : selectedProvider !== "all"
                  ? `No projects found for platform '${selectedProvider.toUpperCase()}'.`
                  : "Create your first project to get started"
            }
            action={{
              label: "Create Project",
              onClick: () => setCreateDialogOpen(true),
            }}
          />
        ) : viewLayout === "grouped" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {filteredProjects.length}{" "}
                {filteredProjects.length === 1 ? "project" : "projects"}
              </span>
            </div>

            <div className="space-y-4">
              {groupedProjects.map((group) => {
                const isCollapsed = collapsedGroups[group.id] ?? false;
                const deployedCount = group.projects.reduce(
                  (acc, p) => acc + (p.deployed_count || 0),
                  0,
                );

                return (
                  <div
                    key={group.id}
                    className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs transition-all"
                  >
                    <div
                      onClick={() => toggleGroup(group.id)}
                      className="flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 cursor-pointer border-b border-border/60 select-none transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                          aria-label={
                            isCollapsed ? "Expand group" : "Collapse group"
                          }
                        >
                          {isCollapsed ? (
                            <ChevronRight className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                        <Badge
                          variant={group.badgeVariant}
                          className={group.badgeClass}
                        >
                          {group.shortLabel}
                        </Badge>
                        <div>
                          <h3 className="font-semibold text-sm text-foreground">
                            {group.name}
                          </h3>
                          <p className="text-xs text-muted-foreground font-mono">
                            {group.projects.length} Project
                            {group.projects.length !== 1 ? "s" : ""}
                            {deployedCount > 0
                              ? ` · ${deployedCount} deployed`
                              : ""}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {isCollapsed ? "Expand" : "Collapse"}
                        </span>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="p-0">
                        {renderProjectTable(group.projects)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <SectionCard
            title={`${providerFilteredProjects.length} ${providerFilteredProjects.length === 1 ? "project" : "projects"}`}
            compact
          >
            {renderProjectTable(limited)}

            {!showAll && hasMore && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAll(true)}
                >
                  Show{" "}
                  {providerFilteredProjects.length - INITIAL_PROJECTS_LIMIT}{" "}
                  more
                </Button>
              </div>
            )}
            {showAll && hasMore && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAll(false)}
                >
                  Show less
                </Button>
              </div>
            )}
          </SectionCard>
        )}

        <CreateProjectDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
        />
      </div>
    </div>
  );
}
