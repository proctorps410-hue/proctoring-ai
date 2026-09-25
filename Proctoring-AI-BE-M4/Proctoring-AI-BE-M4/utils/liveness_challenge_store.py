"""
Short-lived liveness challenges (nonce + ordered capture).

Uses Redis when REDIS_URL is set; otherwise in-process storage (single-worker dev).
One-time: challenges are consumed (deleted) on validation.
"""

from __future__ import annotations

import json
import random
import threading
import time
import uuid
from typing import Any, Dict, Optional

from config.settings import settings
from utils.logger import logger

DEFAULT_TTL_SEC = 120
TTL_SEC = int(float(getattr(settings, "LIVENESS_CHALLENGE_TTL_SEC", DEFAULT_TTL_SEC) or DEFAULT_TTL_SEC))

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
            logger.info("Liveness challenge store: using Redis")
        except Exception as exc:
            logger.warning("Liveness challenge store: Redis unavailable (%s), using in-memory", exc)
            _redis = False
    return _redis if _redis is not False else None


def _prune_memory_locked() -> None:
    now = time.time()
    for k in [k for k, v in _memory_store.items() if v["exp"] < now]:
        del _memory_store[k]


def _shuffle_pose_order() -> list[str]:
    poses = ["front", "left", "right"]
    random.shuffle(poses)
    return poses


def create_for_login_attempt(attempt_id: str, user_id: int, email: str) -> Dict[str, Any]:
    challenge_id = str(uuid.uuid4())
    pose_order = _shuffle_pose_order()
    payload = {
        "context": "login",
        "attempt_id": str(attempt_id).strip(),
        "user_id": int(user_id),
        "email": (email or "").strip().lower(),
        "pose_order": pose_order,
        "created_at": time.time(),
    }
    raw = json.dumps(payload)

    r = _get_redis()
    if r:
        r.setex(f"liveness:{challenge_id}", TTL_SEC, raw)
    else:
        with _memory_lock:
            _prune_memory_locked()
            _memory_store[challenge_id] = {**payload, "exp": time.time() + TTL_SEC}

    return {
        "challenge_id": challenge_id,
        "pose_order": pose_order,
        "expires_in_seconds": TTL_SEC,
    }


def create_for_user(user_id: int) -> Dict[str, Any]:
    challenge_id = str(uuid.uuid4())
    pose_order = _shuffle_pose_order()
    payload = {
        "context": "lti",
        "user_id": int(user_id),
        "pose_order": pose_order,
        "created_at": time.time(),
    }
    raw = json.dumps(payload)

    r = _get_redis()
    if r:
        r.setex(f"liveness:{challenge_id}", TTL_SEC, raw)
    else:
        with _memory_lock:
            _prune_memory_locked()
            _memory_store[challenge_id] = {**payload, "exp": time.time() + TTL_SEC}

    return {
        "challenge_id": challenge_id,
        "pose_order": pose_order,
        "expires_in_seconds": TTL_SEC,
    }


def consume_for_login_attempt(challenge_id: Optional[str], attempt_id: str, user_id: int, email: str) -> bool:
    if not challenge_id or not str(challenge_id).strip():
        return False
    cid = str(challenge_id).strip()
    attempt_id = str(attempt_id).strip()
    email_n = (email or "").strip().lower()
    uid = int(user_id)

    r = _get_redis()
    if r:
        key = f"liveness:{cid}"
        try:
            raw = r.get(key)
            if not raw:
                return False
            data = json.loads(raw)
            ok = (
                str(data.get("context")) == "login"
                and str(data.get("attempt_id", "")).strip() == attempt_id
                and int(data.get("user_id", -1)) == uid
                and (data.get("email") or "").strip().lower() == email_n
            )
            r.delete(key)
            return bool(ok)
        except Exception:
            try:
                r.delete(key)
            except Exception:
                pass
            return False

    with _memory_lock:
        _prune_memory_locked()
        rec = _memory_store.get(cid)
        if not rec or rec.get("exp", 0) < time.time():
            _memory_store.pop(cid, None)
            return False
        ok = (
            str(rec.get("context")) == "login"
            and str(rec.get("attempt_id", "")).strip() == attempt_id
            and int(rec.get("user_id", -1)) == uid
            and (rec.get("email") or "").strip().lower() == email_n
        )
        _memory_store.pop(cid, None)
        return bool(ok)


def consume_for_user(challenge_id: Optional[str], user_id: int) -> bool:
    if not challenge_id or not str(challenge_id).strip():
        return False
    cid = str(challenge_id).strip()
    uid = int(user_id)

    r = _get_redis()
    if r:
        key = f"liveness:{cid}"
        try:
            raw = r.get(key)
            if not raw:
                return False
            data = json.loads(raw)
            ok = str(data.get("context")) == "lti" and int(data.get("user_id", -1)) == uid
            r.delete(key)
            return bool(ok)
        except Exception:
            try:
                r.delete(key)
            except Exception:
                pass
            return False

    with _memory_lock:
        _prune_memory_locked()
        rec = _memory_store.get(cid)
        if not rec or rec.get("exp", 0) < time.time():
            _memory_store.pop(cid, None)
            return False
        ok = str(rec.get("context")) == "lti" and int(rec.get("user_id", -1)) == uid
        _memory_store.pop(cid, None)
        return bool(ok)

