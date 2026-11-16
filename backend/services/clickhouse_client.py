"""
ClickHouse HTTP Analytical Client.
Queries forge.ebpf_socket_flows, forge.tmm_dpdk_metrics, and forge.ai_gateway_events.
Supports custom transport / mock injection for hermetic unit testing.
"""

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_CLICKHOUSE_URL = os.getenv("CLICKHOUSE_HTTP_URL", "http://localhost:8123")
DEFAULT_CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "default")
DEFAULT_CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "bnkforge_dev_password")


class ClickHouseError(Exception):
    """Raised when a ClickHouse query fails."""
    pass


class ClickHouseClient:
    """Client for executing analytical queries against ClickHouse via HTTP."""

    def __init__(
        self,
        base_url: str | None = None,
        user: str | None = None,
        password: str | None = None,
        client: httpx.Client | None = None,
        timeout: float = 5.0,
    ):
        self.base_url = (base_url or DEFAULT_CLICKHOUSE_URL).rstrip("/")
        self.user = user or DEFAULT_CLICKHOUSE_USER
        self.password = password or DEFAULT_CLICKHOUSE_PASSWORD
        self.timeout = timeout
        headers = {
            "User-Agent": "bnk-forge-backend/4.3.3",
            "X-ClickHouse-User": self.user,
            "X-ClickHouse-Key": self.password,
        }
        self._client = client or httpx.Client(
            base_url=self.base_url,
            timeout=self.timeout,
            headers=headers,
        )

    def close(self):
        """Close underlying HTTP client."""
        if self._client:
            self._client.close()

    def execute_query(self, sql: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Execute a SQL query with FORMAT JSON.

        Returns dict containing 'data', 'meta', 'rows', etc.
        """
        # Ensure query requests JSON format
        trimmed_sql = sql.strip().rstrip(";")
        if "FORMAT " not in trimmed_sql.upper():
            query_with_format = f"{trimmed_sql} FORMAT JSON"
        else:
            query_with_format = trimmed_sql

        try:
            url = f"{self.base_url}/" if self.base_url else "/"
            resp = self._client.post(
                url,
                params={"query": query_with_format},
                timeout=self.timeout,
            )
            if resp.status_code != 200:
                logger.warning(
                    "ClickHouse query returned status %d: %s",
                    resp.status_code,
                    resp.text[:300],
                )
                return {"data": [], "meta": [], "rows": 0, "error": resp.text}

            return resp.json()
        except Exception as e:
            logger.warning("ClickHouse query execution failed: %s", e)
            return {"data": [], "meta": [], "rows": 0, "error": str(e)}

    # -----------------------------------------------------------------------
    # Analytical Queries for Strangler Facade
    # -----------------------------------------------------------------------

    def query_flows_summary(self, cluster_uuid: str, hours: int = 1) -> dict[str, Any]:
        """Aggregate eBPF socket flows for a cluster over a time window."""
        # Sanitize cluster_uuid
        clean_uuid = cluster_uuid.replace("'", "")
        sql = f"""
        SELECT
            count() AS total_flows,
            countIf(direction = 'INBOUND') AS inbound_flows,
            countIf(direction = 'OUTBOUND') AS outbound_flows,
            sum(bytes_sent) AS total_bytes_sent,
            sum(bytes_received) AS total_bytes_received,
            round(avg(handshake_duration_us), 2) AS avg_handshake_duration_us,
            round(avg(smoothed_rtt_us), 2) AS avg_smoothed_rtt_us,
            sum(retransmissions) AS total_retransmissions,
            countIf(tmm_bypass_violation = 1) AS tmm_bypass_violations
        FROM forge.ebpf_socket_flows
        WHERE cluster_id = toUUID('{clean_uuid}')
          AND timestamp >= now() - INTERVAL {int(hours)} HOUR
        """
        result = self.execute_query(sql)
        data = result.get("data", [])
        if data and len(data) > 0:
            row = data[0]
            return {
                "total_flows": int(row.get("total_flows", 0)),
                "inbound_flows": int(row.get("inbound_flows", 0)),
                "outbound_flows": int(row.get("outbound_flows", 0)),
                "total_bytes_sent": int(row.get("total_bytes_sent", 0)),
                "total_bytes_received": int(row.get("total_bytes_received", 0)),
                "avg_handshake_duration_us": float(row.get("avg_handshake_duration_us", 0.0)),
                "avg_smoothed_rtt_us": float(row.get("avg_smoothed_rtt_us", 0.0)),
                "total_retransmissions": int(row.get("total_retransmissions", 0)),
                "tmm_bypass_violations": int(row.get("tmm_bypass_violations", 0)),
            }
        return {
            "total_flows": 0,
            "inbound_flows": 0,
            "outbound_flows": 0,
            "total_bytes_sent": 0,
            "total_bytes_received": 0,
            "avg_handshake_duration_us": 0.0,
            "avg_smoothed_rtt_us": 0.0,
            "total_retransmissions": 0,
            "tmm_bypass_violations": 0,
        }

    def query_recent_flows(
        self,
        cluster_uuid: str,
        hours: int = 1,
        namespace: str | None = None,
        pod_name: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Fetch individual recent flow records for deep diagnostics."""
        clean_uuid = cluster_uuid.replace("'", "")
        where_clauses = [
            f"cluster_id = toUUID('{clean_uuid}')",
            f"timestamp >= now() - INTERVAL {int(hours)} HOUR",
        ]
        if namespace:
            clean_ns = namespace.replace("'", "")
            where_clauses.append(f"namespace = '{clean_ns}'")
        if pod_name:
            clean_pod = pod_name.replace("'", "")
            where_clauses.append(f"pod_name = '{clean_pod}'")

        sql = f"""
        SELECT
            timestamp,
            node_name,
            pod_name,
            namespace,
            IPv6NumToString(src_ip) AS src_ip,
            src_port,
            IPv6NumToString(dst_ip) AS dst_ip,
            dst_port,
            direction,
            handshake_duration_us,
            bytes_sent,
            bytes_received,
            retransmissions,
            smoothed_rtt_us,
            tmm_bypass_violation
        FROM forge.ebpf_socket_flows
        WHERE {' AND '.join(where_clauses)}
        ORDER BY timestamp DESC
        LIMIT {int(limit)}
        """
        result = self.execute_query(sql)
        return result.get("data", [])

    def query_top_pod_talkers(self, cluster_uuid: str, hours: int = 1, limit: int = 10) -> list[dict[str, Any]]:
        """Query top pods by aggregate network byte volume."""
        clean_uuid = cluster_uuid.replace("'", "")
        sql = f"""
        SELECT
            namespace,
            pod_name,
            count() AS flow_count,
            sum(bytes_sent + bytes_received) AS total_bytes,
            sum(bytes_sent) AS bytes_sent,
            sum(bytes_received) AS bytes_received,
            countIf(tmm_bypass_violation = 1) AS bypass_violations
        FROM forge.ebpf_socket_flows
        WHERE cluster_id = toUUID('{clean_uuid}')
          AND timestamp >= now() - INTERVAL {int(hours)} HOUR
        GROUP BY namespace, pod_name
        ORDER BY total_bytes DESC
        LIMIT {int(limit)}
        """
        result = self.execute_query(sql)
        data = result.get("data", [])
        return [
            {
                "namespace": r.get("namespace"),
                "pod_name": r.get("pod_name"),
                "flow_count": int(r.get("flow_count", 0)),
                "total_bytes": int(r.get("total_bytes", 0)),
                "bytes_sent": int(r.get("bytes_sent", 0)),
                "bytes_received": int(r.get("bytes_received", 0)),
                "bypass_violations": int(r.get("bypass_violations", 0)),
            }
            for r in data
        ]

    def query_tmm_metrics_summary(self, cluster_uuid: str, hours: int = 1) -> dict[str, Any]:
        """Aggregate F5 BIG-IP Next TMM DPDK metrics."""
        clean_uuid = cluster_uuid.replace("'", "")
        sql = f"""
        SELECT
            sum(rx_packets) AS total_rx_packets,
            sum(tx_packets) AS total_tx_packets,
            sum(rx_bytes) AS total_rx_bytes,
            sum(tx_bytes) AS total_tx_bytes,
            sum(rx_drops) AS total_rx_drops,
            sum(tx_drops) AS total_tx_drops,
            round(avg(rx_ring_descriptor_occupancy), 3) AS avg_rx_ring_occupancy,
            round(avg(tx_ring_descriptor_occupancy), 3) AS avg_tx_ring_occupancy,
            round(avg(cpu_utilization_pct), 2) AS avg_cpu_utilization_pct,
            max(hugepage_used_bytes) AS max_hugepage_used_bytes
        FROM forge.tmm_dpdk_metrics
        WHERE cluster_id = toUUID('{clean_uuid}')
          AND timestamp >= now() - INTERVAL {int(hours)} HOUR
        """
        result = self.execute_query(sql)
        data = result.get("data", [])
        if data and len(data) > 0:
            row = data[0]
            return {
                "total_rx_packets": int(row.get("total_rx_packets", 0)),
                "total_tx_packets": int(row.get("total_tx_packets", 0)),
                "total_rx_bytes": int(row.get("total_rx_bytes", 0)),
                "total_tx_bytes": int(row.get("total_tx_bytes", 0)),
                "total_rx_drops": int(row.get("total_rx_drops", 0)),
                "total_tx_drops": int(row.get("total_tx_drops", 0)),
                "avg_rx_ring_occupancy": float(row.get("avg_rx_ring_occupancy", 0.0)),
                "avg_tx_ring_occupancy": float(row.get("avg_tx_ring_occupancy", 0.0)),
                "avg_cpu_utilization_pct": float(row.get("avg_cpu_utilization_pct", 0.0)),
                "max_hugepage_used_bytes": int(row.get("max_hugepage_used_bytes", 0)),
            }
        return {
            "total_rx_packets": 0,
            "total_tx_packets": 0,
            "total_rx_bytes": 0,
            "total_tx_bytes": 0,
            "total_rx_drops": 0,
            "total_tx_drops": 0,
            "avg_rx_ring_occupancy": 0.0,
            "avg_tx_ring_occupancy": 0.0,
            "avg_cpu_utilization_pct": 0.0,
            "max_hugepage_used_bytes": 0,
        }

    def query_drift_violations(
        self,
        cluster_uuid: str,
        hours: int = 24,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Query TMM bypass violations detected by eBPF socket filters."""
        clean_uuid = cluster_uuid.replace("'", "")
        sql = f"""
        SELECT
            timestamp,
            node_name,
            pod_name,
            namespace,
            IPv6NumToString(src_ip) AS src_ip,
            src_port,
            IPv6NumToString(dst_ip) AS dst_ip,
            dst_port,
            direction,
            handshake_duration_us
        FROM forge.ebpf_socket_flows
        WHERE cluster_id = toUUID('{clean_uuid}')
          AND tmm_bypass_violation = 1
          AND timestamp >= now() - INTERVAL {int(hours)} HOUR
        ORDER BY timestamp DESC
        LIMIT {int(limit)}
        """
        result = self.execute_query(sql)
        data = result.get("data", [])
        return [
            {
                "timestamp": r.get("timestamp"),
                "node_name": r.get("node_name"),
                "pod_name": r.get("pod_name"),
                "namespace": r.get("namespace"),
                "src_ip": r.get("src_ip"),
                "src_port": r.get("src_port"),
                "dst_ip": r.get("dst_ip"),
                "dst_port": r.get("dst_port"),
                "direction": r.get("direction"),
                "handshake_duration_us": r.get("handshake_duration_us"),
                "message": f"Direct inbound socket to port {r.get('dst_port')} bypassed BNK TMM ingress",
            }
            for r in data
        ]
