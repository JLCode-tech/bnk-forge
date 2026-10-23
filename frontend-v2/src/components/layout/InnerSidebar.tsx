import React, { createContext, useContext, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface InnerSidebarContextValue {
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

const InnerSidebarContext = createContext<InnerSidebarContextValue>({
  collapsed: true,
  setCollapsed: () => {},
});

export function useInnerSidebar() {
  return useContext(InnerSidebarContext);
}

interface CollapsibleInnerSidebarProps extends React.HTMLAttributes<HTMLElement> {
  defaultCollapsed?: boolean;
  expandedWidthClass?: string;
  collapsedWidthClass?: string;
  children: React.ReactNode;
}

/**
 * CollapsibleInnerSidebar — Auto-minimizing secondary sub-sidebar.
 *
 * Behavior:
 * - Minimizes to a compact 44px (`w-11`) icon rail by default so the main
 *   page canvas gets maximum horizontal real estate.
 * - Expands smoothly (`w-52`) on mouse hover (`onMouseEnter`) or when the
 *   explicit chevron toggle button is clicked.
 * - Immediately minimizes (`w-11`) when the user selects any navigation item
 *   inside the sidebar or when the cursor leaves the sidebar (`onMouseLeave`).
 */
export function CollapsibleInnerSidebar({
  defaultCollapsed = true,
  expandedWidthClass = "w-52",
  collapsedWidthClass = "w-11",
  className,
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: CollapsibleInnerSidebarProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    setCollapsed(false);
    onMouseEnter?.(e);
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    setCollapsed(true);
    onMouseLeave?.(e);
  };

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    const button = target?.closest(
      "button, [role='tab'], a",
    ) as HTMLElement | null;
    if (
      button &&
      !button.hasAttribute("data-sidebar-toggle") &&
      !button.hasAttribute("data-sidebar-category-toggle") &&
      !button.hasAttribute("data-sidebar-keep-open") &&
      button.getAttribute("role") !== "combobox"
    ) {
      setCollapsed(true);
    }
    onClick?.(e);
  };

  return (
    <InnerSidebarContext.Provider value={{ collapsed, setCollapsed }}>
      <aside
        data-collapsed={collapsed ? "true" : "false"}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        className={cn(
          "inner-sidebar shrink-0 border-r border-border bg-card/30 font-sans transition-[width,padding] duration-200 ease-in-out",
          collapsed ? cn(collapsedWidthClass, "p-1.5 space-y-2") : className,
          !collapsed && expandedWidthClass,
        )}
        {...rest}
      >
        <div
          className={cn(
            "flex items-center border-b border-border/60 pb-1.5 mb-1",
            collapsed ? "justify-center" : "justify-end px-1",
          )}
        >
          <button
            type="button"
            data-sidebar-toggle="true"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((prev) => !prev);
            }}
            aria-label={
              collapsed ? "Expand section sidebar" : "Minimize section sidebar"
            }
            title={
              collapsed ? "Expand section sidebar" : "Minimize section sidebar"
            }
            className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
        {children}
      </aside>
    </InnerSidebarContext.Provider>
  );
}
