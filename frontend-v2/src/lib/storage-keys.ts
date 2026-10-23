/**
 * Centralized localStorage key constants
 *
 * Single source of truth for all localStorage keys used in the application.
 * Prevents key collisions and typos, makes keys easy to find and update.
 *
 * Key naming convention: STORAGE_KEYS.CATEGORY_PURPOSE
 */

// One project and cluster scope shared by every cluster-scoped page (K8s, BNK,
// CNF, AI, Benchmarks) so a selection made on one page carries to the next.
const PROJECT_SCOPE = "bnk-forge-project-scope";
const CLUSTER_SCOPE = "bnk-forge-cluster-scope";

export const STORAGE_KEYS = {
  // Kubernetes & Cluster Management
  PROJECT_SCOPE,
  CLUSTER_SCOPE,
  K8S_PROJECT: PROJECT_SCOPE,
  K8S_CLUSTER: CLUSTER_SCOPE,
  K8S_NAMESPACE: "bnk-forge-k8s-namespace",
  K8S_RESOURCE_TYPE: "bnk-forge-k8s-resource-type",
  K8S_UNHEALTHY_ONLY: "bnk-forge-k8s-unhealthy-only",
  K8S_VIEW_MODE: "bnk-forge-k8s-view-mode",

  // F5 BNK Management
  BNK_PROJECT: PROJECT_SCOPE,
  BNK_CLUSTER: CLUSTER_SCOPE,

  // CNF Dashboard (Custom Resource browser)
  CNF_PROJECT: PROJECT_SCOPE,
  CNF_CLUSTER: CLUSTER_SCOPE,

  // Authentication
  AUTH_TOKEN: "auth_token",

  // Onboarding & First-time User Experience
  ONBOARDING_COMPLETE: "bnk-forge-onboarding-complete",

  // UI Preferences
  MOCKUP_THEME: "mockup-theme",
} as const;

/**
 * Type-safe storage key accessor
 * Ensures only valid keys can be used at compile time
 */
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
