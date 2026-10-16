/**
 * Centralized status color definitions — token-pure (D-020).
 *
 * All classes reference semantic design tokens (success / warning / destructive /
 * info / muted) instead of raw palette classes.  Callers keep their existing
 * function signatures; only the emitted class strings change.
 */

/**
 * Module status colors (OpenTofu/Terraform modules)
 * Used in ProjectDetailV2 and module-related components
 */
export const MODULE_STATUS_COLORS = {
  applied: "bg-success/10 text-success border-success/20",
  initializing: "bg-warning/10 text-warning border-warning/20",
  initialized: "bg-info/10 text-info border-info/20",
  planned: "bg-info/10 text-info border-info/20",
  planning: "bg-warning/10 text-warning border-warning/20",
  applying: "bg-warning/10 text-warning border-warning/20",
  destroying: "bg-warning/10 text-warning border-warning/20",
  not_initialized: "bg-muted text-muted-foreground border-border",
  // Failed states
  failed: "bg-destructive/10 text-destructive border-destructive/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
  init_failed: "bg-destructive/10 text-destructive border-destructive/20",
  plan_failed: "bg-destructive/10 text-destructive border-destructive/20",
  apply_failed: "bg-destructive/10 text-destructive border-destructive/20",
  destroy_failed: "bg-destructive/10 text-destructive border-destructive/20",
} as const;

export type StatusTone =
  | "success"
  | "warning"
  | "info"
  | "muted"
  | "destructive";

export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  info: "bg-info/10 text-info border-info/20",
  muted: "bg-muted text-muted-foreground border-border",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
};

export const STATUS_DOT_CLASSES: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  muted: "bg-muted-foreground",
  destructive: "bg-destructive",
};

/**
 * Resolves any status string to one of the 5 canonical status tones per D8:
 * - pending / queued = muted
 * - running / in_progress = info
 * - success / ready / reachable = success
 * - warning / degraded / throttled = warning
 * - failed / error = destructive
 */
export function getStatusTone(status?: string | null): StatusTone {
  if (!status) return "muted";
  const s = status.toLowerCase().trim();

  // Numeric HTTP response status codes (e.g. "200", "404", "500")
  const httpCode = Number(s);
  if (!Number.isNaN(httpCode) && httpCode >= 100 && httpCode <= 599) {
    if (httpCode >= 200 && httpCode < 300) return "success";
    if (httpCode >= 300 && httpCode < 400) return "info";
    if (httpCode >= 400 && httpCode < 500) return "warning";
    if (httpCode >= 500) return "destructive";
  }

  // Error / Failed / Destructive states (checked first)
  if (
    s === "failed" ||
    s === "error" ||
    s === "fail" ||
    s === "crashloopbackoff" ||
    s === "imagepullbackoff" ||
    s === "uninstalled" ||
    s === "notready" ||
    s === "unhealthy" ||
    s === "offline" ||
    s === "critical" ||
    s === "missing" ||
    s === "stopped" ||
    s === "terminated" ||
    s === "timed_out" ||
    s === "timeout" ||
    s === "init_failed" ||
    s === "plan_failed" ||
    s === "apply_failed" ||
    s === "destroy_failed" ||
    s.includes("fail") ||
    s.includes("error") ||
    s.includes("crashloop") ||
    s.includes("imagepull")
  ) {
    return "destructive";
  }

  // Warning / Degraded / Throttled states
  if (
    s === "warning" ||
    s === "warn" ||
    s === "degraded" ||
    s === "throttled" ||
    s === "paused" ||
    s === "paused_gate" ||
    s === "drifted" ||
    s === "partial" ||
    s === "draining" ||
    s === "provisioning" ||
    s === "superseded" ||
    s.includes("warn") ||
    s.includes("degraded") ||
    s.includes("throttl")
  ) {
    return "warning";
  }

  // Info / In Progress / Running states per D8
  if (
    s === "running" ||
    s === "in_progress" ||
    s === "deploying" ||
    s === "starting" ||
    s === "initializing" ||
    s === "planning" ||
    s === "applying" ||
    s === "destroying" ||
    s === "discovering" ||
    s === "checking" ||
    s === "connecting" ||
    s === "testing" ||
    s === "querying" ||
    s === "initialized" ||
    s === "planned" ||
    s.includes("progress")
  ) {
    return "info";
  }

  // Success / Ready / Reachable / Compliant states
  if (
    s === "success" ||
    s === "ready" ||
    s === "reachable" ||
    s === "completed" ||
    s === "deployed" ||
    s === "active" ||
    s === "bound" ||
    s === "healthy" ||
    s === "pass" ||
    s === "detected" ||
    s === "compliant" ||
    s === "applied" ||
    s === "online" ||
    s === "connected" ||
    s.includes("success")
  ) {
    return "success";
  }

  // Neutral / Muted states (pending, queued, cancelled, skipped, unknown, idle, etc.)
  return "muted";
}

/**
 * Task/Job status colors
 * Used in TaskHistory and deployment tracking
 */
export const TASK_STATUS_COLORS = {
  completed: "bg-success/10 text-success border-success/20",
  in_progress: "bg-info/10 text-info border-info/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
  cancelled: "bg-muted text-muted-foreground border-border",
  queued: "bg-muted text-muted-foreground border-border",
  pending: "bg-muted text-muted-foreground border-border",
} as const;

/**
 * Kubernetes/Helm resource status colors (pattern-based)
 * Used for K8s pods, deployments, services, and Helm releases
 *
 * @param status - Status string from K8s/Helm resource
 * @returns Tailwind CSS classes for badge styling
 */
export function getResourceStatusColor(status: string): string {
  if (!status) return "bg-muted text-muted-foreground border-border";

  const statusLower = status.toLowerCase();

  // Error/Failed states (CHECK FIRST - before "ready" substring match)
  if (
    statusLower.includes("failed") ||
    statusLower.includes("error") ||
    statusLower.includes("crashloopbackoff") ||
    statusLower.includes("imagepullbackoff") ||
    statusLower.includes("uninstalled") ||
    statusLower.includes("notready") // Must check before "ready"
  ) {
    return "bg-destructive/10 text-destructive border-destructive/20";
  }

  // Success states (after error checks)
  if (
    statusLower.includes("running") ||
    statusLower.includes("ready") ||
    statusLower.includes("deployed") ||
    statusLower.includes("active") ||
    statusLower.includes("bound")
  ) {
    return "bg-success/10 text-success border-success/20";
  }

  // Warning/Pending states
  if (
    statusLower.includes("pending") ||
    statusLower.includes("waiting") ||
    statusLower.includes("superseded") ||
    statusLower.includes("unknown") ||
    statusLower.includes("partial")
  ) {
    return "bg-warning/10 text-warning border-warning/20";
  }

  // Terminating/Removing states
  if (
    statusLower.includes("terminating") ||
    statusLower.includes("deleting") ||
    statusLower.includes("uninstalling")
  ) {
    return "bg-muted text-muted-foreground border-border";
  }

  // Default neutral state
  return "bg-muted text-muted-foreground border-border";
}

/**
 * Get module status color by status string
 * Helper function for backwards compatibility
 */
export function getModuleStatusColor(status: string): string {
  return (
    MODULE_STATUS_COLORS[status as keyof typeof MODULE_STATUS_COLORS] ||
    MODULE_STATUS_COLORS.not_initialized
  );
}

/**
 * Get task status color by status string
 * Helper function for backwards compatibility
 */
export function getTaskStatusColor(status: string): string {
  return (
    TASK_STATUS_COLORS[status as keyof typeof TASK_STATUS_COLORS] ||
    TASK_STATUS_COLORS.pending
  );
}
