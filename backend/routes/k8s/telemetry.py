"""
Kubernetes Cluster Telemetry Routes (Strangler Facade).

Provides unified telemetry and analytical metrics for clusters:
- In Push Mode: Reads eBPF socket flows, TMM DPDK metrics, and drift alerts from ClickHouse.
- In Pull Mode (Fallback): Gracefully returns legacy connectivity metadata.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.errors import handle_route_errors
from database import get_db
from routes.auth import require_viewer
from services.cluster_provider import ClusterDataProvider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["k8s-telemetry"])


@router.get(
    "/k8s/clusters/{cluster_id}/telemetry/summary",
    response_model=dict[str, Any],
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get cluster telemetry summary")
def get_cluster_telemetry_summary(
    cluster_id: str,
    hours: int = Query(1, ge=1, le=168, description="Time window in hours"),
    db: Session = Depends(get_db),
):
    """Retrieve unified cluster telemetry summary via the Strangler facade."""
    provider = ClusterDataProvider(db)
    return provider.get_cluster_telemetry(cluster_ident=cluster_id, hours=hours)


@router.get(
    "/k8s/clusters/{cluster_id}/telemetry/flows",
    response_model=dict[str, Any],
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get cluster pod flows")
def get_cluster_pod_flows(
    cluster_id: str,
    hours: int = Query(1, ge=1, le=168, description="Time window in hours"),
    namespace: str | None = Query(None, description="Filter by Kubernetes namespace"),
    pod_name: str | None = Query(None, description="Filter by pod name"),
    limit: int = Query(50, ge=1, le=500, description="Max flows to return"),
    db: Session = Depends(get_db),
):
    """Query recent eBPF socket flows and top talkers for a cluster."""
    provider = ClusterDataProvider(db)
    return provider.get_pod_flows(
        cluster_ident=cluster_id,
        hours=hours,
        namespace=namespace,
        pod_name=pod_name,
        limit=limit,
    )


@router.get(
    "/k8s/clusters/{cluster_id}/telemetry/tmm",
    response_model=dict[str, Any],
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get cluster TMM metrics")
def get_cluster_tmm_metrics(
    cluster_id: str,
    hours: int = Query(1, ge=1, le=168, description="Time window in hours"),
    db: Session = Depends(get_db),
):
    """Query F5 BIG-IP Next TMM DPDK microkernel metrics (RX/TX drops, ring occupancy, CPU)."""
    provider = ClusterDataProvider(db)
    return provider.get_tmm_metrics(
        cluster_ident=cluster_id,
        hours=hours,
    )


@router.get(
    "/k8s/clusters/{cluster_id}/telemetry/drift",
    response_model=dict[str, Any],
    dependencies=[Depends(require_viewer)],
)
@handle_route_errors("get cluster drift violations")
def get_cluster_drift_violations(
    cluster_id: str,
    hours: int = Query(24, ge=1, le=168, description="Time window in hours"),
    limit: int = Query(50, ge=1, le=200, description="Max violations to return"),
    db: Session = Depends(get_db),
):
    """Query Day 2 architectural drift violations where pod traffic bypassed BNK TMM ingress."""
    provider = ClusterDataProvider(db)
    return provider.get_drift_violations(
        cluster_ident=cluster_id,
        hours=hours,
        limit=limit,
    )
