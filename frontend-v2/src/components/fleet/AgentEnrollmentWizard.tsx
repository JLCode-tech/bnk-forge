/**
 * AgentEnrollmentWizard — Console-Driven Push-Based Agent Enrollment.
 * Aligned with Milestone 2 architecture (:17543).
 *
 * Provides single-command Helm install or kubectl apply with short-lived JWT,
 * automated CSR signing with SPIFFE SANs, and live connection detection.
 */

import { useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjects } from "@/hooks/useProjects";
import { useFleetHealth } from "@/hooks/useFleet";
import { useCreateEnrollmentToken } from "@/hooks/useFleetEnrollment";
import { useThemeClasses } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";
import {
  Check,
  Copy,
  ShieldCheck,
  Server,
  Zap,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  Lock,
} from "lucide-react";
import type { EnrollmentTokenResponse } from "@/types/fleetEnrollment";
import type { Project } from "@/types";

interface AgentEnrollmentWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: number | null;
  defaultClusterName?: string;
  onSuccess?: (clusterName: string) => void;
}

export function AgentEnrollmentWizard({
  open,
  onOpenChange,
  defaultProjectId = null,
  defaultClusterName = "",
  onSuccess,
}: AgentEnrollmentWizardProps) {
  const tc = useThemeClasses();
  const { data: projects } = useProjects();
  const { data: fleetHealth, refetch: refetchFleet } = useFleetHealth();
  const createTokenMutation = useCreateEnrollmentToken();

  const [step, setStep] = useState<1 | 2>(1);
  const [clusterName, setClusterName] = useState(defaultClusterName);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    defaultProjectId ? String(defaultProjectId) : "none"
  );
  const [expiryHours, setExpiryHours] = useState<string>("24");
  const [maxUses, setMaxUses] = useState<string>("1");
  const [enrollmentData, setEnrollmentData] =
    useState<EnrollmentTokenResponse | null>(null);
  const [copiedTab, setCopiedTab] = useState<"helm" | "kubectl" | null>(null);

  // Check if target cluster is detected in fleet
  const isClusterConnected = useMemo(() => {
    if (!clusterName || !fleetHealth?.operators) return false;
    return fleetHealth.operators.some(
      (op) =>
        op.cluster_name?.toLowerCase() === clusterName.trim().toLowerCase() &&
        op.status === "healthy"
    );
  }, [clusterName, fleetHealth]);

  const handleGenerate = useCallback(async () => {
    if (!clusterName.trim()) return;

    try {
      const res = await createTokenMutation.mutateAsync({
        cluster_name: clusterName.trim(),
        project_id:
          selectedProjectId !== "none" ? Number(selectedProjectId) : null,
        expires_in_hours: parseInt(expiryHours, 10) || 24,
        max_uses: parseInt(maxUses, 10) || 1,
      });
      setEnrollmentData(res);
      setStep(2);
    } catch {
      // Error handled by useAppMutation
    }
  }, [clusterName, selectedProjectId, expiryHours, maxUses, createTokenMutation]);

  const handleCopy = useCallback((text: string, type: "helm" | "kubectl") => {
    navigator.clipboard.writeText(text);
    setCopiedTab(type);
    setTimeout(() => setCopiedTab(null), 2000);
  }, []);

  const handleClose = useCallback(() => {
    if (step === 2 && enrollmentData && onSuccess) {
      onSuccess(enrollmentData.cluster_name);
    }
    setStep(1);
    setEnrollmentData(null);
    onOpenChange(false);
  }, [step, enrollmentData, onSuccess, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn("sm:max-w-2xl", tc.bgCard)}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className={cn("text-xl font-bold", tc.textPrimary)}>
                Enroll Edge Agent
              </DialogTitle>
              <DialogDescription className={tc.textMuted}>
                Push-based zero-inbound agent with SPIFFE mTLS on port 17543
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-primary flex items-start gap-2.5">
              <Zap className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Push-Based Fleet Architecture</p>
                <p className="text-muted-foreground">
                  The edge agent initiates an outbound TLS 1.3 connection to the console
                  (:17543), performs automated CSR bootstrapping, and streams eBPF & TMM
                  telemetry without opening inbound firewall ports.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="cluster-name" className={tc.textPrimary}>
                  Cluster Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cluster-name"
                  placeholder="e.g. sydney-ai-edge-01"
                  value={clusterName}
                  onChange={(e) => setClusterName(e.target.value)}
                  className="mt-1"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="project-select" className={tc.textPrimary}>
                    Project Tenancy (Optional)
                  </Label>
                  <Select
                    value={selectedProjectId}
                    onValueChange={setSelectedProjectId}
                  >
                    <SelectTrigger id="project-select" className="mt-1">
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (Global Fleet)</SelectItem>
                      {projects?.map((p: Project) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="token-expiry" className={tc.textPrimary}>
                    Token Expiry
                  </Label>
                  <Select value={expiryHours} onValueChange={setExpiryHours}>
                    <SelectTrigger id="token-expiry" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12">12 Hours</SelectItem>
                      <SelectItem value="24">24 Hours (Default)</SelectItem>
                      <SelectItem value="72">3 Days (72h)</SelectItem>
                      <SelectItem value="168">7 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="max-uses" className={tc.textPrimary}>
                  Max Enrollment Uses
                </Label>
                <Input
                  id="max-uses"
                  type="number"
                  min="1"
                  max="100"
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Limits how many clusters can register with this token before automatic revocation.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="default"
                disabled={!clusterName.trim() || createTokenMutation.isPending}
                onClick={handleGenerate}
              >
                {createTokenMutation.isPending && (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                )}
                Generate Install Command
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg border border-border p-3 bg-muted/30">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">{enrollmentData?.cluster_name}</span>
                <Badge variant="outline" className="text-xs font-mono">
                  {enrollmentData?.token_prefix}...
                </Badge>
              </div>

              <div className="flex items-center gap-2">
                {isClusterConnected ? (
                  <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Agent Connected
                  </Badge>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                    <span>Listening on :17543...</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-xs"
                      onClick={() => refetchFleet()}
                    >
                      Check
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <Tabs defaultValue="helm" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="helm" className="text-xs">
                  Helm Install (Recommended)
                </TabsTrigger>
                <TabsTrigger value="kubectl" className="text-xs">
                  kubectl Apply
                </TabsTrigger>
              </TabsList>

              <TabsContent value="helm" className="mt-2 space-y-2">
                <div className="relative rounded-lg bg-black/90 p-3 font-mono text-xs text-emerald-400 overflow-x-auto border border-emerald-950">
                  <pre className="whitespace-pre-wrap break-all">
                    {enrollmentData?.helm_command}
                  </pre>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-2 right-2 h-7 px-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200"
                    onClick={() =>
                      enrollmentData && handleCopy(enrollmentData.helm_command, "helm")
                    }
                  >
                    {copiedTab === "helm" ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="kubectl" className="mt-2 space-y-2">
                <div className="relative rounded-lg bg-black/90 p-3 font-mono text-xs text-cyan-400 overflow-x-auto border border-cyan-950 max-h-56">
                  <pre className="whitespace-pre-wrap break-all">
                    {enrollmentData?.kubectl_command}
                  </pre>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-2 right-2 h-7 px-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200"
                    onClick={() =>
                      enrollmentData &&
                      handleCopy(enrollmentData.kubectl_command, "kubectl")
                    }
                  >
                    {copiedTab === "kubectl" ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1 text-cyan-400" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/10 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Lock className="h-3.5 w-3.5 text-primary" />
                Bootstrap Security Sequence
              </div>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>DaemonSet validates JWT token with Console at <code className="text-primary font-mono">:17543</code>.</li>
                <li>Agent generates an RSA-2048 keypair and transmits CSR.</li>
                <li>Console PKI signs client cert with SPIFFE URI: <code className="text-primary font-mono">spiffe://forge/cluster/[uuid]</code>.</li>
                <li>Agent attaches eBPF socket filters & TMM harvester, streaming telemetry to memory ring buffer.</li>
              </ol>
            </div>

            <div className="flex justify-between items-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep(1)}
              >
                Back
              </Button>
              <Button variant="default" size="sm" onClick={handleClose}>
                {isClusterConnected ? "Done" : "Close"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
