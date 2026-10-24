/**
 * BNK Resource Categories and View Constants
 * Organized by logical workflow for F5 BNK sidebar navigation.
 */

import {
  Shield,
  Globe,
  Route,
  Network,
  Lock,
  Server,
  Activity,
  Settings,
  Map,
  Code,
  ShieldAlert,
  List,
  FileText,
  GitBranch,
  ArrowUpCircle,
  Stethoscope,
  Wand2,
  Workflow,
  Bot,
  Layers,
  Cpu,
  Database,
  Share2,
} from "lucide-react";

// Special view identifiers (not actual K8s resource types)
export const VIEW_HEALTH = "view-health";
export const VIEW_POLICY_MAP = "view-policy-map";
export const VIEW_AI_ANALYZERS = "view-ai-analyzers";
export const VIEW_TOPOLOGY = "view-topology";
export const VIEW_CANVAS = "view-canvas";
export const VIEW_UPGRADE = "view-upgrade";
export const VIEW_DIAGNOSTICS = "view-diagnostics";
export const VIEW_BACKENDS = "view-backends";
export const VIEW_POLICY_BUILDER = "view-policy-builder";
export const VIEW_CONFIG_BUILDER = "view-config-builder";
export const VIEW_TRAFFIC_FLOW = "view-traffic-flow";
export const VIEW_DPF_INFRA = "view-dpf-infra"; // Moved to Fleet page — kept for deep-link backward compat

// A2A Protocol views (kept for deep-link redirect backward compat)
export const VIEW_A2A_DISCOVERY = "view-a2a-discovery";
export const VIEW_A2A_TEMPLATES = "view-a2a-templates";
export const VIEW_A2A_IRULE_LIBRARY = "view-a2a-irule-library";
export const VIEW_A2A_REFERENCE = "view-a2a-reference";

export const SPECIAL_VIEWS = [
  VIEW_HEALTH,
  VIEW_POLICY_MAP,
  VIEW_AI_ANALYZERS,
  VIEW_TOPOLOGY,
  VIEW_CANVAS,
  VIEW_TRAFFIC_FLOW,
  VIEW_UPGRADE,
  VIEW_DIAGNOSTICS,
  VIEW_BACKENDS,
  VIEW_POLICY_BUILDER,
  VIEW_CONFIG_BUILDER,
  VIEW_DPF_INFRA,
  VIEW_A2A_DISCOVERY,
  VIEW_A2A_TEMPLATES,
  VIEW_A2A_IRULE_LIBRARY,
  VIEW_A2A_REFERENCE,
];

export const isSpecialView = (type: string) => SPECIAL_VIEWS.includes(type);

// BNK Resource Categories - Organized into 6 core functional domains
// Order: System & Configuration → Gateways & Traffic → Policies & Security → Topology & Insights → Health & Diagnostics → AI Gateway & A2A
export const bnkResourceCategories = [
  {
    category: "System & Configuration",
    icon: Settings,
    items: [
      { key: VIEW_CONFIG_BUILDER, label: "Configuration Builder", icon: Wand2 },
      { key: "infra", label: "Infra Underlay", icon: Layers },
      { key: "cneinstance", label: "CNE Instances", icon: Server },
      { key: "f5spkglobaloptions", label: "Global Options", icon: Settings },
      { key: "f5spkvlan", label: "VLANs (Legacy)", icon: Network },
      { key: "f5spkstaticroute", label: "Static Routes", icon: Route },
      { key: "ipamrange", label: "IPAM Ranges", icon: Network },
      { key: "f5bnkgateway", label: "BNK Gateway (IPAM)", icon: Globe },
      {
        key: "f5bigpersistenceprofile",
        label: "Persistence Profiles",
        icon: Database,
      },
      { key: "f5bigloghslpub", label: "HSL Publishers", icon: Activity },
      { key: "f5biglogprofile", label: "Log Profiles", icon: FileText },
      { key: "f5bigcneaddresslist", label: "Address Lists", icon: Network },
      { key: "f5bigcneportlist", label: "Port Lists", icon: Network },
    ],
  },
  {
    category: "Gateways & Traffic",
    icon: Globe,
    items: [
      { key: "gateway", label: "Gateways", icon: Globe },
      {
        key: "gatewaysettings",
        label: "Gateway Settings",
        icon: Settings,
      },
      { key: "gatewayclass", label: "Gateway Classes", icon: Shield },
      { key: "httproute", label: "HTTP Routes", icon: Route },
      { key: "grpcroute", label: "GRPC Routes", icon: Network },
      { key: "tcproute", label: "TCP Routes", icon: Network },
      { key: "udproute", label: "UDP Routes", icon: Network },
      { key: "tlsroute", label: "TLS Routes", icon: Lock },
      { key: "l4route", label: "L4 Routes", icon: Route },
      { key: "l4route_24", label: "L4 Routes (Gateway API)", icon: Route },
      { key: VIEW_BACKENDS, label: "Backends", icon: Server },
      { key: "referencegrant", label: "Reference Grants", icon: Shield },
    ],
  },
  {
    category: "Policies & Security",
    icon: Shield,
    items: [
      { key: VIEW_POLICY_BUILDER, label: "Policy Builder", icon: Wand2 },
      { key: "secpolicy", label: "Security Policies", icon: Shield },
      { key: "netpolicy", label: "Network Policies", icon: Network },
      { key: "apppolicy", label: "App Policies", icon: Shield },
      { key: "egressgateway", label: "Egress Gateways", icon: Network },
      {
        key: "bnksecpolicy",
        label: "Security Policies (Legacy)",
        icon: Shield,
      },
      {
        key: "bnknetpolicy",
        label: "Network Policies (Legacy)",
        icon: Network,
      },
      { key: "f5spkegress", label: "Egress Config (Legacy)", icon: Network },
      { key: "f5bigfwpolicy", label: "Firewall Policies", icon: Shield },
      { key: "f5bigfwrulelist", label: "Firewall Rule Lists", icon: List },
      { key: "f5bigddosglobal", label: "DDoS Protection", icon: ShieldAlert },
      { key: "f5spksnatpool", label: "SNAT Pools", icon: Server },
      { key: "f5bigcneirule", label: "iRules", icon: Code },
    ],
  },
  {
    category: "Topology & Insights",
    icon: GitBranch,
    items: [
      { key: VIEW_TOPOLOGY, label: "Object Topology Graph", icon: GitBranch },
      { key: VIEW_CANVAS, label: "Topology Canvas", icon: Share2 },
      {
        key: VIEW_TRAFFIC_FLOW,
        label: "Traffic Flow Pipeline",
        icon: Workflow,
      },
      { key: VIEW_POLICY_MAP, label: "Policy & Security Matrix", icon: Map },
    ],
  },
  {
    category: "Health & Diagnostics",
    icon: Activity,
    items: [
      { key: VIEW_HEALTH, label: "Health Dashboard", icon: Activity },
      {
        key: VIEW_DIAGNOSTICS,
        label: "Diagnostics & QKView",
        icon: Stethoscope,
      },
      { key: VIEW_UPGRADE, label: "Release & Upgrade", icon: ArrowUpCircle },
      {
        key: "scrapetemplate",
        label: "Scrape Templates",
        icon: Activity,
      },
      { key: "scrapeclass", label: "Scrape Classes", icon: Settings },
      { key: "scrape", label: "Scrapes", icon: FileText },
    ],
  },
  {
    category: "AI Gateway & A2A",
    icon: Bot,
    items: [
      {
        key: "aigatewayprofile",
        label: "AI Gateway Profiles",
        icon: Bot,
      },
      { key: "aitenant", label: "AI Tenants", icon: Layers },
      { key: "aimodel", label: "AI Models", icon: Cpu },
      { key: "aiprovider", label: "AI Providers", icon: Server },
      { key: "aicredential", label: "AI Credentials", icon: Lock },
      { key: "aigateway", label: "AI Gateways", icon: Globe },
      { key: "inferencepool", label: "Inference Pools (GAIE)", icon: Cpu },
      {
        key: "inferencemodelrewrite",
        label: "Model Rewrites (GAIE)",
        icon: Route,
      },
      { key: "f5epp", label: "F5 EPP Analyzers", icon: Activity },
    ],
  },
];
