import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PageHeader } from "../PageHeader";

describe("PageHeader", () => {
  it("renders title, titleBadge, and string subtitle", () => {
    render(
      <PageHeader
        title="Projects Overview"
        titleBadge={<span data-testid="badge">Beta</span>}
        subtitle="Manage all your platform projects"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: /projects overview/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge")).toHaveTextContent("Beta");
    expect(
      screen.getByText("Manage all your platform projects"),
    ).toBeInTheDocument();
  });

  it("renders React node subtitle and children slot", () => {
    render(
      <PageHeader
        title="Node Subtitle Page"
        subtitle={<span data-testid="custom-sub">Dynamic Subtitle</span>}
      >
        <div data-testid="header-child">Extra Metadata</div>
      </PageHeader>,
    );

    expect(screen.getByTestId("custom-sub")).toBeInTheDocument();
    expect(screen.getByTestId("header-child")).toHaveTextContent(
      "Extra Metadata",
    );
  });

  it("renders actions and refresh button", async () => {
    const handleRefresh = vi.fn();
    render(
      <PageHeader
        title="Actions Test"
        actions={<button type="button">Custom Action</button>}
        onRefresh={handleRefresh}
        isRefreshing={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Custom Action" }),
    ).toBeInTheDocument();
    const refreshBtn = screen.getByRole("button", { name: "Refresh" });
    expect(refreshBtn).toBeInTheDocument();
    expect(refreshBtn).not.toBeDisabled();

    await userEvent.click(refreshBtn);
    expect(handleRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables refresh button when isRefreshing is true", () => {
    render(
      <PageHeader
        title="Refreshing Test"
        onRefresh={() => {}}
        isRefreshing={true}
      />,
    );

    const refreshBtn = screen.getByRole("button", { name: "Refresh" });
    expect(refreshBtn).toBeDisabled();
  });

  it("renders onBack button and triggers callback", async () => {
    const handleBack = vi.fn();
    render(
      <PageHeader
        title="Detail View"
        onBack={handleBack}
        backLabel="Back to Projects"
      />,
    );

    const backBtn = screen.getByRole("button", { name: /back to projects/i });
    expect(backBtn).toBeInTheDocument();

    await userEvent.click(backBtn);
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it("renders backHref router link", () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Detail View Link"
          backHref="/projects"
          backLabel="Back to Projects"
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /back to projects/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/projects");
  });

  it("defaults title from route metadata when title prop is omitted", () => {
    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <PageHeader />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: /activity log/i }),
    ).toBeInTheDocument();
  });
});
