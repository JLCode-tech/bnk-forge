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
  Globe,
  HardDrive,
  Box,
  Shield,
  Cpu,
  Server,
} from "lucide-react";
import type { UserRole } from "@/types";

// Navigation item type
export interface NavItem {
  name: string;
  href: string;
  matchPaths?: string[];
  description?: string;
  icon: React.ElementType;
  showCount?: string;
  minRole?: UserRole;
  showDriftBadge?: boolean;
}

export interface NavSection {
  label: string;
  icon?: React.ElementType;
  minRole?: UserRole;
  items: NavItem[];
}

export const TOP_STANDALONES: NavItem[] = [
  {
    name: "Overview",
    href: "/",
    description: "Platform overview, fleet health & quick actions",
    icon: LayoutDashboard,
  },
];

// Workflow-First Single-Column Navigation Structure
export const navigationSections: NavSection[] = [
  {
    // Standalone home item (no section header) — sits at the top of the sidebar.
    label: "",
    icon: LayoutDashboard,
    items: TOP_STANDALONES,
  },
  {
    label: "Build",
    icon: FolderGit2,
    items: [
      {
        name: "Workspaces",
        href: "/projects",
        description: "IaC workspaces, modules, variables & state",
        icon: FolderGit2,
        showCount: "projects",
        showDriftBadge: true,
      },
      {
        name: "Catalog & Blueprints",
        href: "/catalog",
        description: "Deployable blueprints, stacks, modules & Helm charts",
        icon: Package,
      },
      {
        name: "Activity Log",
        href: "/tasks",
        description: "Global task queue, execution logs & history",
        icon: ScrollText,
        showCount: "activity",
      },
    ],
  },
  {
    label: "Clusters",
    icon: Globe,
    items: [
      {
        name: "Cluster Fleet",
        href: "/fleet",
        description: "Multi-cluster health, comparison, promotion & lifecycle",
        icon: Globe,
        showCount: "fleet",
      },
      {
        name: "Kubernetes",
        href: "/kubernetes",
        description: "Single-cluster workloads, networking, storage & CRDs",
        icon: Box,
        showCount: "clusters",
      },
      {
        name: "F5 BNK",
        href: "/bnk",
        description:
          "BIG-IP Next for Kubernetes — Gateway, BGP/BFD, CGNAT & Security",
        icon: Shield,
      },
      {
        name: "F5 CNF",
        href: "/cnf",
        description: "Cloud-Native Network Functions — DNS, Telco & L4/L7",
        icon: Cpu,
      },
      {
        name: "CR Explorer",
        href: "/crds",
        description:
          "Browse Custom Resource Definitions, schemas & live instances",
        icon: Layers,
      },
      {
        name: "Infrastructure",
        href: "/infrastructure",
        description: "Bare-metal hosts, NVIDIA BlueField DPUs & topology",
        icon: HardDrive,
      },
      {
        name: "Benchmarks",
        href: "/benchmarks",
        description: "Cluster network & data-plane performance benchmarks",
        icon: BarChart3,
      },
    ],
  },
  {
    label: "AI Service Plane",
    icon: Bot,
    items: [
      {
        name: "Token Governance and Intelligence",
        href: "/ai/token-governance",
        matchPaths: [
          "/ai/token-governance",
          "/ai/mcp-gateway",
          "/ai/governance",
        ],
        description:
          "AI Gateway token telemetry, virtual keys, budgets & tenant governance",
        icon: Layers,
        minRole: "viewer",
      },
      {
        name: "Agent Fleet",
        href: "/ai/agents",
        description: "Autonomous AI agents, identities & policies",
        icon: Bot,
        minRole: "viewer",
      },
      {
        name: "Intelligent Inference",
        href: "/ai/llm-router",
        matchPaths: ["/ai/llm-router", "/ai/routing"],
        description: "SmartLLM traffic routing, failover & model endpoints",
        icon: Zap,
        minRole: "viewer",
      },
      {
        name: "AI Traffic Logs",
        href: "/ai/logs",
        description: "AI request audit trail, latency & token telemetry",
        icon: ScrollText,
        minRole: "viewer",
      },
    ],
  },
  {
    label: "Settings & Access",
    icon: KeyRound,
    minRole: "viewer",
    items: [
      {
        name: "Credentials & Registries",
        href: "/access-methods",
        matchPaths: ["/access-methods", "/auth-templates"],
        description: "SSH keys, cloud credentials & container registries",
        icon: KeyRound,
        minRole: "viewer",
      },
      {
        name: "Users",
        href: "/users",
        description: "User accounts & role assignments",
        icon: Users,
        minRole: "admin",
      },
      {
        name: "System",
        href: "/system",
        description: "Platform health, backups, upgrades & configuration",
        icon: Server,
        minRole: "admin",
      },
    ],
  },
];
