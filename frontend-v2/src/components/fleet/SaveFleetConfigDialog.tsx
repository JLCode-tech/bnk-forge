/**
 * SaveFleetConfigDialog — modal to save a configuration as a reusable Fleet Deployable Config.
 *
 * Allows:
 *   1. Selecting an existing cluster's resource/export to save as a fleet config.
 *   2. Picking from quick starter templates (Gateway API, BNKSecPolicy, InferencePool, etc.).
 *   3. Custom YAML input.
 */

import { useState } from "react";
import { FileCode, Sparkles, Layers, Code } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateFleetConfig } from "@/hooks/useFleet";
import {
  ClusterResourcePicker,
  type DiscoveredResourceItem,
} from "./FleetClusterPicker";
import { cn } from "@/lib/utils";

export interface SaveFleetConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fleetId?: number;
  initialYaml?: string;
  initialName?: string;
}

const STARTER_TEMPLATES = [
  {
    name: "Gateway HTTPRoute",
    category: "routing",
    desc: "Route HTTP traffic to a service via F5 BNK Gateway",
    yaml: `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: fleet-http-route
  namespace: default
spec:
  parentRefs:
    - name: bnk-gateway
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: app-service
          port: 8080`,
  },
  {
    name: "BNK Security Policy (Rate Limit & DDoS)",
    category: "security",
    desc: "F5 BNK rate limiting and denial of service protection",
    yaml: `apiVersion: gateway.k8s.f5net.com/v1alpha1
kind: BNKSecPolicy
metadata:
  name: fleet-rate-limit-policy
  namespace: default
spec:
  rateLimit:
    requestsPerSecond: 1000
    burst: 200
  dosProtection:
    enabled: true`,
  },
  {
    name: "F5 BNK Gateway Ingress",
    category: "gateway",
    desc: "Standard Gateway listener configuration",
    yaml: `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: bnk-gateway
  namespace: default
spec:
  gatewayClassName: f5-bnk
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: All`,
  },
  {
    name: "AI InferencePool",
    category: "ai",
    desc: "Route LLM inference requests to worker pods",
    yaml: `apiVersion: inference.networking.k8s.io/v1
kind: InferencePool
metadata:
  name: llm-inference-pool
  namespace: default
spec:
  selector:
    app: vllm-worker
  targetPort: 8000`,
  },
  {
    name: "Fleet Global ConfigMap",
    category: "custom",
    desc: "Shared environment configuration across clusters",
    yaml: `apiVersion: v1
kind: ConfigMap
metadata:
  name: fleet-global-env
  namespace: default
data:
  FLEET_MANAGED: "true"
  DEPLOYMENT_TIER: "production"`,
  },
];

type SourceMode = "template" | "cluster" | "custom";

export function SaveFleetConfigDialog({
  open,
  onOpenChange,
  fleetId,
  initialYaml = "",
  initialName = "",
}: SaveFleetConfigDialogProps) {
  const [sourceMode, setSourceMode] = useState<SourceMode>("template");
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("custom");
  const [targetNamespace, setTargetNamespace] = useState("default");
  const [configYaml, setConfigYaml] = useState(
    initialYaml || STARTER_TEMPLATES[0].yaml,
  );
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    null,
  );

  const createConfig = useCreateFleetConfig();

  const handleSelectTemplate = (template: (typeof STARTER_TEMPLATES)[0]) => {
    setConfigYaml(template.yaml);
    setCategory(template.category);
    if (!name) {
      setName(template.name);
    }
  };

  const handleSelectClusterResource = (item: DiscoveredResourceItem) => {
    setSelectedResourceId(item.id);
    setConfigYaml(item.yamlSnippet);
    if (item.id === "__all_resources__") {
      setName(item.name);
      setCategory("custom");
    } else {
      setName(`${item.name} (${item.kind})`);
      setCategory(item.category);
      if (item.namespace && item.namespace !== "various") {
        setTargetNamespace(item.namespace);
      }
    }
  };

  const handleSave = () => {
    if (!name.trim() || !configYaml.trim()) return;

    createConfig.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        target_namespace: targetNamespace.trim() || undefined,
        config_yaml: configYaml.trim(),
        fleet_id: fleetId,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setName("");
          setDescription("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileCode className="w-4 h-4 text-primary" />
            Save as Fleet Deployable Config
          </DialogTitle>
          <DialogDescription className="text-xs">
            Save a reusable Kubernetes manifest that can be validated (dry-run)
            and deployed across multiple clusters in this fleet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Source Mode Selector Tabs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                Choose Configuration Source
              </span>
              <div className="flex items-center gap-1 bg-muted/50 p-0.5 rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setSourceMode("template")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                    sourceMode === "template"
                      ? "bg-card text-foreground shadow-sm border border-border/80"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  Starter Templates
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode("cluster")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
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
                  onClick={() => setSourceMode("custom")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
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

            {/* Mode 1: Starter Templates */}
            {sourceMode === "template" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 pt-1">
                {STARTER_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.name}
                    type="button"
                    onClick={() => handleSelectTemplate(tmpl)}
                    className="flex flex-col text-left p-2 rounded border border-border bg-card hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-xs font-medium text-foreground truncate">
                      {tmpl.name}
                    </span>
                    <span className="text-2xs text-muted-foreground line-clamp-1">
                      {tmpl.desc}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Mode 2: Pick from Cluster (Specific Config Item Picker) */}
            {sourceMode === "cluster" && (
              <ClusterResourcePicker
                onSelectResource={handleSelectClusterResource}
                selectedResourceId={selectedResourceId}
              />
            )}

            {/* Mode 3: Custom YAML Notice */}
            {sourceMode === "custom" && (
              <div className="p-2.5 rounded border border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
                Enter your Kubernetes YAML manifest directly in the editor
                below. You can paste any CRD, Gateway API, or core Kubernetes
                resource.
              </div>
            )}
          </div>

          {/* Form details */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-foreground">
                Config Name *
              </label>
              <Input
                placeholder="e.g. Edge Ingress HTTPRoute"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-xs bg-card"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Category
              </label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full h-8 text-xs bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="routing">Routing / HTTPRoute</SelectItem>
                  <SelectItem value="security">
                    Security / BNKSecPolicy
                  </SelectItem>
                  <SelectItem value="gateway">Gateway Ingress</SelectItem>
                  <SelectItem value="ai">AI / InferencePool</SelectItem>
                  <SelectItem value="crd">Custom CRD</SelectItem>
                  <SelectItem value="custom">Custom Manifest</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-foreground">
                Description (optional)
              </label>
              <Input
                placeholder="e.g. Deploys rate limiting and ingress route for AI services"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-8 text-xs bg-card"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Default Namespace
              </label>
              <Input
                placeholder="default"
                value={targetNamespace}
                onChange={(e) => setTargetNamespace(e.target.value)}
                className="h-8 text-xs bg-card"
              />
            </div>
          </div>

          {/* YAML Editor */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-medium text-foreground">
              <span>Kubernetes YAML Manifest *</span>
              <span className="text-2xs text-muted-foreground font-mono">
                {configYaml.split("\n").length} lines
              </span>
            </div>
            <Textarea
              value={configYaml}
              onChange={(e) => setConfigYaml(e.target.value)}
              placeholder="Paste or edit YAML manifest here..."
              rows={12}
              className="font-mono text-xs leading-relaxed bg-card text-foreground"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={
              createConfig.isPending || !name.trim() || !configYaml.trim()
            }
            className="h-8 text-xs"
          >
            {createConfig.isPending
              ? "Saving…"
              : "Save as Fleet Deployable Config"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
