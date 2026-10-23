/**
 * Shared cluster scope (`STORAGE_KEYS.CLUSTER_SCOPE`) for pages that keep the
 * selection in component state: a cluster id, or `null` for all clusters.
 */
import { useCallback, useState } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';

export function readClusterScope(): number | null {
  const stored = Number(localStorage.getItem(STORAGE_KEYS.CLUSTER_SCOPE));
  return Number.isFinite(stored) && stored > 0 ? stored : null;
}

export function writeClusterScope(id: number | null): void {
  if (id === null) localStorage.removeItem(STORAGE_KEYS.CLUSTER_SCOPE);
  else localStorage.setItem(STORAGE_KEYS.CLUSTER_SCOPE, String(id));
}

export function useClusterScope(): [number | null, (id: number | null) => void] {
  const [scope, setScope] = useState<number | null>(readClusterScope);
  const update = useCallback((id: number | null) => {
    writeClusterScope(id);
    setScope(id);
  }, []);
  return [scope, update];
}
