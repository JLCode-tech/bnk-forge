/**
 * ResourceTopologyGraph — Interactive Kubernetes & CRD Dependency Fabric.
 *
 * Renders cross-CRD dependency chains (AppPolicy → Gateway ↔ HTTPRoute &
 * AIGatewayProfile → AITenant / AIModel → AIProvider → AICredential → Secret,
 * F5 GSLB WideIP → Pool, CNEInstance → AIGateway / F5BigDnsCache, and
 * Services → Pods → owning workloads) as a reactflow v11 + dagre directed graph.
 *
 * - Domain filter pills: All, AI Gateway, Gateway & Routes, F5 CNF, Workloads & Core.
 * - Search box & connected-path highlighting on hover.
 * - Edge labels display exact CRD reference semantics (targetRef, extensionRef,
 *   tenantRef, providerRef, secretRef, backendRef, selects, owns).
 * - Node click → calls back onDescribeResource.
 * - Layout options: Horizontal (LR dagre), Vertical (TB dagre), Radial (concentric rings).
 */

import { useMemo, useCallback, useState, useEffect } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  Panel,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "@dagrejs/dagre";
import { AlertTriangle, Globe, Network, Search, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSeverityConfig } from "@/lib/health-severity";
import type { TopologyEdge, TopologyNode } from "@/hooks/useTopology";
import type { K8sResource } from "@/types/kubernetes";

// ---------------------------------------------------------------------------
// Layout & filter types
// ---------------------------------------------------------------------------

type LayoutMode = "horizontal" | "vertical" | "radial";
export type FabricDomainFilter =
  | "all"
  | "ai-gateway"
  | "gateway"
  | "cnf"
  | "workload";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_WIDTH = 196;
const NODE_HEIGHT = 64;

// Radial layout constants
const BASE_RADIUS = 130;
const RING_GAP = 145;
const MIN_RADIUS = 110;
const NODE_GAP = 22;

// Ring order for radial layout: index 0 = innermost ring
const RADIAL_RING_ORDER: string[] = [
  "Gateway",
  "HTTPRoute",
  "AppPolicy",
  "AIGatewayProfile",
  "AIModel",
  "AIProvider",
  "AICredential",
  "AITenant",
  "Service",
  "Pod",
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
];

// ---------------------------------------------------------------------------
// Domain classification & badge helpers
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  Deployment: "Deploy",
  StatefulSet: "STS",
  DaemonSet: "DS",
  ReplicaSet: "RS",
  Service: "SVC",
  Pod: "Pod",
  Secret: "Secret",
  Gateway: "Gateway",
  HTTPRoute: "HTTPRoute",
  AppPolicy: "AppPolicy",
  AIGatewayProfile: "AIProfile",
  AITenant: "AITenant",
  AIModel: "AIModel",
  AIProvider: "AIProvider",
  AICredential: "AICred",
  AIGateway: "AIGateway",
  CNEInstance: "CNEInstance",
  F5BigDnsCache: "DNSCache",
  F5BigGslbWideip: "GSLB WideIP",
  F5BigGslbPool: "GSLB Pool",
  F5BigGslbZone: "GSLB Zone",
  F5BigGslbInstance: "GSLB Inst",
  F5SPKVlan: "VLAN",
  F5SPKSnatpool: "SNATPool",
  F5SPKStaticRoute: "StaticRoute",
};

const AI_KINDS = new Set([
  "AIGatewayProfile",
  "AITenant",
  "AIModel",
  "AIProvider",
  "AICredential",
  "AIGateway",
]);

const GATEWAY_KINDS = new Set(["Gateway", "HTTPRoute", "AppPolicy"]);

const CNF_KINDS = new Set([
  "CNEInstance",
  "F5BigDnsCache",
  "F5BigGslbWideip",
  "F5BigGslbPool",
  "F5BigGslbZone",
  "F5BigGslbInstance",
  "F5SPKVlan",
  "F5SPKSnatpool",
  "F5SPKStaticRoute",
]);

function inferDomain(node: TopologyNode): Exclude<FabricDomainFilter, "all"> {
  if (node.category === "ai-gateway" || AI_KINDS.has(node.kind))
    return "ai-gateway";
  if (node.category === "gateway" || GATEWAY_KINDS.has(node.kind))
    return "gateway";
  if (node.category === "cnf" || CNF_KINDS.has(node.kind)) return "cnf";
  return "workload";
}

const DOMAIN_PILL_ACCENT: Record<Exclude<FabricDomainFilter, "all">, string> = {
  "ai-gateway": "bg-violet-500/15 text-violet-400 border-violet-500/30",
  gateway: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  cnf: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  workload: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function applyDagreLayout(
  rfNodes: Node[],
  rfEdges: Edge[],
  rankdir: "LR" | "TB",
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir, ranksep: 95, nodesep: 44 });

  rfNodes.forEach((n) =>
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }),
  );
  rfEdges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  const positioned = rfNodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });

  return { nodes: positioned, edges: rfEdges };
}

function applyRadialLayout(
  rfNodes: Node[],
  rfEdges: Edge[],
  topologyNodes: TopologyNode[],
): { nodes: Node[]; edges: Edge[] } {
  const byKind = new Map<string, string[]>();
  for (const tn of topologyNodes) {
    const existing = byKind.get(tn.kind) ?? [];
    existing.push(tn.id);
    byKind.set(tn.kind, existing);
  }

  const knownKinds = RADIAL_RING_ORDER.filter((k) => byKind.has(k));
  const unknownKinds = [...byKind.keys()]
    .filter((k) => !RADIAL_RING_ORDER.includes(k))
    .sort();
  const ringKinds = [...knownKinds, ...unknownKinds];

  const radiusByKind = new Map<string, number>();
  let ringIndex = 0;
  for (const kind of ringKinds) {
    const count = byKind.get(kind)?.length ?? 0;
    const circumferenceRadius =
      (count * (NODE_WIDTH + NODE_GAP)) / (2 * Math.PI);
    const baseRadius = BASE_RADIUS + ringIndex * RING_GAP;
    const radius = Math.max(MIN_RADIUS, circumferenceRadius, baseRadius);
    radiusByKind.set(kind, radius);
    ringIndex++;
  }

  const kindById = new Map<string, string>();
  for (const tn of topologyNodes) {
    kindById.set(tn.id, tn.kind);
  }

  const placementIndex = new Map<string, number>();
  for (const kind of ringKinds) {
    placementIndex.set(kind, 0);
  }

  const positioned = rfNodes.map((n) => {
    const kind = kindById.get(n.id) ?? "Unknown";
    const count = byKind.get(kind)?.length ?? 1;
    const radius = radiusByKind.get(kind) ?? BASE_RADIUS;
    const idx = placementIndex.get(kind) ?? 0;
    placementIndex.set(kind, idx + 1);

    const theta = (idx / count) * 2 * Math.PI - Math.PI / 2;
    const x = radius * Math.cos(theta) - NODE_WIDTH / 2;
    const y = radius * Math.sin(theta) - NODE_HEIGHT / 2;

    return { ...n, position: { x, y } };
  });

  return { nodes: positioned, edges: rfEdges };
}

function getLayoutedElements(
  rfNodes: Node[],
  rfEdges: Edge[],
  layout: LayoutMode,
  topologyNodes: TopologyNode[],
): { nodes: Node[]; edges: Edge[] } {
  if (rfNodes.length === 0) return { nodes: rfNodes, edges: rfEdges };

  if (layout === "radial") {
    return applyRadialLayout(rfNodes, rfEdges, topologyNodes);
  }

  const rankdir = layout === "vertical" ? "TB" : "LR";
  return applyDagreLayout(rfNodes, rfEdges, rankdir);
}

// ---------------------------------------------------------------------------
// Node & Edge builders
// ---------------------------------------------------------------------------

function buildRfNode(n: TopologyNode, dimmed = false): Node {
  const cfg = getSeverityConfig(n.severity);
  const shortKind = KIND_LABEL[n.kind] ?? n.kind;
  const domain = inferDomain(n);
  const domainBadgeClass = DOMAIN_PILL_ACCENT[domain];

  return {
    id: n.id,
    type: "default",
    data: {
      label: (
        <div className="flex flex-col items-center gap-0.5 px-1.5 w-full overflow-hidden">
          <div className="flex items-center gap-1">
            <span
              className={`text-2xs font-bold uppercase tracking-wider px-1.5 py-0.2 rounded border ${domainBadgeClass}`}
            >
              {shortKind}
            </span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`}
              title={n.severity}
            />
          </div>
          <span
            className="text-xs font-medium truncate w-full text-center leading-tight"
            title={`${n.kind}/${n.name} (${n.severity})`}
          >
            {n.name}
          </span>
        </div>
      ),
    },
    position: { x: 0, y: 0 },
    style: {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      border: `1.5px solid`,
      borderRadius: 8,
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      opacity: dimmed ? 0.25 : 1,
      transition: "opacity 150ms ease",
    },
    className: `${cfg.bg} ${cfg.border}`,
  };
}

function getEdgeStroke(kind: string): {
  stroke: string;
  animated: boolean;
  dashed: boolean;
} {
  switch (kind) {
    case "selects":
    case "routes":
    case "routes-to":
    case "attaches":
    case "attaches-to":
      return { stroke: "#6366f1", animated: true, dashed: true };
    case "extends":
    case "Targets":
    case "targets":
      return { stroke: "#8b5cf6", animated: true, dashed: false };
    case "references":
    case "routes-model":
    case "deploys-on":
      return { stroke: "#a855f7", animated: true, dashed: false };
    case "mounts":
    case "authenticates-via":
    case "reads-secret":
      return { stroke: "#f59e0b", animated: false, dashed: true };
    case "belongs-to-tenant":
      return { stroke: "#10b981", animated: false, dashed: true };
    default:
      return { stroke: "#94a3b8", animated: false, dashed: false };
  }
}

function buildRfEdge(e: TopologyEdge, dimmed = false): Edge {
  const { stroke, animated, dashed } = getEdgeStroke(e.kind);
  const edgeLabel =
    e.label || (e.kind !== "owns" && e.kind !== "selects" ? e.kind : undefined);

  return {
    id: e.id,
    source: e.source,
    target: e.target,
    animated,
    label: edgeLabel,
    labelStyle: { fontSize: 9, fill: "#cbd5e1", fontWeight: 600 },
    labelBgStyle: { fill: "#0f172a", fillOpacity: 0.82 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 12,
      height: 12,
      color: stroke,
    },
    style: {
      strokeDasharray: dashed ? "5 3" : undefined,
      stroke,
      strokeWidth: animated ? 2 : 1.5,
      opacity: dimmed ? 0.15 : 1,
      transition: "opacity 150ms ease",
    },
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ResourceTopologyGraphProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  info?: string | null;
  onDescribeResource: (resource: K8sResource) => void;
  defaultDomainFilter?: FabricDomainFilter;
  heightClassName?: string;
}

// ---------------------------------------------------------------------------
// Inner component (needs ReactFlow context for useReactFlow)
// ---------------------------------------------------------------------------

interface TopologyInnerProps extends ResourceTopologyGraphProps {
  layout: LayoutMode;
  onLayoutChange: (layout: LayoutMode) => void;
  domainFilter: FabricDomainFilter;
  onDomainFilterChange: (domain: FabricDomainFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
}

function TopologyInner({
  nodes: topologyNodes,
  edges: topologyEdges,
  info,
  onDescribeResource,
  layout,
  onLayoutChange,
  domainFilter,
  onDomainFilterChange,
  searchQuery,
  onSearchQueryChange,
}: TopologyInnerProps) {
  const { fitView } = useReactFlow();
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Filter nodes & edges by domain filter + search query (including immediate neighbors of matches)
  const { filteredTopoNodes, filteredTopoEdges } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matchingIds = new Set<string>();

    for (const n of topologyNodes) {
      const domainMatch =
        domainFilter === "all" ||
        inferDomain(n) === domainFilter ||
        // Keep Secret/Gateway/HTTPRoute connected to AI Gateway when viewing AI Gateway domain
        (domainFilter === "ai-gateway" &&
          (n.kind === "Secret" ||
            n.kind === "Gateway" ||
            n.kind === "HTTPRoute" ||
            n.kind === "AppPolicy"));

      const textMatch =
        !q ||
        n.name.toLowerCase().includes(q) ||
        n.kind.toLowerCase().includes(q) ||
        n.severity.toLowerCase().includes(q);

      if (domainMatch && textMatch) {
        matchingIds.add(n.id);
      }
    }

    const activeEdges = topologyEdges.filter(
      (e) => matchingIds.has(e.source) && matchingIds.has(e.target),
    );
    const activeNodes = topologyNodes.filter((n) => matchingIds.has(n.id));
    return { filteredTopoNodes: activeNodes, filteredTopoEdges: activeEdges };
  }, [topologyNodes, topologyEdges, domainFilter, searchQuery]);

  // Compute connected set when a node is hovered
  const connectedIds = useMemo(() => {
    if (!hoveredNodeId) return null;
    const set = new Set<string>([hoveredNodeId]);
    // Traverse both upstream and downstream in filteredTopoEdges
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of filteredTopoEdges) {
        if (set.has(e.source) && !set.has(e.target)) {
          set.add(e.target);
          changed = true;
        }
        if (set.has(e.target) && !set.has(e.source)) {
          set.add(e.source);
          changed = true;
        }
      }
    }
    return set;
  }, [hoveredNodeId, filteredTopoEdges]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (filteredTopoNodes.length === 0) return { nodes: [], edges: [] };

    const rfNodes = filteredTopoNodes.map((n) =>
      buildRfNode(n, connectedIds ? !connectedIds.has(n.id) : false),
    );
    const rfEdges = filteredTopoEdges.map((e) =>
      buildRfEdge(
        e,
        connectedIds
          ? !(connectedIds.has(e.source) && connectedIds.has(e.target))
          : false,
      ),
    );
    return getLayoutedElements(rfNodes, rfEdges, layout, filteredTopoNodes);
  }, [filteredTopoNodes, filteredTopoEdges, layout, connectedIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  useEffect(() => {
    const id = setTimeout(() => {
      void fitView({ padding: 0.2 });
    }, 50);
    return () => clearTimeout(id);
  }, [layout, domainFilter, filteredTopoNodes.length, fitView]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const parts = node.id.split("/");
      if (parts.length < 3) return;
      const [kind, namespace, ...nameParts] = parts;
      const name = nameParts.join("/");

      const resource: K8sResource = {
        kind,
        metadata: { name, namespace },
      } as unknown as K8sResource;

      onDescribeResource(resource);
    },
    [onDescribeResource],
  );

  const layoutButtons: { label: string; value: LayoutMode }[] = [
    { label: "Horizontal", value: "horizontal" },
    { label: "Vertical", value: "vertical" },
    { label: "Radial", value: "radial" },
  ];

  const domainButtons: { label: string; value: FabricDomainFilter }[] = [
    { label: "All Fabric", value: "all" },
    { label: "AI Gateway", value: "ai-gateway" },
    { label: "Gateway & Routes", value: "gateway" },
    { label: "F5 CNF", value: "cnf" },
    { label: "Workloads", value: "workload" },
  ];

  return (
    <>
      {info && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-md bg-warning/10 border border-warning/30 px-3 py-1 text-xs text-warning">
          <AlertTriangle className="h-3 w-3" />
          {info}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
        onNodeMouseLeave={() => setHoveredNodeId(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <div className="flex flex-wrap items-center gap-1.5 bg-background/95 backdrop-blur border rounded-md p-1.5 shadow-sm">
            <div className="flex items-center gap-1 px-1.5 text-xs font-semibold text-foreground">
              <Network className="h-3.5 w-3.5 text-primary" />
              <span>Dependency Fabric</span>
            </div>
            <div className="flex items-center gap-0.5 border-l pl-1.5">
              {domainButtons.map((btn) => (
                <Button
                  key={btn.value}
                  variant={domainFilter === btn.value ? "default" : "ghost"}
                  size="sm"
                  className="h-6 px-2 text-2xs"
                  onClick={() => onDomainFilterChange(btn.value)}
                >
                  {btn.label}
                </Button>
              ))}
            </div>
            <div className="relative flex items-center border-l pl-1.5">
              <Search className="h-3 w-3 text-muted-foreground absolute left-3.5 pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="Filter kind or name..."
                className="h-6 w-36 pl-6 pr-5 text-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchQueryChange("")}
                  className="absolute right-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </Panel>
        <Panel position="top-right">
          <div className="flex items-center gap-1 border rounded-md overflow-hidden bg-background shadow-sm">
            {layoutButtons.map((btn) => (
              <Button
                key={btn.value}
                variant={layout === btn.value ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2 rounded-none text-xs"
                onClick={() => onLayoutChange(btn.value)}
              >
                {btn.label}
              </Button>
            ))}
          </div>
        </Panel>
      </ReactFlow>
    </>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function ResourceTopologyGraph({
  nodes: topologyNodes,
  edges: topologyEdges,
  info,
  onDescribeResource,
  defaultDomainFilter = "all",
  heightClassName = "h-[560px]",
}: ResourceTopologyGraphProps) {
  const [layout, setLayout] = useState<LayoutMode>("horizontal");
  const [domainFilter, setDomainFilter] =
    useState<FabricDomainFilter>(defaultDomainFilter);
  const [searchQuery, setSearchQuery] = useState("");

  if (topologyNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[320px]">
        <EmptyState
          icon={Globe}
          title="No topology data"
          description="No services, pods, or custom fabric resources were found in this namespace."
          size="sm"
        />
      </div>
    );
  }

  return (
    <div className={`relative w-full ${heightClassName}`}>
      <ReactFlowProvider>
        <TopologyInner
          nodes={topologyNodes}
          edges={topologyEdges}
          info={info}
          onDescribeResource={onDescribeResource}
          layout={layout}
          onLayoutChange={setLayout}
          domainFilter={domainFilter}
          onDomainFilterChange={setDomainFilter}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
        />
      </ReactFlowProvider>
    </div>
  );
}
