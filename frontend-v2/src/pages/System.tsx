/**
 * System Administration page — D-020 redesign.
 *
 * Bold heading + tab strip. Each tab body renders existing settings panels
 * unchanged. The Appearance tab uses a SectionCard with a theme toggle and
 * two state pills (Light / Dark).
 */

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import PerformanceMonitor from "@/components/settings/PerformanceMonitor";
import DatabaseManagement from "@/components/settings/DatabaseManagement";
import ContainerManagement from "@/components/settings/ContainerManagement";
import SystemDefaults from "@/components/settings/SystemDefaults";
import SystemUpgrade from "@/components/settings/SystemUpgrade";
import AuditLog from "@/components/settings/AuditLog";
import { AlertChannels } from "@/components/settings/AlertChannels";
import { BackupPanel } from "@/components/settings/BackupPanel";
import { McpPanel } from "@/components/system/McpPanel";
// eslint-disable-next-line no-restricted-imports -- Vertical flush sub-sidebar requires Radix TabsList + TabsTrigger
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import {
  Palette,
  Moon,
  Sun,
  Monitor,
  Settings2,
  ScrollText,
  Bell,
  HardDrive,
  Bot,
  RefreshCw,
} from "lucide-react";
import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";
import { useUIStore } from "@/stores/uiStore";
import { usePageRefresh } from "@/hooks/usePageRefresh";

// Old /system?tab=... URLs that now live under /catalog.
const URL_TAB_REDIRECTS: Record<string, string> = {
  "bluefield-images": "/catalog?tab=bfb-images",
  "bf-conf-templates": "/catalog?tab=bf-conf-templates",
  "module-library": "/catalog?tab=module-library",
  "helm-repos": "/catalog?tab=helm-repos",
};

const VALID_TABS = [
  "monitor",
  "mcp",
  "audit",
  "alerts",
  "defaults",
  "appearance",
  "backup",
] as const;

const SYSTEM_TABS = [
  { key: "monitor", label: "System Monitor", icon: Monitor },
  { key: "mcp", label: "MCP Server", icon: Bot },
  { key: "audit", label: "Audit Log", icon: ScrollText },
  { key: "alerts", label: "Alerts", icon: Bell },
  { key: "defaults", label: "Defaults", icon: Settings2 },
  { key: "appearance", label: "Appearance", icon: Palette },
  { key: "backup", label: "Backup & Restore", icon: HardDrive },
] as const;

export default function System() {
  const { theme, setTheme } = useUIStore();
  const { refresh, isRefreshing } = usePageRefresh();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab");
  const initialTab =
    urlTab && (VALID_TABS as readonly string[]).includes(urlTab)
      ? urlTab
      : "monitor";
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    if (urlTab && URL_TAB_REDIRECTS[urlTab]) {
      window.location.replace(URL_TAB_REDIRECTS[urlTab]);
    }
  }, [urlTab]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === "monitor") {
      searchParams.delete("tab");
    } else {
      searchParams.set("tab", tab);
    }
    setSearchParams(searchParams);
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="min-h-[calc(100vh-3rem)] flex"
    >
      {/* Left Flush Inner Sub-Sidebar */}
      <CollapsibleInnerSidebar
        aria-label="System sections"
        className="w-52 shrink-0 border-r border-border bg-card/30 p-3 flex flex-col gap-4"
      >
        <div className="px-2 pt-1 pb-2 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground tracking-tight">
            System
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            Monitor system health, audit activity, and configure application
            settings.
          </p>
        </div>

        <TabsList className="flex flex-col items-stretch h-auto bg-transparent p-0 gap-1">
          {SYSTEM_TABS.map(({ key, label, icon: Icon }) => (
            <TabsTrigger
              key={key}
              value={key}
              className="justify-start gap-2.5 px-3 py-2 text-xs font-medium rounded-md data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none w-full"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </CollapsibleInnerSidebar>

      {/* Right Content Area */}
      <div className="flex-1 min-w-0 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {SYSTEM_TABS.find((t) => t.key === activeTab)?.label ?? "System"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Monitor system health, audit activity, and configure application
              settings.
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

        <TabsContent value="monitor" className="space-y-6 mt-0">
          <SystemUpgrade />
          <PerformanceMonitor hideRefresh />
          <DatabaseManagement />
          <ContainerManagement />
        </TabsContent>

        <TabsContent value="mcp" className="mt-0">
          <McpPanel />
        </TabsContent>

        <TabsContent value="audit" className="mt-0">
          <AuditLog />
        </TabsContent>

        <TabsContent value="alerts" className="mt-0">
          <AlertChannels />
        </TabsContent>

        <TabsContent value="defaults" className="mt-0">
          <SystemDefaults />
        </TabsContent>

        <TabsContent value="appearance" className="mt-0">
          <SectionCard title="Appearance">
            <p className="text-sm text-muted-foreground mb-6">
              Customize the look and feel of the application.
            </p>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm text-foreground">Dark mode</Label>
                <p className="text-sm text-muted-foreground">
                  Switch between light and dark themes.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Sun
                  className={cn(
                    "h-4 w-4",
                    theme === "light"
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                />
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={(checked) =>
                    setTheme(checked ? "dark" : "light")
                  }
                />
                <Moon
                  className={cn(
                    "h-4 w-4",
                    theme === "dark"
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                />
              </div>
            </div>

            <Separator />

            <div className="grid gap-2">
              <Label className="text-foreground/80">Current theme</Label>
              <div className="flex items-center gap-2">
                <Badge
                  variant={theme === "light" ? "default" : "outline"}
                  className="flex items-center gap-1"
                >
                  <Sun className="h-3 w-3" />
                  Light
                </Badge>
                <Badge
                  variant={theme === "dark" ? "default" : "outline"}
                  className="flex items-center gap-1"
                >
                  <Moon className="h-3 w-3" />
                  Dark
                </Badge>
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="backup" className="mt-0">
          <BackupPanel />
        </TabsContent>
      </div>
    </Tabs>
  );
}
