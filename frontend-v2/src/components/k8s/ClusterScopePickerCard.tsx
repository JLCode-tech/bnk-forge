import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPlatformProfileLabel } from "@/lib/platform-context";
import { cn } from "@/lib/utils";
import type { K8sCluster } from "@/types/kubernetes";

export interface ClusterScopePickerCardProps {
  clusters: K8sCluster[];
  onSelectCluster: (clusterId: number) => void;
  title?: string;
  subtitle?: string;
  description?: string;
  actionLabel?: string;
  emptyMessage?: string;
  badgeText?: string;
  headerAction?: ReactNode;
  isLoading?: boolean;
  extraColumnCount?: number;
  showStatusColumn?: boolean;
  extraHeaders?: ReactNode;
  renderExtraCells?: (cluster: K8sCluster) => ReactNode;
  renderRow?: (
    cluster: K8sCluster,
    onSelectCluster: (clusterId: number) => void,
  ) => ReactNode;
  colSpan?: number;
}

export function ClusterScopePickerCard({
  clusters,
  onSelectCluster,
  title = "Clusters",
  subtitle = "Select a cluster to browse workloads, CRDs and network policies.",
  description,
  actionLabel = "Manage Cluster",
  emptyMessage = 'No clusters found. Click "Auto-detect Clusters" or configure your kubeconfig.',
  badgeText,
  headerAction,
  isLoading = false,
  extraColumnCount = 0,
  showStatusColumn = true,
  extraHeaders,
  renderExtraCells,
  renderRow,
  colSpan,
}: ClusterScopePickerCardProps) {
  const navigate = useNavigate();
  const resolvedSubtitle = description ?? subtitle;
  const resolvedColSpan =
    colSpan ?? (showStatusColumn ? 4 : 3) + extraColumnCount;

  const descriptionNode = (
    <span>
      <span>No cluster selected</span>
      <span className="text-muted-foreground ml-1.5">— {resolvedSubtitle}</span>
    </span>
  );

  return (
    <SectionCard
      title={title}
      description={descriptionNode}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 gap-1.5"
            onClick={() => navigate("/fleet")}
          >
            <Globe className="h-3.5 w-3.5" />
            View All Clusters in Cluster Fleet (/fleet)
          </Button>
          {headerAction}
          <Badge variant="outline" className="text-xs">
            {badgeText ??
              `${clusters.length} cluster${clusters.length === 1 ? "" : "s"}`}
          </Badge>
        </div>
      }
      compact
    >
      {isLoading ? (
        <SkeletonTable rows={4} columns={4} />
      ) : (
        <div className="overflow-x-auto -mx-4">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent bg-muted/40">
                <TableHead className="text-xs font-semibold">
                  Cluster Name
                </TableHead>
                <TableHead className="text-xs font-semibold">
                  Cloud Provider
                </TableHead>
                {!renderRow && !extraHeaders && (
                  <>
                    <TableHead className="text-xs font-semibold">
                      Platform
                    </TableHead>
                    <TableHead className="text-xs font-semibold">
                      Version
                    </TableHead>
                  </>
                )}
                {!renderRow && showStatusColumn && (
                  <TableHead className="text-xs font-semibold">
                    Status
                  </TableHead>
                )}
                {extraHeaders}
                <TableHead className="text-xs font-semibold text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clusters.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={resolvedColSpan}
                    className="h-24 text-center text-xs text-muted-foreground"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : renderRow ? (
                clusters.map((cluster) => renderRow(cluster, onSelectCluster))
              ) : (
                clusters.map((cluster) => (
                  <TableRow
                    key={cluster.id}
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => onSelectCluster(cluster.id)}
                  >
                    <TableCell className="font-medium text-xs">
                      {cluster.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-2xs capitalize">
                        {cluster.cloud_provider || "Kubernetes"}
                      </Badge>
                    </TableCell>
                    {!extraHeaders && (
                      <>
                        <TableCell className="text-xs text-muted-foreground">
                          {getPlatformProfileLabel(
                            cluster.detected_platform_profile,
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {cluster.version ?? "—"}
                        </TableCell>
                      </>
                    )}
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-2xs",
                          cluster.status === "active"
                            ? "bg-success/10 text-success border-success/30"
                            : "bg-muted/50 text-muted-foreground",
                        )}
                      >
                        {cluster.status === "active"
                          ? "Reachable"
                          : cluster.status}
                      </Badge>
                    </TableCell>
                    {renderExtraCells?.(cluster)}
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCluster(cluster.id);
                        }}
                      >
                        {actionLabel}
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
