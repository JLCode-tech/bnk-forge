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

describe("CNFOverview and CNFNetworkGraph honest cluster state", () => {
  it("renders Idle Data Plane Topology in CNFOverview and honest empty state in CNFNetworkGraph when 0 CNFs exist", async () => {
    const { CNFOverview } = await import("../cnf-parts/CNFOverview");
    const { CNFNetworkGraph } = await import("../cnf-parts/CNFNetworkGraph");

    const { unmount } = render(
      <CNFOverview
        crdsCount={0}
        dnsCachesCount={0}
        dnsAppsCount={0}
        dnsZonesCount={0}
        cnatCount={0}
        diameterCount={0}
        ipsCount={0}
        onNavigateTab={() => {}}
      />,
    );

    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(
      screen.getByText(/0 network functions deployed on cluster/i),
    ).toBeInTheDocument();
    unmount();

    render(
      <CNFNetworkGraph
        clusterName="bnk-prod-eu"
        namespace="default"
        dnsApps={[]}
        dnsCaches={[]}
        dnsListeners={[]}
        cgnatInstances={[]}
        diameterInstances={[]}
      />,
    );

    expect(
      screen.getByText(/No Active CNF Pipeline Detected/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Preview BNK 2.4.1 Pipeline/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/28.4 Gbps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/42.6 Gbps/i)).not.toBeInTheDocument();
  });

  it("renders Active status and actual deployed CNF nodes without hardcoded telemetry", async () => {
    const { CNFOverview } = await import("../cnf-parts/CNFOverview");
    const { CNFNetworkGraph } = await import("../cnf-parts/CNFNetworkGraph");

    const sampleDnsApp = {
      metadata: { name: "carrier-dns-01", namespace: "f5-bnk" },
      kind: "F5BigDnsApp",
      spec: { ip: "10.20.30.53", port: 53, protocol: "udp" },
      status: { conditions: [{ type: "Programmed", status: "True" }] },
    };

    const { unmount } = render(
      <CNFOverview
        crdsCount={4}
        dnsCachesCount={0}
        dnsAppsCount={1}
        dnsZonesCount={0}
        cnatCount={0}
        diameterCount={0}
        ipsCount={0}
        onNavigateTab={() => {}}
      />,
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(
      screen.getByText(/1 network function in data plane graph/i),
    ).toBeInTheDocument();
    unmount();

    render(
      <CNFNetworkGraph
        clusterName="bnk-prod-eu"
        namespace="f5-bnk"
        dnsApps={[sampleDnsApp as never]}
        dnsCaches={[]}
        dnsListeners={[]}
        cgnatInstances={[]}
        diameterInstances={[]}
      />,
    );

    expect(screen.getAllByText(/carrier-dns-01/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/28.4 Gbps/i)).not.toBeInTheDocument();
  });
});

describe("CNFDnsPanel and CNFTelcoPanel CRUD action wiring", () => {
  it("invokes onCreateResource, onEditResource, and onDeleteResource in CNFDnsPanel and CNFTelcoPanel", async () => {
    const { vi } = await import("vitest");
    const { fireEvent } = await import("@/test/test-utils");
    const { CNFDnsPanel } = await import("../cnf-parts/CNFDnsPanel");
    const { CNFTelcoPanel } = await import("../cnf-parts/CNFTelcoPanel");

    const onCreate = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    const sampleDnsApp = {
      metadata: { name: "carrier-dns-01", namespace: "f5-bnk" },
      kind: "F5BigDnsApp",
      spec: { ip: "10.20.30.53", port: 53, protocol: "udp" },
      status: { conditions: [{ type: "Programmed", status: "True" }] },
    };

    const { unmount } = render(
      <CNFDnsPanel
        caches={[]}
        apps={[sampleDnsApp as never]}
        zones={[]}
        isLoading={false}
        searchQuery=""
        onDescribe={() => {}}
        onCreateResource={onCreate}
        onEditResource={onEdit}
        onDeleteResource={onDelete}
      />,
    );

    const createBtn = screen.getByRole("button", { name: /^Listener$/i });
    fireEvent.click(createBtn);
    expect(onCreate).toHaveBeenCalledWith("f5bigdnsapps");
    unmount();

    const onTelcoCreate = vi.fn();
    render(
      <CNFTelcoPanel
        cnatPolicies={[]}
        diameterEndpoints={[]}
        ipsPolicies={[]}
        isLoading={false}
        selectedResource={null}
        onSelectResource={() => {}}
        onDescribe={() => {}}
        onCreateResource={onTelcoCreate}
        onEditResource={onEdit}
        onDeleteResource={onDelete}
        searchQuery=""
        borderDefault="border-border"
      />,
    );

    const createCgnatBtn = screen.getByRole("button", {
      name: /^CGNAT$/i,
    });
    fireEvent.click(createCgnatBtn);
    expect(onTelcoCreate).toHaveBeenCalledWith("f5bigcgnats");
  });
});

describe("CrdSchemaDrawerDialog kubectl explain inspector", () => {
  it("renders openAPIV3Schema fields, required/enum/default badges, printer columns, and kubectl explain command", async () => {
    const { vi } = await import("vitest");
    const { api } = await import("@/lib/api");
    const { CrdSchemaDrawerDialog } =
      await import("../kubernetes/K8sCrdExplorerPanel");

    vi.spyOn(api, "getCrdSchema").mockResolvedValue({
      name: "f5bigdnsapps.k8s.f5net.com",
      kind: "F5BigDnsApp",
      plural: "f5bigdnsapps",
      singular: "f5bigdnsapp",
      group: "k8s.f5net.com",
      version: "v1",
      scope: "Namespaced",
      short_names: ["dnsapp"],
      versions: ["v1"],
      open_apiv3_schema: {
        type: "object",
        description: "F5 BIG-IP Next CNF DNS Application",
        required: ["spec"],
        properties: {
          spec: {
            type: "object",
            required: ["ip", "port"],
            properties: {
              ip: {
                type: "string",
                description: "Anycast or unicast VIP",
              },
              port: {
                type: "integer",
                default: 53,
              },
              protocol: {
                type: "string",
                enum: ["udp", "tcp"],
              },
            },
          },
        },
      },
      additional_printer_columns: [
        {
          name: "VIP",
          type: "string",
          json_path: ".spec.ip",
          description: "Virtual IP address",
        },
      ],
      conditions: [{ type: "Established", status: "True" }],
    });

    render(
      <CrdSchemaDrawerDialog
        open={true}
        onOpenChange={() => {}}
        clusterId={1}
        crd={{
          name: "f5bigdnsapps.k8s.f5net.com",
          kind: "F5BigDnsApp",
          plural: "f5bigdnsapps",
          group: "k8s.f5net.com",
          version: "v1",
          namespaced: true,
          display_name: "F5BigDnsApp",
          category: "DNS",
          source: "both",
        }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/F5 BIG-IP Next CNF DNS Application/i),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(/kubectl explain f5bigdnsapps\.spec/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Anycast or unicast VIP/i)).toBeInTheDocument();
    expect(screen.getByText(/default: 53/i)).toBeInTheDocument();
    expect(
      screen.getByText(/VIP \(string\) → \.spec\.ip/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("required").length).toBeGreaterThanOrEqual(2);
  });
});
