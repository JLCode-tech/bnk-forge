/**
 * Topology Canvas — relationship placement and resource tiers.
 *
 * Ported from Gateway Atlas (frontend/src/topologyHierarchy.ts), Apache-2.0,
 * Copyright 2026 Gateway Atlas contributors. Forge additions: the `grant` and
 * `network` relationships, and EgressGateway as an entry resource.
 */

export type RelationshipPlacement = {
  mode: "hierarchy" | "peer";
  anchor?: "source" | "target";
  lane?: number;
};

// The layout contract for the resource graph. Hierarchy edges advance through
// the traffic path from left to right. Supporting resources stay in the same
// hierarchy column and use ordered vertical lanes.
export const relationshipPlacement: Record<string, RelationshipPlacement> = {
  class: { mode: "hierarchy" },
  parent: { mode: "hierarchy" },
  route: { mode: "hierarchy" },
  backend: { mode: "hierarchy" },
  mirror: { mode: "hierarchy" },
  endpoints: { mode: "hierarchy" },
  selector: { mode: "hierarchy" },
  workload: { mode: "hierarchy" },
  policy: { mode: "peer", anchor: "target", lane: -1 },
  "policy-source": { mode: "peer", anchor: "target", lane: -1 },
  tls: { mode: "peer", anchor: "target", lane: -1 },
  filter: { mode: "peer", anchor: "source", lane: -1 },
  authentication: { mode: "peer", anchor: "source", lane: -1 },
  configuration: { mode: "peer", anchor: "source", lane: 1 },
  "external-load-balancer": { mode: "peer", anchor: "source", lane: 1 },
  logging: { mode: "peer", anchor: "source", lane: 2 },
  configmap: { mode: "peer", anchor: "source", lane: 2 },
  "endpoint-picker": { mode: "peer", anchor: "source", lane: 1 },
  // Forge: a ReferenceGrant permits a reference; it is not a traffic parent of its target.
  grant: { mode: "peer", anchor: "target", lane: 1 },
  // Forge: an SPK egress uses a VLAN as its data-plane interface.
  network: { mode: "peer", anchor: "source", lane: 1 },
};

export const placementFor = (relationship: unknown): RelationshipPlacement =>
  relationshipPlacement[String(relationship)] ?? { mode: "hierarchy" };
export const isHierarchyRelationship = (relationship: unknown) =>
  placementFor(relationship).mode === "hierarchy";

export type ResourceHierarchyTier =
  | "class"
  | "entry"
  | "route"
  | "service"
  | "workload"
  | "support";

export const resourceHierarchyTier: Record<string, ResourceHierarchyTier> = {
  GatewayClass: "class",
  Gateway: "entry",
  // Forge: the egress counterpart of a Gateway, attached to the same GatewayClass.
  EgressGateway: "entry",
  HTTPRoute: "route",
  GRPCRoute: "route",
  TLSRoute: "route",
  TCPRoute: "route",
  UDPRoute: "route",
  L4Route: "route",
  Service: "service",
  InferencePool: "service",
  EndpointSlice: "workload",
  Deployment: "workload",
  DaemonSet: "workload",
  StatefulSet: "workload",
  Pod: "workload",
};

export const tierFor = (kind: unknown): ResourceHierarchyTier =>
  resourceHierarchyTier[String(kind)] ?? "support";
export const startsTrafficHierarchy = (kind: unknown) =>
  ["class", "entry"].includes(tierFor(kind));
