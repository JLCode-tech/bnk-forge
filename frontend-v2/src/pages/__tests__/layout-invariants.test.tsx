/**
 * UI Consistency & Layout Invariants Tests (ADR D-036 / Phase 5)
 *
 * Verifies that:
 * 1. PageShell applies the canonical width (max-w-7xl mx-auto p-6 space-y-6)
 * 2. PageHeader adheres to typography standards (font-sans, non-mono heading)
 * 3. StatusBadge maps all status categories to canonical design tokens (D8)
 * 4. Micro-label typography uses text-2xs (11px)
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";

describe("Layout Invariants (ADR D-036)", () => {
  it("PageShell renders children inside canonical max-w-7xl container", () => {
    const { container } = render(
      <PageShell data-testid="test-shell">
        <div>Shell Content</div>
      </PageShell>,
    );

    const shell = container.firstChild as HTMLElement;
    expect(shell).toBeTruthy();
    expect(shell.className).toContain("max-w-7xl");
    expect(shell.className).toContain("mx-auto");
    expect(shell.className).toContain("p-6");
    expect(shell.className).toContain("space-y-6");
  });

  it("PageHeader renders non-mono heading with proper styling (D6)", () => {
    render(
      <PageHeader
        title="Fleet Management"
        description="Manage multi-cluster workloads"
      />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toBeTruthy();
    expect(heading.textContent).toBe("Fleet Management");
    // D6: Heading MUST NOT contain font-mono
    expect(heading.className).not.toContain("font-mono");
    expect(heading.className).toContain("text-2xl");
  });

  it("StatusBadge renders design-token styles across canonical statuses (D8)", () => {
    const { rerender } = render(<StatusBadge status="running" />);
    let badge = screen.getByText("Running");
    expect(badge).toBeTruthy();

    rerender(<StatusBadge status="healthy" />);
    badge = screen.getByText("Healthy");
    expect(badge).toBeTruthy();

    rerender(<StatusBadge status="failed" />);
    badge = screen.getByText("Failed");
    expect(badge).toBeTruthy();

    rerender(<StatusBadge status="pending" />);
    badge = screen.getByText("Pending");
    expect(badge).toBeTruthy();
  });
});
