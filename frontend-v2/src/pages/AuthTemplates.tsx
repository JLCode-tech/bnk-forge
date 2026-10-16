/**
 * Access Methods page — D-020 redesign.
 *
 * Bold heading, two SectionCard-shaped panels (SSH connections, credential
 * templates) on a single calm surface, plus a quiet info callout explaining
 * how templates apply to projects.
 */

import { useState } from "react";
import ContainerRegistries from "@/components/settings/ContainerRegistries";
import CredentialTemplates from "@/components/settings/CredentialTemplates";
import SSHCredentials from "@/components/settings/SSHCredentials";
import { Info, KeyRound, Terminal, Package, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
// eslint-disable-next-line no-restricted-imports -- Vertical flush sub-sidebar requires Radix TabsList + TabsTrigger
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import { cn } from "@/lib/utils";

const TAB_META: Record<string, { label: string; description: string }> = {
  templates: {
    label: "Credential Templates",
    description:
      "Reusable cloud-provider credentials and SSH jumphost configurations for workspaces.",
  },
  ssh: {
    label: "SSH Access",
    description:
      "Direct SSH host connections and keys for bare-metal and single-node access.",
  },
  registries: {
    label: "Container Registries",
    description:
      "Private OCI and Docker registries for pulling images across clusters.",
  },
};

export default function AuthTemplates() {
  const { refresh, isRefreshing } = usePageRefresh();
  const [activeTab, setActiveTab] = useState("templates");
  const currentMeta = TAB_META[activeTab] ?? TAB_META.templates;

  return (
    <div data-onboarding="auth-templates-page">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="min-h-[calc(100vh-3rem)] flex"
      >
        {/* Left Flush Inner Sub-Sidebar */}
        <CollapsibleInnerSidebar
          aria-label="Credentials & Registries navigation"
          className="w-52 shrink-0 border-r border-border bg-card/30 p-3 flex flex-col gap-4"
        >
          <div className="px-2 pt-1 pb-2 border-b border-border">
            <h1 className="text-sm font-semibold text-foreground tracking-tight">
              Credentials & Registries
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              Cloud-provider credentials, SSH jumphost configurations, and
              single-node SSH access used across projects and deployments.
            </p>
          </div>

          <TabsList className="flex flex-col items-stretch h-auto bg-transparent p-0 gap-1">
            <TabsTrigger
              value="templates"
              className="justify-start gap-2.5 px-3 py-2 text-xs font-medium rounded-md data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none w-full"
            >
              <KeyRound className="h-3.5 w-3.5 shrink-0" />
              <span>Credential Templates</span>
            </TabsTrigger>
            <TabsTrigger
              value="ssh"
              className="justify-start gap-2.5 px-3 py-2 text-xs font-medium rounded-md data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none w-full"
            >
              <Terminal className="h-3.5 w-3.5 shrink-0" />
              <span>SSH Access</span>
            </TabsTrigger>
            <TabsTrigger
              value="registries"
              className="justify-start gap-2.5 px-3 py-2 text-xs font-medium rounded-md data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none w-full"
            >
              <Package className="h-3.5 w-3.5 shrink-0" />
              <span>Container Registries</span>
            </TabsTrigger>
          </TabsList>
        </CollapsibleInnerSidebar>

        {/* Right Content Area */}
        <div className="flex-1 min-w-0 p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                {currentMeta.label}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {currentMeta.description}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={isRefreshing}
              aria-label="Refresh"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 mr-1.5",
                  isRefreshing && "animate-spin",
                )}
              />
              Refresh
            </Button>
          </div>
          <TabsContent value="templates" className="mt-0 space-y-6">
            <CredentialTemplates />

            {/* How-to callout — token-pure info accent on left border, not whole-card tint */}
            <div className="rounded-xl border border-border bg-card border-l-2 border-l-info p-6">
              <div className="flex items-center gap-2 mb-2">
                <Info className="h-4 w-4 text-info" />
                <h2 className="text-sm font-semibold text-foreground">
                  Using credential templates
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Create credential templates above, then assign them to projects:
              </p>
              <ol className="text-sm list-decimal list-inside space-y-1.5 ml-1 text-foreground/80">
                <li>
                  Go to the{" "}
                  <strong className="text-foreground">Workspaces</strong> page
                </li>
                <li>Click on a project or create a new one</li>
                <li>
                  Click the{" "}
                  <strong className="text-foreground">Credentials</strong>{" "}
                  button on the project detail page
                </li>
                <li>Select a credential template from the dropdown</li>
                <li>Save to apply the template to that project</li>
              </ol>
              <p className="text-sm mt-3 text-muted-foreground">
                <strong className="text-foreground">Tip:</strong> mark a
                template as default to automatically assign it to new projects.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="ssh" className="mt-0 space-y-6">
            <SSHCredentials />
          </TabsContent>

          <TabsContent value="registries" className="mt-0 space-y-6">
            <ContainerRegistries />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
