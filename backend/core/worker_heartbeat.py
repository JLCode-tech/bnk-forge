"""
Worker Heartbeat System for Celery Workers

PERF-009: Replace slow Celery inspect() with Redis-based heartbeat tracking.

Problem: celery_app.control.inspect() broadcasts to all workers and waits for
responses, taking 6-9 seconds per call - making the System page very slow.

Solution: Workers publish heartbeats to Redis on startup and task events.
API reads heartbeats instantly from Redis instead of broadcasting.

Redis Keys:
- worker:heartbeat:{worker_id} - Worker status hash (TTL: 30s)
- worker:tasks:{worker_id} - Set of active task IDs (no TTL, managed by signals)
"""
import json
import logging
import threading
import time
from datetime import UTC, datetime
from typing import Any

from core.cache import cache

logger = logging.getLogger(__name__)

# Heartbeat TTL - if worker doesn't update within this time, considered offline
# Set to 90s to allow for heartbeat task interval (60s / CP-015) plus buffer
HEARTBEAT_TTL_SECONDS = 90

# Redis key prefixes
KEY_HEARTBEAT = "worker:heartbeat:"
KEY_ACTIVE_TASKS = "worker:tasks:"


class WorkerHeartbeat:
    """
    Manages worker heartbeat tracking via Redis with in-memory fallback.

    Workers call publish_heartbeat() periodically via Celery/NATS signals.
    API calls get_worker_status() to read instantly.

    Reuses the shared Redis connection from CacheService or in-memory state.
    """

    def __init__(self) -> None:
        self._memory_workers: dict[str, dict[str, Any]] = {}
        self._memory_tasks: dict[str, set[str]] = {}
        self._lock = threading.RLock()
        self._redis_override: Any = None
        self._manual_override: bool = False

    @property
    def redis(self) -> Any:
        """Get Redis client from shared cache instance or manual override."""
        if self._manual_override:
            return self._redis_override
        return cache.redis

    @redis.setter
    def redis(self, value: Any) -> None:
        self._redis_override = value
        self._manual_override = True

    def publish_heartbeat(
        self,
        worker_id: str,
        status: str = "ready",
        stats: dict[str, Any] | None = None
    ) -> bool:
        """
        Publish worker heartbeat to Redis or in-memory fallback.
        """
        data = {
            "worker_id": worker_id,
            "status": status,
            "last_heartbeat": datetime.now(UTC).isoformat(),
            "timestamp": str(time.time()),
        }
        if stats:
            data["stats"] = json.dumps(stats)

        if self.redis:
            try:
                key = f"{KEY_HEARTBEAT}{worker_id}"
                self.redis.hset(key, mapping=data)
                self.redis.expire(key, HEARTBEAT_TTL_SECONDS)
                logger.debug(f"Heartbeat published: {worker_id} - {status}")
                return True
            except Exception as e:
                logger.debug(f"Redis publish_heartbeat failed for {worker_id}: {e}; using memory")

        # In-memory fallback
        with self._lock:
            self._memory_workers[worker_id] = data
        return True

    def record_task_start(self, worker_id: str, task_id: str, task_name: str) -> bool:
        """Record that a task has started on a worker (called by task_prerun signal)."""
        task_data = json.dumps({
            "task_id": task_id,
            "task_name": task_name,
            "started_at": datetime.now(UTC).isoformat()
        })

        if self.redis:
            try:
                key = f"{KEY_ACTIVE_TASKS}{worker_id}"
                self.redis.sadd(key, task_data)
                self.publish_heartbeat(worker_id, status="busy")
                logger.debug(f"Task started: {task_id} on {worker_id}")
                return True
            except Exception as e:
                logger.debug(f"Redis record_task_start failed: {e}; using memory")

        with self._lock:
            self._memory_tasks.setdefault(worker_id, set()).add(task_data)
            self.publish_heartbeat(worker_id, status="busy")
        return True

    def record_task_end(self, worker_id: str, task_id: str) -> bool:
        """Record that a task has completed on a worker (called by task_postrun signal)."""
        if self.redis:
            try:
                key = f"{KEY_ACTIVE_TASKS}{worker_id}"
                for task_json in self.redis.smembers(key):
                    try:
                        if json.loads(task_json).get("task_id") == task_id:
                            self.redis.srem(key, task_json)
                            break
                    except json.JSONDecodeError:
                        continue

                remaining = self.redis.scard(key)
                self.publish_heartbeat(worker_id, status="busy" if remaining > 0 else "ready")
                logger.debug(f"Task ended: {task_id} on {worker_id}, remaining: {remaining}")
                return True
            except Exception as e:
                logger.debug(f"Redis record_task_end failed: {e}; using memory")

        with self._lock:
            tasks = self._memory_tasks.get(worker_id, set())
            for task_json in list(tasks):
                try:
                    if json.loads(task_json).get("task_id") == task_id:
                        tasks.remove(task_json)
                        break
                except json.JSONDecodeError:
                    continue
            remaining = len(tasks)
            self.publish_heartbeat(worker_id, status="busy" if remaining > 0 else "ready")
        return True

    def mark_worker_offline(self, worker_id: str) -> bool:
        """Mark a worker as offline (called on worker shutdown)."""
        if self.redis:
            try:
                self.redis.delete(
                    f"{KEY_HEARTBEAT}{worker_id}",
                    f"{KEY_ACTIVE_TASKS}{worker_id}"
                )
                logger.info(f"Worker marked offline: {worker_id}")
                return True
            except Exception as e:
                logger.debug(f"Redis mark_worker_offline failed: {e}")

        with self._lock:
            self._memory_workers.pop(worker_id, None)
            self._memory_tasks.pop(worker_id, None)
        return True

    def get_worker_status(self) -> dict[str, Any]:
        """
        Get status of all workers from Redis or in-memory tracking.
        """
        if self.redis:
            try:
                workers = []
                total_active_tasks = 0

                cursor = 0
                while True:
                    cursor, keys = self.redis.scan(cursor, match=f"{KEY_HEARTBEAT}*", count=100)

                    for key in keys:
                        worker_data = self.redis.hgetall(key)
                        if not worker_data:
                            continue

                        worker_id = worker_data.get("worker_id", key.replace(KEY_HEARTBEAT, ""))
                        tasks_key = f"{KEY_ACTIVE_TASKS}{worker_id}"
                        active_tasks = self._get_active_tasks(tasks_key)
                        total_active_tasks += len(active_tasks)

                        workers.append({
                            "worker_id": worker_id,
                            "status": worker_data.get("status", "unknown"),
                            "last_heartbeat": worker_data.get("last_heartbeat"),
                            "active_tasks": len(active_tasks),
                            "tasks": active_tasks,
                            "stats": self._parse_json(worker_data.get("stats"))
                        })

                    if cursor == 0:
                        break

                active_count = len([w for w in workers if w["status"] in ("ready", "busy")])

                return {
                    "workers": workers,
                    "total": len(workers),
                    "active": active_count,
                    "offline": 0,
                    "active_tasks": total_active_tasks
                }
            except Exception as e:
                logger.debug(f"Redis get_worker_status failed: {e}; falling back to memory")

        with self._lock:
            now = time.time()
            workers = []
            total_active_tasks = 0

            # Filter stale
            stale = [
                wid for wid, data in self._memory_workers.items()
                if (now - float(data.get("timestamp", 0))) > HEARTBEAT_TTL_SECONDS
            ]
            for wid in stale:
                self._memory_workers.pop(wid, None)
                self._memory_tasks.pop(wid, None)

            for wid, data in self._memory_workers.items():
                active_tasks = [
                    self._parse_json(t)
                    for t in self._memory_tasks.get(wid, set())
                ]
                active_tasks = [t for t in active_tasks if t]
                total_active_tasks += len(active_tasks)

                workers.append({
                    "worker_id": wid,
                    "status": data.get("status", "unknown"),
                    "last_heartbeat": data.get("last_heartbeat"),
                    "active_tasks": len(active_tasks),
                    "tasks": active_tasks,
                    "stats": self._parse_json(data.get("stats")),
                })

            active_count = len([w for w in workers if w["status"] in ("ready", "busy")])
            return {
                "workers": workers,
                "total": len(workers),
                "active": active_count,
                "offline": 0,
                "active_tasks": total_active_tasks,
            }

    def get_queue_stats(self) -> dict[str, dict[str, int]]:
        """Get per-queue statistics from active tasks."""
        if self.redis:
            try:
                queue_stats = {"default": {"pending": 0, "active": 0}, "opentofu": {"pending": 0, "active": 0}}

                cursor = 0
                while True:
                    cursor, keys = self.redis.scan(cursor, match=f"{KEY_ACTIVE_TASKS}*", count=100)

                    for key in keys:
                        for task in self._get_active_tasks(key):
                            task_name = task.get("task_name", "")
                            queue = "opentofu" if "opentofu" in task_name.lower() else "default"
                            queue_stats[queue]["active"] += 1

                    if cursor == 0:
                        break

                return queue_stats
            except Exception as e:
                logger.debug(f"Redis get_queue_stats failed: {e}; reading from memory")

        with self._lock:
            queue_stats = {"default": {"pending": 0, "active": 0}, "opentofu": {"pending": 0, "active": 0}}
            for wid, tasks in self._memory_tasks.items():
                for task_json in tasks:
                    parsed = self._parse_json(task_json)
                    if parsed:
                        task_name = parsed.get("task_name", "")
                        queue = "opentofu" if "opentofu" in task_name.lower() else "default"
                        queue_stats[queue]["active"] += 1
            return queue_stats

    def _get_active_tasks(self, key: str) -> list:
        """Parse active tasks from Redis set."""
        tasks = []
        for task_json in self.redis.smembers(key):
            parsed = self._parse_json(task_json)
            if parsed:
                tasks.append(parsed)
        return tasks

    def _parse_json(self, value: str | None) -> Any | None:
        """Safely parse JSON string."""
        if not value:
            return None
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None

    def _empty_status(self, error: str | None = None) -> dict[str, Any]:
        """Return empty worker status dict."""
        result = {"workers": [], "total": 0, "active": 0, "offline": 0, "active_tasks": 0}
        if error:
            result["error"] = error
        return result


# Global heartbeat instance
heartbeat = WorkerHeartbeat()
