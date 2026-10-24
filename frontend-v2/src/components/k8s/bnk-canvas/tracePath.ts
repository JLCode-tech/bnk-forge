/**
 * Topology Canvas — end-to-end path for a selected card.
 *
 * Forge addition (not in Gateway Atlas). Atlas highlights a card's direct
 * neighbours; this follows the whole traffic chain instead.
 */

import { isHierarchyRelationship } from "./hierarchy";

// Edges in visual direction (class → Gateway → route → Service), as drawn.
export type PathEdge = {
  source: string;
  target: string;
  relationship?: unknown;
};

function walk(from: Iterable<string>, step: (id: string) => string[]) {
  const seen = new Set(from);
  const queue = [...seen];
  while (queue.length) {
    for (const next of step(queue.shift()!)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

// The traffic chain through a card: everything upstream and downstream of it
// along hierarchy relationships (class, parent, backend), then the support
// cards attached to that chain (policies, TLS, configuration) and what those
// configure in turn. Support links never lead into another family's chain, so
// a policy that also targets a second Gateway does not pull that Gateway in.
// Starting on a support card traces the chains it is attached to.
export function tracePath(startId: string, edges: PathEdge[]): Set<string> {
  const traffic = edges.filter((edge) =>
    isHierarchyRelationship(edge.relationship),
  );
  const support = edges.filter(
    (edge) => !isHierarchyRelationship(edge.relationship),
  );
  const inTraffic = new Set(traffic.flatMap((e) => [e.source, e.target]));

  const seeds = inTraffic.has(startId)
    ? [startId]
    : support.flatMap((edge) => {
        if (edge.source === startId && inTraffic.has(edge.target))
          return [edge.target];
        if (edge.target === startId && inTraffic.has(edge.source))
          return [edge.source];
        return [];
      });
  const downstream = walk(seeds, (id) =>
    traffic.filter((edge) => edge.source === id).map((edge) => edge.target),
  );
  const upstream = walk(seeds, (id) =>
    traffic.filter((edge) => edge.target === id).map((edge) => edge.source),
  );
  const chain = new Set([startId, ...downstream, ...upstream]);

  const outside = (id: string) => inTraffic.has(id) && !chain.has(id);
  const attached = new Set<string>();
  for (const edge of support) {
    if (chain.has(edge.source) && !outside(edge.target))
      attached.add(edge.target);
    if (chain.has(edge.target) && !outside(edge.source))
      attached.add(edge.source);
  }
  const configured = walk(attached, (id) =>
    support
      .filter((edge) => edge.source === id && !outside(edge.target))
      .map((edge) => edge.target),
  );
  return new Set([...chain, ...configured]);
}

// Direct neighbours only (Atlas's focus rule).
export function neighbours(startId: string, edges: PathEdge[]): Set<string> {
  const ids = new Set([startId]);
  for (const edge of edges) {
    if (edge.source === startId) ids.add(edge.target);
    if (edge.target === startId) ids.add(edge.source);
  }
  return ids;
}
