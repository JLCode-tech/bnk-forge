/**
 * Topology Canvas — the "Families" layout.
 *
 * Ported from Gateway Atlas (frontend/src/familiesLayout.ts), Apache-2.0,
 * Copyright 2026 Gateway Atlas contributors. Atlas's compact mode (Migration
 * Playground only) and its folded leaf columns are not ported.
 *
 * Each traffic anchor (Gateway, EgressGateway, or a Route with no in-namespace
 * parent) owns one row that reads left to right — its attached policies,
 * iRules and Secrets, then the anchor, then its in-namespace routes and
 * Services. Namespaces are grouped into one horizontal band per controller
 * (GatewayClass), and each band starts with its own cluster-scoped tile.
 * Deterministic; it never changes identities, relationships or findings.
 */

import { isHierarchyRelationship, tierFor } from "./hierarchy";
import { skylinePack } from "./packing";
import { labelClearance, labelColumnGap } from "./edgeLabels";

export type FamilyNode = {
  id: string;
  data: Record<string, unknown>;
  width?: number;
  height?: number;
};
export type FamilyEdge = {
  source: string;
  target: string;
  data?: Record<string, unknown>;
  label?: unknown;
};
export type FamilyLayout = {
  positions: Map<string, { x: number; y: number }>;
  frameKeys: Map<string, string>;
};
type Point = { x: number; y: number };

export const cardWidth = 190;
export const cardHeight = 62;
const baseColumnGap = 104;
const defaultRowPitch = cardHeight + 34;
const familyGap = 26;
const classLift = cardHeight;
// Wide fan-outs get more horizontal room so their curves spread instead of
// crowding a tall column.
export const fanOutGap = (children: number) =>
  Math.min(200, Math.max(0, children - 3) * 16);
export const framePad = { left: 24, top: 42, right: 24, bottom: 24 };
const namespaceGapX = 72;
const namespaceGapY = 40;
const bandGap = 96;
const namespaceOf = (node: FamilyNode) =>
  String(node.data.namespace ?? "unresolved");
const relationshipOf = (edge: FamilyEdge) => edge.data?.relationship;
// An Endpoint Picker belongs to its pool's family row instead of heading a row
// of its own because it has no traffic parent.
const inFamily = (relationship: unknown) =>
  isHierarchyRelationship(relationship) || relationship === "endpoint-picker";
const byName = (a: string, b: string) => a.localeCompare(b);
const labelOf = (edge: FamilyEdge) =>
  typeof edge.label === "string" ? edge.label : "";
const tierOrder = ["entry", "route", "service", "workload", "class"];

type Local = { positions: Map<string, Point>; width: number; height: number };

export function layoutNamespace(
  members: FamilyNode[],
  edges: FamilyEdge[],
): Local {
  const ids = new Set(members.map((node) => node.id));
  const kind = new Map(
    members.map((node) => [node.id, String(node.data.kind ?? "")]),
  );
  const inner = edges.filter(
    (edge) => ids.has(edge.source) && ids.has(edge.target),
  );
  // Rows stand far enough apart for the tallest (collapsed) edge label in this namespace.
  const rowPitch = Math.max(
    defaultRowPitch,
    labelClearance(inner.map(labelOf)),
  );
  const hierarchy = inner.filter((edge) => inFamily(relationshipOf(edge)));
  const support = inner.filter((edge) => !inFamily(relationshipOf(edge)));
  const isSupport = (id: string) => tierFor(kind.get(id)) === "support";
  const hasParent = new Set(hierarchy.map((edge) => edge.target));
  // Rows fed from another namespace (a route whose Gateway lives elsewhere)
  // come first, so the incoming link, which arrives from an upstream namespace
  // placed above or to the left, does not cross the other rows.
  const fedFromOutside = new Set(
    edges
      .filter(
        (edge) =>
          ids.has(edge.target) &&
          !ids.has(edge.source) &&
          inFamily(relationshipOf(edge)) &&
          relationshipOf(edge) !== "class",
      )
      .map((edge) => edge.target),
  );
  const anchors = members
    .filter(
      (node) =>
        !isSupport(node.id) &&
        !hasParent.has(node.id) &&
        (tierFor(node.data.kind) !== "workload" ||
          !hierarchy.some((edge) => edge.target === node.id)),
    )
    .map((node) => node.id)
    .sort(
      (a, b) =>
        Number(fedFromOutside.has(b)) - Number(fedFromOutside.has(a)) ||
        tierOrder.indexOf(tierFor(kind.get(a))) -
          tierOrder.indexOf(tierFor(kind.get(b))) ||
        byName(a, b),
    );
  // Support reachable from more than one anchor is shared and kept in a
  // separate block, never duplicated.
  const supportReach = new Map<string, Set<string>>();
  const supportDepth = new Map<string, Map<string, number>>();
  for (const anchor of anchors) {
    const depth = new Map<string, number>([[anchor, 0]]);
    const queue = [anchor];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of support) {
        // First hop may attach in either direction (policy → Gateway,
        // Secret → Gateway); beyond it only follow outgoing references, so a
        // shared iRule never pulls another Gateway's policy into this family.
        const other =
          edge.source === current
            ? edge.target
            : current === anchor && edge.target === current
              ? edge.source
              : "";
        if (!other || depth.has(other) || !isSupport(other)) continue;
        depth.set(other, depth.get(current)! + 1);
        queue.push(other);
      }
    }
    depth.delete(anchor);
    supportDepth.set(anchor, depth);
    for (const id of depth.keys())
      supportReach.set(id, new Set([...(supportReach.get(id) ?? []), anchor]));
  }
  const claimed = new Set<string>();
  const families = anchors.map((anchor) => {
    const chain = [...(supportDepth.get(anchor) ?? new Map<string, number>())]
      .filter(([id]) => supportReach.get(id)?.size === 1 && !claimed.has(id))
      .map(([id, depth]) => ({ id, depth }));
    const descendants: { id: string; depth: number }[] = [];
    const queue = [{ id: anchor, depth: 0 }];
    const seen = new Set([anchor]);
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of hierarchy
        .filter((item) => item.source === current.id)
        .sort((a, b) => byName(a.target, b.target))) {
        if (
          seen.has(edge.target) ||
          claimed.has(edge.target) ||
          anchors.includes(edge.target)
        )
          continue;
        seen.add(edge.target);
        descendants.push({ id: edge.target, depth: current.depth + 1 });
        queue.push({ id: edge.target, depth: current.depth + 1 });
      }
    }
    for (const item of [...chain, ...descendants]) claimed.add(item.id);
    claimed.add(anchor);
    return { anchor, chain, descendants };
  });
  let leftover = members
    .map((node) => node.id)
    .filter((id) => !claimed.has(id))
    .sort(byName);
  const descendantIDs = new Set(
    families.flatMap((family) => family.descendants.map((item) => item.id)),
  );
  const supportColumns = Math.max(
    0,
    ...families.flatMap((family) => family.chain.map((item) => item.depth)),
  );
  // Policy lane: a policy or filter attached only to routes downstream of one
  // anchor sits in a row reserved above its family, over the route's column,
  // instead of beside the Services where it reads like a backend.
  const lanes = families.map(() => new Map<number, string[]>());
  for (const id of [...leftover]) {
    const touching = support.filter(
      (edge) => edge.source === id || edge.target === id,
    );
    if (
      !touching.length ||
      !touching.every(
        (edge) =>
          relationshipOf(edge) === "policy" ||
          relationshipOf(edge) === "filter",
      )
    )
      continue;
    const users = touching.map((edge) =>
      edge.source === id ? edge.target : edge.source,
    );
    const index = families.findIndex((family) =>
      users.every((user) =>
        family.descendants.some((item) => item.id === user),
      ),
    );
    // Only route-level attachments: a policy on a Service keeps its place just
    // right of that Service.
    if (
      index < 0 ||
      !users.every((user) => tierFor(kind.get(user)) === "route")
    )
      continue;
    const column = Math.min(
      ...users.map(
        (user) =>
          supportColumns +
          families[index].descendants.find((item) => item.id === user)!.depth,
      ),
    );
    lanes[index].set(column, [...(lanes[index].get(column) ?? []), id]);
    leftover = leftover.filter((item) => item !== id);
  }
  const familyColumns = families.map((family) => {
    const columns = new Map<number, string[]>();
    const put = (column: number, id: string) =>
      columns.set(column, [...(columns.get(column) ?? []), id]);
    put(supportColumns, family.anchor);
    for (const item of [...family.chain].sort(
      (a, b) => a.depth - b.depth || byName(a.id, b.id),
    ))
      put(supportColumns - item.depth, item.id);
    for (const item of family.descendants)
      put(supportColumns + item.depth, item.id);
    return columns;
  });
  const widestFan = Math.max(
    0,
    ...familyColumns.flatMap((columns) =>
      [...columns]
        .filter(([column]) => column > supportColumns)
        .map(([, items]) => items.length),
    ),
  );
  const columnPitch =
    cardWidth +
    labelColumnGap(hierarchy.map(labelOf), baseColumnGap) +
    fanOutGap(widestFan);
  const positions = new Map<string, Point>();
  let top = 0;
  for (const [familyIndex, columns] of familyColumns.entries()) {
    const lane = lanes[familyIndex];
    const laneRows = Math.max(
      0,
      ...[...lane.values()].map((items) => items.length),
    );
    for (const [column, items] of lane)
      items.forEach((id, index) =>
        positions.set(id, {
          x: column * columnPitch,
          y: top + index * rowPitch,
        }),
      );
    top += laneRows * rowPitch;
    const rows = Math.max(
      ...[...columns.values()].map((items) => items.length),
    );
    // Centre every column on the block so a parent sits in the middle of its fan-out.
    for (const [column, items] of columns) {
      const offset = ((rows - items.length) * rowPitch) / 2;
      items.forEach((id, index) =>
        positions.set(id, {
          x: column * columnPitch,
          y: top + offset + index * rowPitch,
        }),
      );
    }
    top += rows * rowPitch + familyGap;
  }
  // A child that several rows reach (a Service shared by two routes) moves,
  // with the part of its subtree only it reaches, to the rows at the median of
  // its parents, into the nearest free slot of its column, instead of staying
  // in the first row that claimed it.
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const edge of hierarchy) {
    parentsOf.set(edge.target, [
      ...(parentsOf.get(edge.target) ?? []),
      edge.source,
    ]);
    childrenOf.set(edge.source, [
      ...(childrenOf.get(edge.source) ?? []),
      edge.target,
    ]);
  }
  const placedParents = (id: string) => [
    ...new Set(
      (parentsOf.get(id) ?? []).filter(
        (parent) => parent !== id && positions.has(parent),
      ),
    ),
  ];
  const subtreeOf = (id: string) => {
    const subtree = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of [...subtree])
        for (const child of childrenOf.get(node) ?? [])
          if (
            !subtree.has(child) &&
            positions.has(child) &&
            (parentsOf.get(child) ?? []).every((parent) => subtree.has(parent))
          ) {
            subtree.add(child);
            grew = true;
          }
    }
    return subtree;
  };
  const free = (subtree: Set<string>, dx: number, dy: number) => {
    const others = [...positions]
      .filter(([other]) => !subtree.has(other))
      .map(([, position]) => position);
    return [...subtree].every((node) => {
      const position = positions.get(node)!;
      return (
        position.y + dy >= 0 &&
        !others.some(
          (other) =>
            Math.abs(other.x - (position.x + dx)) < cardWidth &&
            Math.abs(other.y - (position.y + dy)) < rowPitch - 8,
        )
      );
    });
  };
  const shift = (subtree: Set<string>, dx: number, dy: number) => {
    for (const node of subtree) {
      const position = positions.get(node)!;
      positions.set(node, { x: position.x + dx, y: position.y + dy });
    }
  };
  // A card that is the only child its parent has to itself (a route's one
  // Service, beside a Service it shares with other routes) sits level with that
  // parent, so the line runs straight.
  for (const [id] of parentsOf) {
    const parents = placedParents(id);
    if (parents.length !== 1 || !positions.has(id)) continue;
    const parent = positions.get(parents[0])!;
    const at = positions.get(id)!;
    const own = (childrenOf.get(parents[0]) ?? []).filter(
      (child) => positions.has(child) && placedParents(child).length === 1,
    );
    if (own.length !== 1 || at.x <= parent.x || at.y === parent.y) continue;
    const subtree = subtreeOf(id);
    const dy = parent.y - at.y;
    if (free(subtree, 0, dy)) shift(subtree, 0, dy);
  }
  const shared = [...parentsOf]
    .filter(
      ([id, parents]) =>
        positions.has(id) &&
        new Set(
          parents.filter((parent) => parent !== id && positions.has(parent)),
        ).size > 1,
    )
    .map(([id]) => id)
    .sort((a, b) => positions.get(a)!.x - positions.get(b)!.x || byName(a, b));
  for (const id of shared) {
    const subtree = subtreeOf(id);
    const parents = placedParents(id)
      .filter((parent) => !subtree.has(parent))
      .map((parent) => positions.get(parent)!);
    const ys = parents.map((parent) => parent.y).sort((a, b) => a - b);
    const ideal =
      (ys[Math.floor((ys.length - 1) / 2)] +
        ys[Math.ceil((ys.length - 1) / 2)]) /
        2 -
      positions.get(id)!.y;
    // The first row to reach it may have put it in or before another parent's
    // column: move it one column right of its rightmost parent, so every line
    // runs forward into it.
    const rightmost = Math.max(...parents.map((parent) => parent.x));
    const dx =
      positions.get(id)!.x <= rightmost
        ? rightmost + columnPitch - positions.get(id)!.x
        : 0;
    if (!dx && Math.abs(ideal) < rowPitch / 2) continue;
    const delta = Array.from({ length: 40 }, (_, step) => [
      ideal + (step * rowPitch) / 2,
      ideal - (step * rowPitch) / 2,
    ])
      .flat()
      .find((dy) => free(subtree, dx, dy));
    if (
      delta !== undefined &&
      (dx || Math.abs(delta) < Math.abs(ideal) * 2 + rowPitch)
    )
      shift(subtree, dx, delta);
  }
  // Support used only by downstream resources sits just right of those
  // resources, centred on them, instead of in the loose slot where its links
  // cross the namespace.
  for (let pass = 0; pass < 3; pass++)
    for (const id of [...leftover]) {
      if (!isSupport(id)) continue;
      const users = support
        .filter((edge) => edge.source === id || edge.target === id)
        .map((edge) => (edge.source === id ? edge.target : edge.source));
      if (!users.length || !users.every((user) => descendantIDs.has(user)))
        continue;
      const placed = users
        .map((user) => positions.get(user))
        .filter((position): position is Point => position !== undefined);
      if (placed.length !== users.length) continue;
      const x = Math.max(...placed.map((position) => position.x)) + columnPitch;
      let y = Math.round(
        placed.reduce((sum, position) => sum + position.y, 0) / placed.length,
      );
      while (
        [...positions.values()].some(
          (position) =>
            Math.abs(position.x - x) < cardWidth &&
            Math.abs(position.y - y) < rowPitch - 8,
        )
      )
        y += rowPitch;
      positions.set(id, { x, y });
      descendantIDs.add(id);
      leftover = leftover.filter((item) => item !== id);
    }
  if (leftover.length) {
    const perRow = Math.max(1, supportColumns + 1);
    leftover.forEach((id, index) =>
      positions.set(id, {
        x: (index % perRow) * columnPitch,
        y: top + Math.floor(index / perRow) * rowPitch,
      }),
    );
    top += Math.ceil(leftover.length / perRow) * rowPitch + familyGap;
  }
  const width = Math.max(
    cardWidth,
    ...[...positions.values()].map((position) => position.x + cardWidth),
  );
  const height = Math.max(
    cardHeight,
    top - familyGap,
    ...[...positions.values()].map((position) => position.y + cardHeight),
  );
  return {
    positions,
    width: width + framePad.left + framePad.right,
    height: height + framePad.top + framePad.bottom,
  };
}

export function layoutFamilies(
  nodes: FamilyNode[],
  edges: FamilyEdge[],
): FamilyLayout {
  const namespaceFor = new Map(
    nodes.map((node) => [node.id, namespaceOf(node)]),
  );
  const nsOf = (id: string) => namespaceFor.get(id) ?? "";
  const classes = nodes
    .filter((node) => tierFor(node.data.kind) === "class")
    .map((node) => node.id)
    .sort(byName);
  const isClass = (id: string) => classes.includes(id);
  const groups = new Map<string, FamilyNode[]>();
  for (const node of nodes) {
    if (isClass(node.id)) continue;
    const namespace = namespaceOf(node);
    groups.set(namespace, [...(groups.get(namespace) ?? []), node]);
  }
  // Band = controller class. A namespace joins the class its entries select;
  // route namespaces inherit through cross-namespace parent links; namespaces
  // configured only by a class join that class.
  const bandVotes = new Map<string, Map<string, number>>();
  const vote = (namespace: string, band: string, weight = 1) => {
    const votes = bandVotes.get(namespace) ?? new Map<string, number>();
    votes.set(band, (votes.get(band) ?? 0) + weight);
    bandVotes.set(namespace, votes);
  };
  for (const edge of edges) {
    if (isClass(edge.source) && !isClass(edge.target))
      vote(
        nsOf(edge.target),
        edge.source,
        isHierarchyRelationship(relationshipOf(edge)) ? 2 : 1,
      );
    if (isClass(edge.target) && !isClass(edge.source))
      vote(nsOf(edge.source), edge.target, 1);
  }
  const bandOf = new Map<string, string>();
  const best = (namespace: string) =>
    [...(bandVotes.get(namespace) ?? new Map<string, number>())].sort(
      (a, b) => b[1] - a[1] || byName(a[0], b[0]),
    )[0]?.[0];
  for (const namespace of groups.keys()) {
    const band = best(namespace);
    if (band) bandOf.set(namespace, band);
  }
  const crossHierarchy = edges.filter(
    (edge) =>
      isHierarchyRelationship(relationshipOf(edge)) &&
      !isClass(edge.source) &&
      nsOf(edge.source) !== nsOf(edge.target),
  );
  for (let pass = 0; pass < groups.size; pass++)
    for (const edge of crossHierarchy) {
      const from = nsOf(edge.source);
      const to = nsOf(edge.target);
      if (bandOf.has(from) && !bandOf.has(to))
        bandOf.set(to, bandOf.get(from)!);
    }
  // A namespace with no class of its own that only feeds one band (an
  // unresolved Gateway placeholder in front of a route) joins that band in its
  // first column, beside what it feeds, instead of being packed below every band.
  const feeders = new Set<string>();
  for (const namespace of groups.keys()) {
    if (
      bandOf.has(namespace) ||
      crossHierarchy.some((edge) => nsOf(edge.target) === namespace)
    )
      continue;
    const fed = new Set(
      crossHierarchy
        .filter((edge) => nsOf(edge.source) === namespace)
        .map((edge) => bandOf.get(nsOf(edge.target)) ?? ""),
    );
    const band = fed.size === 1 ? [...fed][0] : "";
    if (band) {
      bandOf.set(namespace, band);
      feeders.add(namespace);
    }
  }
  const isConfigurationOnly = (namespace: string) =>
    !edges.some(
      (edge) =>
        isHierarchyRelationship(relationshipOf(edge)) &&
        ((isClass(edge.source) && nsOf(edge.target) === namespace) ||
          (nsOf(edge.source) === namespace &&
            nsOf(edge.target) !== namespace) ||
          (nsOf(edge.target) === namespace && nsOf(edge.source) !== namespace)),
    );
  // A namespace linked to the rest only by references, all into one namespace
  // that carries traffic (the namespace whose Infra a GatewaySettings elsewhere
  // uses), is a feeder too: it sits beside the cards that use it.
  const supportCross = edges.filter(
    (edge) =>
      !isHierarchyRelationship(relationshipOf(edge)) &&
      !isClass(edge.source) &&
      !isClass(edge.target) &&
      nsOf(edge.source) !== nsOf(edge.target),
  );
  for (const namespace of groups.keys()) {
    if (
      bandOf.has(namespace) ||
      feeders.has(namespace) ||
      !isConfigurationOnly(namespace)
    )
      continue;
    const others = new Set(
      supportCross
        .filter(
          (edge) =>
            nsOf(edge.source) === namespace || nsOf(edge.target) === namespace,
        )
        .map((edge) =>
          nsOf(edge.source) === namespace
            ? nsOf(edge.target)
            : nsOf(edge.source),
        ),
    );
    const other = others.size === 1 ? [...others][0] : "";
    if (!other || isConfigurationOnly(other)) continue;
    if (bandOf.has(other)) bandOf.set(namespace, bandOf.get(other)!);
    feeders.add(namespace);
  }
  // A class whose Gateways all live in namespaces of another band joins that
  // band as a guest, with its configuration-only namespaces, instead of forming
  // an empty band of its own far below its Gateways.
  const tileOf = new Map<string, string>();
  const hostOf = new Map<string, string>();
  for (const namespace of groups.keys())
    if (isConfigurationOnly(namespace) && bandOf.has(namespace))
      tileOf.set(namespace, bandOf.get(namespace)!);
  for (const id of classes) {
    const own = [...groups.keys()].filter(
      (namespace) => bandOf.get(namespace) === id,
    );
    if (own.some((namespace) => !isConfigurationOnly(namespace))) continue;
    const hosts = new Map<string, number>();
    for (const edge of edges)
      if (
        edge.source === id &&
        isHierarchyRelationship(relationshipOf(edge)) &&
        !isClass(edge.target)
      ) {
        const host = bandOf.get(nsOf(edge.target));
        if (host && host !== id) hosts.set(host, (hosts.get(host) ?? 0) + 1);
      }
    const host = [...hosts].sort(
      (a, b) => b[1] - a[1] || byName(a[0], b[0]),
    )[0]?.[0];
    if (!host || hostOf.has(host)) continue;
    hostOf.set(id, host);
    for (const namespace of own) bandOf.set(namespace, host);
  }
  const locals = new Map(
    [...groups].map(([namespace, members]) => [
      namespace,
      layoutNamespace(members, edges),
    ]),
  );
  const local = (namespace: string) => locals.get(namespace)!;
  const bands = [
    ...new Set([
      ...classes.filter(
        (id) =>
          !hostOf.has(id) &&
          ([...bandOf.values()].includes(id) ||
            edges.some((edge) => edge.source === id || edge.target === id)),
      ),
      ...([...groups.keys()].some((namespace) => !bandOf.has(namespace))
        ? [""]
        : []),
    ]),
  ];
  const bandSize = (band: string) =>
    [...groups.keys()]
      .filter((namespace) => (bandOf.get(namespace) ?? "") === band)
      .reduce(
        (sum, namespace) => sum + (groups.get(namespace)?.length ?? 0),
        0,
      );
  bands.sort(
    (a, b) =>
      Number(a === "") - Number(b === "") ||
      bandSize(b) - bandSize(a) ||
      byName(a, b),
  );
  for (const id of classes)
    if (!bands.includes(id) && !hostOf.has(id)) bands.push(id);
  const positions = new Map<string, Point>();
  const frameKeys = new Map<string, string>();
  let bandTop = 0;
  for (const band of bands) {
    const members = [...groups.keys()]
      .filter((namespace) => (bandOf.get(namespace) ?? "") === band)
      .sort(byName);
    // Column per namespace: 0 = configuration-only (infrastructure) namespaces
    // under the class tile, then by cross-namespace hierarchy depth starting at
    // the namespaces whose entries select the class.
    const depth = new Map<string, number>();
    const configurationOnly = members.filter(isConfigurationOnly);
    const selectsClass = (namespace: string) =>
      edges.some(
        (edge) => edge.source === band && nsOf(edge.target) === namespace,
      );
    for (const namespace of members)
      if (feeders.has(namespace)) depth.set(namespace, 0);
    for (const namespace of members)
      if (
        !feeders.has(namespace) &&
        !configurationOnly.includes(namespace) &&
        (selectsClass(namespace) ||
          !crossHierarchy.some(
            (edge) =>
              nsOf(edge.target) === namespace &&
              members.includes(nsOf(edge.source)),
          ))
      )
        depth.set(namespace, 1);
    for (let pass = 0; pass < members.length; pass++)
      for (const edge of crossHierarchy) {
        const from = nsOf(edge.source);
        const to = nsOf(edge.target);
        if (
          depth.has(from) &&
          members.includes(to) &&
          !configurationOnly.includes(to) &&
          !selectsClass(to) &&
          (depth.get(to) ?? 0) < depth.get(from)! + 1 &&
          depth.get(from)! + 1 <= members.length
        )
          depth.set(to, depth.get(from)! + 1);
      }
    for (const namespace of members)
      if (!depth.has(namespace))
        depth.set(namespace, configurationOnly.includes(namespace) ? 0 : 1);
    const linked = crossHierarchy.some(
      (edge) =>
        members.includes(nsOf(edge.source)) &&
        members.includes(nsOf(edge.target)),
    );
    if (!band && !linked) {
      // Independent namespaces have no reading order to preserve: pack them.
      const boxes = members
        .map((namespace) => ({
          id: namespace,
          width: local(namespace).width,
          height: local(namespace).height,
        }))
        .sort((a, b) => b.height - a.height || byName(a.id, b.id));
      const area = boxes.reduce((sum, box) => sum + box.width * box.height, 0);
      const placed = skylinePack(
        boxes,
        Math.max(1200, ...boxes.map((box) => box.width), Math.sqrt(area * 1.6)),
        namespaceGapX,
      );
      let bottom = bandTop;
      for (const box of boxes) {
        const at = placed.get(box.id)!;
        for (const [id, position] of local(box.id).positions)
          positions.set(id, {
            x: at.x + framePad.left + position.x,
            y: bandTop + at.y + framePad.top + position.y,
          });
        bottom = Math.max(bottom, bandTop + at.y + box.height);
      }
      bandTop = bottom + bandGap;
      continue;
    }
    // A leaf namespace reached only from one upstream card that has cards of
    // its own namespace to its right, in its row (a Gateway with its own
    // routes), would be aligned beside that row and linked by a line running
    // through those cards. Tuck it under the upstream namespace instead, its
    // first card in the column right of the upstream card. Those whose linked
    // card is their leftmost come first, and at most one whose frame reaches
    // left of that card, last, so no link crosses another frame.
    const candidates: {
      namespace: string;
      under: string;
      dx: number;
      spill: boolean;
    }[] = [];
    for (const namespace of members) {
      const incoming = crossHierarchy.filter(
        (edge) =>
          nsOf(edge.target) === namespace &&
          members.includes(nsOf(edge.source)),
      );
      const sources = new Set(incoming.map((edge) => edge.source));
      const under = nsOf(incoming[0]?.source ?? "");
      if (
        sources.size !== 1 ||
        !under ||
        depth.get(namespace) !== depth.get(under)! + 1 ||
        crossHierarchy.some(
          (edge) =>
            nsOf(edge.source) === namespace && nsOf(edge.target) !== namespace,
        )
      )
        continue;
      const upstream = local(under).positions;
      const from = upstream.get(incoming[0].source);
      const to = local(namespace).positions.get(incoming[0].target);
      if (!from || !to) continue;
      const right = [...upstream.values()].filter(
        (position) => position.x > from.x,
      );
      if (!right.some((position) => Math.abs(position.y - from.y) < cardHeight))
        continue;
      const leftmost = Math.min(
        ...[...local(namespace).positions.values()].map(
          (position) => position.x,
        ),
      );
      candidates.push({
        namespace,
        under,
        dx: Math.max(
          0,
          Math.min(...right.map((position) => position.x)) - to.x,
        ),
        spill: to.x > leftmost,
      });
    }
    const tucked = new Map<string, { under: string; dx: number }>();
    for (const under of new Set(candidates.map((item) => item.under))) {
      if (candidates.some((item) => item.namespace === under)) continue;
      const hanging = candidates
        .filter((item) => item.under === under)
        .sort(
          (a, b) =>
            Number(a.spill) - Number(b.spill) ||
            byName(a.namespace, b.namespace),
        );
      const firstSpill = hanging.findIndex((other) => other.spill);
      for (const item of hanging.filter(
        (entry, index) => !entry.spill || index === firstSpill,
      )) {
        tucked.set(item.namespace, { under, dx: item.dx });
        depth.set(item.namespace, depth.get(under)!);
      }
    }
    const columnX = new Map<number, number>();
    const maxDepth = Math.max(1, ...depth.values());
    let x = 0;
    const tileWidth = band ? cardWidth + framePad.left + framePad.right : 0;
    const columnMembers = (column: number) =>
      members.filter((namespace) => depth.get(namespace) === column);
    const subWidth = (column: number) =>
      Math.max(
        0,
        ...columnMembers(column).map(
          (namespace) =>
            (tucked.get(namespace)?.dx ?? 0) + local(namespace).width,
        ),
      );
    const columnWidth = (column: number) =>
      Math.max(column === 0 ? tileWidth : 0, subWidth(column));
    for (let column = 0; column <= maxDepth; column++) {
      columnX.set(column, x);
      const width = columnWidth(column);
      if (width) x += width + namespaceGapX;
    }
    const placedTop = new Map<string, number>();
    let bandBottom = bandTop;
    // Column 0 (class tiles, configuration namespaces and feeders) is placed
    // last, beside what it links to.
    for (let column = 1; column <= maxDepth; column++) {
      let cursor = bandTop;
      const inColumn = members
        .filter((namespace) => depth.get(namespace) === column)
        .map((namespace) => {
          // Align a downstream namespace with the rows of the upstream
          // resources that reference it.
          const parents = crossHierarchy
            .filter(
              (edge) =>
                nsOf(edge.target) === namespace &&
                placedTop.has(nsOf(edge.source)),
            )
            .map((edge) => {
              const source = nsOf(edge.source);
              return (
                placedTop.get(source)! +
                (local(source).positions.get(edge.source)?.y ?? 0) -
                (local(namespace).positions.get(edge.target)?.y ?? 0)
              );
            });
          return {
            namespace,
            desired: parents.length ? Math.min(...parents) : -Infinity,
          };
        })
        .sort(
          (a, b) => a.desired - b.desired || byName(a.namespace, b.namespace),
        );
      // Namespaces in the same column that route to each other sit next to
      // each other, so the link between them stays short.
      const linkedTo = (a: string, b: string) =>
        crossHierarchy.some((edge) => {
          const from = nsOf(edge.source);
          const to = nsOf(edge.target);
          return (from === a && to === b) || (from === b && to === a);
        });
      for (let index = 1; index < inColumn.length; index++) {
        const previous = inColumn[index - 1].namespace;
        const partner = inColumn.findIndex(
          (item, position) =>
            position > index &&
            item.desired === -Infinity &&
            linkedTo(previous, item.namespace),
        );
        if (partner > index && !linkedTo(previous, inColumn[index].namespace)) {
          const [moved] = inColumn.splice(partner, 1);
          inColumn.splice(index, 0, moved);
        }
      }
      // A tucked namespace follows the namespace it hangs from.
      for (const [namespace, { under }] of tucked) {
        const at = inColumn.findIndex((item) => item.namespace === namespace);
        if (at < 0 || !inColumn.some((item) => item.namespace === under))
          continue;
        const [moved] = inColumn.splice(at, 1);
        let after = inColumn.findIndex((item) => item.namespace === under);
        while (
          after + 1 < inColumn.length &&
          tucked.get(inColumn[after + 1].namespace)?.under === under
        )
          after++;
        inColumn.splice(after + 1, 0, { ...moved, desired: -Infinity });
      }
      for (const item of inColumn) {
        const frame = local(item.namespace);
        const top = Math.max(cursor, item.desired);
        const dx = tucked.get(item.namespace)?.dx ?? 0;
        placedTop.set(item.namespace, top);
        for (const [id, position] of frame.positions)
          positions.set(id, {
            x: columnX.get(column)! + framePad.left + dx + position.x,
            y: top + framePad.top + position.y,
          });
        cursor = top + frame.height + namespaceGapY;
        bandBottom = Math.max(bandBottom, top + frame.height);
      }
      bandBottom = Math.max(bandBottom, cursor - namespaceGapY);
    }
    // Column 0: each class tile of the band (its own and its guests), with the
    // configuration-only namespaces it configures stacked below it, sits one
    // card above the median of its Gateways, so its class lines run down into
    // them; tiles keep their order and never overlap.
    const tiles = (
      band ? [band, ...classes.filter((id) => hostOf.get(id) === band)] : []
    ).map((tile) => {
      const configured = members.filter(
        (namespace) =>
          depth.get(namespace) === 0 &&
          !feeders.has(namespace) &&
          (tileOf.get(namespace) ?? band) === tile,
      );
      const gateways = edges
        .filter(
          (edge) =>
            edge.source === tile &&
            positions.has(edge.target) &&
            !isClass(edge.target),
        )
        .map((edge) => positions.get(edge.target)!.y)
        .sort((a, b) => a - b);
      const median =
        (gateways[Math.floor((gateways.length - 1) / 2)] +
          gateways[Math.ceil((gateways.length - 1) / 2)]) /
        2;
      return {
        tile,
        namespace: "",
        configured,
        desired: gateways.length ? median - classLift - framePad.top : bandTop,
      };
    });
    // Feeders sit level with the first card they link to, right-aligned in the
    // column so their links stay short.
    const fed = members
      .filter((namespace) => feeders.has(namespace))
      .map((namespace) => {
        const rows = [...crossHierarchy, ...supportCross].flatMap((edge) => {
          const [own, other] =
            nsOf(edge.source) === namespace
              ? [edge.source, edge.target]
              : nsOf(edge.target) === namespace
                ? [edge.target, edge.source]
                : ["", ""];
          return own && positions.has(other) && nsOf(other) !== namespace
            ? [
                positions.get(other)!.y -
                  framePad.top -
                  (local(namespace).positions.get(own)?.y ?? 0),
              ]
            : [];
        });
        return {
          namespace,
          desired: rows.length ? Math.min(...rows) : Infinity,
        };
      });
    // Unbanded namespaces with no links stack below.
    const rest = band
      ? []
      : members
          .filter(
            (namespace) =>
              depth.get(namespace) === 0 && !feeders.has(namespace),
          )
          .map((namespace) => ({ namespace, desired: Infinity }));
    const items = [
      ...tiles,
      ...[...fed, ...rest].map((item) => ({
        ...item,
        tile: "",
        configured: [] as string[],
      })),
    ].sort(
      (a, b) =>
        a.desired - b.desired ||
        byName(a.tile || a.namespace, b.tile || b.namespace),
    );
    const place = (namespace: string, top: number) => {
      const frame = local(namespace);
      const dx = feeders.has(namespace) ? columnWidth(0) - frame.width : 0;
      placedTop.set(namespace, top);
      for (const [id, position] of frame.positions)
        positions.set(id, {
          x: columnX.get(0)! + framePad.left + dx + position.x,
          y: top + framePad.top + position.y,
        });
      return top + frame.height + namespaceGapY;
    };
    let cursor = bandTop;
    for (const { tile, namespace, configured, desired } of items) {
      const top = Math.max(cursor, Number.isFinite(desired) ? desired : cursor);
      let next = top;
      if (tile) {
        positions.set(tile, {
          x: columnX.get(0)! + framePad.left,
          y: top + framePad.top,
        });
        frameKeys.set(tile, `cluster-scoped:${tile}`);
        next =
          top + cardHeight + framePad.top + framePad.bottom + namespaceGapY;
      } else next = place(namespace, top);
      for (const configuredNamespace of configured)
        next = place(configuredNamespace, next);
      cursor = next;
      bandBottom = Math.max(bandBottom, next - namespaceGapY);
    }
    bandTop = bandBottom + bandGap;
  }
  return { positions, frameKeys };
}
