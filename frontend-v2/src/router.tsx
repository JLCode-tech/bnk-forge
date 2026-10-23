import { createBrowserRouter, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGuard, AdminGuard } from "@/components/layout/AuthGuard";
import { ErrorBoundary, NotFound } from "@/components/ErrorBoundary";
import { Loader2 } from "lucide-react";

// Lazy load route components for code splitting
const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Projects = lazy(() => import("@/pages/Projects"));
const ProjectDetailV2 = lazy(() => import("@/pages/ProjectDetailV2"));
const Catalog = lazy(() => import("@/pages/Catalog"));
const TaskHistory = lazy(() => import("@/pages/TaskHistory"));
const KubernetesV2 = lazy(() => import("@/pages/KubernetesV2"));
const CRExplorer = lazy(() => import("@/pages/CRExplorer"));
const F5BNK = lazy(() => import("@/pages/F5BNK"));
const CNF = lazy(() => import("@/pages/CNF"));
const AuthTemplates = lazy(() => import("@/pages/AuthTemplates"));
const System = lazy(() => import("@/pages/System"));
const Fleet = lazy(() => import("@/pages/Fleet"));
const UserManagement = lazy(() => import("@/pages/UserManagement"));
const Benchmarks = lazy(() => import("@/pages/Benchmarks"));
const Infrastructure = lazy(() => import("@/pages/Infrastructure"));
const LlmDashboard = lazy(() => import("@/pages/observability/LlmDashboard"));
const LlmLogs = lazy(() => import("@/pages/observability/LlmLogs"));
const AgentFleetPage = lazy(() => import("@/pages/ai/AgentFleetPage"));
const SmartLlmRouterPage = lazy(() => import("@/pages/ai/SmartLlmRouterPage"));

export interface RouteBreadcrumb {
  label: string;
  href?: string;
}

export interface RouteHandle {
  title: string;
  breadcrumbs: RouteBreadcrumb[];
}

const PROJECT_DETAIL_HANDLE: RouteHandle = {
  title: "Workspaces",
  breadcrumbs: [
    { label: "Build", href: "/projects" },
    { label: "Workspaces", href: "/projects" },
  ],
};

export const ROUTE_HANDLES: Record<string, RouteHandle> = {
  "/": {
    title: "Overview",
    breadcrumbs: [{ label: "Overview" }],
  },
  "/projects": {
    title: "Workspaces",
    breadcrumbs: [{ label: "Build" }],
  },
  "/catalog": {
    title: "Catalog & Blueprints",
    breadcrumbs: [{ label: "Build" }],
  },
  "/stacks": {
    title: "Blueprints",
    breadcrumbs: [{ label: "Build" }],
  },
  "/access-methods": {
    title: "Credentials & Registries",
    breadcrumbs: [{ label: "Settings & Access" }],
  },
  "/auth-templates": {
    title: "Credentials & Registries",
    breadcrumbs: [{ label: "Settings & Access" }],
  },
  "/tasks": {
    title: "Activity Log",
    breadcrumbs: [{ label: "Build" }],
  },
  "/fleet": {
    title: "Cluster Fleet",
    breadcrumbs: [{ label: "Clusters" }],
  },
  "/infrastructure": {
    title: "Infrastructure",
    breadcrumbs: [{ label: "Clusters" }],
  },
  "/kubernetes": {
    title: "Kubernetes",
    breadcrumbs: [{ label: "Clusters" }],
  },
  "/crds": {
    title: "CR Explorer",
    breadcrumbs: [{ label: "Clusters" }],
  },
  "/bnk": {
    title: "F5 BNK",
    breadcrumbs: [{ label: "Clusters" }],
  },
  "/cnf": {
    title: "F5 CNF",
    breadcrumbs: [{ label: "Clusters" }],
  },
  "/ai/agents": {
    title: "Agent Fleet",
    breadcrumbs: [{ label: "AI Service Plane" }],
  },
  "/ai/token-governance": {
    title: "Token Governance and Intelligence",
    breadcrumbs: [{ label: "AI Service Plane" }],
  },
  "/ai/mcp-gateway": {
    title: "Token Governance and Intelligence",
    breadcrumbs: [{ label: "AI Service Plane" }],
  },
  "/ai/governance": {
    title: "Token Governance and Intelligence",
    breadcrumbs: [{ label: "AI Service Plane" }],
  },
  "/ai/llm-router": {
    title: "Intelligent Inference",
    breadcrumbs: [{ label: "AI Service Plane" }],
  },
  "/ai/routing": {
    title: "Intelligent Inference",
    breadcrumbs: [{ label: "AI Service Plane" }],
  },
  "/ai/logs": {
    title: "AI Traffic Logs",
    breadcrumbs: [{ label: "AI Service Plane" }],
  },
  "/observability/ai-gateway": {
    title: "Token Governance and Intelligence",
    breadcrumbs: [{ label: "AI Service Plane" }],
  },
  "/observability/ai-gateway/logs": {
    title: "AI Traffic Logs",
    breadcrumbs: [{ label: "AI Service Plane" }],
  },
  "/benchmarks": {
    title: "Benchmarks",
    breadcrumbs: [{ label: "Clusters" }],
  },
  "/users": {
    title: "Users",
    breadcrumbs: [{ label: "Settings & Access" }],
  },
  "/system": {
    title: "System",
    breadcrumbs: [{ label: "Settings & Access" }],
  },
};

export function getRouteHandle(pathname: string): RouteHandle | undefined {
  if (ROUTE_HANDLES[pathname]) {
    return ROUTE_HANDLES[pathname];
  }
  if (pathname.startsWith("/projects/")) {
    return PROJECT_DETAIL_HANDLE;
  }
  return undefined;
}

export const router = createBrowserRouter(
  [
    {
      path: "/login",
      element: (
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-screen">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <Login />
        </Suspense>
      ),
      errorElement: <ErrorBoundary />,
      handle: {
        title: "Sign In",
        breadcrumbs: [],
      },
    },
    {
      path: "/",
      element: (
        <AuthGuard>
          <AppShell />
        </AuthGuard>
      ),
      errorElement: <ErrorBoundary />,
      children: [
        {
          index: true,
          element: <Dashboard />,
          handle: ROUTE_HANDLES["/"],
        },
        {
          path: "projects",
          element: <Projects />,
          handle: ROUTE_HANDLES["/projects"],
        },
        {
          path: "projects/:id",
          element: <ProjectDetailV2 />,
          handle: PROJECT_DETAIL_HANDLE,
        },
        {
          path: "projects/:id/:section",
          element: <ProjectDetailV2 />,
          handle: PROJECT_DETAIL_HANDLE,
        },
        {
          // Old /modules URL now lives under the tabbed Catalog page.
          path: "modules",
          element: <Navigate to="/catalog?tab=modules" replace />,
        },
        {
          path: "catalog",
          element: <Catalog />,
          handle: ROUTE_HANDLES["/catalog"],
        },
        {
          path: "catalog/modules",
          element: <Navigate to="/catalog?tab=modules" replace />,
        },
        {
          path: "catalog/module-library",
          element: <Navigate to="/catalog?tab=modules" replace />,
        },
        {
          path: "catalog/blueprint-catalog",
          element: <Navigate to="/catalog?tab=blueprints" replace />,
        },
        {
          path: "catalog/blueprints",
          element: <Navigate to="/catalog?tab=blueprints" replace />,
        },
        {
          path: "catalog/bfb-images",
          element: <Navigate to="/catalog?tab=bfb-images" replace />,
        },
        {
          path: "catalog/bf-conf-templates",
          element: <Navigate to="/catalog?tab=bf-conf-templates" replace />,
        },
        {
          path: "tasks",
          element: <TaskHistory />,
          handle: ROUTE_HANDLES["/tasks"],
        },
        {
          path: "kubernetes",
          element: <KubernetesV2 />,
          handle: ROUTE_HANDLES["/kubernetes"],
        },
        {
          path: "crds",
          element: <CRExplorer />,
          handle: ROUTE_HANDLES["/crds"],
        },
        {
          path: "custom-resources",
          element: <Navigate to="/kubernetes?view=crds" replace />,
        },
        {
          path: "kubernetes/crds",
          element: <Navigate to="/kubernetes?view=crds" replace />,
        },
        {
          // K8S-UX-004: /helm redirects to /kubernetes — Helm is now integrated into K8s page
          path: "helm",
          element: <Navigate to="/kubernetes" replace />,
        },
        {
          path: "bnk",
          element: <F5BNK />,
          handle: ROUTE_HANDLES["/bnk"],
        },
        {
          path: "cnf",
          element: <CNF />,
          handle: ROUTE_HANDLES["/cnf"],
        },
        {
          // Blueprints (/stacks) collated into Catalog & Blueprints (/catalog)
          path: "stacks",
          element: <Navigate to="/catalog" replace />,
          handle: ROUTE_HANDLES["/stacks"],
        },
        {
          path: "access-methods",
          element: <AuthTemplates />,
          handle: ROUTE_HANDLES["/access-methods"],
        },
        {
          path: "auth-templates",
          element: <Navigate to="/access-methods" replace />,
        },
        {
          path: "system",
          element: <System />,
          handle: ROUTE_HANDLES["/system"],
        },
        {
          // K8S-UX-005: Operators merged into Fleet page
          path: "operators",
          element: <Navigate to="/fleet?tab=overview" replace />,
        },
        {
          path: "fleet",
          element: <Fleet />,
          handle: ROUTE_HANDLES["/fleet"],
        },
        {
          // D-022 P6 IA: new top-level Infrastructure section (DPU/BlueField + bare-metal hosts).
          path: "infrastructure",
          element: <Infrastructure />,
          handle: ROUTE_HANDLES["/infrastructure"],
        },
        {
          path: "benchmarks",
          element: <Benchmarks />,
          handle: ROUTE_HANDLES["/benchmarks"],
        },
        {
          path: "ai/agents",
          element: <AgentFleetPage />,
          handle: ROUTE_HANDLES["/ai/agents"],
        },
        {
          path: "ai/token-governance",
          element: <LlmDashboard />,
          handle: ROUTE_HANDLES["/ai/token-governance"],
        },
        {
          path: "ai/mcp-gateway",
          element: <Navigate to="/ai/token-governance" replace />,
          handle: ROUTE_HANDLES["/ai/mcp-gateway"],
        },
        {
          path: "ai/governance",
          element: <Navigate to="/ai/token-governance" replace />,
        },
        {
          path: "ai/llm-router",
          element: <SmartLlmRouterPage />,
          handle: ROUTE_HANDLES["/ai/llm-router"],
        },
        {
          path: "ai/routing",
          element: <SmartLlmRouterPage />,
          handle: ROUTE_HANDLES["/ai/routing"],
        },
        {
          path: "ai/logs",
          element: <LlmLogs />,
          handle: ROUTE_HANDLES["/ai/logs"],
        },
        {
          path: "observability/ai-gateway",
          element: <LlmDashboard />,
          handle: ROUTE_HANDLES["/observability/ai-gateway"],
        },
        {
          path: "observability/ai-gateway/logs",
          element: <LlmLogs />,
          handle: ROUTE_HANDLES["/observability/ai-gateway/logs"],
        },
        {
          path: "mcp-server",
          element: <Navigate to="/system?tab=mcp" replace />,
        },
        {
          path: "users",
          element: (
            <AdminGuard>
              <UserManagement />
            </AdminGuard>
          ),
          handle: ROUTE_HANDLES["/users"],
        },
        {
          path: "*",
          element: <NotFound />,
        },
      ],
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);
