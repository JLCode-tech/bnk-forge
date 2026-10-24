/**
 * Ported from Gateway Atlas (frontend/src/familiesLayout.test.ts), Apache-2.0,
 * Copyright 2026 Gateway Atlas contributors. Cases for kinds the Forge Canvas
 * never draws (Ingress, NGINX VirtualServer/TransportServer) and for Atlas's
 * compact mode are not ported; the class-less packing case uses Gateways.
 */
import { describe, expect, it } from "vitest";
import {
  fanOutGap,
  layoutFamilies,
  type FamilyEdge,
  type FamilyNode,
} from "../familiesLayout";

const node = (kind: string, namespace: string, name: string): FamilyNode => ({
  id: `${kind}|${namespace}|${name}`,
  data: { kind, namespace },
});
const edge = (
  source: FamilyNode,
  target: FamilyNode,
  relationship: string,
): FamilyEdge => ({
  source: source.id,
  target: target.id,
  data: { relationship },
});
const noOverlap = (cards: { x: number; y: number }[]) => {
  for (let a = 0; a < cards.length; a++)
    for (let b = a + 1; b < cards.length; b++)
      expect(
        Math.abs(cards[a].x - cards[b].x) < 190 &&
          Math.abs(cards[a].y - cards[b].y) < 62,
      ).toBe(false);
};

// Two Gateways with private policy chains that share one iRule, a route
// namespace attached to the first Gateway, and a second controller with its
// own namespace.
const f5Class = node("GatewayClass", "cluster-scoped", "f5");
const envoyClass = node("GatewayClass", "cluster-scoped", "envoy");
const gwA = node("Gateway", "edge", "a");
const gwB = node("Gateway", "edge", "b");
const policyA = node("NetPolicy", "edge", "policy-a");
const policyB = node("NetPolicy", "edge", "policy-b");
const iruleA = node("F5BigCneIrule", "edge", "irule-a");
const shared = node("F5BigCneIrule", "edge", "shared");
const route = node("HTTPRoute", "apps", "route");
const service = node("Service", "apps", "svc");
const envoyGw = node("Gateway", "envoy-ns", "e");
const envoyRoute = node("HTTPRoute", "envoy-routes", "r");
const nodes = [
  f5Class,
  envoyClass,
  gwA,
  gwB,
  policyA,
  policyB,
  iruleA,
  shared,
  route,
  service,
  envoyGw,
  envoyRoute,
];
const edges = [
  edge(f5Class, gwA, "class"),
  edge(f5Class, gwB, "class"),
  edge(envoyClass, envoyGw, "class"),
  edge(policyA, gwA, "policy"),
  edge(policyB, gwB, "policy"),
  edge(policyA, iruleA, "configuration"),
  edge(policyA, shared, "configuration"),
  edge(policyB, shared, "configuration"),
  edge(gwA, route, "parent"),
  edge(route, service, "backend"),
  edge(envoyGw, envoyRoute, "parent"),
];
const { positions, frameKeys } = layoutFamilies(nodes, edges);
const at = (item: FamilyNode) => positions.get(item.id)!;

describe("layoutFamilies", () => {
  it("places every resource exactly once", () => {
    expect([...positions.keys()].sort()).toEqual(
      nodes.map((item) => item.id).sort(),
    );
  });
  it.each([
    ["policy sits left of its Gateway on the same row", policyA, gwA, "left"],
    [
      "the policy's private iRule continues farther left",
      iruleA,
      policyA,
      "left",
    ],
    [
      "the second family keeps its own policy beside its own Gateway",
      policyB,
      gwB,
      "left",
    ],
    ["the route continues to the right of its Gateway", route, gwA, "right"],
    [
      "the Service continues to the right of its route",
      service,
      route,
      "right",
    ],
  ] as const)("%s", (_, subject, reference, side) => {
    const a = at(subject);
    const b = at(reference);
    expect(side === "left" ? a.x < b.x : a.x > b.x).toBe(true);
    expect(a.y).toBeCloseTo(b.y, 0);
  });
  it("keeps an iRule shared by two policies out of either family row", () => {
    expect(at(shared).y).not.toBeCloseTo(at(gwA).y, 0);
    expect(at(shared).y).not.toBeCloseTo(at(gwB).y, 0);
    expect(at(shared).x).toBeLessThan(at(gwA).x);
  });
  it("gives each controller band its own cluster-scoped tile, left of that band", () => {
    expect(frameKeys.get(f5Class.id)).toBe(`cluster-scoped:${f5Class.id}`);
    expect(frameKeys.get(envoyClass.id)).toBe(
      `cluster-scoped:${envoyClass.id}`,
    );
    expect(at(f5Class).x).toBeLessThan(at(gwA).x);
    expect(at(envoyClass).x).toBeLessThan(at(envoyGw).x);
  });
  it("stacks bands: the larger F5 band above the other band", () => {
    const f5Bottom = Math.max(
      ...[gwA, gwB, policyA, policyB, iruleA, shared, route, service].map(
        (item) => at(item).y,
      ),
    );
    expect(at(envoyGw).y).toBeGreaterThan(f5Bottom);
  });
  it("is deterministic", () => {
    const again = layoutFamilies([...nodes].reverse(), [...edges].reverse());
    expect(Object.fromEntries(again.positions)).toEqual(
      Object.fromEntries(positions),
    );
  });
  it("packs class-less, unlinked namespaces instead of stacking them in one column", () => {
    const gateways = Array.from({ length: 6 }, (_, index) =>
      node("Gateway", `ns-${index}`, `gw-${index}`),
    );
    const result = layoutFamilies(gateways, []);
    expect(
      new Set(gateways.map((item) => result.positions.get(item.id)!.x)).size,
    ).toBeGreaterThan(1);
  });
});

describe("fanOutGap", () => {
  it.each([
    [0, 0],
    [3, 0],
    [4, 16],
    [10, 112],
    [40, 200],
  ])("%i children → %i px", (children, gap) =>
    expect(fanOutGap(children)).toBe(gap),
  );
});

describe("workload support placement", () => {
  it("keeps a ConfigMap used only by Pods and their Deployment beside them, not in the loose slot", () => {
    const gw = node("Gateway", "default", "gw");
    const policy = node("Policy", "default", "waf");
    const svc = node("Service", "default", "svc");
    const pod = node("Pod", "default", "pod");
    const deploy = node("Deployment", "default", "deploy");
    const cm = node("ConfigMap", "default", "content");
    const routeNode = node("HTTPRoute", "default", "r");
    const links = [
      edge(policy, gw, "policy"),
      edge(gw, routeNode, "parent"),
      edge(routeNode, svc, "backend"),
      edge(svc, pod, "selector"),
      edge(svc, deploy, "selector"),
      edge(pod, cm, "configmap"),
      edge(deploy, cm, "configmap"),
    ];
    const { positions: placed } = layoutFamilies(
      [gw, policy, svc, pod, deploy, cm, routeNode],
      links,
    );
    const p = (item: FamilyNode) => placed.get(item.id)!;
    expect(p(cm).x).toBeGreaterThan(Math.max(p(pod).x, p(deploy).x));
    expect(p(cm).y).toBeGreaterThanOrEqual(Math.min(p(pod).y, p(deploy).y));
    expect(p(cm).y).toBeLessThanOrEqual(Math.max(p(pod).y, p(deploy).y));
  });
});

describe("policy lane", () => {
  // One namespace: Gateway → route → two Services, a policy on the route and one on the Gateway.
  const gw = node("Gateway", "api", "gw");
  const rt = node("HTTPRoute", "api", "rt");
  const a = node("Service", "api", "a");
  const b = node("Service", "api", "b");
  const routePolicy = node("RateLimitPolicy", "api", "limit");
  const gatewayPolicy = node("ClientSettingsPolicy", "api", "client");
  const filter = node("SnippetsFilter", "api", "snip");
  const servicePolicy = node("UpstreamSettingsPolicy", "api", "upstream");
  const items = [
    gw,
    rt,
    a,
    b,
    routePolicy,
    gatewayPolicy,
    filter,
    servicePolicy,
  ];
  const links = [
    edge(gw, rt, "parent"),
    edge(rt, a, "backend"),
    edge(rt, b, "backend"),
    edge(routePolicy, rt, "policy"),
    edge(gatewayPolicy, gw, "policy"),
    edge(rt, filter, "filter"),
    edge(servicePolicy, b, "policy"),
  ];
  const placed = layoutFamilies(items, links).positions;
  const pos = (item: FamilyNode) => placed.get(item.id)!;
  it("puts route policies and filters above the route, in its column", () => {
    for (const item of [routePolicy, filter]) {
      expect(pos(item).x).toBe(pos(rt).x);
      expect(pos(item).y).toBeLessThan(pos(rt).y);
    }
    expect(pos(routePolicy).y).not.toBe(pos(filter).y);
  });
  it("keeps Services alone in their column and Gateway policies left of the Gateway", () => {
    const serviceColumn = [...placed]
      .filter(([, p]) => p.x === pos(a).x)
      .map(([id]) => id)
      .sort();
    expect(serviceColumn).toEqual([a.id, b.id].sort());
    expect(pos(gatewayPolicy).x).toBeLessThan(pos(gw).x);
  });
  it("keeps a Service policy just right of its Service, on its row", () => {
    expect(pos(servicePolicy).x).toBeGreaterThan(pos(b).x);
    expect(pos(servicePolicy).y).toBe(pos(b).y);
  });
  it("never overlaps cards", () => noOverlap([...placed.values()]));
});

// One namespace holds Gateways of three controllers, a configuration namespace
// hangs off one class, another namespace routes into a Gateway elsewhere, and
// two pools share an Endpoint Picker Service.
describe("placement near related cards", () => {
  const f5 = node("GatewayClass", "cluster-scoped", "f5");
  const istio = node("GatewayClass", "cluster-scoped", "istio");
  const nginx = node("GatewayClass", "cluster-scoped", "nginx");
  const edgeGw = node("Gateway", "edge", "web");
  const tcpGw = node("Gateway", "tcp", "tcp");
  const tcpRoute = node("L4Route", "tcp", "l4");
  const crossRoute = node("HTTPRoute", "tcp", "from-edge");
  const tcpSvc = node("Service", "tcp", "app");
  const bnkGw = node("Gateway", "ai", "bnk");
  const istioGw = node("Gateway", "ai", "mesh");
  const ngfGw = node("Gateway", "ai", "ngf");
  const routes = ["r1", "r2", "r3", "r4"].map((name) =>
    node("HTTPRoute", "ai", name),
  );
  const pools = ["p1", "p2", "p3", "p4"].map((name) =>
    node("InferencePool", "ai", name),
  );
  const eppShared = node("Service", "ai", "epp-shared");
  const eppOwn = ["e2", "e3"].map((name) => node("Service", "ai", name));
  const ngfConfig = node("NginxGateway", "nginx-gateway", "config");
  const ngfProxy = node("NginxProxy", "nginx-gateway", "proxy");
  const all = [
    f5,
    istio,
    nginx,
    edgeGw,
    tcpGw,
    tcpRoute,
    crossRoute,
    tcpSvc,
    bnkGw,
    istioGw,
    ngfGw,
    ...routes,
    ...pools,
    eppShared,
    ...eppOwn,
    ngfConfig,
    ngfProxy,
  ];
  const links = [
    edge(f5, edgeGw, "class"),
    edge(f5, tcpGw, "class"),
    edge(f5, bnkGw, "class"),
    edge(istio, istioGw, "class"),
    edge(nginx, ngfGw, "class"),
    edge(nginx, ngfConfig, "configuration"),
    edge(ngfConfig, ngfProxy, "configuration"),
    edge(tcpGw, tcpRoute, "parent"),
    edge(tcpRoute, tcpSvc, "backend"),
    edge(edgeGw, crossRoute, "parent"),
    edge(crossRoute, tcpSvc, "backend"),
    edge(bnkGw, routes[0], "parent"),
    edge(istioGw, routes[1], "parent"),
    edge(istioGw, routes[2], "parent"),
    edge(ngfGw, routes[3], "parent"),
    ...routes.map((item, index) => edge(item, pools[index], "backend")),
    edge(pools[0], eppShared, "endpoint-picker"),
    edge(pools[3], eppShared, "endpoint-picker"),
    edge(pools[1], eppOwn[0], "endpoint-picker"),
    edge(pools[2], eppOwn[1], "endpoint-picker"),
  ];
  const layout = layoutFamilies(all, links);
  const place = (item: FamilyNode) => layout.positions.get(item.id)!;
  it("places a class whose Gateways live in another band beside them, not in an empty band below", () => {
    for (const [tile, gateway] of [
      [istio, istioGw],
      [nginx, ngfGw],
    ] as const) {
      expect(place(tile).x).toBe(place(f5).x);
      expect(Math.abs(place(tile).y - place(gateway).y)).toBeLessThan(200);
    }
    expect(layout.frameKeys.get(istio.id)).toBe(`cluster-scoped:${istio.id}`);
  });
  it("lifts a class tile a little above its Gateways, so class lines run down into them", () => {
    for (const [tile, gateway] of [
      [istio, istioGw],
      [nginx, ngfGw],
    ] as const) {
      expect(place(tile).y).toBeLessThan(place(gateway).y);
      expect(place(gateway).y - place(tile).y).toBeLessThanOrEqual(62 + 42);
    }
  });
  it("keeps a class configuration namespace under its own tile", () => {
    expect(place(ngfConfig).x).toBe(place(nginx).x);
    expect(place(ngfConfig).y).toBeGreaterThan(place(nginx).y);
  });
  it("keeps class tiles from overlapping", () => {
    const ys = [f5, istio, nginx]
      .map((item) => place(item).y)
      .sort((a, b) => a - b);
    for (let index = 1; index < ys.length; index++)
      expect(ys[index] - ys[index - 1]).toBeGreaterThanOrEqual(62);
  });
  it("moves a shared Endpoint Picker Service between the pools that use it", () => {
    const [low, high] = [place(pools[0]).y, place(pools[3]).y].sort(
      (a, b) => a - b,
    );
    expect(place(eppShared).y).toBeGreaterThan(low);
    expect(place(eppShared).y).toBeLessThanOrEqual(high);
  });
  it("puts a row fed from another namespace above the namespace's own Gateway", () => {
    expect(place(crossRoute).y).toBeLessThan(place(tcpGw).y);
  });
  it("places every resource exactly once without overlapping cards", () => {
    expect(layout.positions.size).toBe(all.length);
    noOverlap(
      all.filter((item) => ![f5, istio, nginx].includes(item)).map(place),
    );
  });
});

// A route fed from a Gateway that is not in the snapshot heads the first row
// and reaches the Service the other routes share; another namespace's route
// hangs off the Gateway.
describe("broken references example", () => {
  const cls = node("GatewayClass", "cluster-scoped", "f5");
  const edgeGw = node("Gateway", "broken", "edge");
  const far = node("Gateway", "elsewhere", "gateway-in-another-cluster");
  const [
    crossNs,
    dupA,
    dupB,
    hostname,
    httpOnTcp,
    selectorTypo,
    wrongPort,
    wrongSection,
  ] = [
    "cross-namespace",
    "dup-a",
    "dup-b",
    "hostname-mismatch",
    "http-on-tcp",
    "selector-typo",
    "wrong-port",
    "wrong-section",
  ].map((name) => node("HTTPRoute", "broken", name));
  const noParent = node("HTTPRoute", "broken", "no-parent");
  const app = node("Service", "broken", "app");
  const v2 = node("Service", "broken", "app-v2");
  const typo = node("Service", "broken", "app-selector-typo");
  const catalog = node("Service", "shared", "catalog");
  const other = node("HTTPRoute", "team-x", "other-team");
  const teamApp = node("Service", "team-x", "team-x-app");
  const routes = [
    crossNs,
    dupA,
    dupB,
    hostname,
    httpOnTcp,
    selectorTypo,
    wrongPort,
    wrongSection,
  ];
  const all = [
    cls,
    edgeGw,
    far,
    ...routes,
    noParent,
    app,
    v2,
    typo,
    catalog,
    other,
    teamApp,
  ];
  const appParents = [
    noParent,
    dupA,
    dupB,
    hostname,
    httpOnTcp,
    wrongPort,
    wrongSection,
  ];
  const layout = layoutFamilies(all, [
    edge(cls, edgeGw, "class"),
    ...routes.map((item) => edge(edgeGw, item, "parent")),
    edge(edgeGw, other, "parent"),
    edge(far, noParent, "parent"),
    edge(other, teamApp, "backend"),
    edge(crossNs, catalog, "backend"),
    ...appParents.map((item) => edge(item, app, "backend")),
    edge(dupB, v2, "backend"),
    edge(selectorTypo, typo, "backend"),
  ]);
  const place = (item: FamilyNode) => layout.positions.get(item.id)!;
  it("places the shared Service right of every route that uses it, at their median", () => {
    expect(place(app).x).toBeGreaterThan(
      Math.max(...appParents.map((item) => place(item).x)),
    );
    expect(place(app).y).toBe(place(hostname).y);
  });
  it("keeps a route's own Service level with it", () => {
    expect(place(v2).y).toBe(place(dupB).y);
    expect(place(typo).y).toBe(place(selectorTypo).y);
  });
  it("places a classless namespace that feeds the band beside what it feeds", () => {
    expect(place(far).y).toBe(place(noParent).y);
    expect(place(far).x).toBeLessThan(place(noParent).x);
  });
  it("tucks a namespace under the Gateway namespace when a level link would cross its routes", () => {
    expect(place(other).y).toBeGreaterThan(
      Math.max(...routes.map((item) => place(item).y)),
    );
    expect(place(other).x).toBe(place(dupA).x);
  });
});

// Forge: BIG-IP Next relationships the Atlas suite does not cover.
describe("BIG-IP Next relationships", () => {
  const cls = node("GatewayClass", "cluster-scoped", "f5");
  const gw = node("Gateway", "shop", "edge-gw");
  const settings = node("GatewaySettings", "shop", "settings");
  const infra = node("Infra", "f5-utils", "infra");
  const egress = node("EgressGateway", "egress", "apps");
  const egressSettings = node("GatewaySettings", "egress", "egress-settings");
  const svc = node("Service", "shop", "svc");
  const grant = node("ReferenceGrant", "shop", "allow");
  const r = node("HTTPRoute", "store", "catalog");
  const items = [
    cls,
    gw,
    settings,
    infra,
    egress,
    egressSettings,
    svc,
    grant,
    r,
  ];
  const layout = layoutFamilies(items, [
    edge(cls, gw, "class"),
    edge(cls, egress, "class"),
    edge(gw, settings, "configuration"),
    edge(settings, infra, "configuration"),
    edge(egress, egressSettings, "configuration"),
    edge(egressSettings, infra, "configuration"),
    edge(gw, r, "parent"),
    edge(r, svc, "backend"),
    edge(grant, svc, "grant"),
  ]);
  const place = (item: FamilyNode) => layout.positions.get(item.id)!;
  it("heads its own row with an EgressGateway", () => {
    expect(place(egressSettings).y).toBe(place(egress).y);
  });
  it("keeps a ReferenceGrant out of the traffic path", () => {
    expect(place(grant).x).not.toBe(place(r).x);
  });
  it("places every resource without overlapping cards", () => {
    expect(layout.positions.size).toBe(items.length);
    noOverlap(items.filter((item) => item !== cls).map(place));
  });
});
