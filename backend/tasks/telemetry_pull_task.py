"""Periodic K8s-API-proxy telemetry pull task for NAT/localhost Forge instances.

When Forge runs on localhost (or behind NAT/firewall) without a public ingest
endpoint, remote ``forge-agent`` pods buffer unsent ``TelemetryBatch`` payloads
on ``:17544/api/v1/telemetry/pull``.  This task connects outbound over each
cluster's authenticated Kubernetes API server (kubeconfig / cloud credentials),
drains buffered batches from ``forge-system/forge-agent`` pods, and forwards
them into ``forge-ingest`` (ClickHouse + NATS) — eliminating any need for
manual ``kubectl port-forward`` or SSH reverse tunnels.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from typing import Any

import httpx

from celery_app import celery_app
from database import SessionLocal
from models.kubernetes import KubernetesCluster
from models.operator import ConnectedOperator

logger = logging.getLogger(__name__)

_DEFAULT_INGEST_URL = "https://forge-ingest:17543"
_AGENT_NAMESPACE = "forge-system"
_AGENT_LABEL = "app.kubernetes.io/name=forge-agent"
_AGENT_PULL_PORT = 17544


def _ingest_url() -> str:
    return os.getenv("FORGE_INGEST_URL", _DEFAULT_INGEST_URL).rstrip("/")


def _pull_pod_batches(api_client: Any, pod_name: str, timeout: float = 5.0) -> list[dict[str, Any]]:
    """Call K8s API pod proxy to drain buffered TelemetryBatch payloads."""
    path = f"/api/v1/namespaces/{_AGENT_NAMESPACE}/pods/{pod_name}:{_AGENT_PULL_PORT}/proxy/api/v1/telemetry/pull"
    resp = api_client.call_api(
        path,
        "GET",
        _preload_content=False,
        _request_timeout=timeout,
    )
    # kubernetes client returns HTTPResponse-like object (urllib3.HTTPResponse)
    raw = resp[0].data if isinstance(resp, tuple) else resp.data
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    payload = json.loads(raw)
    batches = payload.get("batches")
    return batches if isinstance(batches, list) else []


def _mark_cluster_synced(db: Any, cluster: KubernetesCluster) -> None:
    now = datetime.now(UTC)
    cluster.last_synced_at = now
    op = db.query(ConnectedOperator).filter(ConnectedOperator.cluster_id == cluster.id).first()
    if op is not None:
        op.is_connected = True
        op.last_heartbeat_at = now


@celery_app.task(name="tasks.telemetry_pull_task.pull_cluster_agent_telemetry")
def pull_cluster_agent_telemetry() -> dict[str, Any]:
    """Drain buffered TelemetryBatch payloads from reachable clusters via K8s API proxy."""
    from kubernetes import client as k8s_client

    from services.kubernetes_service import KubernetesService

    db = SessionLocal()
    pulled_batches = 0
    clusters_polled = 0
    ingest_endpoint = f"{_ingest_url()}/api/v1/telemetry/batch"

    try:
        clusters = db.query(KubernetesCluster).all()
        k8s_svc = KubernetesService(db)

        with httpx.Client(timeout=10.0, verify=False) as http_client:
            for cluster in clusters:
                try:
                    api_client = k8s_svc.load_kubeconfig(cluster)
                    v1 = k8s_client.CoreV1Api(api_client)
                    pods = v1.list_namespaced_pod(
                        namespace=_AGENT_NAMESPACE,
                        label_selector=_AGENT_LABEL,
                        _request_timeout=5,
                    )
                except Exception as exc:
                    logger.debug("K8s pull skipped for cluster %s (%s): %s", cluster.id, cluster.name, exc)
                    continue

                pod_items = [p for p in (pods.items or []) if getattr(p.status, "phase", None) == "Running"]
                if not pod_items:
                    continue

                clusters_polled += 1
                cluster_had_response = False

                for pod in pod_items:
                    pod_name = pod.metadata.name
                    try:
                        batches = _pull_pod_batches(api_client, pod_name)
                        cluster_had_response = True
                    except Exception as exc:
                        logger.debug("Pod pull failed for %s/%s: %s", cluster.name, pod_name, exc)
                        continue

                    for batch in batches:
                        try:
                            r = http_client.post(ingest_endpoint, json=batch)
                            if r.status_code < 300:
                                pulled_batches += 1
                            else:
                                logger.warning(
                                    "Ingest rejected pulled batch from %s/%s (%d): %s",
                                    cluster.name,
                                    pod_name,
                                    r.status_code,
                                    r.text[:200],
                                )
                        except Exception as exc:
                            logger.warning("Failed forwarding batch to %s: %s", ingest_endpoint, exc)

                if cluster_had_response:
                    _mark_cluster_synced(db, cluster)
                    db.commit()

        return {"clusters_polled": clusters_polled, "pulled_batches": pulled_batches}
    finally:
        db.close()
