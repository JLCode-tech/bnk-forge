/**
 * Ported from Gateway Atlas (frontend/src/topologyHierarchy.test.ts,
 * layoutPacking.test.ts, edgeLabelPlacement.test.ts and the relationship cases
 * of edgePresentation.test.ts), Apache-2.0, Copyright 2026 Gateway Atlas
 * contributors. Tier cases for Ingress and NGINX kinds are not ported.
 */
import { describe, expect, it } from "vitest";
import {
  isHierarchyRelationship,
  placementFor,
  relationshipPlacement,
  startsTrafficHierarchy,
  tierFor,
} from "../hierarchy";
import { skylinePack, type PackBox } from "../packing";
import {
  collapseLabel,
  estimateLabelSize,
  labelClearance,
  labelColumnGap,
  placeEdgeLabel,
} from "../edgeLabels";
import {
  isInformativeLabel,
  relationshipStroke,
  visualDirection,
} from "../edgeStyles";

describe("topology hierarchy model", () => {
  it.each([
    "class",
    "parent",
    "route",
    "backend",
    "endpoints",
    "selector",
    "workload",
  ])("%s advances left to right", (relationship) =>
    expect(isHierarchyRelationship(relationship)).toBe(true),
  );
  it.each([
    ["policy", "target", -1],
    ["policy-source", "target", -1],
    ["tls", "target", -1],
    ["configuration", "source", 1],
    ["logging", "source", 2],
    ["endpoint-picker", "source", 1],
    ["grant", "target", 1],
    ["network", "source", 1],
  ] as const)(
    "%s stays beside its anchor in vertical lane %s",
    (relationship, anchor, lane) =>
      expect(placementFor(relationship)).toEqual({
        mode: "peer",
        anchor,
        lane,
      }),
  );
  it("treats an unknown relationship as traffic hierarchy until it is classified", () => {
    expect(placementFor("future-relationship")).toEqual({ mode: "hierarchy" });
    expect(Object.keys(relationshipPlacement)).toContain("authentication");
  });
  it.each([
    ["Gateway", "entry"],
    ["EgressGateway", "entry"],
    ["HTTPRoute", "route"],
    ["L4Route", "route"],
    ["Service", "service"],
    ["InferencePool", "service"],
    ["Pod", "workload"],
    ["NetPolicy", "support"],
  ] as const)("places %s in the %s resource tier", (kind, tier) =>
    expect(tierFor(kind)).toBe(tier),
  );
  it.each(["GatewayClass", "Gateway"])(
    "allows %s to start a traffic hierarchy",
    (kind) => expect(startsTrafficHierarchy(kind)).toBe(true),
  );
});

const overlap = (
  boxes: PackBox[],
  placed: Map<string, { x: number; y: number }>,
) =>
  boxes.some((a, i) =>
    boxes.slice(i + 1).some((b) => {
      const p = placed.get(a.id)!;
      const q = placed.get(b.id)!;
      return (
        p.x < q.x + b.width &&
        q.x < p.x + a.width &&
        p.y < q.y + b.height &&
        q.y < p.y + a.height
      );
    }),
  );

describe("skylinePack", () => {
  it.each([
    [
      "places the first box top-left",
      [{ id: "a", width: 100, height: 100 }],
      1000,
      { a: { x: 0, y: 0 } },
    ],
    [
      "fills a row left to right",
      [
        { id: "a", width: 300, height: 400 },
        { id: "b", width: 300, height: 200 },
        { id: "c", width: 300, height: 100 },
      ],
      1000,
      { a: { x: 0, y: 0 }, b: { x: 348, y: 0 }, c: { x: 696, y: 0 } },
    ],
    [
      "tucks a box under a shorter neighbour instead of starting a new shelf",
      [
        { id: "tall", width: 500, height: 800 },
        { id: "short", width: 400, height: 200 },
        { id: "next", width: 400, height: 200 },
      ],
      1000,
      {
        tall: { x: 0, y: 0 },
        short: { x: 548, y: 0 },
        next: { x: 548, y: 248 },
      },
    ],
    [
      "wraps when a box cannot fit beside the others",
      [
        { id: "a", width: 700, height: 100 },
        { id: "b", width: 700, height: 100 },
      ],
      1000,
      { a: { x: 0, y: 0 }, b: { x: 0, y: 148 } },
    ],
    [
      "widens to the widest box rather than overflowing",
      [
        { id: "wide", width: 1500, height: 100 },
        { id: "small", width: 100, height: 100 },
      ],
      1000,
      { wide: { x: 0, y: 0 }, small: { x: 0, y: 148 } },
    ],
  ])("%s", (_, boxes, target, expected) => {
    const placed = skylinePack(boxes, target, 48);
    expect(Object.fromEntries(placed)).toEqual(expected);
    expect(overlap(boxes, placed)).toBe(false);
  });
  it("never overlaps across a mixed deterministic set", () => {
    const boxes = Array.from({ length: 24 }, (_, index) => ({
      id: `ns-${index}`,
      width: 180 + ((index * 137) % 420),
      height: 120 + ((index * 251) % 700),
    })).sort((a, b) => b.height - a.height);
    const first = skylinePack(boxes, 1800, 48);
    const second = skylinePack(boxes, 1800, 48);
    expect(overlap(boxes, first)).toBe(false);
    expect(Object.fromEntries(first)).toEqual(Object.fromEntries(second));
    expect(
      Math.max(...boxes.map((box) => first.get(box.id)!.x + box.width)),
    ).toBeLessThanOrEqual(1800);
  });
});

// A straight horizontal cubic from (0,0) to (400,0); t maps linearly to x.
const path = "M0,0 C133.33,0 266.67,0 400,0";
const size = { width: 40, height: 16 };

describe("placeEdgeLabel", () => {
  it.each([
    ["keeps the midpoint when nothing is in the way", [], { x: 200, y: 0 }],
    [
      "keeps the midpoint when obstacles are clear of it",
      [{ x: 0, y: 100, width: 400, height: 20 }],
      { x: 200, y: 0 },
    ],
    [
      "slides toward the source past a card on the midpoint",
      [{ x: 170, y: -20, width: 60, height: 40 }],
      { x: 136, y: 0 },
    ],
    [
      "tries the other side when the near side is blocked",
      [{ x: 120, y: -20, width: 110, height: 40 }],
      { x: 264, y: 0 },
    ],
    [
      "keeps the midpoint when every candidate is equally covered",
      [{ x: -1000, y: -1000, width: 3000, height: 3000 }],
      { x: 200, y: 0 },
    ],
  ])("%s", (_, obstacles, expected) => {
    const point = placeEdgeLabel(path, { x: 200, y: 0 }, size, obstacles);
    expect(point.x).toBeCloseTo(expected.x, 0);
    expect(point.y).toBeCloseTo(expected.y, 0);
  });
  it("treats earlier labels as obstacles so a fan of labels does not stack", () => {
    const first = placeEdgeLabel(path, { x: 200, y: 0 }, size, []);
    const second = placeEdgeLabel(path, { x: 200, y: 0 }, size, [
      { x: first.x - 20, y: first.y - 8, width: 40, height: 16 },
    ]);
    expect(Math.abs(second.x - first.x)).toBeGreaterThanOrEqual(43);
  });
  it("falls back to the spot covering the least card area, not the midpoint", () => {
    const short = "M0,0 C100,0 100,0 200,0";
    const point = placeEdgeLabel(
      short,
      { x: 100, y: 0 },
      { width: 60, height: 14 },
      [
        { x: 40, y: -20, width: 120, height: 40 },
        { x: 0, y: -3, width: 40, height: 6 },
        { x: 160, y: -20, width: 40, height: 40 },
      ],
    );
    expect(point.x).not.toBe(100);
  });
});

describe("estimateLabelSize", () => {
  it.each([
    [["/"], { width: 18.1, height: 16.5 }],
    [
      ["/a-very-long-path-that-would-overflow-the-label-limit/*"],
      { width: 170, height: 16.5 },
    ],
    [["/one", "/two"], { width: 38.4, height: 37 }],
  ])("%j", (lines, expected) => {
    const result = estimateLabelSize(lines);
    expect(result.width).toBeCloseTo(expected.width, 1);
    expect(result.height).toBeCloseTo(expected.height, 1);
  });
});

describe("long labels", () => {
  const paths = (n: number) =>
    Array.from({ length: n }, (_, i) => `/api/v1/path-${i}`);
  it.each([
    ["short list unchanged", 3, false, 3, undefined],
    ["twelve lines unchanged", 12, false, 12, undefined],
    [
      "long list collapses when unfocused",
      20,
      false,
      12,
      "+9 more · select to show all",
    ],
    ["long list stays complete when focused", 20, true, 20, undefined],
  ] as const)("%s", (_, count, focused, lines, last) => {
    const shown = collapseLabel(paths(count), focused);
    expect(shown).toHaveLength(lines);
    if (last) expect(shown.at(-1)).toBe(last);
  });
  it("reserves room for the tallest collapsed label only", () => {
    expect(labelClearance(["", undefined])).toBe(0);
    const ten = labelClearance([paths(10).join("\n")]);
    const fifty = labelClearance([paths(50).join("\n")]);
    expect(ten).toBeGreaterThan(150);
    expect(fifty).toBe(labelClearance([paths(12).join("\n")]));
  });
  it.each([
    ["no labels keeps the minimum", [undefined, ""], 104, 104],
    ["a short label keeps the minimum", ["/v1"], 104, 104],
    [
      "a long label widens the gap",
      ["/v1 · X-Gateway-Model-Name: Qwen/Qwen3-0.6B"],
      104,
      198,
    ],
  ])("%s", (_, labels, minimum, expected) =>
    expect(labelColumnGap(labels, minimum)).toBe(expected),
  );
});

describe("relationship semantics", () => {
  it.each([
    ["class", "traffic", undefined],
    ["parent", "traffic", undefined],
    ["backend", "traffic", undefined],
    ["selector", "workload", undefined],
    ["configuration", "configuration", "7 4"],
    ["policy-source", "configuration", "7 4"],
    ["grant", "configuration", "2 3"],
    ["policy", "policy", "1.5 4"],
    ["filter", "policy", "1.5 4"],
    ["authentication", "policy", "1.5 4"],
    ["tls", "tls", "9 3 2 3"],
    ["logging", "logging", "1.5 4"],
    ["mirror", "traffic", "6 5"],
    ["network", "workload", "10 3 2 3"],
    ["unknown-future-type", "traffic", undefined],
  ])("%s is drawn as %s", (type, family, dash) => {
    const stroke = relationshipStroke(type);
    expect(stroke.family).toBe(family);
    expect(stroke.dash).toBe(dash);
  });
  it("gives every family a distinguishable line pattern except traffic and workload, which differ by width", () => {
    expect(
      new Set(
        ["configuration", "policy", "tls"].map(
          (type) => relationshipStroke(type).dash,
        ),
      ).size,
    ).toBe(3);
    expect(relationshipStroke("backend").width).toBeGreaterThan(
      relationshipStroke("selector").width,
    );
  });
  it.each([
    ["class", "class", false],
    ["policy", "policy", false],
    ["/", "backend", false],
    ["all", "backend", false],
    ["", "backend", false],
    ["/coffee", "backend", true],
    ["http-listener", "parent", true],
    ["parent", "backend", true],
  ] as const)(
    "label %j on a %s edge is informative: %s",
    (label, type, expected) =>
      expect(isInformativeLabel(label, type)).toBe(expected),
  );
  it.each([
    ["parent", ["gw", "route"]],
    ["class", ["gw", "route"]],
    ["tls", ["gw", "route"]],
    ["backend", ["route", "gw"]],
    ["policy", ["route", "gw"]],
  ])("draws %s edges in traffic direction", (type, expected) =>
    expect(visualDirection(type, "route", "gw")).toEqual(expected),
  );
});
