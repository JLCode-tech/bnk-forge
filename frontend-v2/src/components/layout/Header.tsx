import { useState, useContext, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Bell,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Search,
  AlertTriangle,
  Info,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  useLocation,
  Link,
  useNavigate,
  UNSAFE_DataRouterStateContext,
  UNSAFE_LocationContext,
} from "react-router-dom";
import {
  useUnreadCount,
  useMarkNotificationRead,
  useMarkAllRead,
  useDeleteNotification,
  useNotificationsInfinite,
  type NotificationFilters,
} from "@/hooks/useNotifications";
import type { NotificationData } from "@/lib/api/notifications";
import { useUpgradeStatus } from "@/hooks/useSystem";
import { ProcessMetricsBar } from "./ProcessMetricsBar";
import { useMaintenanceStatus } from "@/hooks/useBackup";
import { formatTimeAgo } from "@/lib/time-utils";
import { navigationSections } from "./nav-sections";
import { getRouteHandle, type RouteHandle } from "@/router";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

function MaintenanceBanner() {
  const { data: maintenance, isLoading } = useMaintenanceStatus();

  if (isLoading || !maintenance?.maintenance_mode) {
    return null;
  }

  return (
    <Alert className="rounded-none border-x-0 border-t-0 bg-warning/10 text-warning">
      <Loader2 className="h-4 w-4 animate-spin" />
      <AlertDescription>
        {maintenance.message ||
          "System maintenance in progress. Please wait..."}
      </AlertDescription>
    </Alert>
  );
}

function formatNavLabel(label: string): string {
  if (!label) return "Home";
  return label;
}

function findNavMatch(pathname: string): RouteHandle | null {
  for (const section of navigationSections) {
    const matchedItem = section.items.find(
      (item) =>
        item.href === pathname ||
        (item.matchPaths?.includes(pathname) ?? false),
    );
    if (matchedItem) {
      return {
        title: matchedItem.name,
        breadcrumbs: [{ label: formatNavLabel(section.label) }],
      };
    }
  }
  return null;
}

function getHeaderMetadata(pathname: string): RouteHandle {
  // Prioritize the unified navigation taxonomy first
  const navMatch = findNavMatch(pathname);
  if (navMatch) {
    return navMatch;
  }

  const handleFromRoutes = getRouteHandle(pathname);
  if (handleFromRoutes) {
    return handleFromRoutes;
  }

  // General fallback from path segment if not in sidebar
  const segment = pathname.split("/").filter(Boolean)[0];
  const fallbackTitle = segment
    ? segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ")
    : "Overview";

  return {
    title: fallbackTitle,
    breadcrumbs: [{ label: "Home" }],
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useHeaderMetadata(): RouteHandle {
  const dataRouterState = useContext(UNSAFE_DataRouterStateContext);
  const locationContext = useContext(UNSAFE_LocationContext);
  const pathname = locationContext?.location?.pathname ?? "/";

  const navMatch = findNavMatch(pathname);
  if (navMatch) {
    return navMatch;
  }

  if (dataRouterState?.matches) {
    const matchWithHandle = [...dataRouterState.matches]
      .reverse()
      .find(
        (m) =>
          m.route?.handle &&
          typeof m.route.handle === "object" &&
          "title" in m.route.handle,
      );
    if (matchWithHandle?.route?.handle) {
      return matchWithHandle.route.handle as RouteHandle;
    }
  }

  return getHeaderMetadata(pathname);
}

// ─── Severity icon + colour ────────────────────────────────────────────────

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "critical":
      return <ShieldAlert className="h-4 w-4 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-warning" />;
    default:
      // info + anything else
      return <Info className="h-4 w-4 text-info" />;
  }
}

// ─── Single notification row ────────────────────────────────────────────────

interface NotificationItemProps {
  notification: NotificationData;
  onActivate: (notification: NotificationData) => void;
  onDismiss: (id: number, e: React.MouseEvent) => void;
}

function NotificationItem({
  notification,
  onActivate,
  onDismiss,
}: NotificationItemProps) {
  const relativeTime = formatTimeAgo(notification.created_at);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`group relative p-4 hover:bg-muted/50 transition-colors cursor-pointer ${
        !notification.is_read ? "bg-info/10" : ""
      }`}
      onClick={() => onActivate(notification)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(notification);
        }
      }}
    >
      <div className="flex items-start gap-3 pr-6">
        <div className="mt-0.5 shrink-0">
          <SeverityIcon severity={notification.severity || notification.type} />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium leading-tight">
              {notification.title}
            </p>
            {!notification.is_read && (
              <div
                className="h-2 w-2 rounded-full bg-info shrink-0"
                aria-label="unread"
              />
            )}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {notification.message}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {notification.category && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {notification.category}
              </Badge>
            )}
            {relativeTime && (
              <span className="text-xs text-muted-foreground">
                {relativeTime}
              </span>
            )}
          </div>
        </div>
      </div>
      {/* Dismiss button — stopPropagation so row click doesn't fire */}
      <button
        type="button"
        aria-label="Dismiss notification"
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
        onClick={(e) => onDismiss(notification.id, e)}
      >
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}

// ─── Filter bar inside the popover ─────────────────────────────────────────

const SEVERITY_OPTIONS = [
  "all",
  "info",
  "success",
  "warning",
  "error",
  "critical",
] as const;
const CATEGORY_OPTIONS = [
  "all",
  "deployment",
  "cluster",
  "credentials",
  "system",
  "security",
  "fleet",
  "general",
] as const;

interface FilterBarProps {
  filters: NotificationFilters;
  onChange: (f: NotificationFilters) => void;
}

function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="flex flex-col gap-2 px-3 pt-2 pb-3 border-b">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground shrink-0">
          Severity:
        </span>
        <div className="flex flex-wrap gap-1">
          {SEVERITY_OPTIONS.map((s) => {
            const active = (filters.severity ?? "all") === s;
            return (
              <button
                key={s}
                type="button"
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted"
                }`}
                onClick={() =>
                  onChange({
                    ...filters,
                    severity: s === "all" ? undefined : s,
                  })
                }
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground shrink-0">
          Category:
        </span>
        <div className="flex flex-wrap gap-1">
          {CATEGORY_OPTIONS.map((c) => {
            const active = (filters.category ?? "all") === c;
            return (
              <button
                key={c}
                type="button"
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted"
                }`}
                onClick={() =>
                  onChange({
                    ...filters,
                    category: c === "all" ? undefined : c,
                  })
                }
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Notification bell popover ──────────────────────────────────────────────

function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<NotificationFilters>({});

  const { data: unreadCount = 0 } = useUnreadCount();
  const markAsRead = useMarkNotificationRead();
  const markAllRead = useMarkAllRead();
  const deleteNotification = useDeleteNotification();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useNotificationsInfinite(filters);

  const notifications = data?.pages.flat() ?? [];

  function handleActivate(notification: NotificationData) {
    if (!notification.is_read) {
      markAsRead.mutate(notification.id);
    }
    if (notification.action_url) {
      navigate(notification.action_url);
      setOpen(false);
    }
  }

  function handleDismiss(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    deleteNotification.mutate(id);
  }

  const activeFiltersLabel =
    filters.severity || filters.category
      ? `${filters.severity ?? ""}${filters.severity && filters.category ? " · " : ""}${filters.category ?? ""}`
      : null;

  const emptyMessage = activeFiltersLabel
    ? `No ${activeFiltersLabel} notifications`
    : "No notifications";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Badge variant="secondary">{unreadCount} new</Badge>
          )}
        </div>

        {/* Filter controls */}
        <FilterBar filters={filters} onChange={setFilters} />

        {/* List */}
        <div className="max-h-[360px] overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin opacity-50" />
              <p className="text-sm">Loading...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{emptyMessage}</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onActivate={handleActivate}
                  onDismiss={handleDismiss}
                />
              ))}
              {hasNextPage && (
                <div className="p-2 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="p-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => markAllRead.mutate()}
            >
              Mark all as read
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Main Header component ─────────────────────────────────────────────────

export function Header() {
  const location = useLocation();
  const { isUpgrading, upgradePhaseLabel } = useUpgradeStatus();

  const currentPage = useHeaderMetadata();
  useEffect(() => {
    document.title = currentPage.title
      ? `${currentPage.title} | BNK Forge`
      : "BNK Forge";
  }, [currentPage.title]);
  const parentBreadcrumbs = currentPage.breadcrumbs.filter(
    (crumb, index) =>
      index < currentPage.breadcrumbs.length - 1 ||
      crumb.label !== currentPage.title,
  );
  const lastBreadcrumb =
    currentPage.breadcrumbs[currentPage.breadcrumbs.length - 1];
  const titleHref =
    lastBreadcrumb?.label === currentPage.title
      ? lastBreadcrumb.href
      : undefined;

  return (
    <header className="border-b bg-card">
      {/* Maintenance mode banner */}
      <MaintenanceBanner />
      {/* UP-012: Global upgrade-in-progress banner */}
      {isUpgrading && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-primary text-primary-foreground text-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="font-medium">System upgrade in progress</span>
          {upgradePhaseLabel && (
            <span className="opacity-80">— {upgradePhaseLabel}</span>
          )}
          <Badge
            variant="outline"
            className="text-primary-foreground border-primary-foreground/40 text-xs ml-2"
          >
            <ShieldAlert className="h-3 w-3 mr-1" />
            Deployments locked
          </Badge>
          {location.pathname !== "/system" && (
            <Link
              to="/system?tab=monitor"
              className="ml-2 text-xs underline underline-offset-2 opacity-80 hover:opacity-100"
            >
              View progress
            </Link>
          )}
        </div>
      )}
      <div className="h-12 flex items-center justify-between px-6">
        {/* Left side: Page context and breadcrumbs */}
        <div className="flex items-center gap-2 text-sm">
          {parentBreadcrumbs.map((crumb, index) => (
            <div
              key={index}
              className="flex items-center gap-2 text-muted-foreground"
            >
              {crumb.href ? (
                <Link
                  to={crumb.href}
                  className="hover:text-foreground transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </div>
          ))}
          <h2 className="text-sm font-semibold text-foreground">
            {titleHref ? (
              <Link
                to={titleHref}
                className="hover:text-primary transition-colors"
              >
                {currentPage.title}
              </Link>
            ) : (
              currentPage.title
            )}
          </h2>
        </div>

        {/* Right side: Actions */}
        <div className="flex items-center gap-2">
          {/* Backend process metrics strip */}
          <ProcessMetricsBar />

          {/* Global Search / Command Palette Trigger */}
          <Button
            variant="outline"
            className="hidden md:flex items-center gap-2 text-muted-foreground"
            onClick={() => {
              // This will be triggered by the command palette in AppShell
              const event = new KeyboardEvent("keydown", {
                key: "k",
                metaKey: true,
                bubbles: true,
              });
              document.dispatchEvent(event);
            }}
          >
            <Search className="h-4 w-4" />
            <span className="text-sm">Search...</span>
            <Badge variant="secondary" className="text-xs font-mono ml-2">
              ⌘K
            </Badge>
          </Button>

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Notification Center */}
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
