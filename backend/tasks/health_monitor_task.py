"""
Health monitoring Celery task.

Periodically checks BNK cluster health and fires alerts when status changes.
Runs every 60 seconds via Celery beat.

Architecture:
  - Fetches health for each cluster with an active project
  - Compares current health against last known state (in-process TTL cache)
  - If severity changed (e.g., healthy → critical), fires alert via alert_service
  - Stores current health state for next comparison
"""
import logging
import threading
import time
from datetime import UTC, datetime
from typing import Any

from celery_app import celery_app
from database import get_db_context
from models.enums import HealthSeverity

logger = logging.getLogger(__name__)

# In-process TTL cache for health state (replaces legacy Redis dependency)
_HEALTH_STATE_TTL_SECONDS = 3600
_HEALTH_STATE_CACHE: dict[int, tuple[float, dict[str, Any]]] = {}
_HEALTH_STATE_LOCK = threading.Lock()


def _get_previous_health(cluster_id: int) -> dict[str, Any] | None:
    """Return cached health state for cluster_id if within TTL."""
    now = time.monotonic()
    with _HEALTH_STATE_LOCK:
        entry = _HEALTH_STATE_CACHE.get(cluster_id)
        if not entry:
            return None
        expires_at, state = entry
        if now >= expires_at:
            _HEALTH_STATE_CACHE.pop(cluster_id, None)
            return None
        return state


def _set_previous_health(cluster_id: int, state: dict[str, Any]) -> None:
    """Cache current health state for cluster_id with 1-hour TTL."""
    expires_at = time.monotonic() + _HEALTH_STATE_TTL_SECONDS
    with _HEALTH_STATE_LOCK:
        _HEALTH_STATE_CACHE[cluster_id] = (expires_at, state)


def _get_cluster_health(cluster_id: int, db) -> dict[str, Any] | None:
    """
    Fetch current BNK health for a cluster.
    Reuses the same logic as the /f5bnk/health API endpoint.

    Uses kubeconfig_for_cluster context manager to guarantee temp file cleanup.
    """
    try:
        import kr8s

        from models import KubernetesCluster
        from services.cluster_utils import kubeconfig_for_cluster

        cluster = db.query(KubernetesCluster).filter(
            KubernetesCluster.id == cluster_id
        ).first()
        if not cluster:
            return None

        if not cluster.kubeconfig_encrypted:
            return None

        from services.kubernetes_service import KubernetesService

        k8s_svc = KubernetesService(db)
        conn_res = k8s_svc.test_connection(cluster_id)
        if not isinstance(conn_res, dict) or not conn_res.get("success"):
            logger.debug(
                f"Skipping health check for unreachable cluster {cluster.name} (id={cluster_id})"
            )
            return None

        with kubeconfig_for_cluster(cluster, db) as kubeconfig_path:
            api = kr8s.api(kubeconfig=kubeconfig_path)

            # Quick health check — just look at key indicators
            health = {
                "cluster_id": cluster_id,
                "cluster_name": cluster.name,
                "timestamp": datetime.now(UTC).isoformat(),
                "components": {},
            }

            # Check FLO operator
            try:
                pods = api.get("pods", namespace="f5-operator", label_selector="app.kubernetes.io/name=f5-lifecycle-operator")
                running = sum(1 for p in pods if p.status.phase == "Running")
                health["components"]["flo"] = {
                    "total": len(pods),
                    "running": running,
                    "severity": HealthSeverity.HEALTHY if running > 0 else HealthSeverity.UNHEALTHY,
                }
            except Exception:
                health["components"]["flo"] = {"total": 0, "running": 0, "severity": HealthSeverity.UNKNOWN}

            # Check TMM pods
            try:
                pods = api.get("pods", namespace="*", label_selector="app=f5-tmm")
                running = sum(1 for p in pods if p.status.phase == "Running")
                total = len(pods)
                if total == 0:
                    sev = HealthSeverity.UNKNOWN
                elif running == total:
                    sev = HealthSeverity.HEALTHY
                elif running > 0:
                    sev = HealthSeverity.DEGRADED
                else:
                    sev = HealthSeverity.UNHEALTHY
                health["components"]["tmm"] = {
                    "total": total,
                    "running": running,
                    "severity": sev,
                }
            except Exception:
                health["components"]["tmm"] = {"total": 0, "running": 0, "severity": HealthSeverity.UNKNOWN}

            # Check Gateways
            try:
                gateways = api.get("gateways", namespace="*")
                programmed = sum(1 for g in gateways if any(
                    c.get("type") == "Programmed" and c.get("status") == "True"
                    for c in (g.status.get("conditions", []) if hasattr(g.status, 'get') else [])
                ))
                total = len(gateways)
                if total == 0:
                    sev = HealthSeverity.UNKNOWN
                elif programmed == total:
                    sev = HealthSeverity.HEALTHY
                elif programmed > 0:
                    sev = HealthSeverity.DEGRADED
                else:
                    sev = HealthSeverity.UNHEALTHY
                health["components"]["gateways"] = {
                    "total": total,
                    "programmed": programmed,
                    "severity": sev,
                }
            except Exception:
                health["components"]["gateways"] = {"total": 0, "programmed": 0, "severity": HealthSeverity.UNKNOWN}

            # Overall severity — worst component wins
            severities = [c["severity"] for c in health["components"].values()]
            if HealthSeverity.UNHEALTHY in severities:
                health["overall_severity"] = HealthSeverity.UNHEALTHY
            elif HealthSeverity.DEGRADED in severities:
                health["overall_severity"] = HealthSeverity.DEGRADED
            elif all(s == HealthSeverity.UNKNOWN for s in severities):
                health["overall_severity"] = HealthSeverity.UNKNOWN
            else:
                health["overall_severity"] = HealthSeverity.HEALTHY

            return health

    except Exception as e:
        logger.error(f"Failed to get health for cluster {cluster_id}: {e}")
        return None


@celery_app.task(name="tasks.health_monitor_task.check_cluster_health")
def check_cluster_health():
    """
    Periodic task: check health of all clusters with active projects.
    Fires alerts when health severity changes.
    """
    with get_db_context() as db:
        try:
            from sqlalchemy import or_

            from models import KubernetesCluster, Project

            # Get all clusters that have kubeconfig credentials or belong to active projects
            clusters = db.query(KubernetesCluster).outerjoin(
                Project, KubernetesCluster.project_id == Project.id
            ).filter(
                or_(
                    KubernetesCluster.kubeconfig_encrypted.isnot(None),
                    Project.module_count > 0,
                    Project.deployed_count > 0,
                )
            ).all()

            if not clusters:
                return {"checked": 0, "alerts_fired": 0}

            alerts_fired = 0

            for cluster in clusters:
                try:
                    current_health = _get_cluster_health(cluster.id, db)
                    if not current_health:
                        continue

                    current_severity = current_health.get("overall_severity", "unknown")

                    prev = _get_previous_health(cluster.id)
                    previous_severity = prev.get("overall_severity") if prev else None
                    _set_previous_health(cluster.id, current_health)

                    # Fire alert if severity changed
                    if previous_severity and current_severity != previous_severity:
                        _fire_health_alert(
                            db, cluster, current_health, current_severity, previous_severity
                        )
                        db.commit()
                        alerts_fired += 1

                    # Also alert if unhealthy (even if not changed) — first detection
                    elif previous_severity is None and current_severity == HealthSeverity.UNHEALTHY:
                        _fire_health_alert(
                            db, cluster, current_health, current_severity, "unknown"
                        )
                        db.commit()
                        alerts_fired += 1

                except Exception as e:
                    logger.error(f"Health check failed for cluster {cluster.id} ({cluster.name}): {e}")

            return {"checked": len(clusters), "alerts_fired": alerts_fired}

        except Exception as e:
            logger.error(f"Health monitor task failed: {e}")
            return {"error": str(e)}


def _fire_health_alert(
    db,
    cluster,
    health: dict[str, Any],
    current_severity: str,
    previous_severity: str,
):
    """Fire an alert for a health severity change."""
    from services.alert_service import fire_alert

    # Map HealthSeverity members to alert notification severity strings
    severity_map = {
        HealthSeverity.UNHEALTHY: "critical",
        HealthSeverity.DEGRADED: "warning",
        HealthSeverity.HEALTHY: "info",
        HealthSeverity.UNKNOWN: "warning",
    }

    # Build component details for the alert
    components_detail = []
    for name, comp in health.get("components", {}).items():
        if comp.get("severity") in (HealthSeverity.UNHEALTHY, HealthSeverity.DEGRADED):
            components_detail.append(f"{name}: {comp.get('running', '?')}/{comp.get('total', '?')}")

    message = f"Cluster '{cluster.name}' health changed: {previous_severity} -> {current_severity}"
    if components_detail:
        message += f"\nAffected: {', '.join(components_detail)}"

    fire_alert(
        db=db,
        event_type="health_change",
        severity=severity_map.get(current_severity, "warning"),
        title=f"Health {current_severity.upper()}: {cluster.name}",
        message=message,
        project_id=cluster.project_id,
        cluster_id=cluster.id,
        extra={
            "cluster_name": cluster.name,
            "previous_severity": previous_severity,
            "current_severity": current_severity,
            "components": health.get("components", {}),
        },
    )
