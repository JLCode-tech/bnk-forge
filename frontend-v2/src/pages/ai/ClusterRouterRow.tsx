/**
 * One row of the SmartLLM Router "All Clusters" table: live 24h gateway
 * telemetry for a single cluster, or "No telemetry" when Loki is unavailable.
 */
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { useLlmStats } from "@/hooks/useLlmObservability";
import type { K8sCluster } from "@/types/kubernetes";

export function ClusterRouterRow({
  cluster,
  onInspect,
}: {
  cluster: K8sCluster;
  onInspect: () => void;
}) {
  const { data, isLoading } = useLlmStats(cluster.id, { range: "24h" });
  const live = data?.available ? data : undefined;
  const empty = isLoading ? "…" : "—";

  return (
    <TableRow className="hover:bg-muted/30">
      <TableCell className="font-medium text-xs">{cluster.name}</TableCell>
      <TableCell>
        <Badge variant="outline" className="text-2xs capitalize">
          {cluster.cloud_provider || "Kubernetes"}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-right tabular-nums">
        {live ? live.total_requests.toLocaleString() : empty}
      </TableCell>
      <TableCell className="text-xs text-right tabular-nums">
        {live ? `${(live.success_rate * 100).toFixed(1)}%` : empty}
      </TableCell>
      <TableCell className="text-xs text-right tabular-nums">
        {live ? `${Math.round(live.avg_latency_ms)}ms` : empty}
      </TableCell>
      <TableCell>
        {isLoading ? (
          <span className="text-xs text-muted-foreground">Checking…</span>
        ) : live ? (
          <Badge
            variant="outline"
            className="text-2xs bg-success/10 text-success border-success/30"
          >
            Live
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-2xs text-muted-foreground"
            title={data?.reason ?? undefined}
          >
            No telemetry
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={onInspect}
        >
          Inspect
          <ArrowRight className="h-3 w-3" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
