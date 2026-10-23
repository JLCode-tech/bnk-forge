import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

interface RestoreOverlayProps {
  active: boolean;
  tableCounts?: Record<string, number>;
  warnings?: string[];
  migrationsApplied?: string[];
}

export function RestoreOverlay({
  active,
  tableCounts,
  warnings,
  migrationsApplied,
}: RestoreOverlayProps) {
  if (!active) return null;

  const nonZeroCounts = tableCounts
    ? Object.entries(tableCounts).filter(([, v]) => v > 0)
    : [];

  return (
    <AlertDialog open={active}>
      <AlertDialogContent className="flex flex-col items-center gap-4 text-center max-w-md">
        <AlertDialogHeader className="flex flex-col items-center gap-2">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <AlertDialogTitle className="text-lg font-semibold">
            Restore in progress
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              {nonZeroCounts.length > 0 && (
                <ul className="space-y-1">
                  {nonZeroCounts.map(([table, count]) => (
                    <li key={table}>
                      {count} {table.replace(/_/g, " ")}
                    </li>
                  ))}
                </ul>
              )}

              {migrationsApplied && migrationsApplied.length > 0 && (
                <p>
                  {migrationsApplied.length} migration
                  {migrationsApplied.length !== 1 ? "s" : ""} applied
                </p>
              )}

              {warnings && warnings.length > 0 && (
                <p className="text-warning">{warnings.join(", ")}</p>
              )}

              <p>
                The system is restarting. This page will reload automatically...
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
      </AlertDialogContent>
    </AlertDialog>
  );
}
