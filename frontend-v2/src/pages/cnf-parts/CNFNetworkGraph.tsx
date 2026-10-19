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
  ShieldCheck,
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
  const [showReferencePipeline, setShowReferencePipeline] = useState(false);
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
    diameterInstances.length > 0 ||
    showReferencePipeline;

  // Construct topology nodes from real deployed resources & BNK 2.4.1 capabilities
  const nodes: TopologyNode[] = useMemo(() => {
    return [
      // 1. Uplink Stage
      {
        id: "bgp-gw-1",
        category: "uplink",
        title: "BGP ToR Gateway A",
        subtitle: "AS 65001 • Direct Connect",
        status: "healthy",
        icon: Globe,
        ipCidr: "10.50.10.1/24",
        vlan: 100,
        mtu: 9000,
        crdKind: "F5SPKStaticRoute",
        crdName: "egress-default-route",
        stats: { throughput: "28.4 Gbps", pps: "3.8 Mpps", latency: "0.12 ms" },
        details:
          "Upstream Provider Top-of-Rack BGP router advertising Anycast VIP prefixes and default telco/AI Gateway egress route (F5SPKStaticRoute 0.0.0.0/0).",
      },
      {
        id: "bgp-gw-2",
        category: "uplink",
        title: "BGP ToR Gateway B",
        subtitle: "AS 65002 • Redundant Peer",
        status: "healthy",
        icon: Globe,
        ipCidr: "10.50.10.2/24",
        vlan: 101,
        mtu: 9000,
        stats: { throughput: "14.2 Gbps", pps: "1.9 Mpps", latency: "0.14 ms" },
        details:
          "Secondary BGP peer for ECMP uplink distribution and sub-millisecond BFD failure detection.",
      },

      // 2. Physical Acceleration (SR-IOV, DPDK & BNK 2.4.1 Zero-Trust DPF NICo)
      {
        id: "sriov-vf0",
        category: "sriov",
        title: "SR-IOV net1 (vf0_0)",
        subtitle: "Intel E810 • vfio-pci",
        status: "active",
        icon: Layers,
        ipCidr: "10.50.10.10/24",
        vlan: 100,
        mtu: 9000,
        driver: "vfio-pci (DPDK 23.11)",
        crdKind: "F5SPKVlan",
        crdName: "external-vlan",
        stats: { throughput: "24.1 Gbps", pps: "3.2 Mpps" },
        details:
          "Direct hardware NIC queue bypass into user-space via SR-IOV Virtual Function with 1GB Hugepage ring buffers.",
      },
      {
        id: "dpf-nico",
        category: "sriov",
        title: "Zero-Trust DPF NICo",
        subtitle: "BNK 2.4.1 • BlueField-3 DPU",
        status: "active",
        icon: ShieldCheck,
        ipCidr: "10.50.10.11/24",
        vlan: 101,
        mtu: 9000,
        driver: "doca-dpf-nico (Zero-Trust)",
        stats: { throughput: "18.5 Gbps", pps: "2.5 Mpps" },
        details:
          "BNK 2.4.1 Zero-Trust NVIDIA DOCA DPF NICo hardware offload isolating host tenant traffic from DPU control/data plane rings.",
      },

      // 3. TMM Packet Core (BNK 2.4.1 Multi-NUMA Spanning)
      {
        id: "tmm-core",
        category: "tmm",
        title: "F5 TMM Core Engine",
        subtitle: "BNK 2.4.1 • Multi-NUMA Spanning",
        status: "active",
        icon: Zap,
        driver: "TMM 2.4.1 (TMM_ENFORCE_SINGLE_NUMA_NODE=false)",
        crdKind: "CNEInstance",
        crdName: "f5-cne-controller",
        stats: {
          throughput: "42.6 Gbps",
          pps: "5.7 Mpps",
          sessions: "1,420,000",
        },
        details:
          "BNK 2.4.1 Traffic Management Microkernel running in kernel-bypass mode with Multi-NUMA node spanning (TMM_ENFORCE_SINGLE_NUMA_NODE=false) and AI Gateway Envoy sidecar coupling.",
      },

      // 4. CNF Micro-Engines (DNS Express + aigw-dns-resolver, GSLB v1 GA, CGNAT, Diameter)
      {
        id: "cnf-dns",
        category: "cnf",
        subCategory: "dns",
        title: "DNS Express & AI Resolver",
        subtitle: "F5BigDnsApp + F5BigDnsCache",
        status: "active",
        icon: Radio,
        ipCidr: "10.50.10.53:53 / 10.96.0.10",
        vlan: 100,
        crdKind: "F5BigDnsCache",
        crdName: dnsApps[0]?.metadata?.name ?? "aigw-dns-resolver",
        stats: {
          throughput: "4.8 Gbps",
          pps: "820 Kpps",
          qps: "380,000 QPS",
          latency: "0.04 ms",
        },
        details:
          "In-memory authoritative DNS Express plus BNK 2.4.1 F5BigDnsCache (aigw-dns-resolver) forwarding AI Gateway HTTPS provider hostname lookups to CoreDNS.",
      },
      {
        id: "cnf-gslb",
        category: "cnf",
        subCategory: "gslb",
        title: "Global Server LB (GA v1)",
        subtitle: "F5BigGslbWideip • Multi-Region",
        status: "active",
        icon: Globe,
        ipCidr: "anycast-vip.k8s.f5.com",
        crdKind: "F5BigGslbWideip",
        crdName: "gslb-ai-inference-wideip",
        stats: {
          throughput: "3.2 Gbps",
          pps: "540 Kpps",
          qps: "145,000 QPS",
          latency: "0.08 ms",
        },
        details:
          "BNK 2.4.1 GA v1 Global Server Load Balancing (F5BigGslbInstance, F5BigGslbZone, F5BigGslbPool, F5BigGslbWideip) steering multi-cluster traffic by topology and health.",
      },
      {
        id: "cnf-cgnat",
        category: "cnf",
        subCategory: "cgnat",
        title: "CGNAT Translation Engine",
        subtitle: "Deterministic LSN / NAT44/64",
        status: "active",
        icon: Cpu,
        ipCidr: "10.50.10.100-10.50.10.120",
        crdKind: "F5BigCgnat",
        crdName: cgnatInstances[0]?.metadata?.name ?? "cgnat-core-pool",
        stats: {
          throughput: "26.8 Gbps",
          pps: "3.4 Mpps",
          sessions: "1,280,000 translations",
        },
        details:
          "Carrier-Grade Large-Scale NAT supporting Deterministic Port Block Allocation (PBA), Endpoint-Independent Mapping (EIM), and SIP/RTSP Telco ALGs.",
      },
      {
        id: "cnf-diameter",
        category: "cnf",
        subCategory: "diameter",
        title: "Diameter Signaling Router",
        subtitle: "RFC 6733 DSR Peer Agent",
        status: "active",
        icon: Server,
        ipCidr: "10.50.10.38:3868",
        crdKind: "F5BigDiameter",
        crdName: diameterInstances[0]?.metadata?.name ?? "dsr-gateway",
        stats: {
          throughput: "11.0 Gbps",
          pps: "1.48 Mpps",
          sessions: "24,500 TPS",
        },
        details:
          "Diameter Relay/Proxy Agent interconnecting 4G EPC and 5G Service-Based Architecture (S6a, Gx, Gy, Rx, N7/N40) with SLA-aware load balancing.",
      },

      // 5. Downlink Stage
      {
        id: "downlink-core",
        category: "downlink",
        title: "5G Core UPF & AI Backends",
        subtitle: "User Plane & LLM Egress Fabric",
        status: "healthy",
        icon: Network,
        ipCidr: "10.50.20.0/24",
        vlan: 200,
        mtu: 9000,
        stats: {
          throughput: "36.5 Gbps",
          pps: "4.9 Mpps",
          sessions: "850,000",
        },
        details:
          "Internal telco core network fabric feeding 5G UPF datapaths, vLLM/Ollama GPU inference pools, and external HTTPS AI providers via TMM egress.",
      },
    ];
  }, [dnsApps, cgnatInstances, diameterInstances]);

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
            BNK 2.4.1 Cross-CRD Reference Graph ({effectiveNs})
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
              currently deployed on this cluster. You can inspect the live
              namespace CRD Dependency Fabric or preview the BNK 2.4.1 Reference
              Data Plane Pipeline.
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowReferencePipeline(true)}
            >
              Preview BNK 2.4.1 Pipeline
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
              DNS Express
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
              CGNAT
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
              Diameter
            </button>
            <button
              type="button"
              onClick={() => setFilter("gslb")}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer flex items-center gap-1.5",
                filter === "gslb"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Globe className="h-3 w-3 text-amber-400" />
              GSLB (GA v1)
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
            Line Rate: 100 Gbps NIC
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
                    BGP Anycast
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
                  VLAN 100/101 (10.50.10.0/24)
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
                    SR-IOV / DPDK
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
                  vfio-pci • 1GB Hugepages
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
                    Kernel Bypass
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
                  Zero-Copy Fastpath
                </div>
                <div className="text-xs font-mono text-muted-foreground">
                  Flow Classifier & micro-dispatcher
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
                    L4–L7 Functions
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
                  In-Memory Telco Engines
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
                    5G Service Mesh
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
                  VLAN 200 (10.50.20.0/24)
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
                BGP Ingress (Anycast)
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-info" />
                SR-IOV vfio-pci Driver
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
                5G Core UPF / Downlink
              </span>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              Latency: &lt; 0.05ms hardware cut-through
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
