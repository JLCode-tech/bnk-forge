import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { QUERY_STALE_TIME } from "@/lib/constants";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Fetch all modules across all projects in a single request.
 * Uses optimized backend endpoint to avoid N+1 queries.
 */
export function useDeployments(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["deployments", "all"],
    queryFn: () => api.getAllModules(),
    enabled: options?.enabled,
    staleTime: QUERY_STALE_TIME.DEFAULT, // 30 seconds
  });
}

/**
 * Fetch recent deployments (modules with last_deployed_at).
 * Shares the ['deployments', 'all'] query cache and filters/sorts via select.
 */
export function useRecentDeployments(limit: number = 10) {
  return useQuery({
    queryKey: ["deployments", "all"],
    queryFn: () => api.getAllModules(),
    select: (allModules) =>
      allModules
        .filter((module) => module.last_deployed_at)
        .sort((a, b) => {
          const dateA = new Date(a.last_deployed_at!).getTime();
          const dateB = new Date(b.last_deployed_at!).getTime();
          return dateB - dateA;
        })
        .slice(0, limit),
    staleTime: QUERY_STALE_TIME.DEFAULT, // 30 seconds
  });
}

export function useDeploymentStats() {
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: api.getProjects,
    select: (projects) => ({
      totalProjects: projects.length,
      activeModules: projects.reduce((sum, p) => sum + p.module_count, 0),
      deployedModules: projects.reduce((sum, p) => sum + p.deployed_count, 0),
      failedModules: projects.reduce((sum, p) => sum + p.failed_count, 0),
    }),
    staleTime: QUERY_STALE_TIME.DEFAULT,
  });
}
