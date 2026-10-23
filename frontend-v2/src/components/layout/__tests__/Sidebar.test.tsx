/**
 * Layout tests for Sidebar brand header typography & color alignment
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { screen, act } from "@testing-library/react";
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

describe("Sidebar Brand Typography & Color Alignment", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    localStorage.clear();
    delete window.__BRAND__;
  });

  afterEach(() => {
    delete window.__BRAND__;
  });

  it("matches sidebar navigation muted-foreground color and uses larger bold tracking for BNK Forge brand", () => {
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    const brandTitle = screen.getByRole("heading", { name: "BNK Forge" });
    expect(brandTitle).toHaveClass(
      "text-xl",
      "font-extrabold",
      "tracking-wide",
      "text-muted-foreground",
    );
    expect(brandTitle).not.toHaveClass("text-foreground");

    const buildSectionHeader = screen.getByText("Build").closest("button");
    expect(buildSectionHeader).toHaveClass("text-muted-foreground");
  });

  it("matches sidebar navigation muted-foreground color and uses larger bold tracking for Forge brand (f5)", () => {
    window.__BRAND__ = "f5";
    act(() => {
      useAuthStore.getState().login("token", mockAdmin);
    });
    render(<Sidebar />);

    const brandTitle = screen.getByRole("heading", { name: "Forge" });
    expect(brandTitle).toHaveClass(
      "text-xl",
      "font-extrabold",
      "tracking-wide",
      "text-muted-foreground",
    );
    expect(brandTitle).not.toHaveClass("text-foreground");
  });
});
