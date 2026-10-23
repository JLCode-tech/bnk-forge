"""
AI-gateway observability — live LogQL proxy over the HGX Loki store.

The ``llm-gateway`` job writes one JSON log line per request into an
in-cluster Loki (``llm-egress/loki:3100``). This service builds LogQL,
routes each query through the cluster's K8s API-server service-proxy (so
Loki isn't externally exposed), and reshapes the result into the UI
contract. Mirrors ``analyzer_metrics_service.py`` (Prometheus proxy) one
for one: same proxy-path builder, same ``api_client.call_api`` call, same
graceful-degradation envelope.

Design notes:
  - Loki drops anything older than ~1h unless ``start``/``end`` are set
    explicitly. Every query pins both to nanoseconds derived from ``range``.
  - Cost / tokens / latency / hit% are already top-level fields on each log
    line — we aggregate them, never recompute cost from bodies.
  - A failing Loki call never raises to the UI: per-query errors land in the
    ``errors`` map; if every query for an endpoint fails, the whole response
    degrades to ``available: False`` with a ``reason``.
  - provider is *inferred* from the model name (no identity substrate in the
    stream yet), surfaced as such in the UI.
"""

from __future__ import annotations

import base64
import json
import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import UTC, datetime
from typing import Any, TypeVar

from kubernetes.client.rest import ApiException
from sqlalchemy.orm import Session

from core.config import settings
from models.kubernetes import KubernetesCluster
from services.kubernetes_service import KubernetesService
from services.reachability import ReachabilityState
from services.reachability import registry as reachability_registry

logger = logging.getLogger(__name__)

_CH_PW_CACHE: dict[int, str] = {}
_CH_NAMESPACE = "f5-cne-system"
_CH_SERVICE = "f5-aigateway-clickhouse"
_CH_PORT = 8123
_CH_ENDPOINT = f"http://{_CH_SERVICE}.{_CH_NAMESPACE}:{_CH_PORT}"


def _esc_sql(value: str) -> str:
    """Escape a string literal for ClickHouse SQL single-quoted strings."""
    return value.replace("\\", "\\\\").replace("'", "\\'")

# Presets → window length in seconds, and the query_range step used to bucket
# that window into ~100–200 points. Capped at 6 hours (21600s) for storage retention.
_RANGE_SECONDS: dict[str, int] = {"1h": 3600, "6h": 21600, "24h": 21600, "7d": 21600}
_STEP_SECONDS: dict[str, int] = {"1h": 60, "6h": 300, "24h": 300, "7d": 300}

_JOB = 'job="llm-gateway"'

_T = TypeVar("_T")

# Fleet ("all clusters") requests query at most this many clusters at once, and
# give up on stragglers after the deadline (reported per cluster in ``errors``).
_FLEET_WORKERS = 4
_FLEET_DEADLINE_SECONDS = 20.0

# Set inside a fleet worker: that worker runs its Loki calls serially, so a fleet
# request uses one bounded pool instead of a pool per cluster.
_serial = threading.local()


def _esc_logql(value: str) -> str:
    """Escape a user-supplied value for a LogQL double-quoted string literal.

    Neutralizes injection via ``model`` / ``status`` / ``content_search``: a
    value like ``x" |= "admin`` would otherwise break out of the quotes and
    alter query semantics. Escaping ``\\`` and ``"`` keeps it a literal.
    """
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _run_parallel(thunks: list[Callable[[], _T]]) -> list[_T]:
    """Run independent blocking Loki calls concurrently, preserving order.

    Each endpoint fans several roundtrips through the K8s API-server proxy;
    firing them together instead of sequentially cuts the worst case
    (``rankings`` = 10 instant queries) from N roundtrips to ~1.
    """
    if len(thunks) <= 1 or getattr(_serial, "active", False):
        return [t() for t in thunks]
    with ThreadPoolExecutor(max_workers=min(len(thunks), 12)) as ex:
        return list(ex.map(lambda t: t(), thunks))


def _proxy_path(scheme: str, namespace: str, service: str, port: int, sub_path: str) -> str:
    """Build the K8s API-server service-proxy path for a Loki query.

    Identical scheme to analyzer_metrics_service._proxy_path.
    """
    scheme_prefix = "https:" if scheme == "https" else "http:"
    target = f"{scheme_prefix}{service}:{port}"
    sp = sub_path.lstrip("/")
    return f"/api/v1/namespaces/{namespace}/services/{target}/proxy/{sp}"


def _provider_for(model: str) -> str:
    """Infer provider from model name. gpt/o1/o3/o4→openai, claude→anthropic,
    gemini→google, else unknown. Best-effort only — the stream has no identity."""
    m = (model or "").lower()
    if m.startswith(("gpt", "o1", "o3", "o4")):
        return "openai"
    if m.startswith("claude"):
        return "anthropic"
    if m.startswith("gemini"):
        return "google"
    return "unknown"


def _iso(epoch_s: float) -> str:
    return datetime.fromtimestamp(epoch_s, UTC).isoformat()


def _scalar(data: dict[str, Any] | None) -> float:
    """First sample of an instant-vector response, as a float (0.0 if empty)."""
    if not isinstance(data, dict):
        return 0.0
    result = (data.get("data") or {}).get("result") or []
    if not result:
        return 0.0
    try:
        return float(result[0]["value"][1])
    except (KeyError, IndexError, TypeError, ValueError):
        return 0.0


def _by_label(data: dict[str, Any] | None, label: str = "model") -> dict[str, float]:
    """Instant vector → {label_value: float}, dropping unlabeled/NaN rows."""
    out: dict[str, float] = {}
    if not isinstance(data, dict):
        return out
    for row in (data.get("data") or {}).get("result") or []:
        name = (row.get("metric") or {}).get(label)
        if not name:
            continue
        try:
            out[str(name)] = float(row["value"][1])
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    return out


def _matrix(data: dict[str, Any] | None) -> list[tuple[dict[str, str], list[dict[str, float]]]]:
    """query_range matrix → [(labels, [{ts, value}, ...]), ...]."""
    out: list[tuple[dict[str, str], list[dict[str, float]]]] = []
    if not isinstance(data, dict):
        return out
    for row in (data.get("data") or {}).get("result") or []:
        labels = row.get("metric") or {}
        points: list[dict[str, float]] = []
        for pair in row.get("values") or []:
            try:
                points.append({"ts": _iso(float(pair[0])), "value": float(pair[1])})
            except (IndexError, TypeError, ValueError):
                continue
        out.append((labels, points))
    return out


class LlmObservabilityService:
    """Live LogQL proxy for the ``llm-gateway`` request stream in one cluster."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self._k8s = KubernetesService(db)
        self._ns = settings.LOKI_NAMESPACE
        self._svc = settings.LOKI_SERVICE
        self._port = settings.LOKI_PORT
        self._scheme = settings.LOKI_SCHEME

    def _active_clusters(self, project_id: int | None = None) -> list[KubernetesCluster]:
        q = self.db.query(KubernetesCluster).filter(KubernetesCluster.status == "active")
        if project_id is not None:
            q = q.filter(KubernetesCluster.project_id == project_id)
        return q.order_by(KubernetesCluster.name.asc()).all()

    # -- endpoint / time helpers ------------------------------------------

    @property
    def _endpoint(self) -> str:
        return f"{self._scheme}://{self._svc}.{self._ns}:{self._port}"

    @staticmethod
    def _range_s(range_: str) -> int:
        return _RANGE_SECONDS.get(range_, 3600)

    @staticmethod
    def _step_s(range_: str) -> int:
        return _STEP_SECONDS.get(range_, 60)

    def _selector(
        self,
        model: str | None = None,
        status: str | None = None,
        status_re: str | None = None,
        not_status_re: str | None = None,
    ) -> str:
        parts = [_JOB]
        if model:
            parts.append(f'model="{_esc_logql(model)}"')
        if status:
            parts.append(f'status="{_esc_logql(status)}"')
        if status_re:
            parts.append(f'status=~"{status_re}"')
        if not_status_re:
            parts.append(f'status!~"{not_status_re}"')
        return "{" + ", ".join(parts) + "}"

    # -- Loki proxy calls -------------------------------------------------

    def _client(self, cluster_or_id: int | KubernetesCluster) -> Any:
        if isinstance(cluster_or_id, int):
            cluster = self._k8s.get_cluster(cluster_or_id)
            return self._k8s.load_kubeconfig(cluster)
        return self._k8s.load_kubeconfig(cluster_or_id)

    def _resolve_active_clients(
        self, errors: dict[str, str], project_id: int | None = None
    ) -> list[tuple[KubernetesCluster, Any]]:
        clients: list[tuple[KubernetesCluster, Any]] = []
        for c in self._active_clusters(project_id=project_id):
            if getattr(c, "connectivity_status", None) == "unreachable":
                errors[str(c.name)] = "unreachable"
                continue
            # Skip clusters the reachability probe already marks down.
            state = reachability_registry.get_state("cluster", c.id)
            if state and state.get("state") == ReachabilityState.UNREACHABLE:
                errors[str(c.name)] = "unreachable"
                continue
            try:
                clients.append((c, self._client(c)))
            except Exception as e:
                logger.warning("Failed to load kubeconfig for cluster %s: %s", c.name, e)
                errors[str(c.name)] = "kubeconfig"
        return clients

    def _fleet(
        self,
        per_cluster: Callable[[KubernetesCluster, Any], dict[str, Any]],
        project_id: int | None = None,
    ) -> tuple[list[tuple[KubernetesCluster, dict[str, Any]]], dict[str, str]]:
        """Run ``per_cluster`` on every active cluster in one bounded pool.

        Returns the available ``(cluster, result)`` pairs, in cluster order, and
        a ``{cluster_name: reason}`` map for clusters that failed, reported
        unavailable, or missed the overall deadline.
        """
        errors: dict[str, str] = {}
        cluster_clients = self._resolve_active_clients(errors, project_id=project_id)
        if not cluster_clients:
            return [], errors

        def run(c: KubernetesCluster, client: Any) -> dict[str, Any]:
            _serial.active = True
            try:
                return per_cluster(c, client)
            finally:
                _serial.active = False

        ex = ThreadPoolExecutor(max_workers=min(len(cluster_clients), _FLEET_WORKERS))
        try:
            futures = [(c, ex.submit(run, c, client)) for c, client in cluster_clients]
            done, _ = wait([f for _, f in futures], timeout=_FLEET_DEADLINE_SECONDS)
            pairs: list[tuple[KubernetesCluster, dict[str, Any]]] = []
            for c, fut in futures:
                name = str(c.name)
                if fut not in done:
                    errors[name] = f"timed out after {_FLEET_DEADLINE_SECONDS:.0f}s"
                    continue
                try:
                    r = fut.result()
                except Exception as e:
                    logger.warning("Fleet worker failed for cluster %s: %s", name, e)
                    errors[name] = "error"
                    continue
                if r.get("available"):
                    pairs.append((c, r))
                else:
                    errors[name] = r.get("reason") or "unavailable"
            return pairs, errors
        finally:
            ex.shutdown(wait=False, cancel_futures=True)

    def _fleet_unavailable(self, errors: dict[str, str]) -> dict[str, Any]:
        if not errors:
            return self._unavailable("No active Kubernetes clusters available")
        out = self._unavailable(next(iter(errors.values())))
        out["errors"] = errors
        return out

    def _call(
        self, api_client: Any, sub_path: str, params: list[tuple[str, str]]
    ) -> tuple[dict[str, Any] | None, str | None]:
        path = _proxy_path(self._scheme, self._ns, self._svc, self._port, sub_path)
        try:
            data = api_client.call_api(
                resource_path=path,
                method="GET",
                query_params=params,
                response_type="object",
                auth_settings=["BearerToken"],
                _return_http_data_only=True,
                _request_timeout=(5, 15),
            )
        except ApiException as e:
            return None, f"{e.status} {e.reason}"
        except Exception as e:  # noqa: BLE001 — wide catch is the point; never raise to UI
            return None, f"proxy error: {e}"
        return data, None

    def _instant(self, api_client: Any, query: str, time_ns: int) -> tuple[dict[str, Any] | None, str | None]:
        return self._call(
            api_client,
            "loki/api/v1/query",
            [("query", query), ("time", str(time_ns))],
        )

    def _range(
        self,
        api_client: Any,
        query: str,
        start_ns: int,
        end_ns: int,
        step_s: int,
        extra: list[tuple[str, str]] | None = None,
    ) -> tuple[dict[str, Any] | None, str | None]:
        params = [
            ("query", query),
            ("start", str(start_ns)),
            ("end", str(end_ns)),
            ("step", str(step_s)),
        ]
        if extra:
            params.extend(extra)
        return self._call(api_client, "loki/api/v1/query_range", params)

    def _unavailable(self, reason: str) -> dict[str, Any]:
        return {
            "available": False,
            "endpoint": self._endpoint,
            "reason": reason,
            "updated_at": datetime.now(UTC).isoformat(),
        }

    def _ok(self, **data: Any) -> dict[str, Any]:
        return {
            "available": True,
            "endpoint": self._endpoint,
            "updated_at": datetime.now(UTC).isoformat(),
            **data,
        }

    def _cached(self, key: str, compute: Callable[[], dict[str, Any]], use_cache: bool) -> dict[str, Any]:
        """Cache top-level service responses in Redis for 30s when available."""
        if not use_cache or not isinstance(self.db, Session):
            return compute()
        from core.cache import cache

        cached = cache.get(key)
        if cached is not None:
            return cached
        result = compute()
        if isinstance(result, dict) and result.get("available"):
            cache.set(key, result, ttl_seconds=30)
        return result

    # -- endpoints --------------------------------------------------------

    def stats(
        self,
        cluster_id: int | None,
        range_: str,
        model: str | None = None,
        status: str | None = None,
        _api_client: Any = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        cache_key = f"llm_obs:svc:stats:{cluster_id}:{project_id}:{range_}:{model}:{status}"
        return self._cached(
            cache_key,
            lambda: self._stats_uncached(
                cluster_id, range_, model=model, status=status, _api_client=_api_client, project_id=project_id
            ),
            use_cache=(_api_client is None),
        )

    def _stats_uncached(
        self,
        cluster_id: int | None,
        range_: str,
        model: str | None = None,
        status: str | None = None,
        _api_client: Any = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        if cluster_id is None:
            pairs, errors = self._fleet(
                lambda c, client: self.stats(c.id, range_, model, status, _api_client=client),
                project_id=project_id,
            )
            if not pairs:
                return self._fleet_unavailable(errors)
            valid = [r for _, r in pairs]
            total_requests = sum(v.get("total_requests", 0) for v in valid)
            total_tokens = sum(v.get("total_tokens", 0) for v in valid)
            total_cost = sum(v.get("total_cost", 0.0) for v in valid)
            # Per-cluster `models` is already a COUNT of distinct models on that
            # cluster, so a true distinct union across the fleet is not computable
            # from these inputs (we'd need the model names, which stats does not
            # return). Summing gives an upper bound of "models in use across the
            # fleet" (overcounts when clusters share models); it matches the
            # generic "Models" stat-tile far better than max(), which silently
            # understated the fleet whenever clusters ran disjoint model sets.
            total_models = sum(v.get("models", 0) for v in valid)
            if total_requests > 0:
                success_rate = (
                    sum(v.get("success_rate", 0.0) * v.get("total_requests", 0) for v in valid) / total_requests
                )
                avg_latency_ms = (
                    sum(v.get("avg_latency_ms", 0.0) * v.get("total_requests", 0) for v in valid) / total_requests
                )
            else:
                success_rate = 0.0
                avg_latency_ms = 0.0
            return self._ok(
                total_requests=int(total_requests),
                success_rate=success_rate,
                avg_latency_ms=avg_latency_ms,
                total_tokens=int(total_tokens),
                total_cost=total_cost,
                models=int(total_models),
                errors=errors,
            )

        api_client = _api_client if _api_client is not None else self._client(cluster_id)
        if cluster_id in _CH_PW_CACHE:
            ch_res = self._stats_clickhouse(cluster_id, api_client, range_, model, status)
            if ch_res is not None:
                return ch_res
        end_ns = time.time_ns()
        rng = f"{self._range_s(range_)}s"
        sel = self._selector(model, status)
        # success numerator = the filtered slice AND 2xx, so success_rate reflects
        # the caller's status filter instead of the whole window.
        sel_ok = self._selector(model, status, status_re="2..")

        queries: dict[str, str] = {
            "total_requests": f"sum(count_over_time({sel}[{rng}]))",
            "success": f"sum(count_over_time({sel_ok}[{rng}]))",
            "avg_latency_ms": f"avg(avg_over_time({sel} | json | unwrap latency_ms [{rng}]))",
            "total_tokens": f"sum(sum_over_time({sel} | json | unwrap total_tk [{rng}]))",
            "total_cost": f"sum(sum_over_time({sel} | json | unwrap cost [{rng}]))",
            "models": f"count(count by (model)(count_over_time({sel}[{rng}])))",
        }

        keys = list(queries)
        results = _run_parallel([lambda q=queries[k]: self._instant(api_client, q, end_ns) for k in keys])
        errors: dict[str, str] = {}
        values: dict[str, float] = {}
        for key, (data, err) in zip(keys, results, strict=True):
            if err:
                errors[key] = err
            else:
                values[key] = _scalar(data)

        if len(errors) == len(queries):
            ch_res = self._stats_clickhouse(cluster_id, api_client, range_, model, status)
            if ch_res is not None:
                return ch_res
            return self._unavailable(next(iter(errors.values())))

        total = values.get("total_requests", 0.0)
        success = values.get("success", 0.0)
        return self._ok(
            total_requests=int(total),
            success_rate=(success / total) if total else 0.0,
            avg_latency_ms=values.get("avg_latency_ms", 0.0),
            total_tokens=int(values.get("total_tokens", 0.0)),
            total_cost=values.get("total_cost", 0.0),
            models=int(values.get("models", 0.0)),
            errors=errors,
        )

    def histogram(
        self,
        cluster_id: int | None,
        range_: str,
        metric: str,
        model: str | None = None,
        status: str | None = None,
        _api_client: Any = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        cache_key = f"llm_obs:svc:histogram:{cluster_id}:{project_id}:{range_}:{metric}:{model}:{status}"
        return self._cached(
            cache_key,
            lambda: self._histogram_uncached(
                cluster_id, range_, metric, model=model, status=status, _api_client=_api_client, project_id=project_id
            ),
            use_cache=(_api_client is None),
        )

    def _histogram_uncached(
        self,
        cluster_id: int | None,
        range_: str,
        metric: str,
        model: str | None = None,
        status: str | None = None,
        _api_client: Any = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        if cluster_id is None:
            valid, errors = self._fleet(
                lambda c, client: self.histogram(c.id, range_, metric, model, status, _api_client=client),
                project_id=project_id,
            )
            if not valid:
                return self._fleet_unavailable(errors)
            step_s = valid[0][1].get("step_s", self._step_s(range_))

            if metric == "latency":
                # Aggregate real latency percentiles and TTFT across all active clusters without forward-fill.
                lat_buckets: dict[str, dict[str, list[float]]] = {}
                for _, r in valid:
                    for s in r.get("series", []):
                        s_name = s.get("name", "")
                        if not s_name:
                            continue
                        bmap = lat_buckets.setdefault(s_name, {})
                        for p in s.get("points", []):
                            ts = p.get("ts", "")
                            val = float(p.get("value") or 0.0)
                            if ts and val > 0:
                                bmap.setdefault(ts, []).append(val)
                ordered_keys = ["p95", "p50", "avg", "ttft_ms"]
                for k in lat_buckets:
                    if k not in ordered_keys:
                        ordered_keys.append(k)
                fleet_lat_series = []
                for k in ordered_keys:
                    bmap = lat_buckets.get(k)
                    if not bmap:
                        continue
                    pts = [
                        {"ts": ts, "value": round(sum(vals) / len(vals), 2)}
                        for ts, vals in sorted(bmap.items())
                        if vals
                    ]
                    fleet_lat_series.append({"name": k, "points": pts})
                return self._ok(metric=metric, step_s=step_s, series=fleet_lat_series, errors=errors)

            series_map: dict[str, dict[str, float]] = {}
            for _, r in valid:
                for s in r.get("series", []):
                    s_name = s.get("name", "")
                    if s_name not in series_map:
                        series_map[s_name] = {}
                    for p in s.get("points", []):
                        ts = p.get("ts", "")
                        series_map[s_name][ts] = series_map[s_name].get(ts, 0.0) + p.get("value", 0.0)
            all_ts = sorted({ts for pts in series_map.values() for ts in pts if ts})
            merged_series = []
            for s_name, points_dict in sorted(series_map.items()):
                points = [{"ts": ts, "value": points_dict.get(ts, 0.0)} for ts in all_ts]
                merged_series.append({"name": s_name, "points": points})
            return self._ok(metric=metric, step_s=step_s, series=merged_series, errors=errors)

        api_client = _api_client if _api_client is not None else self._client(cluster_id)
        step_s = self._step_s(range_)
        end_s = (int(time.time()) // step_s) * step_s
        end_ns = end_s * 1_000_000_000
        start_ns = (end_s - self._range_s(range_)) * 1_000_000_000
        step = f"{step_s}s"
        sel = self._selector(model, status)

        # Each metric maps to one or more named LogQL series.
        specs: dict[str, list[tuple[str, str]]] = {
            "requests": [
                ("success", f"sum(count_over_time({self._selector(model, status_re='2..')}[{step}]))"),
                ("error", f"sum(count_over_time({self._selector(model, not_status_re='2..')}[{step}]))"),
            ],
            "tokens": [
                ("prompt", f"sum(sum_over_time({sel} | json | unwrap prompt_tk [{step}]))"),
                ("completion", f"sum(sum_over_time({sel} | json | unwrap comp_tk [{step}]))"),
                ("cached", f"sum(sum_over_time({sel} | json | unwrap cached [{step}]))"),
            ],
            "cost": [("__by_model__", f"sum by (model)(sum_over_time({sel} | json | unwrap cost [{step}]))")],
            "models": [("__by_model__", f"count by (model)(count_over_time({sel}[{step}]))")],
            "latency": [
                ("avg", f"avg(avg_over_time({sel} | json | unwrap latency_ms [{step}]))"),
                ("p90", f"quantile_over_time(0.9, {sel} | json | unwrap latency_ms [{step}])"),
                ("p95", f"quantile_over_time(0.95, {sel} | json | unwrap latency_ms [{step}])"),
                ("p99", f"quantile_over_time(0.99, {sel} | json | unwrap latency_ms [{step}])"),
            ],
        }
        if metric not in specs:
            return self._unavailable(f"unknown metric: {metric}")

        if cluster_id in _CH_PW_CACHE:
            ch_res = self._histogram_clickhouse(cluster_id, api_client, range_, metric, model, status)
            if ch_res is not None:
                return ch_res

        series, errors = self._collect_series(api_client, specs[metric], start_ns, end_ns, step_s)
        if series is None:
            ch_res = self._histogram_clickhouse(cluster_id, api_client, range_, metric, model, status)
            if ch_res is not None:
                return ch_res
            return self._unavailable(next(iter(errors.values())))
        return self._ok(metric=metric, step_s=step_s, series=series, errors=errors)

    def _collect_series(
        self,
        api_client: Any,
        specs: list[tuple[str, str]],
        start_ns: int,
        end_ns: int,
        step_s: int,
        fold_provider: bool = False,
        fold_mean: bool = False,
    ) -> tuple[list[dict[str, Any]] | None, dict[str, str]]:
        """Run each (name, query) as a query_range and reshape to series.

        ``__by_model__`` fans the matrix out to one series per label (model, or
        provider when ``fold_provider``). ``fold_mean`` averages folded points
        instead of summing (latency). Returns (None, errors) when every query
        failed so the caller can degrade the whole response.
        """
        series: list[dict[str, Any]] = []
        errors: dict[str, str] = {}
        call_results = _run_parallel(
            [lambda q=query: self._range(api_client, q, start_ns, end_ns, step_s) for _, query in specs]
        )
        for (name, _query), (data, err) in zip(specs, call_results, strict=True):
            if err:
                errors[name] = err
                continue
            matrix = _matrix(data)
            if name == "__by_model__":
                series.extend(self._fold(matrix, fold_provider, fold_mean))
            else:
                points = matrix[0][1] if matrix else []
                series.append({"name": name, "points": points})

        if errors and not series:
            return None, errors
        return series, errors

    @staticmethod
    def _fold(
        matrix: list[tuple[dict[str, str], list[dict[str, float]]]],
        by_provider: bool,
        mean: bool,
    ) -> list[dict[str, Any]]:
        """Fold per-model matrix rows into per-model or per-provider series."""
        # key -> ts -> list of values (list so we can mean or sum)
        agg: dict[str, dict[str, list[float]]] = {}
        for labels, points in matrix:
            model = labels.get("model", "unknown")
            key = _provider_for(model) if by_provider else model
            bucket = agg.setdefault(key, {})
            for p in points:
                bucket.setdefault(p["ts"], []).append(p["value"])
        out: list[dict[str, Any]] = []
        for key in sorted(agg):
            pts = [
                {"ts": ts, "value": (sum(vals) / len(vals)) if mean else sum(vals)}
                for ts, vals in sorted(agg[key].items())
            ]
            out.append({"name": key, "points": pts})
        return out

    def provider_usage(
        self,
        cluster_id: int | None,
        range_: str,
        metric: str,
        model: str | None = None,
        status: str | None = None,
        _api_client: Any = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        cache_key = f"llm_obs:svc:provider_usage:{cluster_id}:{project_id}:{range_}:{metric}:{model}:{status}"
        return self._cached(
            cache_key,
            lambda: self._provider_usage_uncached(
                cluster_id, range_, metric, model=model, status=status, _api_client=_api_client, project_id=project_id
            ),
            use_cache=(_api_client is None),
        )

    def _provider_usage_uncached(
        self,
        cluster_id: int | None,
        range_: str,
        metric: str,
        model: str | None = None,
        status: str | None = None,
        _api_client: Any = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        if cluster_id is None:
            pairs, errors = self._fleet(
                lambda c, client: self.provider_usage(c.id, range_, metric, model, status, _api_client=client),
                project_id=project_id,
            )
            if not pairs:
                return self._fleet_unavailable(errors)
            valid = [r for _, r in pairs]
            step_s = valid[0].get("step_s", self._step_s(range_))
            if metric == "latency":
                series_vals: dict[str, dict[str, list[float]]] = {}
                for r in valid:
                    for s in r.get("series", []):
                        s_name = s.get("name", "")
                        if s_name not in series_vals:
                            series_vals[s_name] = {}
                        for p in s.get("points", []):
                            ts = p.get("ts", "")
                            series_vals[s_name].setdefault(ts, []).append(p.get("value", 0.0))
                all_ts = sorted({ts for pts in series_vals.values() for ts in pts if ts})
                merged_series = []
                for s_name, points_dict in sorted(series_vals.items()):
                    first_nz = next(
                        ((sum(v) / len(v)) for _, v in sorted(points_dict.items()) if v and sum(v) > 0),
                        0.0,
                    )
                    last_v = first_nz
                    points = []
                    for ts in all_ts:
                        vals = points_dict.get(ts)
                        if vals:
                            v = sum(vals) / len(vals)
                            if v > 0:
                                last_v = v
                            points.append({"ts": ts, "value": v})
                        else:
                            points.append({"ts": ts, "value": last_v})
                    merged_series.append({"name": s_name, "points": points})
                return self._ok(metric=metric, step_s=step_s, series=merged_series, errors=errors)

            series_map: dict[str, dict[str, float]] = {}
            for r in valid:
                for s in r.get("series", []):
                    s_name = s.get("name", "")
                    if s_name not in series_map:
                        series_map[s_name] = {}
                    for p in s.get("points", []):
                        ts = p.get("ts", "")
                        series_map[s_name][ts] = series_map[s_name].get(ts, 0.0) + p.get("value", 0.0)
            all_ts = sorted({ts for pts in series_map.values() for ts in pts if ts})
            merged_series = []
            for s_name, points_dict in sorted(series_map.items()):
                points = [{"ts": ts, "value": points_dict.get(ts, 0.0)} for ts in all_ts]
                merged_series.append({"name": s_name, "points": points})
            return self._ok(metric=metric, step_s=step_s, series=merged_series, errors=errors)

        api_client = _api_client if _api_client is not None else self._client(cluster_id)
        step_s = self._step_s(range_)
        end_s = (int(time.time()) // step_s) * step_s
        end_ns = end_s * 1_000_000_000
        start_ns = (end_s - self._range_s(range_)) * 1_000_000_000
        step = f"{step_s}s"
        sel = self._selector(model, status)

        by_model = {
            "cost": f"sum by (model)(sum_over_time({sel} | json | unwrap cost [{step}]))",
            "tokens": f"sum by (model)(sum_over_time({sel} | json | unwrap total_tk [{step}]))",
            "latency": f"avg by (model)(avg_over_time({sel} | json | unwrap latency_ms [{step}]))",
        }
        if metric not in by_model:
            return self._unavailable(f"unknown metric: {metric}")

        if cluster_id in _CH_PW_CACHE:
            ch_res = self._provider_usage_clickhouse(cluster_id, api_client, range_, metric, model, status)
            if ch_res is not None:
                return ch_res

        # latency folds by mean across models of a provider; cost/tokens sum.
        series, errors = self._collect_series(
            api_client,
            [("__by_model__", by_model[metric])],
            start_ns,
            end_ns,
            step_s,
            fold_provider=True,
            fold_mean=(metric == "latency"),
        )
        if series is None:
            ch_res = self._provider_usage_clickhouse(cluster_id, api_client, range_, metric, model, status)
            if ch_res is not None:
                return ch_res
            return self._unavailable(next(iter(errors.values())))
        return self._ok(metric=metric, step_s=step_s, series=series, errors=errors)

    def rankings(
        self,
        cluster_id: int | None,
        range_: str,
        model: str | None = None,
        status: str | None = None,
        _api_client: Any = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        cache_key = f"llm_obs:svc:rankings:{cluster_id}:{project_id}:{range_}:{model}:{status}"
        return self._cached(
            cache_key,
            lambda: self._rankings_uncached(
                cluster_id, range_, model=model, status=status, _api_client=_api_client, project_id=project_id
            ),
            use_cache=(_api_client is None),
        )

    def _rankings_uncached(
        self,
        cluster_id: int | None,
        range_: str,
        model: str | None = None,
        status: str | None = None,
        _api_client: Any = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        if cluster_id is None:
            pairs, errors = self._fleet(
                lambda c, client: self.rankings(c.id, range_, model, status, _api_client=client),
                project_id=project_id,
            )
            if not pairs:
                return self._fleet_unavailable(errors)
            valid = [r for _, r in pairs]
            models_acc: dict[str, dict[str, Any]] = {}
            for r in valid:
                for row in r.get("rows", []):
                    m = row["model"]
                    if m not in models_acc:
                        models_acc[m] = {
                            "model": m,
                            "provider": row["provider"],
                            "requests": 0,
                            "tokens": 0,
                            "cost": 0.0,
                            "total_latency_weighted": 0.0,
                            "success_weighted": 0.0,
                            "trend": row.get("trend", {}),
                        }
                    acc = models_acc[m]
                    reqs = row.get("requests", 0)
                    acc["requests"] += reqs
                    acc["tokens"] += row.get("tokens", 0)
                    acc["cost"] += row.get("cost", 0.0)
                    acc["total_latency_weighted"] += row.get("avg_latency_ms", 0.0) * reqs
                    acc["success_weighted"] += row.get("success_rate", 0.0) * reqs
            rows = []
            for m, acc in models_acc.items():
                reqs = acc["requests"]
                rows.append(
                    {
                        "model": m,
                        "provider": acc["provider"],
                        "requests": reqs,
                        "success_rate": (acc["success_weighted"] / reqs) if reqs else 0.0,
                        "tokens": acc["tokens"],
                        "cost": acc["cost"],
                        "avg_latency_ms": (acc["total_latency_weighted"] / reqs) if reqs else 0.0,
                        "trend": acc["trend"],
                    }
                )
            rows.sort(key=lambda x: x["requests"], reverse=True)
            return self._ok(rows=rows, errors=errors)

        api_client = _api_client if _api_client is not None else self._client(cluster_id)
        if cluster_id in _CH_PW_CACHE:
            ch_res = self._rankings_clickhouse(cluster_id, api_client, range_, model, status)
            if ch_res is not None:
                return ch_res
        rng_s = self._range_s(range_)
        rng = f"{rng_s}s"
        cur_ns = time.time_ns()
        prev_ns = cur_ns - rng_s * 1_000_000_000  # previous window ends where current starts
        sel = self._selector(model, status)
        sel_ok = self._selector(model, status, status_re="2..")

        metrics = {
            "requests": f"sum by (model)(count_over_time({sel}[{rng}]))",
            "tokens": f"sum by (model)(sum_over_time({sel} | json | unwrap total_tk [{rng}]))",
            "cost": f"sum by (model)(sum_over_time({sel} | json | unwrap cost [{rng}]))",
            "latency": f"avg by (model)(avg_over_time({sel} | json | unwrap latency_ms [{rng}]))",
            "success": f"sum by (model)(count_over_time({sel_ok}[{rng}]))",
        }

        # Fire current + previous window for every metric concurrently (10 calls).
        keys = list(metrics)
        cur_res = _run_parallel([lambda q=metrics[k]: self._instant(api_client, q, cur_ns) for k in keys])
        prev_res = _run_parallel([lambda q=metrics[k]: self._instant(api_client, q, prev_ns) for k in keys])
        errors: dict[str, str] = {}
        cur: dict[str, dict[str, float]] = {}
        prev: dict[str, dict[str, float]] = {}
        for key, (cdata, cerr) in zip(keys, cur_res, strict=True):
            if cerr:
                errors[key] = cerr
            else:
                cur[key] = _by_label(cdata)
        for key, (_pdata, perr) in zip(keys, prev_res, strict=True):
            if not perr:
                prev[key] = _by_label(_pdata)

        if len(errors) == len(metrics):
            ch_res = self._rankings_clickhouse(cluster_id, api_client, range_, model, status)
            if ch_res is not None:
                return ch_res
            return self._unavailable(next(iter(errors.values())))

        rows = self._rank_rows(cur, prev)
        return self._ok(rows=rows, errors=errors)

    @staticmethod
    def _rank_rows(cur: dict[str, dict[str, float]], prev: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
        def _trend(model: str, key: str) -> float | None:
            c = cur.get(key, {}).get(model, 0.0)
            p = prev.get(key, {}).get(model, 0.0)
            return ((c - p) / p) if p else None

        models = sorted(cur.get("requests", {}))
        rows: list[dict[str, Any]] = []
        for m in models:
            requests = cur.get("requests", {}).get(m, 0.0)
            success = cur.get("success", {}).get(m, 0.0)
            rows.append(
                {
                    "model": m,
                    "provider": _provider_for(m),
                    "requests": int(requests),
                    "success_rate": (success / requests) if requests else 0.0,
                    "tokens": int(cur.get("tokens", {}).get(m, 0.0)),
                    "cost": cur.get("cost", {}).get(m, 0.0),
                    "avg_latency_ms": cur.get("latency", {}).get(m, 0.0),
                    "trend": {
                        "requests": _trend(m, "requests"),
                        "tokens": _trend(m, "tokens"),
                        "cost": _trend(m, "cost"),
                    },
                }
            )
        rows.sort(key=lambda r: r["requests"], reverse=True)
        return rows

    def logs(
        self,
        cluster_id: int | None,
        range_: str,
        model: str | None = None,
        status: str | None = None,
        limit: int = 50,
        content_search: str | None = None,
        end: int | None = None,
        _api_client: Any = None,
        _cluster: KubernetesCluster | None = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        limit = max(1, min(limit, 1000))
        cache_key = (
            f"llm_obs:svc:logs:{cluster_id}:{project_id}:{range_}:{model}:{status}:{limit}:{content_search}:{end}"
        )
        return self._cached(
            cache_key,
            lambda: self._logs_uncached(
                cluster_id,
                range_,
                model=model,
                status=status,
                limit=limit,
                content_search=content_search,
                end=end,
                _api_client=_api_client,
                _cluster=_cluster,
                project_id=project_id,
            ),
            use_cache=(_api_client is None),
        )

    def _logs_uncached(
        self,
        cluster_id: int | None,
        range_: str,
        model: str | None = None,
        status: str | None = None,
        limit: int = 50,
        content_search: str | None = None,
        end: int | None = None,
        _api_client: Any = None,
        _cluster: KubernetesCluster | None = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        if cluster_id is None:
            pairs, errors = self._fleet(
                lambda c, client: self.logs(
                    c.id,
                    range_,
                    model,
                    status,
                    limit,
                    content_search,
                    end,
                    _api_client=client,
                    _cluster=c,
                    project_id=project_id,
                ),
                project_id=project_id,
            )
            if not pairs:
                return self._fleet_unavailable(errors)
            valid = [r for _, r in pairs]
            all_rows: list[dict[str, Any]] = []
            for r in valid:
                all_rows.extend(r.get("rows", []))
            all_rows.sort(key=lambda x: x.get("ts_ns") or x.get("ts", ""), reverse=True)
            trimmed = all_rows[:limit]
            if project_id is None:
                for row in trimmed:
                    row["req_body"] = "[REDACTED - project scope required]"
                    row["resp_body"] = "[REDACTED - project scope required]"
            next_end = None
            if len(all_rows) >= limit and trimmed:
                oldest_row = trimmed[-1]
                oldest_ns = oldest_row.get("ts_ns")
                if oldest_ns is None and oldest_row.get("ts"):
                    try:
                        import datetime

                        dt = datetime.datetime.fromisoformat(oldest_row["ts"].replace("Z", "+00:00"))
                        oldest_ns = int(dt.timestamp() * 1_000_000_000)
                    except Exception:
                        pass
                if oldest_ns is not None:
                    next_end = str(oldest_ns - 1)
            return self._ok(rows=trimmed, next_end=next_end, errors=errors)

        api_client = _api_client if _api_client is not None else self._client(cluster_id)
        if _cluster is not None:
            cluster_name = _cluster.name
        else:
            cluster = self._k8s.get_cluster(cluster_id)
            cluster_name = cluster.name if cluster else f"cluster-{cluster_id}"
        end_ns = end if end else time.time_ns()
        start_ns = end_ns - self._range_s(range_) * 1_000_000_000

        sel = self._selector(model, status)
        line_filter = f' |= "{_esc_logql(content_search)}"' if content_search else ""
        query = f"{sel}{line_filter} | json"

        data, err = self._range(
            api_client,
            query,
            start_ns,
            end_ns,
            self._step_s(range_),
            extra=[("limit", str(limit)), ("direction", "backward")],
        )
        if err:
            ch_res = self._logs_clickhouse(
                cluster_id, api_client, cluster_name, range_, model, status, limit, content_search, end
            )
            if ch_res is not None:
                return ch_res
            return self._unavailable(err)

        rows, oldest_ns = self._parse_log_lines(data)
        for r in rows:
            r["cluster_id"] = cluster_id
            r["cluster_name"] = cluster_name
        next_end = str(oldest_ns - 1) if (oldest_ns is not None and len(rows) >= limit) else None
        return self._ok(rows=rows, next_end=next_end, errors={})

    @staticmethod
    def _parse_log_lines(data: dict[str, Any] | None) -> tuple[list[dict[str, Any]], int | None]:
        """Flatten Loki streams into request rows, newest first. Returns
        (rows, oldest_ts_ns) — the cursor for 'load older'."""
        entries: list[tuple[int, str, dict]] = []
        if isinstance(data, dict):
            for stream in (data.get("data") or {}).get("result") or []:
                stream_labels = stream.get("stream", {})
                for pair in stream.get("values") or []:
                    try:
                        entries.append((int(pair[0]), pair[1], stream_labels))
                    except (IndexError, TypeError, ValueError):
                        continue
        entries.sort(key=lambda e: e[0], reverse=True)  # newest first

        rows: list[dict[str, Any]] = []
        for ts_ns, line, stream_labels in entries:
            try:
                rec = json.loads(line)
            except (TypeError, ValueError):
                continue
            model = str(rec.get("model") or stream_labels.get("model") or "")
            status = str(rec.get("status") or stream_labels.get("status") or "")
            rows.append(
                {
                    "ts": _iso(ts_ns / 1_000_000_000),
                    "ts_ns": ts_ns,
                    "type": "success" if status.startswith("2") else "error",
                    "message": str(rec.get("userq", "")),
                    "model": model,
                    "latency_ms": float(rec.get("latency_ms", 0) or 0),
                    "prompt_tk": int(rec.get("prompt_tk", 0) or 0),
                    "comp_tk": int(rec.get("comp_tk", 0) or 0),
                    "total_tk": int(rec.get("total_tk", 0) or 0),
                    "cost": float(rec.get("cost", 0) or 0),
                    "status": status,
                    "req_body": str(rec.get("req_body", "")),
                    "resp_body": str(rec.get("resp_body", "")),
                }
            )
        oldest_ns = entries[-1][0] if entries else None
        return rows, oldest_ns

    def filterdata(
        self,
        cluster_id: int | None,
        range_: str,
        _api_client: Any = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        cache_key = f"llm_obs:svc:filterdata:{cluster_id}:{project_id}:{range_}"
        return self._cached(
            cache_key,
            lambda: self._filterdata_uncached(cluster_id, range_, _api_client=_api_client, project_id=project_id),
            use_cache=(_api_client is None),
        )

    def _filterdata_uncached(
        self,
        cluster_id: int | None,
        range_: str,
        _api_client: Any = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        if cluster_id is None:
            pairs, errors = self._fleet(
                lambda c, client: self.filterdata(c.id, range_, _api_client=client),
                project_id=project_id,
            )
            if not pairs:
                return self._fleet_unavailable(errors)
            valid = [r for _, r in pairs]
            models = sorted(set(m for r in valid for m in r.get("models", [])))
            statuses = sorted(set(s for r in valid for s in r.get("statuses", [])))
            return self._ok(models=models, statuses=statuses, errors=errors)

        api_client = _api_client if _api_client is not None else self._client(cluster_id)
        end_ns = time.time_ns()
        start_ns = end_ns - self._range_s(range_) * 1_000_000_000
        bounds = [("start", str(start_ns)), ("end", str(end_ns))]

        labels = ("model", "status")
        call_results = _run_parallel(
            [lambda lb=lb: self._call(api_client, f"loki/api/v1/label/{lb}/values", bounds) for lb in labels]
        )
        errors: dict[str, str] = {}
        result: dict[str, list[str]] = {}
        for label, (data, err) in zip(labels, call_results, strict=True):
            if err:
                errors[label] = err
            else:
                values = data.get("data") if isinstance(data, dict) else None
                result[label] = sorted(str(v) for v in (values or []))

        if len(errors) == 2:
            ch_res = self._filterdata_clickhouse(cluster_id, api_client, range_)
            if ch_res is not None:
                return ch_res
            return self._unavailable(next(iter(errors.values())))
        return self._ok(
            models=result.get("model", []),
            statuses=result.get("status", []),
            errors=errors,
        )

    # -- BNK 2.4.1 ClickHouse (otel.aigw_requests) fallback ---------------

    def _ch_password(self, cluster_id: int, api_client: Any) -> str | None:
        if cluster_id in _CH_PW_CACHE:
            return _CH_PW_CACHE[cluster_id]
        for ns, sec_name, key in (
            (_CH_NAMESPACE, "f5-aigateway-clickhouse-auth", "password"),
            ("default", "bnk-aigw-virtual-keys", "CLICKHOUSE_PASSWORD"),
        ):
            try:
                sec = api_client.call_api(
                    resource_path=f"/api/v1/namespaces/{ns}/secrets/{sec_name}",
                    method="GET",
                    response_type="object",
                    auth_settings=["BearerToken"],
                    _return_http_data_only=True,
                    _request_timeout=(5, 10),
                )
                b64 = ((sec or {}).get("data") or {}).get(key)
                if b64:
                    pw = base64.b64decode(b64).decode("utf-8").strip()
                    if pw:
                        _CH_PW_CACHE[cluster_id] = pw
                        return pw
            except Exception:
                continue
        return None

    def _ch_query(
        self, cluster_id: int, api_client: Any, sql: str
    ) -> tuple[list[dict[str, Any]] | None, str | None]:
        pw = self._ch_password(cluster_id, api_client)
        if not pw:
            return None, "ClickHouse auth secret not found"
        path = _proxy_path("http", _CH_NAMESPACE, _CH_SERVICE, _CH_PORT, "")
        params = [("user", "otel"), ("password", pw), ("query", f"{sql} FORMAT JSON")]
        try:
            raw = api_client.call_api(
                resource_path=path,
                method="GET",
                query_params=params,
                response_type="object",
                auth_settings=["BearerToken"],
                _return_http_data_only=True,
                _request_timeout=(5, 15),
            )
            if isinstance(raw, str):
                raw = json.loads(raw)
            if isinstance(raw, dict) and isinstance(raw.get("data"), list):
                return raw["data"], None
            return None, "unexpected ClickHouse response"
        except Exception as e:
            return None, str(e)

    def _ch_where(
        self,
        range_: str,
        model: str | None = None,
        status: str | None = None,
        end_ms: int | None = None,
        start_ms: int | None = None,
        content_search: str | None = None,
    ) -> str:
        end_v = int(end_ms) if end_ms is not None else int(time.time() * 1000)
        start_v = int(start_ms) if start_ms is not None else (end_v - self._range_s(range_) * 1000)
        clauses = [f"ts_ms >= {start_v}", f"ts_ms <= {end_v}"]
        if model:
            clauses.append(f"model = '{_esc_sql(model)}'")
        if status:
            clauses.append(f"toString(http_status) = '{_esc_sql(status)}'")
        if content_search:
            esc = _esc_sql(content_search)
            clauses.append(
                f"(positionCaseInsensitive(model, '{esc}') > 0 "
                f"OR positionCaseInsensitive(provider, '{esc}') > 0 "
                f"OR positionCaseInsensitive(principal_id, '{esc}') > 0 "
                f"OR positionCaseInsensitive(org_id, '{esc}') > 0 "
                f"OR positionCaseInsensitive(request_id, '{esc}') > 0)"
            )
        return " AND ".join(clauses)

    def _ok_ch(self, **data: Any) -> dict[str, Any]:
        return {
            "available": True,
            "endpoint": _CH_ENDPOINT,
            "updated_at": datetime.now(UTC).isoformat(),
            **data,
        }

    def _stats_clickhouse(
        self,
        cluster_id: int,
        api_client: Any,
        range_: str,
        model: str | None,
        status: str | None,
    ) -> dict[str, Any] | None:
        where = self._ch_where(range_, model=model, status=status)
        sql = (
            "SELECT "
            "count() AS total_requests, "
            "countIf(http_status >= 200 AND http_status < 300) AS success, "
            "avgOrDefault(latency_ms) AS avg_latency_ms, "
            "sum(total_tokens) AS total_tokens, "
            "sum(cost_usd_micros) / 1000000.0 AS total_cost, "
            "uniqExact(model) AS models "
            f"FROM otel.aigw_requests WHERE {where}"
        )
        rows, err = self._ch_query(cluster_id, api_client, sql)
        if err or not rows:
            return None
        r = rows[0]
        total = int(r.get("total_requests") or 0)
        success = int(r.get("success") or 0)
        return self._ok_ch(
            total_requests=total,
            success_rate=(success / total) if total else 0.0,
            avg_latency_ms=float(r.get("avg_latency_ms") or 0.0),
            total_tokens=int(r.get("total_tokens") or 0),
            total_cost=float(r.get("total_cost") or 0.0),
            models=int(r.get("models") or 0),
            errors={},
        )

    def _histogram_clickhouse(
        self,
        cluster_id: int,
        api_client: Any,
        range_: str,
        metric: str,
        model: str | None,
        status: str | None,
    ) -> dict[str, Any] | None:
        step_s = self._step_s(range_)
        step_ms = step_s * 1000
        end_s = (int(time.time()) // step_s) * step_s
        where = self._ch_where(range_, model=model, status=status)
        bucket_expr = f"least(intDiv(ts_ms, {step_ms}) * {step_s}, {end_s})"

        def _all_buckets(rs: list[dict[str, Any]]) -> list[int]:
            if not rs:
                return []
            min_b = min(int(r["bucket_s"]) for r in rs)
            max_b = max(end_s, max(int(r["bucket_s"]) for r in rs))
            return list(range(min_b, max_b + 1, step_s))

        if metric == "requests":
            sql = (
                f"SELECT {bucket_expr} AS bucket_s, "
                "countIf(http_status >= 200 AND http_status < 300) AS success, "
                "countIf(http_status < 200 OR http_status >= 300) AS error "
                f"FROM otel.aigw_requests WHERE {where} "
                "GROUP BY bucket_s ORDER BY bucket_s ASC"
            )
            rows, err = self._ch_query(cluster_id, api_client, sql)
            if err or rows is None:
                return None
            buckets = _all_buckets(rows)
            by_b = {int(r["bucket_s"]): r for r in rows}
            series = [
                {
                    "name": "success",
                    "points": [{"ts": _iso(float(b)), "value": float((by_b.get(b) or {}).get("success") or 0)} for b in buckets],
                },
                {
                    "name": "error",
                    "points": [{"ts": _iso(float(b)), "value": float((by_b.get(b) or {}).get("error") or 0)} for b in buckets],
                },
            ]
            return self._ok_ch(metric=metric, step_s=step_s, series=series, errors={})

        if metric == "tokens":
            sql = (
                f"SELECT {bucket_expr} AS bucket_s, "
                "sum(prompt_tokens) AS prompt, "
                "sum(completion_tokens) AS completion, "
                "sum(cached_tokens) AS cached "
                f"FROM otel.aigw_requests WHERE {where} "
                "GROUP BY bucket_s ORDER BY bucket_s ASC"
            )
            rows, err = self._ch_query(cluster_id, api_client, sql)
            if err or rows is None:
                return None
            buckets = _all_buckets(rows)
            by_b = {int(r["bucket_s"]): r for r in rows}
            series = [
                {
                    "name": k,
                    "points": [{"ts": _iso(float(b)), "value": float((by_b.get(b) or {}).get(k) or 0)} for b in buckets],
                }
                for k in ("prompt", "completion", "cached")
            ]
            return self._ok_ch(metric=metric, step_s=step_s, series=series, errors={})

        if metric in ("cost", "models"):
            agg = "sum(cost_usd_micros) / 1000000.0" if metric == "cost" else "count()"
            sql = (
                f"SELECT {bucket_expr} AS bucket_s, model, {agg} AS val "
                f"FROM otel.aigw_requests WHERE {where} "
                "GROUP BY bucket_s, model ORDER BY bucket_s ASC"
            )
            rows, err = self._ch_query(cluster_id, api_client, sql)
            if err or rows is None:
                return None
            buckets = _all_buckets(rows)
            by_m: dict[str, dict[int, float]] = {}
            for r in rows:
                m = str(r.get("model") or "unknown")
                b = int(r["bucket_s"])
                by_m.setdefault(m, {})[b] = by_m.get(m, {}).get(b, 0.0) + float(r.get("val") or 0.0)
            series = [
                {
                    "name": m,
                    "points": [{"ts": _iso(float(b)), "value": round(bmap.get(b, 0.0), 6)} for b in buckets],
                }
                for m, bmap in sorted(by_m.items())
            ]
            return self._ok_ch(metric=metric, step_s=step_s, series=series, errors={})

        if metric == "latency":
            sql = (
                f"SELECT {bucket_expr} AS bucket_s, "
                "quantileOrDefault(0.95)(latency_ms) AS p95, "
                "quantileOrDefault(0.50)(latency_ms) AS p50, "
                "avgOrDefault(latency_ms) AS avg, "
                "avgOrDefault(`gen_ai.f5.latency_ttft_us` / 1000.0) AS ttft_ms "
                f"FROM otel.aigw_requests WHERE {where} "
                "GROUP BY bucket_s ORDER BY bucket_s ASC"
            )
            rows, err = self._ch_query(cluster_id, api_client, sql)
            if err or rows is None:
                return None
            series = []
            for k in ("p95", "p50", "avg", "ttft_ms"):
                pts = [
                    {"ts": _iso(float(int(r["bucket_s"]))), "value": round(float(r.get(k) or 0.0), 2)}
                    for r in rows
                    if float(r.get(k) or 0.0) > 0
                ]
                series.append({"name": k, "points": pts})
            return self._ok_ch(metric=metric, step_s=step_s, series=series, errors={})

        return None

    def _provider_usage_clickhouse(
        self,
        cluster_id: int,
        api_client: Any,
        range_: str,
        metric: str,
        model: str | None,
        status: str | None,
    ) -> dict[str, Any] | None:
        step_s = self._step_s(range_)
        step_ms = step_s * 1000
        end_s = (int(time.time()) // step_s) * step_s
        where = self._ch_where(range_, model=model, status=status)
        bucket_expr = f"least(intDiv(ts_ms, {step_ms}) * {step_s}, {end_s})"
        agg_map = {
            "cost": "sum(cost_usd_micros) / 1000000.0",
            "tokens": "sum(total_tokens)",
            "latency": "avgOrDefault(latency_ms)",
        }
        if metric not in agg_map:
            return None
        sql = (
            f"SELECT {bucket_expr} AS bucket_s, model, {agg_map[metric]} AS val "
            f"FROM otel.aigw_requests WHERE {where} "
            "GROUP BY bucket_s, model ORDER BY bucket_s ASC"
        )
        rows, err = self._ch_query(cluster_id, api_client, sql)
        if err or rows is None:
            return None
        if not rows:
            return self._ok_ch(metric=metric, step_s=step_s, series=[], errors={})
        min_b = min(int(r["bucket_s"]) for r in rows)
        max_b = max(end_s, max(int(r["bucket_s"]) for r in rows))
        buckets = list(range(min_b, max_b + 1, step_s))
        by_m: dict[str, dict[int, float]] = {}
        for r in rows:
            m = str(r.get("model") or "unknown")
            b = int(r["bucket_s"])
            by_m.setdefault(m, {})[b] = float(r.get("val") or 0.0)
        matrix = []
        for m, bmap in by_m.items():
            pts = []
            last_v = 0.0
            for b in buckets:
                v = bmap.get(b, 0.0)
                if metric == "latency":
                    if v > 0:
                        last_v = v
                    else:
                        v = last_v
                pts.append({"ts": _iso(float(b)), "value": v})
            matrix.append(({"model": m}, pts))
        series = self._fold(matrix, by_provider=True, mean=(metric == "latency"))
        return self._ok_ch(metric=metric, step_s=step_s, series=series, errors={})

    def _rankings_clickhouse(
        self,
        cluster_id: int,
        api_client: Any,
        range_: str,
        model: str | None,
        status: str | None,
    ) -> dict[str, Any] | None:
        rng_ms = self._range_s(range_) * 1000
        cur_end = int(time.time() * 1000)
        cur_start = cur_end - rng_ms
        prev_start = cur_start - rng_ms

        def _query_window(s_ms: int, e_ms: int) -> dict[str, dict[str, float]] | None:
            where = self._ch_where(range_, model=model, status=status, start_ms=s_ms, end_ms=e_ms)
            sql = (
                "SELECT model, "
                "count() AS requests, "
                "sum(total_tokens) AS tokens, "
                "sum(cost_usd_micros) / 1000000.0 AS cost, "
                "avgOrDefault(latency_ms) AS latency, "
                "countIf(http_status >= 200 AND http_status < 300) AS success "
                f"FROM otel.aigw_requests WHERE {where} GROUP BY model"
            )
            rows, err = self._ch_query(cluster_id, api_client, sql)
            if err or rows is None:
                return None
            out: dict[str, dict[str, float]] = {
                "requests": {},
                "tokens": {},
                "cost": {},
                "latency": {},
                "success": {},
            }
            for r in rows:
                m = str(r.get("model") or "")
                if not m:
                    continue
                for k in out:
                    out[k][m] = float(r.get(k) or 0.0)
            return out

        cur = _query_window(cur_start, cur_end)
        if cur is None:
            return None
        prev = _query_window(prev_start, cur_start) or {}
        rows = self._rank_rows(cur, prev)
        return self._ok_ch(rows=rows, errors={})

    def _logs_clickhouse(
        self,
        cluster_id: int,
        api_client: Any,
        cluster_name: str,
        range_: str,
        model: str | None,
        status: str | None,
        limit: int,
        content_search: str | None,
        end: int | None,
    ) -> dict[str, Any] | None:
        end_ms = (end // 1_000_000) if end else None
        where = self._ch_where(range_, model=model, status=status, end_ms=end_ms, content_search=content_search)
        sql = (
            "SELECT ts_ms, request_id, tenant, org_id, team_id, principal_id, vk_id, "
            "model, provider, served_model, deployment_upstream, "
            "prompt_tokens, completion_tokens, cached_tokens, total_tokens, "
            "cost_usd_micros, cost_no_cache_usd_micros, finish_reason, http_status, latency_ms, "
            "`gen_ai.f5.identity_state` AS identity_state "
            f"FROM otel.aigw_requests WHERE {where} "
            f"ORDER BY ts_ms DESC LIMIT {int(limit)}"
        )
        ch_rows, err = self._ch_query(cluster_id, api_client, sql)
        if err or ch_rows is None:
            return None
        rows: list[dict[str, Any]] = []
        oldest_ns: int | None = None
        for rec in ch_rows:
            ts_ms = int(rec.get("ts_ms") or 0)
            ts_ns = ts_ms * 1_000_000
            oldest_ns = ts_ns
            st = str(rec.get("http_status") or 200)
            mdl = str(rec.get("model") or "")
            prov = str(rec.get("provider") or "")
            served = str(rec.get("served_model") or mdl)
            org = str(rec.get("org_id") or "default")
            princ = str(rec.get("principal_id") or "anonymous")
            ptk = int(rec.get("prompt_tokens") or 0)
            ctk = int(rec.get("completion_tokens") or 0)
            cached = int(rec.get("cached_tokens") or 0)
            ttk = int(rec.get("total_tokens") or (ptk + ctk))
            cost_usd = float(rec.get("cost_usd_micros") or 0) / 1_000_000.0
            cost_nocache = float(rec.get("cost_no_cache_usd_micros") or 0) / 1_000_000.0
            cache_tag = f" [CACHE HIT: {cached} tk]" if cached > 0 else ""
            msg = f"[{org}/{princ}] {mdl} -> {prov} ({served}){cache_tag}"
            req_payload = {
                "request_id": rec.get("request_id"),
                "tenant": rec.get("tenant"),
                "org_id": org,
                "team_id": rec.get("team_id"),
                "principal_id": princ,
                "vk_id": rec.get("vk_id"),
                "identity_state": rec.get("identity_state") or "verified",
                "model": mdl,
                "provider": prov,
                "deployment_upstream": rec.get("deployment_upstream"),
                "prompt_tokens": ptk,
                "cached_tokens": cached,
            }
            resp_payload = {
                "served_model": served,
                "http_status": int(rec.get("http_status") or 200),
                "finish_reason": rec.get("finish_reason") or "stop",
                "completion_tokens": ctk,
                "total_tokens": ttk,
                "cost_usd": round(cost_usd, 6),
                "cost_no_cache_usd": round(cost_nocache, 6),
                "latency_ms": float(rec.get("latency_ms") or 0),
            }
            rows.append(
                {
                    "ts": _iso(ts_ms / 1000.0),
                    "ts_ns": ts_ns,
                    "type": "success" if st.startswith("2") else "error",
                    "message": msg,
                    "model": mdl,
                    "latency_ms": float(rec.get("latency_ms") or 0),
                    "prompt_tk": ptk,
                    "comp_tk": ctk,
                    "total_tk": ttk,
                    "cost": cost_usd,
                    "status": st,
                    "req_body": json.dumps(req_payload, indent=2),
                    "resp_body": json.dumps(resp_payload, indent=2),
                    "cluster_id": cluster_id,
                    "cluster_name": cluster_name,
                }
            )
        next_end = str(oldest_ns - 1) if (oldest_ns is not None and len(rows) >= limit) else None
        return self._ok_ch(rows=rows, next_end=next_end, errors={})

    def _filterdata_clickhouse(
        self,
        cluster_id: int,
        api_client: Any,
        range_: str,
    ) -> dict[str, Any] | None:
        where = self._ch_where(range_)
        sql = f"SELECT DISTINCT model, toString(http_status) AS status FROM otel.aigw_requests WHERE {where}"
        rows, err = self._ch_query(cluster_id, api_client, sql)
        if err or rows is None:
            return None
        models = sorted({str(r.get("model")) for r in rows if r.get("model")})
        statuses = sorted({str(r.get("status")) for r in rows if r.get("status")})
        return self._ok_ch(models=models, statuses=statuses, errors={})
