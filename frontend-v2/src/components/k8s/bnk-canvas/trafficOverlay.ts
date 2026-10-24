/**
 * Topology Canvas — TMM traffic counters on cards and listener edges.
 *
 * Forge addition (not in Gateway Atlas). The counters are the `trafficStats`
 * envelope Forge already returns from GET /f5bnk/data; the Canvas makes no
 * extra cluster calls for them.
 */

import type { BnkCanvasResource, BnkTrafficStatsResponse } from "@/types";

export type TrafficOverlay = {
  // Card id → one-line traffic fact shown in place of the card's first fact.
  cards: Map<string, string>;
  // `${gatewayId}|${listenerName}` → suffix for that listener's route edges.
  listeners: Map<string, string>;
};

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const formatCount = (value: number) => compact.format(value);

const GATEWAY_GROUP = "gateway.networking.k8s.io";
const EGRESS_KINDS = ["EgressGateway", "F5SPKEgress"];
const FIREWALL_KINDS = ["F5BigFwPolicy"];
const plural = (count: number, word: string) =>
  `${formatCount(count)} ${word}${count === 1 ? "" : "s"}`;

export function trafficOverlay(
  resources: BnkCanvasResource[],
  stats: BnkTrafficStatsResponse | undefined,
): TrafficOverlay | undefined {
  if (!stats?.available) return undefined;
  const find = (
    match: (resource: BnkCanvasResource) => boolean,
    namespace: string,
    name: string,
  ) =>
    resources.find(
      (resource) =>
        !resource.placeholder &&
        resource.namespace === namespace &&
        resource.name === name &&
        match(resource),
    );
  const cards = new Map<string, string>();
  const listeners = new Map<string, string>();

  const gateways = new Map<string, { open: number; total: number }>();
  for (const listener of stats.listeners ?? []) {
    const gateway = find(
      (r) => r.group === GATEWAY_GROUP && r.kind === "Gateway",
      listener.gatewayNamespace,
      listener.gatewayName,
    );
    if (!gateway) continue;
    const sum = gateways.get(gateway.id) ?? { open: 0, total: 0 };
    sum.open += listener.clientsideCurConns || 0;
    sum.total += listener.clientsideTotConns || 0;
    gateways.set(gateway.id, sum);
    listeners.set(
      `${gateway.id}|${listener.listenerName}`,
      plural(listener.clientsideTotConns || 0, "conn"),
    );
  }
  for (const [id, { open, total }] of gateways)
    cards.set(id, `${formatCount(open)} open · ${plural(total, "conn")}`);

  for (const egress of stats.egresses ?? []) {
    const resource = find(
      (r) => EGRESS_KINDS.includes(r.kind),
      egress.namespace,
      egress.egressName,
    );
    if (!resource) continue;
    cards.set(
      resource.id,
      `${formatCount(egress.clientsideCurConns || 0)} open · ${plural(egress.clientsideTotConns || 0, "conn")}`,
    );
  }

  const policies = new Map<string, { hits: number; rules: number }>();
  for (const rule of stats.firewallRules ?? []) {
    const resource = find(
      (r) => FIREWALL_KINDS.includes(r.kind),
      rule.namespace,
      rule.policyName,
    );
    if (!resource) continue;
    const sum = policies.get(resource.id) ?? { hits: 0, rules: 0 };
    sum.hits += rule.hitCount || 0;
    sum.rules += 1;
    policies.set(resource.id, sum);
  }
  for (const [id, { hits, rules }] of policies)
    cards.set(id, `${plural(hits, "hit")} · ${plural(rules, "rule")}`);

  return { cards, listeners };
}

// Route edges are drawn Gateway → route with the listener (sectionName) as the
// label; matching lines gain the listener's connection count.
export function withListenerTraffic(
  label: string,
  gatewayId: string,
  overlay: TrafficOverlay | undefined,
): string {
  if (!overlay || !label) return label;
  return label
    .split("\n")
    .map((line) => {
      const traffic = overlay.listeners.get(`${gatewayId}|${line}`);
      return traffic ? `${line} · ${traffic}` : line;
    })
    .join("\n");
}
