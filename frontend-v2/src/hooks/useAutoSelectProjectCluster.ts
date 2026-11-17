import { useEffect, useRef } from 'react';

interface AutoSelectOptions {
  projects: { id: number }[] | undefined;
  allClusters: { id: number; project_id: number }[];
  visibleClusters: { id: number }[];
  selectedProject: number | null;
  selectedCluster: number | null;
  setSelectedProject: (id: number) => void;
  setSelectedCluster: (id: number) => void;
  enabled?: boolean;
}

/**
 * Auto-selects the single project and cluster when exactly one of each exists
 * and nothing is currently selected on initial load.
 * Subsequent user selections (e.g. choosing "All Clusters" or "All Projects")
 * will not be overridden.
 * Used by KubernetesV2, F5BNK, CNF, and CRExplorer pages.
 */
export function useAutoSelectProjectCluster({
  projects,
  allClusters,
  visibleClusters,
  selectedProject,
  selectedCluster,
  setSelectedProject,
  setSelectedCluster,
  enabled = true,
}: AutoSelectOptions) {
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (!enabled || hasInitializedRef.current) return;
    if (!projects || allClusters.length === 0) return;

    hasInitializedRef.current = true;

    if (!selectedProject && !selectedCluster && projects.length === 1 && allClusters.length === 1) {
      setSelectedProject(projects[0].id);
      setSelectedCluster(allClusters[0].id);
    } else if (selectedProject && !selectedCluster && allClusters.length === 1 && visibleClusters.length === 1) {
      setSelectedCluster(visibleClusters[0].id);
    }
  }, [
    enabled,
    projects,
    allClusters,
    visibleClusters,
    selectedProject,
    selectedCluster,
    setSelectedProject,
    setSelectedCluster,
  ]);
}

