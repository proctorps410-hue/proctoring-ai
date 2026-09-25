"""
Short-lived login attempts: password verified, JWT not yet issued.
Uses Redis when REDIS_URL is set; otherwise in-process storage (single-worker dev).
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Any, Dict, Optional

from config.settings import settings
from utils.logger import logger

TTL_SEC = 15 * 60

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
            logger.info("Login attempt store: using Redis")
        except Exception as exc:
            logger.warning("Login attempt store: Redis unavailable (%s), using in-memory", exc)
            _redis = False
    return _redis if _redis is not False else None


def _prune_memory_locked() -> None:
    now = time.time()
    for k in [k for k, v in _memory_store.items() if v["exp"] < now]:
        del _memory_store[k]


def create_attempt(user_id: int, email: str) -> str:
    attempt_id = str(uuid.uuid4())
    payload = json.dumps({"user_id": int(user_id), "email": (email or "").strip().lower()})
    r = _get_redis()
    if r:
        r.setex(f"login_attempt:{attempt_id}", TTL_SEC, payload)
        return attempt_id
    with _memory_lock:
        _prune_memory_locked()
        _memory_store[attempt_id] = {
            "user_id": int(user_id),
            "email": (email or "").strip().lower(),
            "exp": time.time() + TTL_SEC,
        }
    return attempt_id


def consume_attempt(attempt_id: Optional[str], user_id: int, email: str) -> bool:
    if not attempt_id or not str(attempt_id).strip():
        return False
    attempt_id = str(attempt_id).strip()
    email_n = (email or "").strip().lower()
    uid = int(user_id)

    r = _get_redis()
    if r:
        key = f"login_attempt:{attempt_id}"
        try:
            raw = r.get(key)
            if not raw:
                return False
            data = json.loads(raw)
            if int(data.get("user_id", -1)) != uid or (data.get("email") or "").strip().lower() != email_n:
                r.delete(key)
                return False
            r.delete(key)
            return True
        except (json.JSONDecodeError, TypeError, ValueError):
            try:
                r.delete(key)
            except Exception:
                pass
            return False

    with _memory_lock:
        _prune_memory_locked()
        rec = _memory_store.get(attempt_id)
        if not rec or rec["exp"] < time.time():
            _memory_store.pop(attempt_id, None)
            return False
        if int(rec["user_id"]) != uid or (rec["email"] or "").strip().lower() != email_n:
            # Match Redis: invalidate attempt on mismatch so the id cannot be retried.
            del _memory_store[attempt_id]
            return False
        del _memory_store[attempt_id]
        return True


def peek_attempt(attempt_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Read an attempt without consuming it.
    Used to mint liveness challenges tied to an existing attempt.
    """
    if not attempt_id or not str(attempt_id).strip():
        return None
    attempt_id = str(attempt_id).strip()

    r = _get_redis()
    if r:
        key = f"login_attempt:{attempt_id}"
        try:
            raw = r.get(key)
            if not raw:
                return None
            data = json.loads(raw)
            return {
                "user_id": int(data.get("user_id", 0)),
                "email": (data.get("email") or "").strip().lower(),
            }
        except Exception:
            return None

    with _memory_lock:
        _prune_memory_locked()
        rec = _memory_store.get(attempt_id)
        if not rec or rec["exp"] < time.time():
            _memory_store.pop(attempt_id, None)
            return None
        return {
            "user_id": int(rec.get("user_id", 0)),
            "email": (rec.get("email") or "").strip().lower(),
        }
