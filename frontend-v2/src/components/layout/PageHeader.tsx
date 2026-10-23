/**
 * PageHeader — D-020 standard page chrome.
 *
 * Every page that is NOT a resource-explorer (i.e. not KubernetesV2 / F5BNK / CNF / CRExplorer)
 * should use this as its top title block.  It replaces hand-rolled
 * `<h1 className="text-2xl font-bold …">` blocks.
 *
 * Props:
 *   title        — required page title
 *   titleBadge   — optional badge next to title (e.g. status or tier tag)
 *   subtitle     — optional secondary line (e.g. count / status summary)
 *   actions      — optional ReactNode rendered on the right (buttons, etc.)
 *   onRefresh    — optional; when set, renders the STANDARD refresh icon button
 *                  as the right-most action (same position + style on every
 *                  page, matching ResourcePageHeader's refresh).
 *   isRefreshing — spins the refresh icon while a refetch is in flight.
 *   className    — merged onto the outer div
 *   backHref     — optional back route URL (renders a standard Back link)
 *   onBack       — optional back action callback (renders a standard Back button)
 *   backLabel    — optional label for back button (default: "Back")
 *   children     — optional additional content rendered below the title/subtitle
 *
 * Layout: `flex items-start justify-between` — title+subtitle on left,
 * actions on right.  The caller wraps this in whatever spacing its page
 * container needs (typically it's the first child of PageShell or a `space-y-6` div).
 *
 * The refresh button is always rendered LAST (far right) so its position is
 * identical regardless of what other actions a page supplies.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { RefreshCw, ArrowLeft } from "lucide-react";
import { useHeaderMetadata } from "./Header";

export interface PageHeaderProps {
  title?: string;
  titleBadge?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  className?: string;
  backHref?: string;
  onBack?: () => void;
  backLabel?: string;
  children?: React.ReactNode;
}

export function PageHeader({
  title: propTitle,
  titleBadge,
  subtitle,
  actions,
  onRefresh,
  isRefreshing,
  className,
  backHref,
  onBack,
  backLabel = "Back",
  children,
}: PageHeaderProps) {
  const routeHandle = useHeaderMetadata();
  const title = propTitle ?? routeHandle?.title ?? "";
  const hasRight = actions || onRefresh;
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0 flex-1">
        {(backHref || onBack) && (
          <div className="flex items-center gap-2 mb-1">
            {backHref ? (
              <Link
                to={backHref}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "h-7 -ml-2 text-muted-foreground hover:text-foreground",
                )}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                {backLabel}
              </Link>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="h-7 -ml-2 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                {backLabel}
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {titleBadge}
        </div>
        {subtitle &&
          (typeof subtitle === "string" ? (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          ) : (
            <div className="text-sm text-muted-foreground mt-1">{subtitle}</div>
          ))}
        {children}
      </div>
      {hasRight && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 p-0"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw
                className={cn("h-4 w-4", isRefreshing && "animate-spin")}
                aria-hidden="true"
              />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
