/**
 * AddClusterFlowDialog — Multi-step dialog for adding a cluster from pages
 * that don't have a project context (Fleet, Dashboard).
 *
 * Step 1: Pick a project (or create one via CreateProjectDialog)
 * Step 2: Opens ClusterConfigDialog with the selected projectId
 *
 * Reuses existing CreateProjectDialog and ClusterConfigDialog — no new forms.
 */

import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/hooks/useProjects";
import { useThemeClasses } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";
import { FolderOpen, Plus, ChevronRight, ShieldCheck, FileCode, ArrowLeft } from "lucide-react";
import { ClusterConfigDialog } from "./ClusterConfigDialog";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { AgentEnrollmentWizard } from "@/components/fleet/AgentEnrollmentWizard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Project } from "@/types";

interface AddClusterFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProjectId?: number;
}

export function AddClusterFlowDialog({
  open,
  onOpenChange,
  initialProjectId,
}: AddClusterFlowDialogProps) {
  const tc = useThemeClasses();
  const { data: projects, isLoading } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    initialProjectId ?? null,
  );
  const [step, setStep] = useState<"project" | "method">(
    initialProjectId ? "method" : "project",
  );
  const [showClusterConfig, setShowClusterConfig] = useState(false);
  const [showEnrollWizard, setShowEnrollWizard] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialProjectId) {
        setSelectedProjectId(initialProjectId);
        setStep("method");
      } else {
        setSelectedProjectId(null);
        setStep("project");
      }
    }
  }, [open, initialProjectId]);

  // Find the selected project to pass SSH credential if available
  const selectedProject = projects?.find(
    (p: Project) => p.id === selectedProjectId,
  );

  const handleSelectProject = useCallback((projectId: number) => {
    setSelectedProjectId(projectId);
    setStep("method");
  }, []);

  const handleClusterConfigClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setShowClusterConfig(false);
        if (!initialProjectId) {
          setSelectedProjectId(null);
          setStep("project");
        }
        onOpenChange(false);
      }
    },
    [onOpenChange, initialProjectId],
  );

  const handleEnrollWizardClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setShowEnrollWizard(false);
        if (!initialProjectId) {
          setSelectedProjectId(null);
          setStep("project");
        }
        onOpenChange(false);
      }
    },
    [onOpenChange, initialProjectId],
  );

  const handleClose = useCallback(() => {
    if (!initialProjectId) {
      setSelectedProjectId(null);
      setStep("project");
    }
    setShowClusterConfig(false);
    setShowEnrollWizard(false);
    setShowCreateProject(false);
    onOpenChange(false);
  }, [onOpenChange, initialProjectId]);

  // Step 2b: CreateProjectDialog is open
  if (showCreateProject) {
    return (
      <CreateProjectDialog
        open={true}
        onOpenChange={(isOpen) => {
          if (!isOpen) setShowCreateProject(false);
        }}
      />
    );
  }

  // Step 3a: AgentEnrollmentWizard is active (Push-Based Agent)
  if (showEnrollWizard && selectedProjectId) {
    return (
      <AgentEnrollmentWizard
        open={true}
        onOpenChange={handleEnrollWizardClose}
        defaultProjectId={selectedProjectId}
      />
    );
  }

  // Step 3b: ClusterConfigDialog is active (Legacy Kubeconfig)
  if (showClusterConfig && selectedProjectId) {
    return (
      <ClusterConfigDialog
        open={true}
        onOpenChange={handleClusterConfigClose}
        projectId={selectedProjectId}
        projectSshCredentialId={selectedProject?.ssh_credential_id}
      />
    );
  }

  const projectList = projects ?? [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn("sm:max-w-md", tc.bgCard)}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step === "method" && !initialProjectId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 -ml-2"
                onClick={() => setStep("project")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle className={cn("text-xl font-bold", tc.textPrimary)}>
              {step === "project" ? "Add Cluster" : "Choose Integration Method"}
            </DialogTitle>
          </div>
          <DialogDescription className={tc.textMuted}>
            {step === "project"
              ? "Select a project to add the cluster to. Clusters are scoped to projects for organization and access control."
              : `Select how BNK Forge should connect to clusters in "${selectedProject?.name}".`}
          </DialogDescription>
        </DialogHeader>

        {step === "project" ? (
          <div className="mt-2 space-y-2 max-h-[320px] overflow-y-auto">
            {isLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3",
                      tc.borderDefault,
                    )}
                  >
                    <Skeleton className="h-8 w-8 rounded-md" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isLoading && projectList.length === 0 && (
              <div
                className={cn(
                  "rounded-lg border p-6 text-center",
                  tc.borderDefault,
                )}
              >
                <FolderOpen
                  className={cn("h-10 w-10 mx-auto mb-3", tc.textMuted)}
                />
                <p className={cn("text-sm font-medium mb-1", tc.textPrimary)}>
                  No projects yet
                </p>
                <p className={cn("text-xs mb-4", tc.textMuted)}>
                  Create a project first, then add clusters to it.
                </p>
                <Button size="sm" onClick={() => setShowCreateProject(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Create Project
                </Button>
              </div>
            )}

            {!isLoading &&
              projectList.map((project: Project) => (
                <button
                  key={project.id}
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                    "hover:border-primary/50 hover:bg-primary/5",
                    tc.borderDefault,
                  )}
                  onClick={() => handleSelectProject(project.id)}
                >
                  {/* Project color dot */}
                  <div
                    className="h-8 w-8 rounded-md flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ backgroundColor: project.color || "#3b82f6" }}
                  >
                    {project.icon || project.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium truncate",
                        tc.textPrimary,
                      )}
                    >
                      {project.name}
                    </p>
                    <p className={cn("text-xs truncate", tc.textMuted)}>
                      {project.cluster_count ?? 0} cluster
                      {(project.cluster_count ?? 0) !== 1 ? "s" : ""}
                      {project.environment && <> · {project.environment}</>}
                    </p>
                  </div>
                  <ChevronRight
                    className={cn("h-4 w-4 shrink-0", tc.textMuted)}
                  />
                </button>
              ))}
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            {/* Method 1: Push-Based Agent (Recommended) */}
            <button
              type="button"
              className={cn(
                "w-full text-left rounded-lg border-2 border-primary/40 p-4 transition-all hover:border-primary hover:bg-primary/5",
                tc.bgCard
              )}
              onClick={() => setShowEnrollWizard(true)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">
                        Push-Based Edge Agent
                      </span>
                      <Badge variant="default" className="text-[10px] h-4 px-1.5 bg-primary/90">
                        Recommended
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground block mt-0.5">
                      Zero inbound firewall ports needed
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                Single-command Helm or kubectl install. Outbound TLS 1.3 to <code className="text-primary font-mono">:17543</code>, automated CSR enrollment, SPIFFE mTLS, and real-time eBPF socket tracing.
              </p>
            </button>

            {/* Method 2: Direct Kubeconfig (Legacy) */}
            <button
              type="button"
              className={cn(
                "w-full text-left rounded-lg border p-4 transition-all hover:border-muted-foreground/50 hover:bg-muted/50",
                tc.borderDefault,
                tc.bgCard
              )}
              onClick={() => setShowClusterConfig(true)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <FileCode className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-semibold text-sm">
                      Direct Kubeconfig (Legacy Pull)
                    </span>
                    <span className="text-xs text-muted-foreground block mt-0.5">
                      Console polls K8s API server directly
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                Upload or paste kubeconfig credentials. Requires network reachability from console to Kubernetes API server.
              </p>
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
