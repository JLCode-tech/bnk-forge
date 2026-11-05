import { Fragment, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { blueprintSourceSchema, type BlueprintSourceFormData } from "@/schemas";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Edit2,
  Eye,
  EyeOff,
  Filter,
  GitBranch,
  Layers,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Tag,
  Trash2,
  XCircle,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
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
import { Switch } from "@/components/ui/switch";
import { ImportedBlueprintDeployDialog } from "@/components/stacks/ImportedBlueprintDeployDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useBlueprintReleases,
  useBlueprintSources,
  useCreateBlueprintSource,
  useDeleteBlueprintRelease,
  useDeleteBlueprintSource,
  useImportBlueprintRelease,
  useSetBlueprintReleaseVisibility,
  useSyncBlueprintSource,
  useUnimportBlueprintRelease,
  useUpdateBlueprintSource,
} from "@/hooks/useBlueprintCatalog";
import { notify } from "@/lib/notify";
import { queryKeys } from "@/lib/queryKeys";
import { formatAge } from "@/lib/time-utils";
import { cn } from "@/lib/utils";
import {
  compareBlueprintVersions,
  DEPLOYMENT_PATTERN_LABELS,
  type DeploymentPatternKey,
  formatVariantOptionLabel,
  isCanonicalBlueprintId,
  normalizeBlueprintCloudProvider,
  resolveBlueprintFamilyMeta,
  shouldAutoSuppressBlueprint,
  sortVersionsDesc,
} from "./blueprintVersionUtils";
import type {
  BlueprintRelease,
  BlueprintSource,
  BlueprintSourceCreate,
  BlueprintSourceUpdate,
} from "@/types";

const DEPLOYMENT_PATTERN_OPTIONS: Array<{
  value: "all" | DeploymentPatternKey;
  label: string;
}> = [
  { value: "all", label: "All Patterns" },
  { value: "full-stack", label: DEPLOYMENT_PATTERN_LABELS["full-stack"] },
  {
    value: "existing-cluster",
    label: DEPLOYMENT_PATTERN_LABELS["existing-cluster"],
  },
  { value: "infra-only", label: DEPLOYMENT_PATTERN_LABELS["infra-only"] },
  { value: "demo-workload", label: DEPLOYMENT_PATTERN_LABELS["demo-workload"] },
];

const PLATFORM_OPTIONS = [
  { value: "all", label: "All Clouds" },
  { value: "aws", label: "AWS" },
  { value: "ibm", label: "IBM Cloud" },
  { value: "bare-metal", label: "Bare Metal / DPU" },
  { value: "azure", label: "Azure" },
  { value: "gcp", label: "GCP" },
  { value: "openshift", label: "OpenShift" },
  { value: "kubernetes", label: "Multi-Platform / K8s" },
  { value: "docker", label: "Docker / Local" },
];

const PATTERN_SORT_ORDER: Record<DeploymentPatternKey, number> = {
  "full-stack": 1,
  "existing-cluster": 2,
  "infra-only": 3,
  "demo-workload": 4,
};

const PROVIDER_BADGE_STYLES: Record<
  string,
  { label: string; className: string }
> = {
  aws: {
    label: "AWS",
    className:
      "border-warning/40 bg-warning/10 text-warning font-semibold",
  },
  ibm: {
    label: "IBM CLOUD",
    className: "border-info/40 bg-info/10 text-info font-semibold",
  },
  azure: {
    label: "AZURE",
    className: "border-info/40 bg-info/10 text-info font-semibold",
  },
  gcp: {
    label: "GCP",
    className:
      "border-success/40 bg-success/10 text-success font-semibold",
  },
  openshift: {
    label: "OPENSHIFT",
    className: "border-destructive/40 bg-destructive/10 text-destructive font-semibold",
  },
  "bare-metal": {
    label: "BARE METAL / DPU",
    className:
      "border-primary/40 bg-primary/10 text-primary font-semibold",
  },
  kubernetes: {
    label: "MULTI-PLATFORM / K8S",
    className: "border-info/40 bg-info/10 text-info font-semibold",
  },
  docker: {
    label: "DOCKER / LOCAL",
    className:
      "border-border bg-muted/40 text-muted-foreground font-semibold",
  },
};

const VALIDATION_OPTIONS = [
  { value: "all", label: "Any Validation" },
  { value: "valid", label: "Valid" },
  { value: "invalid", label: "Invalid" },
  { value: "unknown", label: "Unknown" },
];

const RELEASE_STATE_OPTIONS = [
  { value: "all", label: "Any State" },
  { value: "discovered", label: "Discovered" },
  { value: "imported", label: "Imported" },
  { value: "approved", label: "Approved" },
  { value: "deprecated", label: "Deprecated" },
];

/** A release counts as "removed from deployable catalog" when discovered + removed reason. */
function isRemovedRelease(release: BlueprintRelease): boolean {
  return (
    release.release_state === "discovered" &&
    release.state_reason === "Removed from deployable catalog"
  );
}

function statusIcon(status: string) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "syncing":
      return <Loader2 className="h-4 w-4 animate-spin text-info" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusBadge(status: string) {
  const variants: Record<
    string,
    "success" | "destructive" | "info" | "muted" | "outline"
  > = {
    success: "success",
    failed: "destructive",
    syncing: "info",
    pending: "muted",
  };
  return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
}

function sourceTypeIcon(sourceType: BlueprintSource["source_type"]) {
  if (sourceType === "git") {
    return <GitBranch className="h-4 w-4 text-info" />;
  }
  return <Layers className="h-4 w-4 text-muted-foreground" />;
}

function releaseStateBadge(state: string) {
  const variant: "success" | "muted" | "destructive" | "info" | "outline" =
    state === "approved"
      ? "success"
      : state === "deprecated"
        ? "destructive"
        : state === "imported"
          ? "info"
          : "muted";
  return <Badge variant={variant}>{state}</Badge>;
}

export interface BlueprintVariantOption {
  variant_key: string;
  variant_label: string;
  is_recommended: boolean;
  deployment_pattern: DeploymentPatternKey;
}

/** A canonical family group of blueprint releases. */
interface BlueprintGroup {
  key: string;
  family_id: string;
  family_name: string | null;
  deployment_pattern: DeploymentPatternKey;
  blueprint_id: string;
  blueprint_source_id: number;
  /** All versions sorted newest-first (after "removed" filter applied upstream). */
  versions: BlueprintRelease[];
  /** Default primary candidate to show as the card's face. */
  latest: BlueprintRelease;
  /** Distinct normalized BNK versions available in this family (e.g. ['2.4.1', '2.3']). */
  bnkVersions: string[];
  /** Distinct topology variants available in this family. */
  variants: BlueprintVariantOption[];
}

export default function BlueprintCatalogPanel() {
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [validationFilter, setValidationFilter] = useState("all");
  const [releaseStateFilter, setReleaseStateFilter] = useState("all");
  const [deploymentPatternFilter, setDeploymentPatternFilter] = useState<
    "all" | DeploymentPatternKey
  >("all");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [showRemoved, setShowRemoved] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [latestOnly, setLatestOnly] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [sourceToDelete, setSourceToDelete] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [releaseToDelete, setReleaseToDelete] =
    useState<BlueprintRelease | null>(null);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [deployReleaseSlug, setDeployReleaseSlug] = useState<string>("");
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);

  const { data: sources, isLoading: sourcesLoading } = useBlueprintSources();
  const { data: releases, isLoading: releasesLoading } = useBlueprintReleases();
  const createMutation = useCreateBlueprintSource();
  const updateMutation = useUpdateBlueprintSource();
  const syncMutation = useSyncBlueprintSource();
  const deleteSourceMutation = useDeleteBlueprintSource();
  const importMutation = useImportBlueprintRelease();
  const deleteReleaseMutation = useDeleteBlueprintRelease();
  const unimportMutation = useUnimportBlueprintRelease();
  const visibilityMutation = useSetBlueprintReleaseVisibility();
  const [releaseToUnimport, setReleaseToUnimport] =
    useState<BlueprintRelease | null>(null);
  const queryClient = useQueryClient();

  const sourceMap = useMemo(() => {
    return new Map((sources || []).map((source) => [source.id, source]));
  }, [sources]);

  const allBlueprintIds = useMemo(() => {
    return new Set((releases || []).map((r) => r.blueprint_id));
  }, [releases]);

  const suppressedCount = useMemo(() => {
    return (releases || []).filter((r) =>
      shouldAutoSuppressBlueprint(r.blueprint_id, allBlueprintIds),
    ).length;
  }, [releases, allBlueprintIds]);

  // Step 1: Apply search + field filters + auto-suppression of superseded built-ins.
  const visibleReleases = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return (releases || []).filter((release) => {
      const source = sourceMap.get(release.blueprint_source_id);
      if (
        !showLegacy &&
        shouldAutoSuppressBlueprint(release.blueprint_id, allBlueprintIds)
      ) {
        return false;
      }
      const meta = resolveBlueprintFamilyMeta(release);
      const matchesPattern =
        deploymentPatternFilter === "all" ||
        meta.deployment_pattern === deploymentPatternFilter;
      const matchesSearch =
        !normalizedSearch ||
        [
          release.blueprint_name,
          meta.family_name,
          meta.variant_label,
          release.blueprint_id,
          release.blueprint_description,
          release.source_name,
          release.source_path,
          ...(release.tags || []),
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(normalizedSearch),
        );

      const releaseProvider = normalizeBlueprintCloudProvider(release);
      const matchesPlatform =
        platformFilter === "all" || releaseProvider === platformFilter;
      const matchesSource =
        sourceFilter === "all" ||
        String(release.blueprint_source_id) === sourceFilter;
      const matchesValidation =
        validationFilter === "all" ||
        release.validation_state === validationFilter;
      const matchesReleaseState =
        releaseStateFilter === "all" ||
        release.release_state === releaseStateFilter;

      return (
        matchesPattern &&
        matchesSearch &&
        matchesPlatform &&
        matchesSource &&
        matchesValidation &&
        matchesReleaseState &&
        !!source
      );
    });
  }, [
    releases,
    search,
    platformFilter,
    sourceFilter,
    validationFilter,
    releaseStateFilter,
    deploymentPatternFilter,
    showLegacy,
    allBlueprintIds,
    sourceMap,
  ]);

  // Step 2: Group by canonical family_id across sources when canonical, or source:blueprint_id fallback,
  //         computing available BNK versions and topology variants per family.
  const blueprintGroups = useMemo((): BlueprintGroup[] => {
    const grouped = new Map<string, BlueprintRelease[]>();

    for (const release of visibleReleases) {
      const meta = resolveBlueprintFamilyMeta(release);
      const isCanonicalFamily =
        isCanonicalBlueprintId(release.blueprint_id) ||
        (Boolean(meta.family_id) && meta.family_id !== release.blueprint_id);
      const key = isCanonicalFamily
        ? `family:${meta.family_id}`
        : `${release.blueprint_source_id}:${release.blueprint_id}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(release);
      grouped.set(key, bucket);
    }

    const groups: BlueprintGroup[] = [];
    for (const [key, bucket] of grouped) {
      const nonRemoved = bucket.filter((r) => !isRemovedRelease(r));
      if (!showRemoved && nonRemoved.length === 0) continue;

      const sorted = sortVersionsDesc(bucket, (r) => r.blueprint_version);

      // Collect distinct normalized BNK versions (sorted newest-first, e.g. 2.4.1 before 2.3)
      const bnkSet = new Set<string>();
      const variantMap = new Map<string, BlueprintVariantOption>();
      for (const r of sorted) {
        const m = resolveBlueprintFamilyMeta(r);
        if (m.bnk_version) bnkSet.add(m.bnk_version);
        if (!variantMap.has(m.variant_key)) {
          variantMap.set(m.variant_key, {
            variant_key: m.variant_key,
            variant_label: m.variant_label,
            is_recommended: m.is_recommended,
            deployment_pattern: m.deployment_pattern,
          });
        } else if (m.is_recommended) {
          const existing = variantMap.get(m.variant_key)!;
          existing.is_recommended = true;
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

      // Pick default latest: prefer non-removed, prefer highest BNK version (e.g. 2.4.1), prefer is_recommended
      const candidatePool = nonRemoved.length > 0 ? nonRemoved : sorted;
      const defaultBnk = bnkVersions[0] ?? null;
      const bnkMatches = defaultBnk
        ? candidatePool.filter(
            (r) => resolveBlueprintFamilyMeta(r).bnk_version === defaultBnk,
          )
        : candidatePool;
      const activePool = bnkMatches.length > 0 ? bnkMatches : candidatePool;
      const recMatches = activePool.filter(
        (r) => resolveBlueprintFamilyMeta(r).is_recommended,
      );
      const bestPool = recMatches.length > 0 ? recMatches : activePool;
      const latest = sortVersionsDesc(bestPool, (r) => r.blueprint_version)[0];
      const latestMeta = resolveBlueprintFamilyMeta(latest);

      groups.push({
        key,
        family_id: latestMeta.family_id,
        family_name: latestMeta.family_name,
        deployment_pattern: latestMeta.deployment_pattern,
        blueprint_id: latest.blueprint_id,
        blueprint_source_id: latest.blueprint_source_id,
        versions: sorted,
        latest,
        bnkVersions,
        variants,
      });
    }

    groups.sort((a, b) => {
      const orderA = PATTERN_SORT_ORDER[a.deployment_pattern] ?? 99;
      const orderB = PATTERN_SORT_ORDER[b.deployment_pattern] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      const featA = a.latest.is_featured ? 0 : 1;
      const featB = b.latest.is_featured ? 0 : 1;
      if (featA !== featB) return featA - featB;
      const titleA = a.family_name || a.latest.blueprint_name || "";
      const titleB = b.family_name || b.latest.blueprint_name || "";
      return titleA.localeCompare(titleB);
    });

    return groups;
  }, [visibleReleases, showRemoved]);

  // Compute provider & pattern counts across non-suppressed active families for quick-filter pills
  const { providerCounts, patternCounts } = useMemo(() => {
    const pCounts: Record<string, number> = { all: 0 };
    const patCounts: Record<string, number> = { all: 0 };
    const seenFamilies = new Map<
      string,
      { provider: string; pattern: string }
    >();

    for (const release of releases || []) {
      if (!sourceMap.get(release.blueprint_source_id)) continue;
      if (!showRemoved && isRemovedRelease(release)) continue;
      if (
        !showLegacy &&
        shouldAutoSuppressBlueprint(release.blueprint_id, allBlueprintIds)
      ) {
        continue;
      }
      const meta = resolveBlueprintFamilyMeta(release);
      const isCanonicalFamily =
        isCanonicalBlueprintId(release.blueprint_id) ||
        (Boolean(meta.family_id) && meta.family_id !== release.blueprint_id);
      const key = isCanonicalFamily
        ? `family:${meta.family_id}`
        : `${release.blueprint_source_id}:${release.blueprint_id}`;
      if (!seenFamilies.has(key)) {
        seenFamilies.set(key, {
          provider: normalizeBlueprintCloudProvider(release),
          pattern: meta.deployment_pattern,
        });
      }
    }

    for (const { provider, pattern } of seenFamilies.values()) {
      pCounts.all = (pCounts.all ?? 0) + 1;
      pCounts[provider] = (pCounts[provider] ?? 0) + 1;
      patCounts.all = (patCounts.all ?? 0) + 1;
      patCounts[pattern] = (patCounts[pattern] ?? 0) + 1;
    }

    return { providerCounts: pCounts, patternCounts: patCounts };
  }, [releases, sourceMap, showRemoved, showLegacy, allBlueprintIds]);

  const summary = useMemo(() => {
    const total = blueprintGroups.length;
    const valid = blueprintGroups.filter(
      (g) => g.latest.validation_state === "valid",
    ).length;
    const imported = blueprintGroups.filter((g) =>
      g.versions.some((r) => r.release_state === "imported"),
    ).length;
    const approved = blueprintGroups.filter((g) =>
      g.versions.some((r) => r.release_state === "approved"),
    ).length;
    const totalProfiles = visibleReleases.length;
    return { total, valid, imported, approved, totalProfiles };
  }, [blueprintGroups, visibleReleases]);

  const handleDeleteSource = async () => {
    if (!sourceToDelete) {
      return;
    }

    await deleteSourceMutation.mutateAsync(sourceToDelete.id);
    setSourceToDelete(null);
  };

  const handleDeleteRelease = async () => {
    if (!releaseToDelete) {
      return;
    }

    await deleteReleaseMutation.mutateAsync(releaseToDelete.id);
    setReleaseToDelete(null);
  };

  const handleUnimportRelease = async () => {
    if (!releaseToUnimport) {
      return;
    }

    await unimportMutation.mutateAsync(releaseToUnimport.id);
    setReleaseToUnimport(null);
  };

  const handleSyncAll = async () => {
    const syncableSources = (sources || []).filter(
      (source) => source.source_type === "git" && source.is_active,
    );
    if (syncableSources.length === 0) {
      notify.info("No active git blueprint sources to sync", undefined, {
        category: "system",
      });
      return;
    }

    setIsSyncingAll(true);
    try {
      for (const source of syncableSources) {
        await syncMutation.mutateAsync(source.id);
      }
      notify.success(
        `Synced ${syncableSources.length} blueprint source${syncableSources.length === 1 ? "" : "s"}`,
        undefined,
        { category: "system" },
      );
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleDeployRelease = (release: BlueprintRelease) => {
    setDeployReleaseSlug(`release-${release.id}`);
    setDeployDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <SectionCard>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-5">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground/70">
              Blueprints
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Canonical blueprint families organized by deployment architecture
              (Full Stack, Existing Cluster + BNK, Cluster Infra Only, and
              Solutions) with inline BNK release &amp; topology selectors.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5 mr-1">
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  viewMode === "cards"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Card grid view"
                aria-pressed={viewMode === "cards"}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Cards
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  viewMode === "table"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Table view"
                aria-pressed={viewMode === "table"}
              >
                <List className="h-3.5 w-3.5" />
                Table
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSourcesOpen(true)}
            >
              <Settings className="mr-1.5 h-4 w-4" />
              Sources
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSyncAll}
              disabled={
                isSyncingAll || syncMutation.isPending || !sources?.length
              }
            >
              {isSyncingAll ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-4 w-4" />
              )}
              Sync all
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search blueprints, tags, source, or description"
                className="pl-9"
              />
            </div>

            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {(sources || []).map((source) => (
                  <SelectItem key={source.id} value={String(source.id)}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={validationFilter}
              onValueChange={setValidationFilter}
            >
              <SelectTrigger>
                <SelectValue placeholder="Validation" />
              </SelectTrigger>
              <SelectContent>
                {VALIDATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={releaseStateFilter}
              onValueChange={setReleaseStateFilter}
            >
              <SelectTrigger>
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                {RELEASE_STATE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cloud Provider Quick-Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
              Cloud / Platform:
            </span>
            {PLATFORM_OPTIONS.filter(
              (opt) =>
                opt.value === "all" || (providerCounts[opt.value] ?? 0) > 0,
            ).map((opt) => {
              const isActive = platformFilter === opt.value;
              const count = providerCounts[opt.value] ?? 0;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPlatformFilter(opt.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-primary/15 text-primary border-primary/50"
                      : "bg-card text-muted-foreground border-border hover:text-foreground",
                  )}
                  aria-pressed={isActive}
                >
                  <span>{opt.label}</span>
                  <span className="rounded-full bg-muted/60 px-1.5 py-0.2 text-[10px] font-mono">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Deployment Pattern Step Chips + Toggles */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
                Architecture Pattern:
              </span>
              {DEPLOYMENT_PATTERN_OPTIONS.map((opt) => {
                const isActive = deploymentPatternFilter === opt.value;
                const count = patternCounts[opt.value] ?? 0;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDeploymentPatternFilter(opt.value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-primary/15 text-primary border-primary/50"
                        : "bg-card text-muted-foreground border-border hover:text-foreground",
                    )}
                    aria-pressed={isActive}
                  >
                    <span>{opt.label}</span>
                    <span className="rounded-full bg-muted/60 px-1.5 py-0.2 text-[10px] font-mono">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {suppressedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLegacy((v) => !v)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
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

              <button
                type="button"
                onClick={() => setShowRemoved((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  showRemoved
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-muted-foreground border-border hover:text-foreground",
                )}
                aria-pressed={showRemoved}
              >
                {showRemoved ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
                {showRemoved ? "Removed visible" : "Show removed"}
              </button>

              <button
                type="button"
                onClick={() => setLatestOnly((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  latestOnly
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-muted-foreground border-border hover:text-foreground",
                )}
                aria-pressed={latestOnly}
              >
                <Tag className="h-3.5 w-3.5" />
                Latest only
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryTile
              label="Canonical Blueprint Families"
              value={summary.total}
              subtitle={`${summary.totalProfiles} total profile releases`}
              icon={Layers}
            />
            <SummaryTile
              label="Validated Families"
              value={summary.valid}
              subtitle="Schema & module dependency checks"
              icon={CheckCircle2}
            />
            <SummaryTile
              label="Deployable / Imported"
              value={summary.imported}
              subtitle="Ready to launch into projects"
              icon={Download}
            />
            <SummaryTile
              label="Approved"
              value={summary.approved}
              subtitle={`${(sources || []).length} active catalog sources`}
              icon={Tag}
            />
          </div>

          {releasesLoading || sourcesLoading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : blueprintGroups.length === 0 ? (
            <Alert>
              <Filter className="h-4 w-4" />
              <AlertDescription>
                No blueprints match the current filters. Try clearing a filter
                or sync your sources again.
              </AlertDescription>
            </Alert>
          ) : viewMode === "cards" ? (
            <BlueprintCardGrid
              groups={blueprintGroups}
              sourceMap={sourceMap}
              latestOnly={latestOnly}
              onDeploy={handleDeployRelease}
              onImport={(release) =>
                importMutation.mutate({
                  releaseId: release.id,
                  stateReason: "Imported from Blueprint Catalog UI",
                })
              }
              onDiscard={(release) => setReleaseToDelete(release)}
              onRemove={(release) => setReleaseToUnimport(release)}
              onSetVisibility={(release, isVisible) =>
                visibilityMutation.mutate({ releaseId: release.id, isVisible })
              }
              importPending={importMutation.isPending}
              discardPending={deleteReleaseMutation.isPending}
              removePending={unimportMutation.isPending}
              visibilityPending={visibilityMutation.isPending}
            />
          ) : (
            <BlueprintTable
              groups={blueprintGroups}
              sourceMap={sourceMap}
              latestOnly={latestOnly}
              onDeploy={handleDeployRelease}
              onImport={(release) =>
                importMutation.mutate({
                  releaseId: release.id,
                  stateReason: "Imported from Blueprint Catalog UI",
                })
              }
              onDiscard={(release) => setReleaseToDelete(release)}
              onRemove={(release) => setReleaseToUnimport(release)}
              onSetVisibility={(release, isVisible) =>
                visibilityMutation.mutate({ releaseId: release.id, isVisible })
              }
              importPending={importMutation.isPending}
              discardPending={deleteReleaseMutation.isPending}
              removePending={unimportMutation.isPending}
              visibilityPending={visibilityMutation.isPending}
            />
          )}
        </div>
      </SectionCard>

      <BlueprintSourcesDialog
        open={isSourcesOpen}
        onOpenChange={setIsSourcesOpen}
        sources={sources || []}
        releasesBySource={
          new Map(
            (sources || []).map((source) => [source.id, source.release_count]),
          )
        }
        syncMutation={syncMutation}
        createMutation={createMutation}
        updateMutation={updateMutation}
        deleteSourceMutation={deleteSourceMutation}
        onDelete={(source) => setSourceToDelete(source)}
      />

      {deployReleaseSlug ? (
        <ImportedBlueprintDeployDialog
          slug={deployReleaseSlug}
          open={deployDialogOpen}
          onOpenChange={setDeployDialogOpen}
          onSuccess={() => {
            // Refresh the catalog so each card's deployed_project_count
            // reflects the new project, and refresh project lists so the
            // new project appears elsewhere in the app.
            queryClient.invalidateQueries({
              queryKey: queryKeys.blueprintCatalog.releases(),
            });
            queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
          }}
        />
      ) : null}

      <AlertDialog
        open={sourceToDelete !== null}
        onOpenChange={(open) => !open && setSourceToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete blueprint source?</AlertDialogTitle>
            <AlertDialogDescription>
              {sourceToDelete
                ? `Remove blueprint source "${sourceToDelete.name}" from the catalog. Imported releases remain until removed separately.`
                : "Remove this blueprint source from the catalog."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSourceMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSource}
              disabled={deleteSourceMutation.isPending}
            >
              {deleteSourceMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Delete Source
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={releaseToDelete !== null}
        onOpenChange={(open) => !open && setReleaseToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard discovered release?</AlertDialogTitle>
            <AlertDialogDescription>
              {releaseToDelete
                ? `${releaseToDelete.blueprint_name} ${releaseToDelete.blueprint_version} will be removed from the catalog. It will reappear on the next sync if it still exists in the source.`
                : "This release will be removed from the catalog."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteReleaseMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRelease}
              disabled={deleteReleaseMutation.isPending}
            >
              {deleteReleaseMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={releaseToUnimport !== null}
        onOpenChange={(open) => !open && setReleaseToUnimport(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from deployable catalog?</AlertDialogTitle>
            <AlertDialogDescription>
              {releaseToUnimport
                ? `${releaseToUnimport.blueprint_name} ${releaseToUnimport.blueprint_version} will move back to the discovered state and will no longer be deployable. The catalog entry stays — re-import it later to make it deployable again. Blocked if any project was created from this release.`
                : "This release will move back to the discovered state."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unimportMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnimportRelease}
              disabled={unimportMutation.isPending}
            >
              {unimportMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  subtitle,
  icon: Icon,
}: {
  label: string;
  value: number;
  subtitle?: string;
  icon: typeof Layers;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/80 px-4 py-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {value}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/40 p-2.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
    </div>
  );
}

interface BlueprintTableProps {
  groups: BlueprintGroup[];
  sourceMap: Map<number, BlueprintSource>;
  latestOnly: boolean;
  onDeploy: (release: BlueprintRelease) => void;
  onImport: (release: BlueprintRelease) => void;
  onDiscard: (release: BlueprintRelease) => void;
  onRemove: (release: BlueprintRelease) => void;
  onSetVisibility: (release: BlueprintRelease, isVisible: boolean) => void;
  importPending: boolean;
  discardPending: boolean;
  removePending: boolean;
  visibilityPending: boolean;
}

function BlueprintCardGrid({
  groups,
  sourceMap,
  latestOnly,
  onDeploy,
  onImport,
  onDiscard,
  onRemove,
  onSetVisibility,
  importPending,
  discardPending,
  removePending,
  visibilityPending,
}: BlueprintTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    new Set(),
  );
  const [selectedBnkByFamily, setSelectedBnkByFamily] = useState<
    Record<string, string>
  >({});
  const [selectedVariantByFamily, setSelectedVariantByFamily] = useState<
    Record<string, string>
  >({});
  const [selectedVersionByFamily, setSelectedVersionByFamily] = useState<
    Record<string, string>
  >({});

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleModules = (key: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((group) => {
        const activeBnk =
          selectedBnkByFamily[group.key] ?? group.bnkVersions[0] ?? null;

        const bnkFiltered =
          group.bnkVersions.length > 1 && activeBnk
            ? group.versions.filter((r) => {
                const m = resolveBlueprintFamilyMeta(r);
                return !m.bnk_version || m.bnk_version === activeBnk;
              })
            : group.versions;
        const effectiveBnkPool =
          bnkFiltered.length > 0 ? bnkFiltered : group.versions;

        const variantsForBnkMap = new Map<string, BlueprintVariantOption>();
        for (const r of effectiveBnkPool) {
          const m = resolveBlueprintFamilyMeta(r);
          if (!variantsForBnkMap.has(m.variant_key)) {
            variantsForBnkMap.set(m.variant_key, {
              variant_key: m.variant_key,
              variant_label: m.variant_label,
              is_recommended: m.is_recommended,
              deployment_pattern: m.deployment_pattern,
            });
          } else if (m.is_recommended) {
            const existing = variantsForBnkMap.get(m.variant_key)!;
            existing.is_recommended = true;
          }
        }
        const variantsForBnk = Array.from(variantsForBnkMap.values()).sort(
          (a, b) => {
            if (a.is_recommended !== b.is_recommended) {
              return a.is_recommended ? -1 : 1;
            }
            return a.variant_label.localeCompare(b.variant_label);
          },
        );

        const preferredVariantKey =
          selectedVariantByFamily[group.key] &&
          variantsForBnkMap.has(selectedVariantByFamily[group.key])
            ? selectedVariantByFamily[group.key]
            : (variantsForBnk.find((v) => v.is_recommended)?.variant_key ??
              variantsForBnk[0]?.variant_key);

        const variantSlice = preferredVariantKey
          ? effectiveBnkPool.filter(
              (r) =>
                resolveBlueprintFamilyMeta(r).variant_key ===
                preferredVariantKey,
            )
          : effectiveBnkPool;
        const activeSlice =
          variantSlice.length > 0 ? variantSlice : effectiveBnkPool;

        const nonRemovedSlice = activeSlice.filter((r) => !isRemovedRelease(r));
        const sortedSlice = sortVersionsDesc(
          activeSlice,
          (r) => r.blueprint_version,
        );
        const selectableVersions =
          nonRemovedSlice.length > 0
            ? sortVersionsDesc(nonRemovedSlice, (r) => r.blueprint_version)
            : sortedSlice;
        const defaultRelease = selectableVersions[0] ?? sortedSlice[0];
        const selectedVer = selectedVersionByFamily[group.key];
        const latest =
          (!latestOnly &&
            selectedVer &&
            selectableVersions.find(
              (r) => r.blueprint_version === selectedVer,
            )) ||
          defaultRelease;

        const source =
          sourceMap.get(latest.blueprint_source_id) ||
          sourceMap.get(group.blueprint_source_id) ||
          null;
        const activeMeta = resolveBlueprintFamilyMeta(latest);
        const otherVersions = latestOnly
          ? []
          : sortedSlice.filter((r) => r.id !== latest.id);
        const isExpanded = expanded.has(group.key);
        const isModulesExpanded = expandedModules.has(group.key);
        const moduleList = latest.modules ?? [];
        const moduleCount = latest.module_count ?? moduleList.length;
        const canDeploy =
          latest.release_state === "imported" ||
          latest.release_state === "approved";
        const isImported =
          latest.release_state === "imported" ||
          latest.release_state === "approved";
        const isDiscoveredOnly = latest.release_state === "discovered";
        const deployedCount = latest.deployed_project_count ?? 0;
        const removeDisabled = removePending || deployedCount > 0;
        const validationErrors = latest.validation_errors?.length ?? 0;
        const isBuiltin = source?.source_type === "builtin";
        const hasMultiVariantsOrBnk =
          group.variants.length > 1 || group.bnkVersions.length > 1;
        const displayTitle = hasMultiVariantsOrBnk
          ? group.family_name || latest.blueprint_name
          : latest.blueprint_name;
        const providerKey = normalizeBlueprintCloudProvider(latest);
        const providerBadge = PROVIDER_BADGE_STYLES[providerKey];

        return (
          <div
            key={group.key}
            className={cn(
              "flex flex-col justify-between rounded-xl border p-4 shadow-sm transition-colors hover:border-primary/40",
              activeMeta.is_recommended
                ? "border-primary/35 bg-card/80"
                : "border-border bg-card/60",
            )}
          >
            <div className="space-y-3">
              {/* Top Row: Badges + State */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-2 py-0.5",
                      providerBadge?.className ??
                        "text-muted-foreground border-border",
                    )}
                  >
                    {providerBadge?.label ?? (latest.cloud_provider || "Other")}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-[10px] text-muted-foreground bg-muted/30"
                  >
                    {DEPLOYMENT_PATTERN_LABELS[activeMeta.deployment_pattern]}
                  </Badge>
                  {activeMeta.bnk_version && (
                    <Badge
                      variant="outline"
                      className="border-primary/40 bg-primary/10 text-primary text-[10px] font-mono"
                    >
                      BNK {activeMeta.bnk_version}
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
                  {isBuiltin ? (
                    <Badge
                      variant="outline"
                      className="border-info/60 bg-info/10 text-info text-[10px]"
                    >
                      Built-in
                    </Badge>
                  ) : null}
                  {latest.is_featured ? (
                    <Badge
                      variant="outline"
                      className="border-warning/60 bg-warning/10 text-warning text-[10px]"
                    >
                      Featured
                    </Badge>
                  ) : null}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-mono text-xs text-muted-foreground">
                    v{latest.blueprint_version}
                  </span>
                  {releaseStateBadge(latest.release_state)}
                </div>
              </div>

              {/* Title + Description */}
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-semibold tracking-tight text-foreground">
                    {displayTitle}
                  </h4>
                  {validationErrors > 0 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <XCircle className="h-3.5 w-3.5 text-destructive" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {validationErrors} validation issue
                          {validationErrors === 1 ? "" : "s"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                {latest.blueprint_description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                    {latest.blueprint_description}
                  </p>
                )}
              </div>

              {/* Structured Configuration Box (BNK Release / Topology Variant / Semver / Resolved Blueprint ID) */}
              <div className="rounded-lg border border-border/70 bg-muted/25 p-3 space-y-2.5">
                {group.bnkVersions.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      BNK Release
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
                              setSelectedVersionByFamily((prev) => {
                                if (!(group.key in prev)) return prev;
                                const next = { ...prev };
                                delete next[group.key];
                                return next;
                              });
                            }}
                            className={cn(
                              "rounded px-2.5 py-0.5 text-xs font-mono transition-colors",
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

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Topology / Variant
                  </span>
                  {variantsForBnk.length > 1 ? (
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
                        className="h-7 w-auto min-w-[210px] max-w-full gap-1.5 rounded-md border border-border bg-card px-2.5 py-0 text-xs text-foreground focus:ring-1 focus:ring-primary"
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
                  ) : (
                    <span className="text-xs font-medium text-foreground/90">
                      {formatVariantOptionLabel(
                        activeMeta.variant_label,
                        activeMeta.is_recommended,
                      )}
                    </span>
                  )}
                </div>

                {!latestOnly && selectableVersions.length > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Blueprint Version
                    </span>
                    <Select
                      value={latest.blueprint_version}
                      onValueChange={(val) =>
                        setSelectedVersionByFamily((prev) => ({
                          ...prev,
                          [group.key]: val,
                        }))
                      }
                    >
                      <SelectTrigger
                        aria-label={`Blueprint version for ${displayTitle}`}
                        className="h-7 w-auto gap-1.5 rounded-md border border-border bg-card px-2.5 py-0 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableVersions.map((r, idx) => (
                          <SelectItem
                            key={r.id}
                            value={r.blueprint_version}
                            className="text-xs font-mono"
                          >
                            {r.blueprint_version}
                            {idx === 0 ? " (Latest)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50 text-[11px] text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      Resolves to:{" "}
                      <code className="font-mono text-foreground/90">
                        {latest.blueprint_id}
                      </code>
                    </span>
                    {moduleCount > 0 && (
                      <span className="text-muted-foreground/80">
                        · {moduleCount} module{moduleCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  {source && (
                    <span
                      className="truncate max-w-[200px]"
                      title={source.name}
                    >
                      Source:{" "}
                      <strong className="font-medium text-foreground/80">
                        {source.name}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Footer: Module pipeline disclosure + Other versions + Visibility + Actions */}
            <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={latest.is_active}
                      onCheckedChange={(checked) =>
                        onSetVisibility(latest, checked)
                      }
                      disabled={
                        visibilityPending ||
                        isDiscoveredOnly ||
                        isRemovedRelease(latest)
                      }
                      aria-label={`Toggle visibility for ${latest.blueprint_name} v${latest.blueprint_version}`}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Visible
                    </span>
                  </div>

                  {moduleList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleModules(group.key)}
                      className="inline-flex items-center gap-1 rounded border border-border/70 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      aria-expanded={isModulesExpanded}
                    >
                      {isModulesExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                      {isModulesExpanded
                        ? `Hide ${moduleList.length} Modules`
                        : `View ${moduleList.length} Modules`}
                    </button>
                  )}

                  {otherVersions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggle(group.key)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                      {otherVersions.length} other version
                      {otherVersions.length === 1 ? "" : "s"}
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => onDeploy(latest)}
                    disabled={!canDeploy}
                    title={
                      !canDeploy
                        ? "Import this release first to deploy it"
                        : undefined
                    }
                  >
                    <Rocket className="mr-1.5 h-3.5 w-3.5" />
                    Deploy
                  </Button>
                  {!isBuiltin &&
                    isDiscoveredOnly &&
                    latest.validation_state === "valid" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onImport(latest)}
                        disabled={importPending}
                      >
                        {importPending ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Import
                      </Button>
                    )}
                  {!isBuiltin && isImported ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemove(latest)}
                      disabled={removeDisabled}
                      title={
                        deployedCount > 0
                          ? `Cannot remove: ${deployedCount} project${
                              deployedCount === 1 ? "" : "s"
                            } deployed from this blueprint`
                          : undefined
                      }
                      className="h-8 w-8 p-0"
                      aria-label="Remove from deployable catalog"
                    >
                      {removePending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      )}
                    </Button>
                  ) : !isBuiltin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onDiscard(latest)}
                      disabled={discardPending}
                      className="h-8 w-8 p-0"
                      aria-label="Discard discovered release"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  ) : null}
                </div>
              </div>

              {isModulesExpanded && moduleList.length > 0 && (
                <div className="rounded-md border border-border/60 bg-muted/25 p-2.5">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Ordered Module Pipeline ({moduleList.length} stages)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {moduleList.map((mod, idx) => (
                      <span
                        key={`${mod.id}-${idx}`}
                        className="inline-flex items-center gap-1 rounded border border-border/70 bg-card px-2 py-0.5 text-[11px] font-mono text-foreground/90"
                      >
                        <span className="text-muted-foreground">
                          {idx + 1}.
                        </span>
                        <span>{mod.name || mod.id}</span>
                        {mod.version && (
                          <span className="text-[10px] text-muted-foreground">
                            v{mod.version}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {isExpanded && otherVersions.length > 0 && (
                <div className="rounded-md border border-border/60 bg-muted/30 divide-y divide-border/50">
                  {otherVersions.map((release) => {
                    const rIsImported =
                      release.release_state === "imported" ||
                      release.release_state === "approved";
                    const rIsDiscoveredOnly =
                      release.release_state === "discovered";
                    return (
                      <div
                        key={release.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-muted-foreground">
                            ↳ {release.blueprint_name}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            v{release.blueprint_version}
                          </span>
                          {releaseStateBadge(release.release_state)}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Switch
                            checked={release.is_active}
                            onCheckedChange={(checked) =>
                              onSetVisibility(release, checked)
                            }
                            disabled={
                              visibilityPending ||
                              rIsDiscoveredOnly ||
                              isRemovedRelease(release)
                            }
                            aria-label={`Toggle visibility for ${release.blueprint_name} v${release.blueprint_version}`}
                          />
                          {rIsDiscoveredOnly &&
                            release.validation_state === "valid" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onImport(release)}
                                disabled={importPending}
                              >
                                {importPending ? (
                                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                ) : (
                                  <Download className="mr-1.5 h-3 w-3" />
                                )}
                                Import
                              </Button>
                            )}
                          {rIsImported ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onRemove(release)}
                              disabled={removePending}
                              className="h-7 w-7 p-0"
                              aria-label="Remove"
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onDiscard(release)}
                              disabled={discardPending}
                              className="h-7 w-7 p-0"
                              aria-label="Discard"
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BlueprintTable({
  groups,
  sourceMap,
  latestOnly,
  onDeploy,
  onImport,
  onDiscard,
  onRemove,
  onSetVisibility,
  importPending,
  discardPending,
  removePending,
  visibilityPending,
}: BlueprintTableProps) {
  // Per-group expanded state for the "other versions" disclosure.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Per-family selected BNK release (e.g. '2.4.1' vs '2.3'), topology variant, and blueprint semver
  const [selectedBnkByFamily, setSelectedBnkByFamily] = useState<
    Record<string, string>
  >({});
  const [selectedVariantByFamily, setSelectedVariantByFamily] = useState<
    Record<string, string>
  >({});
  const [selectedVersionByFamily, setSelectedVersionByFamily] = useState<
    Record<string, string>
  >({});

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="border border-border rounded-md overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
              Blueprint
            </TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
              Provider
            </TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
              Source
            </TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
              Version
            </TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
              State
            </TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
              Visible
            </TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right w-48">
              {/* actions */}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const activeBnk =
              selectedBnkByFamily[group.key] ?? group.bnkVersions[0] ?? null;

            // Filter releases matching the selected BNK version (or include infra-only releases with null BNK version)
            const bnkFiltered =
              group.bnkVersions.length > 1 && activeBnk
                ? group.versions.filter((r) => {
                    const m = resolveBlueprintFamilyMeta(r);
                    return !m.bnk_version || m.bnk_version === activeBnk;
                  })
                : group.versions;
            const effectiveBnkPool =
              bnkFiltered.length > 0 ? bnkFiltered : group.versions;

            // Compute available variants for the active BNK version
            const variantsForBnkMap = new Map<string, BlueprintVariantOption>();
            for (const r of effectiveBnkPool) {
              const m = resolveBlueprintFamilyMeta(r);
              if (!variantsForBnkMap.has(m.variant_key)) {
                variantsForBnkMap.set(m.variant_key, {
                  variant_key: m.variant_key,
                  variant_label: m.variant_label,
                  is_recommended: m.is_recommended,
                  deployment_pattern: m.deployment_pattern,
                });
              }
            }
            const variantsForBnk = Array.from(variantsForBnkMap.values()).sort(
              (a, b) => {
                if (a.is_recommended !== b.is_recommended) {
                  return a.is_recommended ? -1 : 1;
                }
                return a.variant_label.localeCompare(b.variant_label);
              },
            );

            const preferredVariantKey =
              selectedVariantByFamily[group.key] &&
              variantsForBnkMap.has(selectedVariantByFamily[group.key])
                ? selectedVariantByFamily[group.key]
                : (variantsForBnk.find((v) => v.is_recommended)?.variant_key ??
                  variantsForBnk[0]?.variant_key);

            const variantSlice = preferredVariantKey
              ? effectiveBnkPool.filter(
                  (r) =>
                    resolveBlueprintFamilyMeta(r).variant_key ===
                    preferredVariantKey,
                )
              : effectiveBnkPool;
            const activeSlice =
              variantSlice.length > 0 ? variantSlice : effectiveBnkPool;

            const nonRemovedSlice = activeSlice.filter(
              (r) => !isRemovedRelease(r),
            );
            const sortedSlice = sortVersionsDesc(
              activeSlice,
              (r) => r.blueprint_version,
            );
            const selectableVersions =
              nonRemovedSlice.length > 0
                ? sortVersionsDesc(nonRemovedSlice, (r) => r.blueprint_version)
                : sortedSlice;
            const defaultRelease = selectableVersions[0] ?? sortedSlice[0];
            const selectedVer = selectedVersionByFamily[group.key];
            const latest =
              (!latestOnly &&
                selectedVer &&
                selectableVersions.find(
                  (r) => r.blueprint_version === selectedVer,
                )) ||
              defaultRelease;

            const source =
              sourceMap.get(latest.blueprint_source_id) ||
              sourceMap.get(group.blueprint_source_id) ||
              null;
            const activeMeta = resolveBlueprintFamilyMeta(latest);
            const otherVersions = latestOnly
              ? []
              : sortedSlice.filter((r) => r.id !== latest.id);
            const isExpanded = expanded.has(group.key);
            const canDeploy =
              latest.release_state === "imported" ||
              latest.release_state === "approved";
            const isImported =
              latest.release_state === "imported" ||
              latest.release_state === "approved";
            const isDiscoveredOnly = latest.release_state === "discovered";
            const deployedCount = latest.deployed_project_count ?? 0;
            const removeDisabled = removePending || deployedCount > 0;
            const validationErrors = latest.validation_errors?.length ?? 0;
            const isBuiltin = source?.source_type === "builtin";
            const hasMultiVariantsOrBnk =
              group.variants.length > 1 || group.bnkVersions.length > 1;
            const displayTitle = hasMultiVariantsOrBnk
              ? group.family_name || latest.blueprint_name
              : latest.blueprint_name;

            return (
              <Fragment key={group.key}>
                <TableRow>
                  <TableCell>
                    <div className="flex flex-col">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">
                          {displayTitle}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-2xs text-muted-foreground"
                        >
                          {
                            DEPLOYMENT_PATTERN_LABELS[
                              activeMeta.deployment_pattern
                            ]
                          }
                        </Badge>
                        {activeMeta.bnk_version && (
                          <Badge
                            variant="outline"
                            className="border-primary/40 bg-primary/10 text-primary text-2xs font-mono"
                          >
                            BNK {activeMeta.bnk_version}
                          </Badge>
                        )}
                        {isBuiltin ? (
                          <Badge
                            variant="outline"
                            className="border-info/60 bg-info/10 text-info text-2xs"
                          >
                            Built-in
                          </Badge>
                        ) : null}
                        {latest.is_featured ? (
                          <Badge
                            variant="outline"
                            className="border-warning/60 bg-warning/10 text-warning text-2xs"
                          >
                            Featured
                          </Badge>
                        ) : null}
                        {validationErrors > 0 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {validationErrors} validation issue
                                {validationErrors === 1 ? "" : "s"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                      {latest.blueprint_description && (
                        <span className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {latest.blueprint_description}
                        </span>
                      )}

                      {/* Inline BNK Release, Topology Variant & Version selectors */}
                      {(group.bnkVersions.length > 1 ||
                        variantsForBnk.length > 1 ||
                        (!latestOnly && selectableVersions.length > 1)) && (
                        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
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
                                        setSelectedVersionByFamily((prev) => {
                                          if (!(group.key in prev)) return prev;
                                          const next = { ...prev };
                                          delete next[group.key];
                                          return next;
                                        });
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
                                  className="h-6 w-auto min-w-[220px] whitespace-nowrap gap-1.5 rounded border border-border bg-card px-2 py-0 text-xs text-foreground focus:ring-1 focus:ring-primary"
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

                          {!latestOnly && selectableVersions.length > 1 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                                Version:
                              </span>
                              <Select
                                value={latest.blueprint_version}
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
                                  {selectableVersions.map((r, idx) => (
                                    <SelectItem
                                      key={r.id}
                                      value={r.blueprint_version}
                                      className="text-xs font-mono"
                                    >
                                      {r.blueprint_version}
                                      {idx === 0 ? " (Latest)" : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      )}

                      {otherVersions.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggle(group.key)}
                          className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                          {otherVersions.length} other version
                          {otherVersions.length === 1 ? "" : "s"}
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const pk = normalizeBlueprintCloudProvider(latest);
                      const pb = PROVIDER_BADGE_STYLES[pk];
                      return (
                        <Badge
                          variant="outline"
                          className={cn("text-xs", pb?.className)}
                        >
                          {pb?.label ?? (latest.cloud_provider || "Other")}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {source ? (
                      <span className="text-xs text-muted-foreground">
                        {source.name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-foreground/80">
                      v{latest.blueprint_version}
                    </span>
                  </TableCell>
                  <TableCell>
                    {releaseStateBadge(latest.release_state)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={latest.is_active}
                      onCheckedChange={(checked) =>
                        onSetVisibility(latest, checked)
                      }
                      disabled={
                        visibilityPending ||
                        isDiscoveredOnly ||
                        isRemovedRelease(latest)
                      }
                      aria-label={`Toggle visibility for ${latest.blueprint_name} v${latest.blueprint_version}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        onClick={() => onDeploy(latest)}
                        disabled={!canDeploy}
                        title={
                          !canDeploy
                            ? "Import this release first to deploy it"
                            : undefined
                        }
                      >
                        <Rocket className="mr-1.5 h-3.5 w-3.5" />
                        Deploy
                      </Button>
                      {!isBuiltin &&
                        isDiscoveredOnly &&
                        latest.validation_state === "valid" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onImport(latest)}
                            disabled={importPending}
                          >
                            {importPending ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Import
                          </Button>
                        )}
                      {!isBuiltin && isImported ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRemove(latest)}
                          disabled={removeDisabled}
                          title={
                            deployedCount > 0
                              ? `Cannot remove: ${deployedCount} project${
                                  deployedCount === 1 ? "" : "s"
                                } deployed from this blueprint`
                              : undefined
                          }
                          className="h-8 w-8 p-0"
                          aria-label="Remove from deployable catalog"
                        >
                          {removePending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          )}
                        </Button>
                      ) : !isBuiltin ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDiscard(latest)}
                          disabled={discardPending}
                          className="h-8 w-8 p-0"
                          aria-label="Discard discovered release"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded &&
                  otherVersions.map((release) => {
                    const rIsImported =
                      release.release_state === "imported" ||
                      release.release_state === "approved";
                    const rIsDiscoveredOnly =
                      release.release_state === "discovered";
                    const rPk = normalizeBlueprintCloudProvider(release);
                    const rPb = PROVIDER_BADGE_STYLES[rPk];
                    return (
                      <TableRow key={release.id} className="bg-muted/30">
                        <TableCell>
                          <span className="ml-6 text-sm text-muted-foreground">
                            ↳ {release.blueprint_name}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn("text-2xs", rPb?.className)}
                          >
                            {rPb?.label ?? (release.cloud_provider || "Other")}
                          </Badge>
                        </TableCell>
                        <TableCell />
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">
                            v{release.blueprint_version}
                          </span>
                        </TableCell>
                        <TableCell>
                          {releaseStateBadge(release.release_state)}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={release.is_active}
                            onCheckedChange={(checked) =>
                              onSetVisibility(release, checked)
                            }
                            disabled={
                              visibilityPending ||
                              rIsDiscoveredOnly ||
                              isRemovedRelease(release)
                            }
                            aria-label={`Toggle visibility for ${release.blueprint_name} v${release.blueprint_version}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {rIsDiscoveredOnly &&
                              release.validation_state === "valid" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onImport(release)}
                                  disabled={importPending}
                                >
                                  {importPending ? (
                                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                  ) : (
                                    <Download className="mr-1.5 h-3 w-3" />
                                  )}
                                  Import
                                </Button>
                              )}
                            {rIsImported ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onRemove(release)}
                                disabled={removePending}
                                className="h-7 w-7 p-0"
                                aria-label="Remove"
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onDiscard(release)}
                                disabled={discardPending}
                                className="h-7 w-7 p-0"
                                aria-label="Discard"
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

interface BlueprintSourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: BlueprintSource[];
  releasesBySource: Map<number, number>;
  syncMutation: ReturnType<typeof useSyncBlueprintSource>;
  createMutation: ReturnType<typeof useCreateBlueprintSource>;
  updateMutation: ReturnType<typeof useUpdateBlueprintSource>;
  deleteSourceMutation: ReturnType<typeof useDeleteBlueprintSource>;
  onDelete: (source: { id: number; name: string }) => void;
}

function BlueprintSourcesDialog({
  open,
  onOpenChange,
  sources,
  releasesBySource,
  syncMutation,
  createMutation,
  updateMutation,
  deleteSourceMutation,
  onDelete,
}: BlueprintSourcesDialogProps) {
  const [editingSource, setEditingSource] = useState<BlueprintSource | null>(
    null,
  );
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const handleAdd = () => {
    setEditingSource(null);
    setIsEditorOpen(true);
  };

  const handleEdit = (source: BlueprintSource) => {
    setEditingSource(source);
    setIsEditorOpen(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Blueprint Sources</DialogTitle>
          <DialogDescription>
            Manage the Git repositories that feed the Blueprint Catalog. Set one
            as default and sync them independently when needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {sources.length === 0 ? (
            <Alert>
              <AlertDescription>
                No blueprint sources configured yet.
              </AlertDescription>
            </Alert>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Releases</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Synced</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {sourceTypeIcon(source.source_type)}
                        <span>{source.name}</span>
                        {source.is_default ? (
                          <Badge variant="muted">Default</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {source.url}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {releasesBySource.get(source.id) || 0}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {statusIcon(source.sync_status)}
                        {statusBadge(source.sync_status)}
                      </div>
                      {source.sync_status === "success" &&
                      source.sync_error ===
                        "No forge-blueprint.json manifests found" ? (
                        <p className="mt-1 text-xs text-warning">
                          Synced successfully, but no forge-blueprint.json
                          manifests were found.
                        </p>
                      ) : null}
                      {source.sync_error ? (
                        <p className="mt-1 text-xs text-destructive line-clamp-2">
                          {source.sync_error}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {source.last_synced_at
                        ? formatAge(source.last_synced_at)
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => syncMutation.mutate(source.id)}
                                disabled={
                                  syncMutation.isPending ||
                                  source.sync_status === "syncing"
                                }
                                aria-label={`Sync ${source.name}`}
                              >
                                <RefreshCw
                                  className={cn(
                                    "h-4 w-4",
                                    syncMutation.isPending && "animate-spin",
                                  )}
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              <p className="text-xs">
                                Sync {source.name}
                                {source.last_synced_at ? (
                                  <span className="text-muted-foreground ml-1">
                                    (last: {formatAge(source.last_synced_at)})
                                  </span>
                                ) : null}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        {source.source_type !== "builtin" ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(source)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                onDelete({ id: source.id, name: source.name })
                              }
                              disabled={deleteSourceMutation.isPending}
                              aria-label="Delete Source"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={handleAdd}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Blueprint Source
            </Button>
          </div>
        </div>

        {isEditorOpen ? (
          <AddEditBlueprintSourceDialog
            open={isEditorOpen}
            onOpenChange={setIsEditorOpen}
            source={editingSource}
            onSubmit={(data) => {
              if (editingSource) {
                updateMutation.mutate(
                  { sourceId: editingSource.id, data },
                  {
                    onSuccess: () => {
                      setIsEditorOpen(false);
                      setEditingSource(null);
                    },
                  },
                );
              } else {
                createMutation.mutate(data as BlueprintSourceCreate, {
                  onSuccess: () => {
                    setIsEditorOpen(false);
                    setEditingSource(null);
                  },
                });
              }
            }}
            isSubmitting={createMutation.isPending || updateMutation.isPending}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface AddEditBlueprintSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: BlueprintSource | null;
  onSubmit: (data: BlueprintSourceCreate | BlueprintSourceUpdate) => void;
  isSubmitting: boolean;
}

function AddEditBlueprintSourceDialog({
  open,
  onOpenChange,
  source,
  onSubmit,
  isSubmitting,
}: AddEditBlueprintSourceDialogProps) {
  const form = useForm<BlueprintSourceFormData>({
    resolver: zodResolver(blueprintSourceSchema),
    defaultValues: {
      name: "",
      source_type: "git",
      url: "",
      branch: "main",
      git_ref: "",
      is_active: true,
      description: "",
      make_default: false,
    },
  });

  useEffect(() => {
    form.reset({
      name: source?.name || "",
      source_type: source?.source_type || "git",
      url: source?.url || "",
      branch: source?.branch || "main",
      git_ref: source?.git_ref || "",
      is_active: source?.is_active ?? true,
      description: source?.description || "",
      make_default: source?.is_default || false,
    });
  }, [source, open, form]);

  const handleValid = (values: BlueprintSourceFormData) => {
    onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleValid)} noValidate>
            <DialogHeader>
              <DialogTitle>
                {source ? "Edit Blueprint Source" : "Add Blueprint Source"}
              </DialogTitle>
              <DialogDescription>
                Register a Git repository that contains BNK
                `forge-blueprint.json` manifests.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Repository URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://github.com/org/repo"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="branch"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Branch</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="git_ref"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Git Ref</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="make_default"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={!!field.value}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                      />
                    </FormControl>
                    <FormLabel className="cursor-pointer">
                      Make Default
                    </FormLabel>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
