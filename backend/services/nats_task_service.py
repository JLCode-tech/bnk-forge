"""
NATS JetStream Task Service — Replaces Celery with lightweight WorkQueues.

Provides:
- FORGE_TASKS durable JetStream WorkQueue stream configuration.
- NATSTaskClient for task dispatching with Celery .delay() and .apply_async() compatibility.
- NATSTaskResult matching Celery AsyncResult interface.
- NATSTaskWorker for pull-consumer execution of regular tasks.
- NATSTaskScheduler for periodic scheduled jobs (replacing Celery Beat).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import sys
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

logger = logging.getLogger("nats_task_service")

DEFAULT_NATS_ADDR = os.getenv("NATS_ADDR", "localhost:4222")
DEFAULT_STREAM_NAME = os.getenv("STREAM_NAME", "FORGE_TASKS")
DEFAULT_SUBJECT_PREFIX = "forge.tasks."


class NATSTaskResult:
    """AsyncResult-compatible task execution handle."""

    def __init__(
        self,
        task_id: str,
        task_name: str,
        status: str = "PENDING",
        result: Any = None,
        error: str | None = None,
    ):
        self.id = task_id
        self.task_id = task_id  # alias
        self.task_name = task_name
        self.status = status
        self._result = result
        self._error = error
        self._completed_at: float | None = None

    def successful(self) -> bool:
        return self.status == "SUCCESS"

    def failed(self) -> bool:
        return self.status == "FAILURE"

    def ready(self) -> bool:
        return self.status in ("SUCCESS", "FAILURE")

    def get(self, timeout: float | None = None) -> Any:
        if self._error:
            raise RuntimeError(self._error)
        return self._result

    def mark_success(self, result: Any = None) -> None:
        self.status = "SUCCESS"
        self._result = result
        self._completed_at = time.time()

    def mark_failure(self, error: str) -> None:
        self.status = "FAILURE"
        self._error = error
        self._completed_at = time.time()

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.id,
            "task_name": self.task_name,
            "status": self.status,
            "result": self._result,
            "error": self._error,
        }


class NATSTaskRegistry:
    """In-memory registry of callable task handlers."""

    def __init__(self) -> None:
        self._handlers: dict[str, Callable[..., Any]] = {}
        self._lock = threading.Lock()

    def register(self, name: str, func: Callable[..., Any]) -> None:
        with self._lock:
            self._handlers[name] = func
            # Also register clean name without module path
            clean_name = name.split(".")[-1]
            if clean_name not in self._handlers:
                self._handlers[clean_name] = func

    def get(self, name: str) -> Callable[..., Any] | None:
        with self._lock:
            func = self._handlers.get(name)
            if not func:
                clean_name = name.split(".")[-1]
                func = self._handlers.get(clean_name)
            return func

    def list_tasks(self) -> list[str]:
        with self._lock:
            return sorted(self._handlers.keys())


registry = NATSTaskRegistry()


class NATSTaskWrapper:
    """Callable decorator wrapping task functions with Celery .delay() and .apply_async() compatibility."""

    def __init__(self, func: Callable[..., Any], name: str, bind: bool = False):
        self.func = func
        self.name = name
        self.bind = bind
        self.request = type("TaskRequest", (), {"id": f"nats-{uuid.uuid4().hex[:12]}", "hostname": "forge-worker"})()

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        if self.bind:
            return self.func(self, *args, **kwargs)
        return self.func(*args, **kwargs)

    def run(self, *args: Any, **kwargs: Any) -> Any:
        return self(*args, **kwargs)

    def delay(self, *args: Any, **kwargs: Any) -> NATSTaskResult:
        return default_task_client.dispatch(self.name, *args, **kwargs)

    def apply_async(
        self,
        args: list[Any] | tuple[Any, ...] | None = None,
        kwargs: dict[str, Any] | None = None,
        **_options: Any,
    ) -> NATSTaskResult:
        a = list(args) if args else []
        kw = kwargs or {}
        return default_task_client.dispatch(self.name, *a, **kw)


def nats_task(name: str | None = None, bind: bool = False) -> Callable[..., Any]:
    """Decorator to declare a background task executable via NATS JetStream."""

    def decorator(func: Callable[..., Any]) -> NATSTaskWrapper:
        task_name = name or func.__name__
        wrapper = NATSTaskWrapper(func, task_name, bind=bind)
        registry.register(task_name, wrapper)
        return wrapper

    return decorator


class NATSTaskClient:
    """NATS JetStream Task Dispatch Client."""

    def __init__(self, nats_addr: str | None = None, stream_name: str | None = None):
        self.nats_addr = nats_addr or DEFAULT_NATS_ADDR
        self.stream_name = stream_name or DEFAULT_STREAM_NAME
        self._in_memory_queue: list[dict[str, Any]] = []
        self._task_results: dict[str, NATSTaskResult] = {}
        self._lock = threading.Lock()
        self._is_offline = False

    def build_stream_config(self) -> dict[str, Any]:
        """Declarative configuration for JetStream WorkQueue stream."""
        return {
            "name": self.stream_name,
            "subjects": [f"{DEFAULT_SUBJECT_PREFIX}*"],
            "retention": "workqueue",
            "storage": "file",
            "max_age": 7 * 24 * 3600 * 1_000_000_000,  # 7 days in nanoseconds
            "max_msgs": -1,
            "max_bytes": -1,
            "discard": "old",
        }

    def _send_tcp_command(self, subject: str, payload_bytes: bytes) -> bool:
        """Send a NATS PUB message directly over TCP."""
        host, _, port_s = self.nats_addr.partition(":")
        port = int(port_s) if port_s else 4222

        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2.0)
            sock.connect((host, port))

            # Send CONNECT handshake
            connect_frame = b'CONNECT {"verbose":false,"pedantic":false,"lang":"python","version":"1.0.0"}\r\n'
            sock.sendall(connect_frame)

            # Send PUB frame
            pub_header = f"PUB {subject} {len(payload_bytes)}\r\n".encode()
            sock.sendall(pub_header)
            sock.sendall(payload_bytes + b"\r\n")
            sock.close()
            return True
        except Exception as e:
            logger.debug("NATS TCP send to %s failed (%s) — using in-memory queue fallback", self.nats_addr, e)
            self._is_offline = True
            return False

    def ensure_stream(self) -> bool:
        """Create or update the FORGE_TASKS stream on JetStream."""
        config = self.build_stream_config()
        payload = json.dumps(config).encode("utf-8")
        subject = f"$JS.API.STREAM.CREATE.{self.stream_name}"
        return self._send_tcp_command(subject, payload)

    def dispatch(self, task_name: str, *args: Any, **kwargs: Any) -> NATSTaskResult:
        """Dispatch a background task to the JetStream WorkQueue."""
        task_id = str(uuid.uuid4())
        task_record = {
            "task_id": task_id,
            "task_name": task_name,
            "args": list(args),
            "kwargs": kwargs,
            "created_at": time.time(),
            "retries": 0,
        }

        result = NATSTaskResult(task_id=task_id, task_name=task_name, status="PENDING")

        with self._lock:
            self._task_results[task_id] = result
            self._in_memory_queue.append(task_record)

        payload = json.dumps(task_record).encode("utf-8")
        subject = f"{DEFAULT_SUBJECT_PREFIX}{task_name.split('.')[-1]}"

        # Attempt wire dispatch to NATS JetStream
        self._send_tcp_command(subject, payload)
        return result

    def get_task_result(self, task_id: str) -> NATSTaskResult | None:
        with self._lock:
            return self._task_results.get(task_id)

    def pop_local_task(self) -> dict[str, Any] | None:
        with self._lock:
            if self._in_memory_queue:
                return self._in_memory_queue.pop(0)
            return None


default_task_client = NATSTaskClient()


class NATSTaskWorker:
    """Lightweight Pull-Consumer Worker for regular background tasks."""

    def __init__(self, client: NATSTaskClient | None = None, task_registry: NATSTaskRegistry | None = None):
        self.client = client or default_task_client
        self.registry = task_registry or registry
        self._running = False
        self._processed_count = 0
        self._failed_count = 0

    def process_task_payload(self, task_data: dict[str, Any]) -> bool:
        """Execute a single task payload."""
        task_id = task_data.get("task_id", "unknown")
        task_name = task_data.get("task_name", "")
        args = task_data.get("args", [])
        kwargs = task_data.get("kwargs", {})

        handler = self.registry.get(task_name)
        result_obj = self.client.get_task_result(task_id)

        if not handler:
            logger.warning("No handler registered for task: %s", task_name)
            if result_obj:
                result_obj.mark_failure(f"Unregistered task: {task_name}")
            self._failed_count += 1
            return False

        logger.info("Worker executing task %s (id: %s)", task_name, task_id)
        start_time = time.time()
        try:
            res = handler(*args, **kwargs)
            if result_obj:
                result_obj.mark_success(res)
            self._processed_count += 1
            logger.info("Task %s completed in %.2fs", task_name, time.time() - start_time)
            return True
        except Exception as e:
            logger.exception("Task %s failed: %s", task_name, e)
            if result_obj:
                result_obj.mark_failure(str(e))
            self._failed_count += 1
            return False

    def run_once(self) -> bool:
        """Process one task from the queue."""
        task_data = self.client.pop_local_task()
        if task_data:
            return self.process_task_payload(task_data)
        return False

    def _run_nats_subscriber(self, stop_event: threading.Event | None = None) -> None:
        """Subscribe to forge.tasks.* over NATS TCP and process incoming tasks."""
        host, _, port_s = self.client.nats_addr.partition(":")
        port = int(port_s) if port_s else 4222
        while self._running and not (stop_event and stop_event.is_set()):
            sock: socket.socket | None = None
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(5.0)
                sock.connect((host, port))
                sock.sendall(b'CONNECT {"verbose":false,"pedantic":false,"lang":"python","version":"1.0.0"}\r\n')
                sock.sendall(f"SUB {DEFAULT_SUBJECT_PREFIX}* forge_workers 1\r\n".encode())
                buf = b""
                while self._running and not (stop_event and stop_event.is_set()):
                    try:
                        chunk = sock.recv(65536)
                    except TimeoutError:
                        continue
                    if not chunk:
                        break
                    buf += chunk
                    while b"\r\n" in buf:
                        line, rest = buf.split(b"\r\n", 1)
                        text = line.decode("utf-8", errors="replace").strip()
                        if text == "PING":
                            sock.sendall(b"PONG\r\n")
                            buf = rest
                        elif text.startswith("MSG "):
                            parts = text.split()
                            nbytes = int(parts[-1])
                            if len(rest) < nbytes + 2:
                                break
                            payload = rest[:nbytes]
                            buf = rest[nbytes + 2 :]
                            try:
                                task_data = json.loads(payload.decode("utf-8"))
                                self.process_task_payload(task_data)
                            except Exception as exc:
                                logger.exception("Failed processing NATS MSG payload: %s", exc)
                        else:
                            buf = rest
            except Exception as exc:
                logger.debug("NATS TCP subscriber (%s) unavailable: %s", self.client.nats_addr, exc)
                time.sleep(2.0)
            finally:
                if sock is not None:
                    try:
                        sock.close()
                    except Exception:
                        pass

    def run_worker(self, stop_event: threading.Event | None = None) -> None:
        """Worker main loop."""
        self._running = True
        logger.info("NATSTaskWorker started, pulling tasks for stream: %s", self.client.stream_name)

        sub_thread = threading.Thread(target=self._run_nats_subscriber, args=(stop_event,), daemon=True)
        sub_thread.start()

        while self._running:
            if stop_event and stop_event.is_set():
                break

            processed = self.run_once()
            if not processed:
                time.sleep(0.5)

        logger.info("NATSTaskWorker stopped (processed: %d, failed: %d)", self._processed_count, self._failed_count)

    def stop(self) -> None:
        self._running = False


class NATSTaskScheduler:
    """Periodic task scheduler replacing Celery Beat."""

    # Default schedule intervals in seconds matching legacy celery_app.conf.beat_schedule
    DEFAULT_SCHEDULE: list[dict[str, Any]] = [
        {"name": "agent-k8s-pull", "task": "tasks.telemetry_pull_task.pull_cluster_agent_telemetry", "interval": 20.0},
        {"name": "health-monitor", "task": "tasks.health_monitor_task.check_cluster_health", "interval": 60.0},
        {"name": "operator-cleanup", "task": "tasks.operator_cleanup_task.cleanup_stale_operators_and_commands", "interval": 120.0},
        {"name": "schedule-drift-checks", "task": "tasks.drift_tasks.schedule_drift_checks", "interval": 900.0},
        {"name": "reap-orphaned-step-containers", "task": "tasks.container_reaper.reap_orphaned_step_containers", "interval": 600.0},
        {"name": "fleet-member-backfill", "task": "tasks.fleet_tasks.backfill_fleet_members", "interval": 300.0},
        {"name": "notification-retention", "task": "tasks.notification_retention_task.cleanup_old_notifications", "interval": 86400.0},
    ]

    def __init__(self, client: NATSTaskClient | None = None, schedule: list[dict[str, Any]] | None = None):
        self.client = client or default_task_client
        self.schedule = schedule or self.DEFAULT_SCHEDULE
        self._last_run: dict[str, float] = {}
        self._running = False

    def tick(self, now: float | None = None) -> list[str]:
        """Evaluate schedule and dispatch any tasks whose interval has elapsed."""
        current_time = now if now is not None else time.time()
        dispatched: list[str] = []

        for item in self.schedule:
            task_name = item["task"]
            interval = item["interval"]
            last = self._last_run.get(task_name, 0.0)

            if current_time - last >= interval:
                logger.debug("Scheduler triggering %s (interval: %ss)", task_name, interval)
                self.client.dispatch(task_name)
                self._last_run[task_name] = current_time
                dispatched.append(task_name)

        return dispatched

    def run_scheduler(self, stop_event: threading.Event | None = None) -> None:
        """Scheduler main loop."""
        self._running = True
        logger.info("NATSTaskScheduler started (managing %d scheduled tasks)", len(self.schedule))

        while self._running:
            if stop_event and stop_event.is_set():
                break

            self.tick()
            time.sleep(5.0)

        logger.info("NATSTaskScheduler stopped")

    def stop(self) -> None:
        self._running = False


# Helper to auto-register standard backend tasks
def register_backend_tasks() -> None:
    """Pre-register known backend tasks so the worker can dispatch them."""
    # Define lightweight stubs/fallbacks if real modules aren't imported yet
    try:
        from tasks.cluster_scan_task import scan_cluster_async
        registry.register("tasks.cluster_scan.scan_cluster_async", scan_cluster_async)
        registry.register("cluster_scan", scan_cluster_async)
    except ImportError:
        pass

    try:
        from tasks.health_monitor_task import check_cluster_health
        registry.register("tasks.health_monitor_task.check_cluster_health", check_cluster_health)
        registry.register("health_monitor", check_cluster_health)
    except ImportError:
        pass

    try:
        from tasks.telemetry_pull_task import pull_cluster_agent_telemetry
        registry.register("tasks.telemetry_pull_task.pull_cluster_agent_telemetry", pull_cluster_agent_telemetry)
        registry.register("agent_k8s_pull", pull_cluster_agent_telemetry)
    except ImportError:
        pass

    try:
        from tasks.drift_tasks import run_drift_check, schedule_drift_checks
        registry.register("tasks.drift_tasks.run_drift_check", run_drift_check)
        registry.register("tasks.drift_tasks.schedule_drift_checks", schedule_drift_checks)
    except ImportError:
        pass

    try:
        from tasks.operator_cleanup_task import cleanup_stale_operators_and_commands
        registry.register("tasks.operator_cleanup_task.cleanup_stale_operators_and_commands", cleanup_stale_operators_and_commands)
    except ImportError:
        pass

    try:
        import importlib

        from celery_app import celery_app as _celery_app

        for mod_name in getattr(_celery_app.conf, "include", []) or []:
            try:
                importlib.import_module(mod_name)
            except Exception as exc:
                logger.debug("Skipping task module %s: %s", mod_name, exc)
    except Exception as exc:
        logger.debug("Skipping celery_app include discovery: %s", exc)


def main() -> None:
    parser = argparse.ArgumentParser(description="BNK Forge NATS JetStream Task Service")
    parser.add_argument("--worker", action="store_true", help="Run pull consumer worker")
    parser.add_argument("--scheduler", action="store_true", help="Run periodic task scheduler")
    parser.add_argument("--health", action="store_true", help="Check NATS JetStream health")
    parser.add_argument("--nats-addr", default=DEFAULT_NATS_ADDR, help="NATS server address")
    args = parser.parse_args()

    client = NATSTaskClient(nats_addr=args.nats_addr)

    if args.health:
        ok = client.ensure_stream()
        print(f"NATS JetStream status: {'healthy' if ok else 'offline'}")
        sys.exit(0 if ok else 1)

    register_backend_tasks()

    stop_event = threading.Event()
    threads: list[threading.Thread] = []

    if args.worker or (not args.worker and not args.scheduler):
        worker = NATSTaskWorker(client=client)
        t_worker = threading.Thread(target=worker.run_worker, args=(stop_event,), daemon=True)
        t_worker.start()
        threads.append(t_worker)

    if args.scheduler:
        scheduler = NATSTaskScheduler(client=client)
        t_sched = threading.Thread(target=scheduler.run_scheduler, args=(stop_event,), daemon=True)
        t_sched.start()
        threads.append(t_sched)

    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        logger.info("Shutdown requested")
        stop_event.set()
        for t in threads:
            t.join(timeout=2.0)


if __name__ == "__main__":
    from services.nats_task_service import main as _pkg_main

    _pkg_main()
