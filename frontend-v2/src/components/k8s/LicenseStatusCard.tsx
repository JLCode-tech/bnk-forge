/**
 * License Status Card — shows BNK license status in the health dashboard.
 *
 * K8S-UX-010: Displays license type, expiry, telemetry state, and
 * provides actions for license activation and telemetry report download.
 *
 * Used in BNKHealthDashboard as a standalone card above the component grid.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  useLicenseStatus,
  useCWCStatus,
  refreshLicensing,
} from "@/hooks/useLicensing";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ShieldQuestion,
  Clock,
  Radio,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Key,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type { LicenseInfo } from "@/types";

interface LicenseStatusCardProps {
  clusterId: number;
}

// D-020: token-pure status mapping. Status surfaces as a small badge + icon, not
// a whole-card tint. `iconColor` is a single token class for the leading icon.
const stateConfig: Record<
  LicenseInfo["state"],
  {
    icon: typeof Shield;
    iconColor: string;
    label: string;
    badgeVariant: NonNullable<BadgeProps["variant"]>;
  }
> = {
  active: {
    icon: ShieldCheck,
    iconColor: "text-success",
    label: "Licensed",
    badgeVariant: "success",
  },
  evaluation: {
    icon: ShieldAlert,
    iconColor: "text-warning",
    label: "Evaluation",
    badgeVariant: "warning",
  },
  expired: {
    icon: ShieldX,
    iconColor: "text-destructive",
    label: "Expired",
    badgeVariant: "destructive",
  },
  unknown: {
    icon: ShieldQuestion,
    iconColor: "text-muted-foreground",
    label: "Unknown",
    badgeVariant: "outline",
  },
  unavailable: {
    icon: ShieldQuestion,
    iconColor: "text-muted-foreground",
    label: "Unavailable",
    badgeVariant: "outline",
  },
};

export function LicenseStatusCard({ clusterId }: LicenseStatusCardProps) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { licenseInfo, isLoading, isError, isFetching } =
    useLicenseStatus(clusterId);

  // Only fetch detailed CWC connectivity status when the card is expanded so
  // passive Overview visits do not read CWC certificate Secrets.
  const { data: cwcStatus } = useCWCStatus(clusterId, expanded);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <span className="text-sm font-medium text-foreground">
                License Status
              </span>
              <p className="text-xs text-muted-foreground">
                Checking license status...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // If the operator isn't connected or CWC isn't reachable, show a subtle indicator
  if (isError || licenseInfo.state === "unavailable") {
    // Don't show anything if CWC isn't even there — it's optional
    if (
      licenseInfo.installed === false ||
      (cwcStatus && !cwcStatus.cwc_service_found)
    ) {
      return null;
    }

    const unavailableMessage = licenseInfo.readOnly
      ? "Read-only cluster credentials — CWC license status requires Secret and Pod exec access"
      : licenseInfo.clientPodRunning === false
        ? "Passive mode — click Refresh to query CWC license status"
        : cwcStatus?.certs_mounted === false
          ? "CWC certificates not configured — run setup first"
          : "License information unavailable — check CWC connectivity";

    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldQuestion className="h-5 w-5 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium text-foreground/80">
                License Status
              </span>
              <p className="text-xs text-muted-foreground">
                {unavailableMessage}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refreshLicensing(queryClient, clusterId)}
            disabled={isFetching}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
            />
          </Button>
        </div>
      </div>
    );
  }

  const config = stateConfig[licenseInfo.state] || stateConfig.unknown;
  const StateIcon = config.icon;

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <StateIcon className={cn("h-5 w-5", config.iconColor)} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">BNK License</span>
              <Badge variant={config.badgeVariant} className="text-xs">
                {config.label}
              </Badge>
              {licenseInfo.entitlementType && (
                <Badge variant="outline" className="text-xs">
                  {licenseInfo.entitlementType}
                </Badge>
              )}
            </div>
            <p className="text-xs mt-0.5 text-muted-foreground">
              {licenseInfo.expiryDays !== undefined &&
                licenseInfo.expiryDays > 0 && (
                  <>Expires in {licenseInfo.expiryDays} days</>
                )}
              {licenseInfo.expiryDays !== undefined &&
                licenseInfo.expiryDays <= 0 && (
                  <span className="text-destructive">License has expired</span>
                )}
              {licenseInfo.expiryDays === undefined &&
                licenseInfo.expiryDate && (
                  <>Expires: {licenseInfo.expiryDate}</>
                )}
              {!licenseInfo.expiryDate && !licenseInfo.expiryDays && (
                <>No expiry information available</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {licenseInfo.telemetryState && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1">
                    <Radio className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Telemetry
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{licenseInfo.telemetryState}</p>
                  {licenseInfo.telemetryMessage && (
                    <p className="text-xs text-muted-foreground">
                      {licenseInfo.telemetryMessage}
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void refreshLicensing(queryClient, clusterId);
            }}
            disabled={isFetching}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
            />
          </Button>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border">
          <div className="pt-3 grid grid-cols-2 gap-x-8 gap-y-2">
            {licenseInfo.digitalAssetId && (
              <DetailRow
                icon={Key}
                label="Digital Asset ID"
                value={licenseInfo.digitalAssetId}
              />
            )}
            {licenseInfo.entitlementType && (
              <DetailRow
                icon={Shield}
                label="Entitlement"
                value={licenseInfo.entitlementType}
              />
            )}
            {licenseInfo.expiryDate && (
              <DetailRow
                icon={Clock}
                label="Expiry Date"
                value={licenseInfo.expiryDate}
              />
            )}
            {licenseInfo.telemetryState && (
              <DetailRow
                icon={Radio}
                label="Telemetry"
                value={
                  licenseInfo.telemetryMessage || licenseInfo.telemetryState
                }
              />
            )}
          </div>

          {/* Warnings */}
          {licenseInfo.state === "evaluation" && (
            <div className="flex items-start gap-2 rounded-md p-2.5 text-xs bg-warning/10 text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                This cluster is using an evaluation license. Activate a
                production license before the evaluation period expires to avoid
                service interruption.
              </span>
            </div>
          )}
          {licenseInfo.state === "expired" && (
            <div className="flex items-start gap-2 rounded-md p-2.5 text-xs bg-destructive/10 text-destructive">
              <ShieldX className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                This license has expired. Activate a new license to restore full
                functionality.
              </span>
            </div>
          )}

          {/* CWC connectivity info */}
          {cwcStatus && (
            <div className="text-xs space-y-1 text-muted-foreground">
              <div className="flex items-center gap-4">
                <StatusDot
                  ok={cwcStatus.cwc_service_found}
                  label="CWC Service"
                />
                <StatusDot ok={cwcStatus.certs_mounted} label="Certs Mounted" />
                <StatusDot ok={cwcStatus.cwc_reachable} label="CWC Reachable" />
                <StatusDot
                  ok={cwcStatus.setup_complete}
                  label="Setup Complete"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{label}:</span>
      <span className="text-xs font-medium truncate text-foreground/80">
        {value}
      </span>
    </div>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ok ? "bg-success" : "bg-muted-foreground",
        )}
      />
      <span>{label}</span>
    </div>
  );
}
