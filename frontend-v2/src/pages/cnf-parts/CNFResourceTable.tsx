/**
 * CNF Resource Table — read-only instance list for a selected CRD.
 *
 * Status column derives severity from status.conditions[] (Ready / Programmed /
 * Accepted) via severityFromConditions → getSeverityConfig from lib/health-severity.ts.
 * NO mutation actions (create/edit/delete) — CNF P2 is strictly read-only.
 */

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
import { Eye } from "lucide-react";
import { getSeverityConfig } from "@/lib/health-severity";
import { formatAge } from "@/lib/time-utils";
import type { K8sResource, K8sCondition } from "@/types/kubernetes";
import { severityFromConditions } from "./severity";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CNFResourceTableProps {
  resources: K8sResource[];
  selectedResource: K8sResource | null;
  onSelectResource: (resource: K8sResource) => void;
  onDescribe: (resource: K8sResource) => void;
  borderDefault: string;
}

export function CNFResourceTable({
  resources,
  selectedResource,
  onSelectResource,
  onDescribe,
  borderDefault,
}: CNFResourceTableProps) {
  return (
    <Table className="w-full">
      <TableHeader className="sticky top-0 z-10 bg-card">
        <TableRow
          className={cn(
            "text-xs border-b text-muted-foreground",
            borderDefault,
          )}
        >
          <TableHead className="py-3 px-4 font-medium text-muted-foreground">
            Name
          </TableHead>
          <TableHead className="py-3 px-4 font-medium text-muted-foreground">
            Namespace
          </TableHead>
          <TableHead className="py-3 px-4 font-medium text-muted-foreground">
            Status
          </TableHead>
          <TableHead className="py-3 px-4 font-medium text-muted-foreground">
            Age
          </TableHead>
          <TableHead className="text-right py-3 px-4 font-medium w-24 text-muted-foreground">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {resources.map((resource) => {
          const conditions = resource.status?.conditions as
            | K8sCondition[]
            | undefined;
          const severity = severityFromConditions(conditions);
          const severityConfig = getSeverityConfig(severity);
          const SeverityIcon = severityConfig.icon;

          return (
            <TableRow
              key={resource.metadata?.uid ?? resource.metadata?.name}
              className={cn(
                "border-b cursor-pointer transition-colors hover:bg-muted/50",
                borderDefault,
                selectedResource?.metadata?.uid === resource.metadata?.uid &&
                  "bg-primary/10",
              )}
              onClick={() => onSelectResource(resource)}
            >
              <TableCell className="py-3 px-4">
                <code className="text-sm font-mono text-foreground">
                  {resource.metadata?.name}
                </code>
              </TableCell>
              <TableCell className="py-3 px-4">
                <Badge variant="outline" className="text-xs">
                  {resource.metadata?.namespace || "cluster-wide"}
                </Badge>
              </TableCell>
              <TableCell className="py-3 px-4">
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-medium",
                    severityConfig.color,
                  )}
                >
                  <SeverityIcon className="h-3.5 w-3.5" />
                  {severityConfig.label}
                </div>
              </TableCell>
              <TableCell className="py-3 px-4">
                <span className="text-xs text-muted-foreground">
                  {formatAge(resource.metadata?.creationTimestamp)}
                </span>
              </TableCell>
              <TableCell className="py-3 px-4 text-right">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  aria-label="View details"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDescribe(resource);
                  }}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
