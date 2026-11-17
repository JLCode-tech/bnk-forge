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

from core.cache import cache
from core.errors import NotFoundError
from models.kubernetes import KubernetesCluster
from models.operator import ConnectedOperator
from services.base_service import BaseService
from services.clickhouse_client import ClickHouseClient

logger = logging.getLogger(__name__)

# Heartbeat freshness window (seconds). Agents ping every 15s.
AGENT_HEARTBEAT_THRESHOLD_SECONDS = 90
_TMM_LIVE_CACHE_TTL = 60


def _parse_tmctl_raw_rows(raw: str) -> list[list[str]]:
    """Parse raw tmctl tabular output (skipping header/separator lines) by whitespace."""
    rows: list[list[str]] = []
    lines = [line.strip() for line in (raw or "").splitlines() if line.strip()]
    if len(lines) <= 2:
        return rows
    for line in lines[2:]:
        if set(line) <= {"-", " "}:
            continue
        rows.append(line.split())
    return rows


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

    @staticmethod
    def _is_tmm_active(cluster: KubernetesCluster, tmm_summary: dict[str, Any] | None) -> bool:
        """Determine whether F5 TMM is genuinely active for a cluster."""
        if not tmm_summary:
            return False
        if "sample_count" in tmm_summary and int(tmm_summary.get("sample_count") or 0) <= 0:
            return False
        return (
            int(tmm_summary.get("total_rx_packets") or 0) > 0
            or int(tmm_summary.get("total_tx_packets") or 0) > 0
            or int(tmm_summary.get("tmm_pods") or 0) > 0
        )

    @staticmethod
    def _is_dpdk_active(cluster: KubernetesCluster, tmm_summary: dict[str, Any] | None) -> bool:
        """Determine whether TMM DPDK ring/hugepage telemetry is genuinely active for a cluster."""
        caps = getattr(cluster, "platform_capabilities", None) or {}
        if isinstance(caps, dict) and caps.get("dpdk") is False:
            return False
        if not ClusterDataProvider._is_tmm_active(cluster, tmm_summary):
            return False
        return (
            float(tmm_summary.get("avg_rx_ring_occupancy") or 0.0) > 0.0
            or float(tmm_summary.get("avg_tx_ring_occupancy") or 0.0) > 0.0
            or int(tmm_summary.get("max_hugepage_used_bytes") or 0) > 0
        )

    def _query_live_tmm_via_k8s(self, cluster: KubernetesCluster) -> dict[str, Any] | None:
        """Probe running f5-tmm pods via K8s tmctl when ClickHouse has no DPDK socket metrics."""
        cache_key = f"telemetry:tmm_live:{cluster.id}"
        cached = cache.get(cache_key)
        if isinstance(cached, dict):
            return cached if cached.get("tmm_active") else None

        if not cluster.kubeconfig_encrypted and not cluster.api_server:
            return None

        try:
            from kubernetes import client as k8s_client

            from services.kubernetes_service import KubernetesService
            from services.tmm_debug_service import exec_tmctl

            api_client = KubernetesService(self.db).load_kubeconfig(cluster)
            v1 = k8s_client.CoreV1Api(api_client)
            pods = v1.list_pod_for_all_namespaces(label_selector="app=f5-tmm", _request_timeout=10)
            running_tmm = [
                p for p in (pods.items or []) if getattr(p.status, "phase", None) == "Running"
            ]
            if not running_tmm:
                cache.set(cache_key, {"tmm_active": False}, ttl_seconds=_TMM_LIVE_CACHE_TTL)
                return None

            pod = running_tmm[0]
            pod_name = pod.metadata.name
            pod_ns = pod.metadata.namespace or "f5-cne-system"

            iface_res = exec_tmctl(
                api_client,
                pod_name,
                pod_ns,
                table="interface_stat",
                directory="blade",
                columns=[
                    "name",
                    "counters.pkts_in",
                    "counters.bytes_in",
                    "counters.pkts_out",
                    "counters.bytes_out",
                    "counters.errors_in",
                    "counters.errors_out",
                ],
                cluster_id=cluster.id,
            )
            rx_pkts = rx_bytes = tx_pkts = tx_bytes = rx_drops = tx_drops = 0
            for cols in _parse_tmctl_raw_rows(iface_res.get("raw", "")):
                if len(cols) < 7 or cols[0].startswith("xchg:"):
                    continue
                rx_pkts += int(cols[1])
                rx_bytes += int(cols[2])
                tx_pkts += int(cols[3])
                tx_bytes += int(cols[4])
                rx_drops += int(cols[5])
                tx_drops += int(cols[6])

            tmm_res = exec_tmctl(
                api_client,
                pod_name,
                pod_ns,
                table="tmm_stat",
                directory="blade",
                columns=["cpu", "polls", "idle_polls"],
                cluster_id=cluster.id,
            )
            total_polls = 0
            total_idle = 0
            for cols in _parse_tmctl_raw_rows(tmm_res.get("raw", "")):
                if len(cols) >= 3:
                    total_polls += int(cols[1])
                    total_idle += int(cols[2])
            cpu_pct = (
                round(max(0.0, ((total_polls - total_idle) / total_polls) * 100.0), 2)
                if total_polls > 0
                else 0.0
            )

            summary = {
                "tmm_active": True,
                "tmm_pods": len(running_tmm),
                "sample_count": 1,
                "total_rx_packets": rx_pkts,
                "total_tx_packets": tx_pkts,
                "total_rx_bytes": rx_bytes,
                "total_tx_bytes": tx_bytes,
                "total_rx_drops": rx_drops,
                "total_tx_drops": tx_drops,
                "avg_rx_ring_occupancy": 0.0,
                "avg_tx_ring_occupancy": 0.0,
                "avg_cpu_utilization_pct": cpu_pct,
                "max_hugepage_used_bytes": 0,
            }
            cache.set(cache_key, summary, ttl_seconds=_TMM_LIVE_CACHE_TTL)
            return summary
        except Exception as exc:
            logger.debug("Live TMM tmctl probe skipped for cluster %s: %s", cluster.id, exc)
            return None

    def get_cluster_telemetry(
        self,
        cluster_ident: int | str,
        hours: int = 1,
    ) -> dict[str, Any]:
        """Retrieve telemetry summary from ClickHouse regardless of Push vs Pull transport."""
        cluster = self.resolve_cluster(cluster_ident)
        cluster_uuid = self.get_cluster_uuid(cluster)
        active_agent = self.has_active_agent(cluster)

        operator = (
            self.db.query(ConnectedOperator)
            .filter(ConnectedOperator.cluster_id == cluster.id)
            .first()
        )

        # Always query ClickHouse — both Push (forge-ingest) and Pull (K8s API proxy)
        # write eBPF/TMM telemetry into ClickHouse.
        flows_summary = self.ch.query_flows_summary(cluster_uuid, hours=hours)
        top_talkers = self.ch.query_top_pod_talkers(cluster_uuid, hours=hours, limit=5)
        tmm_summary = self.ch.query_tmm_metrics_summary(cluster_uuid, hours=hours)
        if not self._is_tmm_active(cluster, tmm_summary):
            live_tmm = self._query_live_tmm_via_k8s(cluster)
            if live_tmm:
                tmm_summary = live_tmm
        drift_violations = self.ch.query_drift_violations(cluster_uuid, hours=24, limit=10)
        tmm_active = self._is_tmm_active(cluster, tmm_summary)
        dpdk_active = self._is_dpdk_active(cluster, tmm_summary)
        has_flow_data = int((flows_summary or {}).get("total_flows") or 0) > 0 or len(top_talkers) > 0

        if active_agent:
            return {
                "cluster_id": cluster.id,
                "cluster_name": cluster.name,
                "cluster_uuid": cluster_uuid,
                "source": "AGENT_PUSH",
                "transport_label": "Push Active",
                "status": "active",
                "has_active_agent": True,
                "tmm_active": tmm_active,
                "dpdk_active": dpdk_active,
                "connection_mode": "AGENT_PUSH",
                "last_heartbeat_at": operator.last_heartbeat_at.isoformat() if operator and operator.last_heartbeat_at else None,
                "uptime_seconds": operator.uptime_seconds if operator else 0,
                "flows": flows_summary,
                "top_talkers": top_talkers,
                "tmm": tmm_summary if tmm_active else None,
                "drift_violations_count": flows_summary.get("tmm_bypass_violations", 0),
                "recent_drift_alerts": drift_violations,
                "cloud_provider": cluster.cloud_provider,
                "node_count": cluster.node_count,
            }
        else:
            return {
                "cluster_id": cluster.id,
                "cluster_name": cluster.name,
                "cluster_uuid": cluster_uuid,
                "source": "LEGACY_PULL",
                "transport_label": "Pull Active",
                "status": cluster.connectivity_status or "unknown",
                "has_active_agent": False,
                "tmm_active": tmm_active,
                "dpdk_active": dpdk_active,
                "connection_mode": "DIRECT_KUBECONFIG",
                "last_heartbeat_at": operator.last_heartbeat_at.isoformat() if operator and operator.last_heartbeat_at else None,
                "uptime_seconds": operator.uptime_seconds if operator else 0,
                "flows": flows_summary if has_flow_data else None,
                "top_talkers": top_talkers if has_flow_data else [],
                "tmm": tmm_summary if tmm_active else None,
                "drift_violations_count": flows_summary.get("tmm_bypass_violations", 0) if has_flow_data else 0,
                "recent_drift_alerts": drift_violations if has_flow_data else [],
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
        """Query pod flow details from ClickHouse (populated by Push or Pull)."""
        cluster = self.resolve_cluster(cluster_ident)
        cluster_uuid = self.get_cluster_uuid(cluster)
        active = self.has_active_agent(cluster)

        return {
            "cluster_id": cluster.id,
            "source": "AGENT_PUSH" if active else "LEGACY_PULL",
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
        """Query TMM DPDK microkernel telemetry from ClickHouse if DPDK is active."""
        cluster = self.resolve_cluster(cluster_ident)
        cluster_uuid = self.get_cluster_uuid(cluster)
        active = self.has_active_agent(cluster)

        tmm_summary = self.ch.query_tmm_metrics_summary(cluster_uuid, hours=hours)
        if not self._is_tmm_active(cluster, tmm_summary):
            live_tmm = self._query_live_tmm_via_k8s(cluster)
            if live_tmm:
                tmm_summary = live_tmm
        tmm_active = self._is_tmm_active(cluster, tmm_summary)
        dpdk_active = self._is_dpdk_active(cluster, tmm_summary)
        return {
            "cluster_id": cluster.id,
            "source": "AGENT_PUSH" if active else "LEGACY_PULL",
            "tmm_active": tmm_active,
            "dpdk_active": dpdk_active,
            "metrics": tmm_summary if tmm_active else {},
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

        violations = self.ch.query_drift_violations(cluster_uuid, hours=hours, limit=limit)
        return {
            "cluster_id": cluster.id,
            "source": "AGENT_PUSH" if active else "LEGACY_PULL",
            "violations": violations,
            "count": len(violations),
        }
