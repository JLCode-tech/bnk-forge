"""
ClickHouse HTTP Analytical Client.
Queries forge.ebpf_socket_flows, forge.tmm_dpdk_metrics, and forge.ai_gateway_events.
Supports custom transport / mock injection for hermetic unit testing.
"""

import logging
import math
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def _safe_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        f = float(value)
        return default if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return default

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
                "total_flows": _safe_int(row.get("total_flows")),
                "inbound_flows": _safe_int(row.get("inbound_flows")),
                "outbound_flows": _safe_int(row.get("outbound_flows")),
                "total_bytes_sent": _safe_int(row.get("total_bytes_sent")),
                "total_bytes_received": _safe_int(row.get("total_bytes_received")),
                "avg_handshake_duration_us": _safe_float(row.get("avg_handshake_duration_us")),
                "avg_smoothed_rtt_us": _safe_float(row.get("avg_smoothed_rtt_us")),
                "total_retransmissions": _safe_int(row.get("total_retransmissions")),
                "tmm_bypass_violations": _safe_int(row.get("tmm_bypass_violations")),
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
        """Query top pods (or host socket endpoints when pod metadata is absent) by byte volume."""
        clean_uuid = cluster_uuid.replace("'", "")
        sql = f"""
        SELECT
            if(pod_name != '', namespace, if(node_name != '', concat('node:', node_name), 'cluster')) AS talker_namespace,
            if(pod_name != '', pod_name, concat(IPv6NumToString(dst_ip), ':', toString(dst_port))) AS talker_pod,
            count() AS flow_count,
            sum(bytes_sent) AS total_bytes_sent,
            sum(bytes_received) AS total_bytes_received,
            sum(bytes_sent) + sum(bytes_received) AS total_bytes,
            countIf(tmm_bypass_violation = 1) AS bypass_violations
        FROM forge.ebpf_socket_flows
        WHERE cluster_id = toUUID('{clean_uuid}')
          AND timestamp >= now() - INTERVAL {int(hours)} HOUR
        GROUP BY talker_namespace, talker_pod
        ORDER BY total_bytes DESC
        LIMIT {int(limit)}
        """
        result = self.execute_query(sql)
        data = result.get("data", [])
        return [
            {
                "namespace": r.get("talker_namespace") or r.get("namespace") or "cluster",
                "pod_name": r.get("talker_pod") or r.get("pod_name") or "unknown",
                "flow_count": _safe_int(r.get("flow_count")),
                "total_bytes": _safe_int(r.get("total_bytes")),
                "bytes_sent": _safe_int(r.get("total_bytes_sent", r.get("bytes_sent"))),
                "bytes_received": _safe_int(r.get("total_bytes_received", r.get("bytes_received"))),
                "bypass_violations": _safe_int(r.get("bypass_violations")),
            }
            for r in data
        ]

    def query_tmm_metrics_summary(self, cluster_uuid: str, hours: int = 1) -> dict[str, Any]:
        """Aggregate F5 BIG-IP Next TMM DPDK metrics."""
        clean_uuid = cluster_uuid.replace("'", "")
        sql = f"""
        SELECT
            count() AS sample_count,
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
            total_rx = _safe_int(row.get("total_rx_packets"))
            total_tx = _safe_int(row.get("total_tx_packets"))
            sample_count = (
                _safe_int(row.get("sample_count"))
                if "sample_count" in row
                else (1 if total_rx > 0 or total_tx > 0 else 0)
            )
            return {
                "sample_count": sample_count,
                "total_rx_packets": total_rx,
                "total_tx_packets": total_tx,
                "total_rx_bytes": _safe_int(row.get("total_rx_bytes")),
                "total_tx_bytes": _safe_int(row.get("total_tx_bytes")),
                "total_rx_drops": _safe_int(row.get("total_rx_drops")),
                "total_tx_drops": _safe_int(row.get("total_tx_drops")),
                "avg_rx_ring_occupancy": _safe_float(row.get("avg_rx_ring_occupancy")),
                "avg_tx_ring_occupancy": _safe_float(row.get("avg_tx_ring_occupancy")),
                "avg_cpu_utilization_pct": _safe_float(row.get("avg_cpu_utilization_pct")),
                "max_hugepage_used_bytes": _safe_int(row.get("max_hugepage_used_bytes")),
            }
        return {
            "sample_count": 0,
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

    def query_ai_gateway_stats(
        self,
        cluster_uuid: str | None = None,
        hours: int = 24,
        model: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        """Aggregate AI Gateway request telemetry from forge.ai_gateway_events."""
        clauses = [f"timestamp >= now() - INTERVAL {int(hours)} HOUR"]
        if cluster_uuid:
            clean_uuid = cluster_uuid.replace("'", "")
            clauses.append(f"cluster_id = toUUID('{clean_uuid}')")
        if model:
            clean_model = model.replace("'", "")
            clauses.append(f"model_name = '{clean_model}'")
        if status == "2xx":
            clauses.append("status_code >= 200 AND status_code < 300")
        elif status == "4xx":
            clauses.append("status_code >= 400 AND status_code < 500")
        elif status == "5xx":
            clauses.append("status_code >= 500 AND status_code < 600")
        elif status == "error":
            clauses.append("(status_code < 200 OR status_code >= 300)")

        where_sql = " AND ".join(clauses)
        sql = f"""
        SELECT
            count() AS total_requests,
            countIf(status_code >= 200 AND status_code < 300) AS success,
            avgOrDefault(total_latency_ms) AS avg_latency_ms,
            sum(prompt_tokens + completion_tokens) AS total_tokens,
            sum(cost_usd) AS total_cost,
            uniqExactIf(model_name, model_name != '') AS models,
            groupUniqArrayIf(model_name, model_name != '') AS model_names
        FROM forge.ai_gateway_events
        WHERE {where_sql}
        """
        result = self.execute_query(sql)
        data = result.get("data", [])
        if data:
            row = data[0]
            total = int(row.get("total_requests", 0) or 0)
            success = int(row.get("success", 0) or 0)
            raw_models = row.get("model_names") or []
            model_names = sorted(str(m) for m in raw_models if m)
            return {
                "total_requests": total,
                "success_rate": (success / total) if total else 0.0,
                "avg_latency_ms": float(row.get("avg_latency_ms", 0.0) or 0.0),
                "total_tokens": int(row.get("total_tokens", 0) or 0),
                "total_cost": float(row.get("total_cost", 0.0) or 0.0),
                "models": int(row.get("models", 0) or len(model_names)),
                "model_names": model_names,
            }
        return {
            "total_requests": 0,
            "success_rate": 0.0,
            "avg_latency_ms": 0.0,
            "total_tokens": 0,
            "total_cost": 0.0,
            "models": 0,
            "model_names": [],
        }

    def query_ai_gateway_events(
        self,
        cluster_uuid: str | None = None,
        hours: int = 24,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Query recent AI Gateway events from forge.ai_gateway_events."""
        clauses = [f"timestamp >= now() - INTERVAL {int(hours)} HOUR"]
        if cluster_uuid:
            clean_uuid = cluster_uuid.replace("'", "")
            clauses.append(f"cluster_id = toUUID('{clean_uuid}')")
        where_sql = " AND ".join(clauses)
        sql = f"""
        SELECT
            timestamp,
            cluster_id,
            client_id,
            model_name,
            route_name,
            prompt_tokens,
            completion_tokens,
            time_to_first_token_ms,
            total_latency_ms,
            status_code,
            cost_usd
        FROM forge.ai_gateway_events
        WHERE {where_sql}
        ORDER BY timestamp DESC
        LIMIT {int(limit)}
        """
        return self.execute_query(sql).get("data", [])
