/**
 * F5 BNK Resource Table — Table rendering with registry-driven action menus
 *
 * Extracted from F5BNK.tsx. Replaces 17 conditional dropdown items
 * with a single registry lookup.
 */

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAge } from "@/lib/time-utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eye, Edit, Trash2, MoreVertical } from "lucide-react";
import { getContextActions } from "./resource-registry";
import type { K8sResource, K8sCondition } from "@/types/kubernetes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface F5BNKResourceTableProps {
  resources: K8sResource[];
  selectedResource: K8sResource | null;
  onSelectResource: (resource: K8sResource) => void;
  onDescribe: (resource: K8sResource) => void;
  onEdit: (resource: K8sResource) => void;
  onDelete: (resource: K8sResource) => void;
  /** For context actions that navigate to a special view */
  onNavigateView: (viewKey: string) => void;
  /** For context actions that open a dialog (e.g. irule-viewer) */
  onOpenDialog: (dialogKey: string, resource: K8sResource) => void;
  borderDefault: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusBadge(resource: K8sResource) {
  const conditions =
    (resource.status?.conditions as K8sCondition[] | undefined) || [];
  const ready = conditions.find(
    (c) =>
      c.type === "Ready" || c.type === "Programmed" || c.type === "Accepted",
  );

  let statusText = "N/A";
  if (ready?.status === "True") {
    statusText = "Ready";
  } else if (ready?.status === "False") {
    statusText = "Failed";
  } else if (ready?.status === "Unknown") {
    statusText = "Unknown";
  }

  return <StatusBadge status={statusText} />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function F5BNKResourceTable({
  resources,
  selectedResource,
  onSelectResource,
  onDescribe,
  onEdit,
  onDelete,
  onNavigateView,
  onOpenDialog,
  borderDefault,
}: F5BNKResourceTableProps) {
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
          <TableHead className="text-right py-3 px-4 font-medium w-32 text-muted-foreground">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {resources.map((resource) => {
          const contextActions = getContextActions(resource.kind);

          return (
            <TableRow
              key={resource.metadata?.uid}
              className={cn(
                "border-b cursor-pointer transition-colors hover:bg-muted/50",
                borderDefault,
                selectedResource?.metadata?.uid === resource.metadata?.uid &&
                  "bg-primary/10",
              )}
              onClick={() => onSelectResource(resource)}
            >
              <TableCell className="py-3 px-4">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-foreground">
                    {resource.metadata?.name}
                  </code>
                </div>
              </TableCell>
              <TableCell className="py-3 px-4">
                <Badge variant="outline" className="text-xs">
                  {resource.metadata?.namespace || "cluster-wide"}
                </Badge>
              </TableCell>
              <TableCell className="py-3 px-4">
                {getStatusBadge(resource)}
              </TableCell>
              <TableCell className="py-3 px-4">
                <span className="text-xs text-muted-foreground">
                  {formatAge(resource.metadata?.creationTimestamp)}
                </span>
              </TableCell>
              <TableCell className="py-3 px-4 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    asChild
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label="Instance actions"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {/* Standard actions */}
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onDescribe(resource);
                      }}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Describe
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(resource);
                      }}
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit YAML
                    </DropdownMenuItem>

                    {/* Registry-driven context actions */}
                    {contextActions.map((action) => {
                      const ActionIcon = action.icon;
                      return (
                        <DropdownMenuItem
                          key={action.label}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              action.type === "navigate" &&
                              action.targetView
                            ) {
                              onNavigateView(action.targetView);
                            } else if (
                              action.type === "dialog" &&
                              action.dialogKey
                            ) {
                              onOpenDialog(action.dialogKey, resource);
                            } else if (action.type === "select") {
                              onSelectResource(resource);
                            }
                          }}
                        >
                          <ActionIcon className="h-4 w-4 mr-2" />
                          {action.label}
                        </DropdownMenuItem>
                      );
                    })}

                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(resource);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
