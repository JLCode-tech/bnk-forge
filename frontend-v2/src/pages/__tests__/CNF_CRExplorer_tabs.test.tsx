/**
 * Tests for URL ?view synchronization in CNF and CRExplorer pages.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@/test/test-utils";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import CNF from "../CNF";
import { K8sCrdExplorerPanel } from "../kubernetes/K8sCrdExplorerPanel";

describe("CNF URL query view synchronization", () => {
  beforeEach(() => {
    localStorage.setItem(STORAGE_KEYS.CNF_PROJECT, "1");
    localStorage.setItem(STORAGE_KEYS.CNF_CLUSTER, "1");
  });

  it("renders default Overview tab when no ?view is provided", async () => {
    render(<CNF />, { initialRoute: "/f5-cnf" });
    await waitFor(() => {
      const overviewTab = screen.getByRole("tab", { name: /Overview/i });
      expect(overviewTab).toHaveAttribute("aria-selected", "true");
    });
  });

  it("selects DNS Services when ?view=dns is in the URL", async () => {
    render(<CNF />, { initialRoute: "/f5-cnf?view=dns" });
    await waitFor(() => {
      const dnsTab = screen.getByRole("tab", { name: /DNS Services/i });
      expect(dnsTab).toHaveAttribute("aria-selected", "true");
    });
  });
});

describe("K8sCrdExplorerPanel (collated CR Explorer) URL query view synchronization", () => {
  beforeEach(() => {
    localStorage.setItem(STORAGE_KEYS.K8S_PROJECT, "1");
    localStorage.setItem(STORAGE_KEYS.K8S_CLUSTER, "1");
  });

  it("renders default CRD Browser tab when no ?view is provided", async () => {
    render(<K8sCrdExplorerPanel clusterId={1} />, {
      initialRoute: "/kubernetes?view=crds",
    });
    await waitFor(() => {
      const crTab = screen.getByRole("tab", { name: /CRD Browser/i });
      expect(crTab).toHaveAttribute("aria-selected", "true");
    });
  });

  it("selects CRD Topology when ?view=topology is in the URL", async () => {
    render(<K8sCrdExplorerPanel clusterId={1} />, {
      initialRoute: "/kubernetes?view=topology",
    });
    await waitFor(() => {
      const topoTab = screen.getByRole("tab", { name: /CRD Topology/i });
      expect(topoTab).toHaveAttribute("aria-selected", "true");
    });
  });
});
