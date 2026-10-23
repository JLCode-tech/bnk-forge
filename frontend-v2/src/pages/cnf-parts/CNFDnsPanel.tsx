/**
 * CNF DNS Services Panel — Dedicated dashboard for DNS Express & Cache.
 *
 * Manages and displays:
 * - F5BigDnsCache: High-performance caching resolver with DNSSEC and forwarders
 * - F5BigDnsApp: DNS listeners binding VIPs on port 53 to caches or zones
 * - F5BigDnsZone: In-memory authoritative DNS Express zones
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Globe, Eye, Plus, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAge } from "@/lib/time-utils";
import { getSeverityConfig } from "@/lib/health-severity";
import { severityFromConditions } from "./severity";
import type { K8sResource, K8sCondition } from "@/types/kubernetes";

interface CNFDnsPanelProps {
  caches: K8sResource[];
  apps: K8sResource[];
  zones: K8sResource[];
  isLoading: boolean;
  selectedResource: K8sResource | null;
  onSelectResource: (resource: K8sResource) => void;
  onDescribe: (resource: K8sResource) => void;
  onCreateResource?: (resourceType: string) => void;
  onEditResource?: (resource: K8sResource, resourceType: string) => void;
  onDeleteResource?: (resource: K8sResource, resourceType: string) => void;
  searchQuery: string;
  onSearchChange?: (query: string) => void;
  borderDefault: string;
}

type DnsFilter = "all" | "caches" | "apps" | "zones";

const DNS_CATEGORY_RESOURCE_TYPE: Record<"cache" | "app" | "zone", string> = {
  cache: "f5bigdnsresolvercaches",
  app: "f5bigdnsapps",
  zone: "f5bigdnszones",
};

export function CNFDnsPanel({
  caches,
  apps,
  zones,
  isLoading,
  selectedResource,
  onSelectResource,
  onDescribe,
  onCreateResource,
  onEditResource,
  onDeleteResource,
  searchQuery,
  borderDefault,
}: CNFDnsPanelProps) {
  const [activeFilter, setActiveFilter] = useState<DnsFilter>("all");

  // Combine resources based on filter
  const allDnsResources = useMemo(() => {
    let list: { item: K8sResource; kindCategory: "cache" | "app" | "zone" }[] =
      [];
    if (activeFilter === "all" || activeFilter === "caches") {
      list = list.concat(
        caches.map((c) => ({ item: c, kindCategory: "cache" })),
      );
    }
    if (activeFilter === "all" || activeFilter === "apps") {
      list = list.concat(apps.map((a) => ({ item: a, kindCategory: "app" })));
    }
    if (activeFilter === "all" || activeFilter === "zones") {
      list = list.concat(zones.map((z) => ({ item: z, kindCategory: "zone" })));
    }

    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (entry) =>
        entry.item.metadata?.name?.toLowerCase().includes(q) ||
        entry.item.metadata?.namespace?.toLowerCase().includes(q) ||
        entry.item.kind?.toLowerCase().includes(q),
    );
  }, [caches, apps, zones, activeFilter, searchQuery]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* DNS Subheader & Filter Bar */}
      <div
        className={cn(
          "p-4 border-b flex flex-wrap items-center justify-between gap-3 bg-card/60",
          borderDefault,
        )}
      >
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border/50">
          <button
            onClick={() => setActiveFilter("all")}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              activeFilter === "all"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            All DNS ({caches.length + apps.length + zones.length})
          </button>
          <button
            onClick={() => setActiveFilter("caches")}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
              activeFilter === "caches"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-info" />
            Caches ({caches.length})
          </button>
          <button
            onClick={() => setActiveFilter("apps")}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
              activeFilter === "apps"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Listeners / Apps ({apps.length})
          </button>
          <button
            onClick={() => setActiveFilter("zones")}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
              activeFilter === "zones"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Express Zones ({zones.length})
          </button>
        </div>

        {onCreateResource && (
          <div className="flex items-center gap-1.5">
            {(activeFilter === "all" || activeFilter === "caches") && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs gap-1"
                onClick={() => onCreateResource("f5bigdnsresolvercaches")}
              >
                <Plus className="h-3.5 w-3.5" />
                Cache
              </Button>
            )}
            {(activeFilter === "all" || activeFilter === "apps") && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs gap-1"
                onClick={() => onCreateResource("f5bigdnsapps")}
              >
                <Plus className="h-3.5 w-3.5" />
                Listener
              </Button>
            )}
            {(activeFilter === "all" || activeFilter === "zones") && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs gap-1"
                onClick={() => onCreateResource("f5bigdnszones")}
              >
                <Plus className="h-3.5 w-3.5" />
                Zone
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4">
            <SkeletonTable rows={5} columns={5} />
          </div>
        ) : allDnsResources.length === 0 ? (
          <div className="p-8 text-center max-w-lg mx-auto my-12 space-y-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <Globe className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">
                No DNS Resources Found
              </h3>
              <p className="text-xs text-muted-foreground">
                No F5BigDnsCache, F5BigDnsApp, or F5BigDnsZone instances were
                discovered in the selected namespace.
              </p>
            </div>
            <div className="p-3 bg-muted/40 rounded-lg text-left text-xs text-muted-foreground font-mono space-y-2 border border-border/50">
              <p className="font-semibold text-foreground">
                Quick Deployment Sample:
              </p>
              <pre className="text-2xs overflow-x-auto p-2 bg-card rounded border border-border/40">
                {`apiVersion: k8s.f5net.com/v1
kind: F5BigDnsCache
metadata:
  name: dns-cache-forwarder
  namespace: default
spec:
  resolver:
    forwarders:
      - 1.1.1.1
      - 8.8.8.8
    dnssec: enabled
    msgCacheSize: 1048576`}
              </pre>
            </div>
          </div>
        ) : (
          <Table className="w-full">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow
                className={cn(
                  "text-xs border-b text-muted-foreground",
                  borderDefault,
                )}
              >
                <TableHead className="py-3 px-4 font-medium text-muted-foreground">
                  Name
                </TableHead>
                <TableHead className="py-3 px-4 font-medium text-muted-foreground">
                  Kind
                </TableHead>
                <TableHead className="py-3 px-4 font-medium text-muted-foreground">
                  Namespace
                </TableHead>
                <TableHead className="py-3 px-4 font-medium text-muted-foreground">
                  Configuration Details
                </TableHead>
                <TableHead className="py-3 px-4 font-medium text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="py-3 px-4 font-medium text-muted-foreground">
                  Age
                </TableHead>
                <TableHead className="text-right py-3 px-4 font-medium w-32 text-muted-foreground">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allDnsResources.map(({ item: resource, kindCategory }) => {
                const conditions = resource.status?.conditions as
                  | K8sCondition[]
                  | undefined;
                const severity = severityFromConditions(conditions);
                const severityConfig = getSeverityConfig(severity);
                const SeverityIcon = severityConfig.icon;
                const resourceType = DNS_CATEGORY_RESOURCE_TYPE[kindCategory];

                // Extract friendly details based on kind
                const spec = (resource as { spec?: Record<string, unknown> })
                  .spec;
                let detailsSummary = "";
                if (kindCategory === "cache") {
                  const forwarders = (
                    spec?.resolver as { forwarders?: string[] }
                  )?.forwarders;
                  detailsSummary = forwarders?.length
                    ? `Forwarders: ${forwarders.join(", ")}`
                    : "Local recursive resolver";
                } else if (kindCategory === "app") {
                  const vip =
                    (spec?.destination as string) ||
                    (spec?.vip as string) ||
                    "Port 53";
                  detailsSummary = `VIP: ${vip}`;
                } else if (kindCategory === "zone") {
                  const zoneName =
                    (spec?.zoneName as string) ||
                    resource.metadata?.name ||
                    "Authoritative";
                  detailsSummary = `Zone: ${zoneName}`;
                }

                return (
                  <TableRow
                    key={resource.metadata?.uid ?? resource.metadata?.name}
                    className={cn(
                      "border-b cursor-pointer transition-colors hover:bg-muted/50",
                      borderDefault,
                      selectedResource?.metadata?.uid ===
                        resource.metadata?.uid && "bg-primary/10",
                    )}
                    onClick={() => onSelectResource(resource)}
                  >
                    <TableCell className="py-3 px-4">
                      <code className="text-sm font-mono text-foreground font-medium">
                        {resource.metadata?.name}
                      </code>
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      <Badge
                        variant={
                          kindCategory === "cache"
                            ? "info"
                            : kindCategory === "app"
                              ? "default"
                              : "success"
                        }
                        className="text-2xs font-normal"
                      >
                        {resource.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      <Badge variant="outline" className="text-xs">
                        {resource.metadata?.namespace || "cluster-wide"}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      <span className="text-xs text-muted-foreground truncate max-w-xs block font-mono">
                        {detailsSummary}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      <div
                        className={cn(
                          "flex items-center gap-1.5 text-xs font-medium",
                          severityConfig.color,
                        )}
                      >
                        <SeverityIcon className="h-3.5 w-3.5" />
                        {severityConfig.label}
                      </div>
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      <span className="text-xs text-muted-foreground">
                        {formatAge(resource.metadata?.creationTimestamp)}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          aria-label="View details"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDescribe(resource);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {onEditResource && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            aria-label={`Edit ${resource.metadata?.name ?? "resource"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditResource(resource, resourceType);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {onDeleteResource && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            aria-label={`Delete ${resource.metadata?.name ?? "resource"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteResource(resource, resourceType);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
