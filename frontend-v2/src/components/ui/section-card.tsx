/**
 * SectionCard — D-020 spacing-rhythm surface primitive (bnkhealth shape).
 *
 * Matches `gitlab-f5/bnkhealth/frontend/src/resource/overview/index.tsx`
 * `SectionCard`: `rounded-xl border bg-card`, generous `p-6` (or compact
 * `px-4 py-4`), eyebrow title `text-sm font-semibold uppercase tracking-wide`
 * in a quiet text-tertiary tone, with `mb-5` (or `mb-2` when compact)
 * between title and body. No shadow, no auto-wrapped body spacing —
 * callers control inner rhythm so dense forms can sit alongside calm
 * KPI strips without the primitive imposing a single answer.
 *
 * Props:
 *   title    — optional uppercase-tracked eyebrow label
 *   compact  — tighter padding (`px-4 py-4` instead of `p-6`)
 *   children — section body
 *   className — merged onto the outer div
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Eyebrow label — rendered as uppercase tracked sm text above children */
  title?: string;
  /** Optional subtitle or description text below title */
  description?: React.ReactNode;
  /** Optional header action element placed opposite the title */
  action?: React.ReactNode;
  /** Use compact (`px-4 py-4`) instead of the default `p-6` padding */
  compact?: boolean;
}

const SectionCard = React.forwardRef<HTMLDivElement, SectionCardProps>(
  (
    {
      title,
      description,
      action,
      compact = false,
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border bg-card",
        compact ? "px-4 py-4" : "p-6",
        className,
      )}
      {...props}
    >
      {(title || description || action) && (
        <div
          className={cn(
            "flex items-center justify-between gap-3",
            compact ? "mb-2" : "mb-5",
          )}
        >
          {(title || description) && (
            <div>
              {title && (
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {title}
                </h3>
              )}
              {description && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {description}
                </p>
              )}
            </div>
          )}
          {action && <div className="ml-auto">{action}</div>}
        </div>
      )}
      {children}
    </div>
  ),
);
SectionCard.displayName = "SectionCard";

export { SectionCard };
