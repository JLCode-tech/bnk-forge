import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageShell } from "../PageShell";

describe("PageShell", () => {
  it("renders children inside standard layout container", () => {
    render(
      <PageShell data-testid="page-shell">
        <div>Content Inside Shell</div>
      </PageShell>,
    );

    const shell = screen.getByTestId("page-shell");
    expect(shell).toBeInTheDocument();
    expect(screen.getByText("Content Inside Shell")).toBeInTheDocument();
    expect(shell).toHaveClass("p-6", "space-y-6", "max-w-7xl", "mx-auto");
  });

  it("applies w-full when width='full'", () => {
    render(
      <PageShell width="full" data-testid="full-shell">
        <div>Full width content</div>
      </PageShell>,
    );

    const shell = screen.getByTestId("full-shell");
    expect(shell).toHaveClass("w-full");
    expect(shell).not.toHaveClass("max-w-7xl");
  });

  it("merges custom className and forwards div attributes", () => {
    render(
      <PageShell
        data-testid="custom-shell"
        data-onboarding="test-step"
        className="custom-modifier"
      >
        <span>Custom</span>
      </PageShell>,
    );

    const shell = screen.getByTestId("custom-shell");
    expect(shell).toHaveClass("custom-modifier", "p-6", "space-y-6");
    expect(shell).toHaveAttribute("data-onboarding", "test-step");
  });
});
