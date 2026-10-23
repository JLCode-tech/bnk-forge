/**
 * One row of the F5 CNF "All Clusters" table: which CNF functions (DNS,
 * CGNAT, Diameter) have their CRDs installed on the cluster.
 */
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { useCrds } from "@/hooks/useCrds";
import type { K8sCluster } from "@/types/kubernetes";

const CNF_FUNCTIONS: { label: string; plurals: string[] }[] = [
  {
    label: "DNS",
    plurals: ["f5bigdnsapps", "f5bigdnsresolvercaches", "f5bigdnszones"],
  },
  { label: "CGNAT", plurals: ["f5bigcgnats"] },
  { label: "Diameter", plurals: ["f5bigdiameters"] },
];

export function CNFClusterRow({
  cluster,
  onInspect,
}: {
  cluster: K8sCluster;
  onInspect: () => void;
}) {
  const { data, isLoading, isError } = useCrds(cluster.id);
  const plurals = new Set((data?.crds ?? []).map((c) => c.plural));
  const installed = CNF_FUNCTIONS.filter((f) =>
    f.plurals.some((p) => plurals.has(p)),
  );

  return (
    <TableRow className="hover:bg-muted/30">
      <TableCell className="font-medium text-xs">{cluster.name}</TableCell>
      <TableCell>
        <Badge variant="outline" className="text-2xs capitalize">
          {cluster.cloud_provider || "Kubernetes"}
        </Badge>
      </TableCell>
      <TableCell className="text-xs">
        {isLoading ? (
          <span className="text-muted-foreground">Checking…</span>
        ) : isError || !data ? (
          <span className="text-muted-foreground">Unavailable</span>
        ) : installed.length === 0 ? (
          <span className="text-muted-foreground">Not installed</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {installed.map((f) => (
              <Badge
                key={f.label}
                variant="outline"
                className="text-2xs bg-success/10 text-success border-success/30"
              >
                {f.label}
              </Badge>
            ))}
          </div>
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
