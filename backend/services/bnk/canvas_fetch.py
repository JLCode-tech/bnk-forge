"""Read-only lists the Topology Canvas needs beyond ``fetch_all_bnk_data``.

Some kinds that BIG-IP Next objects reference are not in Forge's resource registry, so the shared BNK fetch
never reads them. Without them the Canvas could only say a reference was "not read"; with them it can say
whether the target exists. Each kind is listed with get/list only, and a kind whose CRD is not installed
(404) or that the kubeconfig may not list (403) is left out, so references to it stay "not read".
"""

import logging
from typing import Any

from kubernetes import client as k8s_client
from kubernetes.client.rest import ApiException

from core.cache import cache
from services.bnk.canvas_graph import CANVAS_LOCAL_PLURALS, CANVAS_LOCAL_TYPES
from services.kubernetes_service import KubernetesService

logger = logging.getLogger(__name__)

_CANVAS_EXTRAS_CACHE_TTL = 60  # Same as the shared BNK data cache.


def _list_kind(custom: k8s_client.CustomObjectsApi, key: str, namespace: str | None) -> list[dict[str, Any]] | None:
    group, version, _ = CANVAS_LOCAL_TYPES[key]
    plural = CANVAS_LOCAL_PLURALS[key]
    try:
        if namespace:
            body = custom.list_namespaced_custom_object(group, version, namespace, plural)
        else:
            body = custom.list_cluster_custom_object(group, version, plural)
    except ApiException as e:
        if e.status not in (403, 404):
            logger.warning("Topology Canvas could not list %s: %s", plural, e.status)
        return None
    items = body.get("items") if isinstance(body, dict) else None
    return [item for item in items or [] if isinstance(item, dict)]


def fetch_canvas_extras(
    k8s_service: KubernetesService, cluster_id: int, namespace: str | None, force: bool = False
) -> dict[str, list[dict[str, Any]]]:
    """List the Canvas-only kinds (``CANVAS_LOCAL_TYPES``), keyed like ``fetch_all_bnk_data`` resources."""
    cache_key = f"bnk_canvas_extras:{cluster_id}:{namespace or '*'}"
    if not force:
        cached = cache.get(cache_key)
        if cached is not None:
            return dict(cached)
    custom = k8s_client.CustomObjectsApi(k8s_service.load_kubeconfig(k8s_service.get_cluster(cluster_id)))
    out: dict[str, list[dict[str, Any]]] = {}
    for key in CANVAS_LOCAL_TYPES:
        items = _list_kind(custom, key, namespace)
        if items is not None:
            out[key] = items
    cache.set(cache_key, out, ttl_seconds=_CANVAS_EXTRAS_CACHE_TTL)
    return out
