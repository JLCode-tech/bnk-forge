/**
 * StatTile — Canonical compact KPI tile primitive for stat strips across the application.
 * Icon + label + value with tone-driven accent color and optional loading skeleton / subtext.
 * UI Consistency Audit F-2.11.
 */
import * as React from "react";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatTone =
  | "info"
  | "success"
  | "warning"
  | "destructive"
  | "primary"
  | "muted";

const TONE_CLASS: Record<StatTone, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  primary: "text-primary",
  muted: "text-muted-foreground",
};

export interface StatTileProps {
  icon?: React.ElementType;
  label: string;
  value: string | number;
  tone?: StatTone;
  loading?: boolean;
  subtext?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function StatTile({
  icon: Icon,
  label,
  value,
  tone = "muted",
  loading,
  subtext,
  className,
  "data-testid": testId,
}: StatTileProps) {
  return (
    <SectionCard compact className={className} data-testid={testId}>
      <div className="flex items-center justify-between mb-1 gap-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && (
          <Icon className={cn("h-3.5 w-3.5 shrink-0", TONE_CLASS[tone])} />
        )}
      </div>
      {loading ? (
        <Skeleton className="h-6 w-20" />
      ) : (
        <div
          className={cn(
            "text-xl font-bold text-foreground tabular-nums",
            tone !== "muted" && tone !== "primary"
              ? TONE_CLASS[tone]
              : undefined,
          )}
        >
          {value}
        </div>
      )}
      {subtext && (
        <div className="text-xs text-muted-foreground mt-0.5">{subtext}</div>
      )}
    </SectionCard>
  );
}
