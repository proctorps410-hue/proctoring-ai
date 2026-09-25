"""
Simple fixed-window rate limiter.

- Uses Redis when REDIS_URL is set; otherwise in-process storage (single-worker dev).
- Intended for auth/proctoring sensitive endpoints (login attempts, face challenges).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from config.settings import settings
from utils.logger import logger

_redis: Any = None  # None = not initialized, False = init failed, else Redis client
_memory_store: Dict[str, Tuple[int, float]] = {}  # key -> (count, window_end_ts)
_memory_lock = threading.Lock()


def _get_redis():
    global _redis
    url = (getattr(settings, "REDIS_URL", None) or "").strip()
    if not url:
        return None
    if _redis is False:
        return None
    if _redis is None:
        try:
            import redis

            client = redis.from_url(url, decode_responses=True)
            client.ping()
            _redis = client
            logger.info("Rate limiter: using Redis")
        except Exception as exc:
            logger.warning("Rate limiter: Redis unavailable (%s), using in-memory", exc)
            _redis = False
    return _redis if _redis is not False else None


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after_seconds: int


def _memory_incr(key: str, limit: int, window_sec: int) -> RateLimitResult:
    now = time.time()
    with _memory_lock:
        count, window_end = _memory_store.get(key, (0, 0.0))
        if window_end <= now:
            count = 0
            window_end = now + float(window_sec)

        if count >= limit:
            retry_after = max(1, int(window_end - now))
            return RateLimitResult(False, 0, retry_after)

        count += 1
        _memory_store[key] = (count, window_end)
        remaining = max(0, limit - count)
        return RateLimitResult(True, remaining, 0)


def check_and_increment(key: str, *, limit: int, window_sec: int) -> RateLimitResult:
    """
    Fixed-window counter: allow up to `limit` within `window_sec`.
    """
    key = (key or "").strip()
    if not key:
        return RateLimitResult(True, remaining=limit, retry_after_seconds=0)

    r = _get_redis()
    if not r:
        return _memory_incr(key, limit, window_sec)

    redis_key = f"rl:{key}"
    try:
        pipe = r.pipeline()
        pipe.incr(redis_key, 1)
        pipe.ttl(redis_key)
        new_count, ttl = pipe.execute()
        try:
            new_count_int = int(new_count)
        except Exception:
            new_count_int = limit + 1

        # Ensure TTL is set for new keys.
        if ttl in (-1, -2):
            r.expire(redis_key, int(window_sec))
            ttl = int(window_sec)

        if new_count_int > limit:
            retry_after = max(1, int(ttl if isinstance(ttl, int) else window_sec))
            return RateLimitResult(False, remaining=0, retry_after_seconds=retry_after)

        remaining = max(0, limit - new_count_int)
        return RateLimitResult(True, remaining=remaining, retry_after_seconds=0)
    except Exception as exc:
        logger.warning("Rate limiter Redis failure (%s); allowing request", exc)
        return RateLimitResult(True, remaining=limit, retry_after_seconds=0)

