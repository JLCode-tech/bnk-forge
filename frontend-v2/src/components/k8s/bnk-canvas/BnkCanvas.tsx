/**
 * Topology Canvas — reactflow v11 renderer for the BNK relationship graph.
 *
 * Rendering follows Gateway Atlas (frontend/src/Graph.tsx: AtlasEdge, AtlasNode,
 * familiesHandles, placeEdgeLabels, namespace frames), Apache-2.0, Copyright
 * 2026 Gateway Atlas contributors, adapted from @xyflow/react v12 to reactflow
 * v11. Atlas's Classic (ELK) layout, export, popover and camera rules are not
 * ported; selection opens Forge's detail panel instead. Forge additions: the
 * traffic overlay (trafficOverlay.ts), full-path tracing (tracePath.ts) and a
 * vector SVG export (exportSvg.ts).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  BaseEdge,
  ControlButton,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import "./bnk-canvas.css";
import type {
  BnkCanvasEdge,
  BnkCanvasFinding,
  BnkCanvasResource,
} from "@/types";
import {
  cardHeight,
  cardWidth,
  framePad,
  layoutFamilies,
} from "./familiesLayout";
import { isHierarchyRelationship } from "./hierarchy";
import {
  collapseLabel,
  estimateLabelSize,
  placeEdgeLabel,
  type LabelRect,
} from "./edgeLabels";
import {
  isInformativeLabel,
  relationshipColor,
  relationshipStroke,
  visualDirection,
} from "./edgeStyles";
import {
  buildCanvasSvg,
  type SvgCard,
  type SvgEdge,
  type SvgFrame,
} from "./exportSvg";
import { neighbours, tracePath } from "./tracePath";
import { withListenerTraffic, type TrafficOverlay } from "./trafficOverlay";

export interface BnkCanvasProps {
  resources: BnkCanvasResource[];
  edges: BnkCanvasEdge[];
  findings: BnkCanvasFinding[];
  selectedId?: string;
  onSelect?: (resource: BnkCanvasResource | undefined) => void;
  // TMM counters to show on cards and listener edges; omit to hide them.
  traffic?: TrafficOverlay;
  // "path" highlights the selected card's whole traffic chain; "neighbours"
  // only its direct relationships (Atlas's rule).
  trace?: "path" | "neighbours";
  // File name, without extension, for "Save as SVG".
  exportName?: string;
}

type Point = { x: number; y: number };
type CardData = {
  resource: BnkCanvasResource;
  kind: string;
  namespace: string;
  errors: number;
  warnings: number;
  // Placeholder state: "missing" = a reference that should resolve and does
  // not; "unread" = a kind the Canvas does not read (Secrets, ClusterIssuers).
  absent?: "missing" | "unread";
  traffic?: string;
};
type FrameData = { label: string };
type CanvasEdgeData = {
  relationship: string;
  labelPosition?: Point;
};

const GATEWAY_GROUP = "gateway.networking.k8s.io";

// Card colour family by kind (Atlas `category`, extended for BIG-IP Next kinds).
function category(kind: string): string {
  if (kind === "Gateway" || kind === "EgressGateway" || kind === "GatewayClass")
    return "gateway";
  if (kind.endsWith("Route")) return "route";
  if (kind === "Service") return "service";
  if (kind === "Secret" || kind === "ClusterIssuer") return "secret";
  if (kind.includes("Policy") || kind.includes("Irule")) return "policy";
  if (kind.startsWith("F5SPKVlan") || kind === "Infra") return "network";
  return "config";
}
const isEntry = (resource: BnkCanvasResource) =>
  (resource.group === GATEWAY_GROUP && resource.kind === "Gateway") ||
  resource.kind === "EgressGateway";
const namespaceLabel = (resource: BnkCanvasResource) =>
  resource.namespace || "cluster-scoped";
const shortId = (id: string) => {
  const [, , kind, namespace, name] = id.split("|");
  return `${kind} ${namespace ? `${namespace}/` : ""}${name}`;
};
// Accepted/Programmed/Ready, whichever the resource reports first.
function readiness(conditions: Record<string, string> | undefined) {
  for (const type of ["Programmed", "Accepted", "Ready"]) {
    const status = conditions?.[type];
    if (status) return { type, ok: status === "True", status };
  }
  return undefined;
}

const factText = (resource: BnkCanvasResource) => {
  const fact = resource.facts?.[0];
  return fact ? `${fact.label} ${fact.value}` : undefined;
};
const kindText = (data: CardData) =>
  `${data.resource.kind}${data.absent === "missing" ? " · not found" : data.absent === "unread" ? " · not read" : ""}`;

const CanvasCard = memo(function CanvasCard({ data }: NodeProps<CardData>) {
  const { resource, errors, warnings, absent, traffic } = data;
  const ready = readiness(resource.conditions);
  const fact = factText(resource);
  const facts = (resource.facts ?? []).map(
    (item) => `${item.label}: ${item.value}`,
  );
  return (
    <>
      {(["Top", "Bottom", "Left", "Right"] as const).map((side) => (
        <span key={side}>
          <Handle
            type="target"
            position={Position[side]}
            id={`target-${side.toLowerCase()}`}
            isConnectable={false}
          />
          <Handle
            type="source"
            position={Position[side]}
            id={`source-${side.toLowerCase()}`}
            isConnectable={false}
          />
        </span>
      ))}
      <span className="bnk-card-kind">
        {ready && (
          <span
            className={`bnk-card-dot${ready.ok ? "" : " false"}`}
            title={`${ready.type}: ${ready.status}`}
          />
        )}
        {resource.kind}
        {absent === "missing" && " · not found"}
        {absent === "unread" && " · not read"}
        {errors > 0 ? (
          <span className="bnk-card-badge" title={`${errors} error findings`}>
            {errors}
          </span>
        ) : warnings > 0 ? (
          <span
            className="bnk-card-badge warning"
            title={`${warnings} warning findings`}
          >
            {warnings}
          </span>
        ) : null}
      </span>
      <span className="bnk-card-name" title={resource.name}>
        {resource.name}
      </span>
      {traffic ? (
        <span
          className="bnk-card-fact traffic"
          title={[`traffic: ${traffic}`, ...facts].join("\n")}
        >
          {traffic}
        </span>
      ) : (
        fact && (
          <span className="bnk-card-fact" title={facts.join("\n")}>
            {fact}
          </span>
        )
      )}
    </>
  );
});

function CanvasFrame({ data }: NodeProps<FrameData>) {
  return <span className="bnk-frame-label">{data.label}</span>;
}

function CanvasEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  data,
  interactionWidth,
}: EdgeProps<CanvasEdgeData>) {
  const [path, midX, midY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.28,
  });
  const lines = String(label ?? "")
    .split("\n")
    .filter(Boolean);
  const at = data?.labelPosition ?? { x: midX, y: midY };
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth}
      />
      {lines.length > 0 && (
        <EdgeLabelRenderer>
          <div
            className={`bnk-canvas-edge-label${lines.length > 1 ? " stack" : ""}`}
            title={lines.join(", ")}
            style={{
              transform: `translate(-50%,-50%) translate(${at.x}px,${at.y}px)`,
              borderColor: String(style?.stroke ?? "hsl(var(--border))"),
            }}
          >
            {lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { card: CanvasCard, frame: CanvasFrame };
const edgeTypes = { canvas: CanvasEdge };

// Families rows are horizontal, so traffic links connect side to side; class
// links drop into the Gateway from above so they never cross the policy chain
// that sits to the Gateway's left; support links choose a side by geometry.
function familiesHandles(
  relationship: unknown,
  source?: Point,
  target?: Point,
) {
  const dx = (target?.x ?? 0) - (source?.x ?? 0);
  const dy = (target?.y ?? 0) - (source?.y ?? 0);
  if (relationship === "class")
    return { sourceHandle: "source-right", targetHandle: "target-top" };
  const sideways =
    isHierarchyRelationship(relationship) || Math.abs(dx) >= Math.abs(dy) * 0.6;
  if (sideways)
    return dx >= 0
      ? { sourceHandle: "source-right", targetHandle: "target-left" }
      : { sourceHandle: "source-left", targetHandle: "target-right" };
  return dy >= 0
    ? { sourceHandle: "source-bottom", targetHandle: "target-top" }
    : { sourceHandle: "source-top", targetHandle: "target-bottom" };
}

function handlePoint(position: Point, handle: string) {
  const { x, y } = position;
  if (handle.endsWith("right"))
    return {
      x: x + cardWidth,
      y: y + cardHeight / 2,
      position: Position.Right,
    };
  if (handle.endsWith("left"))
    return { x, y: y + cardHeight / 2, position: Position.Left };
  if (handle.endsWith("top"))
    return { x: x + cardWidth / 2, y, position: Position.Top };
  return {
    x: x + cardWidth / 2,
    y: y + cardHeight,
    position: Position.Bottom,
  };
}

// The Bézier reactflow draws between two cards' chosen handles.
function edgePath(relationship: unknown, source: Point, target: Point) {
  const handles = familiesHandles(relationship, source, target);
  const from = handlePoint(source, handles.sourceHandle);
  const to = handlePoint(target, handles.targetHandle);
  return getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: from.position,
    targetX: to.x,
    targetY: to.y,
    targetPosition: to.position,
    curvature: 0.28,
  });
}

// One deterministic pass: each label takes the first spot along its curve
// clear of cards and earlier labels.
function placeEdgeLabels(
  edges: Edge<CanvasEdgeData>[],
  positions: Map<string, Point>,
) {
  const cards: LabelRect[] = [...positions.values()].map((p) => ({
    ...p,
    width: cardWidth,
    height: cardHeight,
  }));
  const placed: LabelRect[] = [];
  const result = new Map<string, Point>();
  for (const edge of edges) {
    const lines = String(edge.label ?? "")
      .split("\n")
      .filter(Boolean);
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!lines.length || !source || !target) continue;
    const [path, midX, midY] = edgePath(
      edge.data?.relationship,
      source,
      target,
    );
    const size = estimateLabelSize(lines);
    const point = placeEdgeLabel(path, { x: midX, y: midY }, size, [
      ...cards,
      ...placed,
    ]);
    result.set(edge.id, point);
    placed.push({
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
      ...size,
    });
  }
  return result;
}

// Frames around each namespace's cards, and around each class tile.
function frames(
  resources: BnkCanvasResource[],
  positions: Map<string, Point>,
  frameKeys: Map<string, string>,
): Node<FrameData>[] {
  const groups = new Map<string, { label: string; points: Point[] }>();
  for (const resource of resources) {
    const at = positions.get(resource.id);
    if (!at) continue;
    const key = frameKeys.get(resource.id) ?? `ns:${namespaceLabel(resource)}`;
    const group = groups.get(key) ?? {
      label: frameKeys.has(resource.id)
        ? "cluster-scoped"
        : namespaceLabel(resource),
      points: [],
    };
    group.points.push(at);
    groups.set(key, group);
  }
  return [...groups].map(([key, { label, points }]) => {
    const left = Math.min(...points.map((p) => p.x)) - framePad.left;
    const top = Math.min(...points.map((p) => p.y)) - framePad.top;
    const right =
      Math.max(...points.map((p) => p.x + cardWidth)) + framePad.right;
    const bottom =
      Math.max(...points.map((p) => p.y + cardHeight)) + framePad.bottom;
    return {
      id: `frame:${key}`,
      type: "frame",
      position: { x: left, y: top },
      data: { label },
      className: "bnk-frame",
      style: { width: right - left, height: bottom - top },
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
      zIndex: -1,
    };
  });
}

function CanvasInner({
  resources,
  edges,
  findings,
  selectedId,
  onSelect,
  traffic,
  trace = "path",
  exportName = "bnk-topology-canvas",
}: BnkCanvasProps) {
  const { fitView } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(
    () => new Map(resources.map((resource) => [resource.id, resource])),
    [resources],
  );
  const [focusId, setFocusId] = useState<string>();
  useEffect(() => setFocusId(selectedId), [selectedId]);

  // Same source, target, type and status draw one line with every label.
  const grouped = useMemo(() => {
    const result = new Map<string, Edge<CanvasEdgeData>>();
    for (const edge of edges) {
      if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
      const [source, target] = visualDirection(
        edge.type,
        edge.source,
        edge.target,
      );
      const key = JSON.stringify([source, target, edge.type, edge.status]);
      const existing = result.get(key);
      const label = edge.label || edge.type;
      if (existing) {
        const labels = new Set(
          String(existing.label ?? "")
            .split("\n")
            .filter(Boolean),
        );
        labels.add(label);
        existing.label = [...labels].join("\n");
        continue;
      }
      const color = relationshipColor(edge.type);
      const stroke = relationshipStroke(edge.type);
      const round = stroke.family === "policy" || stroke.family === "logging";
      result.set(key, {
        id: edge.id,
        source,
        target,
        type: "canvas",
        label,
        data: { relationship: edge.type },
        interactionWidth: 20,
        className: `${edge.status} relationship-${edge.type}`,
        style: {
          stroke: color,
          strokeWidth: stroke.width,
          strokeDasharray: stroke.dash,
          strokeLinecap: round ? "round" : undefined,
          opacity: stroke.opacity,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 14,
          height: 14,
        },
        ariaLabel: `${edge.type}: ${shortId(edge.source)} → ${shortId(edge.target)}`,
      });
    }
    return [...result.values()];
  }, [edges, byId]);

  const layout = useMemo(
    () =>
      layoutFamilies(
        resources.map((resource) => ({
          id: resource.id,
          data: {
            kind: resource.kind,
            namespace: namespaceLabel(resource),
          },
        })),
        grouped.map((edge) => ({
          source: edge.source,
          target: edge.target,
          label: edge.label,
          data: { relationship: edge.data?.relationship },
        })),
      ),
    [resources, grouped],
  );

  // Recentre whenever the graph is laid out again (new data or filter).
  useEffect(() => {
    const timer = window.setTimeout(
      () => fitView({ padding: 0.12, maxZoom: 0.95, duration: 0 }),
      40,
    );
    return () => window.clearTimeout(timer);
  }, [layout, fitView]);

  const related = useMemo(() => {
    if (!focusId) return undefined;
    const pathEdges = grouped.map((edge) => ({
      source: edge.source,
      target: edge.target,
      relationship: edge.data?.relationship,
    }));
    return trace === "path"
      ? tracePath(focusId, pathEdges)
      : neighbours(focusId, pathEdges);
  }, [focusId, grouped, trace]);

  const findingCounts = useMemo(() => {
    const counts = new Map<string, { errors: number; warnings: number }>();
    for (const finding of findings) {
      const count = counts.get(finding.resource) ?? { errors: 0, warnings: 0 };
      if (finding.severity === "error") count.errors++;
      else if (finding.severity === "warning") count.warnings++;
      counts.set(finding.resource, count);
    }
    return counts;
  }, [findings]);

  const nodes = useMemo(() => {
    const quiet = (id: string) =>
      edges
        .filter((edge) => edge.target === id)
        .every((edge) => edge.status === "unresolved");
    const cards: Node<CardData>[] = resources.map((resource) => {
      const counts = findingCounts.get(resource.id);
      const absent = resource.placeholder
        ? quiet(resource.id)
          ? "unread"
          : "missing"
        : undefined;
      const classes = [
        "bnk-card",
        category(resource.kind),
        isEntry(resource) ? "entry" : "",
        absent === "unread" ? "expected-absent" : "",
        absent === "missing" ? "broken" : "",
        related && !related.has(resource.id) ? "canvas-muted" : "",
        resource.id === focusId ? "canvas-selected" : "",
      ];
      return {
        id: resource.id,
        type: "card",
        position: layout.positions.get(resource.id) ?? { x: 0, y: 0 },
        data: {
          resource,
          kind: resource.kind,
          namespace: namespaceLabel(resource),
          errors: counts?.errors ?? 0,
          warnings: counts?.warnings ?? 0,
          absent,
          traffic: traffic?.cards.get(resource.id),
        },
        className: classes.filter(Boolean).join(" "),
        style: { width: cardWidth, height: cardHeight },
        draggable: false,
        connectable: false,
        ariaLabel: `${resource.kind} ${namespaceLabel(resource)}/${resource.name}`,
      };
    });
    return [...frames(resources, layout.positions, layout.frameKeys), ...cards];
  }, [resources, edges, layout, findingCounts, related, focusId, traffic]);

  // Unfocused edges keep only labels that add facts; the selected resource's
  // relationships show every label.
  const displayEdges = useMemo(() => {
    const labelled = grouped.map((edge) => {
      const relationship = String(edge.data?.relationship);
      const all = (
        relationship === "parent"
          ? withListenerTraffic(String(edge.label ?? ""), edge.source, traffic)
          : String(edge.label ?? "")
      )
        .split("\n")
        .filter(Boolean);
      const focused =
        !!focusId && (edge.source === focusId || edge.target === focusId);
      const shown = collapseLabel(
        focused
          ? all
          : all.filter((label) => isInformativeLabel(label, relationship)),
        focused,
      );
      return { ...edge, label: shown.join("\n") };
    });
    const labelPositions = placeEdgeLabels(labelled, layout.positions);
    return labelled.map((edge) => {
      const isRelated =
        !related || (related.has(edge.source) && related.has(edge.target));
      return {
        ...edge,
        ...familiesHandles(
          edge.data?.relationship,
          layout.positions.get(edge.source),
          layout.positions.get(edge.target),
        ),
        data: { ...edge.data!, labelPosition: labelPositions.get(edge.id) },
        className: `${edge.className ?? ""}${isRelated ? "" : " canvas-muted"}`,
        style: {
          ...edge.style,
          strokeWidth: focusId && isRelated ? 3 : edge.style?.strokeWidth,
        },
      };
    });
  }, [grouped, layout, focusId, related, traffic]);

  const legend = useMemo(
    () => [...new Set(edges.map((edge) => edge.type))].sort(),
    [edges],
  );

  const select = useCallback(
    (id: string | undefined) => {
      setFocusId(id);
      onSelect?.(id ? byId.get(id) : undefined);
    },
    [byId, onSelect],
  );

  // Colours are resolved from the live theme, so the file matches what is on
  // screen (light or dark) and needs no CSS variables to render.
  const saveSvg = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const probe = document.createElement("span");
    root.appendChild(probe);
    // A colour the engine cannot resolve falls back to a neutral grey, so the
    // file never carries CSS variables.
    const solid = (color: string | undefined) =>
      color && !color.includes("var(") ? color : "#7f7f7f";
    const resolve = (value: string) => {
      probe.style.color = "";
      probe.style.color = value;
      return solid(getComputedStyle(probe).color);
    };
    const escapeId =
      globalThis.CSS?.escape ?? ((id: string) => id.replace(/"/g, '\\"'));
    const svgCards: SvgCard[] = [];
    const svgFrames: SvgFrame[] = [];
    for (const node of nodes) {
      const width = Number(node.style?.width ?? cardWidth);
      const height = Number(node.style?.height ?? cardHeight);
      if (node.type === "frame") {
        svgFrames.push({
          ...node.position,
          width,
          height,
          label: (node.data as FrameData).label,
        });
        continue;
      }
      const data = node.data as CardData;
      const element = root.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${escapeId(node.id)}"]`,
      );
      const style = element ? getComputedStyle(element) : undefined;
      const factElement = element?.querySelector<HTMLElement>(".bnk-card-fact");
      svgCards.push({
        ...node.position,
        width,
        height,
        kind: kindText(data),
        name: data.resource.name,
        fact: data.traffic ?? factText(data.resource),
        accent: style?.borderTopColor
          ? solid(style.borderTopColor)
          : resolve("hsl(var(--border))"),
        fill: style?.backgroundColor
          ? solid(style.backgroundColor)
          : resolve("hsl(var(--card))"),
        text: style?.color
          ? solid(style.color)
          : resolve("hsl(var(--card-foreground))"),
        muted: factElement
          ? solid(getComputedStyle(factElement).color)
          : resolve("hsl(var(--muted-foreground))"),
        dashed: /\b(broken|expected-absent)\b/.test(node.className ?? ""),
      });
    }
    const svgEdges: SvgEdge[] = displayEdges.flatMap((edge) => {
      const source = layout.positions.get(edge.source);
      const target = layout.positions.get(edge.target);
      if (!source || !target) return [];
      const [path, midX, midY] = edgePath(
        edge.data?.relationship,
        source,
        target,
      );
      const broken = /\bbroken\b/.test(edge.className ?? "");
      return [
        {
          path,
          color: resolve(
            broken
              ? "hsl(var(--destructive))"
              : String(edge.style?.stroke ?? "hsl(var(--border))"),
          ),
          width: Number(
            relationshipStroke(edge.data?.relationship ?? "").width,
          ),
          dash: edge.style?.strokeDasharray
            ? String(edge.style.strokeDasharray)
            : undefined,
          opacity:
            typeof edge.style?.opacity === "number"
              ? edge.style.opacity
              : undefined,
          label: String(edge.label ?? "")
            .split("\n")
            .filter(Boolean),
          labelAt: edge.data?.labelPosition ?? { x: midX, y: midY },
        },
      ];
    });
    const svg = buildCanvasSvg({
      frames: svgFrames,
      cards: svgCards,
      edges: svgEdges,
      title: "BNK Topology Canvas",
      theme: {
        background: solid(getComputedStyle(root).backgroundColor),
        frameFill: resolve("hsl(var(--muted) / 0.35)"),
        frameStroke: resolve("hsl(var(--border))"),
        frameText: resolve("hsl(var(--muted-foreground))"),
        labelFill: resolve("hsl(var(--card))"),
        labelText: resolve("hsl(var(--foreground))"),
        labelStroke: resolve("hsl(var(--border))"),
      },
    });
    probe.remove();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportName}.svg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [nodes, displayEdges, layout, exportName]);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") select(undefined);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [select]);

  return (
    <div className="bnk-canvas" data-testid="bnk-canvas" ref={containerRef}>
      <div className="bnk-canvas-legend" aria-label="Relationship legend">
        {legend.map((type) => {
          const stroke = relationshipStroke(type);
          return (
            <span key={type}>
              <svg width="18" height="6" aria-hidden="true">
                <line
                  x1="1"
                  y1="3"
                  x2="17"
                  y2="3"
                  stroke={relationshipColor(type)}
                  strokeWidth={Math.max(2, stroke.width)}
                  strokeDasharray={stroke.dash}
                />
              </svg>
              {type}
            </span>
          );
        })}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => {
          if (node.type === "card") select(node.id);
        }}
        onPaneClick={() => select(undefined)}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable
        minZoom={0.1}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 0.95 }}
        attributionPosition="bottom-left"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive>
          <ControlButton
            onClick={saveSvg}
            title="Save as SVG"
            aria-label="Save as SVG"
          >
            <Download aria-hidden="true" />
          </ControlButton>
        </Controls>
        <MiniMap
          pannable
          zoomable
          // Colours come from bnk-canvas.css: SVG fill attributes cannot use CSS variables.
          nodeClassName={(node) =>
            node.type === "frame" ? "minimap-frame" : "minimap-card"
          }
        />
      </ReactFlow>
    </div>
  );
}

export function BnkCanvas(props: BnkCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
