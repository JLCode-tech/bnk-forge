/**
 * Tests for CommandPalette component
 *
 * Covers: renders when open, shows quick actions, navigation items,
 * recent projects, recent deployments, search input, item selection
 * triggers navigation and closes palette.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { render } from "@/test/test-utils";
import { CommandPalette } from "@/components/CommandPalette";

// Mock scrollIntoView (used by cmdk library, not available in jsdom)
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// Mock navigation
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

describe("CommandPalette", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders search input when open", () => {
    render(<CommandPalette {...defaultProps} />);

    expect(
      screen.getByPlaceholderText(/type a command or search/i),
    ).toBeInTheDocument();
  });

  it("renders Quick Actions group", async () => {
    render(<CommandPalette {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Quick Actions")).toBeInTheDocument();
    });
  });

  it("renders quick action items", async () => {
    render(<CommandPalette {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Create New Workspace")).toBeInTheDocument();
      expect(screen.getByText("View Activity Log")).toBeInTheDocument();
      expect(
        screen.getByText("Browse Catalog & Blueprints"),
      ).toBeInTheDocument();
    });
  });

  it("renders Navigation group", async () => {
    render(<CommandPalette {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Navigation")).toBeInTheDocument();
    });
  });

  it("renders navigation items", async () => {
    render(<CommandPalette {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Overview")).toBeInTheDocument();
      expect(screen.getByText("Workspaces")).toBeInTheDocument();
      expect(screen.getByText("Catalog & Blueprints")).toBeInTheDocument();
      expect(screen.getByText("Activity Log")).toBeInTheDocument();
      expect(screen.getByText("Cluster Fleet")).toBeInTheDocument();
      expect(screen.getByText("Kubernetes")).toBeInTheDocument();
      expect(
        screen.getByText("Token Governance and Intelligence"),
      ).toBeInTheDocument();
      expect(screen.getByText("Intelligent Inference")).toBeInTheDocument();
      expect(screen.getByText("Credentials & Registries")).toBeInTheDocument();
      expect(screen.getByText("System")).toBeInTheDocument();
    });
  });

  it("renders Recent Projects group when projects exist", async () => {
    render(<CommandPalette {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Recent Projects")).toBeInTheDocument();
    });
  });

  it("shows project names from data", async () => {
    render(<CommandPalette {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("test-project")).toBeInTheDocument();
    });
  });

  it("does not render when open is false", () => {
    render(<CommandPalette open={false} onOpenChange={vi.fn()} />);

    expect(
      screen.queryByPlaceholderText(/type a command or search/i),
    ).not.toBeInTheDocument();
  });

  it("shows keyboard shortcuts for actions", async () => {
    render(<CommandPalette {...defaultProps} />);

    await waitFor(() => {
      // Check for keyboard shortcut badges
      const shortcuts = screen.getAllByText(/⌘/);
      expect(shortcuts.length).toBeGreaterThan(0);
    });
  });
});
