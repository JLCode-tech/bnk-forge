import type React from "react";
import {
  LayoutDashboard,
  Layers,
  BarChart3,
  ScrollText,
  Users,
  Package,
  FolderGit2,
  KeyRound,
  Bot,
  Zap,
  TrendingUp,
  Globe,
  HardDrive,
  Box,
  Database,
  Shield,
  Cpu,
  Server,
} from "lucide-react";
import type { UserRole } from "@/types";

// Navigation item type
export interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  showCount?: string;
  minRole?: UserRole;
  showDriftBadge?: boolean;
}

export interface NavSection {
  label: string;
  minRole?: UserRole;
  items: NavItem[];
}

// Workflow-First Navigation Structure
export const navigationSections: NavSection[] = [
  {
    // Standalone home item (no section header) — sits above OBSERVE.
    label: "",
    items: [{ name: "Command Center", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "AI CONTROL PLANE",
    items: [
      {
        name: "Agent Fleet & Identity",
        href: "/ai/agents",
        icon: Bot,
        minRole: "viewer",
      },
      {
        name: "Token & Cost Governance",
        href: "/ai/governance",
        icon: TrendingUp,
        minRole: "viewer",
      },
      {
        name: "SmartLLM Traffic Router",
        href: "/ai/routing",
        icon: Zap,
        minRole: "viewer",
      },
      {
        name: "Request Audit Logs",
        href: "/ai/logs",
        icon: ScrollText,
        minRole: "viewer",
      },
    ],
  },
  {
    label: "OBSERVE",
    items: [{ name: "Benchmarks", href: "/benchmarks", icon: BarChart3 }],
  },
  {
    label: "BUILD",
    items: [
      { name: "Catalog", href: "/catalog", icon: Package },
      { name: "Blueprints", href: "/stacks", icon: Layers },
      {
        name: "Access Methods",
        href: "/auth-templates",
        icon: KeyRound,
        minRole: "operator",
      },
      {
        name: "Projects",
        href: "/projects",
        icon: FolderGit2,
        showCount: "projects",
        showDriftBadge: true,
      },
      {
        name: "Operations Log",
        href: "/tasks",
        icon: ScrollText,
        showCount: "activity",
      },
    ],
  },
  {
    label: "OPERATE",
    items: [
      { name: "Fleet", href: "/fleet", icon: Globe, showCount: "fleet" },
      // D-022 P6 IA: Infrastructure section — DPU/BlueField + bare-metal hosts
      { name: "Infrastructure", href: "/infrastructure", icon: HardDrive },
      {
        name: "Kubernetes",
        href: "/kubernetes",
        icon: Box,
        showCount: "clusters",
      },
      { name: "CR Explorer", href: "/crds", icon: Database },
      { name: "F5 BNK", href: "/bnk", icon: Shield },
      { name: "F5 CNF", href: "/cnf", icon: Cpu },
    ],
  },
  {
    label: "SETTINGS",
    minRole: "operator",
    items: [
      { name: "Users", href: "/users", icon: Users, minRole: "admin" },
      { name: "System", href: "/system", icon: Server, minRole: "admin" },
    ],
  },
];
