/**
 * Tests for Sidebar component
 *
 * Covers: renders navigation sections, nav items, role-based filtering,
 * collapse/expand, project count badges, logo, user footer, version display.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { render } from "@/test/test-utils";
import { Sidebar } from "@/components/layout/Sidebar";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const mockAdmin: User = {
  id: 1,
  username: "admin",
  email: "admin@example.com",
  role: "admin",
  is_active: true,
  must_change_password: false,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

const mockViewer: User = {
  id: 3,
  username: "viewer",
  email: "viewer@example.com",
  role: "viewer",
  is_active: true,
  must_change_password: false,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

describe("Sidebar", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    localStorage.clear();
  });

  it("renders the BNK Forge logo text with harmonized muted-foreground typography", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    const heading = screen.getByRole("heading", { name: "BNK Forge" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass(
      "text-xl",
      "font-extrabold",
      "tracking-wide",
      "text-muted-foreground",
    );
    expect(heading).not.toHaveClass("text-foreground");
  });

  it("renders the Forge brand title with muted-foreground typography when window.__BRAND__ is f5", () => {
    window.__BRAND__ = "f5";
    try {
      act(() => {
        useAuthStore.getState().login("token", mockAdmin);
      });
      render(<Sidebar />);

      const heading = screen.getByRole("heading", { name: "Forge" });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveClass(
        "text-xl",
        "font-extrabold",
        "tracking-wide",
        "text-muted-foreground",
      );
      expect(heading).not.toHaveClass("text-foreground");
    } finally {
      delete window.__BRAND__;
    }
  });

  it("renders the Infrastructure subtitle", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getAllByText("Infrastructure").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("renders Overview standalone navigation item", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-icon-rail")).not.toBeInTheDocument();
  });

  it("renders Build section with navigation items", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
    expect(screen.getByText("Catalog & Blueprints")).toBeInTheDocument();
    expect(screen.getByText("Activity Log")).toBeInTheDocument();
  });

  it("renders Clusters section with navigation items without embedded cluster scope switcher", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getByText("Clusters")).toBeInTheDocument();
    expect(
      screen.queryByTestId("sidebar-cluster-scope"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Cluster Fleet")).toBeInTheDocument();
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText("F5 BNK")).toBeInTheDocument();
    expect(screen.getByText("F5 CNF")).toBeInTheDocument();
    expect(screen.getByText("Benchmarks")).toBeInTheDocument();
  });

  it("renders AI Service Plane section with navigation items", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getByText("AI Service Plane")).toBeInTheDocument();
    expect(screen.getByText("Agent Fleet")).toBeInTheDocument();
    expect(
      screen.getByText("Token Governance and Intelligence"),
    ).toBeInTheDocument();
    expect(screen.getByText("Intelligent Inference")).toBeInTheDocument();
    expect(screen.getByText("AI Traffic Logs")).toBeInTheDocument();
  });

  it("renders Settings & Access section for admin without duplicate Auth & SSO item", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getByText("Settings & Access")).toBeInTheDocument();
    expect(screen.getByText("Credentials & Registries")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.queryByText("Auth & SSO")).not.toBeInTheDocument();
  });

  it("shows Credentials & Registries for viewer while hiding admin-only links", () => {
    act(() => {
      useAuthStore.getState().login("token", mockViewer);
    });
    render(<Sidebar />);

    expect(screen.getByText("Settings & Access")).toBeInTheDocument();
    expect(screen.getByText("Credentials & Registries")).toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
  });

  it("hides System link for non-admin users", () => {
    act(() => {
      useAuthStore.getState().login("token", mockViewer);
    });
    render(<Sidebar />);

    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });

  it("renders system operational status", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getByText("All systems operational")).toBeInTheDocument();
  });

  it("renders version number", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    // __APP_VERSION__ is defined as '2.10.10-test' in vitest.config.ts
    expect(screen.getByText(/version/i)).toBeInTheDocument();
  });

  it("renders collapse button", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getByLabelText("Collapse sidebar")).toBeInTheDocument();
  });

  it("collapses sidebar when collapse button is clicked", async () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByLabelText("Collapse sidebar"));

    // After collapse, the expand button should be visible
    expect(screen.getByLabelText("Expand sidebar")).toBeInTheDocument();
    // Logo text should be hidden
    expect(screen.queryByText("BNK Forge")).not.toBeInTheDocument();
  });

  it("renders user info in footer when logged in", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    // Username appears in sidebar footer — may have multiple matches (mock data)
    const elements = screen.getAllByText("admin");
    expect(elements.length).toBeGreaterThan(0);
  });

  it("renders logout button", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getByLabelText("Logout")).toBeInTheDocument();
  });

  it("renders sidebar as aside with aria-label", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getByLabelText("Application sidebar")).toBeInTheDocument();
  });

  it("renders main navigation with aria-label", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    expect(screen.getByLabelText("Main navigation")).toBeInTheDocument();
  });

  it("renders updated workflow ordering for sidebar links", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    const workspaces = screen.getByText("Workspaces");
    const catalog = screen.getByText("Catalog & Blueprints");
    const activityLog = screen.getByText("Activity Log");
    const fleet = screen.getByText("Cluster Fleet");
    const kubernetes = screen.getByText("Kubernetes");
    const credentials = screen.getByText("Credentials & Registries");

    // Workspaces & IaC: Workspaces → Catalog & Blueprints → Activity Log
    expect(
      workspaces.compareDocumentPosition(catalog) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      catalog.compareDocumentPosition(activityLog) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Workspaces & IaC → Clusters & Fleet → Settings & Access
    expect(
      activityLog.compareDocumentPosition(fleet) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      fleet.compareDocumentPosition(kubernetes) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      kubernetes.compareDocumentPosition(credentials) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows project count badge after data loads", async () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    // Projects should show a count badge from mock data (2 projects)
    await waitFor(
      () => {
        const badges = screen.getAllByText("2");
        expect(badges.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  });
});
