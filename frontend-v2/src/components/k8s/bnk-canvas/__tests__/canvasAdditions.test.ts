import { describe, expect, it } from "vitest";
import type { BnkCanvasResource, BnkTrafficStatsResponse } from "@/types";
import { buildCanvasSvg, fitText, svgColor } from "../exportSvg";
import { neighbours, tracePath, type PathEdge } from "../tracePath";
import {
  formatCount,
  trafficOverlay,
  withListenerTraffic,
} from "../trafficOverlay";

// Edges in visual direction, as BnkCanvas draws them.
const e = (source: string, target: string, relationship: string): PathEdge => ({
  source,
  target,
  relationship,
});

// Two Gateway families sharing a class and a SecPolicy that targets both.
const graph = [
  e("class", "gw-a", "class"),
  e("class", "gw-b", "class"),
  e("gw-a", "route-a", "parent"),
  e("gw-b", "route-b", "parent"),
  e("route-a", "svc-a", "backend"),
  e("route-b", "svc-b", "backend"),
  e("route-a", "svc-shared", "backend"),
  e("route-b", "svc-shared", "backend"),
  e("secret-a", "gw-a", "tls"),
  e("gw-a", "settings-a", "configuration"),
  e("settings-a", "infra", "network"),
  e("netpol-a", "gw-a", "policy"),
  e("secpol", "gw-a", "policy"),
  e("secpol", "gw-b", "policy"),
  e("secpol", "fw", "configuration"),
  e("fw", "addr-list", "configuration"),
  e("filter", "route-b", "filter"),
];
const sorted = (ids: Set<string>) => [...ids].sort();

describe("tracePath", () => {
  it.each([
    {
      name: "a Gateway traces its class, routes, backends and support cards",
      start: "gw-a",
      expected: [
        "addr-list",
        "class",
        "fw",
        "gw-a",
        "infra",
        "netpol-a",
        "route-a",
        "secpol",
        "secret-a",
        "settings-a",
        "svc-a",
        "svc-shared",
      ],
    },
    {
      name: "a route traces up to its Gateway and down to its Services only",
      start: "route-b",
      expected: [
        "class",
        "filter",
        "fw",
        "addr-list",
        "gw-b",
        "route-b",
        "secpol",
        "svc-b",
        "svc-shared",
      ],
    },
    {
      name: "a shared Service does not pull in sibling routes' other backends",
      start: "svc-shared",
      expected: [
        "addr-list",
        "class",
        "filter",
        "fw",
        "gw-a",
        "gw-b",
        "netpol-a",
        "route-a",
        "route-b",
        "secpol",
        "secret-a",
        "settings-a",
        "infra",
        "svc-shared",
      ],
    },
    {
      name: "a support card traces every chain it is attached to",
      start: "netpol-a",
      expected: [
        "addr-list",
        "class",
        "fw",
        "gw-a",
        "infra",
        "netpol-a",
        "route-a",
        "secpol",
        "secret-a",
        "settings-a",
        "svc-a",
        "svc-shared",
      ],
    },
    {
      name: "a card with no relationships traces only itself",
      start: "lonely",
      expected: ["lonely"],
    },
  ])("$name", ({ start, expected }) => {
    expect(sorted(tracePath(start, graph))).toEqual([...expected].sort());
  });

  it("does not follow a shared policy into another family", () => {
    const path = tracePath("gw-a", graph);
    expect(path.has("secpol")).toBe(true);
    expect(path.has("gw-b")).toBe(false);
    expect(path.has("route-b")).toBe(false);
  });

  it("neighbours keeps Atlas's one-hop focus", () => {
    expect(sorted(neighbours("gw-a", graph))).toEqual(
      [
        "class",
        "gw-a",
        "netpol-a",
        "route-a",
        "secpol",
        "secret-a",
        "settings-a",
      ].sort(),
    );
  });
});

const GW = "gateway.networking.k8s.io";
const resource = (
  kind: string,
  namespace: string,
  name: string,
  group = "",
  placeholder = false,
): BnkCanvasResource =>
  ({
    id: [group, "v1", kind, namespace, name].join("|"),
    group,
    version: "v1",
    kind,
    namespace,
    name,
    resourceType: kind.toLowerCase(),
    placeholder,
    conditions: {},
    facts: [],
  }) as BnkCanvasResource;

const shopGateway = resource("Gateway", "shop", "edge-gw", GW);
const payGateway = resource("Gateway", "payments", "edge-gw", GW);
const egress = resource(
  "EgressGateway",
  "apps",
  "apps-egress",
  "gateway.k8s.f5.com",
);
const firewall = resource("F5BigFwPolicy", "shop", "shop-fw", "k8s.f5net.com");
const listener = (
  gatewayNamespace: string,
  listenerName: string,
  cur: number,
  tot: number,
) => ({
  gatewayName: "edge-gw",
  gatewayNamespace,
  listenerName,
  clientsideBytesIn: 0,
  clientsideBytesOut: 0,
  clientsideCurConns: cur,
  clientsideTotConns: tot,
  serversideBytesIn: 0,
  serversideBytesOut: 0,
  serversideCurConns: 0,
  serversideTotConns: 0,
});
const stats: BnkTrafficStatsResponse = {
  source: "tmctl",
  podName: "f5-tmm-0",
  sampledAt: "2026-01-01T00:00:00Z",
  available: true,
  error: null,
  listeners: [
    listener("shop", "http", 2, 1200),
    listener("shop", "https", 1, 34),
    listener("payments", "tcp", 0, 1),
    listener("other", "http", 9, 9),
  ],
  egresses: [
    {
      egressName: "apps-egress",
      namespace: "apps",
      clientsideBytesIn: 0,
      clientsideBytesOut: 0,
      clientsideCurConns: 4,
      clientsideTotConns: 2_500_000,
      serversideBytesIn: 0,
      serversideBytesOut: 0,
      serversideCurConns: 0,
      serversideTotConns: 0,
    },
  ],
  firewallRules: [
    {
      policyName: "shop-fw",
      namespace: "shop",
      ruleName: "allow-web",
      action: "accept",
      ipProtocol: "tcp",
      hitCount: 10,
    },
    {
      policyName: "shop-fw",
      namespace: "shop",
      ruleName: "deny-all",
      action: "drop",
      ipProtocol: "any",
      hitCount: 1,
    },
    {
      policyName: "shop-fw",
      namespace: "payments",
      ruleName: "x",
      action: "drop",
      ipProtocol: "any",
      hitCount: 99,
    },
  ],
};

describe("trafficOverlay", () => {
  const overlay = trafficOverlay(
    [shopGateway, payGateway, egress, firewall],
    stats,
  )!;

  it.each([
    {
      name: "sums a Gateway's listeners",
      id: shopGateway.id,
      fact: "3 open · 1.2K conns",
    },
    {
      name: "keeps same-name Gateways apart by namespace",
      id: payGateway.id,
      fact: "0 open · 1 conn",
    },
    {
      name: "maps egress counters",
      id: egress.id,
      fact: "4 open · 2.5M conns",
    },
    {
      name: "sums firewall rule hits per policy",
      id: firewall.id,
      fact: "11 hits · 2 rules",
    },
  ])("$name", ({ id, fact }) => {
    expect(overlay.cards.get(id)).toBe(fact);
  });

  it("ignores counters for resources the canvas does not show", () => {
    expect(overlay.cards.size).toBe(4);
    expect(overlay.listeners.has(`${shopGateway.id}|http`)).toBe(true);
    expect(
      [...overlay.listeners.keys()].some((key) => key.includes("other")),
    ).toBe(false);
  });

  it("is absent when TMM counters are unavailable", () => {
    expect(
      trafficOverlay([shopGateway], { ...stats, available: false }),
    ).toBeUndefined();
    expect(trafficOverlay([shopGateway], undefined)).toBeUndefined();
  });

  it("does not attach counters to placeholders", () => {
    const placeholder = resource("Gateway", "shop", "edge-gw", GW, true);
    expect(trafficOverlay([placeholder], stats)!.cards.size).toBe(0);
  });

  it("annotates only the listener lines of a route edge", () => {
    expect(withListenerTraffic("http\nadmin", shopGateway.id, overlay)).toBe(
      "http · 1.2K conns\nadmin",
    );
    expect(withListenerTraffic("http", payGateway.id, overlay)).toBe("http");
    expect(withListenerTraffic("http", shopGateway.id, undefined)).toBe("http");
  });

  it("formats counts compactly", () => {
    expect([
      formatCount(999),
      formatCount(1200),
      formatCount(2_500_000),
    ]).toEqual(["999", "1.2K", "2.5M"]);
  });
});

describe("buildCanvasSvg", () => {
  const theme = {
    background: "rgb(255, 255, 255)",
    frameFill: "rgba(240, 240, 240, 0.35)",
    frameStroke: "rgb(200, 200, 200)",
    frameText: "rgb(100, 100, 100)",
    labelFill: "rgb(255, 255, 255)",
    labelText: "rgb(0, 0, 0)",
    labelStroke: "rgb(200, 200, 200)",
  };
  const card = {
    x: 0,
    y: 0,
    width: 190,
    height: 62,
    kind: "HTTPRoute",
    name: "web",
    accent: "rgb(1, 2, 3)",
    fill: "rgb(250, 250, 250)",
    text: "rgb(0, 0, 0)",
    muted: "rgb(90, 90, 90)",
  };
  const svg = buildCanvasSvg({
    title: "BNK <Topology> & Canvas",
    theme,
    frames: [{ x: -20, y: -30, width: 600, height: 200, label: "shop" }],
    cards: [
      card,
      {
        ...card,
        x: 300,
        kind: "Service · not found",
        name: "a-very-long-service-name-that-overflows",
        dashed: true,
      },
    ],
    edges: [
      {
        path: "M190,31 C240,31 250,31 300,31",
        color: "rgb(50, 130, 120)",
        width: 1.5,
        dash: "6 3",
        label: ["/api · 75%"],
        labelAt: { x: 245, y: 31 },
      },
      {
        path: "M0,0 C1,1 2,2 3,3",
        color: "rgb(50, 130, 120)",
        width: 1.5,
        label: [],
      },
    ],
  });

  it("is a standalone SVG sized to the frames", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(
      true,
    );
    expect(svg).toContain('viewBox="-44 -54 648 248"');
    expect(svg).not.toContain("var(");
  });

  it("escapes text and keeps one arrow marker per colour", () => {
    expect(svg).toContain("<title>BNK &lt;Topology&gt; &amp; Canvas</title>");
    expect(svg.match(/<marker /g)).toHaveLength(1);
    expect(svg).toContain('marker-end="url(#arrow-0)"');
  });

  it("draws frames, cards, dashes and labels", () => {
    expect(svg).toContain(">SHOP</text>");
    expect(svg).toContain('stroke-dasharray="6 3"');
    expect(svg).toContain('stroke-dasharray="5 3"');
    expect(svg).toContain(">/api · 75%</text>");
    expect(svg).toContain("a-very-long-service-n…");
  });

  it("fits text to the card width", () => {
    expect(fitText("short", 100, 7)).toBe("short");
    expect(fitText("abcdefghij", 35, 7)).toBe("abcd…");
  });

  it.each([
    ["color(srgb 0.927608 0.92098 0.958706)", "rgb(237, 235, 244)"],
    ["color(srgb 1 0 0 / 0.5)", "rgba(255, 0, 0, 0.5)"],
    ["color(srgb 0 0.5 1 / 25%)", "rgba(0, 128, 255, 0.25)"],
    ["rgb(1, 2, 3)", "rgb(1, 2, 3)"],
    ["#7f7f7f", "#7f7f7f"],
  ])("writes %s as an SVG-safe colour", (input, expected) => {
    expect(svgColor(input)).toBe(expected);
  });

  it("converts computed color-mix() fills in the output", () => {
    const mixed = buildCanvasSvg({
      title: "t",
      theme,
      frames: [],
      cards: [{ ...card, fill: "color(srgb 1 1 1)" }],
      edges: [],
    });
    expect(mixed).toContain('fill="rgb(255, 255, 255)"');
    expect(mixed).not.toContain("color(srgb");
  });
});
