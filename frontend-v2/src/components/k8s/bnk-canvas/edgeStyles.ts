/**
 * Topology Canvas — relationship line styles and colours.
 *
 * Ported from Gateway Atlas (frontend/src/edgePresentation.ts and the
 * relationship colours in Graph.tsx), Apache-2.0, Copyright 2026 Gateway Atlas
 * contributors. Edge labels come from the backend (services/bnk/canvas_graph.py),
 * so only the stroke and label-filter rules are ported. Forge additions: `grant`
 * and `network`.
 */

// Relationship families carry meaning in the line itself, so a label is not
// needed to tell them apart.
export type RelationshipFamily =
  | "traffic"
  | "workload"
  | "configuration"
  | "policy"
  | "tls"
  | "logging";
export type RelationshipStroke = {
  family: RelationshipFamily;
  dash?: string;
  width: number;
  opacity?: number;
};

const strokeFamilies: Record<string, RelationshipStroke> = {
  class: { family: "traffic", width: 2 },
  parent: { family: "traffic", width: 2 },
  backend: { family: "traffic", width: 2 },
  route: { family: "traffic", width: 2 },
  mirror: { family: "traffic", dash: "6 5", width: 1.8 },
  selector: { family: "workload", width: 1.6 },
  endpoints: { family: "workload", width: 1.6 },
  workload: { family: "workload", width: 1.6 },
  configuration: { family: "configuration", dash: "7 4", width: 1.8 },
  configmap: { family: "configuration", dash: "7 4", width: 1.6 },
  "external-load-balancer": {
    family: "configuration",
    dash: "7 4",
    width: 1.8,
  },
  "policy-source": { family: "configuration", dash: "7 4", width: 1.8 },
  "endpoint-picker": { family: "configuration", dash: "3 3", width: 1.8 },
  grant: { family: "configuration", dash: "2 3", width: 1.6 },
  network: { family: "workload", dash: "10 3 2 3", width: 1.8 },
  policy: { family: "policy", dash: "1.5 4", width: 2.2 },
  filter: { family: "policy", dash: "1.5 4", width: 2.2 },
  authentication: { family: "policy", dash: "1.5 4", width: 2.2 },
  tls: { family: "tls", dash: "9 3 2 3", width: 1.8 },
  logging: { family: "logging", dash: "1.5 4", width: 1.5, opacity: 0.72 },
};

export const relationshipStroke = (type: string): RelationshipStroke =>
  strokeFamilies[type] ?? { family: "traffic", width: 2 };

// CSS variables defined in bnk-canvas.css, light and dark.
export const relationshipColors: Record<string, string> = {
  parent: "var(--canvas-flow-parent)",
  class: "var(--canvas-flow-parent)",
  configuration: "var(--canvas-flow-config)",
  configmap: "var(--canvas-flow-config)",
  "external-load-balancer": "var(--canvas-flow-config)",
  "endpoint-picker": "var(--canvas-flow-config)",
  grant: "var(--canvas-flow-config)",
  backend: "var(--canvas-flow-backend)",
  mirror: "var(--canvas-flow-backend)",
  policy: "var(--canvas-flow-policy)",
  filter: "var(--canvas-flow-policy)",
  authentication: "var(--canvas-flow-policy)",
  "policy-source": "var(--canvas-flow-policy)",
  logging: "var(--canvas-flow-logging)",
  tls: "var(--canvas-flow-tls)",
  route: "hsl(var(--primary))",
  endpoints: "var(--canvas-flow-workload)",
  selector: "var(--canvas-flow-workload)",
  workload: "var(--canvas-flow-workload)",
  network: "var(--canvas-flow-workload)",
};
export const relationshipColor = (type: string) =>
  relationshipColors[type] ?? "hsl(var(--muted-foreground))";

// Atlas draws these in reverse so the arrow follows traffic: class → Gateway,
// Gateway → route, Secret → Gateway.
export const visualDirection = (type: string, from: string, to: string) =>
  ["class", "parent", "policy-source", "tls"].includes(type)
    ? [to, from]
    : [from, to];

// Labels that only restate the relationship type (already encoded by colour
// and line style) or a catch-all match add no facts; they are shown when the
// resource is selected instead.
export const isInformativeLabel = (label: string, type: string) =>
  !!label && label !== type && label !== "/" && label !== "all";
