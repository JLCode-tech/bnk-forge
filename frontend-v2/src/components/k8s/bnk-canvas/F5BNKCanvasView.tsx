/**
 * Topology Canvas view: toolbar, findings strip and the canvas itself.
 *
 * Data comes from GET /api/k8s/clusters/{id}/f5bnk/canvas (read-only). Clicking
 * a card emits the same TopologyResourceSelection as the Object Topology
 * Graph, so the page opens Forge's F5BNKDetailPanel. Secrets are drawn only as
 * reference placeholders and are never selectable.
 *
 * Traffic counters come from the BNK data bundle (GET /f5bnk/data) that the
 * F5 BNK page already prefetches for every BNK view; reading it here shares
 * that cache entry and adds no cluster calls.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Info,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Switch } from "@/components/ui/switch";
import { useBnkCanvas, useBnkData } from "@/hooks/useK8s";
import { cn } from "@/lib/utils";
import type { BnkCanvasFinding, BnkCanvasResource } from "@/types";
import type { TopologyResourceSelection } from "@/components/k8s/F5BNKTopologyViewer";
import { BnkCanvas } from "./BnkCanvas";
import { trafficOverlay } from "./trafficOverlay";

interface F5BNKCanvasViewProps {
  clusterId: number;
  namespace?: string;
  onSelectResource?: (selection: TopologyResourceSelection) => void;
}

const isSecret = (resource: BnkCanvasResource) =>
  resource.group === "" && resource.kind === "Secret";
const severityOrder = { error: 0, warning: 1, info: 2 } as const;
const resourceName = (id: string) => {
  const [, , kind, namespace, name] = id.split("|");
  return `${kind} ${namespace ? `${namespace}/` : ""}${name}`;
};

function FindingRow({
  finding,
  onSelect,
}: {
  finding: BnkCanvasFinding;
  onSelect: (id: string) => void;
}) {
  const Icon =
    finding.severity === "error"
      ? XCircle
      : finding.severity === "warning"
        ? AlertTriangle
        : Info;
  return (
    <li className="flex items-start gap-2 py-1.5 text-xs">
      <Icon
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          finding.severity === "error"
            ? "text-destructive"
            : finding.severity === "warning"
              ? "text-warning"
              : "text-info",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <button
          type="button"
          className="font-medium text-foreground hover:underline"
          onClick={() => onSelect(finding.resource)}
        >
          {resourceName(finding.resource)}
        </button>
        <span className="ml-2 font-mono text-muted-foreground">
          {finding.rule}
        </span>
        <p className="text-muted-foreground">{finding.explanation}</p>
        {finding.remediation && (
          <p className="text-muted-foreground/80">→ {finding.remediation}</p>
        )}
      </div>
    </li>
  );
}

export function F5BNKCanvasView({
  clusterId,
  namespace,
  onSelectResource,
}: F5BNKCanvasViewProps) {
  const { data, isLoading, isFetching, error, refresh } = useBnkCanvas(
    clusterId,
    namespace ? { namespace } : undefined,
  );
  const { data: bnkData } = useBnkData(
    clusterId,
    { namespace },
    { pollingEnabled: false },
  );
  const stats = bnkData?.trafficStats;
  const [showSecrets, setShowSecrets] = useState(true);
  const [showTraffic, setShowTraffic] = useState(true);
  const [tracePath, setTracePath] = useState(true);
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();

  const resources = useMemo(
    () =>
      (data?.resources ?? []).filter(
        (resource) => showSecrets || !isSecret(resource),
      ),
    [data, showSecrets],
  );
  const findings = useMemo(
    () =>
      [...(data?.findings ?? [])].sort(
        (a, b) =>
          severityOrder[a.severity] - severityOrder[b.severity] ||
          a.resource.localeCompare(b.resource) ||
          a.rule.localeCompare(b.rule),
      ),
    [data],
  );
  const traffic = useMemo(
    () => (showTraffic ? trafficOverlay(resources, stats) : undefined),
    [resources, stats, showTraffic],
  );
  const trafficHint = stats?.available
    ? `TMM counters from ${stats.podName ?? "the TMM pod"}${stats.sampledAt ? `, sampled ${new Date(stats.sampledAt).toLocaleTimeString()}` : ""}`
    : stats?.error || "No TMM traffic counters are available for this cluster.";
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const broken = (data?.edges ?? []).filter(
    (e) => e.status === "broken",
  ).length;

  const select = (resource: BnkCanvasResource | undefined) => {
    setSelectedId(resource?.id);
    if (
      !resource ||
      resource.placeholder ||
      !resource.resourceType ||
      isSecret(resource)
    )
      return;
    onSelectResource?.({
      kind: resource.kind,
      name: resource.name,
      namespace: resource.namespace,
      resourceType: resource.resourceType,
    });
  };
  const selectById = (id: string) =>
    select(data?.resources.find((resource) => resource.id === id));

  if (isLoading)
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
        Reading BNK resources…
      </div>
    );
  if (error && !data)
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Could not load the Topology Canvas"
        description={
          error instanceof Error ? error.message : "The canvas request failed."
        }
        action={{ label: "Try again", onClick: () => void refresh() }}
        size="sm"
      />
    );
  if (!data?.resources.length)
    return (
      <EmptyState
        icon={GitBranch}
        title="No BIG-IP Next resources found"
        description={
          namespace
            ? `Namespace "${namespace}" has no F5 Gateways, routes or BNK configuration.`
            : "This cluster has no F5 Gateways, routes or BNK configuration."
        }
        size="sm"
      />
    );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{resources.length} resources</Badge>
        <Badge variant="outline">{data.edges.length} relationships</Badge>
        {broken > 0 && <Badge variant="destructive">{broken} broken</Badge>}
        {errors > 0 && <Badge variant="destructive">{errors} errors</Badge>}
        {warnings > 0 && <Badge variant="warning">{warnings} warnings</Badge>}
        <div
          className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"
          title={trafficHint}
        >
          <Switch
            checked={showTraffic && !!stats?.available}
            onCheckedChange={setShowTraffic}
            disabled={!stats?.available}
            aria-label="Show traffic counters"
          />
          Traffic
        </div>
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          title="Selecting a card highlights its whole traffic chain instead of only its direct relationships"
        >
          <Switch
            checked={tracePath}
            onCheckedChange={setTracePath}
            aria-label="Trace the full traffic path"
          />
          Full path
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={showSecrets}
            onCheckedChange={setShowSecrets}
            aria-label="Show Secret references"
          />
          Secret references
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refresh()}
          disabled={isFetching}
        >
          <RefreshCw
            className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")}
          />
          Refresh
        </Button>
      </div>
      {(data.warnings ?? []).map((warning) => (
        <p
          key={warning}
          className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {warning}
        </p>
      ))}
      {findings.length > 0 && (
        <div className="rounded-md border border-border bg-card">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
            onClick={() => setFindingsOpen((open) => !open)}
            aria-expanded={findingsOpen}
          >
            {findingsOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Findings
            <span className="text-xs font-normal text-muted-foreground">
              {errors} errors · {warnings} warnings ·{" "}
              {findings.length - errors - warnings} notes
            </span>
          </button>
          {findingsOpen && (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto px-3 pb-2">
              {findings.map((finding, index) => (
                <FindingRow
                  key={`${index}|${finding.rule}|${finding.resource}`}
                  finding={finding}
                  onSelect={selectById}
                />
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="min-h-[520px] flex-1 overflow-hidden rounded-lg border border-border">
        <BnkCanvas
          resources={resources}
          edges={data.edges}
          findings={findings}
          selectedId={selectedId}
          onSelect={select}
          traffic={traffic}
          trace={tracePath ? "path" : "neighbours"}
          exportName={`bnk-topology-cluster-${clusterId}${namespace ? `-${namespace}` : ""}`}
        />
      </div>
    </div>
  );
}
