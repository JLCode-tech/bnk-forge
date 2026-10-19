import {
  NavLink,
  Link,
  useMatch,
  useResolvedPath,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/branding/BrandLogo";
import { getBrand } from "@/lib/brand";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  GitCompare,
  KeyRound,
} from "lucide-react";
import { navigationSections, type NavItem } from "./nav-sections";
import { useProjects } from "@/hooks/useProjects";
import { useTaskStats, useTasks } from "@/hooks/useTasks";
import { useAllClusters } from "@/hooks/useK8s";
import { useSystemHealth } from "@/hooks/useSystem";
import { useGlobalDriftCount } from "@/hooks/useDrift";
import * as React from "react";
import { startTransition, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import type { UserRole } from "@/types";
import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";

// Role hierarchy for filtering
const ROLE_LEVEL: Record<UserRole, number> = {
  admin: 3,
  operator: 2,
  viewer: 1,
};

// v3: Single-column navigation section state
const SECTION_STATE_STORAGE_KEY = "sidebar.sectionCollapsed.v3";

const DEFAULT_SECTION_STATE: Record<string, boolean> = {};

function loadSectionState(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(SECTION_STATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...DEFAULT_SECTION_STATE, ...parsed };
      }
    }
  } catch {
    // localStorage disabled / malformed — fall through.
  }
  return { ...DEFAULT_SECTION_STATE };
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [sectionCollapsed, setSectionCollapsed] =
    useState<Record<string, boolean>>(loadSectionState);
  const navigate = useNavigate();

  const toggleSection = (label: string) => {
    setSectionCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        window.localStorage.setItem(
          SECTION_STATE_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // ignore quota / disabled storage
      }
      return next;
    });
  };

  const user = useAuthStore((s) => s.user);
  const { data: projects } = useProjects();
  const { data: taskStats } = useTaskStats({ days: 1 });
  const { data: latestTaskData } = useTasks({ limit: 1 });
  const { data: clustersData } = useAllClusters();
  const { data: systemHealth, isError: isSystemHealthError } =
    useSystemHealth();
  const driftCount = useGlobalDriftCount();

  const projectCount = projects?.length ?? 0;
  const inProgressTasks =
    (taskStats?.by_status?.in_progress ?? 0) +
    (taskStats?.by_status?.queued ?? 0);
  const clusterCount = clustersData?.count ?? 0;

  const systemServices = systemHealth?.services
    ? Object.values(systemHealth.services)
    : [];
  const offlineCount = systemServices.filter(
    (s) => s.status === "offline",
  ).length;
  const degradedCount = systemServices.filter(
    (s) => s.status === "degraded",
  ).length;
  const systemStatusDotClass =
    isSystemHealthError || offlineCount > 0
      ? "bg-destructive"
      : degradedCount > 0
        ? "bg-warning"
        : "bg-success animate-pulse";
  const systemStatusLabel = isSystemHealthError
    ? "System health unavailable"
    : offlineCount > 0
      ? `${offlineCount} service${offlineCount === 1 ? "" : "s"} offline`
      : degradedCount > 0
        ? `${degradedCount} service${degradedCount === 1 ? "" : "s"} degraded`
        : "All systems operational";

  const latestTask = latestTaskData?.tasks?.[0];
  const latestTaskStatus = latestTask?.status;

  const getCount = (countType?: string) => {
    switch (countType) {
      case "projects":
        return projectCount;
      case "activity":
        return inProgressTasks;
      case "clusters":
      case "fleet":
        return clusterCount;
      default:
        return null;
    }
  };

  const userLevel = ROLE_LEVEL[(user?.role as UserRole) ?? "viewer"];

  const visibleSections = navigationSections
    .filter((section) => {
      if (!section.minRole) return true;
      return userLevel >= ROLE_LEVEL[section.minRole];
    })
    .map((section) => {
      const visibleItems = section.items.filter((item) => {
        if (!item.minRole) return true;
        return userLevel >= ROLE_LEVEL[item.minRole];
      });
      return { ...section, visibleItems };
    })
    .filter((section) => section.visibleItems.length > 0);

  const UserFooter = () => {
    const { user, logout } = useAuthStore();
    const [showChangePassword, setShowChangePassword] = useState(false);

    if (!user) return null;

    return (
      <>
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <span className="text-2xs font-medium text-primary">
                {user.username.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="truncate">{user.username}</span>
            <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {user.role}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                  onClick={() => setShowChangePassword(true)}
                  aria-label="Change password"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Change password</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    logout();
                    startTransition(() => navigate("/login"));
                  }}
                  aria-label="Logout"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Log out</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <ChangePasswordDialog
          open={showChangePassword}
          onOpenChange={setShowChangePassword}
        />
      </>
    );
  };

  return (
    <TooltipProvider>
      <aside
        aria-label="Application sidebar"
        className={cn(
          "border-r border-border bg-card flex flex-col h-screen transition-all duration-300 shrink-0",
          collapsed ? "w-14" : "w-64",
        )}
      >
        {/* Brand Header */}
        <div
          className={cn(
            "h-12 border-b border-border flex items-center",
            collapsed ? "justify-center px-1.5" : "justify-between px-3.5",
          )}
        >
          {!collapsed && (
            <Link
              to="/"
              aria-label="Home"
              className="flex items-center gap-2.5 min-w-0"
            >
              <BrandLogo
                className="w-7 h-7 text-foreground shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <h1 className="text-base font-bold tracking-tight text-foreground leading-tight truncate">
                  {getBrand() === "f5" ? "Forge" : "BNK Forge"}
                </h1>
                {getBrand() !== "f5" && (
                  <p className="text-2xs uppercase tracking-widest text-muted-foreground leading-none">
                    Infrastructure
                  </p>
                )}
              </div>
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>

        {/* Navigation */}
        <nav
          className="flex-1 overflow-y-auto px-3 py-4 space-y-6"
          aria-label="Main navigation"
        >
          {visibleSections.map((section) => {
            const isSectionCollapsed =
              !collapsed && !!sectionCollapsed[section.label];
            return (
              <div
                key={section.label || section.visibleItems[0]?.name}
                className="last:mb-0"
              >
                {!collapsed && section.label ? (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.label)}
                    className="w-full flex items-center justify-between px-2.5 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                    aria-expanded={!isSectionCollapsed}
                  >
                    <span>{section.label}</span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        isSectionCollapsed ? "-rotate-90" : "rotate-0",
                      )}
                    />
                  </button>
                ) : null}

                {!isSectionCollapsed && (
                  <div className="space-y-1">
                    {section.visibleItems.map((item) => {
                      const count = getCount(item.showCount);
                      const navLink = (
                        <SidebarNavItem
                          key={item.name}
                          item={item}
                          collapsed={collapsed}
                          count={count}
                          driftCount={driftCount}
                          latestTaskStatus={latestTaskStatus}
                        />
                      );
                      return collapsed ? (
                        <Tooltip key={item.name} delayDuration={0}>
                          <TooltipTrigger asChild>{navLink}</TooltipTrigger>
                          <TooltipContent side="right">
                            {item.name}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        navLink
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer with system status */}
        {!collapsed && (
          <div className="px-3 py-2 border-t border-border">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div
                  className={cn("h-2 w-2 rounded-full", systemStatusDotClass)}
                />
                <span>{systemStatusLabel}</span>
              </div>
              <UserFooter />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Version {__APP_VERSION__}</span>
              </div>
            </div>
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
}

// =====================================================================
// SidebarNavItem
// =====================================================================
//
// One row of the sidebar nav. Extracted so we can call useMatch /
// useResolvedPath at the top level (Rules of Hooks) and pass a STRING
// className down to NavLink instead of the function form.
//
// Why this matters: in collapsed mode the link is wrapped in
// <TooltipTrigger asChild>, whose Radix Slot merges props by string
// concatenation. A function className gets toString()-ed into the
// `class` attribute, the browser then parses every word inside the
// function source as a Tailwind class, and you get the wrong colors
// and hover state. Passing a precomputed string sidesteps that
// entirely.

interface SidebarNavItemProps {
  item: NavItem;
  collapsed: boolean;
  count: number | null;
  driftCount: number;
  latestTaskStatus: string | null | undefined;
}

const SidebarNavItem = React.forwardRef<HTMLAnchorElement, SidebarNavItemProps>(
  ({ item, collapsed, count, driftCount, latestTaskStatus, ...rest }, ref) => {
    const location = useLocation();
    const resolved = useResolvedPath(item.href);
    const match = useMatch({ path: resolved.pathname, end: item.href === "/" });
    const matchesAlias = item.matchPaths?.some(
      (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
    );
    const isActive = !!match || !!matchesAlias;

    const linkClassName = cn(
      "flex items-center py-1.5 rounded-md font-sans text-sm font-medium transition-all relative",
      collapsed ? "w-9 mx-auto justify-center" : "gap-2.5 px-2.5",
      isActive
        ? "bg-primary/10 text-primary font-medium"
        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
    );

    return (
      <NavLink
        to={item.href}
        end={item.href === "/"}
        className={linkClassName}
        ref={ref}
        {...rest}
      >
        <item.icon className="h-4 w-4 flex-shrink-0" />

        <span
          className={cn(
            "flex-1 text-left leading-snug",
            collapsed && "sr-only",
          )}
        >
          {item.name}
        </span>

        {!collapsed && (
          <>
            {/* Drift badge — amber/red indicator next to Projects */}
            {item.showDriftBadge && driftCount > 0 && (
              <span
                className={cn(
                  "px-1.5 py-0.5 text-xs font-semibold tabular-nums rounded-full flex items-center gap-1",
                  driftCount >= 5
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/10 text-warning",
                )}
                title={`${driftCount} module${driftCount !== 1 ? "s" : ""} with drift`}
              >
                <GitCompare className="h-3 w-3" />
                {driftCount}
              </span>
            )}
            {/* Count badge */}
            {count !== null && count > 0 && (
              <span
                className={cn(
                  "px-1.5 py-0.5 text-xs tabular-nums rounded-full",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            )}
          </>
        )}

        {/* Drift indicator dot (visible in collapsed mode too) */}
        {item.showDriftBadge && driftCount > 0 && collapsed && (
          <div
            className={cn(
              "absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-card",
              driftCount >= 5 ? "bg-destructive" : "bg-warning",
            )}
            title={`${driftCount} module${driftCount !== 1 ? "s" : ""} with drift`}
          />
        )}

        {/* Latest task status indicator */}
        {item.href === "/tasks" && latestTaskStatus && (
          <div
            className={cn(
              "absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-card",
              latestTaskStatus === "failed" && "bg-destructive",
              latestTaskStatus === "completed" && "bg-success",
              (latestTaskStatus === "in_progress" ||
                latestTaskStatus === "queued") &&
                "bg-primary animate-pulse",
            )}
            title={`Latest task: ${latestTaskStatus}`}
          />
        )}
      </NavLink>
    );
  },
);
SidebarNavItem.displayName = "SidebarNavItem";
