/**
 * CNF Overview — High-level summary dashboard for F5 Cloud-Native Network Functions.
 *
 * Displays:
 * 1. KPI cards for DNS Services, Carrier-Grade NFs, Discovered CRDs, and Data-Plane status.
 * 2. Visual capability cards for DNS Express, CGNAT, Diameter Signaling, and Data Plane Graph.
 * 3. Quick action jump links to dedicated operational tabs.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Globe,
  Cpu,
  Layers,
  Network,
  Radio,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Zap,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CNFOverviewProps {
  clusterName?: string;
  crdsCount: number;
  dnsCachesCount: number;
  dnsAppsCount: number;
  dnsZonesCount: number;
  cnatCount: number;
  diameterCount: number;
  ipsCount: number;
  onNavigateTab: (tab: "dns" | "telco" | "network-graph") => void;
}

export function CNFOverview({
  clusterName: _clusterName,
  crdsCount,
  dnsCachesCount,
  dnsAppsCount,
  dnsZonesCount,
  cnatCount,
  diameterCount,
  ipsCount,
  onNavigateTab,
}: CNFOverviewProps) {
  const navigate = useNavigate();
  const totalDns = dnsCachesCount + dnsAppsCount + dnsZonesCount;
  const totalTelco = cnatCount + diameterCount + ipsCount;

  const [recsExpanded, setRecsExpanded] = useState(false);

  const recommendations = [
    ...(dnsCachesCount === 0 && dnsZonesCount === 0
      ? [
          {
            id: "dns-setup",
            title: "Configure DNS Express or DNS Cache",
            severity: "recommended",
            description:
              "No DNS cache or authoritative DNS Express zones detected on this cluster. Configure F5BigDnsCache or F5BigDnsZone for high-throughput L4/L7 DNS resolution.",
          },
        ]
      : []),
    ...(cnatCount === 0
      ? [
          {
            id: "cgnat-policy",
            title: "Define Carrier-Grade NAT (CGNAT) Policy",
            severity: "info",
            description:
              "Create an F5BigCnatPolicy resource if subscriber IPv4 address translation or dual-stack exhaustion mitigation is required.",
          },
        ]
      : []),
    ...(diameterCount === 0
      ? [
          {
            id: "diameter-policy",
            title: "Configure Diameter Signaling Routing (DRA/DEA)",
            severity: "info",
            description:
              "No F5BigDiameterPolicy instances detected. Add Diameter signaling policies if this cluster handles 4G/5G EPC telco signaling traffic.",
          },
        ]
      : []),
  ];

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full max-w-7xl mx-auto">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* DNS Services KPI */}
        <Card
          className="hover:border-primary/40 transition-colors cursor-pointer bg-card"
          onClick={() => onNavigateTab("dns")}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-foreground">
              DNS Services
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-info/10 flex items-center justify-center text-info">
              <Globe className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{totalDns}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {dnsCachesCount} Caches • {dnsAppsCount} Apps • {dnsZonesCount}{" "}
              Zones
            </p>
            <div className="mt-3 flex items-center text-xs text-primary font-medium">
              View DNS Express & Cache <ArrowRight className="h-3 w-3 ml-1" />
            </div>
          </CardContent>
        </Card>

        {/* Carrier-Grade NFs KPI */}
        <Card
          className="hover:border-primary/40 transition-colors cursor-pointer bg-card"
          onClick={() => onNavigateTab("telco")}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-foreground">
              Carrier-Grade NFs
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-warning/10 flex items-center justify-center text-warning">
              <Radio className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {totalTelco}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {cnatCount} CGNAT • {diameterCount} Diameter • {ipsCount} IPS
            </p>
            <div className="mt-3 flex items-center text-xs text-primary font-medium">
              View Telco Policies <ArrowRight className="h-3 w-3 ml-1" />
            </div>
          </CardContent>
        </Card>

        {/* Custom Resources KPI */}
        <Card
          className="hover:border-primary/40 transition-colors cursor-pointer bg-card"
          onClick={() => navigate("/crds")}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-foreground">
              Custom Resources
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-success/10 flex items-center justify-center text-success">
              <Layers className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {crdsCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Discovered & enriched schemas
            </p>
            <div className="mt-3 flex items-center text-xs text-primary font-medium">
              Open CR Explorer <ArrowRight className="h-3 w-3 ml-1" />
            </div>
          </CardContent>
        </Card>

        {/* Data-Plane Topology KPI */}
        <Card
          className="hover:border-primary/40 transition-colors cursor-pointer bg-card"
          onClick={() => onNavigateTab("network-graph")}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-foreground">
              Data Plane Topology
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Network className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {totalDns + totalTelco > 0 ? (
              <>
                <div className="text-2xl font-bold flex items-center gap-1.5 text-foreground">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
                  Active
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {totalDns + totalTelco} network function
                  {totalDns + totalTelco === 1 ? "" : "s"} in data plane graph
                </p>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold flex items-center gap-1.5 text-muted-foreground">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  Idle
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  0 network functions deployed on cluster
                </p>
              </>
            )}
            <div className="mt-3 flex items-center text-xs text-primary font-medium">
              View Data Plane Pipeline <ArrowRight className="h-3 w-3 ml-1" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Collapsible Recommendations (default collapsed) */}
      {recommendations.length > 0 && (
        <div className="rounded-lg border p-4 bg-card border-border">
          <button
            type="button"
            onClick={() => setRecsExpanded((prev) => !prev)}
            aria-expanded={recsExpanded}
            className="w-full flex items-center justify-between text-left"
          >
            <h3 className="font-semibold text-sm flex items-center gap-2">
              {recsExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <Zap className="h-4 w-4 text-primary" />
              <span>Recommendations</span>
              <Badge variant="outline" className="text-2xs ml-1">
                {recommendations.length}
              </Badge>
            </h3>
            <span className="text-xs text-muted-foreground">
              {recsExpanded ? "Click to collapse" : "Click to expand"}
            </span>
          </button>
          <div className={cn("space-y-3 mt-4", !recsExpanded && "hidden")}>
            {recommendations.map((rec) => (
              <div
                key={rec.id}
                className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-muted/50"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{rec.title}</span>
                    <Badge variant="outline" className="text-2xs">
                      {rec.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rec.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Operational Resources Breakdown */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-sm font-semibold text-foreground">
            Discovered CNF Services on Cluster
          </CardTitle>
          <CardDescription className="text-xs">
            Operational status of cloud-native network function instances
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {totalDns + totalTelco === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No F5 CNF resources (DNS Express, CGNAT, Diameter) are currently
              deployed on this cluster.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              <div className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-info/10 text-info">
                    <Globe className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      DNS Express & Cache
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      F5BigDnsApp, F5BigDnsCache, F5BigDnsZone
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">
                    {dnsAppsCount} apps • {dnsCachesCount} caches •{" "}
                    {dnsZonesCount} zones
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1"
                    onClick={() => onNavigateTab("dns")}
                  >
                    Manage <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-warning/10 text-warning">
                    <Cpu className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Carrier-Grade NAT (CGNAT)
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      F5BigCnatPolicy
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">
                    {cnatCount} active policies
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1"
                    onClick={() => onNavigateTab("telco")}
                  >
                    Manage <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Radio className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Diameter Signaling (DRA/DEA)
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      F5BigDiameterPolicy
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">
                    {diameterCount} active instances
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1"
                    onClick={() => onNavigateTab("telco")}
                  >
                    Manage <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
