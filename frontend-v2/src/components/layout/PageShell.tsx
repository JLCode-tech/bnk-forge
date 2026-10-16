import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: "default" | "full";
  children: React.ReactNode;
  className?: string;
}

/**
 * PageShell — Standard layout container for non-resource-explorer pages.
 *
 * Enforces uniform padding and maximum width (`p-6 space-y-6 max-w-7xl mx-auto`),
 * aligning the page content with the standard 1344px main viewport and ensuring
 * titles, cards, and content begin at standard margins.
 *
 * For full-bleed views or sub-containers requiring unconstrained width, pass `width="full"`.
 */
export function PageShell({
  width = "default",
  children,
  className,
  ...props
}: PageShellProps) {
  return (
    <div
      className={cn(
        "p-6 space-y-6",
        width === "full" ? "w-full" : "max-w-7xl mx-auto",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
