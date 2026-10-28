import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStackTemplates } from "@/hooks/useStacks";
import { StackDetailDialog } from "@/components/stacks/StackDetailDialog";
import { ImportedBlueprintDeployDialog } from "@/components/stacks/ImportedBlueprintDeployDialog";
import { Layers, Loader2, Rocket, Search } from "lucide-react";
import type { StackDeployKind, StackTemplateList } from "@/types";

interface AddBlueprintToProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onSuccess?: () => void;
}

const categoryLabels: Record<string, string> = {
  infrastructure: "Infrastructure",
  "bare-metal": "Bare Metal",
  bnk: "Platform (BNK)",
  solution: "Solutions",
  custom: "Custom",
};

const providerLabels: Record<string, string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
  openshift: "OpenShift",
  ibm: "IBM",
  any: "Multi-platform",
  "bare-metal": "Bare metal",
};

export function AddBlueprintToProjectDialog({
  open,
  onOpenChange,
  projectId,
  onSuccess,
}: AddBlueprintToProjectDialogProps) {
  const { data: stacks, isLoading } = useStackTemplates();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [selectedDeployKind, setSelectedDeployKind] =
    useState<StackDeployKind>("template");
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
    }
  }, [open]);

  const filteredStacks = useMemo(() => {
    const list = stacks || [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.category || "").toLowerCase().includes(q),
    );
  }, [stacks, searchQuery]);

  const handleSelectBlueprint = (stack: StackTemplateList) => {
    const kind = stack.deploy_kind ?? "template";
    const slug =
      kind === "builtin-release"
        ? (stack.deploy_slug ?? stack.slug)
        : stack.slug;
    setSelectedSlug(slug);
    setSelectedDeployKind(kind);
    onOpenChange(false);
    setDeployDialogOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Add Blueprint to Workspace
            </DialogTitle>
            <DialogDescription>
              Select a blueprint from the catalog to configure and add to this
              workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search blueprints by name, category, or description..."
              aria-label="Search blueprints"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <ScrollArea className="flex-1 max-h-[420px] pr-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading blueprints...</span>
              </div>
            ) : filteredStacks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Rocket className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">No blueprints found</p>
                {searchQuery && (
                  <p className="text-xs mt-1">
                    No blueprints match &quot;{searchQuery}&quot;
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2 py-1">
                {filteredStacks.map((stack) => {
                  const categoryKey = (
                    stack.category || "custom"
                  ).toLowerCase();
                  const categoryLabel =
                    categoryLabels[categoryKey] || categoryKey;
                  const providerKey =
                    stack.cloud_provider?.toLowerCase() || "any";
                  const providerLabel =
                    providerLabels[providerKey] || providerKey;
                  return (
                    <div
                      key={stack.slug}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectBlueprint(stack)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelectBlueprint(stack);
                        }
                      }}
                      className="flex items-start justify-between gap-4 rounded-lg border border-border p-3.5 hover:bg-muted/50 transition-colors cursor-pointer text-left"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-foreground">
                            {stack.name}
                          </span>
                          {stack.version && (
                            <Badge variant="outline" className="text-[11px]">
                              v{stack.version}
                            </Badge>
                          )}
                          {stack.bnk_version && (
                            <Badge variant="info" className="text-[11px]">
                              BNK {stack.bnk_version}
                            </Badge>
                          )}
                          <Badge variant="muted" className="text-[11px]">
                            {categoryLabel}
                          </Badge>
                          {providerLabel && (
                            <Badge variant="muted" className="text-[11px]">
                              {providerLabel}
                            </Badge>
                          )}
                        </div>
                        {stack.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {stack.description}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectBlueprint(stack);
                        }}
                      >
                        Select
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedDeployKind === "git-release" ? (
        <ImportedBlueprintDeployDialog
          slug={selectedSlug}
          open={deployDialogOpen}
          onOpenChange={setDeployDialogOpen}
          initialProjectId={projectId}
          onSuccess={() => {
            setDeployDialogOpen(false);
            onSuccess?.();
          }}
        />
      ) : (
        <StackDetailDialog
          slug={selectedSlug}
          open={deployDialogOpen}
          onOpenChange={setDeployDialogOpen}
          initialProjectId={projectId}
          onSuccess={() => {
            setDeployDialogOpen(false);
            onSuccess?.();
          }}
        />
      )}
    </>
  );
}
