/**
 * Semver-tolerant comparator for blueprint version strings.
 *
 * Ordering rules:
 * - Stable semver (e.g. "1.2.3") is always greater than the matching pre-release
 *   (e.g. "1.2.3-ehf-..." or "1.2.3-rc.1").
 * - Two stable semver strings compare numerically, major → minor → patch.
 * - Two pre-release strings compare their base semver first, then lexicographically
 *   by the full string as a tiebreak.
 * - Strings that do not parse as semver at all fall back to lexicographic comparison.
 *
 * Returns a negative number when a < b (i.e. b is newer), positive when a > b.
 * Suitable for `Array.prototype.sort` — pass compareBlueprintVersions directly.
 * To get newest-first: `versions.sort(compareBlueprintVersions).reverse()`
 * or use the exported `sortVersionsDesc` helper.
 */

const SEMVER_RE =
  /^v?(\d+)\.(\d+)(?:\.(\d+)|\.x)?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/i;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string | null; // null means stable
  raw: string;
}

function parseVersion(v: string): ParsedVersion | null {
  if (!v) return null;
  const m = SEMVER_RE.exec(v.trim());
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: m[3] !== undefined ? parseInt(m[3], 10) : 0,
    pre: m[4] ?? null,
    raw: v,
  };
}

/**
 * Normalize BNK release strings ('v2.4.1', '2.4.1', '2.4', '2.3.x', '2.3.0') -> '2.4.1' | '2.3' | '2.2'
 */
export function normalizeBnkVersion(raw?: string | null): string | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (!cleaned) return null;
  if (cleaned.toLowerCase().startsWith("v")) {
    cleaned = cleaned.slice(1).trim();
  }
  if (cleaned === "2.3.x" || cleaned === "2.3.0" || cleaned === "2.3") {
    return "2.3";
  }
  if (
    cleaned === "2.2.x" ||
    cleaned === "2.2.0" ||
    cleaned === "2.2" ||
    cleaned === "2.2+"
  ) {
    return "2.2";
  }
  if (
    cleaned === "2.4" ||
    cleaned === "2.4.x" ||
    cleaned === "2.4.0" ||
    cleaned.startsWith("2.4.1")
  ) {
    return "2.4.1";
  }
  return cleaned;
}

/**
 * Compare two blueprint version strings.
 * Returns positive if a > b (a is newer), negative if a < b, 0 if equal.
 */
export function compareBlueprintVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);

  // If neither parses, fall back to lexicographic
  if (!pa && !pb) return a.localeCompare(b);
  // Non-parseable version is treated as older
  if (!pa) return -1;
  if (!pb) return 1;

  // Compare major.minor.patch numerically
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  // Same base version: stable > pre-release
  if (pa.pre === null && pb.pre !== null) return 1;
  if (pa.pre !== null && pb.pre === null) return -1;
  if (pa.pre !== null && pb.pre !== null) return pa.pre.localeCompare(pb.pre);

  return 0;
}

/** Returns a new array sorted newest-version-first. */
export function sortVersionsDesc<T>(
  items: T[],
  getVersion: (item: T) => string,
): T[] {
  return [...items].sort((a, b) =>
    compareBlueprintVersions(getVersion(b), getVersion(a)),
  );
}

export type DeploymentPatternKey =
  | "full-stack"
  | "existing-cluster"
  | "infra-only"
  | "demo-workload";

export const DEPLOYMENT_PATTERN_LABELS: Record<string, string> = {
  "full-stack": "Full Stack",
  "existing-cluster": "Existing Cluster (BYO K8s)",
  "infra-only": "Infrastructure Only",
  "demo-workload": "Demo Workload",
  greenfield_full_stack: "Full Stack",
  existing_cluster: "Existing Cluster (BYO K8s)",
  existing_cluster_overlay: "Existing Cluster (BYO K8s)",
  infra_foundation: "Infrastructure Only",
  cluster_foundation: "Infrastructure Only",
  demo_workload: "Demo Workload",
  workload_validation: "Demo Workload",
};

export const DEPLOYMENT_PATTERN_OPTIONS: Array<{
  value: "all" | DeploymentPatternKey;
  label: string;
}> = [
  { value: "all", label: "All Patterns" },
  { value: "full-stack", label: "Tier 1 · Full Stack" },
  { value: "existing-cluster", label: "Tier 2 · Existing Cluster (BYO K8s)" },
  { value: "infra-only", label: "Infrastructure Only" },
  { value: "demo-workload", label: "Tier 3 · Demo & AI Workloads" },
];

export type BlueprintProviderKey =
  | "all"
  | "aws"
  | "ibm"
  | "bare-metal"
  | "azure"
  | "gcp"
  | "openshift"
  | "kubernetes";

export function normalizeDeploymentPattern(
  raw?: string | null,
  category?: string | null,
): DeploymentPatternKey {
  if (raw === "greenfield_full_stack" || raw === "full-stack") {
    return "full-stack";
  }
  if (
    raw === "existing_cluster_overlay" ||
    raw === "existing_cluster" ||
    raw === "existing-cluster"
  ) {
    return "existing-cluster";
  }
  if (
    raw === "cluster_foundation" ||
    raw === "infra_foundation" ||
    raw === "infra-only"
  ) {
    return "infra-only";
  }
  if (
    raw === "workload_validation" ||
    raw === "demo_workload" ||
    raw === "demo-workload"
  ) {
    return "demo-workload";
  }
  if (category === "infrastructure") return "infra-only";
  if (category === "application" || category === "solution") {
    return "demo-workload";
  }
  return "existing-cluster";
}

export interface CanonicalBlueprintMeta {
  family_id: string;
  family_name: string;
  deployment_pattern: DeploymentPatternKey;
  variant_key: string;
  variant_label: string;
  bnk_version: string | null;
  is_recommended: boolean;
}

const CANONICAL_BLUEPRINT_META: Record<string, CanonicalBlueprintMeta> = {
  // AWS EKS — F5 BNK Full Stack
  "aws-eks-bnk241-secure": {
    family_id: "aws-eks-bnk",
    family_name: "AWS EKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "secure",
    variant_label: "Secure + Bastion",
    bnk_version: "2.4.1",
    is_recommended: false,
  },
  "aws-eks-bnk241-traffic": {
    family_id: "aws-eks-bnk",
    family_name: "AWS EKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "traffic",
    variant_label: "Traffic-Ready (HP Nodes) (Recommended)",
    bnk_version: "2.4.1",
    is_recommended: true,
  },
  "aws-eks-bnk23-secure": {
    family_id: "aws-eks-bnk",
    family_name: "AWS EKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "secure",
    variant_label: "Secure + Bastion",
    bnk_version: "2.3",
    is_recommended: false,
  },
  "aws-eks-bnk23-traffic": {
    family_id: "aws-eks-bnk",
    family_name: "AWS EKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "traffic",
    variant_label: "Traffic-Ready (HP Nodes) (Recommended)",
    bnk_version: "2.3",
    is_recommended: true,
  },
  "aws-eks-cluster-create": {
    family_id: "aws-eks-bnk",
    family_name: "AWS EKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "standard",
    variant_label: "Standard (Managed Nodes Only)",
    bnk_version: "2.4.1",
    is_recommended: false,
  },
  "aws-eks-cluster-create-with-hp-nodes": {
    family_id: "aws-eks-bnk",
    family_name: "AWS EKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "hp-nodes",
    variant_label: "With HP TMM Nodes (Customizable)",
    bnk_version: "2.4.1",
    is_recommended: false,
  },
  "awsbnkctl-bnk-demo": {
    family_id: "aws-eks-bnk",
    family_name: "AWS EKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "cli-demo",
    variant_label: "CLI Orchestrator (awsbnkctl)",
    bnk_version: "2.4.1",
    is_recommended: false,
  },

  // AWS EKS — F5 BNK on Existing Cluster
  "aws-eks-existing-cluster": {
    family_id: "aws-eks-existing-cluster-bnk",
    family_name: "AWS EKS — F5 BNK on Existing Cluster",
    deployment_pattern: "existing-cluster",
    variant_key: "standard",
    variant_label: "Existing Cluster (Managed Nodes)",
    bnk_version: "2.4.1",
    is_recommended: false,
  },
  "aws-eks-existing-cluster-with-hp-nodes": {
    family_id: "aws-eks-existing-cluster-bnk",
    family_name: "AWS EKS — F5 BNK on Existing Cluster",
    deployment_pattern: "existing-cluster",
    variant_key: "hp-nodes",
    variant_label: "Existing Cluster + HP TMM Nodes",
    bnk_version: "2.4.1",
    is_recommended: false,
  },
  "aws-eks-existing-cluster-bnk241": {
    family_id: "aws-eks-existing-cluster-bnk",
    family_name: "AWS EKS — F5 BNK on Existing Cluster",
    deployment_pattern: "existing-cluster",
    variant_key: "secure",
    variant_label: "Secure + Bastion (Recommended)",
    bnk_version: "2.4.1",
    is_recommended: true,
  },
  "aws-eks-existing-cluster-bnk241-traffic": {
    family_id: "aws-eks-existing-cluster-bnk",
    family_name: "AWS EKS — F5 BNK on Existing Cluster",
    deployment_pattern: "existing-cluster",
    variant_key: "traffic",
    variant_label: "Traffic-Ready",
    bnk_version: "2.4.1",
    is_recommended: false,
  },
  "aws-eks-existing-cluster-traffic": {
    family_id: "aws-eks-existing-cluster-bnk",
    family_name: "AWS EKS — F5 BNK on Existing Cluster",
    deployment_pattern: "existing-cluster",
    variant_key: "traffic",
    variant_label: "Traffic-Ready (BNK 2.3)",
    bnk_version: "2.3",
    is_recommended: false,
  },

  // AWS EKS — Cluster Foundation
  "aws-k8s-foundation": {
    family_id: "aws-k8s-foundation",
    family_name: "AWS EKS — Cluster Foundation",
    deployment_pattern: "infra-only",
    variant_key: "modular-foundation",
    variant_label: "Modular OpenTofu Foundation (Recommended)",
    bnk_version: null,
    is_recommended: true,
  },
  "aws-eks-cluster-demo": {
    family_id: "aws-k8s-foundation",
    family_name: "AWS EKS — Cluster Foundation",
    deployment_pattern: "infra-only",
    variant_key: "fast-demo",
    variant_label: "Fast Demo (No HP Nodes)",
    bnk_version: null,
    is_recommended: false,
  },

  // IBM Cloud ROKS — F5 BNK Full Stack
  "ibm-roks-bnk241-single-nic": {
    family_id: "ibm-roks-bnk-full-stack",
    family_name: "IBM Cloud ROKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "single-nic",
    variant_label: "Single-NIC (Recommended)",
    bnk_version: "2.4.1",
    is_recommended: true,
  },
  "ibm-roks-bnk241-dual-nic": {
    family_id: "ibm-roks-bnk-full-stack",
    family_name: "IBM Cloud ROKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "dual-nic",
    variant_label: "Dual-NIC",
    bnk_version: "2.4.1",
    is_recommended: false,
  },
  "ibm-roks-bnk-single-nic": {
    family_id: "ibm-roks-bnk-full-stack",
    family_name: "IBM Cloud ROKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "single-nic",
    variant_label: "Single-NIC (Recommended)",
    bnk_version: "2.3",
    is_recommended: false,
  },
  "ibm-roks-bnk-dual-nic": {
    family_id: "ibm-roks-bnk-full-stack",
    family_name: "IBM Cloud ROKS — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "dual-nic",
    variant_label: "Dual-NIC",
    bnk_version: "2.3",
    is_recommended: false,
  },

  // IBM Cloud ROKS — F5 BNK on Existing Cluster
  "ibm-roks-existing-cluster-bnk241-single-nic": {
    family_id: "ibm-roks-bnk-existing-cluster",
    family_name: "IBM Cloud ROKS — F5 BNK on Existing Cluster",
    deployment_pattern: "existing-cluster",
    variant_key: "single-nic",
    variant_label: "Single-NIC (Recommended)",
    bnk_version: "2.4.1",
    is_recommended: true,
  },
  "ibm-roks-existing-cluster-bnk241-dual-nic": {
    family_id: "ibm-roks-bnk-existing-cluster",
    family_name: "IBM Cloud ROKS — F5 BNK on Existing Cluster",
    deployment_pattern: "existing-cluster",
    variant_key: "dual-nic",
    variant_label: "Dual-NIC",
    bnk_version: "2.4.1",
    is_recommended: false,
  },
  "ibm-roks-existing-cluster-bnk-single-nic": {
    family_id: "ibm-roks-bnk-existing-cluster",
    family_name: "IBM Cloud ROKS — F5 BNK on Existing Cluster",
    deployment_pattern: "existing-cluster",
    variant_key: "single-nic",
    variant_label: "Single-NIC (Recommended)",
    bnk_version: "2.3",
    is_recommended: false,
  },
  "ibm-roks-existing-cluster-bnk-dual-nic": {
    family_id: "ibm-roks-bnk-existing-cluster",
    family_name: "IBM Cloud ROKS — F5 BNK on Existing Cluster",
    deployment_pattern: "existing-cluster",
    variant_key: "dual-nic",
    variant_label: "Dual-NIC",
    bnk_version: "2.3",
    is_recommended: false,
  },

  // IBM Cloud ROKS — Cluster Infrastructure
  "ibm-roks-cluster": {
    family_id: "ibm-roks-infra",
    family_name: "IBM Cloud ROKS — Cluster Infrastructure",
    deployment_pattern: "infra-only",
    variant_key: "create-cluster",
    variant_label: "Create New ROKS Cluster (Recommended)",
    bnk_version: null,
    is_recommended: true,
  },
  "ibm-roks-existing-cluster": {
    family_id: "ibm-roks-infra",
    family_name: "IBM Cloud ROKS — Cluster Infrastructure",
    deployment_pattern: "existing-cluster",
    variant_key: "register-existing",
    variant_label: "Register Existing ROKS Cluster",
    bnk_version: null,
    is_recommended: false,
  },

  // F5 BNK Platform — Kubernetes Overlay
  "bnk-241-on-k8s": {
    family_id: "bnk-on-k8s",
    family_name: "F5 BNK Platform — Kubernetes Overlay",
    deployment_pattern: "existing-cluster",
    variant_key: "aws-eks",
    variant_label: "AWS EKS Optimized (Recommended)",
    bnk_version: "2.4.1",
    is_recommended: true,
  },
  "bnk-241-on-k8s-generic": {
    family_id: "bnk-on-k8s",
    family_name: "F5 BNK Platform — Kubernetes Overlay",
    deployment_pattern: "existing-cluster",
    variant_key: "generic",
    variant_label: "Multi-Platform Generic (SR-IOV)",
    bnk_version: "2.4.1",
    is_recommended: false,
  },
  "bnk-on-k8s": {
    family_id: "bnk-on-k8s",
    family_name: "F5 BNK Platform — Kubernetes Overlay",
    deployment_pattern: "existing-cluster",
    variant_key: "aws-eks",
    variant_label: "AWS EKS Optimized",
    bnk_version: "2.2",
    is_recommended: false,
  },
  "bnk-on-k8s-generic": {
    family_id: "bnk-on-k8s",
    family_name: "F5 BNK Platform — Kubernetes Overlay",
    deployment_pattern: "existing-cluster",
    variant_key: "generic",
    variant_label: "Multi-Platform Generic (SR-IOV)",
    bnk_version: "2.2",
    is_recommended: false,
  },

  // Bare Metal + NVIDIA BlueField-3
  "bnk-bare-metal-full-poc": {
    family_id: "bnk-bare-metal-full-poc",
    family_name: "Bare-Metal BlueField DPU — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "all-in-one",
    variant_label: "All-in-One DPU + BNK PoC",
    bnk_version: "2.2",
    is_recommended: true,
  },
  "bnk-bare-metal-full-poc-ssh": {
    family_id: "bnk-bare-metal-full-poc",
    family_name: "Bare-Metal BlueField DPU — F5 BNK Full Stack",
    deployment_pattern: "full-stack",
    variant_key: "ssh",
    variant_label: "SSH Host Execution (Legacy)",
    bnk_version: "2.2",
    is_recommended: false,
  },
  "bnk-bare-metal-dpu-infra": {
    family_id: "bnk-bare-metal-dpu-infra",
    family_name: "Bare-Metal BlueField DPU — Cluster Foundation",
    deployment_pattern: "infra-only",
    variant_key: "standard",
    variant_label: "DPU Flash + K8s Bootstrap",
    bnk_version: null,
    is_recommended: true,
  },

  // Other Cloud Foundations & Demo Workloads
  "azure-aks-foundation": {
    family_id: "azure-aks-foundation",
    family_name: "Azure AKS — Cluster Foundation",
    deployment_pattern: "infra-only",
    variant_key: "standard",
    variant_label: "Standard AKS Foundation",
    bnk_version: null,
    is_recommended: true,
  },
  "gcp-gke-foundation": {
    family_id: "gcp-gke-foundation",
    family_name: "GCP GKE — Cluster Foundation",
    deployment_pattern: "infra-only",
    variant_key: "standard",
    variant_label: "Standard GKE Foundation",
    bnk_version: null,
    is_recommended: true,
  },
  "ocp-connection": {
    family_id: "ocp-connection",
    family_name: "Red Hat OpenShift — Cluster Connection",
    deployment_pattern: "infra-only",
    variant_key: "standard",
    variant_label: "Existing OpenShift Cluster",
    bnk_version: null,
    is_recommended: true,
  },
  "ubuntu-kind-foundation": {
    family_id: "ubuntu-kind-foundation",
    family_name: "Ubuntu Kind — Local Dev Cluster",
    deployment_pattern: "infra-only",
    variant_key: "standard",
    variant_label: "Single-Host Kind Cluster",
    bnk_version: null,
    is_recommended: true,
  },
  "bnk-241-live-observability-foundation": {
    family_id: "bnk-live-observability-foundation",
    family_name: "F5 BNK — Live Observability & Validation Stack",
    deployment_pattern: "demo-workload",
    variant_key: "observability",
    variant_label: "Live Observability + Validation (Recommended)",
    bnk_version: "2.4.1",
    is_recommended: true,
  },
  "bnk-live-observability-foundation": {
    family_id: "bnk-live-observability-foundation",
    family_name: "F5 BNK — Live Observability & Validation Stack",
    deployment_pattern: "demo-workload",
    variant_key: "observability",
    variant_label: "Live Observability + Validation",
    bnk_version: "2.3",
    is_recommended: false,
  },
  "bnk-demo-apps": {
    family_id: "bnk-demo-apps",
    family_name: "F5 BNK — GenAI Gateway & Demo Workloads",
    deployment_pattern: "demo-workload",
    variant_key: "genai-gateway",
    variant_label: "GenAI Gateway Suite (Recommended)",
    bnk_version: "2.2",
    is_recommended: true,
  },
  "eks-bnk-smartllm-demo": {
    family_id: "bnk-demo-apps",
    family_name: "F5 BNK — GenAI Gateway & Demo Workloads",
    deployment_pattern: "demo-workload",
    variant_key: "smartllm-router",
    variant_label: "SmartLLM Traffic-Weighted Router",
    bnk_version: "2.2",
    is_recommended: false,
  },
};

export function resolveBlueprintFamilyMeta(item: {
  blueprint_id?: string | null;
  slug?: string | null;
  name?: string | null;
  blueprint_name?: string | null;
  category?: string | null;
  bnk_version?: string | null;
  family_id?: string | null;
  family_name?: string | null;
  deployment_pattern?: string | null;
  variant_key?: string | null;
  variant_label?: string | null;
  is_recommended?: boolean;
}): CanonicalBlueprintMeta {
  const bpId = item.blueprint_id || item.slug || "";
  const canonical = CANONICAL_BLUEPRINT_META[bpId];
  const fallbackName = item.blueprint_name || item.name || bpId;

  const inferredPattern: DeploymentPatternKey = normalizeDeploymentPattern(
    item.deployment_pattern || canonical?.deployment_pattern,
    item.category,
  );

  const explicitFamilyId =
    item.family_id && item.family_id !== bpId ? item.family_id : null;
  const explicitFamilyName =
    item.family_name && item.family_name !== fallbackName
      ? item.family_name
      : null;

  return {
    family_id:
      explicitFamilyId || canonical?.family_id || item.family_id || bpId,
    family_name:
      explicitFamilyName ||
      canonical?.family_name ||
      item.family_name ||
      fallbackName,
    deployment_pattern: inferredPattern,
    variant_key:
      (item.variant_key && item.variant_key !== "standard"
        ? item.variant_key
        : canonical?.variant_key) ||
      item.variant_key ||
      "default",
    variant_label:
      canonical?.variant_label ||
      (item.variant_label && item.variant_label !== "Standard"
        ? item.variant_label
        : null) ||
      item.variant_label ||
      "Standard",
    bnk_version:
      normalizeBnkVersion(item.bnk_version) ?? canonical?.bnk_version ?? null,
    is_recommended: canonical
      ? canonical.is_recommended
      : (item.is_recommended ?? true),
  };
}

const EXTERNAL_AWS_EKS_BNK_IDS = new Set([
  "aws-eks-bnk241-secure",
  "aws-eks-bnk241-traffic",
  "aws-eks-bnk23-secure",
  "aws-eks-bnk23-traffic",
]);

const EXTERNAL_AWS_EKS_INFRA_IDS = new Set([
  "aws-eks-cluster-create",
  "aws-eks-cluster-create-with-hp-nodes",
  "aws-eks-existing-cluster",
  "aws-eks-existing-cluster-with-hp-nodes",
]);

/**
 * Determine if a blueprint ID should be auto-suppressed by default because
 * a canonical external git-sourced blueprint or primary profile supersedes it.
 *
 * Only suppresses when the superseding blueprint is actually present in `allBlueprintIds`,
 * so isolated unit tests with single fixtures are never hidden unexpectedly.
 */
export function shouldAutoSuppressBlueprint(
  blueprintId: string,
  allBlueprintIds: Set<string>,
): boolean {
  const hasExternalAwsBnk = [...EXTERNAL_AWS_EKS_BNK_IDS].some((id) =>
    allBlueprintIds.has(id),
  );
  const hasExternalAwsInfra = [...EXTERNAL_AWS_EKS_INFRA_IDS].some((id) =>
    allBlueprintIds.has(id),
  );

  if (
    (blueprintId === "awsbnkctl-bnk-demo" ||
      blueprintId === "eks-bnk-smartllm-demo") &&
    hasExternalAwsBnk
  ) {
    return true;
  }

  if (
    (blueprintId === "aws-eks-cluster-demo" ||
      blueprintId === "aws-eks-infra") &&
    (hasExternalAwsInfra || hasExternalAwsBnk)
  ) {
    return true;
  }

  if (blueprintId === "aws-k8s-foundation" && hasExternalAwsInfra) {
    return true;
  }

  if (
    blueprintId === "bnk-241-on-k8s-generic" &&
    allBlueprintIds.has("bnk-241-on-k8s")
  ) {
    return true;
  }

  if (
    blueprintId === "bnk-on-k8s-generic" &&
    (allBlueprintIds.has("bnk-on-k8s") || allBlueprintIds.has("bnk-241-on-k8s"))
  ) {
    return true;
  }

  if (
    blueprintId === "bnk-bare-metal-full-poc-ssh" &&
    allBlueprintIds.has("bnk-bare-metal-full-poc")
  ) {
    return true;
  }

  return false;
}

/**
 * Format a blueprint variant label for a <select> option or badge,
 * stripping any embedded "(Recommended)" before appending " ★ Recommended".
 */
export function formatVariantOptionLabel(
  variantLabel: string,
  isRecommended: boolean,
): string {
  const cleaned = variantLabel
    .replace(/\s*\(recommended\)/gi, "")
    .replace(/\s*★\s*recommended/gi, "")
    .trim();
  return isRecommended ? `${cleaned} ★ Recommended` : cleaned;
}

/**
 * Return true if the blueprint_id is mapped in the canonical blueprint registry.
 */
export function isCanonicalBlueprintId(blueprintId: string): boolean {
  return Boolean(CANONICAL_BLUEPRINT_META[blueprintId]);
}

export const BLUEPRINT_PROVIDER_LABELS: Record<string, string> = {
  aws: "AWS",
  ibm: "IBM Cloud",
  "bare-metal": "Bare Metal / DPU",
  azure: "Azure",
  gcp: "GCP",
  openshift: "OpenShift",
  kubernetes: "Multi-Platform / K8s",
};

export const BLUEPRINT_PROVIDER_OPTIONS: Array<{ key: string; label: string }> =
  [
    { key: "all", label: "All Clouds" },
    { key: "aws", label: "AWS" },
    { key: "ibm", label: "IBM Cloud" },
    { key: "bare-metal", label: "Bare Metal / DPU" },
    { key: "azure", label: "Azure" },
    { key: "gcp", label: "GCP" },
    { key: "openshift", label: "OpenShift" },
    { key: "kubernetes", label: "Multi-Platform / K8s" },
  ];

/**
 * Normalize a blueprint's cloud_provider/category/id into a canonical provider key
 * ('aws' | 'ibm' | 'bare-metal' | 'azure' | 'gcp' | 'openshift' | 'kubernetes')
 * so bare-metal and multi-platform blueprints never render as a raw 'other' badge.
 */
export function normalizeBlueprintCloudProvider(item: {
  cloud_provider?: string | null;
  category?: string | null;
  blueprint_id?: string | null;
  slug?: string | null;
}): string {
  const raw = (item.cloud_provider || "").trim().toLowerCase();
  const cat = (item.category || "").trim().toLowerCase();
  const bpId = (item.blueprint_id || item.slug || "").trim().toLowerCase();

  if (
    raw === "bare-metal" ||
    raw === "bare_metal" ||
    cat === "bare-metal" ||
    bpId.startsWith("bnk-bare-metal")
  ) {
    return "bare-metal";
  }
  if (
    raw === "aws" ||
    bpId.startsWith("aws") ||
    bpId === "eks-bnk-smartllm-demo"
  ) {
    return "aws";
  }
  if (raw === "ibm" || bpId.startsWith("ibm-roks")) {
    return "ibm";
  }
  if (raw === "azure" || bpId.startsWith("azure")) {
    return "azure";
  }
  if (raw === "gcp" || bpId.startsWith("gcp")) {
    return "gcp";
  }
  if (raw === "openshift" || raw === "ocp" || bpId.startsWith("ocp")) {
    return "openshift";
  }
  if (
    raw === "any" ||
    raw === "kubernetes" ||
    raw === "k8s" ||
    raw === "multi-platform" ||
    !raw
  ) {
    return "kubernetes";
  }
  return raw;
}
