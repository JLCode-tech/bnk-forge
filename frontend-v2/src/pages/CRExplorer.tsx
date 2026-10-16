/**
 * CR Explorer — Dedicated Custom Resource Definition (CRD) Explorer (/crds).
 *
 * Provides cluster-scoped CRD browsing, schema inspection, YAML creation/editing,
 * and CRD relationship topology with standard right-aligned Workspace & Cluster selectors.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { useProjects } from "@/hooks/useProjects";
import { useAllClusters } from "@/hooks/useK8sClusters";
import { useAutoSelectProjectCluster } from "@/hooks/useAutoSelectProjectCluster";
import { ResourceExplorerLayout } from "@/components/layout/ResourceExplorerLayout";
import { ResourcePageHeader } from "@/components/layout/ResourcePageHeader";
import { ClusterScopePickerCard } from "@/components/k8s/ClusterScopePickerCard";
import { K8sCrdExplorerPanel } from "./kubernetes/K8sCrdExplorerPanel";

export default function CRExplorer() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const crdParam = searchParams.get("crd");

  const { data: projects = [] } = useProjects();
  const { data: allClustersResponse } = useAllClusters();
  const allClusters = useMemo(
    () => allClustersResponse?.clusters ?? [],
    [allClustersResponse?.clusters],
  );

  const [selectedProject, setSelectedProject] = useState<number | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.K8S_PROJECT);
    return saved ? parseInt(saved, 10) : null;
  });

  const visibleClusters = useMemo(() => {
    if (!selectedProject) return allClusters;
    return allClusters.filter((c) => c.project_id === selectedProject);
  }, [selectedProject, allClusters]);

  const [selectedCluster, setSelectedCluster] = useState<number | null>(() => {
    const fromUrl = searchParams.get("cluster");
    if (fromUrl) {
      const parsed = parseInt(fromUrl, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        localStorage.setItem(STORAGE_KEYS.CLUSTER_SCOPE, String(parsed));
        return parsed;
      }
    }
    const saved = localStorage.getItem(STORAGE_KEYS.CLUSTER_SCOPE);
    return saved ? parseInt(saved, 10) : null;
  });

  useEffect(() => {
    const urlCluster = searchParams.get("cluster");
    if (urlCluster) {
      const parsed = parseInt(urlCluster, 10);
      if (!Number.isNaN(parsed) && parsed > 0 && parsed !== selectedCluster) {
        setSelectedCluster(parsed);
        localStorage.setItem(STORAGE_KEYS.CLUSTER_SCOPE, String(parsed));
      }
    }
  }, [searchParams, selectedCluster]);

  useEffect(() => {
    if (selectedCluster && selectedProject && visibleClusters.length > 0) {
      const exists = visibleClusters.some((c) => c.id === selectedCluster);
      if (!exists) {
        setSelectedProject(null);
        localStorage.removeItem(STORAGE_KEYS.K8S_PROJECT);
      }
    }
  }, [selectedCluster, selectedProject, visibleClusters]);

  useAutoSelectProjectCluster({
    projects,
    allClusters,
    visibleClusters,
    selectedProject,
    selectedCluster,
    setSelectedProject,
    setSelectedCluster,
  });

  const handleProjectChange = useCallback((projectId: number | null) => {
    setSelectedProject(projectId);
    if (projectId) {
      localStorage.setItem(STORAGE_KEYS.K8S_PROJECT, String(projectId));
    } else {
      localStorage.removeItem(STORAGE_KEYS.K8S_PROJECT);
    }
  }, []);

  const handleClusterChange = useCallback((clusterId: number | null) => {
    setSelectedCluster(clusterId);
    if (clusterId) {
      localStorage.setItem(STORAGE_KEYS.CLUSTER_SCOPE, String(clusterId));
    } else {
      localStorage.removeItem(STORAGE_KEYS.CLUSTER_SCOPE);
    }
  }, []);

  const isFetchingCrds =
    useIsFetching({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === "k8s" &&
        q.queryKey[1] === "clusters" &&
        q.queryKey[2] === selectedCluster,
    }) > 0;

  const handleRefresh = () => {
    if (!selectedCluster) return;
    queryClient.invalidateQueries({
      queryKey: ["k8s", "clusters", selectedCluster],
    });
  };

  return (
    <ResourceExplorerLayout>
      <ResourcePageHeader
        title="CR Explorer"
        subtitle="Browse installed Custom Resource Definitions, inspect schemas, view topology, and manage live CR instances"
        projects={projects}
        selectedProjectId={selectedProject}
        onProjectChange={handleProjectChange}
        clusters={visibleClusters}
        selectedClusterId={selectedCluster}
        onClusterChange={handleClusterChange}
        allowAllClusters={true}
        namespaces={[]}
        selectedNamespace="all"
        onNamespaceChange={() => {}}
        searchQuery=""
        onSearchChange={() => {}}
        onRefresh={selectedCluster ? handleRefresh : undefined}
        isRefreshing={isFetchingCrds}
      />

      <ResourceExplorerLayout.Body>
        {!selectedCluster ? (
          <ResourceExplorerLayout.Content className="p-6 overflow-y-auto">
            <ClusterScopePickerCard
              title="Custom Resources by Cluster"
              description="Select a cluster to browse its Custom Resource Definitions (CRDs), schemas, and live instances."
              clusters={visibleClusters}
              onSelectCluster={(id) => handleClusterChange(id)}
              actionLabel="Open CR Explorer"
            />
          </ResourceExplorerLayout.Content>
        ) : (
          <ResourceExplorerLayout.Content className="overflow-hidden flex flex-col">
            <K8sCrdExplorerPanel
              clusterId={selectedCluster}
              initialCrd={crdParam}
            />
          </ResourceExplorerLayout.Content>
        )}
      </ResourceExplorerLayout.Body>
    </ResourceExplorerLayout>
  );
}
