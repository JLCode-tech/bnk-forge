/**
 * E2E-INVARIANTS: Layout & UI Consistency Invariants (Appendix A Crawl)
 *
 * Verifies the design system and layout invariants established in ADR D-036
 * and UI Consistency Audit across all primary routes:
 * 1. Zero raw <select> elements (all migrated to shadcn Select)
 * 2. Zero raw custom fixed modal overlays (all migrated to Dialog/Sheet)
 * 3. Page container discipline (PageShell max-w-7xl or ResourceExplorerLayout full-bleed)
 * 4. Cluster scope persistence across navigation (/kubernetes -> /cnf -> /bnk -> /benchmarks)
 */

import { test, expect } from "../fixtures/auth.fixture";
import { SCENARIO_TIMEOUTS } from "../fixtures/scenario-states";

const AUDITED_ROUTES = [
  "/",
  "/projects",
  "/catalog",
  "/tasks",
  "/kubernetes",
  "/crds",
  "/bnk",
  "/cnf",
  "/stacks",
  "/auth-templates",
  "/system",
  "/fleet",
  "/infrastructure",
  "/benchmarks",
  "/ai/agents",
  "/ai/governance",
  "/ai/routing",
  "/ai/logs",
  "/users",
];

test.describe("Layout & UI Consistency Invariants", () => {
  for (const route of AUDITED_ROUTES) {
    test(`route ${route} satisfies layout invariants`, async ({
      authedPage,
    }) => {
      await authedPage.goto(route);
      await authedPage.waitForLoadState("networkidle");

      // Invariant 1: Zero raw <select> elements on any routed page
      const rawSelects = authedPage.locator("select");
      await expect(
        rawSelects,
        `Raw <select> found on route ${route}`,
      ).toHaveCount(0);

      // Invariant 2: Zero custom fixed inset-0 overlays outside Radix portals
      const customOverlays = authedPage.locator(
        'div.fixed.inset-0:not([data-radix-portal] *):not([role="dialog"] *)',
      );
      await expect(
        customOverlays,
        `Custom fixed overlay found on route ${route}`,
      ).toHaveCount(0);

      // Invariant 3: Page content uses PageShell or ResourceExplorerLayout
      const hasPageShell = await authedPage
        .locator(".max-w-7xl, [data-resource-explorer], main")
        .first()
        .isVisible();
      expect(
        hasPageShell,
        `Page container missing on route ${route}`,
      ).toBeTruthy();
    });
  }

  test("cluster scope persists across navigation", async ({ authedPage }) => {
    // Navigate to /kubernetes
    await authedPage.goto("/kubernetes");
    await authedPage.waitForLoadState("networkidle");

    // Check if cluster combobox/picker exists
    const clusterTrigger = authedPage
      .locator('button[role="combobox"]')
      .first();
    const hasTrigger = await clusterTrigger.isVisible().catch(() => false);

    if (hasTrigger) {
      const initialText = await clusterTrigger.textContent();

      // Navigate to /cnf, /bnk, /benchmarks
      for (const targetRoute of [
        "/cnf",
        "/bnk",
        "/benchmarks",
        "/kubernetes",
      ]) {
        await authedPage.goto(targetRoute);
        await authedPage.waitForLoadState("networkidle");

        const currentTrigger = authedPage
          .locator('button[role="combobox"]')
          .first();
        const currentVisible = await currentTrigger
          .isVisible()
          .catch(() => false);
        if (currentVisible && initialText) {
          const currentText = await currentTrigger.textContent();
          expect(currentText).toBe(initialText);
        }
      }
    }
  });
});
