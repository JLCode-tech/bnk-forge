/**
 * Re-export from canonical hooks/k8s/useClusterCRUD and hooks/k8s/useBnk.
 * Prevents duplicate React Query cache keys and tab-visibility desync.
 */
export {
  useK8sResourceTypes,
  useAllClusters,
  useProjectClusters,
  useCluster,
  useCreateCluster,
  useUpdateCluster,
  useDeleteCluster,
  useTestClusterConnection,
  useClusterNamespaces,
  useDetectClusters,
  useDetectEKSClusters,
  useAddDetectedClusters,
  useRefreshClusterKubeconfig,
  useClusterConnectivity,
  useBatchConnectivity,
  useClusterResources,
  useClusterResourceSummary,
} from "./k8s/useClusterCRUD";

export {
  useAssignBnkClusterMembers,
  useCreateBnkClusterConfig,
  useConfigureBnkCluster,
} from "./k8s/useBnk";
