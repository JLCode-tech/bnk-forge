import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatusBadge, formatStatusLabel } from "../StatusBadge";
import { getStatusTone } from "@/lib/status-colors";
import { Activity } from "lucide-react";

describe("formatStatusLabel", () => {
  it("converts snake_case and kebab-case to Title Case", () => {
    expect(formatStatusLabel("in_progress")).toBe("In Progress");
    expect(formatStatusLabel("in-progress")).toBe("In Progress");
    expect(formatStatusLabel("healthy")).toBe("Healthy");
  });
});

describe("getStatusTone (D8)", () => {
  it("maps pending and queued to muted", () => {
    expect(getStatusTone("pending")).toBe("muted");
    expect(getStatusTone("queued")).toBe("muted");
  });

  it("maps running and in_progress to info", () => {
    expect(getStatusTone("running")).toBe("info");
    expect(getStatusTone("in_progress")).toBe("info");
    expect(getStatusTone("deploying")).toBe("info");
  });

  it("maps success and ready to success", () => {
    expect(getStatusTone("success")).toBe("success");
    expect(getStatusTone("ready")).toBe("success");
    expect(getStatusTone("completed")).toBe("success");
    expect(getStatusTone("healthy")).toBe("success");
  });

  it("maps warning, degraded, throttled, drifted to warning", () => {
    expect(getStatusTone("warning")).toBe("warning");
    expect(getStatusTone("degraded")).toBe("warning");
    expect(getStatusTone("throttled")).toBe("warning");
    expect(getStatusTone("drifted")).toBe("warning");
  });

  it("maps failed, error, crashloopbackoff to destructive", () => {
    expect(getStatusTone("failed")).toBe("destructive");
    expect(getStatusTone("error")).toBe("destructive");
    expect(getStatusTone("crashloopbackoff")).toBe("destructive");
    expect(getStatusTone("critical")).toBe("destructive");
  });

  it("maps HTTP status codes appropriately", () => {
    expect(getStatusTone("200")).toBe("success");
    expect(getStatusTone("204")).toBe("success");
    expect(getStatusTone("302")).toBe("info");
    expect(getStatusTone("404")).toBe("warning");
    expect(getStatusTone("500")).toBe("destructive");
  });

  it("falls back to muted for undefined or empty", () => {
    expect(getStatusTone(undefined)).toBe("muted");
    expect(getStatusTone(null)).toBe("muted");
    expect(getStatusTone("")).toBe("muted");
  });
});

describe("StatusBadge component", () => {
  it("renders standard status badge with formatted label", () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("allows explicit tone override", () => {
    const { container } = render(
      <StatusBadge status="custom_state" tone="destructive" />,
    );
    expect(container.firstChild).toHaveClass("text-destructive");
  });

  it("renders custom label when provided", () => {
    render(<StatusBadge status="healthy" label="System OK" />);
    expect(screen.getByText("System OK")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    render(<StatusBadge status="running" icon={Activity} label="Active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
