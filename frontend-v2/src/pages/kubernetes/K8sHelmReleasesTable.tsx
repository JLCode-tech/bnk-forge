/**
 * K8sHelmReleasesTable — Helm releases list within the K8s resource explorer
 * K8S-UX-004: Helm releases moved from standalone /helm page into K8s page
 *
 * Shows releases for the currently selected cluster (not all clusters).
 * Reuses existing Helm components (ReleaseDetailPanel, Install/Upgrade/Rollback dialogs).
 */

import { memo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical,
  Eye,
  ArrowUpCircle,
  RotateCcw,
  Trash2,
  Package,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import type { HelmRelease } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HelmAction =
  | { type: "view"; release: HelmRelease }
  | { type: "upgrade"; release: HelmRelease }
  | { type: "rollback"; release: HelmRelease }
  | { type: "uninstall"; release: HelmRelease };

interface K8sHelmReleasesTableProps {
  releases: HelmRelease[];
  selectedRelease: HelmRelease | null;
  onAction: (action: HelmAction) => void;
  borderDefault: string;
}

// Status display configuration
const statusConfig: Record<
  string,
  { label: string; color: string; bg: string; Icon: typeof CheckCircle2 }
> = {
  deployed: {
    label: "Deployed",
    color: "text-success",
    bg: "bg-success/10",
    Icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    color: "text-destructive",
    bg: "bg-destructive/10",
    Icon: AlertTriangle,
  },
  pending: {
    label: "Pending",
    color: "text-warning",
    bg: "bg-warning/10",
    Icon: Clock,
  },
  "pending-install": {
    label: "Installing",
    color: "text-warning",
    bg: "bg-warning/10",
    Icon: Clock,
  },
  "pending-upgrade": {
    label: "Upgrading",
    color: "text-warning",
    bg: "bg-warning/10",
    Icon: Clock,
  },
  "pending-rollback": {
    label: "Rolling back",
    color: "text-warning",
    bg: "bg-warning/10",
    Icon: Clock,
  },
  uninstalling: {
    label: "Uninstalling",
    color: "text-warning",
    bg: "bg-warning/10",
    Icon: Clock,
  },
  superseded: {
    label: "Superseded",
    color: "text-muted-foreground",
    bg: "bg-muted",
    Icon: Clock,
  },
};

function getStatusDisplay(status: string) {
  const key = status?.toLowerCase() || "deployed";
  return statusConfig[key] || statusConfig.deployed;
}

// ---------------------------------------------------------------------------
// Memoized Row Component
// ---------------------------------------------------------------------------

interface HelmReleaseRowProps {
  release: HelmRelease;
  isSelected: boolean;
  onAction: (action: HelmAction) => void;
  borderDefault: string;
}

const HelmReleaseRow = memo(function HelmReleaseRow({
  release,
  isSelected,
  onAction,
  borderDefault,
}: HelmReleaseRowProps) {
  const statusDisplay = getStatusDisplay(release.status);
  const StatusIcon = statusDisplay.Icon;

  return (
    <TableRow
      className={cn(
        "cursor-pointer transition-colors border-b",
        borderDefault,
        isSelected ? "bg-primary/10" : "hover:bg-muted/50",
      )}
      onClick={() => onAction({ type: "view", release })}
    >
      <TableCell className="py-2.5 px-4">
        <div className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          <code className="text-xs font-mono">{release.name}</code>
        </div>
      </TableCell>
      <TableCell className="py-2.5 px-4">
        <div className="flex items-center gap-1.5">
          <StatusIcon className={cn("h-3.5 w-3.5", statusDisplay.color)} />
          <Badge
            className={cn("text-2xs", statusDisplay.color, statusDisplay.bg)}
          >
            {statusDisplay.label}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="py-2.5 px-4">
        <code className="text-xs font-mono text-muted-foreground">
          {release.namespace}
        </code>
      </TableCell>
      <TableCell className="py-2.5 px-4">
        <Badge variant="outline" className="text-xs">
          {release.chart}
        </Badge>
      </TableCell>
      <TableCell className="py-2.5 px-4">
        <span className="text-sm font-mono text-muted-foreground">
          #{release.revision}
        </span>
      </TableCell>
      <TableCell className="py-2.5 px-4">
        <span className="text-sm text-muted-foreground">
          {release.updated
            ? new Date(release.updated).toLocaleDateString()
            : "-"}
        </span>
      </TableCell>
      <TableCell className="py-2.5 px-4 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label="Release actions"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onAction({ type: "view", release });
              }}
            >
              <Eye className="h-4 w-4 mr-2" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onAction({ type: "upgrade", release });
              }}
            >
              <ArrowUpCircle className="h-4 w-4 mr-2" />
              Upgrade
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onAction({ type: "rollback", release });
              }}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Rollback
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onAction({ type: "uninstall", release });
              }}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Uninstall
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});

// ---------------------------------------------------------------------------
// Table Component
// ---------------------------------------------------------------------------

export function K8sHelmReleasesTable({
  releases,
  selectedRelease,
  onAction,
  borderDefault,
}: K8sHelmReleasesTableProps) {
  // Stabilize callback for memoized rows
  const handleAction = useCallback(
    (action: HelmAction) => onAction(action),
    [onAction],
  );

  return (
    <div className="flex-1 overflow-auto">
      <Table className="w-full">
        <TableHeader className="sticky top-0 bg-card">
          <TableRow className="text-xs text-muted-foreground">
            <TableHead className="py-2 px-4 font-medium text-muted-foreground">
              Release
            </TableHead>
            <TableHead className="py-2 px-4 font-medium text-muted-foreground">
              Status
            </TableHead>
            <TableHead className="py-2 px-4 font-medium text-muted-foreground">
              Namespace
            </TableHead>
            <TableHead className="py-2 px-4 font-medium text-muted-foreground">
              Chart
            </TableHead>
            <TableHead className="py-2 px-4 font-medium text-muted-foreground">
              Revision
            </TableHead>
            <TableHead className="py-2 px-4 font-medium text-muted-foreground">
              Updated
            </TableHead>
            <TableHead className="text-right py-2 px-4 font-medium text-muted-foreground">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {releases.map((release) => (
            <HelmReleaseRow
              key={`${release.namespace}-${release.name}`}
              release={release}
              isSelected={
                selectedRelease?.name === release.name &&
                selectedRelease?.namespace === release.namespace
              }
              onAction={handleAction}
              borderDefault={borderDefault}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
