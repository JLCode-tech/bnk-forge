"""
Analyzer runtime metrics — Prometheus proxy scoped to one F5BigAnalyzer CR.

The F5BigAnalyzer CR declares the Prometheus endpoint(s) it consumes via
``spec.dataSources[]``. This service reads that endpoint, routes queries
through the cluster's K8s API-server service-proxy (so the Prometheus
service doesn't need to be externally exposed), runs a canonical set of
LLM-serving metrics queries, and returns a structured per-backend view
the frontend can render directly.

Design notes:
  - All PromQL queries are well-known patterns for LiteLLM / vLLM / NIM
    metrics. If the cluster's Prometheus doesn't have those series, the
    specific field returns null — no fake fallback.
  - The ``by(model|route)`` dimension maps to HTTPRoute backend names,
    so the UI can align metrics with the Traffic Distribution bars.
  - Errors (Prometheus unreachable, auth failure, malformed query) are
    surfaced as structured error fields rather than exceptions — the UI
    degrades gracefully.
"""

from __future__ import annotations

import logging
import re
import time
import urllib.parse
from datetime import UTC, datetime
from typing import Any

from kubernetes.client.rest import ApiException
from sqlalchemy.orm import Session

from core.cache import cache
from services.kubernetes_service import KubernetesService

logger = logging.getLogger(__name__)


# Canonical query set for LLM-serving metrics. Designed for LiteLLM-compatible
# exporters; works with vLLM/NIM via common labels when series exist.
#
# The template placeholder {lookup} is substituted with the PromQL label
# selector that constrains queries to the specific analyzer's monitored
# backends (e.g. {service=~"claude-sonnet|nova-micro"}).
#
# by(model) aggregates per-backend so the UI can overlay metrics onto the
# Traffic Distribution rows.
_QUERIES: dict[str, str] = {
    # Templates use the sentinel ``__LOOKUP__`` for the backend-selector
    # substitution. We cannot use str.format() because PromQL itself uses
    # literal { } for label selectors.
    "latency_p50_ms": (
        "histogram_quantile(0.50, sum by (le, model) ("
        "rate(litellm_request_latency_seconds_bucket{__LOOKUP__}[5m]))) * 1000"
    ),
    "latency_p95_ms": (
        "histogram_quantile(0.95, sum by (le, model) ("
        "rate(litellm_request_latency_seconds_bucket{__LOOKUP__}[5m]))) * 1000"
    ),
    "tokens_per_second": ("sum by (model) (rate(litellm_tokens_generated_total{__LOOKUP__}[1m]))"),
    "requests_per_minute": ("sum by (model) (rate(litellm_requests_total{__LOOKUP__}[1m])) * 60"),
    "error_rate_pct": (
        "100 * ("
        'sum by (model) (rate(litellm_requests_total{status=~"5..",__LOOKUP__}[5m])) '
        "/ clamp_min(sum by (model) (rate(litellm_requests_total{__LOOKUP__}[5m])), 1e-9)"
        ")"
    ),
}


# vLLM-shape fallback queries. Runs when the LiteLLM-named series are absent
# (e.g. custom shims / NIM / DeepSeek-compatible exporters that emit vllm:*
# metrics with a ``model_name`` label). label_replace normalises
# ``model_name`` → ``model`` so downstream aggregation and _extract_by_backend
# treat both families identically.
#
# Notes on equivalence:
#   - tokens_per_second uses rate(time_per_output_token_seconds_count), i.e.
#     one histogram observation per generated token — same shape as a
#     tokens counter.
#   - requests_per_minute uses the _count companion of the e2e latency
#     histogram — one observation per request.
#   - error_rate has no direct vllm equivalent (no status-code label), so
#     it is intentionally absent from this set; the UI renders null.
_QUERIES_VLLM: dict[str, str] = {
    "latency_p50_ms": (
        "histogram_quantile(0.50, sum by (le, model) (label_replace("
        "rate(vllm:e2e_request_latency_seconds_bucket{__LOOKUP__}[5m]),"
        '"model","$1","model_name","(.+)"))) * 1000'
    ),
    "latency_p95_ms": (
        "histogram_quantile(0.95, sum by (le, model) (label_replace("
        "rate(vllm:e2e_request_latency_seconds_bucket{__LOOKUP__}[5m]),"
        '"model","$1","model_name","(.+)"))) * 1000'
    ),
    "tokens_per_second": (
        "sum by (model) (label_replace("
        "rate(vllm:time_per_output_token_seconds_count{__LOOKUP__}[1m]),"
        '"model","$1","model_name","(.+)"))'
    ),
    "requests_per_minute": (
        "sum by (model) (label_replace("
        "rate(vllm:e2e_request_latency_seconds_count{__LOOKUP__}[1m]),"
        '"model","$1","model_name","(.+)")) * 60'
    ),
}


def _parse_prom_endpoint(endpoint: str) -> tuple[str, str, str, int] | None:
    """
    Parse an in-cluster Prometheus endpoint URL into (scheme, namespace, service, port).

    Accepts forms like:
      http://kube-prometheus-stack-prometheus.monitoring:9090
      http://prometheus.monitoring.svc.cluster.local:9090/prom
      https://prom.observability:9090
    Returns None if the URL doesn't look like an in-cluster service DNS name.
    """
    try:
        parsed = urllib.parse.urlparse(endpoint)
    except Exception:
        return None
    if not parsed.hostname:
        return None
    host = parsed.hostname
    parts = host.split(".")
    if len(parts) < 2:
        # Bare service name with no namespace — can't route
        return None
    service = parts[0]
    namespace = parts[1]
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    scheme = parsed.scheme or "http"
    return scheme, namespace, service, port


def _proxy_path(scheme: str, namespace: str, service: str, port: int, sub_path: str) -> str:
    """
    Build the K8s API-server service-proxy path for a Prometheus query.

    See: https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.28/#proxy-http-request-v1-core
    """
    # scheme prefix tells the proxy whether to tunnel as http or https
    scheme_prefix = "https:" if scheme == "https" else "http:"
    target = f"{scheme_prefix}{service}:{port}"
    # Strip leading slash from sub_path to avoid double slashes
    sp = sub_path.lstrip("/")
    return f"/api/v1/namespaces/{namespace}/services/{target}/proxy/{sp}"


def _extract_by_backend(
    result: dict[str, Any],
    backend_names: set[str],
    label_keys: tuple[str, ...] = ("model", "model_name", "service", "pool", "deployment"),
) -> dict[str, float]:
    """
    Convert a Prometheus vector response to ``{backend_name: value}``.

    Tries each candidate label key in order; first one present wins.
    """
    out: dict[str, float] = {}
    if not isinstance(result, dict) or result.get("status") != "success":
        return out
    data = result.get("data", {})
    if data.get("resultType") != "vector":
        return out
    for row in data.get("result", []) or []:
        metric = row.get("metric", {})
        name: str | None = None
        for key in label_keys:
            v = metric.get(key)
            if v:
                name = str(v)
                break
        if not name:
            # Unlabeled aggregate — skip (we only surface per-backend)
            continue
        if backend_names and name not in backend_names:
            continue
        try:
            val = float(row.get("value", [None, None])[1])
        except (TypeError, ValueError):
            continue
        out[name] = val
    return out


def _render_lookup(backend_names: set[str]) -> str:
    """
    Build a PromQL label selector matching any of the given backend names
    via the ``model`` label (LiteLLM convention). Empty set → empty selector.
    """
    if not backend_names:
        return ""
    pattern = "|".join(sorted(backend_names))
    return f'model=~"{pattern}"'


def _render_lookup_vllm(backend_names: set[str]) -> str:
    """
    Build a PromQL label selector matching any of the given backend names
    via the ``model_name`` label (vLLM / DeepSeek-compatible convention).
    Empty set → empty selector.
    """
    if not backend_names:
        return ""
    pattern = "|".join(sorted(backend_names))
    return f'model_name=~"{pattern}"'


_SAMPLE_RE = re.compile(
    r"^(?P<name>[a-zA-Z_:][a-zA-Z0-9_:]*)"
    r"(?:\{(?P<labels>[^}]*)\})?\s+"
    r"(?P<value>-?[0-9eE.+\-]+|NaN|\+?Inf|-Inf)\s*$"
)
_LABEL_RE = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"')


def _parse_prom_samples(text: str) -> list[tuple[str, dict[str, str], float]]:
    """Parse Prometheus text format into list of (metric_name, labels_dict, value)."""
    samples: list[tuple[str, dict[str, str], float]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = _SAMPLE_RE.match(line)
        if not m:
            continue
        labels = dict(_LABEL_RE.findall(m.group("labels") or ""))
        try:
            val = float(m.group("value"))
        except ValueError:
            continue
        samples.append((m.group("name"), labels, val))
    return samples


def _calc_histogram_quantile(
    samples: list[tuple[str, dict[str, str], float]],
    metric_name: str,
    quantile: float,
) -> float | None:
    """Calculate quantile from histogram bucket samples, returning value in milliseconds."""
    buckets: list[tuple[float, float]] = []
    for n, l, v in samples:
        if n == metric_name and "le" in l:
            try:
                le = float(l["le"])
            except ValueError:
                continue
            buckets.append((le, v))
    if not buckets:
        return None
    buckets.sort(key=lambda x: x[0])
    total = buckets[-1][1]
    if total <= 0:
        return None
    target = total * quantile
    prev_le = 0.0
    prev_count = 0.0
    for le, count in buckets:
        if count >= target:
            if count == prev_count:
                return le * 1000.0
            fraction = (target - prev_count) / (count - prev_count)
            return (prev_le + (le - prev_le) * fraction) * 1000.0
        prev_le = le
        prev_count = count
    return buckets[-1][0] * 1000.0


def _get_epp_runtime_metrics(
    api_client: Any,
    namespace: str,
    name: str,
    epp: dict[str, Any],
    cluster_id: int | None = None,
) -> dict[str, Any]:
    """
    Fetch and aggregate real-time inference telemetry for an F5EPP (BNK 2.4 F5 Endpoint Picker).
    Directly scrapes the InferencePool backend pods via K8s API service proxy.
    """
    spec = epp.get("spec") or {}
    status = epp.get("status") or {}
    engine = spec.get("engine", "vllm")
    block_size = spec.get("blockSize", 64)
    tokenizer = (spec.get("tokenizer") or {}).get("name", "")
    mode = spec.get("mode", "aggregated")
    pool_ref = spec.get("poolRef") or {}
    pool_name = pool_ref.get("name", "") if isinstance(pool_ref, dict) else str(pool_ref)
    conditions = status.get("conditions") or []

    # 1. Resolve InferencePool
    target_port = 8000
    selector: dict[str, str] = {}
    if pool_name:
        try:
            pool = api_client.call_api(
                resource_path=f"/apis/inference.networking.k8s.io/v1/namespaces/{namespace}/inferencepools/{pool_name}",
                method="GET",
                response_type="object",
                auth_settings=["BearerToken"],
                _return_http_data_only=True,
            )
            pool_spec = pool.get("spec") or {}
            selector = (pool_spec.get("selector") or {}).get("matchLabels") or {}
            ports = pool_spec.get("targetPorts") or []
            if ports and isinstance(ports[0], dict) and ports[0].get("number"):
                target_port = int(ports[0]["number"])
        except Exception as e:
            logger.debug("Failed to query InferencePool %s: %s", pool_name, e)

    # 2. Query Pods matching selector
    label_selector = ",".join(f"{k}={v}" for k, v in selector.items()) if selector else "app=vllm"
    pods: list[dict[str, Any]] = []
    try:
        pod_list = api_client.call_api(
            resource_path=f"/api/v1/namespaces/{namespace}/pods?labelSelector={label_selector}",
            method="GET",
            response_type="object",
            auth_settings=["BearerToken"],
            _return_http_data_only=True,
        )
        pods = pod_list.get("items") or []
    except Exception as e:
        logger.debug("Failed to query pods for selector %s: %s", label_selector, e)

    # 3. Scrape metrics from each pod
    endpoints: list[dict[str, Any]] = []
    per_backend: dict[str, dict[str, float | None]] = {}
    all_ttft_p50: list[float] = []
    all_ttft_p95: list[float] = []
    all_itl_p50: list[float] = []
    all_itl_p95: list[float] = []
    all_e2e_p50: list[float] = []
    all_e2e_p95: list[float] = []
    total_running = 0.0
    total_waiting = 0.0
    total_hits = 0.0
    total_queries = 0.0
    total_gen_tokens = 0.0
    total_prompt_tokens = 0.0
    total_success = 0.0
    kv_usages: list[float] = []

    for pod in pods:
        p_meta = pod.get("metadata") or {}
        p_name = p_meta.get("name", "unknown")
        p_status = pod.get("status") or {}
        p_ip = p_status.get("podIP", "10.0.0.1")
        p_phase = p_status.get("phase", "Running")

        samples: list[tuple[str, dict[str, str], float]] = []
        try:
            raw_text = api_client.call_api(
                resource_path=f"/api/v1/namespaces/{namespace}/pods/http:{p_name}:{target_port}/proxy/metrics",
                method="GET",
                auth_settings=["BearerToken"],
                _return_http_data_only=True,
                response_type="str",
            )
            samples = _parse_prom_samples(raw_text)
        except Exception as e:
            logger.debug("Pod %s metrics scrape failed: %s", p_name, e)

        if samples:
            ttft_p50 = _calc_histogram_quantile(samples, "vllm:time_to_first_token_seconds_bucket", 0.50)
            ttft_p95 = _calc_histogram_quantile(samples, "vllm:time_to_first_token_seconds_bucket", 0.95)
            itl_p50 = _calc_histogram_quantile(samples, "vllm:inter_token_latency_seconds_bucket", 0.50)
            itl_p95 = _calc_histogram_quantile(samples, "vllm:inter_token_latency_seconds_bucket", 0.95)
            e2e_p50 = _calc_histogram_quantile(samples, "vllm:e2e_request_latency_seconds_bucket", 0.50)
            e2e_p95 = _calc_histogram_quantile(samples, "vllm:e2e_request_latency_seconds_bucket", 0.95)
            kv_val = next((v * 100.0 for n, l, v in samples if n == "vllm:kv_cache_usage_perc"), 0.0)
            run_val = next((v for n, l, v in samples if n == "vllm:num_requests_running"), 0.0)
            wait_val = next((v for n, l, v in samples if n == "vllm:num_requests_waiting"), 0.0)
            h_val = next((v for n, l, v in samples if n == "vllm:prefix_cache_hits_total"), 0.0)
            q_val = next((v for n, l, v in samples if n == "vllm:prefix_cache_queries_total"), 0.0)
            gen_val = next((v for n, l, v in samples if n == "vllm:generation_tokens_total"), 0.0)
            p_val = next((v for n, l, v in samples if n == "vllm:prompt_tokens_total"), 0.0)
            succ_val = next((v for n, l, v in samples if n == "vllm:request_success_total"), 0.0)

            if ttft_p50 is not None:
                all_ttft_p50.append(ttft_p50)
            if ttft_p95 is not None:
                all_ttft_p95.append(ttft_p95)
            if itl_p50 is not None:
                all_itl_p50.append(itl_p50)
            if itl_p95 is not None:
                all_itl_p95.append(itl_p95)
            if e2e_p50 is not None:
                all_e2e_p50.append(e2e_p50)
            if e2e_p95 is not None:
                all_e2e_p95.append(e2e_p95)

            kv_usages.append(kv_val)
            total_running += run_val
            total_waiting += wait_val
            total_hits += h_val
            total_queries += q_val
            total_gen_tokens += gen_val
            total_prompt_tokens += p_val
            total_success += succ_val

            endpoints.append(
                {
                    "name": p_name,
                    "address": f"{p_ip}:{target_port}",
                    "phase": p_phase,
                    "status": "Healthy" if p_phase == "Running" else "Degraded",
                    "running": int(run_val),
                    "waiting": int(wait_val),
                    "kv_cache_used_pct": round(kv_val, 1),
                    "ttft_p95_ms": round(ttft_p95, 1) if ttft_p95 is not None else None,
                    "itl_p95_ms": round(itl_p95, 1) if itl_p95 is not None else None,
                    "tokens_generated": int(gen_val),
                    "requests_success": int(succ_val),
                    "traffic_pct": 0,  # computed below
                }
            )
            per_backend[p_name] = {
                "latency_p50_ms": e2e_p50,
                "latency_p95_ms": e2e_p95,
                "ttft_p50_ms": ttft_p50,
                "ttft_p95_ms": ttft_p95,
                "itl_p50_ms": itl_p50,
                "itl_p95_ms": itl_p95,
                "tokens_per_second": round(gen_val / max(1.0, succ_val), 1) if succ_val else None,
            }
        else:
            endpoints.append(
                {
                    "name": p_name,
                    "address": f"{p_ip}:{target_port}",
                    "phase": p_phase,
                    "status": "Healthy" if p_phase == "Running" else "Degraded",
                    "running": 0,
                    "waiting": 0,
                    "kv_cache_used_pct": 0.0,
                    "ttft_p95_ms": None,
                    "itl_p95_ms": None,
                    "tokens_generated": 0,
                    "requests_success": 0,
                    "traffic_pct": 0,
                }
            )
            per_backend[p_name] = {}

    # Calculate traffic distribution
    total_tokens_all = sum(ep.get("tokens_generated", 0) for ep in endpoints)
    if total_tokens_all > 0:
        for ep in endpoints:
            ep["traffic_pct"] = round((ep.get("tokens_generated", 0) / total_tokens_all) * 100)
    elif endpoints:
        even_share = round(100 / len(endpoints))
        for ep in endpoints:
            ep["traffic_pct"] = even_share

    # Calculate real-time rate metrics (TPS, RPM) via cached deltas over time
    now_ts = time.time()
    cache_key = f"epp:rate:{cluster_id or 'default'}:{namespace}:{name}"
    prev_state = None
    try:
        prev_state = cache.get(cache_key)
    except Exception as e:
        logger.debug("Failed to read rate cache for %s: %s", cache_key, e)

    output_tps = 0.0
    prompt_tps = 0.0
    total_tps = 0.0
    requests_per_minute = 0

    if isinstance(prev_state, dict):
        prev_time = prev_state.get("time", now_ts)
        prev_gen = prev_state.get("gen_tokens", total_gen_tokens)
        prev_prompt = prev_state.get("prompt_tokens", total_prompt_tokens)
        prev_success = prev_state.get("success", total_success)
        dt = now_ts - prev_time

        if dt >= 1.0:
            delta_gen = max(0.0, total_gen_tokens - prev_gen)
            delta_prompt = max(0.0, total_prompt_tokens - prev_prompt)
            delta_success = max(0.0, total_success - prev_success)

            if total_running == 0 and delta_gen == 0:
                output_tps = 0.0
                prompt_tps = 0.0
                total_tps = 0.0
                requests_per_minute = 0
            else:
                output_tps = round(delta_gen / dt, 1)
                prompt_tps = round(delta_prompt / dt, 1)
                total_tps = round((delta_gen + delta_prompt) / dt, 1)
                requests_per_minute = int(round((delta_success / dt) * 60.0))

            try:
                cache.set(
                    cache_key,
                    {
                        "time": now_ts,
                        "gen_tokens": total_gen_tokens,
                        "prompt_tokens": total_prompt_tokens,
                        "success": total_success,
                        "output_tps": output_tps,
                        "prompt_tps": prompt_tps,
                        "total_tps": total_tps,
                        "requests_per_minute": requests_per_minute,
                    },
                    ttl_seconds=300,
                )
            except Exception as e:
                logger.debug("Failed to write rate cache for %s: %s", cache_key, e)
        elif dt > 0.0:
            output_tps = prev_state.get("output_tps", 0.0)
            prompt_tps = prev_state.get("prompt_tps", 0.0)
            total_tps = prev_state.get("total_tps", 0.0)
            requests_per_minute = prev_state.get("requests_per_minute", 0)
    else:
        # First scrape: establish baseline in cache without fabricating rates from lifetime counters
        try:
            cache.set(
                cache_key,
                {
                    "time": now_ts,
                    "gen_tokens": total_gen_tokens,
                    "prompt_tokens": total_prompt_tokens,
                    "success": total_success,
                    "output_tps": 0.0,
                    "prompt_tps": 0.0,
                    "total_tps": 0.0,
                    "requests_per_minute": 0,
                },
                ttl_seconds=300,
            )
        except Exception as e:
            logger.debug("Failed to initialize rate cache for %s: %s", cache_key, e)

    is_active_traffic = bool(total_running > 0 or output_tps > 0)
    traffic_status = "active" if is_active_traffic else "idle"

    # Latencies recorded from Prometheus histogram buckets (historical/benchmark observations)
    avg_ttft_p50 = sum(all_ttft_p50) / len(all_ttft_p50) if all_ttft_p50 else None
    max_ttft_p95 = max(all_ttft_p95) if all_ttft_p95 else None
    avg_itl_p50 = sum(all_itl_p50) / len(all_itl_p50) if all_itl_p50 else None
    max_itl_p95 = max(all_itl_p95) if all_itl_p95 else None
    avg_e2e_p50 = sum(all_e2e_p50) / len(all_e2e_p50) if all_e2e_p50 else None
    max_e2e_p95 = max(all_e2e_p95) if all_e2e_p95 else None
    cache_hit_rate = (
        round((total_hits / max(1.0, total_hits + total_queries)) * 100.0, 1)
        if (total_hits + total_queries) > 0
        else 0.0
    )
    avg_kv_used = round(sum(kv_usages) / len(kv_usages), 1) if kv_usages else 0.0

    summary = {
        "traffic_status": traffic_status,
        "is_active_traffic": is_active_traffic,
        "ttft_p50_ms": round(avg_ttft_p50, 1) if avg_ttft_p50 is not None else None,
        "ttft_p95_ms": round(max_ttft_p95, 1) if max_ttft_p95 is not None else None,
        "itl_p50_ms": round(avg_itl_p50, 1) if avg_itl_p50 is not None else None,
        "itl_p95_ms": round(max_itl_p95, 1) if max_itl_p95 is not None else None,
        "latency_p50_ms": round(avg_e2e_p50, 1) if avg_e2e_p50 is not None else None,
        "latency_p95_ms": round(max_e2e_p95, 1) if max_e2e_p95 is not None else None,
        "output_tps": output_tps,
        "prompt_tps": prompt_tps,
        "total_tps": total_tps,
        "requests_per_minute": requests_per_minute,
        "cache_hit_rate_pct": cache_hit_rate,
        "kv_cache_usage_pct": avg_kv_used,
        "num_requests_running": int(total_running),
        "num_requests_waiting": int(total_waiting),
        "cumulative_total_tokens": int(total_gen_tokens),
        "cumulative_total_prompt_tokens": int(total_prompt_tokens),
        "cumulative_total_requests": int(total_success),
    }

    return {
        "available": True,
        "kind": "F5EPP",
        "name": name,
        "namespace": namespace,
        "epp_info": {
            "engine": engine,
            "block_size": block_size,
            "tokenizer": tokenizer,
            "mode": mode,
            "pool_name": pool_name,
            "target_port": target_port,
            "replicas": spec.get("replicas", 1),
            "status_conditions": conditions,
        },
        "summary": summary,
        "endpoints": endpoints,
        "backends": [ep["name"] for ep in endpoints],
        "per_backend": per_backend,
        "updated_at": datetime.now(UTC).isoformat(),
    }


def get_analyzer_runtime_metrics(
    db: Session,
    cluster_id: int,
    namespace: str,
    name: str,
) -> dict[str, Any]:
    """
    Fetch runtime metrics for one F5BigAnalyzer or F5EPP CR by proxying PromQL
    queries or direct pod proxy scrapes.

    Returns a dict shaped for direct UI consumption.
    """
    k8s_service = KubernetesService(db)
    cluster = k8s_service.get_cluster(cluster_id)
    api_client = k8s_service.load_kubeconfig(cluster)

    # --- 1. Load analyzer CR (try F5BigAnalyzer, then F5EPP) -------------------
    analyzer = None
    try:
        analyzer = api_client.call_api(
            resource_path=f"/apis/k8s.f5net.com/v1alpha1/namespaces/{namespace}/f5-big-analyzers/{name}",
            method="GET",
            response_type="object",
            auth_settings=["BearerToken"],
            _return_http_data_only=True,
        )
    except ApiException:
        # Fallback to F5EPP (BNK 2.4 F5 Endpoint Picker)
        try:
            epp = api_client.call_api(
                resource_path=f"/apis/inference.k8s.f5.com/v1alpha1/namespaces/{namespace}/f5-epps/{name}",
                method="GET",
                response_type="object",
                auth_settings=["BearerToken"],
                _return_http_data_only=True,
            )
            return _get_epp_runtime_metrics(api_client, namespace, name, epp, cluster_id=cluster_id)
        except ApiException as e2:
            return {
                "available": False,
                "reason": f"analyzer/EPP CR not found: {e2.reason}",
                "updated_at": datetime.now(UTC).isoformat(),
            }

    sources = (analyzer.get("spec") or {}).get("dataSources") or []
    if not sources:
        return {
            "available": False,
            "reason": "analyzer has no dataSources configured",
            "updated_at": datetime.now(UTC).isoformat(),
        }

    endpoint = sources[0].get("endpoint")
    parsed = _parse_prom_endpoint(endpoint) if endpoint else None
    if not parsed:
        return {
            "available": False,
            "reason": f"dataSource endpoint not recognisable as an in-cluster service: {endpoint}",
            "endpoint": endpoint,
            "updated_at": datetime.now(UTC).isoformat(),
        }

    scheme, ns, svc, port = parsed

    # --- 2. Discover backend names from spec.applications --------------------
    # For HTTPRoute applications, we'd need to resolve the route's backendRefs
    # to get the actual service/pod names used as metric labels. Keep simple
    # for now — pass the application names directly as potential label values.
    apps = (analyzer.get("spec") or {}).get("applications") or []
    backend_names: set[str] = set()
    for app in apps:
        if not isinstance(app, dict):
            continue
        app_name = app.get("name")
        app_ns = app.get("namespace", namespace)
        if not app_name:
            continue
        if not str(app.get("kind", "")).lower().startswith("httproute"):
            continue
        # Load the HTTPRoute and collect backend names
        try:
            route = api_client.call_api(
                resource_path=f"/apis/gateway.networking.k8s.io/v1/namespaces/{app_ns}/httproutes/{app_name}",
                method="GET",
                response_type="object",
                auth_settings=["BearerToken"],
                _return_http_data_only=True,
            )
        except ApiException:
            continue
        for rule in (route.get("spec") or {}).get("rules") or []:
            for ref in rule.get("backendRefs") or []:
                if ref.get("name"):
                    backend_names.add(str(ref["name"]))

    lookup_litellm = _render_lookup(backend_names)
    lookup_vllm = _render_lookup_vllm(backend_names)

    def _render(template: str, lookup: str) -> str:
        # Strip the empty-selector comma that appears when lookup is absent
        # (e.g. {status=~"5..",__LOOKUP__} → {status=~"5.."}). When lookup
        # is present, substitute as-is.
        if lookup:
            return template.replace("__LOOKUP__", lookup)
        return template.replace(",__LOOKUP__", "").replace("__LOOKUP__", "")

    query_path = _proxy_path(scheme, ns, svc, port, "api/v1/query")

    def _run(promql: str) -> tuple[dict[str, float] | None, str | None]:
        try:
            response = api_client.call_api(
                resource_path=query_path,
                method="GET",
                query_params=[("query", promql)],
                response_type="object",
                auth_settings=["BearerToken"],
                _return_http_data_only=True,
            )
        except ApiException as e:
            return None, f"{e.status} {e.reason}"
        except Exception as e:  # noqa: BLE001 — wide catch is the point
            return None, f"proxy error: {e}"
        return _extract_by_backend(response, backend_names), None

    # --- 3. Run PromQL queries via K8s service-proxy -------------------------
    #
    # Strategy: try the LiteLLM-shape query first. If it produces no data for
    # a backend, try the vLLM-shape equivalent (if one exists for that
    # metric). LiteLLM wins on ties — it's the canonical gateway shape; vLLM
    # fills in for custom shims that expose vllm:* series natively.
    per_backend: dict[str, dict[str, float | None]] = {b: {} for b in backend_names}
    errors: dict[str, str] = {}

    for metric_key, template in _QUERIES.items():
        merged: dict[str, float] = {}

        # 1. LiteLLM shape
        result, err = _run(_render(template, lookup_litellm))
        if err:
            errors[metric_key] = err
        elif result:
            merged.update(result)

        # 2. vLLM-shape fallback — fills gaps for backends LiteLLM didn't cover
        vllm_template = _QUERIES_VLLM.get(metric_key)
        if vllm_template is not None:
            vllm_result, vllm_err = _run(_render(vllm_template, lookup_vllm))
            if vllm_err and metric_key not in errors:
                errors[metric_key] = f"vllm: {vllm_err}"
            elif vllm_result:
                for backend_name, value in vllm_result.items():
                    merged.setdefault(backend_name, value)

        for backend_name in backend_names:
            per_backend.setdefault(backend_name, {})[metric_key] = merged.get(backend_name)

    return {
        "available": True,
        "endpoint": endpoint,
        "backends": sorted(backend_names),
        "per_backend": per_backend,
        "errors": errors,
        "updated_at": datetime.now(UTC).isoformat(),
    }
