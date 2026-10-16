/**
 * Tests for StatTile component
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@/test/test-utils";
import { Activity } from "lucide-react";
import { StatTile } from "../StatTile";

describe("StatTile", () => {
  it("renders label and value", () => {
    render(<StatTile label="Total Requests" value="1,240" icon={Activity} />);
    expect(screen.getByText("Total Requests")).toBeInTheDocument();
    expect(screen.getByText("1,240")).toBeInTheDocument();
  });

  it("renders loading skeleton when loading=true", () => {
    const { container } = render(
      <StatTile label="Success Rate" value="99.5%" loading />,
    );
    expect(screen.getByText("Success Rate")).toBeInTheDocument();
    expect(screen.queryByText("99.5%")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("renders subtext when provided", () => {
    render(
      <StatTile label="Latency" value="45ms" subtext="Past 24h" tone="info" />,
    );
    expect(screen.getByText("Past 24h")).toBeInTheDocument();
  });
});
