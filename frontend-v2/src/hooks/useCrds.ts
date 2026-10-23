/**
 * useCrds — React Query hook for CRD discovery (D-018 P1).
 *
 * Fetches all installed CRDs for a cluster via GET /api/k8s/clusters/{id}/crds.
 * Gated on cluster reachability via useClusterReachable (same pattern as
 * useClusterResources / useClusterNamespaces).
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { useClusterReachable } from "@/hooks/useConnectivity";
import type { components } from "@/types/api-generated";

export type CrdListEnvelope = components["schemas"]["CrdListEnvelope"];
export type CRDInfo = components["schemas"]["CRDInfo"];

export interface CrdSchemaResponse {
  name: string;
  kind: string;
  plural: string;
  singular?: string | null;
  group: string;
  version?: string | null;
  scope: string;
  short_names: string[];
  versions: string[];
  open_apiv3_schema: Record<string, unknown>;
  additional_printer_columns: Array<{
    name: string;
    type: string;
    json_path: string;
    description?: string | null;
  }>;
  conditions: Array<Record<string, unknown>>;
}

export function useCrds(
  clusterId: number,
  options?: { enabled?: boolean; group?: string[] },
) {
  const reachable = useClusterReachable(clusterId);
  return useQuery({
    queryKey: queryKeys.k8s.clusters.crds(
      clusterId,
      options?.group ? { group: options.group } : undefined,
    ),
    queryFn: () =>
      api.getCrds(
        clusterId,
        options?.group ? { group: options.group } : undefined,
      ),
    enabled: options?.enabled !== false && !!clusterId && reachable,
    staleTime: 30_000,
  });
}

export function useCrdSchema(
  clusterId: number,
  crdName: string | null,
  version?: string,
  options?: { enabled?: boolean },
) {
  const reachable = useClusterReachable(clusterId);
  return useQuery<CrdSchemaResponse>({
    queryKey: [
      "k8s",
      "clusters",
      clusterId,
      "crd-schema",
      crdName,
      version ?? "default",
    ],
    queryFn: () => api.getCrdSchema(clusterId, crdName ?? "", version),
    enabled:
      options?.enabled !== false && !!clusterId && !!crdName && reachable,
    staleTime: 60_000,
  });
}
