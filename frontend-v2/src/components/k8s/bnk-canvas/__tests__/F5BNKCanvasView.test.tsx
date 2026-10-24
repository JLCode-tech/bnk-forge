import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@/test/test-utils";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { F5BNKCanvasView } from "../F5BNKCanvasView";

const GW = "gateway.networking.k8s.io";
const id = (
  group: string,
  version: string,
  kind: string,
  namespace: string,
  name: string,
) => [group, version, kind, namespace, name].join("|");
const resource = (
  group: string,
  version: string,
  kind: string,
  namespace: string,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  id: id(group, version, kind, namespace, name),
  group,
  version,
  kind,
  namespace,
  name,
  resourceType: kind.toLowerCase(),
  placeholder: false,
  conditions: {},
  facts: [],
  ...extra,
});

const gatewayClass = resource(GW, "v1", "GatewayClass", "", "f5");
const gateway = resource(GW, "v1", "Gateway", "shop", "edge-gw", {
  conditions: { Programmed: "True" },
  facts: [{ label: "address", value: "192.0.2.10" }],
});
const route = resource(GW, "v1", "HTTPRoute", "shop", "web");
const secret = resource("", "", "Secret", "shop", "shop-tls", {
  resourceType: null,
  placeholder: true,
});
const missing = resource("", "", "Service", "shop", "gone", {
  resourceType: null,
  placeholder: true,
});

const canvas = {
  resources: [gatewayClass, gateway, route, secret, missing],
  edges: [
    {
      id: "e1",
      source: gateway.id,
      target: gatewayClass.id,
      type: "class",
      field: "spec.gatewayClassName",
      reason: "",
      status: "valid",
      inferred: false,
      label: "",
    },
    {
      id: "e2",
      source: route.id,
      target: gateway.id,
      type: "parent",
      field: "spec.parentRefs[0]",
      reason: "",
      status: "valid",
      inferred: false,
      label: "http",
    },
    {
      id: "e3",
      source: gateway.id,
      target: secret.id,
      type: "tls",
      field: "spec.listeners[1]",
      reason: "",
      status: "unresolved",
      inferred: false,
      label: "https",
    },
    {
      id: "e4",
      source: route.id,
      target: missing.id,
      type: "backend",
      field: "spec.rules[0].backendRefs[0]",
      reason: "",
      status: "broken",
      inferred: false,
      label: "",
    },
  ],
  findings: [
    {
      severity: "error",
      rule: "unresolved-reference",
      resource: route.id,
      field: "spec.rules[0].backendRefs[0]",
      explanation: "Service shop/gone does not exist.",
      evidence: "",
      remediation: "Create the Service or fix the backendRef.",
    },
  ],
  warnings: [],
  generatedAt: "2026-01-01T00:00:00+00:00",
  partial: false,
  cluster_id: 1,
  namespace: null,
};

describe("F5BNKCanvasView", () => {
  beforeEach(() => {
    server.use(
      http.get("*/api/k8s/clusters/:id/f5bnk/canvas", () =>
        HttpResponse.json(canvas),
      ),
    );
  });

  it("draws a card per resource with counts and findings", async () => {
    render(<F5BNKCanvasView clusterId={1} />);
    await waitFor(() =>
      expect(screen.getByTestId("bnk-canvas")).toBeInTheDocument(),
    );
    expect(screen.getByText("5 resources")).toBeInTheDocument();
    expect(screen.getByText("1 broken")).toBeInTheDocument();
    expect(screen.getByText("edge-gw")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Findings/ }));
    expect(
      screen.getByText("Service shop/gone does not exist."),
    ).toBeInTheDocument();
  });

  it("opens the detail panel for a real resource and not for a placeholder", async () => {
    const onSelect = vi.fn();
    render(<F5BNKCanvasView clusterId={1} onSelectResource={onSelect} />);
    await waitFor(() => expect(screen.getByText("web")).toBeInTheDocument());
    fireEvent.click(screen.getByText("web"));
    expect(onSelect).toHaveBeenCalledWith({
      kind: "HTTPRoute",
      name: "web",
      namespace: "shop",
      resourceType: "httproute",
    });
    onSelect.mockClear();
    fireEvent.click(screen.getByText("shop-tls"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hides Secret references on request", async () => {
    render(<F5BNKCanvasView clusterId={1} />);
    await waitFor(() =>
      expect(screen.getByText("shop-tls")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("Show Secret references"));
    await waitFor(() =>
      expect(screen.queryByText("shop-tls")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("4 resources")).toBeInTheDocument();
  });

  it("explains an empty namespace", async () => {
    server.use(
      http.get("*/api/k8s/clusters/:id/f5bnk/canvas", () =>
        HttpResponse.json({
          ...canvas,
          resources: [],
          edges: [],
          findings: [],
        }),
      ),
    );
    render(<F5BNKCanvasView clusterId={1} namespace="empty" />);
    await waitFor(() =>
      expect(
        screen.getByText("No BIG-IP Next resources found"),
      ).toBeInTheDocument(),
    );
  });
});
