from __future__ import annotations

from fastapi import APIRouter

from config.settings import settings
from services.termination_policy_service import TerminationPolicyService

router = APIRouter()


@router.get("/policy", response_model=dict)
async def get_policy_contract():
    """
    Explicit proctoring policy contract (operator-readable).
    """
    return {
        "termination_policy": {
            "major_warn_at": int(getattr(settings, "PROCTOR_MAJOR_STRIKES_WARN", 3) or 3),
            "major_terminate_at": int(getattr(settings, "PROCTOR_MAJOR_STRIKES_TERMINATE", 6) or 6),
            "strike_event_cooldown_sec": float(getattr(settings, "PROCTOR_STRIKE_EVENT_COOLDOWN_SEC", 10) or 10),
            "minor_termination_thresholds": dict(TerminationPolicyService.MINOR_TERMINATION_THRESHOLDS),
            "critical_event_thresholds": TerminationPolicyService._critical_thresholds(),
            "reconnect_rules": {
                "ws_requires_active_session": True,
                "terminated_session_ws_connect": "deny",
                "terminated_session_exam_api": "deny",
            },
        },
        "rate_limits": {
            "window_sec": int(getattr(settings, "AUTH_RATE_LIMIT_WINDOW_SEC", 60) or 60),
            "login_attempt_limit": int(getattr(settings, "AUTH_LOGIN_ATTEMPT_LIMIT", 8) or 8),
            "liveness_challenge_limit": int(getattr(settings, "AUTH_LIVENESS_CHALLENGE_LIMIT", 12) or 12),
            "face_submit_limit": int(getattr(settings, "AUTH_FACE_SUBMIT_LIMIT", 10) or 10),
        },
        "liveness": {
            "challenge_ttl_sec": int(getattr(settings, "LIVENESS_CHALLENGE_TTL_SEC", 120) or 120),
        },
    }

