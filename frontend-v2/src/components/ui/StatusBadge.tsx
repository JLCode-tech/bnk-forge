import * as React from "react";
import { Network } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getStatusTone,
  STATUS_TONE_CLASSES,
  STATUS_DOT_CLASSES,
  type StatusTone,
} from "@/lib/status-colors";
import { useTargetConnectivity } from "@/hooks/useConnectivity";

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: string | null;
  /** Explicit tone override if needed */
  tone?: StatusTone;
  /** Custom display label (defaults to status text or tone) */
  label?: React.ReactNode;
  /** Show leading status dot (default: true, suppressed if icon is provided or dot={false}) */
  dot?: boolean;
  /** Leading icon (replaces dot) */
  icon?: React.ComponentType<{ className?: string }>;
  /** Pulse animation for status indicator */
  pulse?: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
export function formatStatusLabel(text: string): string {
  return text.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Canonical status badge component (D8 / UI Consistency R4).
 * Single source of truth for status pills with semantic status tones.
 */
export function StatusBadge({
  status,
  tone: toneOverride,
  label,
  dot = true,
  icon: Icon,
  pulse = false,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  const tone = toneOverride ?? getStatusTone(status);
  const toneClass = STATUS_TONE_CLASSES[tone];
  const dotClass = STATUS_DOT_CLASSES[tone];
  const shouldPulse = pulse || tone === "info";

  const rawText = status ?? tone;
  const content =
    children ?? label ?? (rawText ? formatStatusLabel(rawText) : "");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs font-medium border capitalize",
        toneClass,
        className,
      )}
      {...props}
    >
      {Icon ? (
        <Icon
          className={cn("h-3 w-3 shrink-0", shouldPulse && "animate-spin")}
        />
      ) : dot ? (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0",
            dotClass,
            shouldPulse && "animate-pulse",
          )}
        />
      ) : null}
      {content}
    </span>
  );
}

export interface ClusterLike {
  id: number;
  name: string;
  ssh_tunnel_enabled?: boolean;
  ssh_credential_id?: number | null;
}

export interface ClusterStatusBadgeProps {
  cluster: ClusterLike;
  /** Show the cluster name next to the icon. */
  showLabel?: boolean;
  /**
   * Show the state text (Reachable / Offline / Checking…) next to the icon.
   * Use everywhere the page would otherwise render its own derived offline /
   * fleet / bnk-severity label — keeps every page reading from the same source.
   */
  showStatusLabel?: boolean;
}

type ClusterReachabilityState =
  | "checking"
  | "reachable"
  | "unreachable"
  | "unknown";

export function ClusterStatusBadge({
  cluster,
  showLabel = false,
  showStatusLabel = false,
}: ClusterStatusBadgeProps) {
  const usesJumphost =
    !!cluster.ssh_tunnel_enabled && !!cluster.ssh_credential_id;

  // For ssh-tunnel-enabled clusters, the registry's SSH probe is the truth
  // (Phase 2 — collapses Phase 1's bespoke useSSHConnectivity branch). For
  // direct/operator clusters, the cluster probe is the truth. Both paths
  // read from the same registry, so behavior is identical end-to-end.
  const targetType = usesJumphost ? "ssh" : "cluster";
  const targetId = usesJumphost
    ? (cluster.ssh_credential_id ?? undefined)
    : cluster.id;
  const { state: registryState } = useTargetConnectivity(targetType, targetId);

  const method = usesJumphost
    ? "SSH tunnel (jumphost)"
    : "cluster reachability probe";
  const value = registryState?.state ?? "unknown";

  let state: ClusterReachabilityState;
  let message: string;
  if (value === "reachable") {
    state = "reachable";
    message = registryState?.error_context?.target_name
      ? `${registryState.error_context.target_name} is reachable.`
      : "Reachable.";
  } else if (value === "unreachable") {
    state = "unreachable";
    message =
      (registryState?.error_context?.suggested_action as string | undefined) ||
      "Unreachable.";
  } else {
    // Cold start — honest "checking" rather than fail-open.
    state = registryState ? "unknown" : "checking";
    message = registryState ? "No probe data yet." : "Probing…";
  }

  const iconClass =
    state === "checking"
      ? "text-warning animate-pulse"
      : state === "reachable"
        ? "text-success"
        : state === "unreachable"
          ? "text-destructive"
          : "text-muted-foreground";

  const stateLabel =
    state === "checking"
      ? "Checking"
      : state === "reachable"
        ? "Reachable"
        : state === "unreachable"
          ? "Offline"
          : "Unknown";

  const tooltip = `${cluster.name} — ${stateLabel} via ${method}. ${message}`;

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={tooltip}
      aria-label={tooltip}
    >
      <Network className={cn("h-4 w-4", iconClass)} />
      {showLabel && (
        <span className="text-xs text-muted-foreground">{cluster.name}</span>
      )}
      {showStatusLabel && (
        <StatusBadge
          status={stateLabel}
          tone={state === "checking" ? "warning" : undefined}
          pulse={state === "checking"}
        />
      )}
    </span>
  );
}
