"""
Short-lived strike state store for policy termination.

Uses Redis when REDIS_URL is set; otherwise in-process storage (single-worker dev).
State is per-user and expires after inactivity to avoid unbounded growth.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any, Dict, Optional

from config.settings import settings
from utils.logger import logger

DEFAULT_TTL_SEC = 6 * 60 * 60  # 6 hours

_redis: Any = None  # None = not initialized, False = init failed, else Redis client
_memory_store: Dict[str, Dict[str, Any]] = {}
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
            logger.info("Strike store: using Redis")
        except Exception as exc:
            logger.warning("Strike store: Redis unavailable (%s), using in-memory", exc)
            _redis = False
    return _redis if _redis is not False else None


def _ttl_sec() -> int:
    raw = getattr(settings, "PROCTOR_STRIKE_STATE_TTL_SEC", None)
    try:
        parsed = int(raw)
        return parsed if parsed > 0 else DEFAULT_TTL_SEC
    except Exception:
        return DEFAULT_TTL_SEC


def _prune_memory_locked() -> None:
    now = time.time()
    for k in [k for k, v in _memory_store.items() if float(v.get("exp", 0)) < now]:
        del _memory_store[k]


def _key(user_id: int) -> str:
    return f"strike:{int(user_id)}"


def get_state(user_id: int) -> Dict[str, Any]:
    uid = int(user_id)
    key = _key(uid)
    r = _get_redis()
    if r:
        raw = r.get(key)
        if raw:
            try:
                return json.loads(raw)
            except Exception:
                return {}
        return {}

    with _memory_lock:
        _prune_memory_locked()
        rec = _memory_store.get(key)
        if not rec:
            return {}
        return dict(rec.get("state") or {})


def set_state(user_id: int, state: Dict[str, Any]) -> None:
    uid = int(user_id)
    key = _key(uid)
    ttl = _ttl_sec()
    payload = json.dumps(state or {})

    r = _get_redis()
    if r:
        r.setex(key, ttl, payload)
        return

    with _memory_lock:
        _prune_memory_locked()
        _memory_store[key] = {"state": dict(state or {}), "exp": time.time() + ttl}


def clear_state(user_id: int) -> None:
    uid = int(user_id)
    key = _key(uid)
    r = _get_redis()
    if r:
        try:
            r.delete(key)
        except Exception:
            pass
        return

    with _memory_lock:
        _memory_store.pop(key, None)

