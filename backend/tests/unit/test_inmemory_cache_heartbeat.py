"""Unit tests for CacheService and WorkerHeartbeat in-memory fallbacks."""

import time
from unittest.mock import MagicMock

import pytest

from core.cache import CacheService
from core.worker_heartbeat import WorkerHeartbeat


class TestCacheServiceInMemoryFallback:
    @pytest.fixture
    def mem_cache(self):
        svc = CacheService()
        svc.redis = None  # Force no Redis
        svc.clear_all()
        return svc

    def test_get_set_roundtrip(self, mem_cache):
        assert mem_cache.get("test:key1") is None
        assert mem_cache.set("test:key1", {"foo": "bar"}, ttl_seconds=10) is True
        assert mem_cache.get("test:key1") == {"foo": "bar"}

    def test_key_ttl_expiry(self, mem_cache):
        mem_cache.set("test:short", "val", ttl_seconds=1)
        assert mem_cache.get("test:short") == "val"
        time.sleep(1.1)
        assert mem_cache.get("test:short") is None

    def test_delete(self, mem_cache):
        mem_cache.set("test:del", 123)
        assert mem_cache.delete("test:del") is True
        assert mem_cache.get("test:del") is None
        assert mem_cache.delete("test:del") is False

    def test_delete_pattern(self, mem_cache):
        mem_cache.set("cluster:1:stats", "a")
        mem_cache.set("cluster:1:topology", "b")
        mem_cache.set("cluster:2:stats", "c")

        deleted = mem_cache.delete_pattern("cluster:1:*")
        assert deleted == 2
        assert mem_cache.get("cluster:1:stats") is None
        assert mem_cache.get("cluster:1:topology") is None
        assert mem_cache.get("cluster:2:stats") == "c"

    def test_clear_all(self, mem_cache):
        mem_cache.set("a", 1)
        mem_cache.set("b", 2)
        assert mem_cache.clear_all() is True
        assert mem_cache.get("a") is None
        assert mem_cache.get("b") is None


class TestWorkerHeartbeatInMemoryFallback:
    @pytest.fixture
    def mem_hb(self):
        hb = WorkerHeartbeat()
        hb.redis = None  # Force no Redis
        return hb

    def test_publish_and_get_worker_status(self, mem_hb):
        assert mem_hb.publish_heartbeat("worker-1", status="ready") is True
        status = mem_hb.get_worker_status()
        assert status["total"] == 1
        assert status["active"] == 1
        assert status["workers"][0]["worker_id"] == "worker-1"
        assert status["workers"][0]["status"] == "ready"

    def test_record_task_lifecycle(self, mem_hb):
        mem_hb.publish_heartbeat("worker-1", status="ready")
        mem_hb.record_task_start("worker-1", "task-100", "cluster_scan")

        status = mem_hb.get_worker_status()
        assert status["active_tasks"] == 1
        assert status["workers"][0]["status"] == "busy"

        mem_hb.record_task_end("worker-1", "task-100")
        updated = mem_hb.get_worker_status()
        assert updated["active_tasks"] == 0
        assert updated["workers"][0]["status"] == "ready"

    def test_mark_worker_offline(self, mem_hb):
        mem_hb.publish_heartbeat("worker-2", status="ready")
        assert mem_hb.get_worker_status()["total"] == 1
        mem_hb.mark_worker_offline("worker-2")
        assert mem_hb.get_worker_status()["total"] == 0
