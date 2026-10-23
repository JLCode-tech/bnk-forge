import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  FolderGit2,
  Package,
  Rocket,
  Plus,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { navigationSections } from "@/components/layout/nav-sections";
import { useProjects } from "@/hooks/useProjects";
import { useDeployments } from "@/hooks/useDeployments";
import { useAuthStore } from "@/stores/authStore";
import { DISPLAY_LIMITS } from "@/lib/constants";
import type { UserRole } from "@/types";

const ROLE_LEVEL: Record<UserRole, number> = {
  admin: 3,
  operator: 2,
  viewer: 1,
};

const NAV_SHORTCUTS: Record<string, string> = {
  "/": "⌘D",
  "/projects": "⌘P",
  "/catalog": "⌘M",
  "/tasks": "⌘E",
  "/fleet": "G F",
  "/kubernetes": "G K",
  "/bnk": "G B",
  "/cnf": "G C",
  "/crds": "G R",
  "/infrastructure": "G I",
  "/benchmarks": "G E",
  "/ai/token-governance": "G G",
  "/ai/agents": "G N",
  "/ai/llm-router": "G L",
  "/ai/logs": "G Y",
  "/access-methods": "G A",
  "/users": "G U",
  "/system": "G S",
};

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { data: projects } = useProjects({ enabled: open });
  const { data: deployments } = useDeployments({ enabled: open });
  const [search, setSearch] = useState("");

  // Quick actions
  const quickActions: Array<{
    id: string;
    label: string;
    icon: LucideIcon;
    shortcut?: string;
    action: () => void;
  }> = [
    {
      id: "new-project",
      label: "Create New Workspace",
      icon: Plus,
      action: () => {
        navigate("/projects?action=create");
      },
    },
    {
      id: "view-operations",
      label: "View Activity Log",
      icon: Activity,
      action: () => navigate("/tasks"),
    },
    {
      id: "browse-catalog",
      label: "Browse Catalog & Blueprints",
      icon: Package,
      action: () => navigate("/catalog"),
    },
  ];

  // Role level (defaults to admin when user is not yet populated in store)
  const userLevel = user?.role ? ROLE_LEVEL[user.role] : ROLE_LEVEL.admin;

  // Navigation items derived dynamically from navigationSections
  const navigationItems = navigationSections
    .filter((section) => {
      if (!section.minRole) return true;
      return userLevel >= ROLE_LEVEL[section.minRole];
    })
    .flatMap((section) =>
      section.items
        .filter((item) => {
          if (!item.minRole) return true;
          return userLevel >= ROLE_LEVEL[item.minRole];
        })
        .map((item) => ({
          id:
            item.href === "/"
              ? "overview"
              : item.href.replace(/^\//, "").replace(/\//g, "-"),
          label: item.name,
          icon: item.icon,
          shortcut: NAV_SHORTCUTS[item.href],
          action: () => navigate(item.href),
        })),
    );

  // Recent projects
  const recentProjects =
    projects
      ?.slice(0, DISPLAY_LIMITS.COMMAND_PALETTE_CATEGORY)
      .map((project) => ({
        id: `project-${project.id}`,
        label: project.name,
        description: project.description || "No description",
        icon: FolderGit2,
        action: () => navigate(`/projects/${project.id}`),
      })) || [];

  // Recent deployments
  const recentDeployments =
    deployments
      ?.slice(0, DISPLAY_LIMITS.COMMAND_PALETTE_CATEGORY)
      .map((deployment) => ({
        id: `deployment-${deployment.id}`,
        label: deployment.library_module?.name || "Unknown Module",
        description: deployment.path_in_project,
        icon: Rocket,
        action: () => navigate("/tasks"),
      })) || [];

  const handleSelect = (action: () => void) => {
    action();
    onOpenChange(false);
    setSearch("");
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command or search..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Quick Actions */}
        <CommandGroup heading="Quick Actions">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <CommandItem
                key={action.id}
                onSelect={() => handleSelect(action.action)}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{action.label}</span>
                {action.shortcut && (
                  <CommandShortcut>{action.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        {/* Navigation */}
        <CommandGroup heading="Navigation">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.id}
                onSelect={() => handleSelect(item.action)}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{item.label}</span>
                {item.shortcut && (
                  <CommandShortcut>{item.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent Projects">
              {recentProjects.map((project) => {
                const Icon = project.icon;
                return (
                  <CommandItem
                    key={project.id}
                    onSelect={() => handleSelect(project.action)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <div className="flex flex-col">
                      <span>{project.label}</span>
                      {project.description && (
                        <span className="text-xs text-muted-foreground">
                          {project.description}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {/* Recent Deployments */}
        {recentDeployments.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent Deployments">
              {recentDeployments.map((deployment) => {
                const Icon = deployment.icon;
                return (
                  <CommandItem
                    key={deployment.id}
                    onSelect={() => handleSelect(deployment.action)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <div className="flex flex-col">
                      <span>{deployment.label}</span>
                      {deployment.description && (
                        <span className="text-xs text-muted-foreground">
                          {deployment.description}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
