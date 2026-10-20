/**
 * CNF Network Graph — Cloud-Native Network Functions Data Plane Topology.
 *
 * Visualizes the telco data plane and packet pipeline:
 * 1. External Uplink & BGP Routers (RAN / Subscriber Traffic)
 * 2. Host Physical Acceleration (SR-IOV VFs, DPDK Hugepages, NUMA Pinning)
 * 3. F5 TMM High-Speed Packet Processing Core
 * 4. Active CNF Network Functions (DNS Express, CGNAT, Diameter Signaling)
 * 5. Internal Downlink & 5G Core Network (UPF, AMF, SMF, IMS Core)
 */

import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Network,
  Cpu,
  Server,
  Zap,
  Globe,
  Radio,
  Layers,
  ArrowRight,
  Sliders,
  Pause,
} from "lucide-react";
import { useTopology } from "@/hooks/useTopology";
import { ResourceTopologyGraph } from "@/components/k8s/ResourceTopologyGraph";
import type { K8sResource } from "@/types/kubernetes";

interface CNFNetworkGraphProps {
  clusterId?: number | null;
  namespace?: string;
  dnsApps?: K8sResource[];
  cgnatInstances?: K8sResource[];
  diameterInstances?: K8sResource[];
  onDescribeResource?: (resource: K8sResource) => void;
}

type FunctionFilter = "all" | "dns" | "cgnat" | "diameter" | "gslb";
type GraphViewMode = "pipeline" | "fabric";

interface TopologyNode {
  id: string;
  category: "uplink" | "sriov" | "tmm" | "cnf" | "downlink";
  subCategory?: "dns" | "cgnat" | "diameter" | "gslb" | "core";
  title: string;
  subtitle: string;
  status: "healthy" | "active" | "standby" | "warning";
  icon: React.ComponentType<{ className?: string }>;
  ipCidr?: string;
  vlan?: number;
  mtu?: number;
  driver?: string;
  crdKind?: string;
  crdName?: string;
  stats: {
    throughput: string;
    pps: string;
    sessions?: string;
    qps?: string;
    latency?: string;
  };
  details: string;
}

export function CNFNetworkGraph({
  clusterId,
  namespace = "default",
  dnsApps = [],
  cgnatInstances = [],
  diameterInstances = [],
  onDescribeResource,
}: CNFNetworkGraphProps) {
  const [graphMode, setGraphMode] = useState<GraphViewMode>("pipeline");
  const [filter, setFilter] = useState<FunctionFilter>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    "tmm-core",
  );
  const [isLiveTraffic, setIsLiveTraffic] = useState(true);

  const effectiveNs = !namespace || namespace === "all" ? "default" : namespace;
  const { data: fabricData } = useTopology(clusterId ?? 0, effectiveNs, {
    enabled: !!clusterId && graphMode === "fabric",
  });

  const hasRealResources =
    dnsApps.length > 0 ||
    cgnatInstances.length > 0 ||
    diameterInstances.length > 0;

  // Construct topology nodes strictly from real deployed resources on the cluster
  const nodes: TopologyNode[] = useMemo(() => {
    const totalNfs =
      dnsApps.length + cgnatInstances.length + diameterInstances.length;
    const cnfNodes: TopologyNode[] = [];

    for (const app of dnsApps) {
      const name = app.metadata?.name ?? "dns-listener";
      const ns = app.metadata?.namespace ?? effectiveNs;
      const ip = app.spec?.ip || "Cluster VIP";
      const port = app.spec?.port ?? 53;
      const proto = (app.spec?.protocol ?? "udp").toUpperCase();
      const poolName = app.spec?.pool?.name ?? "default-pool";
      cnfNodes.push({
        id: `cnf-dns-${ns}-${name}`,
        category: "cnf",
        subCategory: "dns",
        title: name,
        subtitle: `F5BigDnsApp • ${ns}`,
        status: "active",
        icon: Radio,
        ipCidr: `${ip}:${port} (${proto})`,
        crdKind: "F5BigDnsApp",
        crdName: name,
        stats: {
          throughput: `Pool: ${poolName}`,
          pps: `${proto}/${port}`,
        },
        details: `Deployed F5BigDnsApp listener '${name}' in namespace '${ns}' serving ${ip}:${port} (${proto}) backed by pool '${poolName}'.`,
      });
    }

    for (const cgnat of cgnatInstances) {
      const name = cgnat.metadata?.name ?? "cgnat-rule";
      const ns = cgnat.metadata?.namespace ?? effectiveNs;
      const srcAddrs =
        cgnat.spec?.sourceAddresses?.join(", ") || "Configured subnet";
      const transPool = cgnat.spec?.translationPool || "Configured NAT pool";
      cnfNodes.push({
        id: `cnf-cgnat-${ns}-${name}`,
        category: "cnf",
        subCategory: "cgnat",
        title: name,
        subtitle: `F5BigCgnat • ${ns}`,
        status: "active",
        icon: Cpu,
        ipCidr: `${srcAddrs} → ${transPool}`,
        crdKind: "F5BigCgnat",
        crdName: name,
        stats: {
          throughput: `Pool: ${transPool}`,
          pps: `Source: ${srcAddrs}`,
        },
        details: `Deployed F5BigCgnat instance '${name}' in namespace '${ns}' translating subscriber source addresses (${srcAddrs}) via pool '${transPool}'.`,
      });
    }

    for (const diam of diameterInstances) {
      const name = diam.metadata?.name ?? "diameter-profile";
      const ns = diam.metadata?.namespace ?? effectiveNs;
      const originHost = diam.spec?.originHost || "Configured Origin-Host";
      const originRealm = diam.spec?.originRealm || "Configured Origin-Realm";
      const peerCount = diam.spec?.peers?.length ?? 0;
      cnfNodes.push({
        id: `cnf-diameter-${ns}-${name}`,
        category: "cnf",
        subCategory: "diameter",
        title: name,
        subtitle: `F5BigDiameter • ${ns}`,
        status: "active",
        icon: Server,
        ipCidr: `${originHost} (${originRealm})`,
        crdKind: "F5BigDiameter",
        crdName: name,
        stats: {
          throughput: `${peerCount} peer(s)`,
          pps: originRealm,
        },
        details: `Deployed F5BigDiameter signaling profile '${name}' in namespace '${ns}' with Origin-Host '${originHost}', Origin-Realm '${originRealm}', and ${peerCount} configured peer(s).`,
      });
    }

    return [
      // 1. Uplink Stage
      {
        id: "bgp-gw-1",
        category: "uplink",
        title: "External Ingress Uplink",
        subtitle: `Namespace: ${effectiveNs}`,
        status: "healthy",
        icon: Globe,
        crdKind: "F5SPKStaticRoute",
        stats: {
          throughput: `${totalNfs} active NF(s)`,
          pps: "BGP / Static Uplink",
        },
        details:
          "Upstream network ingress feeding deployed CNF listeners in the selected cluster namespace.",
      },

      // 2. Physical Acceleration (SR-IOV / DPDK)
      {
        id: "sriov-vf0",
        category: "sriov",
        title: "Network Attachment / VLAN",
        subtitle: `Namespace: ${effectiveNs}`,
        status: "active",
        icon: Layers,
        crdKind: "F5SPKVlan",
        stats: {
          throughput: "L2/L3 Binding",
          pps: "CNI / SR-IOV",
        },
        details:
          "Cluster network attachment and F5SPKVlan binding delivering ingress traffic into TMM data-plane pods.",
      },

      // 3. TMM Packet Core
      {
        id: "tmm-core",
        category: "tmm",
        title: "F5 TMM Proxy Engine",
        subtitle: `Serving ${totalNfs} CNF resource(s)`,
        status: "active",
        icon: Zap,
        crdKind: "CNEInstance",
        stats: {
          throughput: `${dnsApps.length} DNS`,
          pps: `${cgnatInstances.length} CGNAT • ${diameterInstances.length} DSR`,
        },
        details:
          "Traffic Management Microkernel (TMM) data plane executing deployed DNS, CGNAT, and Diameter custom resources.",
      },

      // 4. Deployed CNF Micro-Engines
      ...cnfNodes,

      // 5. Downlink Stage
      {
        id: "downlink-core",
        category: "downlink",
        title: "Upstream Pools & Peers",
        subtitle: `Namespace: ${effectiveNs}`,
        status: "healthy",
        icon: Network,
        stats: {
          throughput: `${totalNfs} target binding(s)`,
          pps: "Backend Service Mesh",
        },
        details:
          "Downstream backend pools, translated egress subnets, and Diameter signaling peers referenced by deployed CNF resources.",
      },
    ];
  }, [dnsApps, cgnatInstances, diameterInstances, effectiveNs]);

  // Filter nodes based on active selection
  const isNodeVisible = (node: TopologyNode) => {
    if (filter === "all") return true;
    if (
      node.category === "uplink" ||
      node.category === "sriov" ||
      node.category === "tmm" ||
      node.category === "downlink"
    )
      return true;
    return node.subCategory === filter;
  };

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) ?? nodes[0];
  }, [nodes, selectedNodeId]);

  if (graphMode === "fabric") {
    return (
      <div className="flex flex-col h-full bg-background overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-border bg-card/60">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              CNF Topology Mode:
            </span>
            <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setGraphMode("pipeline")}
                className="px-2.5 py-1 text-xs font-medium rounded-sm text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Data Plane Pipeline
              </button>
              <button
                type="button"
                onClick={() => setGraphMode("fabric")}
                className="px-2.5 py-1 text-xs font-medium rounded-sm bg-background text-foreground shadow-xs cursor-pointer"
              >
                CRD Dependency Fabric
              </button>
            </div>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            Cross-CRD Reference Graph ({effectiveNs})
          </Badge>
        </div>
        <div className="flex-1 min-h-[540px]">
          <ResourceTopologyGraph
            nodes={fabricData?.nodes ?? []}
            edges={fabricData?.edges ?? []}
            info={fabricData?.info}
            defaultDomainFilter="all"
            heightClassName="h-full min-h-[540px]"
            onDescribeResource={onDescribeResource ?? (() => undefined)}
          />
        </div>
      </div>
    );
  }

  if (!hasRealResources) {
    return (
      <div className="flex items-center justify-center h-full p-12 bg-background">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-xl bg-muted/60 border border-border flex items-center justify-center text-muted-foreground">
            <Network className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">
              No Active CNF Pipeline Detected
            </h3>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              No F5 CNF resources (DNS Express, CGNAT, Diameter, or GSLB v1) are
              currently deployed on this cluster in namespace{" "}
              <code className="font-mono text-foreground">{effectiveNs}</code>.
              Deploy a CNF resource or switch to the CRD Dependency Fabric to
              inspect live cluster custom resources.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => setGraphMode("fabric")}
            >
              Open CRD Dependency Fabric
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-border bg-card/60 backdrop-blur-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5 mr-2">
            <button
              type="button"
              onClick={() => setGraphMode("pipeline")}
              className="px-2.5 py-1 text-xs font-medium rounded-sm bg-background text-foreground shadow-xs cursor-pointer"
            >
              Data Plane Pipeline
            </button>
            <button
              type="button"
              onClick={() => setGraphMode("fabric")}
              className="px-2.5 py-1 text-xs font-medium rounded-sm text-muted-foreground hover:text-foreground cursor-pointer"
            >
              CRD Dependency Fabric
            </button>
          </div>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-1">
            Function Filter:
          </span>
          <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer",
                filter === "all"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              All Functions
            </button>
            <button
              type="button"
              onClick={() => setFilter("dns")}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer flex items-center gap-1.5",
                filter === "dns"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Radio className="h-3 w-3 text-success" />
              DNS Express ({dnsApps.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("cgnat")}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer flex items-center gap-1.5",
                filter === "cgnat"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Cpu className="h-3 w-3 text-info" />
              CGNAT ({cgnatInstances.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("diameter")}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer flex items-center gap-1.5",
                filter === "diameter"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Server className="h-3 w-3 text-primary" />
              Diameter ({diameterInstances.length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Live Animation Toggle */}
          <button
            type="button"
            onClick={() => setIsLiveTraffic(!isLiveTraffic)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {isLiveTraffic ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                </span>
                <span>Live Packet Flow Active</span>
              </>
            ) : (
              <>
                <Pause className="h-3 w-3" />
                <span>Flow Paused</span>
              </>
            )}
          </button>

          <Badge variant="outline" className="text-xs font-mono">
            Namespace: {effectiveNs}
          </Badge>
        </div>
      </div>

      {/* Main Canvas + Right Inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Interactive Topology Diagram */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Pipeline Stages Visual */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-stretch">
            {/* Stage 1: Ingress / Uplink */}
            <div className="rounded-xl border border-border/80 bg-card/40 p-4 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-border/60">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Stage 1: Ingress Uplink
                  </span>
                  <Badge variant="outline" className="text-xs">
                    External
                  </Badge>
                </div>
                <div className="space-y-3 mt-3">
                  {nodes
                    .filter((n) => n.category === "uplink")
                    .map((node) => (
                      <NodeCard
                        key={node.id}
                        node={node}
                        isSelected={selectedNodeId === node.id}
                        onClick={() => setSelectedNodeId(node.id)}
                        dimmed={!isNodeVisible(node)}
                      />
                    ))}
                </div>
              </div>
              <div className="text-center pt-2">
                <span className="text-xs font-mono text-muted-foreground">
                  Namespace: {effectiveNs}
                </span>
              </div>
            </div>

            {/* Stage 2: Hardware Acceleration / SR-IOV */}
            <div className="rounded-xl border border-border/80 bg-card/40 p-4 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-border/60">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Stage 2: Acceleration
                  </span>
                  <Badge variant="outline" className="text-xs">
                    SR-IOV / VLAN
                  </Badge>
                </div>
                <div className="space-y-3 mt-3">
                  {nodes
                    .filter((n) => n.category === "sriov")
                    .map((node) => (
                      <NodeCard
                        key={node.id}
                        node={node}
                        isSelected={selectedNodeId === node.id}
                        onClick={() => setSelectedNodeId(node.id)}
                        dimmed={!isNodeVisible(node)}
                      />
                    ))}
                </div>
              </div>
              <div className="text-center pt-2">
                <span className="text-xs font-mono text-muted-foreground">
                  F5SPKVlan / Multus CNI
                </span>
              </div>
            </div>

            {/* Stage 3: F5 TMM Core */}
            <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 flex flex-col justify-between space-y-3 relative overflow-hidden">
              {isLiveTraffic && (
                <div className="absolute inset-0 bg-radial from-primary/10 via-transparent to-transparent opacity-50 pointer-events-none animate-pulse" />
              )}
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-primary/20">
                  <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5" />
                    Stage 3: TMM Core
                  </span>
                  <Badge variant="default" className="text-xs font-mono">
                    Data Plane
                  </Badge>
                </div>
                <div className="mt-6">
                  {nodes
                    .filter((n) => n.category === "tmm")
                    .map((node) => (
                      <NodeCard
                        key={node.id}
                        node={node}
                        isSelected={selectedNodeId === node.id}
                        onClick={() => setSelectedNodeId(node.id)}
                        dimmed={!isNodeVisible(node)}
                        highlight
                      />
                    ))}
                </div>
              </div>
              <div className="text-center pt-2 space-y-1">
                <div className="text-xs font-semibold text-foreground">
                  TMM Proxy Fastpath
                </div>
                <div className="text-xs font-mono text-muted-foreground">
                  Flow Classifier & Dispatcher
                </div>
              </div>
            </div>

            {/* Stage 4: CNF Micro-Engines */}
            <div className="rounded-xl border border-border/80 bg-card/40 p-4 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-border/60">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Stage 4: CNF Services
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {dnsApps.length +
                      cgnatInstances.length +
                      diameterInstances.length}{" "}
                    Deployed
                  </Badge>
                </div>
                <div className="space-y-3 mt-3">
                  {nodes
                    .filter((n) => n.category === "cnf")
                    .map((node) => (
                      <NodeCard
                        key={node.id}
                        node={node}
                        isSelected={selectedNodeId === node.id}
                        onClick={() => setSelectedNodeId(node.id)}
                        dimmed={!isNodeVisible(node)}
                      />
                    ))}
                </div>
              </div>
              <div className="text-center pt-2">
                <span className="text-xs font-mono text-muted-foreground">
                  Active CNF Custom Resources
                </span>
              </div>
            </div>

            {/* Stage 5: Downlink / Core Workloads */}
            <div className="rounded-xl border border-border/80 bg-card/40 p-4 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-border/60">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Stage 5: Telco Core
                  </span>
                  <Badge variant="outline" className="text-xs">
                    Target Pools
                  </Badge>
                </div>
                <div className="space-y-3 mt-3">
                  {nodes
                    .filter((n) => n.category === "downlink")
                    .map((node) => (
                      <NodeCard
                        key={node.id}
                        node={node}
                        isSelected={selectedNodeId === node.id}
                        onClick={() => setSelectedNodeId(node.id)}
                        dimmed={!isNodeVisible(node)}
                      />
                    ))}
                </div>
              </div>
              <div className="text-center pt-2">
                <span className="text-xs font-mono text-muted-foreground">
                  Pools & Signaling Peers
                </span>
              </div>
            </div>
          </div>

          {/* Quick Flow Architecture Legend */}
          <div className="rounded-lg border border-border bg-card/60 p-4 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-primary" />
                Packet Traversal Path:
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success" />
                External Ingress
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-info" />
                Network Attachment
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-warning" />
                TMM Fastpath Core
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" />
                CNF L4–L7 Engine
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-info" />
                Upstream Pools / Peers
              </span>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              Live Kubernetes CRD State
            </span>
          </div>
        </div>

        {/* Right Inspector Panel */}
        {selectedNode && (
          <div className="w-80 lg:w-96 border-l border-border bg-card/80 p-5 flex flex-col justify-between overflow-y-auto space-y-4">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <selectedNode.icon className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">
                      {selectedNode.title}
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedNode.subtitle}
                  </p>
                </div>
                <Badge
                  variant={
                    selectedNode.status === "active" ||
                    selectedNode.status === "healthy"
                      ? "default"
                      : "outline"
                  }
                  className="text-xs font-mono"
                >
                  {selectedNode.status}
                </Badge>
              </div>

              {/* Functional description */}
              <div className="p-3 rounded-lg bg-muted/40 border border-border/60 text-xs text-muted-foreground leading-relaxed">
                {selectedNode.details}
              </div>

              {/* Network Parameters */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Network & Hardware Specs
                </h4>
                <div className="rounded-lg border border-border bg-card divide-y divide-border/60 text-xs">
                  {selectedNode.ipCidr && (
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-muted-foreground">
                        IP / Endpoint
                      </span>
                      <span className="font-mono font-medium text-foreground">
                        {selectedNode.ipCidr}
                      </span>
                    </div>
                  )}
                  {selectedNode.vlan && (
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-muted-foreground">VLAN Tag</span>
                      <span className="font-mono font-medium text-foreground">
                        VLAN {selectedNode.vlan}
                      </span>
                    </div>
                  )}
                  {selectedNode.mtu && (
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-muted-foreground">
                        Jumbo Frame MTU
                      </span>
                      <span className="font-mono font-medium text-foreground">
                        {selectedNode.mtu} bytes
                      </span>
                    </div>
                  )}
                  {selectedNode.driver && (
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-muted-foreground">
                        Acceleration Driver
                      </span>
                      <span className="font-mono font-medium text-foreground">
                        {selectedNode.driver}
                      </span>
                    </div>
                  )}
                  {selectedNode.crdKind && (
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-muted-foreground">
                        Governing CRD
                      </span>
                      <Badge variant="outline" className="font-mono text-xs">
                        {selectedNode.crdKind}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>

              {/* Real-time Telemetry Stats */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Data Plane Telemetry
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg border border-border bg-card">
                    <div className="text-xs text-muted-foreground">
                      Throughput
                    </div>
                    <div className="text-sm font-bold tabular-nums text-foreground mt-0.5">
                      {selectedNode.stats.throughput}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-border bg-card">
                    <div className="text-xs text-muted-foreground">
                      Packet Rate
                    </div>
                    <div className="text-sm font-bold tabular-nums text-foreground mt-0.5">
                      {selectedNode.stats.pps}
                    </div>
                  </div>
                  {selectedNode.stats.qps && (
                    <div className="p-2.5 rounded-lg border border-border bg-card col-span-2">
                      <div className="text-xs text-muted-foreground">
                        Query Resolution Rate
                      </div>
                      <div className="text-sm font-bold tabular-nums text-success mt-0.5">
                        {selectedNode.stats.qps}
                      </div>
                    </div>
                  )}
                  {selectedNode.stats.sessions && (
                    <div className="p-2.5 rounded-lg border border-border bg-card col-span-2">
                      <div className="text-xs text-muted-foreground">
                        Active Translations / Sessions
                      </div>
                      <div className="text-sm font-bold tabular-nums text-info mt-0.5">
                        {selectedNode.stats.sessions}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {selectedNode.crdName && (
              <div className="pt-3 border-t border-border">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Instance Name:</span>
                  <span className="font-mono font-semibold text-foreground">
                    {selectedNode.crdName}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: NodeCard
// ─────────────────────────────────────────────────────────────────────────────

interface NodeCardProps {
  node: TopologyNode;
  isSelected: boolean;
  onClick: () => void;
  dimmed?: boolean;
  highlight?: boolean;
}

function NodeCard({
  node,
  isSelected,
  onClick,
  dimmed,
  highlight,
}: NodeCardProps) {
  const Icon = node.icon;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative p-3 rounded-lg border transition-all cursor-pointer text-left",
        dimmed ? "opacity-30 pointer-events-none" : "opacity-100",
        isSelected
          ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary"
          : highlight
            ? "border-primary/50 bg-card hover:border-primary"
            : "border-border bg-card hover:border-border-hover hover:bg-muted/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "p-1.5 rounded-md text-primary shrink-0",
              isSelected ? "bg-primary text-primary-foreground" : "bg-muted",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {node.title}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {node.subtitle}
            </div>
          </div>
        </div>
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0 mt-1",
            node.status === "active" || node.status === "healthy"
              ? "bg-success"
              : "bg-warning",
          )}
        />
      </div>

      <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between text-xs font-mono text-muted-foreground">
        <span>{node.stats.throughput}</span>
        <span>{node.stats.pps}</span>
      </div>
    </div>
  );
}
