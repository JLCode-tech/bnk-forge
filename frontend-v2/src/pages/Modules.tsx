/**
 * Module Catalog page — D-020 redesign.
 *
 * Single-surface bnkhealth shape: bold heading + actions, KPI strip, filter
 * dropdowns (source, category, platform) + search, single sortable table in
 * a SectionCard. Source/category in-page sidebar dropped; grid view dropped.
 */

import { useState, useMemo, memo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCard } from "@/components/ui/section-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ModuleDetailSheet } from "@/components/modules/ModuleDetailSheet";
import { AddModuleToProjectDialog } from "@/components/modules/AddModuleToProjectDialog";
import { ModuleSourcesDialog } from "@/components/modules/ModuleSourcesDialog";
import { RegistryBrowseDialog } from "@/components/modules/RegistryBrowseDialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useModuleLibrary, useSyncModuleLibrary } from "@/hooks/useModules";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import { useModuleSources } from "@/hooks/useModuleSources";
import { cn } from "@/lib/utils";
import {
  Search,
  Package,
  RefreshCw,
  Server,
  Shield,
  GitBranch,
  Plus,
  Settings,
  Globe,
  ArrowUpCircle,
  Eye,
  MoreVertical,
  Database,
  Cloud,
  Network,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Zap,
  LayoutGrid,
  Table2,
  Layers,
} from "lucide-react";
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
import type { ModuleLibrary, ModuleSource } from "@/types";
import { compareBlueprintVersions } from "@/components/catalog/blueprintVersionUtils";
import {
  getEnginePresentation,
  resolveModuleEngineType,
} from "@/lib/module-engine";

// Show 40 modules at a time, click "Show more" to load more.
const INITIAL_MODULES_LIMIT = 40;

type ArchitectureLayerKey =
  | "all"
  | "layer-1"
  | "layer-2"
  | "layer-3"
  | "layer-4"
  | "layer-5";

const ARCHITECTURE_LAYER_OPTIONS: Array<{
  value: ArchitectureLayerKey;
  label: string;
  sectionTitle: string;
  sectionSubtitle: string;
}> = [
  {
    value: "all",
    label: "All Layers",
    sectionTitle: "All Modules",
    sectionSubtitle: "",
  },
  {
    value: "layer-1",
    label: "Step 1 · Cloud & DPU Infra",
    sectionTitle: "Step 1 · Cloud, Bare-Metal & DPU Infrastructure",
    sectionSubtitle:
      "VPCs, multi-NIC worker node groups, cloud Kubernetes clusters, and BlueField-3 DPU provisioning",
  },
  {
    value: "layer-2",
    label: "Step 2 · K8s Foundation & CNI",
    sectionTitle: "Step 2 · Kubernetes Foundation, CNI & Node Tuning",
    sectionSubtitle:
      "Multus CNI, HugePages 2Mi node tuning, Jetstack cert-manager, CWC certificates, and pull-secret prerequisites",
  },
  {
    value: "layer-3",
    label: "Step 3 · F5 BNK Platform",
    sectionTitle: "Step 3 · F5 BIG-IP Next for Kubernetes (BNK)",
    sectionSubtitle:
      "BNK CRDs, F5 Lifecycle Operator (FLO), CNEInstance (TMM + BGP + CWC), and Gateway API classes",
  },
  {
    value: "layer-4",
    label: "Step 4 · AI, Observability & Apps",
    sectionTitle: "Step 4 · AI Gateway, Observability & Workloads",
    sectionSubtitle:
      "OpenTelemetry, Prometheus/Grafana telemetry, AI Gateway routing, and verification workloads",
  },
  {
    value: "layer-5",
    label: "CLI Reference",
    sectionTitle: "CLI Orchestrator Reference",
    sectionSubtitle: "Reference CLI orchestrator wrappers and tooling",
  },
];

const CATEGORY_LABELS: Record<
  string,
  {
    label: string;
    shortLabel: string;
    order: number;
    layerKey: Exclude<ArchitectureLayerKey, "all">;
    badgeClass: string;
    icon: typeof Package;
  }
> = {
  infrastructure: {
    label: "Step 1 · Cloud Infra",
    shortLabel: "Infrastructure",
    order: 1,
    layerKey: "layer-1",
    badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    icon: Server,
  },
  infra: {
    label: "Step 1 · Cloud Infra",
    shortLabel: "Infrastructure",
    order: 1,
    layerKey: "layer-1",
    badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    icon: Server,
  },
  "bare-metal": {
    label: "Step 1 · Bare Metal & DPU",
    shortLabel: "Bare Metal & DPU",
    order: 1,
    layerKey: "layer-1",
    badgeClass: "border-purple-500/40 bg-purple-500/10 text-purple-400",
    icon: Server,
  },
  compute: {
    label: "Step 1 · Compute",
    shortLabel: "Compute",
    order: 1,
    layerKey: "layer-1",
    badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    icon: Server,
  },
  k8s: {
    label: "Step 2 · K8s & CNI",
    shortLabel: "Kubernetes & CNI",
    order: 2,
    layerKey: "layer-2",
    badgeClass: "border-cyan-500/40 bg-cyan-500/10 text-cyan-400",
    icon: Cloud,
  },
  kubernetes: {
    label: "Step 2 · K8s & CNI",
    shortLabel: "Kubernetes",
    order: 2,
    layerKey: "layer-2",
    badgeClass: "border-cyan-500/40 bg-cyan-500/10 text-cyan-400",
    icon: Cloud,
  },
  networking: {
    label: "Step 2 · Networking",
    shortLabel: "Networking",
    order: 2,
    layerKey: "layer-2",
    badgeClass: "border-sky-500/40 bg-sky-500/10 text-sky-400",
    icon: Network,
  },
  security: {
    label: "Step 2 · Security",
    shortLabel: "Security",
    order: 2,
    layerKey: "layer-2",
    badgeClass: "border-rose-500/40 bg-rose-500/10 text-rose-400",
    icon: Shield,
  },
  storage: {
    label: "Step 2 · Storage",
    shortLabel: "Storage",
    order: 2,
    layerKey: "layer-2",
    badgeClass: "border-indigo-500/40 bg-indigo-500/10 text-indigo-400",
    icon: Database,
  },
  bnk: {
    label: "Step 3 · F5 BNK Platform",
    shortLabel: "BNK / F5",
    order: 3,
    layerKey: "layer-3",
    badgeClass: "border-primary/40 bg-primary/10 text-primary",
    icon: Shield,
  },
  app: {
    label: "Step 4 · Apps & AI",
    shortLabel: "Apps & Observability",
    order: 4,
    layerKey: "layer-4",
    badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    icon: Package,
  },
  solution: {
    label: "Step 4 · Apps & AI",
    shortLabel: "Solutions",
    order: 4,
    layerKey: "layer-4",
    badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    icon: Package,
  },
  "cli-bnkctl": {
    label: "CLI Reference",
    shortLabel: "CLI Orchestrator",
    order: 5,
    layerKey: "layer-5",
    badgeClass: "border-slate-500/40 bg-slate-500/10 text-slate-300",
    icon: Package,
  },
  other: {
    label: "General",
    shortLabel: "General",
    order: 6,
    layerKey: "layer-4",
    badgeClass: "border-border text-muted-foreground",
    icon: Package,
  },
};

function resolveModuleCategoryKey(m: ModuleLibrary): string {
  const normPath = (m.path || "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (normPath.startsWith("bare-metal/bnk-") || normPath.startsWith("bnk/")) {
    return "bnk";
  }
  if (
    normPath.startsWith("k8s/") ||
    normPath === "bare-metal/cert-manager" ||
    normPath === "bare-metal/network-setup" ||
    normPath.startsWith("bare-metal/install-")
  ) {
    return "k8s";
  }
  if (normPath.startsWith("dpu/")) {
    return "bare-metal";
  }
  const key = (m.category || "other").toLowerCase();
  return CATEGORY_LABELS[key] ? key : "other";
}

function resolveCategoryConfig(
  categoryOrModule?: string | ModuleLibrary | null,
) {
  if (categoryOrModule && typeof categoryOrModule === "object") {
    const key = resolveModuleCategoryKey(categoryOrModule);
    return CATEGORY_LABELS[key] || CATEGORY_LABELS.other;
  }
  const key = (categoryOrModule || "other").toLowerCase();
  return CATEGORY_LABELS[key] || CATEGORY_LABELS.other;
}

const FRONTEND_PATH_TO_CANONICAL_SLUG: Record<string, string> = {
  "k8s/bnk-cert-issuer": "bnk-cert-issuer",
  "modules/bnk-cert-issuer": "bnk-cert-issuer",
  "modules/eks-cluster-install-cert-issuer": "bnk-cert-issuer",
  "bare-metal/bnk-cert-issuer": "bnk-cert-issuer",
  "k8s/bnk-prerequisites": "bnk-prerequisites",
  "modules/bnk-prerequisites": "bnk-prerequisites",
  "modules/eks-cluster-install-bnk-prereqs": "bnk-prerequisites",
  "bare-metal/bnk-prerequisites": "bnk-prerequisites",
  "k8s/cert-manager": "cert-manager",
  "modules/cert-manager": "cert-manager",
  "modules/eks-cluster-install-cert-manager": "cert-manager",
  "bare-metal/cert-manager": "cert-manager",
  "k8s/hugepages": "install-hugepages",
  "modules/install-hugepages": "install-hugepages",
  "modules/eks-cluster-install-hugepages": "install-hugepages",
  "bare-metal/install-hugepages": "install-hugepages",
  "k8s/multus": "install-multus",
  "modules/install-multus": "install-multus",
  "modules/eks-cluster-install-multus": "install-multus",
  "bare-metal/install-multus": "install-multus",
  "k8s/network-setup": "network-setup",
  "bare-metal/network-setup": "network-setup",
  "bnk/f5-bnk-2.4.1": "f5-bnk-2.4.1",
  "modules/eks-cluster-bnk241-install": "f5-bnk-2.4.1",
  "bnk/f5-bnk-2.3": "f5-bnk-2.3",
  "modules/eks-cluster-bnk-install": "f5-bnk-2.3",
  "bare-metal/bnk-install": "f5-bnk-2.3",
  "bnk/f5-bnk-2.2": "f5-bnk-2.2",
  "bnk/flo": "flo",
  "modules/eks-cluster-install-flo": "flo",
  "bare-metal/bnk-flo": "flo",
  "bnk/cneinstance": "cneinstance",
  "modules/eks-cluster-cneinstall": "cneinstance",
  "bare-metal/bnk-cneinstall": "cneinstance",
  "bare-metal/bnk-cneinstance": "cneinstance",
  "bnk/crds": "bnk-crds",
  "modules/eks-cluster-install-crds": "bnk-crds",
  "bare-metal/bnk-crds": "bnk-crds",
  "bnk/gatewayclass": "bnk-gatewayclass",
  "modules/install-spkvlan-gatewayclass": "bnk-gatewayclass",
  "bare-metal/bnk-gatewayclass": "bnk-gatewayclass",
};

const FRONTEND_CANONICAL_SLUG_TITLES: Record<string, string> = {
  "bnk-cert-issuer": "BNK Certificate Issuer (CWC CA + JWT)",
  "bnk-prerequisites": "BNK Namespace & Pull-Secret Prerequisites",
  "cert-manager": "Jetstack cert-manager",
  "install-hugepages": "HugePages 2Mi Node DaemonSet",
  "install-multus": "Multus CNI Meta-Plugin",
  "network-setup": "Multi-NIC Host Network & Bridge Setup",
  "f5-bnk-2.4.1": "F5 BIG-IP Next for Kubernetes 2.4.1",
  "f5-bnk-2.3": "F5 BIG-IP Next for Kubernetes 2.3.0",
  "f5-bnk-2.2": "F5 BIG-IP Next for Kubernetes 2.2.0",
  flo: "F5 Lifecycle Operator (FLO)",
  cneinstance: "BNK CNEInstance (TMM + BGP + CWC)",
  "bnk-crds": "BNK Custom Resource Definitions (CRDs)",
  "bnk-gatewayclass": "Gateway API & SPKVLAN GatewayClass",
  "eks-cluster-create": "AWS EKS Cluster Provisioning",
  "eks-cluster-create-with-hp-nodes": "AWS EKS Cluster + Multi-NIC HP Nodes",
  "eks-cluster-existing": "AWS EKS Register Existing Cluster",
  "eks-cluster-existing-with-hp-nodes": "AWS EKS Existing Cluster + HP Nodes",
  "eks-cluster-add-hp-nodes": "AWS EKS Multi-NIC TMM Node Group",
  "eks-cluster-bastion": "AWS EKS Bastion Jumphost",
  "eks-cluster-fixrouting": "AWS EKS Multi-NIC Source Routing Fix",
  "eks-cluster-secrets": "AWS EKS Pull Secrets & License Setup",
  "eks-cluster-install-tmm-nads": "AWS EKS TMM NetworkAttachmentDefinitions",
  "eks-cluster-tmm-heal": "AWS EKS TMM Cold-Start Heal",
  "ibm-roks-single-nic": "IBM Cloud ROKS VPC + Single-NIC Cluster",
  "ibm-roks-existing-cluster": "IBM Cloud ROKS Register Existing Cluster",
  "azure-aks": "Azure AKS Cluster & Multi-NIC Node Pools",
  "gcp-gke": "Google Cloud GKE Cluster & Multi-NIC Pools",
  "bluefield-3-dpu": "NVIDIA BlueField-3 DPU Provisioning",
  "bare-metal/node-setup": "Bare-Metal Node OS & Kernel Prep",
  "bare-metal/install-kubernetes": "Bare-Metal Kubernetes Cluster (kubeadm)",
  "bare-metal/install-calico": "Calico CNI Plugin (Bare-Metal)",
  "bare-metal/install-metallb": "MetalLB LoadBalancer (Bare-Metal)",
};

// eslint-disable-next-line react-refresh/only-export-components
export function resolveModuleCanonicalSlug(m: ModuleLibrary): string {
  const normPath = (m.path || "").trim().replace(/^\/+|\/+$/g, "");
  if (FRONTEND_PATH_TO_CANONICAL_SLUG[normPath]) {
    return FRONTEND_PATH_TO_CANONICAL_SLUG[normPath];
  }
  if (m.module_slug) {
    return m.module_slug.trim().toLowerCase();
  }
  if (normPath.startsWith("bare-metal/")) {
    return normPath.toLowerCase();
  }
  const leaf = normPath.split("/").pop();
  return (leaf || m.name || "unknown").trim().toLowerCase();
}

// eslint-disable-next-line react-refresh/only-export-components
export function resolveModuleDisplayName(m: ModuleLibrary): string {
  const slug = resolveModuleCanonicalSlug(m);
  if (FRONTEND_CANONICAL_SLUG_TITLES[slug]) {
    return FRONTEND_CANONICAL_SLUG_TITLES[slug];
  }
  return m.name;
}

const PLATFORM_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "eks", label: "EKS" },
  { value: "aks", label: "AKS" },
  { value: "gke", label: "GKE" },
  { value: "roks", label: "ROKS" },
  { value: "ocp", label: "OCP" },
  { value: "generic_onprem", label: "On-Prem" },
];

// Sync status helper — small icon, token color.
function getSyncStatusIcon(status: string) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "syncing":
      return <Loader2 className="h-3.5 w-3.5 text-info animate-spin" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

interface DeduplicatedModuleItem {
  primary: ModuleLibrary;
  alternates: ModuleLibrary[];
}

interface ModuleRowProps {
  module: ModuleLibrary;
  alternates?: ModuleLibrary[];
  source: ModuleSource | null;
  sourcesMap: Record<number, ModuleSource>;
  onViewDetails: (module: ModuleLibrary) => void;
  onAddToProject: (module: ModuleLibrary) => void;
}

function useModuleCandidateState(
  initialModule: ModuleLibrary,
  alternates: ModuleLibrary[],
  initialSource: ModuleSource | null,
  sourcesMap: Record<number, ModuleSource>,
) {
  const allCandidates = useMemo(
    () => [initialModule, ...alternates],
    [initialModule, alternates],
  );
  const [selectedSourceOverride, setSelectedSourceOverride] = useState<
    string | null
  >(null);
  const [selectedVersionOverride, setSelectedVersionOverride] = useState<
    string | null
  >(null);

  const distinctSourceCandidates = useMemo(() => {
    const map = new Map<string, ModuleLibrary>();
    for (const c of allCandidates) {
      const key = String(c.module_source_id ?? "builtin");
      if (!map.has(key)) {
        map.set(key, c);
      }
    }
    return Array.from(map.values());
  }, [allCandidates]);

  const activeSourceKey =
    selectedSourceOverride ??
    String(initialModule.module_source_id ?? "builtin");

  const versionsForSource = useMemo(() => {
    const pool = allCandidates.filter(
      (m) => String(m.module_source_id ?? "builtin") === activeSourceKey,
    );
    const effective = pool.length > 0 ? pool : allCandidates;
    return effective
      .slice()
      .sort((a, b) =>
        compareBlueprintVersions(b.version || "", a.version || ""),
      );
  }, [allCandidates, activeSourceKey]);

  const module = useMemo(() => {
    if (selectedVersionOverride) {
      const byVer = versionsForSource.find(
        (m) => (m.version || "1.0.0") === selectedVersionOverride,
      );
      if (byVer) return byVer;
    }
    return versionsForSource[0] || initialModule;
  }, [versionsForSource, initialModule, selectedVersionOverride]);

  const source = module.module_source_id
    ? sourcesMap[module.module_source_id] || initialSource
    : initialSource;

  return {
    module,
    source,
    distinctSourceCandidates,
    activeSourceKey,
    versionsForSource,
    setSelectedSourceOverride,
    setSelectedVersionOverride,
  };
}

const ModuleCard = memo(function ModuleCard({
  module: initialModule,
  alternates = [],
  source: initialSource,
  sourcesMap,
  onViewDetails,
  onAddToProject,
}: ModuleRowProps) {
  const {
    module,
    source,
    distinctSourceCandidates,
    activeSourceKey,
    versionsForSource,
    setSelectedSourceOverride,
    setSelectedVersionOverride,
  } = useModuleCandidateState(
    initialModule,
    alternates,
    initialSource,
    sourcesMap,
  );

  const cat = resolveCategoryConfig(module);
  const engine = getEnginePresentation(
    resolveModuleEngineType(module),
    module.module_type,
  );
  const CategoryIcon = cat.icon;
  const deps = module.dependencies || [];
  const tags = module.tags || [];
  const slugLabel = resolveModuleCanonicalSlug(module);
  const displayName = resolveModuleDisplayName(module);

  return (
    <div
      onClick={() => onViewDetails(module)}
      className="group flex flex-col justify-between rounded-xl border border-border bg-card/60 p-4 shadow-sm transition-colors hover:border-primary/40 cursor-pointer"
    >
      <div className="space-y-2.5">
        {/* Top Row: Category Badge + Engine Badge + Version */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-2 py-0.5 font-medium",
                cat.badgeClass,
              )}
            >
              {cat.shortLabel}
            </Badge>
            <Badge variant="muted" className="text-[10px] px-2 py-0.5 gap-1">
              <Zap className="h-2.5 w-2.5" />
              {engine.label}
            </Badge>
          </div>

          <div
            className="flex items-center gap-1.5 shrink-0"
            onClick={(e) => {
              if (versionsForSource.length > 1) e.stopPropagation();
            }}
          >
            {versionsForSource.length > 1 ? (
              <Select
                value={module.version || "1.0.0"}
                onValueChange={(val) => setSelectedVersionOverride(val)}
              >
                <SelectTrigger
                  aria-label={`Select version for ${module.name}`}
                  className="h-6 w-auto min-w-[110px] whitespace-nowrap gap-1 rounded border border-border bg-card px-2 py-0 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versionsForSource.map((v, idx) => (
                    <SelectItem
                      key={v.id}
                      value={v.version || "1.0.0"}
                      className="text-xs font-mono"
                    >
                      v{v.version || "1.0.0"}
                      {idx === 0 ? " (Latest)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">
                v{module.version || "1.0.0"}
              </span>
            )}
          </div>
        </div>

        {/* Title + Slug + Description */}
        <div>
          <div className="flex items-start gap-2">
            <CategoryIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h4 className="font-semibold text-sm text-foreground leading-snug">
                  {displayName}
                </h4>
                {slugLabel &&
                  slugLabel.toLowerCase() !== displayName.toLowerCase() && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {slugLabel}
                    </span>
                  )}
              </div>
              {(module.description || module.path) && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                  {module.description || module.path}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Tags + Dependencies compact pills */}
        {(tags.length > 0 || deps.length > 0) && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {deps.length > 0 && (
              <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                {deps.length} dep{deps.length === 1 ? "" : "s"}
              </span>
            )}
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded border border-border/60 bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer: Source + Actions */}
      <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between gap-2">
        <div
          className="flex items-center gap-1.5 min-w-0"
          onClick={(e) => {
            if (distinctSourceCandidates.length > 1) e.stopPropagation();
          }}
        >
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {distinctSourceCandidates.length > 1 ? (
            <Select
              value={activeSourceKey}
              onValueChange={(val) => {
                setSelectedSourceOverride(val);
                setSelectedVersionOverride(null);
              }}
            >
              <SelectTrigger
                aria-label={`Select source for ${module.name}`}
                className="h-6 w-auto max-w-[155px] gap-1 truncate rounded border border-border bg-card px-1.5 py-0 text-[11px] text-foreground focus:ring-1 focus:ring-primary"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {distinctSourceCandidates.map((cand) => {
                  const s = cand.module_source_id
                    ? sourcesMap[cand.module_source_id]
                    : null;
                  const key = String(cand.module_source_id ?? "builtin");
                  const label =
                    s?.name ||
                    (cand.module_source_id == null
                      ? "Built-in"
                      : `Source #${cand.module_source_id}`);
                  return (
                    <SelectItem
                      key={`${key}-${cand.id}`}
                      value={key}
                      className="text-xs"
                    >
                      {label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">
              {source?.name || "Built-in"}
            </span>
          )}
          {source && getSyncStatusIcon(source.sync_status)}
        </div>

        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onViewDetails(module)}
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            Details
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => onAddToProject(module)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
});

const ModuleRow = memo(function ModuleRow({
  module: initialModule,
  alternates = [],
  source: initialSource,
  sourcesMap,
  onViewDetails,
  onAddToProject,
}: ModuleRowProps) {
  const {
    module,
    source,
    distinctSourceCandidates,
    activeSourceKey,
    versionsForSource,
    setSelectedSourceOverride,
    setSelectedVersionOverride,
  } = useModuleCandidateState(
    initialModule,
    alternates,
    initialSource,
    sourcesMap,
  );

  const cat = resolveCategoryConfig(module);
  const engine = getEnginePresentation(
    resolveModuleEngineType(module),
    module.module_type,
  );
  const CategoryIcon = cat.icon;
  const deps = module.dependencies || [];
  const tags = module.tags || [];
  const slugLabel = resolveModuleCanonicalSlug(module);
  const displayName = resolveModuleDisplayName(module);

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/40 transition-colors"
      onClick={() => onViewDetails(module)}
    >
      <TableCell className="px-4 py-3">
        <div className="flex items-start gap-3">
          <CategoryIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-foreground text-sm">
                {displayName}
              </span>
              {slugLabel &&
                slugLabel.toLowerCase() !== displayName.toLowerCase() && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {slugLabel}
                  </span>
                )}
              {deps.length > 0 && (
                <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                  {deps.length} dep{deps.length === 1 ? "" : "s"}
                </span>
              )}
              {tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-border/60 bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
            {(module.description || module.category) && (
              <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {module.description || `${module.category}/${module.name}`}
              </div>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="px-3 py-3 whitespace-nowrap">
        <Badge
          variant="outline"
          className={cn(
            "whitespace-nowrap text-xs font-medium",
            cat.badgeClass,
          )}
        >
          {cat.label}
        </Badge>
      </TableCell>
      <TableCell className="px-3 py-3">
        {source || distinctSourceCandidates.length > 1 ? (
          <div
            className="flex flex-col gap-1 min-w-0"
            onClick={(e) => {
              if (distinctSourceCandidates.length > 1) e.stopPropagation();
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {distinctSourceCandidates.length > 1 ? (
                <Select
                  value={activeSourceKey}
                  onValueChange={(val) => {
                    setSelectedSourceOverride(val);
                    setSelectedVersionOverride(null);
                  }}
                >
                  <SelectTrigger
                    aria-label={`Select source for ${module.name}`}
                    className="h-6 w-auto max-w-[160px] gap-1 truncate rounded border border-border bg-card px-1.5 py-0 text-xs text-foreground focus:ring-1 focus:ring-primary"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {distinctSourceCandidates.map((cand) => {
                      const s = cand.module_source_id
                        ? sourcesMap[cand.module_source_id]
                        : null;
                      const key = String(cand.module_source_id ?? "builtin");
                      const label =
                        s?.name ||
                        (cand.module_source_id == null
                          ? "Built-in"
                          : `Source #${cand.module_source_id}`);
                      return (
                        <SelectItem
                          key={`${key}-${cand.id}`}
                          value={key}
                          className="text-xs"
                        >
                          {label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-xs text-foreground/80 truncate max-w-[150px]">
                  {source?.name || "Built-in"}
                </span>
              )}
              {source && getSyncStatusIcon(source.sync_status)}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="px-3 py-3 whitespace-nowrap">
        <Badge variant="muted" className="whitespace-nowrap text-xs gap-1">
          <Zap className="h-3 w-3" />
          {engine.label}
        </Badge>
      </TableCell>
      <TableCell
        className="px-3 py-3 whitespace-nowrap"
        onClick={(e) => {
          if (versionsForSource.length > 1) e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-2">
          {versionsForSource.length > 1 ? (
            <Select
              value={module.version || "1.0.0"}
              onValueChange={(val) => setSelectedVersionOverride(val)}
            >
              <SelectTrigger
                aria-label={`Select version for ${module.name}`}
                className="h-6 w-auto min-w-[130px] whitespace-nowrap gap-1.5 rounded border border-border bg-card px-2 py-0 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versionsForSource.map((v, idx) => (
                  <SelectItem
                    key={v.id}
                    value={v.version || "1.0.0"}
                    className="text-xs font-mono"
                  >
                    v{v.version || "1.0.0"}
                    {idx === 0 ? " (Latest)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm font-mono text-foreground/80">
              v{module.version || "1.0.0"}
            </span>
          )}
          {module.is_latest === false && (
            <Badge variant="outline" className="text-xs">
              older
            </Badge>
          )}
          {module.update_available && module.latest_version && (
            <Badge variant="info" className="text-xs gap-1">
              <ArrowUpCircle className="h-3 w-3" />
              {module.latest_version}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="px-4 py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="Module actions"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onViewDetails(module);
              }}
            >
              <Eye className="h-4 w-4 mr-2" />
              View details
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onAddToProject(module);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add to project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});

export default function Modules({ embedded }: { embedded?: boolean } = {}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(
    undefined,
  );
  const [selectedLayer, setSelectedLayer] =
    useState<ArchitectureLayerKey>("all");
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string | undefined>(
    undefined,
  );
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [showAllModules, setShowAllModules] = useState(false);
  // D-033: the catalog holds one row per module version; default to the
  // latest version of each path with an opt-in to see full version history.
  const [showAllVersions, setShowAllVersions] = useState(false);

  // Detail / dialog state
  const [selectedModule, setSelectedModule] = useState<ModuleLibrary | null>(
    null,
  );
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [sourcesDialogOpen, setSourcesDialogOpen] = useState(false);
  const [registryBrowseDialogOpen, setRegistryBrowseDialogOpen] =
    useState(false);

  const {
    data: modules,
    isLoading: isLoadingModules,
    isError,
    error,
    refetch,
  } = useModuleLibrary({
    search: searchTerm || undefined,
    category: selectedCategory,
  });
  const syncLibraryMutation = useSyncModuleLibrary();
  const { data: sources, isLoading: isLoadingSources } = useModuleSources();

  // Lookup: source_id → source
  const sourcesMap = useMemo(() => {
    const map: Record<number, ModuleSource> = {};
    (sources || []).forEach((s) => {
      map[s.id] = s;
    });
    return map;
  }, [sources]);

  // Available categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    (modules || []).forEach((m) => {
      if (m.category) set.add(m.category);
    });
    return Array.from(set).sort();
  }, [modules]);

  const olderVersionCount = useMemo(
    () => (modules || []).filter((m) => m.is_latest === false).length,
    [modules],
  );

  const dedupedAllLayers = useMemo((): DeduplicatedModuleItem[] => {
    let baseFiltered = modules || [];
    if (selectedSourceId !== null) {
      baseFiltered = baseFiltered.filter(
        (m) => m.module_source_id === selectedSourceId,
      );
    }
    if (selectedPlatform) {
      baseFiltered = baseFiltered.filter((m) => {
        const compat = m.platform_compatibility;
        if (!compat || compat.declared_any) return true;
        return compat.supported_profiles?.includes(selectedPlatform);
      });
    }

    // When showing latest versions across all sources, deduplicate identical canonical slugs
    // so each module appears once with inline source and version selectors.
    if (!showAllVersions && selectedSourceId === null) {
      const bySlug = new Map<string, ModuleLibrary[]>();
      for (const m of baseFiltered) {
        const canonicalKey = resolveModuleCanonicalSlug(m);
        const bucket = bySlug.get(canonicalKey) ?? [];
        bucket.push(m);
        bySlug.set(canonicalKey, bucket);
      }

      const deduped: DeduplicatedModuleItem[] = [];
      for (const bucket of bySlug.values()) {
        // Sort candidates: prefer non-SSH / Git-sourced modules, official source, canonical shared module path, highest semver, then source id
        const sortedBucket = bucket.slice().sort((a, b) => {
          const aIsLegacySsh =
            resolveModuleEngineType(a) === "ssh" && a.module_source_id == null;
          const bIsLegacySsh =
            resolveModuleEngineType(b) === "ssh" && b.module_source_id == null;
          if (aIsLegacySsh !== bIsLegacySsh) {
            return aIsLegacySsh ? 1 : -1;
          }
          if (Boolean(a.is_official) !== Boolean(b.is_official)) {
            return a.is_official ? -1 : 1;
          }
          const aIsLegacyEksPath = Boolean(
            a.path?.startsWith("modules/eks-cluster-"),
          );
          const bIsLegacyEksPath = Boolean(
            b.path?.startsWith("modules/eks-cluster-"),
          );
          if (aIsLegacyEksPath !== bIsLegacyEksPath) {
            return aIsLegacyEksPath ? 1 : -1;
          }
          const verCmp = compareBlueprintVersions(
            b.version || "",
            a.version || "",
          );
          if (verCmp !== 0) return verCmp;
          const sa = a.module_source_id ?? 9999;
          const sb = b.module_source_id ?? 9999;
          return sa - sb;
        });
        deduped.push({
          primary: sortedBucket[0],
          alternates: sortedBucket.slice(1),
        });
      }

      return deduped.sort((a, b) => {
        const catA = resolveCategoryConfig(a.primary);
        const catB = resolveCategoryConfig(b.primary);
        if (catA.order !== catB.order) return catA.order - catB.order;
        const aSsh =
          resolveModuleEngineType(a.primary) === "ssh" &&
          a.primary.module_source_id == null;
        const bSsh =
          resolveModuleEngineType(b.primary) === "ssh" &&
          b.primary.module_source_id == null;
        if (aSsh !== bSsh) return aSsh ? 1 : -1;
        const orderA = a.primary.deployment_order ?? 50;
        const orderB = b.primary.deployment_order ?? 50;
        if (orderA !== orderB) return orderA - orderB;
        const nameA = resolveModuleDisplayName(a.primary);
        const nameB = resolveModuleDisplayName(b.primary);
        if (nameA !== nameB) return nameA.localeCompare(nameB);
        return compareBlueprintVersions(
          b.primary.version || "",
          a.primary.version || "",
        );
      });
    }

    const filtered = !showAllVersions
      ? baseFiltered.filter((m) => m.is_latest !== false)
      : baseFiltered;

    return filtered
      .slice()
      .sort((a, b) => {
        const catA = resolveCategoryConfig(a);
        const catB = resolveCategoryConfig(b);
        if (catA.order !== catB.order) return catA.order - catB.order;
        const aSsh =
          resolveModuleEngineType(a) === "ssh" && a.module_source_id == null;
        const bSsh =
          resolveModuleEngineType(b) === "ssh" && b.module_source_id == null;
        if (aSsh !== bSsh) return aSsh ? 1 : -1;
        const nameA = resolveModuleDisplayName(a);
        const nameB = resolveModuleDisplayName(b);
        if (nameA !== nameB) return nameA.localeCompare(nameB);
        return compareBlueprintVersions(b.version || "", a.version || "");
      })
      .map((m) => ({ primary: m, alternates: [] }));
  }, [modules, selectedSourceId, selectedPlatform, showAllVersions]);

  const layerCounts = useMemo(() => {
    const counts: Record<ArchitectureLayerKey, number> = {
      all: dedupedAllLayers.length,
      "layer-1": 0,
      "layer-2": 0,
      "layer-3": 0,
      "layer-4": 0,
      "layer-5": 0,
    };
    for (const item of dedupedAllLayers) {
      const cfg = resolveCategoryConfig(item.primary);
      counts[cfg.layerKey] = (counts[cfg.layerKey] || 0) + 1;
    }
    return counts;
  }, [dedupedAllLayers]);

  const displayModules = useMemo(() => {
    if (selectedLayer === "all") return dedupedAllLayers;
    return dedupedAllLayers.filter(
      (item) => resolveCategoryConfig(item.primary).layerKey === selectedLayer,
    );
  }, [dedupedAllLayers, selectedLayer]);

  const limited = showAllModules
    ? displayModules
    : displayModules.slice(0, INITIAL_MODULES_LIMIT);
  const hasMore = displayModules.length > INITIAL_MODULES_LIMIT;

  const groupedByLayer = useMemo(() => {
    const groups: Array<{
      layerKey: Exclude<ArchitectureLayerKey, "all">;
      sectionTitle: string;
      sectionSubtitle: string;
      items: DeduplicatedModuleItem[];
    }> = [];
    const layerOrder: Array<Exclude<ArchitectureLayerKey, "all">> = [
      "layer-1",
      "layer-2",
      "layer-3",
      "layer-4",
      "layer-5",
    ];
    for (const lk of layerOrder) {
      const items = limited.filter(
        (item) => resolveCategoryConfig(item.primary).layerKey === lk,
      );
      if (items.length === 0) continue;
      const meta = ARCHITECTURE_LAYER_OPTIONS.find((o) => o.value === lk)!;
      groups.push({
        layerKey: lk,
        sectionTitle: meta.sectionTitle,
        sectionSubtitle: meta.sectionSubtitle,
        items,
      });
    }
    return groups;
  }, [limited]);

  // Sync status roll-up for the KPI strip.
  const syncStats = useMemo(() => {
    const counts = { ok: 0, syncing: 0, failed: 0, unknown: 0 };
    (sources || []).forEach((s) => {
      switch (s.sync_status) {
        case "success":
          counts.ok++;
          break;
        case "syncing":
          counts.syncing++;
          break;
        case "failed":
          counts.failed++;
          break;
        default:
          counts.unknown++;
      }
    });
    return counts;
  }, [sources]);

  const handleViewDetails = useCallback((module: ModuleLibrary) => {
    setSelectedModule(module);
    setDetailSheetOpen(true);
  }, []);

  const handleAddToProject = useCallback((module: ModuleLibrary) => {
    setSelectedModule(module);
    setAddDialogOpen(true);
  }, []);

  const { refresh, isRefreshing } = usePageRefresh();

  const isLoading = isLoadingModules || isLoadingSources;

  const subtitle = isLoading
    ? "Loading modules…"
    : `${dedupedAllLayers.length} canonical modules (${modules?.length || 0} releases) across ${sources?.length || 0} source${sources?.length === 1 ? "" : "s"}`;

  const Wrapper = embedded ? "div" : PageShell;

  return (
    <Wrapper className={embedded ? "space-y-6" : undefined}>
      {/* Header */}
      {!embedded ? (
        <PageHeader
          title="Module Catalog"
          subtitle={subtitle}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
          actions={
            <>
              <Button
                onClick={() => setSourcesDialogOpen(true)}
                variant="outline"
                size="sm"
              >
                <Settings className="h-4 w-4 mr-1.5" />
                Sources
              </Button>
              <Button
                onClick={() => setRegistryBrowseDialogOpen(true)}
                variant="outline"
                size="sm"
              >
                <Globe className="h-4 w-4 mr-1.5" />
                Browse registry
              </Button>
              <Button
                onClick={() => syncLibraryMutation.mutate(false)}
                disabled={syncLibraryMutation.isPending}
                variant="default"
                size="sm"
              >
                <RefreshCw
                  className={cn(
                    "h-4 w-4 mr-1.5",
                    syncLibraryMutation.isPending && "animate-spin",
                  )}
                />
                Sync all
              </Button>
            </>
          }
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setSourcesDialogOpen(true)}
              variant="outline"
              size="sm"
            >
              <Settings className="h-4 w-4 mr-1.5" />
              Sources
            </Button>
            <Button
              onClick={() => setRegistryBrowseDialogOpen(true)}
              variant="outline"
              size="sm"
            >
              <Globe className="h-4 w-4 mr-1.5" />
              Browse registry
            </Button>
            <Button
              onClick={() => syncLibraryMutation.mutate(false)}
              disabled={syncLibraryMutation.isPending}
              variant="default"
              size="sm"
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4 mr-1.5",
                  syncLibraryMutation.isPending && "animate-spin",
                )}
              />
              Sync all
            </Button>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Modules",
            value: modules?.length || 0,
            tone: "foreground" as const,
          },
          {
            label: "Sources OK",
            value: syncStats.ok,
            tone: "success" as const,
          },
          { label: "Syncing", value: syncStats.syncing, tone: "info" as const },
          {
            label: "Sync failed",
            value: syncStats.failed,
            tone: "destructive" as const,
          },
        ].map((tile) => {
          const toneText =
            tile.tone === "success"
              ? "text-success"
              : tile.tone === "info"
                ? "text-info"
                : tile.tone === "destructive"
                  ? "text-destructive"
                  : "text-foreground";
          return (
            <div
              key={tile.label}
              className="rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="text-xs text-muted-foreground">{tile.label}</div>
              <div
                className={cn("text-2xl font-bold mt-1 tabular-nums", toneText)}
              >
                {tile.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-80 max-w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, category, or provider…"
              aria-label="Search modules"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          {(sources?.length || 0) > 0 && (
            <Select
              value={
                selectedSourceId !== null ? String(selectedSourceId) : "all"
              }
              onValueChange={(val) =>
                setSelectedSourceId(val === "all" ? null : Number(val))
              }
            >
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {(sources || []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {categories.length > 0 && (
            <Select
              value={selectedCategory || "all"}
              onValueChange={(val) =>
                setSelectedCategory(val === "all" ? undefined : val)
              }
            >
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c.toLowerCase()]?.label || c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select
            value={selectedPlatform || "all"}
            onValueChange={(val) =>
              setSelectedPlatform(val === "all" ? undefined : val)
            }
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="All platforms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              {PLATFORM_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {olderVersionCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={showAllVersions}
                onChange={(e) => setShowAllVersions(e.target.checked)}
              />
              All versions ({olderVersionCount} older)
            </label>
          )}

          {/* View mode toggle: Cards vs Table */}
          <div
            className="ml-auto inline-flex rounded-md border border-border bg-card p-0.5"
            role="group"
            aria-label="Catalog view mode"
          >
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                viewMode === "cards"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
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
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={viewMode === "table"}
            >
              <Table2 className="h-3.5 w-3.5" />
              Table
            </button>
          </div>
        </div>

        {/* Architectural Layer quick-filter pills */}
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter modules by architectural layer"
        >
          <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            Architecture Layer:
          </span>
          {ARCHITECTURE_LAYER_OPTIONS.map((opt) => {
            const count = layerCounts[opt.value] || 0;
            if (opt.value !== "all" && count === 0) return null;
            const active = selectedLayer === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setSelectedLayer(opt.value);
                  setShowAllModules(false);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-muted-foreground border-border hover:text-foreground",
                )}
              >
                <span>{opt.label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[10px] tabular-nums",
                    active
                      ? "bg-background/20 text-background"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content: Cards (grouped by Step) or Compact Table */}
      {isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <SectionCard compact>
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        </SectionCard>
      ) : displayModules.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No modules found"
          description={
            searchTerm
              ? `No modules match "${searchTerm}"`
              : "Add a module source or browse the registry to populate the catalog."
          }
          action={{
            label: "Browse registry",
            onClick: () => setRegistryBrowseDialogOpen(true),
            icon: <Globe className="h-4 w-4 mr-1.5" />,
          }}
        />
      ) : viewMode === "cards" ? (
        <div className="space-y-6">
          {groupedByLayer.map((group) => (
            <div key={group.layerKey} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2">
                <div>
                  <h3 className="text-sm font-semibold tracking-tight text-foreground">
                    {group.sectionTitle}
                  </h3>
                  {group.sectionSubtitle && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {group.sectionSubtitle}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className="text-xs tabular-nums">
                  {group.items.length} module
                  {group.items.length === 1 ? "" : "s"}
                </Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((item) => {
                  const module = item.primary;
                  return (
                    <ModuleCard
                      key={`${module.module_source_id ?? 0}-${module.module_slug || module.name}-${module.version ?? ""}`}
                      module={module}
                      alternates={item.alternates}
                      sourcesMap={sourcesMap}
                      source={
                        module.module_source_id
                          ? sourcesMap[module.module_source_id] || null
                          : null
                      }
                      onViewDetails={handleViewDetails}
                      onAddToProject={handleAddToProject}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {!showAllModules && hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllModules(true)}
              >
                Show {displayModules.length - INITIAL_MODULES_LIMIT} more
              </Button>
            </div>
          )}
          {showAllModules && hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllModules(false)}
              >
                Show less
              </Button>
            </div>
          )}
        </div>
      ) : (
        <SectionCard
          title={`${displayModules.length} ${displayModules.length === 1 ? "module" : "modules"}`}
          compact
        >
          <div className="overflow-x-auto -mx-4">
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="text-xs uppercase tracking-wider text-muted-foreground">
                  <TableHead className="text-left font-medium px-4 py-2">
                    Module
                  </TableHead>
                  <TableHead className="text-left font-medium px-3 py-2">
                    Layer
                  </TableHead>
                  <TableHead className="text-left font-medium px-3 py-2">
                    Source
                  </TableHead>
                  <TableHead className="text-left font-medium px-3 py-2">
                    Engine
                  </TableHead>
                  <TableHead className="text-left font-medium px-3 py-2">
                    Version
                  </TableHead>
                  <TableHead className="text-right font-medium px-4 py-2 w-14">
                    {/* actions */}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {limited.map((item) => {
                  const module = item.primary;
                  return (
                    <ModuleRow
                      key={`${module.module_source_id ?? 0}-${module.module_slug || module.name}-${module.version ?? ""}`}
                      module={module}
                      alternates={item.alternates}
                      sourcesMap={sourcesMap}
                      source={
                        module.module_source_id
                          ? sourcesMap[module.module_source_id] || null
                          : null
                      }
                      onViewDetails={handleViewDetails}
                      onAddToProject={handleAddToProject}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {!showAllModules && hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllModules(true)}
              >
                Show {displayModules.length - INITIAL_MODULES_LIMIT} more
              </Button>
            </div>
          )}
          {showAllModules && hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllModules(false)}
              >
                Show less
              </Button>
            </div>
          )}
        </SectionCard>
      )}

      {/* Dialogs */}
      {selectedModule && (
        <ModuleDetailSheet
          module={selectedModule}
          open={detailSheetOpen}
          onOpenChange={setDetailSheetOpen}
          onAddToProject={() => {
            setDetailSheetOpen(false);
            setAddDialogOpen(true);
          }}
        />
      )}
      {selectedModule && (
        <AddModuleToProjectDialog
          module={selectedModule}
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
        />
      )}
      <ModuleSourcesDialog
        open={sourcesDialogOpen}
        onOpenChange={setSourcesDialogOpen}
      />
      <RegistryBrowseDialog
        open={registryBrowseDialogOpen}
        onOpenChange={setRegistryBrowseDialogOpen}
      />
    </Wrapper>
  );
}
