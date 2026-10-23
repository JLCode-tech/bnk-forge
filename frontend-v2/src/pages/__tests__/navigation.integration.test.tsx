/**
 * Navigation & Routing Integration Tests
 *
 * Tests that the Sidebar and Header components render correct navigation
 * structure, links, breadcrumbs, and interactive elements when composed
 * together with the router and auth state.
 *
 * Lower-level auth-gated visibility (viewer vs admin) is covered in
 * auth-flow.integration.test.tsx. These tests focus on navigation structure
 * and header context for an authenticated admin user.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import { render } from "@/test/test-utils";
import { useAuthStore } from "@/stores/authStore";
import { mockUser } from "@/test/test-fixtures";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";

// ---------------------------------------------------------------------------
// Navigation mock — capture navigate calls without full router integration
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

// ---------------------------------------------------------------------------
// MSW overrides for Header notification endpoints (not in default handlers)
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockNavigate.mockReset();
  act(() => {
    useAuthStore.getState().logout();
  });
  localStorage.clear();

  // Add notification handlers so Header renders without unhandled request warnings
  server.use(
    http.get("*/api/notifications", () => {
      return HttpResponse.json([]);
    }),
    http.get("*/api/notifications/unread-count", () => {
      return HttpResponse.json({ count: 0 });
    }),
  );
});

// ===========================================================================
// Sidebar Tests
// ===========================================================================

describe("Navigation Integration", () => {
  // -------------------------------------------------------------------------
  // 1. Sidebar renders all navigation sections
  // -------------------------------------------------------------------------
  describe("Sidebar renders all navigation sections", () => {
    it("shows Build, Clusters, AI Service Plane, and Settings & Access section headings with key nav items for admin", async () => {
      act(() => {
        useAuthStore.getState().login("mock-jwt-token", mockUser);
      });

      render(<Sidebar />);

      // Wait for async data (badge counts) to settle
      await waitFor(() => {
        expect(screen.getByText("Build")).toBeInTheDocument();
      });

      // Section headings
      expect(screen.getByText("Clusters")).toBeInTheDocument();
      expect(screen.getByText("AI Service Plane")).toBeInTheDocument();
      expect(screen.getByText("Settings & Access")).toBeInTheDocument();

      // Overview — standalone home item
      expect(screen.getByText("Overview")).toBeInTheDocument();

      // Build items
      expect(screen.getByText("Workspaces")).toBeInTheDocument();
      expect(screen.getByText("Catalog & Blueprints")).toBeInTheDocument();
      expect(screen.getByText("Activity Log")).toBeInTheDocument();

      // Clusters items
      expect(screen.getByText("Cluster Fleet")).toBeInTheDocument();
      expect(screen.getByText("Kubernetes")).toBeInTheDocument();
      expect(screen.getByText("F5 BNK")).toBeInTheDocument();
      expect(screen.getByText("F5 CNF")).toBeInTheDocument();
      expect(screen.getByText("Benchmarks")).toBeInTheDocument();

      // AI Service Plane items
      expect(screen.getByText("Agent Fleet")).toBeInTheDocument();
      expect(
        screen.getByText("Token Governance and Intelligence"),
      ).toBeInTheDocument();
      expect(screen.getByText("Intelligent Inference")).toBeInTheDocument();
      expect(screen.getByText("AI Traffic Logs")).toBeInTheDocument();

      // Settings & Access items
      expect(screen.getByText("Credentials & Registries")).toBeInTheDocument();
      expect(screen.getByText("Users")).toBeInTheDocument();
      expect(screen.getByText("System")).toBeInTheDocument();
      expect(screen.queryByText("Auth & SSO")).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Sidebar nav links have correct hrefs
  // -------------------------------------------------------------------------
  describe("Sidebar nav links have correct hrefs", () => {
    it('renders Workspaces with href="/projects", Activity Log with href="/tasks", Catalog & Blueprints with href="/catalog"', async () => {
      act(() => {
        useAuthStore.getState().login("mock-jwt-token", mockUser);
      });

      render(<Sidebar />);

      await waitFor(() => {
        expect(screen.getByText("Workspaces")).toBeInTheDocument();
      });

      // NavLink renders an <a> tag — find the link by its text content
      const projectsLink = screen.getByText("Workspaces").closest("a");
      expect(projectsLink).toHaveAttribute("href", "/projects");

      const opsLogLink = screen.getByText("Activity Log").closest("a");
      expect(opsLogLink).toHaveAttribute("href", "/tasks");

      const catalogLink = screen.getByText("Catalog & Blueprints").closest("a");
      expect(catalogLink).toHaveAttribute("href", "/catalog");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Header renders breadcrumbs for route
  // -------------------------------------------------------------------------
  describe("Header renders breadcrumbs for route", () => {
    it('shows "Build" breadcrumb and "Workspaces" page title when at /projects', async () => {
      act(() => {
        useAuthStore.getState().login("mock-jwt-token", mockUser);
      });

      render(<Header />, { initialRoute: "/projects" });

      await waitFor(() => {
        expect(screen.getByText("Build")).toBeInTheDocument();
      });

      expect(screen.getByText("Workspaces")).toBeInTheDocument();
    });

    it('never shows "Infrastructure Management" for any application route', async () => {
      act(() => {
        useAuthStore.getState().login("mock-jwt-token", mockUser);
      });

      const routes = [
        "/",
        "/projects",
        "/projects/29",
        "/catalog",
        "/stacks",
        "/access-methods",
        "/auth-templates",
        "/tasks",
        "/fleet",
        "/infrastructure",
        "/kubernetes",
        "/crds",
        "/bnk",
        "/cnf",
        "/ai/agents",
        "/ai/token-governance",
        "/ai/llm-router",
        "/ai/logs",
        "/observability/ai-gateway",
        "/observability/ai-gateway/logs",
        "/benchmarks",
        "/users",
        "/system",
      ];

      for (const route of routes) {
        const { unmount } = render(<Header />, { initialRoute: route });
        expect(
          screen.queryByText("Infrastructure Management"),
        ).not.toBeInTheDocument();
        unmount();
      }
    });

    it("renders correct titles and breadcrumbs for application routes", async () => {
      act(() => {
        useAuthStore.getState().login("mock-jwt-token", mockUser);
      });

      const routeExpectations: { route: string; title: string }[] = [
        { route: "/fleet", title: "Cluster Fleet" },
        { route: "/infrastructure", title: "Infrastructure" },
        { route: "/catalog", title: "Catalog & Blueprints" },
        { route: "/stacks", title: "Blueprints" },
        { route: "/access-methods", title: "Credentials & Registries" },
        { route: "/auth-templates", title: "Credentials & Registries" },
        { route: "/users", title: "Users" },
        { route: "/projects/42", title: "Workspaces" },
        { route: "/benchmarks", title: "Benchmarks" },
        { route: "/system", title: "System" },
        { route: "/tasks", title: "Activity Log" },
        { route: "/kubernetes", title: "Kubernetes" },
        { route: "/crds", title: "CR Explorer" },
        { route: "/bnk", title: "F5 BNK" },
        { route: "/cnf", title: "F5 CNF" },
        { route: "/ai/agents", title: "Agent Fleet" },
        {
          route: "/ai/token-governance",
          title: "Token Governance and Intelligence",
        },
        { route: "/ai/llm-router", title: "Intelligent Inference" },
        { route: "/ai/logs", title: "AI Traffic Logs" },
      ];

      for (const { route, title } of routeExpectations) {
        const { unmount } = render(<Header />, { initialRoute: route });
        expect(
          screen.getByRole("heading", { level: 2, name: title }),
        ).toBeInTheDocument();
        unmount();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Header search button renders with keyboard shortcut
  // -------------------------------------------------------------------------
  describe("Header search button renders with keyboard shortcut", () => {
    it('displays "Search..." text and ⌘K shortcut badge', async () => {
      act(() => {
        useAuthStore.getState().login("mock-jwt-token", mockUser);
      });

      render(<Header />, { initialRoute: "/" });

      await waitFor(() => {
        expect(screen.getByText("Search...")).toBeInTheDocument();
      });

      expect(screen.getByText("⌘K")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Header notification bell renders
  // -------------------------------------------------------------------------
  describe("Header notification bell renders", () => {
    it('renders a notification bell button with aria-label="Notifications"', async () => {
      act(() => {
        useAuthStore.getState().login("mock-jwt-token", mockUser);
      });

      render(<Header />, { initialRoute: "/" });

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Notifications" }),
        ).toBeInTheDocument();
      });
    });
  });
});
