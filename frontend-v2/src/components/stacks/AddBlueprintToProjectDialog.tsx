import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStackTemplates } from "@/hooks/useStacks";
import { StackDetailDialog } from "@/components/stacks/StackDetailDialog";
import { ImportedBlueprintDeployDialog } from "@/components/stacks/ImportedBlueprintDeployDialog";
import { Eye, EyeOff, Layers, Loader2, Rocket, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BLUEPRINT_PROVIDER_LABELS,
  BLUEPRINT_PROVIDER_OPTIONS,
  compareBlueprintVersions,
  DEPLOYMENT_PATTERN_LABELS,
  DEPLOYMENT_PATTERN_OPTIONS,
  formatVariantOptionLabel,
  normalizeBlueprintCloudProvider,
  resolveBlueprintFamilyMeta,
  shouldAutoSuppressBlueprint,
  sortVersionsDesc,
  type BlueprintProviderKey,
  type DeploymentPatternKey,
} from "@/components/catalog/blueprintVersionUtils";
import type { StackDeployKind, StackTemplateList } from "@/types";

interface AddBlueprintToProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectCloudProvider?: string | null;
  onSuccess?: () => void;
}

const categoryLabels: Record<string, string> = {
  infrastructure: "Infrastructure",
  "bare-metal": "Bare Metal & DPU",
  bnk: "Platform (BNK)",
  solution: "Solutions",
  custom: "Custom",
};

interface BlueprintDialogFamilyGroup {
  key: string;
  family_id: string;
  family_name: string;
  items: StackTemplateList[];
  bnkVersions: string[];
  variants: Array<{
    variant_key: string;
    variant_label: string;
    is_recommended: boolean;
    deployment_pattern: DeploymentPatternKey;
  }>;
}

export function AddBlueprintToProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectCloudProvider,
  onSuccess,
}: AddBlueprintToProjectDialogProps) {
  const { data: stacks, isLoading } = useStackTemplates();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] =
    useState<BlueprintProviderKey>("all");
  const [selectedPattern, setSelectedPattern] = useState<
    "all" | DeploymentPatternKey
  >("all");
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
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [selectedDeployKind, setSelectedDeployKind] =
    useState<StackDeployKind>("template");
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setSelectedProvider("all");
      setSelectedPattern("all");
    }
  }, [open]);

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

  const baseVisibleStacks = useMemo(() => {
    const list = stacks || [];
    return list.filter((s) => {
      const bpId = s.blueprint_id || s.deploy_slug || s.slug;
      if (!showLegacy && shouldAutoSuppressBlueprint(bpId, allBlueprintIds)) {
        return false;
      }
      return true;
    });
  }, [stacks, showLegacy, allBlueprintIds]);

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: baseVisibleStacks.length };
    for (const s of baseVisibleStacks) {
      const bpId = s.blueprint_id || s.deploy_slug || s.slug;
      const pk = normalizeBlueprintCloudProvider({
        blueprint_id: bpId,
        cloud_provider: s.cloud_provider,
        category: s.category,
      });
      counts[pk] = (counts[pk] || 0) + 1;
    }
    return counts;
  }, [baseVisibleStacks]);

  const filteredStacks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return baseVisibleStacks.filter((s) => {
      const bpId = s.blueprint_id || s.deploy_slug || s.slug;
      const pk = normalizeBlueprintCloudProvider({
        blueprint_id: bpId,
        cloud_provider: s.cloud_provider,
        category: s.category,
      });
      if (selectedProvider !== "all" && pk !== selectedProvider) {
        return false;
      }
      const meta = resolveBlueprintFamilyMeta({
        blueprint_id: bpId,
        family_id: s.family_id,
        family_name: s.family_name,
        deployment_pattern: s.deployment_pattern,
        variant_key: s.variant_key,
        variant_label: s.variant_label,
        is_recommended: s.is_recommended,
        bnk_version: s.bnk_version,
      });
      if (
        selectedPattern !== "all" &&
        meta.deployment_pattern !== selectedPattern
      ) {
        return false;
      }
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (meta.family_name || "").toLowerCase().includes(q) ||
        meta.variant_label.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.category || "").toLowerCase().includes(q)
      );
    });
  }, [baseVisibleStacks, searchQuery, selectedProvider, selectedPattern]);

  const familyGroups = useMemo((): BlueprintDialogFamilyGroup[] => {
    const grouped = new Map<string, StackTemplateList[]>();
    for (const s of filteredStacks) {
      const bpId = s.blueprint_id || s.deploy_slug || s.slug;
      const meta = resolveBlueprintFamilyMeta({
        blueprint_id: bpId,
        family_id: s.family_id,
        family_name: s.family_name,
        deployment_pattern: s.deployment_pattern,
        variant_key: s.variant_key,
        variant_label: s.variant_label,
        is_recommended: s.is_recommended,
        bnk_version: s.bnk_version,
      });
      const key = meta.family_id && meta.family_name ? meta.family_id : bpId;
      const bucket = grouped.get(key) ?? [];
      bucket.push(s);
      grouped.set(key, bucket);
    }

    const groups: BlueprintDialogFamilyGroup[] = [];
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
      const first = sorted[0];
      const firstBpId = first.blueprint_id || first.deploy_slug || first.slug;
      const firstMeta = resolveBlueprintFamilyMeta({
        blueprint_id: firstBpId,
        family_id: first.family_id,
        family_name: first.family_name,
      });
      groups.push({
        key,
        family_id: firstMeta.family_id,
        family_name: firstMeta.family_name,
        items: sorted,
        bnkVersions,
        variants,
      });
    }
    return groups;
  }, [filteredStacks]);

  const handleSelectBlueprint = (stack: StackTemplateList) => {
    const kind = stack.deploy_kind ?? "template";
    const slug =
      kind === "builtin-release"
        ? (stack.deploy_slug ?? stack.slug)
        : stack.slug;
    setSelectedSlug(slug);
    setSelectedDeployKind(kind);
    onOpenChange(false);
    setDeployDialogOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Add Blueprint to Workspace
            </DialogTitle>
            <DialogDescription>
              Select a blueprint family, BNK release, and topology variant to
              configure and deploy into this workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search blueprints by name, cloud, or topology..."
                  aria-label="Search blueprints"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              {projectCloudProvider &&
                providerCounts[projectCloudProvider.toLowerCase()] > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      selectedProvider === projectCloudProvider.toLowerCase()
                        ? "default"
                        : "outline"
                    }
                    className="h-9 text-xs shrink-0"
                    onClick={() =>
                      setSelectedProvider((prev) =>
                        prev === projectCloudProvider.toLowerCase()
                          ? "all"
                          : (projectCloudProvider.toLowerCase() as BlueprintProviderKey),
                      )
                    }
                  >
                    Workspace Cloud:{" "}
                    {BLUEPRINT_PROVIDER_LABELS[
                      projectCloudProvider.toLowerCase()
                    ] || projectCloudProvider.toUpperCase()}
                  </Button>
                )}
              {suppressedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLegacy((v) => !v)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors shrink-0",
                    showLegacy
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card text-muted-foreground border-border hover:text-foreground",
                  )}
                  aria-pressed={showLegacy}
                >
                  {showLegacy ? (
                    <Eye className="h-3 w-3" />
                  ) : (
                    <EyeOff className="h-3 w-3" />
                  )}
                  {showLegacy
                    ? `Legacy (${suppressedCount})`
                    : `Show legacy (${suppressedCount})`}
                </button>
              )}
            </div>

            {/* Cloud Provider filter pills */}
            <div
              className="flex flex-wrap items-center gap-1"
              role="group"
              aria-label="Filter blueprints by cloud provider"
            >
              {BLUEPRINT_PROVIDER_OPTIONS.map((opt) => {
                const count = providerCounts[opt.key] || 0;
                if (opt.key !== "all" && count === 0) return null;
                const active = selectedProvider === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() =>
                      setSelectedProvider(opt.key as BlueprintProviderKey)
                    }
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:text-foreground",
                    )}
                  >
                    <span>{opt.label}</span>
                    <span
                      className={cn(
                        "rounded-full px-1 text-[10px] tabular-nums",
                        active
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Architecture Pattern filter pills */}
            <div
              className="flex flex-wrap items-center gap-1"
              role="group"
              aria-label="Filter blueprints by deployment pattern"
            >
              {DEPLOYMENT_PATTERN_OPTIONS.map((opt) => {
                const active = selectedPattern === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedPattern(opt.value)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                      active
                        ? "bg-foreground text-background border-foreground"
                        : "bg-card text-muted-foreground border-border hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <ScrollArea className="flex-1 max-h-[420px] pr-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading blueprints...</span>
              </div>
            ) : familyGroups.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Rocket className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">No blueprints found</p>
                {searchQuery && (
                  <p className="text-xs mt-1">
                    No blueprints match &quot;{searchQuery}&quot;
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2.5 py-1">
                {familyGroups.map((group) => {
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
                  const categoryLabel =
                    categoryLabels[categoryKey] || categoryKey;
                  const providerKey = normalizeBlueprintCloudProvider({
                    blueprint_id: bpId,
                    cloud_provider: stack.cloud_provider,
                    category: stack.category,
                  });
                  const providerLabel =
                    BLUEPRINT_PROVIDER_LABELS[providerKey] || providerKey;
                  return (
                    <div
                      key={group.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectBlueprint(stack)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelectBlueprint(stack);
                        }
                      }}
                      className={cn(
                        "flex items-start justify-between gap-4 rounded-lg border p-3.5 hover:bg-muted/50 transition-colors cursor-pointer text-left",
                        activeMeta.is_recommended
                          ? "border-primary/35 bg-card/80"
                          : "border-border",
                      )}
                    >
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-foreground">
                            {displayTitle}
                          </span>
                          {stack.version && (
                            <Badge variant="outline" className="text-[11px]">
                              v{stack.version}
                            </Badge>
                          )}
                          {(activeMeta.bnk_version || stack.bnk_version) && (
                            <Badge variant="info" className="text-[11px]">
                              BNK {activeMeta.bnk_version || stack.bnk_version}
                            </Badge>
                          )}
                          {activeMeta.is_recommended && (
                            <Badge
                              variant="outline"
                              className="border-warning/40 bg-warning/10 text-warning text-[10px]"
                            >
                              ★ Recommended
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {
                              DEPLOYMENT_PATTERN_LABELS[
                                activeMeta.deployment_pattern
                              ]
                            }
                          </Badge>
                          {providerLabel && (
                            <Badge variant="muted" className="text-[11px]">
                              {providerLabel}
                            </Badge>
                          )}
                          <Badge variant="muted" className="text-[11px]">
                            {categoryLabel}
                          </Badge>
                          {(stack.module_count ?? 0) > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              {stack.module_count} module
                              {stack.module_count === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                        {stack.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {stack.description}
                          </p>
                        )}
                        {(group.bnkVersions.length > 1 ||
                          variantsForBnk.length > 1 ||
                          selectableVersions.length > 1) && (
                          <div
                            className="mt-1.5 flex flex-wrap items-center gap-2.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {group.bnkVersions.length > 1 && (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                  BNK:
                                </span>
                                <div className="inline-flex rounded border border-border bg-card p-0.5">
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
                                          setSelectedVersionByFamily((prev) => {
                                            if (!(group.key in prev))
                                              return prev;
                                            const next = { ...prev };
                                            delete next[group.key];
                                            return next;
                                          });
                                        }}
                                        className={cn(
                                          "rounded px-1.5 py-0.5 text-[11px] font-mono transition-colors",
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
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
                                    className="h-6 w-auto gap-1 rounded border border-border bg-card px-1.5 py-0 text-xs text-foreground focus:ring-1 focus:ring-primary"
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
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
                                    className="h-6 w-auto gap-1 rounded border border-border bg-card px-1.5 py-0 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
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
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectBlueprint(stack);
                        }}
                      >
                        Select
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedDeployKind === "git-release" ? (
        <ImportedBlueprintDeployDialog
          slug={selectedSlug}
          open={deployDialogOpen}
          onOpenChange={setDeployDialogOpen}
          initialProjectId={projectId}
          onSuccess={() => {
            setDeployDialogOpen(false);
            onSuccess?.();
          }}
        />
      ) : (
        <StackDetailDialog
          slug={selectedSlug}
          open={deployDialogOpen}
          onOpenChange={setDeployDialogOpen}
          initialProjectId={projectId}
          onSuccess={() => {
            setDeployDialogOpen(false);
            onSuccess?.();
          }}
        />
      )}
    </>
  );
}
