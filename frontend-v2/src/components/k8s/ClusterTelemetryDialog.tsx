/**
 * ClusterTelemetryDialog
 * Modal dialog presenting live eBPF flows, F5 TMM DPDK metrics, and Day 2 architectural drift.
 * Accessible from Cluster cards (Project Details), Fleet Overview table, and quick actions.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClusterTelemetryPanel } from "./ClusterTelemetryPanel";

interface ClusterTelemetryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterId: number | string | null;
  clusterName?: string;
  projectId?: number;
}

export function ClusterTelemetryDialog({
  open,
  onOpenChange,
  clusterId,
  clusterName,
  projectId,
}: ClusterTelemetryDialogProps) {
  if (!clusterId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-6">
        <DialogHeader className="sr-only">
          <DialogTitle>Cluster Telemetry: {clusterName || clusterId}</DialogTitle>
          <DialogDescription>
            Live eBPF socket flows, F5 BIG-IP Next TMM DPDK counters, and Day 2 drift violations.
          </DialogDescription>
        </DialogHeader>

        <ClusterTelemetryPanel
          clusterId={clusterId}
          clusterName={clusterName}
          projectId={projectId}
        />
      </DialogContent>
    </Dialog>
  );
}
