/**
 * Unit tests for AgentFleetPage — verifying harmonized tabs rendering and switching.
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@/test/test-utils";
import userEvent from "@testing-library/user-event";
import AgentFleetPage from "../AgentFleetPage";

describe("AgentFleetPage", () => {
  it("renders harmonized ResourceViewTabs and allows switching tabs", async () => {
    const user = userEvent.setup();
    render(<AgentFleetPage />);

    // Check tablist exists with accessible label
    const tabList = screen.getByRole("tablist", { name: /Agent fleet tabs/i });
    expect(tabList).toBeInTheDocument();

    // Verify all 4 tabs exist
    const fleetTab = screen.getByRole("tab", { name: /Discovered Fleet/i });
    const discoveryTab = screen.getByRole("tab", {
      name: /A2A Discovery Scanner/i,
    });
    const irulesTab = screen.getByRole("tab", { name: /F5 In-Line iRules/i });
    const referenceTab = screen.getByRole("tab", {
      name: /A2A Protocol Reference/i,
    });

    expect(fleetTab).toBeInTheDocument();
    expect(discoveryTab).toBeInTheDocument();
    expect(irulesTab).toBeInTheDocument();
    expect(referenceTab).toBeInTheDocument();

    // Default tab is 'fleet'
    expect(fleetTab).toHaveAttribute("aria-selected", "true");

    // Click Discovery Scanner tab
    await user.click(discoveryTab);
    await waitFor(() => {
      expect(discoveryTab).toHaveAttribute("aria-selected", "true");
      expect(fleetTab).toHaveAttribute("aria-selected", "false");
    });

    // Click iRules tab
    await user.click(irulesTab);
    await waitFor(() => {
      expect(irulesTab).toHaveAttribute("aria-selected", "true");
      expect(discoveryTab).toHaveAttribute("aria-selected", "false");
    });

    // Click Reference tab
    await user.click(referenceTab);
    await waitFor(() => {
      expect(referenceTab).toHaveAttribute("aria-selected", "true");
      expect(irulesTab).toHaveAttribute("aria-selected", "false");
    });
  });

  it("does not render demo badge and renders discovered agent data", async () => {
    render(<AgentFleetPage />);

    expect(screen.queryByText(/Demo agent registry/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Discovered A2A agents and MCP tool services/i),
    ).toBeInTheDocument();
  });
});
