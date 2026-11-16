"""
Redis cache wrapper for query result caching
Provides simple interface for caching frequently accessed data
"""
import fnmatch
import json
import logging
import os
import threading
import time
from collections.abc import Callable
from functools import wraps
from typing import Any

import redis

logger = logging.getLogger(__name__)

# Get Redis URL from environment (includes password if configured)
DEFAULT_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")


class CacheService:
    """Redis cache wrapper with automatic JSON serialization, lazy reconnection,

    and in-memory TTL dictionary fallback when Redis is absent.
    """

    _RECONNECT_COOLDOWN_SECONDS = 5.0

    def __init__(self, redis_url: str | None = None):
        """Initialize Redis connection"""
        self._redis_url: str = redis_url or DEFAULT_REDIS_URL
        self._redis: Any = None
        self._pid: int | None = None
        self._last_attempt_ts: float = 0.0
        self._manual_override: bool = False
        self._memory_cache: dict[str, tuple[float, Any]] = {}
        self._lock = threading.RLock()
        self._connect()

    def _connect(self) -> Any:
        self._last_attempt_ts = time.monotonic()
        try:
            client = redis.from_url(self._redis_url, decode_responses=True)
            client.ping()
            self._redis = client
            self._pid = os.getpid()
            logger.info(f"✅ Redis cache connected: {self._redis_url}")
        except Exception as e:
            logger.debug(f"Redis cache connection failed: {e}; using in-memory fallback")
            self._redis = None
            self._pid = None
        return self._redis

    @property
    def redis(self) -> Any:
        if self._manual_override:
            return self._redis
        current_pid = os.getpid()
        if self._redis is not None and self._pid is not None and self._pid != current_pid:
            self._redis = None
        if self._redis is None:
            if (time.monotonic() - self._last_attempt_ts) >= self._RECONNECT_COOLDOWN_SECONDS:
                self._connect()
        return self._redis

    @redis.setter
    def redis(self, value: Any) -> None:
        self._redis = value
        self._pid = os.getpid() if value is not None else None
        self._manual_override = True

    def is_available(self) -> bool:
        """Return True if Redis or in-memory cache is operational."""
        return True

    def get(self, key: str) -> Any | None:
        """
        Get value from cache
        Returns None if key doesn't exist or is expired.
        """
        client = self.redis
        if client:
            try:
                value = client.get(key)
                if value is None:
                    return None
                return json.loads(value)
            except redis.ConnectionError as e:
                logger.debug(f"Cache GET fallback to memory for '{key}': {e}")
                if not self._manual_override:
                    self._redis = None
            except Exception as e:
                logger.warning(f"Cache GET error for key '{key}': {e}")
                return None

        # In-memory TTL fallback
        with self._lock:
            entry = self._memory_cache.get(key)
            if entry is None:
                return None
            expires_at, val = entry
            if time.monotonic() > expires_at:
                self._memory_cache.pop(key, None)
                return None
            return val

    def set(self, key: str, value: Any, ttl_seconds: int = 300) -> bool:
        """
        Set value in cache with TTL (default 5 minutes)
        Returns True if successful, False otherwise
        """
        client = self.redis
        if client:
            try:
                serialized = json.dumps(value, default=str)
                client.setex(key, ttl_seconds, serialized)
                return True
            except redis.ConnectionError as e:
                logger.debug(f"Cache SET fallback to memory for '{key}': {e}")
                if not self._manual_override:
                    self._redis = None
            except Exception as e:
                logger.warning(f"Cache SET error for key '{key}': {e}")
                return False

        # In-memory TTL fallback
        with self._lock:
            self._memory_cache[key] = (time.monotonic() + ttl_seconds, value)
            return True

    def delete(self, key: str) -> bool:
        """
        Delete key from cache
        Returns True if successful, False otherwise
        """
        client = self.redis
        if client:
            try:
                client.delete(key)
                return True
            except redis.ConnectionError as e:
                logger.debug(f"Cache DELETE fallback to memory for '{key}': {e}")
                if not self._manual_override:
                    self._redis = None
            except Exception as e:
                logger.warning(f"Cache DELETE error for key '{key}': {e}")
                return False

        with self._lock:
            return self._memory_cache.pop(key, None) is not None

    def delete_pattern(self, pattern: str) -> int:
        """
        Delete all keys matching pattern (e.g., "project:*")
        Returns number of keys deleted
        """
        client = self.redis
        if client:
            try:
                deleted = 0
                cursor = 0
                while True:
                    cursor, keys = client.scan(cursor, match=pattern, count=100)
                    if keys:
                        deleted += client.delete(*keys)
                    if cursor == 0:
                        break
                return deleted
            except redis.ConnectionError as e:
                logger.debug(f"Cache DELETE_PATTERN fallback to memory for '{pattern}': {e}")
                if not self._manual_override:
                    self._redis = None
            except Exception as e:
                logger.warning(f"Cache DELETE_PATTERN error for pattern '{pattern}': {e}")
                return 0

        with self._lock:
            matched = [k for k in self._memory_cache if fnmatch.fnmatch(k, pattern)]
            for k in matched:
                self._memory_cache.pop(k, None)
            return len(matched)

    def clear_all(self) -> bool:
        """
        Clear entire cache (use with caution!)
        Returns True if successful, False otherwise
        """
        client = self.redis
        if client:
            try:
                client.flushdb()
                logger.info("🗑️  Cache cleared")
                return True
            except redis.ConnectionError as e:
                logger.debug(f"Cache CLEAR fallback to memory: {e}")
                if not self._manual_override:
                    self._redis = None
            except Exception as e:
                logger.error(f"Cache CLEAR error: {e}")
                return False

        with self._lock:
            self._memory_cache.clear()
            return True


# Global cache instance
cache = CacheService()


def _build_cache_key(key_prefix: str, func_name: str, args: tuple[Any, ...], kwargs: dict[str, Any], key_fn: Callable[..., str] | None = None) -> str:
    """
    Build a deterministic cache key.

    If `key_fn` is provided, it is called with (*args, **kwargs) minus any
    'self' first argument; it must return a string suffix.

    Otherwise a best-effort key is built by filtering out non-hashable objects
    (like SQLAlchemy sessions) and sorting kwargs for determinism.
    """
    if key_fn is not None:
        # Skip 'self' if present (bound method)
        clean_args = args[1:] if args and hasattr(args[0], '__dict__') else args
        suffix = key_fn(*clean_args, **{k: v for k, v in kwargs.items() if k not in ('db', 'session')})
        return f"{key_prefix}:{func_name}:{suffix}"

    base = f"{key_prefix}:{func_name}"

    # Filter args: keep only simple hashable types (int, str, float, bool, None)
    filtered_args = [str(arg) for arg in args if isinstance(arg, (int, str, float, bool, type(None)))]
    if filtered_args:
        base += f":{':'.join(filtered_args)}"

    # Filter kwargs: skip db/session, sort for determinism
    filtered_kwargs = {k: v for k, v in kwargs.items() if k not in ('db', 'session')}
    if filtered_kwargs:
        base += f":{':'.join(f'{k}={v}' for k, v in sorted(filtered_kwargs.items()))}"

    return base


def cached(key_prefix: str, ttl_seconds: int = 300, key: Callable[..., str] | None = None) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """
    Decorator for caching function results.

    Usage:
        @cached("module_library", ttl_seconds=900)
        def get_modules():
            return expensive_query()

        # Explicit key function for safer cache keys:
        @cached("modules", key=lambda project_id, **kw: f"project:{project_id}")
        def get_modules(project_id: int, db: Session):
            ...

    Args:
        key_prefix: Prefix for cache key (function args will be appended)
        ttl_seconds: Time to live in seconds (default: 5 minutes)
        key: Optional callable(*args, **kwargs) -> str for explicit cache key suffix.
             Receives the function's args/kwargs minus 'self' and 'db'.
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            cache_key = _build_cache_key(key_prefix, func.__name__, args, kwargs, key)

            cached_result = cache.get(cache_key)
            if cached_result is not None:
                logger.debug(f"Cache HIT: {cache_key}")
                return cached_result

            logger.debug(f"Cache MISS: {cache_key}")
            result = await func(*args, **kwargs)
            cache.set(cache_key, result, ttl_seconds)
            return result

        @wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            cache_key = _build_cache_key(key_prefix, func.__name__, args, kwargs, key)

            cached_result = cache.get(cache_key)
            if cached_result is not None:
                logger.debug(f"Cache HIT: {cache_key}")
                return cached_result

            logger.debug(f"Cache MISS: {cache_key}")
            result = func(*args, **kwargs)
            cache.set(cache_key, result, ttl_seconds)
            return result

        # Return appropriate wrapper based on function type
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator


def invalidate_cache(pattern: str) -> int:
    """
    Helper to invalidate cache for a specific pattern

    Usage:
        invalidate_cache("module_library:*")
        invalidate_cache("projects:*")
    """
    count = cache.delete_pattern(pattern)
    if count > 0:
        logger.info(f"🗑️  Invalidated {count} cache entries: {pattern}")
    return count
