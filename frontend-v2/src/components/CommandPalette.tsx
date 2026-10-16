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
  LayoutDashboard,
  FolderGit2,
  Package,
  Rocket,
  Settings,
  Plus,
  Activity,
  Globe,
  Server,
  History,
  Shield,
  HardDrive,
  KeyRound,
  Cpu,
  Bot,
  TrendingUp,
  Zap,
  BarChart3,
  Users,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useDeployments } from "@/hooks/useDeployments";
import { DISPLAY_LIMITS } from "@/lib/constants";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const { data: deployments } = useDeployments();
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

  // Navigation items aligned with the 4-domain taxonomy
  const navigationItems = [
    {
      id: "overview",
      label: "Overview",
      icon: LayoutDashboard,
      shortcut: "⌘D",
      action: () => navigate("/"),
    },
    {
      id: "projects",
      label: "Workspaces",
      icon: FolderGit2,
      shortcut: "⌘P",
      action: () => navigate("/projects"),
    },
    {
      id: "catalog",
      label: "Catalog & Blueprints",
      icon: Package,
      shortcut: "⌘M",
      action: () => navigate("/catalog"),
    },
    {
      id: "tasks",
      label: "Activity Log",
      icon: History,
      shortcut: "⌘E",
      action: () => navigate("/tasks"),
    },
    {
      id: "fleet",
      label: "Cluster Fleet",
      icon: Globe,
      shortcut: "G F",
      action: () => navigate("/fleet"),
    },
    {
      id: "kubernetes",
      label: "Kubernetes",
      icon: Server,
      shortcut: "G K",
      action: () => navigate("/kubernetes"),
    },
    {
      id: "bnk",
      label: "F5 BNK",
      icon: Shield,
      shortcut: "G B",
      action: () => navigate("/bnk"),
    },
    {
      id: "cnf",
      label: "F5 CNF",
      icon: Cpu,
      shortcut: "G C",
      action: () => navigate("/cnf"),
    },
    {
      id: "infrastructure",
      label: "Infrastructure",
      icon: HardDrive,
      shortcut: "G I",
      action: () => navigate("/infrastructure"),
    },
    {
      id: "benchmarks",
      label: "Benchmarks",
      icon: BarChart3,
      action: () => navigate("/benchmarks"),
    },
    {
      id: "ai-agents",
      label: "Agent Fleet",
      icon: Bot,
      action: () => navigate("/ai/agents"),
    },
    {
      id: "ai-mcp-gateway",
      label: "Token Governance and Intelligence",
      icon: TrendingUp,
      shortcut: "G G",
      action: () => navigate("/ai/mcp-gateway"),
    },
    {
      id: "ai-llm-router",
      label: "Intelligent Inference",
      icon: Zap,
      action: () => navigate("/ai/llm-router"),
    },
    {
      id: "ai-logs",
      label: "AI Traffic Logs",
      icon: Activity,
      action: () => navigate("/ai/logs"),
    },
    {
      id: "access-methods",
      label: "Credentials & Registries",
      icon: KeyRound,
      shortcut: "G A",
      action: () => navigate("/access-methods"),
    },
    {
      id: "users",
      label: "Users",
      icon: Users,
      action: () => navigate("/users"),
    },
    {
      id: "auth-sso",
      label: "Auth & SSO",
      icon: Lock,
      action: () => navigate("/auth-templates"),
    },
    {
      id: "system",
      label: "System",
      icon: Settings,
      shortcut: "G S",
      action: () => navigate("/system"),
    },
  ];

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
