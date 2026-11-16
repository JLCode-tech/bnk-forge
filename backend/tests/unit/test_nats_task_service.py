"""
Unit tests for NATS JetStream Task Service (Milestone 5).
"""

import time

import pytest

from services.nats_task_service import (
    NATSTaskClient,
    NATSTaskRegistry,
    NATSTaskResult,
    NATSTaskScheduler,
    NATSTaskWorker,
    nats_task,
)


@pytest.mark.unit
class TestNATSTaskResult:
    def test_result_lifecycle(self):
        result = NATSTaskResult(task_id="uuid-1", task_name="test_task")
        assert result.id == "uuid-1"
        assert result.task_id == "uuid-1"
        assert result.status == "PENDING"
        assert not result.successful()
        assert not result.failed()
        assert not result.ready()

        result.mark_success({"data": "ok"})
        assert result.successful()
        assert result.ready()
        assert not result.failed()
        assert result.get() == {"data": "ok"}

    def test_result_failure(self):
        result = NATSTaskResult(task_id="uuid-2", task_name="fail_task")
        result.mark_failure("connection timeout")
        assert result.failed()
        assert result.ready()
        assert not result.successful()
        with pytest.raises(RuntimeError, match="connection timeout"):
            result.get()

    def test_to_dict(self):
        result = NATSTaskResult(task_id="uuid-3", task_name="dict_task", status="PENDING")
        d = result.to_dict()
        assert d["task_id"] == "uuid-3"
        assert d["task_name"] == "dict_task"
        assert d["status"] == "PENDING"


@pytest.mark.unit
class TestNATSTaskClient:
    def test_stream_config_matches_spec(self):
        client = NATSTaskClient(stream_name="FORGE_TASKS")
        cfg = client.build_stream_config()

        assert cfg["name"] == "FORGE_TASKS"
        assert cfg["retention"] == "workqueue"
        assert cfg["storage"] == "file"
        assert "forge.tasks.*" in cfg["subjects"]

    def test_dispatch_in_memory_fallback(self):
        client = NATSTaskClient(nats_addr="127.0.0.1:54999")  # Unused port
        res = client.dispatch("tasks.cluster_scan.scan_cluster_async", 101, dry_run=True)

        assert isinstance(res, NATSTaskResult)
        assert res.task_name == "tasks.cluster_scan.scan_cluster_async"
        assert res.id is not None

        # Verify task is buffered in local queue
        task = client.pop_local_task()
        assert task is not None
        assert task["task_id"] == res.id
        assert task["args"] == [101]
        assert task["kwargs"] == {"dry_run": True}


@pytest.mark.unit
class TestNATSTaskWorker:
    def test_worker_processes_registered_task(self):
        reg = NATSTaskRegistry()
        executed = []

        def my_task(arg1, keyword=""):
            executed.append((arg1, keyword))
            return "done"

        reg.register("tasks.sample.my_task", my_task)

        client = NATSTaskClient()
        worker = NATSTaskWorker(client=client, task_registry=reg)

        res = client.dispatch("tasks.sample.my_task", "hello", keyword="world")
        assert not res.ready()

        # Run worker once
        processed = worker.run_once()
        assert processed is True
        assert len(executed) == 1
        assert executed[0] == ("hello", "world")
        assert res.successful()
        assert res.get() == "done"

    def test_worker_handles_task_exception(self):
        reg = NATSTaskRegistry()

        def error_task():
            raise ValueError("bad parameter")

        reg.register("error_task", error_task)

        client = NATSTaskClient()
        worker = NATSTaskWorker(client=client, task_registry=reg)

        res = client.dispatch("error_task")
        worker.run_once()

        assert res.failed()
        with pytest.raises(RuntimeError, match="bad parameter"):
            res.get()

    def test_worker_unregistered_task(self):
        reg = NATSTaskRegistry()
        client = NATSTaskClient()
        worker = NATSTaskWorker(client=client, task_registry=reg)

        res = client.dispatch("nonexistent_task")
        worker.run_once()

        assert res.failed()
        assert "Unregistered" in res._error


@pytest.mark.unit
class TestNATSTaskDecorator:
    def test_nats_task_delay_and_apply_async(self):
        @nats_task(name="tasks.test.decorated_task")
        def add(a, b):
            return a + b

        # Test direct call
        assert add(2, 3) == 5

        # Test .delay()
        res = add.delay(4, 5)
        assert isinstance(res, NATSTaskResult)
        assert res.task_name == "tasks.test.decorated_task"

        # Test .apply_async()
        res2 = add.apply_async(args=[10, 20])
        assert isinstance(res2, NATSTaskResult)


@pytest.mark.unit
class TestNATSTaskScheduler:
    def test_scheduler_ticks_due_tasks(self):
        client = NATSTaskClient()
        schedule = [
            {"name": "fast-task", "task": "fast_task", "interval": 10.0},
            {"name": "slow-task", "task": "slow_task", "interval": 100.0},
        ]
        scheduler = NATSTaskScheduler(client=client, schedule=schedule)

        # First tick at t=0 dispatches both
        dispatched = scheduler.tick(now=1000.0)
        assert "fast_task" in dispatched
        assert "slow_task" in dispatched

        # Tick 5s later: neither due
        dispatched2 = scheduler.tick(now=1005.0)
        assert len(dispatched2) == 0

        # Tick 15s later: fast_task is due again (elapsed 15 >= 10), but slow_task is not (15 < 100)
        dispatched3 = scheduler.tick(now=1015.0)
        assert "fast_task" in dispatched3
        assert "slow_task" not in dispatched3
