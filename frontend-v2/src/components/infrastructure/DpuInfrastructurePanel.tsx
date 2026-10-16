/**
 * DpuInfrastructurePanel — shared DPU hardware view (D-022 P6 Infrastructure IA).
 *
 * Extracted from Fleet.tsx DpuInfrastructureView to live under the new top-level
 * Infrastructure section. Renders a cluster selector + DPFInfrastructurePanel.
 */

import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { CircuitBoard } from "lucide-react";
import { useAllClusters } from "@/hooks/useK8s";

const DPFInfrastructurePanel = lazy(() =>
  import("@/components/k8s/DPFInfrastructurePanel").then((m) => ({
    default: m.DPFInfrastructurePanel,
  })),
);

interface DpuInfrastructurePanelProps {
  /** Cluster ID selected from the unified page header ClusterPicker. */
  initialClusterId?: number;
}

export function DpuInfrastructurePanel({
  initialClusterId,
}: DpuInfrastructurePanelProps) {
  const { data: clustersData, isLoading } = useAllClusters();
  const clusters = clustersData?.clusters ?? [];
  const clusterId = initialClusterId ?? clusters[0]?.id ?? null;

  if (isLoading) {
    return (
      <SectionCard>
        <div className="text-center space-y-2 py-4">
          <Skeleton className="h-6 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto" />
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      {clusterId ? (
        <Suspense
          fallback={
            <SectionCard>
              <div className="text-center space-y-2 py-4">
                <Skeleton className="h-6 w-48 mx-auto" />
                <Skeleton className="h-4 w-64 mx-auto" />
              </div>
            </SectionCard>
          }
        >
          <DPFInfrastructurePanel clusterId={clusterId} />
        </Suspense>
      ) : (
        <EmptyState
          icon={CircuitBoard}
          title="No cluster selected"
          description="Select a Kubernetes cluster in the header to view DPU Infrastructure status."
        />
      )}
    </div>
  );
}
