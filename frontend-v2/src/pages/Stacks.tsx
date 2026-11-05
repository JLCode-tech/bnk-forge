/**
 * Blueprints page — D-020 redesign.
 *
 * One coherent surface: bold heading, chip-filter row, single SectionCard
 * holding a flat table of every blueprint sorted by deployment order.
 * No in-page sidebar, no per-category color tints, no decorative gradients —
 * status conveyed by small Badge variants only.
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCard } from "@/components/ui/section-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StackDetailDialog } from "@/components/stacks/StackDetailDialog";
import { ImportedBlueprintDeployDialog } from "@/components/stacks/ImportedBlueprintDeployDialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useStackTemplates } from "@/hooks/useStacks";
import { useSetBlueprintReleaseVisibility } from "@/hooks/useBlueprintCatalog";
import { PageHeader } from "@/components/layout/PageHeader";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import { cn } from "@/lib/utils";
import { Search, Rocket, MoreVertical, Eye, EyeOff } from "lucide-react";
import {
  compareBlueprintVersions,
  DEPLOYMENT_PATTERN_LABELS,
  type DeploymentPatternKey,
  formatVariantOptionLabel,
  resolveBlueprintFamilyMeta,
  shouldAutoSuppressBlueprint,
  sortVersionsDesc,
} from "@/components/catalog/blueprintVersionUtils";
import type { StackDeployKind, StackTemplateList } from "@/types";

const INITIAL_STACKS_LIMIT = 20;

// Category labels — step number prefix gives the deployment order without
// needing a separate colorful badge.
const categoryConfig: Record<
  string,
  { step: number | null; label: string; helper: string }
> = {
  infrastructure: {
    step: 1,
    label: "Infrastructure",
    helper:
      "Provisions the base infrastructure — VPC, K8s cluster. No BNK version required.",
  },
  "bare-metal": {
    step: 1,
    label: "Bare Metal",
    helper: "Provisions DPU hardware and bootstraps K8s on bare-metal hosts.",
  },
  bnk: {
    step: 2,
    label: "Platform (BNK)",
    helper:
      "Installs the BNK platform onto an existing cluster. Check the BNK version column for compatibility.",
  },
  solution: {
    step: 3,
    label: "Solutions",
    helper:
      "Applications and demos that run on top of a deployed BNK platform.",
  },
  custom: {
    step: null,
    label: "Custom",
    helper: "User-created blueprint combinations.",
  },
};

// Provider label only — no per-cloud color, all rendered as `Badge variant="muted"`.
const providerLabels: Record<string, string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
  openshift: "OpenShift",
  ibm: "IBM",
  any: "Multi-platform",
  "bare-metal": "Bare metal",
};

// Maturity → Badge variant (status semantic, not raw palette).
const maturityConfig: Record<
  string,
  {
    label: string;
    variant: "success" | "info" | "warning" | "destructive" | "muted";
  }
> = {
  "production-ready": { label: "Production", variant: "success" },
  reference: { label: "Reference", variant: "info" },
  beta: { label: "Beta", variant: "warning" },
  alpha: { label: "Alpha", variant: "destructive" },
  experimental: { label: "Experimental", variant: "warning" },
};

const categorySortOrder: Record<string, number> = {
  infrastructure: 0,
  "bare-metal": 1,
  bnk: 2,
  solution: 3,
  custom: 4,
};

interface StackFamilyGroup {
  key: string;
  family_id: string;
  family_name: string | null;
  items: StackTemplateList[];
  defaultStack: StackTemplateList;
  bnkVersions: string[];
  variants: Array<{
    variant_key: string;
    variant_label: string;
    is_recommended: boolean;
    deployment_pattern: DeploymentPatternKey;
  }>;
}

export default function Stacks() {
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedStackSlug, setSelectedStackSlug] = useState<string>("");
  const [selectedDeployKind, setSelectedDeployKind] =
    useState<StackDeployKind>("template");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showAllStacks, setShowAllStacks] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [selectedBnkByFamily, setSelectedBnkByFamily] = useState<
    Record<string, string>
  >({});
  const [selectedVariantByFamily, setSelectedVariantByFamily] = useState<
    Record<string, string>
  >({});
  const [selectedVersionByFamily, setSelectedVersionByFamily] = useState<
    Record<string, string>
  >({});

  const {
    data: stacks,
    isLoading,
    isError,
    error,
    refetch,
  } = useStackTemplates({
    category: selectedCategory || undefined,
  });
  const visibilityMutation = useSetBlueprintReleaseVisibility();

  const allBlueprintIds = useMemo(() => {
    return new Set(
      (stacks || []).map((s) => s.blueprint_id || s.deploy_slug || s.slug),
    );
  }, [stacks]);

  const suppressedCount = useMemo(() => {
    return (stacks || []).filter((s) =>
      shouldAutoSuppressBlueprint(
        s.blueprint_id || s.deploy_slug || s.slug,
        allBlueprintIds,
      ),
    ).length;
  }, [stacks, allBlueprintIds]);

  const filteredStacks = useMemo(() => {
    return (stacks || [])
      .filter((stack) => {
        const bpId = stack.blueprint_id || stack.deploy_slug || stack.slug;
        if (!showLegacy && shouldAutoSuppressBlueprint(bpId, allBlueprintIds)) {
          return false;
        }
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const meta = resolveBlueprintFamilyMeta({
          blueprint_id: bpId,
          family_id: stack.family_id,
          family_name: stack.family_name,
          deployment_pattern: stack.deployment_pattern,
          variant_key: stack.variant_key,
          variant_label: stack.variant_label,
          is_recommended: stack.is_recommended,
          bnk_version: stack.bnk_version,
        });
        return (
          stack.name.toLowerCase().includes(q) ||
          (meta.family_name || "").toLowerCase().includes(q) ||
          meta.variant_label.toLowerCase().includes(q) ||
          stack.description?.toLowerCase().includes(q) ||
          stack.tags?.some((tag) => tag.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const orderA =
          categorySortOrder[a.category?.toLowerCase() || "custom"] ?? 99;
        const orderB =
          categorySortOrder[b.category?.toLowerCase() || "custom"] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [stacks, searchQuery, showLegacy, allBlueprintIds]);

  const stackFamilyGroups = useMemo((): StackFamilyGroup[] => {
    const grouped = new Map<string, StackTemplateList[]>();
    for (const stack of filteredStacks) {
      const bpId = stack.blueprint_id || stack.deploy_slug || stack.slug;
      const meta = resolveBlueprintFamilyMeta({
        blueprint_id: bpId,
        family_id: stack.family_id,
        family_name: stack.family_name,
        deployment_pattern: stack.deployment_pattern,
        variant_key: stack.variant_key,
        variant_label: stack.variant_label,
        is_recommended: stack.is_recommended,
        bnk_version: stack.bnk_version,
      });
      const key = meta.family_id && meta.family_name ? meta.family_id : bpId;
      const bucket = grouped.get(key) ?? [];
      bucket.push(stack);
      grouped.set(key, bucket);
    }

    const groups: StackFamilyGroup[] = [];
    for (const [key, bucket] of grouped) {
      const sorted = sortVersionsDesc(bucket, (s) => s.version || "1.0.0");
      const bnkSet = new Set<string>();
      const variantMap = new Map<
        string,
        {
          variant_key: string;
          variant_label: string;
          is_recommended: boolean;
          deployment_pattern: DeploymentPatternKey;
        }
      >();

      for (const s of sorted) {
        const bpId = s.blueprint_id || s.deploy_slug || s.slug;
        const m = resolveBlueprintFamilyMeta({
          blueprint_id: bpId,
          family_id: s.family_id,
          family_name: s.family_name,
          deployment_pattern: s.deployment_pattern,
          variant_key: s.variant_key,
          variant_label: s.variant_label,
          is_recommended: s.is_recommended,
          bnk_version: s.bnk_version,
        });
        if (m.bnk_version) bnkSet.add(m.bnk_version);
        if (!variantMap.has(m.variant_key)) {
          variantMap.set(m.variant_key, {
            variant_key: m.variant_key,
            variant_label: m.variant_label,
            is_recommended: m.is_recommended,
            deployment_pattern: m.deployment_pattern,
          });
        } else if (m.is_recommended) {
          variantMap.get(m.variant_key)!.is_recommended = true;
        }
      }

      const bnkVersions = Array.from(bnkSet).sort((a, b) =>
        compareBlueprintVersions(b, a),
      );
      const variants = Array.from(variantMap.values()).sort((a, b) => {
        if (a.is_recommended !== b.is_recommended) {
          return a.is_recommended ? -1 : 1;
        }
        return a.variant_label.localeCompare(b.variant_label);
      });

      const defaultBnk = bnkVersions[0] ?? null;
      const bnkPool = defaultBnk
        ? sorted.filter((s) => {
            const bpId = s.blueprint_id || s.deploy_slug || s.slug;
            return (
              resolveBlueprintFamilyMeta({
                blueprint_id: bpId,
                bnk_version: s.bnk_version,
              }).bnk_version === defaultBnk
            );
          })
        : sorted;
      const activePool = bnkPool.length > 0 ? bnkPool : sorted;
      const recPool = activePool.filter((s) => {
        const bpId = s.blueprint_id || s.deploy_slug || s.slug;
        return resolveBlueprintFamilyMeta({
          blueprint_id: bpId,
          is_recommended: s.is_recommended,
        }).is_recommended;
      });
      const defaultStack = recPool.length > 0 ? recPool[0] : activePool[0];
      const defaultBpId =
        defaultStack.blueprint_id ||
        defaultStack.deploy_slug ||
        defaultStack.slug;
      const defaultMeta = resolveBlueprintFamilyMeta({
        blueprint_id: defaultBpId,
        family_id: defaultStack.family_id,
        family_name: defaultStack.family_name,
      });

      groups.push({
        key,
        family_id: defaultMeta.family_id,
        family_name: defaultMeta.family_name,
        items: sorted,
        defaultStack,
        bnkVersions,
        variants,
      });
    }
    return groups;
  }, [filteredStacks]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: stacks?.length || 0 };
    stacks?.forEach((stack) => {
      const cat = stack.category?.toLowerCase() || "custom";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [stacks]);

  const limitedGroups = showAllStacks
    ? stackFamilyGroups
    : stackFamilyGroups.slice(0, INITIAL_STACKS_LIMIT);
  const hasMoreStacks = stackFamilyGroups.length > INITIAL_STACKS_LIMIT;

  const handleDeploy = (stack: StackTemplateList) => {
    const kind = stack.deploy_kind ?? "template";
    // builtin-release: open StackDetailDialog by the template slug (blueprint_id)
    // git-release: open ImportedBlueprintDeployDialog by `release-{id}` slug
    // template: open StackDetailDialog by template slug
    const slug =
      kind === "builtin-release"
        ? (stack.deploy_slug ?? stack.slug)
        : stack.slug;
    setSelectedDeployKind(kind);
    setSelectedStackSlug(slug);
    setDialogOpen(true);
  };

  const { refresh, isRefreshing } = usePageRefresh();

  const activeHelper =
    selectedCategory && categoryConfig[selectedCategory]?.helper;

  // Chips: All, then categories in deployment order (skip 0-count to keep the row calm).
  const chipKeys = [
    "all",
    ...Object.keys(categoryConfig).filter((k) => (categoryCounts[k] || 0) > 0),
  ];

  return (
    <div
      className="p-6 space-y-6 max-w-7xl mx-auto"
      data-onboarding="stacks-page"
    >
      {/* Header */}
      <PageHeader
        title="Blueprints"
        subtitle="Reusable deployment patterns. Deploy in order: infrastructure → platform → solutions."
        onRefresh={refresh}
        isRefreshing={isRefreshing}
      />

      {/* Filter chips + search */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {chipKeys.map((key) => {
              const isAll = key === "all";
              const cfg = isAll ? null : categoryConfig[key];
              const selected = isAll
                ? selectedCategory === null
                : selectedCategory === key;
              const count = categoryCounts[key] || 0;
              const label = isAll ? "All" : cfg?.label || key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(isAll ? null : key);
                    setShowAllStacks(false);
                  }}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
                    selected
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card text-muted-foreground border-border hover:text-foreground",
                  )}
                  aria-pressed={selected}
                >
                  {!isAll && cfg?.step && (
                    <span
                      className={cn(
                        "inline-flex items-center justify-center h-4 w-4 rounded-full text-[10px] font-semibold tabular-nums",
                        selected
                          ? "bg-background/20 text-background"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {cfg.step}
                    </span>
                  )}
                  <span>{label}</span>
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      selected
                        ? "text-background/70"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {suppressedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowLegacy((v) => !v)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors",
                showLegacy
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-muted-foreground border-border hover:text-foreground",
              )}
              aria-pressed={showLegacy}
            >
              {showLegacy ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
              {showLegacy
                ? `Legacy visible (${suppressedCount})`
                : `Show legacy & superseded (${suppressedCount})`}
            </button>
          )}
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search blueprints…"
            aria-label="Search blueprints"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {activeHelper && (
          <p className="text-xs text-muted-foreground">{activeHelper}</p>
        )}
      </div>

      {/* Content */}
      {isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <SectionCard>
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        </SectionCard>
      ) : stackFamilyGroups.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="No blueprints found"
          description={
            searchQuery
              ? `No blueprints match "${searchQuery}"`
              : "No blueprints available"
          }
        />
      ) : (
        <SectionCard
          title={`${stackFamilyGroups.length} ${stackFamilyGroups.length === 1 ? "blueprint" : "blueprints"}`}
          compact
        >
          <div className="overflow-x-auto -mx-4">
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow className="text-xs uppercase tracking-wider text-muted-foreground border-b-0 hover:bg-transparent">
                  <TableHead
                    scope="col"
                    className="text-left font-medium px-4 py-2 h-auto"
                  >
                    Blueprint
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-left font-medium px-4 py-2 h-auto"
                  >
                    Category
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-left font-medium px-4 py-2 h-auto"
                  >
                    BNK Version
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-left font-medium px-4 py-2 h-auto"
                  >
                    Provider
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-left font-medium px-4 py-2 h-auto"
                  >
                    Maturity
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-right font-medium px-4 py-2 w-28 h-auto"
                  >
                    {/* actions */}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {limitedGroups.map((group) => {
                  const activeBnk =
                    selectedBnkByFamily[group.key] ??
                    group.bnkVersions[0] ??
                    null;
                  const bnkPool =
                    group.bnkVersions.length > 1 && activeBnk
                      ? group.items.filter((s) => {
                          const bpId =
                            s.blueprint_id || s.deploy_slug || s.slug;
                          const m = resolveBlueprintFamilyMeta({
                            blueprint_id: bpId,
                            bnk_version: s.bnk_version,
                          });
                          return !m.bnk_version || m.bnk_version === activeBnk;
                        })
                      : group.items;
                  const effectiveBnkPool =
                    bnkPool.length > 0 ? bnkPool : group.items;

                  const variantsForBnkMap = new Map<
                    string,
                    {
                      variant_key: string;
                      variant_label: string;
                      is_recommended: boolean;
                      deployment_pattern: DeploymentPatternKey;
                    }
                  >();
                  for (const s of effectiveBnkPool) {
                    const bpId = s.blueprint_id || s.deploy_slug || s.slug;
                    const m = resolveBlueprintFamilyMeta({
                      blueprint_id: bpId,
                      family_id: s.family_id,
                      family_name: s.family_name,
                      deployment_pattern: s.deployment_pattern,
                      variant_key: s.variant_key,
                      variant_label: s.variant_label,
                      is_recommended: s.is_recommended,
                      bnk_version: s.bnk_version,
                    });
                    if (!variantsForBnkMap.has(m.variant_key)) {
                      variantsForBnkMap.set(m.variant_key, {
                        variant_key: m.variant_key,
                        variant_label: m.variant_label,
                        is_recommended: m.is_recommended,
                        deployment_pattern: m.deployment_pattern,
                      });
                    }
                  }
                  const variantsForBnk = Array.from(
                    variantsForBnkMap.values(),
                  ).sort((a, b) => {
                    if (a.is_recommended !== b.is_recommended) {
                      return a.is_recommended ? -1 : 1;
                    }
                    return a.variant_label.localeCompare(b.variant_label);
                  });

                  const preferredVariantKey =
                    selectedVariantByFamily[group.key] &&
                    variantsForBnkMap.has(selectedVariantByFamily[group.key])
                      ? selectedVariantByFamily[group.key]
                      : (variantsForBnk.find((v) => v.is_recommended)
                          ?.variant_key ?? variantsForBnk[0]?.variant_key);

                  const variantPool = preferredVariantKey
                    ? effectiveBnkPool.filter((s) => {
                        const bpId = s.blueprint_id || s.deploy_slug || s.slug;
                        return (
                          resolveBlueprintFamilyMeta({
                            blueprint_id: bpId,
                            family_id: s.family_id,
                            family_name: s.family_name,
                            deployment_pattern: s.deployment_pattern,
                            variant_key: s.variant_key,
                            variant_label: s.variant_label,
                            is_recommended: s.is_recommended,
                            bnk_version: s.bnk_version,
                          }).variant_key === preferredVariantKey
                        );
                      })
                    : effectiveBnkPool;
                  const activeVariantPool =
                    variantPool.length > 0 ? variantPool : effectiveBnkPool;
                  const selectableVersions = sortVersionsDesc(
                    activeVariantPool,
                    (s) => s.version || "1.0.0",
                  );
                  const selectedVer = selectedVersionByFamily[group.key];
                  const stack =
                    (selectedVer &&
                      selectableVersions.find(
                        (s) => (s.version || "1.0.0") === selectedVer,
                      )) ||
                    selectableVersions[0] ||
                    effectiveBnkPool[0];

                  const bpId =
                    stack.blueprint_id || stack.deploy_slug || stack.slug;
                  const activeMeta = resolveBlueprintFamilyMeta({
                    blueprint_id: bpId,
                    family_id: stack.family_id,
                    family_name: stack.family_name,
                    deployment_pattern: stack.deployment_pattern,
                    variant_key: stack.variant_key,
                    variant_label: stack.variant_label,
                    is_recommended: stack.is_recommended,
                    bnk_version: stack.bnk_version,
                  });
                  const hasMulti =
                    group.bnkVersions.length > 1 || group.variants.length > 1;
                  const displayTitle = hasMulti
                    ? group.family_name || stack.name
                    : stack.name;

                  const categoryKey = (
                    stack.category || "custom"
                  ).toLowerCase();
                  const category = categoryConfig[categoryKey];
                  const providerKey =
                    stack.cloud_provider?.toLowerCase() || "any";
                  const providerLabel =
                    providerLabels[providerKey] || providerKey;
                  const maturity = stack.maturity
                    ? maturityConfig[stack.maturity]
                    : null;

                  return (
                    <TableRow
                      key={group.key}
                      className="border-t border-border cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => handleDeploy(stack)}
                    >
                      <TableCell className="px-4 py-3">
                        <div className="flex flex-col">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">
                              {displayTitle}
                            </span>
                            {stack.version && (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                v{stack.version}
                              </span>
                            )}
                            <Badge
                              variant="outline"
                              className="text-[10px] text-muted-foreground"
                            >
                              {
                                DEPLOYMENT_PATTERN_LABELS[
                                  activeMeta.deployment_pattern
                                ]
                              }
                            </Badge>
                            {stack.source_kind === "blueprint_release" && (
                              <Badge variant="muted" className="text-[10px]">
                                Catalog
                              </Badge>
                            )}
                          </div>
                          {stack.description && (
                            <span className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {stack.description}
                            </span>
                          )}
                          {(group.bnkVersions.length > 1 ||
                            variantsForBnk.length > 1 ||
                            selectableVersions.length > 1) && (
                            <div
                              className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {group.bnkVersions.length > 1 && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                                    BNK:
                                  </span>
                                  <div className="inline-flex rounded-md border border-border bg-card p-0.5">
                                    {group.bnkVersions.map((bnkVer, idx) => {
                                      const selected = activeBnk === bnkVer;
                                      return (
                                        <button
                                          key={bnkVer}
                                          type="button"
                                          onClick={() => {
                                            setSelectedBnkByFamily((prev) => ({
                                              ...prev,
                                              [group.key]: bnkVer,
                                            }));
                                            setSelectedVersionByFamily(
                                              (prev) => {
                                                if (!(group.key in prev))
                                                  return prev;
                                                const next = { ...prev };
                                                delete next[group.key];
                                                return next;
                                              },
                                            );
                                          }}
                                          className={cn(
                                            "rounded px-2 py-0.5 text-xs font-mono transition-colors",
                                            selected
                                              ? "bg-primary text-primary-foreground font-semibold"
                                              : "text-muted-foreground hover:text-foreground",
                                          )}
                                        >
                                          {bnkVer}
                                          {idx === 0 ? " (Latest)" : ""}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              {variantsForBnk.length > 1 && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                                    Topology:
                                  </span>
                                  <Select
                                    value={preferredVariantKey || ""}
                                    onValueChange={(nextVariant) => {
                                      setSelectedVariantByFamily((prev) => ({
                                        ...prev,
                                        [group.key]: nextVariant,
                                      }));
                                      setSelectedVersionByFamily((prev) => {
                                        if (!(group.key in prev)) return prev;
                                        const next = { ...prev };
                                        delete next[group.key];
                                        return next;
                                      });
                                    }}
                                  >
                                    <SelectTrigger
                                      aria-label={`Topology variant for ${displayTitle}`}
                                      className="h-6 w-auto gap-1 rounded border border-border bg-card px-2 py-0 text-xs text-foreground focus:ring-1 focus:ring-primary"
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {variantsForBnk.map((v) => (
                                        <SelectItem
                                          key={v.variant_key}
                                          value={v.variant_key}
                                          className="text-xs"
                                        >
                                          {formatVariantOptionLabel(
                                            v.variant_label,
                                            v.is_recommended,
                                          )}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              {selectableVersions.length > 1 && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                                    Version:
                                  </span>
                                  <Select
                                    value={stack.version || "1.0.0"}
                                    onValueChange={(val) =>
                                      setSelectedVersionByFamily((prev) => ({
                                        ...prev,
                                        [group.key]: val,
                                      }))
                                    }
                                  >
                                    <SelectTrigger
                                      aria-label={`Blueprint version for ${displayTitle}`}
                                      className="h-6 w-auto gap-1 rounded border border-border bg-card px-2 py-0 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {selectableVersions.map((s, idx) => (
                                        <SelectItem
                                          key={s.slug}
                                          value={s.version || "1.0.0"}
                                          className="text-xs font-mono"
                                        >
                                          {s.version || "1.0.0"}
                                          {idx === 0 ? " (Latest)" : ""}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        {category ? (
                          <span className="inline-flex items-center gap-1.5 text-sm text-foreground/80">
                            {category.step && (
                              <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground">
                                {category.step}
                              </span>
                            )}
                            {category.label}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        {activeMeta.bnk_version || stack.bnk_version ? (
                          <span className="text-sm font-mono text-foreground/80">
                            BNK {activeMeta.bnk_version || stack.bnk_version}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">
                          {providerLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        {maturity ? (
                          <Badge variant={maturity.variant} className="text-xs">
                            {maturity.label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeploy(stack);
                            }}
                          >
                            Deploy
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              asChild
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                aria-label="Blueprint actions"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeploy(stack);
                                }}
                              >
                                <Eye className="h-4 w-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              {stack.blueprint_release_id != null && (
                                <DropdownMenuItem
                                  disabled={visibilityMutation.isPending}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    visibilityMutation.mutate({
                                      releaseId: stack.blueprint_release_id!,
                                      isVisible: false,
                                    });
                                  }}
                                >
                                  <EyeOff className="h-4 w-4 mr-2" />
                                  Hide from Blueprints
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {!showAllStacks && hasMoreStacks && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllStacks(true)}
              >
                Show {stackFamilyGroups.length - INITIAL_STACKS_LIMIT} more
              </Button>
            </div>
          )}
          {showAllStacks && hasMoreStacks && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllStacks(false)}
              >
                Show less
              </Button>
            </div>
          )}
        </SectionCard>
      )}

      {/* Deploy routing:
          - builtin-release: opens StackDetailDialog by the template slug (blueprint_id),
            giving full region/bare-metal/prereq/optional-module support.
          - git-release: opens ImportedBlueprintDeployDialog by `release-{id}` slug.
          - template (no matching release): opens StackDetailDialog by template slug. */}
      {selectedDeployKind === "git-release" ? (
        <ImportedBlueprintDeployDialog
          slug={selectedStackSlug}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={(projectId) => navigate(`/projects/${projectId}`)}
        />
      ) : (
        <StackDetailDialog
          slug={selectedStackSlug}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={(projectId) => navigate(`/projects/${projectId}`)}
        />
      )}
    </div>
  );
}
