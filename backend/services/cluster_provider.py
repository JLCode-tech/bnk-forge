"""
Cluster Data Provider Facade (Strangler Pattern Migration).

Dynamically switches telemetry, monitoring, and cluster health between:
1. PUSH PATH (Target PoV): Outbound Go agent streaming to ClickHouse & NATS
2. FALLBACK PULL PATH (Legacy): Kubernetes direct pull / Redis / Postgres cache
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from core.errors import NotFoundError
from models.kubernetes import KubernetesCluster
from models.operator import ConnectedOperator
from services.base_service import BaseService
from services.clickhouse_client import ClickHouseClient

logger = logging.getLogger(__name__)

# Heartbeat freshness window (seconds). Agents ping every 15s.
AGENT_HEARTBEAT_THRESHOLD_SECONDS = 90


class ClusterDataProvider(BaseService):
    """Strangler facade routing cluster queries between Agent Push and Legacy Pull engines."""

    def __init__(
        self,
        db: Session,
        clickhouse_client: ClickHouseClient | None = None,
    ):
        super().__init__(db)
        self.ch = clickhouse_client or ClickHouseClient()

    def resolve_cluster(self, cluster_ident: int | str) -> KubernetesCluster:
        """Resolve a cluster by integer ID, string ID, or UUID in meta_data."""
        # 1. Try integer ID
        if isinstance(cluster_ident, int) or (isinstance(cluster_ident, str) and cluster_ident.isdigit()):
            cluster = self.db.query(KubernetesCluster).filter(KubernetesCluster.id == int(cluster_ident)).first()
            if cluster:
                return cluster

        # 2. Try cluster_uuid in meta_data or name
        ident_str = str(cluster_ident)
        clusters = self.db.query(KubernetesCluster).all()
        for c in clusters:
            meta = c.meta_data or {}
            if meta.get("cluster_uuid") == ident_str:
                return c
            if c.name == ident_str:
                return c

        raise NotFoundError("cluster", cluster_ident)

    def get_cluster_uuid(self, cluster: KubernetesCluster) -> str:
        """Get or lazily generate and persist a canonical cluster UUID."""
        meta = cluster.meta_data or {}
        if "cluster_uuid" in meta and meta["cluster_uuid"]:
            return meta["cluster_uuid"]

        # Deterministic UUID from cluster ID
        new_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"bnk-forge-cluster-{cluster.id}"))
        updated_meta = dict(meta)
        updated_meta["cluster_uuid"] = new_uuid
        cluster.meta_data = updated_meta
        self.db.commit()
        return new_uuid

    def has_active_agent(
        self,
        cluster_ident: KubernetesCluster | int | str,
        threshold_seconds: int = AGENT_HEARTBEAT_THRESHOLD_SECONDS,
    ) -> bool:
        """Determine whether the cluster has an active push agent.

        Checks:
        1. ConnectedOperator entry with is_connected=True and fresh last_heartbeat_at.
        2. KubernetesCluster access_method='agent_push' with recent last_synced_at.
        """
        cluster = (
            cluster_ident
            if isinstance(cluster_ident, KubernetesCluster)
            else self.resolve_cluster(cluster_ident)
        )

        operator = (
            self.db.query(ConnectedOperator)
            .filter(ConnectedOperator.cluster_id == cluster.id)
            .first()
        )

        now = datetime.now(UTC)

        if operator and operator.is_connected and operator.last_heartbeat_at:
            # Ensure timezone-aware comparison
            hb_time = operator.last_heartbeat_at
            if hb_time.tzinfo is None:
                hb_time = hb_time.replace(tzinfo=UTC)
            delta = (now - hb_time).total_seconds()
            if delta <= threshold_seconds:
                return True

        if cluster.access_method in ("agent_push", "agent") and cluster.last_synced_at:
            sync_time = cluster.last_synced_at
            if sync_time.tzinfo is None:
                sync_time = sync_time.replace(tzinfo=UTC)
            if (now - sync_time).total_seconds() <= threshold_seconds:
                return True

        return False

    def record_agent_heartbeat(
        self,
        cluster_ident: int | str,
        node_name: str = "node-01",
        agent_id: str | None = None,
        status: str = "healthy",
        uptime_seconds: int = 0,
    ) -> dict[str, Any]:
        """Record an incoming agent heartbeat, updating cluster and operator state."""
        cluster = self.resolve_cluster(cluster_ident)
        now = datetime.now(UTC)

        cluster.connectivity_status = "connected"
        cluster.integration_status = "agent_connected"
        cluster.access_method = "agent_push"
        cluster.last_synced_at = now

        final_agent_id = agent_id or f"agent-{cluster.id}-{node_name}"
        operator = (
            self.db.query(ConnectedOperator)
            .filter(ConnectedOperator.cluster_id == cluster.id)
            .first()
        )

        if not operator:
            operator = ConnectedOperator(
                operator_id=final_agent_id,
                cluster_name=cluster.name,
                cluster_id=cluster.id,
                connectivity_mode="mtls_agent",
                is_connected=True,
                last_connected_at=now,
                last_heartbeat_at=now,
                uptime_seconds=uptime_seconds,
                status="active",
            )
            self.db.add(operator)
        else:
            operator.is_connected = True
            operator.last_heartbeat_at = now
            operator.last_connected_at = now
            operator.uptime_seconds = uptime_seconds
            operator.status = "active"
            operator.connectivity_mode = "mtls_agent"

        self.db.commit()

        return {
            "status": "recorded",
            "cluster_id": cluster.id,
            "cluster_name": cluster.name,
            "is_connected": True,
            "last_heartbeat_at": now.isoformat(),
        }

    # =======================================================================
    # Strangler Facade Telemetry Routing
    # =======================================================================

    def get_cluster_telemetry(
        self,
        cluster_ident: int | str,
        hours: int = 1,
    ) -> dict[str, Any]:
        """Retrieve telemetry summary, transparently switching between Push and Pull paths."""
        cluster = self.resolve_cluster(cluster_ident)
        cluster_uuid = self.get_cluster_uuid(cluster)
        active_agent = self.has_active_agent(cluster)

        operator = (
            self.db.query(ConnectedOperator)
            .filter(ConnectedOperator.cluster_id == cluster.id)
            .first()
        )

        if active_agent:
            # PUSH PATH: Analytical metrics from ClickHouse
            flows_summary = self.ch.query_flows_summary(cluster_uuid, hours=hours)
            top_talkers = self.ch.query_top_pod_talkers(cluster_uuid, hours=hours, limit=5)
            tmm_summary = self.ch.query_tmm_metrics_summary(cluster_uuid, hours=hours)
            drift_violations = self.ch.query_drift_violations(cluster_uuid, hours=24, limit=10)

            return {
                "cluster_id": cluster.id,
                "cluster_name": cluster.name,
                "cluster_uuid": cluster_uuid,
                "source": "AGENT_PUSH",
                "status": "active",
                "has_active_agent": True,
                "connection_mode": "AGENT_PUSH",
                "last_heartbeat_at": operator.last_heartbeat_at.isoformat() if operator and operator.last_heartbeat_at else None,
                "uptime_seconds": operator.uptime_seconds if operator else 0,
                "flows": flows_summary,
                "top_talkers": top_talkers,
                "tmm": tmm_summary,
                "drift_violations_count": flows_summary.get("tmm_bypass_violations", 0),
                "recent_drift_alerts": drift_violations,
                "cloud_provider": cluster.cloud_provider,
                "node_count": cluster.node_count,
            }
        else:
            # FALLBACK PULL PATH: Legacy Redis/Postgres/reachability state
            return {
                "cluster_id": cluster.id,
                "cluster_name": cluster.name,
                "cluster_uuid": cluster_uuid,
                "source": "LEGACY_PULL",
                "status": cluster.connectivity_status or "unknown",
                "has_active_agent": False,
                "connection_mode": "DIRECT_KUBECONFIG",
                "last_heartbeat_at": None,
                "uptime_seconds": 0,
                "flows": None,
                "top_talkers": [],
                "tmm": None,
                "drift_violations_count": 0,
                "recent_drift_alerts": [],
                "cloud_provider": cluster.cloud_provider,
                "node_count": cluster.node_count,
                "api_server": cluster.api_server,
            }

    def get_pod_flows(
        self,
        cluster_ident: int | str,
        hours: int = 1,
        namespace: str | None = None,
        pod_name: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Query pod flow details from ClickHouse if agent is active, or empty dataset on fallback."""
        cluster = self.resolve_cluster(cluster_ident)
        cluster_uuid = self.get_cluster_uuid(cluster)
        active = self.has_active_agent(cluster)

        if not active:
            return {
                "cluster_id": cluster.id,
                "source": "LEGACY_PULL",
                "summary": {},
                "flows": [],
                "top_talkers": [],
            }

        return {
            "cluster_id": cluster.id,
            "source": "AGENT_PUSH",
            "summary": self.ch.query_flows_summary(cluster_uuid, hours=hours),
            "top_talkers": self.ch.query_top_pod_talkers(cluster_uuid, hours=hours, limit=10),
            "flows": self.ch.query_recent_flows(
                cluster_uuid,
                hours=hours,
                namespace=namespace,
                pod_name=pod_name,
                limit=limit,
            ),
        }

    def get_tmm_metrics(
        self,
        cluster_ident: int | str,
        hours: int = 1,
    ) -> dict[str, Any]:
        """Query TMM DPDK microkernel telemetry from ClickHouse if agent active."""
        cluster = self.resolve_cluster(cluster_ident)
        cluster_uuid = self.get_cluster_uuid(cluster)
        active = self.has_active_agent(cluster)

        if not active:
            return {
                "cluster_id": cluster.id,
                "source": "LEGACY_PULL",
                "metrics": {},
            }

        return {
            "cluster_id": cluster.id,
            "source": "AGENT_PUSH",
            "metrics": self.ch.query_tmm_metrics_summary(cluster_uuid, hours=hours),
        }

    def get_drift_violations(
        self,
        cluster_ident: int | str,
        hours: int = 24,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Query TMM bypass drift violations detected by eBPF filter."""
        cluster = self.resolve_cluster(cluster_ident)
        cluster_uuid = self.get_cluster_uuid(cluster)
        active = self.has_active_agent(cluster)

        if not active:
            return {
                "cluster_id": cluster.id,
                "source": "LEGACY_PULL",
                "violations": [],
                "count": 0,
            }

        violations = self.ch.query_drift_violations(cluster_uuid, hours=hours, limit=limit)
        return {
            "cluster_id": cluster.id,
            "source": "AGENT_PUSH",
            "violations": violations,
            "count": len(violations),
        }
