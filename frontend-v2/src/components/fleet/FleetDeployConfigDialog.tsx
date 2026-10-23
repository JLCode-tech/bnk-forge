/**
 * FleetDeployConfigDialog — validate (dry-run) and deploy configurations across fleet clusters.
 *
 * Implements:
 *   - "Fleets should be able to deploy a config across multiple clusters within that fleet
 *      again tick the config and deploy (checking of course it will work)."
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  Send,
  ShieldAlert,
  ShieldCheck,
  Check,
  Layers,
  Sparkles,
  Code,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useDeployFleetConfig, useFleetConfigs } from "@/hooks/useFleet";
import { useFleetMembersByFleet } from "@/hooks/useFleet";
import { useAllClusters } from "@/hooks/useK8s";
import {
  ClusterResourcePicker,
  type DiscoveredResourceItem,
} from "./FleetClusterPicker";
import type { DeployFleetConfigResponse } from "@/types/fleet";

export interface FleetDeployConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fleetId: number;
  fleetName: string;
  preselectedConfigId?: number;
}

export function FleetDeployConfigDialog({
  open,
  onOpenChange,
  fleetId,
  fleetName,
  preselectedConfigId,
}: FleetDeployConfigDialogProps) {
  const { data: configsData } = useFleetConfigs(fleetId);
  const configs = useMemo(() => configsData ?? [], [configsData]);

  const { data: fleetMembersData } = useFleetMembersByFleet(fleetId);
  const { data: allClustersData } = useAllClusters();
  const allClusters = useMemo(
    () => allClustersData?.clusters ?? [],
    [allClustersData?.clusters],
  );

  // Determine clusters that belong to this fleet
  const fleetClusters = useMemo(() => {
    if (!fleetMembersData?.members) return [];
    const clusterMembers = fleetMembersData.members.filter(
      (m) => m.member_type === "cluster",
    );
    const memberIds = new Set(clusterMembers.map((m) => m.member_id || m.id));

    // Match with all clusters
    return allClusters.filter((c) => memberIds.has(c.id));
  }, [fleetMembersData, allClusters]);

  // Source mode: 'saved' (saved fleet config), 'cluster' (live cluster resource picker), or 'custom'
  type DeploySourceMode = "saved" | "cluster" | "custom";
  const [sourceMode, setSourceMode] = useState<DeploySourceMode>("saved");

  // Selected config state
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(
    preselectedConfigId || null,
  );
  const [customYaml, setCustomYaml] = useState("");
  const [clusterYaml, setClusterYaml] = useState("");
  const [clusterSelectedResourceId, setClusterSelectedResourceId] = useState<
    string | null
  >(null);
  const [clusterSelectedName, setClusterSelectedName] = useState<string | null>(
    null,
  );
  const [clusterTargetNamespace, setClusterTargetNamespace] = useState<
    string | undefined
  >(undefined);

  // Selected target clusters state (default: all clusters in fleet)
  const [selectedClusterIds, setSelectedClusterIds] = useState<number[]>([]);

  // Validation & Deployment results
  const [validationResult, setValidationResult] =
    useState<DeployFleetConfigResponse | null>(null);
  const [deployResult, setDeployResult] =
    useState<DeployFleetConfigResponse | null>(null);

  const deployMutation = useDeployFleetConfig();

  // Reset or initialize cluster selection when fleet clusters load
  useEffect(() => {
    if (fleetClusters.length > 0 && selectedClusterIds.length === 0) {
      setSelectedClusterIds(fleetClusters.map((c) => c.id));
    }
  }, [fleetClusters, selectedClusterIds.length]);

  // Preselect config if provided
  useEffect(() => {
    if (preselectedConfigId) {
      setSelectedConfigId(preselectedConfigId);
    } else if (
      configs.length > 0 &&
      selectedConfigId === null &&
      sourceMode === "saved"
    ) {
      setSelectedConfigId(configs[0].id);
    }
  }, [preselectedConfigId, configs, selectedConfigId, sourceMode]);

  const activeConfig = useMemo(() => {
    return configs.find((c) => c.id === selectedConfigId);
  }, [configs, selectedConfigId]);

  const activeYaml = useMemo(() => {
    if (sourceMode === "custom") return customYaml;
    if (sourceMode === "cluster") return clusterYaml;
    return activeConfig?.config_yaml || "";
  }, [sourceMode, customYaml, clusterYaml, activeConfig]);

  const activeNamespace = useMemo(() => {
    if (sourceMode === "cluster") return clusterTargetNamespace;
    if (sourceMode === "saved")
      return activeConfig?.target_namespace || undefined;
    return undefined;
  }, [sourceMode, clusterTargetNamespace, activeConfig]);

  const handleSelectClusterResource = (item: DiscoveredResourceItem) => {
    setClusterSelectedResourceId(item.id);
    setClusterYaml(item.yamlSnippet);
    setClusterSelectedName(`${item.name} (${item.kind})`);
    setClusterTargetNamespace(
      item.namespace && item.namespace !== "various"
        ? item.namespace
        : undefined,
    );
    setValidationResult(null);
  };

  // Cluster toggle helpers
  const handleToggleCluster = (clusterId: number) => {
    setValidationResult(null); // clear previous dry-run on selection change
    if (selectedClusterIds.includes(clusterId)) {
      setSelectedClusterIds(
        selectedClusterIds.filter((id) => id !== clusterId),
      );
    } else {
      setSelectedClusterIds([...selectedClusterIds, clusterId]);
    }
  };

  const handleSelectAllClusters = () => {
    setValidationResult(null);
    setSelectedClusterIds(fleetClusters.map((c) => c.id));
  };

  const handleDeselectAllClusters = () => {
    setValidationResult(null);
    setSelectedClusterIds([]);
  };

  // Preflight check (Dry-run)
  const handleCheck = () => {
    if (selectedClusterIds.length === 0 || !activeYaml.trim()) return;

    deployMutation.mutate(
      {
        target_cluster_ids: selectedClusterIds,
        config_yaml: activeYaml,
        target_namespace: activeNamespace,
        dry_run: true,
      },
      {
        onSuccess: (data) => {
          setValidationResult(data);
        },
      },
    );
  };

  // Real Deploy
  const handleDeploy = () => {
    if (selectedClusterIds.length === 0 || !activeYaml.trim()) return;

    deployMutation.mutate(
      {
        target_cluster_ids: selectedClusterIds,
        config_yaml: activeYaml,
        target_namespace: activeNamespace,
        dry_run: false,
      },
      {
        onSuccess: (data) => {
          setDeployResult(data);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Send className="w-4 h-4 text-primary" />
            Deploy Config to Fleet:{" "}
            <span className="text-primary">{fleetName}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Select a configuration, choose target clusters within this fleet,
            validate with preflight dry-run check, and deploy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Step 1: Select Config */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xs font-bold">
                  1
                </span>
                Select Deployable Config
              </label>

              <div className="flex items-center gap-1 bg-muted/50 p-0.5 rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => {
                    setSourceMode("saved");
                    setValidationResult(null);
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all",
                    sourceMode === "saved"
                      ? "bg-card text-foreground shadow-sm border border-border/80"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  Saved Fleet Configs
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSourceMode("cluster");
                    setValidationResult(null);
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all",
                    sourceMode === "cluster"
                      ? "bg-card text-foreground shadow-sm border border-border/80"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  Pick from Cluster
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSourceMode("custom");
                    setValidationResult(null);
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all",
                    sourceMode === "custom"
                      ? "bg-card text-foreground shadow-sm border border-border/80"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Code className="w-3.5 h-3.5 text-primary" />
                  Custom YAML
                </button>
              </div>
            </div>

            {/* Mode 1: Saved Fleet Configs */}
            {sourceMode === "saved" &&
              (configs.length === 0 ? (
                <div className="p-3 border border-dashed border-border rounded-lg text-center text-xs text-muted-foreground bg-muted/20">
                  No saved fleet configs found. Pick from a cluster or enter
                  custom YAML above.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {configs.map((cfg) => {
                    const isSelected = selectedConfigId === cfg.id;
                    return (
                      <div
                        key={cfg.id}
                        onClick={() => {
                          setSelectedConfigId(cfg.id);
                          setValidationResult(null);
                        }}
                        className={cn(
                          "p-2.5 rounded-lg border text-left cursor-pointer transition-all select-none",
                          isSelected
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border bg-card hover:border-primary/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {cfg.name}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-2xs px-1 py-0 h-3.5 uppercase shrink-0"
                          >
                            {cfg.category}
                          </Badge>
                        </div>
                        {cfg.description && (
                          <p className="text-2xs text-muted-foreground line-clamp-1 mb-1.5">
                            {cfg.description}
                          </p>
                        )}
                        <span className="text-2xs text-muted-foreground font-mono">
                          {cfg.config_yaml.split("\n").length} lines
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}

            {/* Mode 2: Pick from Cluster */}
            {sourceMode === "cluster" && (
              <div className="space-y-2">
                <ClusterResourcePicker
                  onSelectResource={handleSelectClusterResource}
                  selectedResourceId={clusterSelectedResourceId}
                />
                {clusterSelectedName && (
                  <div className="flex items-center justify-between p-2 rounded bg-primary/5 border border-primary/20 text-xs">
                    <span className="text-foreground">
                      Selected Item:{" "}
                      <strong className="font-mono">
                        {clusterSelectedName}
                      </strong>
                    </span>
                    <span className="text-2xs text-muted-foreground font-mono">
                      {clusterYaml.split("\n").length} lines
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Mode 3: Custom YAML */}
            {sourceMode === "custom" && (
              <Textarea
                value={customYaml}
                onChange={(e) => {
                  setCustomYaml(e.target.value);
                  setValidationResult(null);
                }}
                placeholder="Paste Kubernetes manifest YAML here..."
                rows={8}
                className="font-mono text-xs bg-card"
              />
            )}
          </div>

          {/* Step 2: Target Clusters */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xs font-bold">
                  2
                </span>
                Target Clusters in Fleet ({selectedClusterIds.length}/
                {fleetClusters.length} selected)
              </label>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleSelectAllClusters}
                  className="text-2xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAllClusters}
                  className="text-2xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border"
                >
                  Deselect All
                </button>
              </div>
            </div>

            {fleetClusters.length === 0 ? (
              <div className="p-3 border border-border rounded-lg text-center text-xs text-muted-foreground bg-muted/20">
                This fleet has no member clusters assigned yet. Add clusters to
                this fleet first.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {fleetClusters.map((cluster) => {
                  const isChecked = selectedClusterIds.includes(cluster.id);
                  const clusterCheckResult =
                    validationResult?.cluster_results.find(
                      (r) => r.cluster_id === cluster.id,
                    );
                  const clusterDeployRes = deployResult?.cluster_results.find(
                    (r) => r.cluster_id === cluster.id,
                  );

                  return (
                    <div
                      key={cluster.id}
                      onClick={() => handleToggleCluster(cluster.id)}
                      className={cn(
                        "flex flex-col p-2.5 rounded-lg border cursor-pointer select-none transition-all",
                        isChecked
                          ? "border-primary/60 bg-card ring-1 ring-primary/40"
                          : "border-border bg-card/60 opacity-60 hover:opacity-90",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={cn(
                              "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                              isChecked
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-muted-foreground/40",
                            )}
                          >
                            {isChecked && (
                              <Check className="w-3 h-3 stroke-[2.5]" />
                            )}
                          </div>
                          <span className="text-xs font-semibold text-foreground truncate">
                            {cluster.name}
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-2xs px-1 h-4 uppercase shrink-0"
                        >
                          {cluster.cloud_provider || "k8s"}
                        </Badge>
                      </div>

                      {/* Cluster validation status pill if checked */}
                      {clusterCheckResult && isChecked && (
                        <div className="mt-2 pt-1.5 border-t border-border flex items-center gap-1.5 text-2xs">
                          {clusterCheckResult.success ? (
                            <span className="flex items-center gap-1 text-success font-medium">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              Ready to deploy
                            </span>
                          ) : (
                            <span
                              className="flex items-center gap-1 text-destructive font-medium line-clamp-1"
                              title={clusterCheckResult.message}
                            >
                              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                              Check failed
                            </span>
                          )}
                        </div>
                      )}

                      {/* Cluster deployment status pill if deployed */}
                      {clusterDeployRes && isChecked && (
                        <div className="mt-2 pt-1.5 border-t border-border flex items-center gap-1.5 text-2xs">
                          {clusterDeployRes.success ? (
                            <span className="flex items-center gap-1 text-success font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Deployed successfully
                            </span>
                          ) : (
                            <span
                              className="flex items-center gap-1 text-destructive font-medium line-clamp-1"
                              title={clusterDeployRes.message}
                            >
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              Deployment failed
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Validation Report Banner */}
          {validationResult && (
            <div
              className={cn(
                "p-3 rounded-lg border text-xs space-y-2",
                validationResult.failed_clusters === 0
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              <div className="flex items-center gap-2 font-semibold">
                {validationResult.failed_clusters === 0 ? (
                  <>
                    <ShieldCheck className="w-4 h-4 text-success shrink-0" />
                    <span>
                      Preflight Check Passed: All{" "}
                      {validationResult.successful_clusters} target clusters are
                      ready for deployment!
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-4 h-4 text-destructive shrink-0" />
                    <span>
                      Preflight Check Found Issues:{" "}
                      {validationResult.failed_clusters} of{" "}
                      {validationResult.total_clusters} clusters failed
                      validation.
                    </span>
                  </>
                )}
              </div>

              {/* Detail list of errors if any */}
              {validationResult.failed_clusters > 0 && (
                <div className="space-y-1 pl-6 text-2xs">
                  {validationResult.cluster_results
                    .filter((r) => !r.success)
                    .map((r) => (
                      <div key={r.cluster_id} className="text-foreground">
                        <span className="font-semibold text-destructive">
                          {r.cluster_name}:
                        </span>{" "}
                        {r.message}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Deployment Report Banner */}
          {deployResult && (
            <div
              className={cn(
                "p-3 rounded-lg border text-xs space-y-2",
                deployResult.failed_clusters === 0
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              <div className="flex items-center gap-2 font-semibold">
                {deployResult.failed_clusters === 0 ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    <span>
                      Deployment Successful: Config applied across{" "}
                      {deployResult.successful_clusters} clusters!
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                    <span>
                      Deployment Finished with Errors:{" "}
                      {deployResult.successful_clusters} succeeded,{" "}
                      {deployResult.failed_clusters} failed.
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs"
          >
            Close
          </Button>

          <div className="flex items-center gap-2">
            {/* Check / Dry-Run button */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCheck}
              disabled={
                deployMutation.isPending ||
                selectedClusterIds.length === 0 ||
                !activeYaml.trim()
              }
              className="h-8 text-xs gap-1.5"
            >
              {deployMutation.isPending && deployMutation.variables?.dry_run ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              )}
              Check / Dry-run
            </Button>

            {/* Deploy button */}
            <Button
              type="button"
              size="sm"
              onClick={handleDeploy}
              disabled={
                deployMutation.isPending ||
                selectedClusterIds.length === 0 ||
                !activeYaml.trim()
              }
              className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {deployMutation.isPending &&
              !deployMutation.variables?.dry_run ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Deploy to Fleet
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
