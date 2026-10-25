/**
 * ResourceCategorySidebar — the single in-page category-navigation idiom shared
 * by the three resource-explorer pages (Kubernetes, F5 BNK, CNF).
 *
 * D-020 Option A: a *quiet* sidebar. It recedes so the content + detail panel
 * are the visual focus. No card background, no tinted/bordered selection — the
 * selected item is just `text-primary font-medium`. Category headers are small
 * uppercase eyebrow labels. Per-item decorations (status dot, count, tag) are
 * optional so each page maps its own data onto one consistent shape.
 */

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useInnerSidebar } from "@/components/layout/inner-sidebar-context";

export interface ResourceCategoryItem {
  key: string;
  label: string;
  icon?: React.ElementType;
  /** Small status dot color class, e.g. 'bg-success' / 'bg-destructive'. */
  dotColor?: string;
  /** Numeric count rendered quietly on the right. */
  count?: number;
  /** Render a loading shimmer instead of a count. */
  countLoading?: boolean;
  /** Small text tag, e.g. 'curated'. */
  tag?: string;
  /** Native title/tooltip. */
  title?: string;
}

export interface ResourceCategoryGroup {
  category: string;
  icon?: React.ElementType;
  items: ResourceCategoryItem[];
  /** Optional count shown faintly in the category header. */
  count?: number;
}

export interface ResourceSidebarViewTab {
  key: string;
  label: string;
  icon?: React.ElementType;
  title?: string;
  disabled?: boolean;
  badge?: ReactNode;
}

interface ResourceSidebarViewTabsProps {
  tabs: ResourceSidebarViewTab[];
  active: string;
  onChange: (key: string) => void;
  sectionLabel?: string;
  "aria-label"?: string;
  className?: string;
}

/**
 * Vertical view switcher rendered at the top of the persistent flush left inner
 * sub-sidebar on resource-explorer pages (Kubernetes, F5 BNK, F5 CNF).
 */
export function ResourceSidebarViewTabs({
  tabs,
  active,
  onChange,
  sectionLabel = "VIEWS",
  "aria-label": ariaLabel = "View mode",
  className,
}: ResourceSidebarViewTabsProps) {
  const { collapsed } = useInnerSidebar();

  return (
    <div
      data-testid="resource-view-tabs"
      className={cn(
        "border-b border-border/60",
        collapsed ? "p-1 space-y-0.5" : "p-2 space-y-1",
        className,
      )}
    >
      <div
        className={cn(
          "px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground",
          collapsed && "sr-only",
        )}
      >
        {sectionLabel}
      </div>
      <div
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="vertical"
        className="flex flex-col gap-0.5"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              data-sidebar-keep-open="true"
              aria-selected={isActive}
              aria-disabled={tab.disabled}
              disabled={tab.disabled}
              title={tab.title ?? tab.label}
              onClick={() => !tab.disabled && onChange(tab.key)}
              className={cn(
                "flex w-full items-center rounded font-sans text-xs font-medium transition-colors",
                collapsed ? "justify-center p-1.5" : "gap-2 px-2.5 py-1.5",
                tab.disabled
                  ? "cursor-not-allowed text-muted-foreground/40"
                  : isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              {Icon && (
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span
                className={cn(
                  "flex-1 truncate text-left",
                  collapsed && "sr-only",
                )}
              >
                {tab.label}
              </span>
              {!collapsed && tab.badge && (
                <span className="shrink-0">{tab.badge}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ResourceCategorySidebarProps {
  groups: ResourceCategoryGroup[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  expandedCategories: string[];
  onToggleCategory: (category: string) => void;
  /** Optional content rendered above the category list (e.g. a hint card). */
  header?: ReactNode;
  /**
   * Render items as one flat list without the collapsible eyebrow group
   * headers. Used when a parent tab already names the active category
   * (F5 BNK), so the group header would be redundant. expandedCategories /
   * onToggleCategory are ignored in this mode.
   */
  hideGroupHeaders?: boolean;
  /** Tailwind width class when expanded. Default: 'w-full'. */
  width?: string;
  className?: string;
  "aria-label"?: string;
}

export function ResourceCategorySidebar({
  groups,
  selectedKey,
  onSelect,
  expandedCategories,
  onToggleCategory,
  header,
  hideGroupHeaders = false,
  width = "w-full",
  className,
  "aria-label": ariaLabel = "Resource categories",
}: ResourceCategorySidebarProps) {
  const { collapsed } = useInnerSidebar();

  const renderItem = (item: ResourceCategoryItem) => {
    const ItemIcon = item.icon;
    const isSelected = selectedKey === item.key;

    return (
      <button
        key={item.key}
        onClick={() => onSelect(item.key)}
        title={item.title ?? item.label}
        className={cn(
          "flex w-full items-center rounded font-sans transition-colors",
          collapsed ? "justify-center p-1.5" : "gap-2 px-2 py-1.5 text-xs",
          isSelected
            ? "font-medium text-primary bg-primary/5"
            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        )}
      >
        {ItemIcon ? (
          <ItemIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        ) : (
          collapsed && (
            <span className="text-2xs font-semibold uppercase">
              {item.label.charAt(0)}
            </span>
          )
        )}
        <span
          className={cn("flex-1 truncate text-left", collapsed && "sr-only")}
        >
          {item.label}
        </span>
        {!collapsed && item.dotColor && (
          <span
            className={cn("h-2 w-2 flex-shrink-0 rounded-full", item.dotColor)}
            aria-hidden="true"
          />
        )}
        {!collapsed && item.tag && (
          <Badge variant="outline" className="h-4 px-1 text-2xs">
            {item.tag}
          </Badge>
        )}
        {!collapsed &&
          (item.count !== undefined ? (
            <span className="min-w-[1.25rem] text-right text-2xs tabular-nums text-muted-foreground/70">
              {item.count}
            </span>
          ) : item.countLoading ? (
            <span className="h-1 w-5 animate-pulse rounded bg-muted-foreground/20" />
          ) : null)}
      </button>
    );
  };

  if (hideGroupHeaders) {
    return (
      <div
        role="region"
        aria-label={ariaLabel}
        className={cn(
          collapsed ? "sr-only" : width,
          "flex-1 overflow-y-auto bg-transparent transition-all duration-200",
          className,
        )}
      >
        {header && (
          <div className={cn("p-2.5 pb-0", collapsed && "sr-only")}>
            {header}
          </div>
        )}
        <nav className={cn("space-y-0.5", collapsed ? "p-1" : "p-2")}>
          {groups.flatMap((group) => group.items).map(renderItem)}
        </nav>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={ariaLabel}
      className={cn(
        collapsed ? "sr-only" : width,
        "flex-1 overflow-y-auto bg-transparent transition-all duration-200",
        className,
      )}
    >
      {header && (
        <div className={cn("p-2.5 pb-0", collapsed && "sr-only")}>{header}</div>
      )}

      <nav className={cn(collapsed ? "space-y-1 p-1" : "space-y-2.5 p-2")}>
        {groups.map((group) => {
          const expanded = expandedCategories.includes(group.category);
          const GroupIcon = group.icon;
          const slug = group.category.toLowerCase().replace(/\s+/g, "-");

          return (
            <div key={group.category}>
              <button
                type="button"
                data-sidebar-category-toggle="true"
                onClick={() => onToggleCategory(group.category)}
                aria-expanded={expanded}
                aria-controls={`rcs-group-${slug}`}
                className={cn(
                  "flex w-full items-center gap-1.5 px-1 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-muted-foreground",
                  collapsed && "sr-only",
                )}
              >
                {expanded ? (
                  <ChevronDown
                    className="h-3 w-3 flex-shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className="h-3 w-3 flex-shrink-0"
                    aria-hidden="true"
                  />
                )}
                {GroupIcon && (
                  <GroupIcon
                    className="h-3.5 w-3.5 flex-shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="flex-1 truncate text-left">
                  {group.category}
                </span>
                {group.count !== undefined && (
                  <span className="text-2xs font-normal tabular-nums">
                    {group.count}
                  </span>
                )}
              </button>

              {expanded && (
                <div
                  id={`rcs-group-${slug}`}
                  className={cn(!collapsed && "mt-0.5", "space-y-0.5")}
                >
                  {group.items.map(renderItem)}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
