"""
CRD discovery route (D-018, P1).

GET /api/k8s/clusters/{cluster_id}/crds
  — lists CRDs installed in the cluster, merged with the static registry.
"""

import logging
import time
from threading import Lock

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.errors import handle_route_errors
from database import get_db
from routes.auth import require_viewer
from schemas.k8s import CrdListEnvelope, CrdSchemaResponse
from services.crd_discovery_service import CrdDiscoveryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["k8s-crds"])

_CRD_LIST_TTL_SEC = 60
_crd_list_cache: dict[tuple[int, tuple[str, ...]], tuple[float, dict]] = {}
_crd_list_lock = Lock()


@router.get(
    "/k8s/clusters/{cluster_id}/crds",
    response_model=CrdListEnvelope,
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("discover CRDs")
def get_cluster_crds(
    cluster_id: int,
    group: list[str] = Query(default=[]),
    db: Session = Depends(get_db),
):
    """Return CRDs installed in the cluster.

    Optional ``?group=`` query parameter (repeatable) filters results to one
    or more API groups.  Filter is applied in Python after the per-cluster
    cache read.

    - Reachable cluster, CRDs found → 200 with populated ``crds``.
    - Reachable cluster, no CRDs match filter → 200 with empty ``crds`` and
      non-null ``info`` describing why (not an error).
    - Cluster unreachable / apiextensions API failure → 503
      ``code=NETWORK_UNREACHABLE`` (never a 200 with empty list).
    """
    from core.cache import cache

    group_tuple = tuple(sorted(group)) if group else ()
    redis_key = (
        f"k8s:crd_list:{cluster_id}" if not group_tuple else f"k8s:crd_list:{cluster_id}:{','.join(group_tuple)}"
    )
    cached_redis = cache.get(redis_key)
    if cached_redis is not None:
        return cached_redis

    cache_key = (cluster_id, group_tuple)
    if not cache.is_available():
        now_mono = time.monotonic()
        with _crd_list_lock:
            cached = _crd_list_cache.get(cache_key)
            if cached and (now_mono - cached[0]) < _CRD_LIST_TTL_SEC:
                return cached[1]

    svc = CrdDiscoveryService(db)
    res = svc.list_crds(cluster_id, group_filter=group if group else None)
    payload = res.model_dump(mode="json") if hasattr(res, "model_dump") else res

    if not cache.set(redis_key, payload, _CRD_LIST_TTL_SEC):
        write_mono = time.monotonic()
        with _crd_list_lock:
            stale_cutoff = write_mono - _CRD_LIST_TTL_SEC
            for key in [k for k, (t, _) in _crd_list_cache.items() if t < stale_cutoff]:
                _crd_list_cache.pop(key, None)
            _crd_list_cache[cache_key] = (write_mono, payload)

    return res


@router.get(
    "/k8s/clusters/{cluster_id}/crds/{crd_name}/schema",
    response_model=CrdSchemaResponse,
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get CRD schema")
def get_cluster_crd_schema(
    cluster_id: int,
    crd_name: str,
    version: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Return the openAPIV3Schema, additionalPrinterColumns, shortNames, and status.conditions for a CRD."""
    svc = CrdDiscoveryService(db)
    return svc.get_crd_schema(cluster_id, crd_name, version=version)
