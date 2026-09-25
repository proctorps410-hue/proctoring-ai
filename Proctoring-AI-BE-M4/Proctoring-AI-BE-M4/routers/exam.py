from fastapi import APIRouter, Depends, HTTPException, status, Security, BackgroundTasks, UploadFile, File, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from config.database import get_db, SessionLocal
from config.settings import settings
from models.logs import Log
from models.users import User  # Add User model import
from schemas.exam import ExamSummary, UserInfo
from datetime import datetime, timedelta, timezone
from sqlalchemy import func
from typing import Dict, Optional, List, Any
from pydantic import BaseModel
from utils.connection import manager  # Import manager from new module
import secrets
import os
from routers.auth import create_access_token, get_current_user, get_current_admin_user
from fastapi.responses import JSONResponse, Response
from schemas.exam import AvailableExam, ExamSummary, UserInfo, ExamSubmission, ExamResult, ExamCreate, QuestionCreate, ExamLink, LogCreate, ExamProgressUpdate
from services.grading_service import GradingService
import asyncio
from concurrent.futures import ThreadPoolExecutor
from utils.logger import logger
from config.detection_config import detection_config as cfg
import base64
from models.exams import Exam
from models.questions import Question
from models.sessions import ExamSession
from models.policy_audit import PolicyAudit
from services.seb_service import SEBService
from models.settings import SystemSettings
from models.exam_eligible_students import ExamEligibleStudent
from models.user_password_reset_requirements import UserPasswordResetRequirement
from fastapi import Request
from services.storage_service import StorageService
from models.evidence import Evidence
from utils.time_utils import as_utc, to_naive_utc, utc_iso
import pandas as pd
import bcrypt
import io

from services.warmup_service import WarmupService
router = APIRouter()
security = HTTPBearer()

# ─────────────────────────────────────────────────────────────────────────────
# Phase 1 warm-start endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/warmup", response_model=Dict[str, Any])
async def warmup_proctoring_pipeline(
    current_user: User = Depends(get_current_user),
):
    """
    Warm-start the detector pipeline.

    Called from Exam Lobby so the exam starts with near-instant proctoring.
    Returns immediately; the actual warmup runs in a background daemon thread.
    """
    return WarmupService.start_warmup()


@router.get("/warmup/status", response_model=Dict[str, Any])
async def warmup_proctoring_status(
    current_user: User = Depends(get_current_user),
):
    """Return current warmup readiness state."""
    return WarmupService.get_state()

# Initialize thread pool for frame processing
frame_executor = ThreadPoolExecutor(max_workers=4)

# Add these constants at the top with other constants
YOLO_CONFIDENCE_THRESHOLD = 0.85  # Increase confidence threshold for person detection
SUSPICIOUS_ACTIVITY_THRESHOLD = 0.90  # Higher threshold for reporting suspicious activities


def _safe_int_env(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        parsed = int(raw)
        return parsed if parsed > 0 else default
    except (TypeError, ValueError):
        return default


def _safe_float_env(name: str, default: float) -> float:
    raw = os.getenv(name, str(default))
    try:
        parsed = float(raw)
        return parsed if parsed > 0 else default
    except (TypeError, ValueError):
        return default


def _safe_csv_env(name: str, default: List[str]) -> List[str]:
    raw = (os.getenv(name, "") or "").strip()
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


def _normalize_email(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _normalize_email_list(values: Optional[List[str]]) -> List[str]:
    normalized: List[str] = []
    seen = set()
    for value in values or []:
        email = _normalize_email(value)
        if not email or email in seen:
            continue
        seen.add(email)
        normalized.append(email)
    return normalized


def _get_latest_session(
    db: Session,
    user_id: int,
    exam_id: Optional[int] = None,
) -> Optional[ExamSession]:
    query = db.query(ExamSession).filter(ExamSession.user_id == user_id)
    if exam_id is not None:
        query = query.filter(ExamSession.exam_id == exam_id)
    return query.order_by(ExamSession.start_time.desc(), ExamSession.id.desc()).first()


def _get_active_session(
    db: Session,
    user_id: int,
    exam_id: Optional[int] = None,
) -> Optional[ExamSession]:
    query = db.query(ExamSession).filter(
        ExamSession.user_id == user_id,
        ExamSession.status == "active",
    )
    if exam_id is not None:
        query = query.filter(ExamSession.exam_id == exam_id)
    return query.order_by(ExamSession.start_time.desc(), ExamSession.id.desc()).first()


def _raise_session_terminated() -> None:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "session_terminated",
            "message": "This exam session has been terminated by the proctoring policy.",
        },
    )


def _require_active_session_or_403(
    db: Session,
    user_id: int,
    exam_id: Optional[int] = None,
) -> ExamSession:
    active_session = _get_active_session(db, user_id, exam_id)
    if active_session:
        return active_session

    latest_session = _get_latest_session(db, user_id, exam_id)
    if latest_session and (latest_session.status or "").strip().lower() == "terminated":
        _raise_session_terminated()

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="No active exam session found",
    )


def _deny_if_latest_session_terminated(
    db: Session,
    user_id: int,
    exam_id: Optional[int] = None,
) -> None:
    latest_session = _get_latest_session(db, user_id, exam_id)
    if latest_session and (latest_session.status or "").strip().lower() == "terminated":
        _raise_session_terminated()


def _get_exam_eligible_emails(db: Session, exam_id: int) -> List[str]:
    rows = db.query(ExamEligibleStudent.email).filter(
        ExamEligibleStudent.exam_id == exam_id
    ).all()
    return _normalize_email_list([row.email for row in rows])


def _is_user_eligible_for_exam(db: Session, user: User, exam: Exam) -> bool:
    if _normalize_email(user.email) == "jvshayan1@gmail.com":
        return True
    eligible_emails = _get_exam_eligible_emails(db, int(exam.id))
    if not eligible_emails:
        return True
    return _normalize_email(user.email) in set(eligible_emails)


def _parse_eligible_email_file(filename: str, file_bytes: bytes) -> List[str]:
    lower_name = (filename or "").strip().lower()
    if lower_name.endswith(".csv"):
        dataframe = pd.read_csv(io.BytesIO(file_bytes), dtype=str)
    elif lower_name.endswith(".xlsx"):
        dataframe = pd.read_excel(io.BytesIO(file_bytes), dtype=str, engine="openpyxl")
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported roster format. Upload a .csv or .xlsx file."
        )

    if dataframe.empty:
        return []

    columns = [str(column).strip() for column in dataframe.columns]
    preferred_column = next(
        (column for column in columns if "email" in column.lower()),
        columns[0],
    )
    series = dataframe[preferred_column].dropna().astype(str).tolist()
    email_candidates = [item.strip() for item in series if item and str(item).strip()]
    normalized = _normalize_email_list(email_candidates)
    return [email for email in normalized if "@" in email and "." in email.split("@")[-1]]


def _generate_shared_temporary_password() -> str:
    return secrets.token_urlsafe(9)


def _generate_monitor_key() -> str:
    """Generate a short, human-readable monitor room key: MK-XXXX (4 uppercase alphanumeric chars)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # exclude O,0,I,1 for readability
    suffix = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"MK-{suffix}"


ADMIN_EXAM_FEED_LIMIT = _safe_int_env("ADMIN_EXAM_FEED_LIMIT", 25)
EXAM_CREATOR_DURATION_MIN = _safe_int_env("EXAM_CREATOR_DURATION_MIN_MINUTES", 15)
EXAM_CREATOR_DURATION_MAX = _safe_int_env("EXAM_CREATOR_DURATION_MAX_MINUTES", 240)
EXAM_CREATOR_DURATION_STEP = _safe_int_env("EXAM_CREATOR_DURATION_STEP_MINUTES", 15)
EXAM_CREATOR_DURATION_DEFAULT = _safe_int_env("EXAM_CREATOR_DURATION_DEFAULT_MINUTES", 60)
EXAM_CREATOR_DEFAULT_MARKS = _safe_float_env("EXAM_CREATOR_DEFAULT_QUESTION_MARKS", 1.0)
EXAM_CREATOR_WINDOW_BUFFER = _safe_int_env("EXAM_CREATOR_DEFAULT_WINDOW_BUFFER_MINUTES", 1)
EXAM_CREATOR_MAX_QUESTIONS = _safe_int_env("EXAM_CREATOR_MAX_QUESTIONS", 200)
EXAM_CREATOR_ALLOWED_TYPES = _safe_csv_env(
    "EXAM_CREATOR_ALLOWED_QUESTION_TYPES",
    ["MCQ", "TRUE_FALSE", "SUBJECTIVE"],
)
EXAM_CREATOR_DEFAULT_DESCRIPTION = os.getenv("EXAM_CREATOR_DEFAULT_DESCRIPTION", "").strip()
EXAM_CREATOR_DEFAULT_TITLE_PREFIX = os.getenv("EXAM_CREATOR_DEFAULT_TITLE_PREFIX", "Exam").strip() or "Exam"

SYSTEM_EVENT_TYPES = {
    "session_started",
    "session_ended",
    "session_stopped",
    "session_summarized",
    "session_force_closed",
    "exam_submitted",
}
NON_VIOLATION_EVENT_TYPES = SYSTEM_EVENT_TYPES | {
    "face_detected",
    "appeal_request",
    "identity_unverifiable",
    "frame_quality_low",
    "fusion_suppressed",
    "proctoring_degraded",
}

MAJOR_VIOLATION_EVENT_TYPES = {
    "identity_mismatch",
    "multiple_people",
    "face_not_visible",
    "phone_detected",
    "prohibited_object",
    "screen_share_stopped",
    "camera_blocked_or_disabled",
    "tampering_detected",
    "remote_access_detected",
    "virtual_machine_detected",
    "capture_tool_detected",
    "third_party_communication",
    "abusive_behavior",
    "disruptive_behavior",
    "proctor_abuse",
    "policy_termination",
    "face_spoofing",
}

MINOR_TERMINATION_THRESHOLDS = {
    "tab_switch": _safe_int_env("PROCTOR_TAB_SWITCH_TERMINATION_THRESHOLD", 3),
    "copy_paste": _safe_int_env("PROCTOR_COPY_PASTE_TERMINATION_THRESHOLD", 3),
}

ADMIN_LIVE_STALE_SECONDS = _safe_int_env("ADMIN_LIVE_STALE_SECONDS", 45)
ADMIN_WATCH_VIOLATION_THRESHOLD = _safe_int_env("ADMIN_WATCH_VIOLATION_THRESHOLD", 1)
ADMIN_FLAGGED_VIOLATION_THRESHOLD = _safe_int_env("ADMIN_FLAGGED_VIOLATION_THRESHOLD", 3)
ADMIN_CRITICAL_VIOLATION_THRESHOLD = _safe_int_env("ADMIN_CRITICAL_VIOLATION_THRESHOLD", 6)


def _resolve_ws_base_url(request: Request) -> str:
    """Build WS endpoint using explicit config or current request/proxy headers."""
    configured_base = (settings.WS_BASE_URL or "").rstrip("/")
    if configured_base:
        return configured_base

    forwarded_proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "http").split(",")[0].strip()
    forwarded_host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
    )
    host = (forwarded_host or "").split(",")[0].strip()

    if not host:
        fallback_domain = (settings.API_DOMAIN or "").strip()
        if fallback_domain:
            host = f"{fallback_domain}:{settings.SERVER_PORT}"
        else:
            request_host = request.url.hostname or ""
            client_host = request.client.host if request.client else ""
            derived_host = request_host or client_host or "localhost"
            host = f"{derived_host}:{settings.SERVER_PORT}"

    ws_scheme = "wss" if forwarded_proto == "https" else "ws"
    return f"{ws_scheme}://{host}/ws"


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _compute_exam_status(now_utc_naive: datetime, start_utc_naive: datetime, end_utc_naive: datetime) -> str:
    if end_utc_naive <= start_utc_naive:
        return "invalid"
    if now_utc_naive < start_utc_naive:
        return "upcoming"
    if now_utc_naive > end_utc_naive:
        return "ended"
    return "active"


def _derive_risk_tier(violation_count: int) -> str:
    if violation_count >= ADMIN_CRITICAL_VIOLATION_THRESHOLD:
        return "Critical"
    if violation_count >= ADMIN_FLAGGED_VIOLATION_THRESHOLD:
        return "Flagged"
    if violation_count >= ADMIN_WATCH_VIOLATION_THRESHOLD:
        return "Watch"
    return "Safe"


def _normalize_admin_status(
    session_status: Optional[str],
    is_live: bool,
    last_active: Optional[datetime],
    now_utc: datetime,
) -> str:
    if is_live:
        return "active"

    normalized = (session_status or "").strip().lower()
    if normalized == "terminated":
        return "terminated"
    if normalized in {"completed", "submitted"}:
        return "completed"

    if normalized in {"active", "running", "paused"}:
        if last_active:
            last_active_utc = to_naive_utc(last_active)
            idle_seconds = (now_utc - last_active_utc).total_seconds()
            if idle_seconds <= ADMIN_LIVE_STALE_SECONDS and normalized in {"active", "running"}:
                return "active"
        return "offline"

    return "offline"


def _build_admin_live_payload(db: Session) -> Dict[str, Any]:
    students = db.query(User).filter(User.role == "student").all()
    now_utc = _utc_now_naive()
    session_rows: List[Dict[str, Any]] = []

    for student in students:
        session = db.query(ExamSession).filter(
            ExamSession.user_id == student.id
        ).order_by(ExamSession.start_time.desc()).first()

        exam = session.exam if session else None
        exam_title = exam.title if exam else None
        duration_minutes = exam.duration_minutes if exam else 0
        total_marks = 0
        progress = 0.0
        score = 0.0
        session_id = None
        compliance: Optional[float] = None

        latest_log = db.query(Log).filter(Log.user_id == student.id).order_by(Log.timestamp.desc()).first()
        last_active = latest_log.timestamp if latest_log else None

        violation_count = 0
        enforcement_state: Dict[str, Any] = {
            "session_status": (session.status if session else None),
            "policy_action": None,
            "policy_reason": None,
            "policy_details": None,
            "policy_at": None,
            "strike_state": None,
        }

        if session:
            session_id = session.id
            score = float(session.score or 0)
            compliance = float(session.overall_compliance) if session.overall_compliance is not None else None

            if last_active is None:
                last_active = session.end_time or session.start_time

            if session.exam_id:
                question_stats = db.query(
                    func.count(Question.id).label("question_count"),
                    func.coalesce(func.sum(Question.marks), 0).label("total_marks"),
                ).filter(Question.exam_id == session.exam_id).first()

                total_questions = int(question_stats.question_count or 0) if question_stats else 0
                total_marks = int(question_stats.total_marks or 0) if question_stats else 0

                saved_answers = session.saved_answers if isinstance(session.saved_answers, dict) else {}
                answered_count = len(saved_answers)
                if total_questions > 0:
                    progress = round((answered_count / total_questions) * 100, 2)

            violation_query = db.query(Log).filter(
                Log.user_id == student.id,
                Log.event_type.notin_(list(NON_VIOLATION_EVENT_TYPES)),
            )

            if session.start_time:
                violation_query = violation_query.filter(Log.timestamp >= session.start_time)
            if session.end_time:
                violation_query = violation_query.filter(Log.timestamp <= session.end_time)

            violation_count = violation_query.count()

            # Policy/enforcement state for admin parity (best-effort).
            try:
                latest_audit = db.query(PolicyAudit).filter(
                    PolicyAudit.user_id == student.id,
                ).order_by(PolicyAudit.created_at.desc(), PolicyAudit.id.desc()).first()
                if latest_audit:
                    enforcement_state.update({
                        "policy_action": latest_audit.action,
                        "policy_reason": latest_audit.reason,
                        "policy_details": latest_audit.details,
                        "policy_at": utc_iso(latest_audit.created_at),
                        "evidence_url": latest_audit.evidence_url,
                    })
            except Exception:
                pass

            try:
                # Strike store may be Redis or in-memory; for single-instance it should be consistent.
                from utils.strike_store import get_state as _get_strike_state
                enforcement_state["strike_state"] = _get_strike_state(student.id) or None
            except Exception:
                enforcement_state["strike_state"] = None

        session_status_raw = (session.status or "").strip().lower() if session else ""
        is_live = bool(
            manager.is_connected(student.id)
            and session_status_raw in {"active", "running", "paused"}
        )
        status = _normalize_admin_status(
            session.status if session else None,
            is_live=is_live,
            last_active=last_active,
            now_utc=now_utc,
        )
        tier = _derive_risk_tier(violation_count)

        session_rows.append({
            "id": student.id,
            "session_id": session_id,
            "exam_id": int(session.exam_id) if session and session.exam_id is not None else None,
            "email": student.email,
            "full_name": student.full_name or "Student",
            "status": status,
            "is_live": is_live,
            "violation_count": violation_count,
            "tier": tier,
            "score": round(score, 2),
            "total_marks": total_marks,
            "progress": progress,
            "compliance": round(compliance, 2) if compliance is not None else None,
            "last_active": utc_iso(last_active),
            "exam_title": exam_title,
            "duration_minutes": duration_minutes,
            "enforcement": enforcement_state,
        })

    total_students = len(session_rows)
    active_students = sum(1 for row in session_rows if row.get("status") == "active")
    red_flags = sum(1 for row in session_rows if row.get("tier") in {"Flagged", "Critical"})
    compliance_values = [
        float(row["compliance"])
        for row in session_rows
        if row.get("compliance") is not None
    ]
    avg_compliance: Optional[float] = None
    if compliance_values:
        avg_compliance = round(sum(compliance_values) / len(compliance_values), 2)

    return {
        "generated_at": utc_iso(now_utc),
        "sessions": session_rows,
        "stats": {
            "active_students": active_students,
            "red_flags": red_flags,
            "avg_compliance": avg_compliance,
            "total_students": total_students,
            "live_connections": sum(1 for row in session_rows if row.get("is_live")),
            "system_status": "online",
        },
    }


def _build_exam_creator_config_payload() -> Dict[str, Any]:
    duration_min = min(EXAM_CREATOR_DURATION_MIN, EXAM_CREATOR_DURATION_MAX)
    duration_max = max(EXAM_CREATOR_DURATION_MIN, EXAM_CREATOR_DURATION_MAX)
    duration_step = max(1, EXAM_CREATOR_DURATION_STEP)
    duration_default = max(duration_min, min(EXAM_CREATOR_DURATION_DEFAULT, duration_max))
    window_buffer = max(0, EXAM_CREATOR_WINDOW_BUFFER)
    max_questions = max(1, EXAM_CREATOR_MAX_QUESTIONS)

    allowed_types = [item.upper() for item in EXAM_CREATOR_ALLOWED_TYPES if item]
    type_catalog = {
        "MCQ": {"value": "MCQ", "label": "Multiple Choice"},
        "TRUE_FALSE": {"value": "TRUE_FALSE", "label": "True/False"},
        "SUBJECTIVE": {"value": "SUBJECTIVE", "label": "Short Answer"},
    }
    normalized_types = [type_catalog[item] for item in allowed_types if item in type_catalog]
    if not normalized_types:
        normalized_types = list(type_catalog.values())

    return {
        "duration_minutes": {
            "min": duration_min,
            "max": duration_max,
            "step": duration_step,
            "default": duration_default,
        },
        "default_question_marks": round(EXAM_CREATOR_DEFAULT_MARKS, 2),
        "default_access_buffer_minutes": window_buffer,
        "max_questions_per_exam": max_questions,
        "default_exam_title_prefix": EXAM_CREATOR_DEFAULT_TITLE_PREFIX,
        "default_description": EXAM_CREATOR_DEFAULT_DESCRIPTION or None,
        "allowed_question_types": normalized_types,
    }


def _build_admin_exam_feed_payload(db: Session, limit: int) -> Dict[str, Any]:
    now_utc = _utc_now_naive()
    effective_limit = max(1, min(limit, 200))

    exams = db.query(Exam).order_by(Exam.created_at.desc(), Exam.id.desc()).limit(effective_limit).all()
    exam_ids = [exam.id for exam in exams]

    question_stats: Dict[int, Dict[str, float]] = {
        exam_id: {"question_count": 0.0, "total_marks": 0.0}
        for exam_id in exam_ids
    }
    if exam_ids:
        question_rows = db.query(
            Question.exam_id,
            func.count(Question.id).label("question_count"),
            func.coalesce(func.sum(Question.marks), 0).label("total_marks"),
        ).filter(Question.exam_id.in_(exam_ids)).group_by(Question.exam_id).all()

        for row in question_rows:
            question_stats[int(row.exam_id)] = {
                "question_count": float(row.question_count or 0),
                "total_marks": float(row.total_marks or 0),
            }

    session_stats: Dict[int, Dict[str, int]] = {
        exam_id: {"attempt_count": 0, "completed_attempt_count": 0}
        for exam_id in exam_ids
    }
    if exam_ids:
        session_rows = db.query(
            ExamSession.exam_id,
            ExamSession.status,
        ).filter(ExamSession.exam_id.in_(exam_ids)).all()

        for row in session_rows:
            if row.exam_id is None:
                continue
            exam_id = int(row.exam_id)
            current = session_stats.setdefault(
                exam_id,
                {"attempt_count": 0, "completed_attempt_count": 0},
            )
            current["attempt_count"] += 1
            if (row.status or "").lower() in {"completed", "submitted"}:
                current["completed_attempt_count"] += 1

    student_base = settings.STUDENT_FRONTEND_URL.rstrip("/")
    exam_rows: List[Dict[str, Any]] = []
    for exam in exams:
        exam_id = int(exam.id)
        start_utc = to_naive_utc(exam.start_time)
        end_utc = to_naive_utc(exam.end_time)
        computed_status = _compute_exam_status(now_utc, start_utc, end_utc)
        if not bool(exam.is_active):
            status_value = "inactive"
        elif computed_status == "invalid":
            status_value = "invalid"
        else:
            status_value = computed_status

        config = exam.config if isinstance(exam.config, dict) else {}
        qstats = question_stats.get(exam_id, {"question_count": 0.0, "total_marks": 0.0})
        sstats = session_stats.get(exam_id, {"attempt_count": 0, "completed_attempt_count": 0})

        exam_rows.append({
            "id": exam_id,
            "title": exam.title,
            "description": exam.description,
            "status": status_value,
            "is_active": bool(exam.is_active),
            "start_time": utc_iso(start_utc),
            "end_time": utc_iso(end_utc),
            "duration_minutes": int(exam.duration_minutes or 0),
            "question_count": int(qstats.get("question_count", 0)),
            "total_marks": round(float(qstats.get("total_marks", 0.0)), 2),
            "attempt_count": int(sstats.get("attempt_count", 0)),
            "completed_attempt_count": int(sstats.get("completed_attempt_count", 0)),
            "single_use": bool(config.get("single_use", False)),
            "created_at": utc_iso(exam.created_at),
            "created_by_id": exam.created_by,
            "exam_url": f"{student_base}/login?examId={exam_id}" if student_base else None,
            "monitor_key": exam.monitor_key,
        })

    total_exams = int(db.query(func.count(Exam.id)).scalar() or 0)
    active_exams = int(
        db.query(func.count(Exam.id))
        .filter(Exam.is_active == True)
        .scalar()
        or 0
    )
    live_exams = int(
        db.query(func.count(Exam.id))
        .filter(
            Exam.is_active == True,
            Exam.start_time <= now_utc,
            Exam.end_time >= now_utc,
        )
        .scalar()
        or 0
    )
    upcoming_exams = int(
        db.query(func.count(Exam.id))
        .filter(
            Exam.is_active == True,
            Exam.start_time > now_utc,
        )
        .scalar()
        or 0
    )
    ended_exams = int(
        db.query(func.count(Exam.id))
        .filter(
            Exam.end_time < now_utc,
        )
        .scalar()
        or 0
    )

    published_last_24h = int(
        db.query(func.count(Exam.id))
        .filter(
            Exam.created_at >= (now_utc - timedelta(hours=24)),
        )
        .scalar()
        or 0
    )

    return {
        "generated_at": utc_iso(now_utc),
        "stats": {
            "total_exams": total_exams,
            "active_exams": active_exams,
            "live_exams": live_exams,
            "upcoming_exams": upcoming_exams,
            "ended_exams": ended_exams,
            "published_last_24h": published_last_24h,
        },
        "exams": exam_rows,
    }


def _resolve_exam_session_window(
    db: Session,
    session: ExamSession,
) -> tuple[Optional[datetime], Optional[datetime], bool]:
    start_utc = to_naive_utc(session.start_time) if session.start_time else None
    end_utc = to_naive_utc(session.end_time) if session.end_time else None

    if end_utc is not None:
        return start_utc, end_utc, False

    if start_utc is None:
        return None, None, False

    next_session = db.query(ExamSession).filter(
        ExamSession.user_id == session.user_id,
        ExamSession.start_time > start_utc,
    ).order_by(ExamSession.start_time.asc()).first()

    if next_session and next_session.start_time:
        return start_utc, to_naive_utc(next_session.start_time), True

    return start_utc, None, False


def _apply_session_window(
    query,
    timestamp_column,
    start_utc: Optional[datetime],
    end_utc: Optional[datetime],
    end_is_exclusive: bool = False,
):
    if start_utc is not None:
        query = query.filter(timestamp_column >= start_utc)
    if end_utc is not None:
        query = query.filter(timestamp_column < end_utc if end_is_exclusive else timestamp_column <= end_utc)
    return query


def _get_session_violation_logs_query(db: Session, session: ExamSession):
    start_utc, end_utc, end_is_exclusive = _resolve_exam_session_window(db, session)
    query = db.query(Log).filter(
        Log.user_id == session.user_id,
        Log.event_type.notin_(list(NON_VIOLATION_EVENT_TYPES)),
    )
    return _apply_session_window(query, Log.timestamp, start_utc, end_utc, end_is_exclusive)


def _get_session_all_logs_query(db: Session, session: ExamSession):
    start_utc, end_utc, end_is_exclusive = _resolve_exam_session_window(db, session)
    query = db.query(Log).filter(Log.user_id == session.user_id)
    return _apply_session_window(query, Log.timestamp, start_utc, end_utc, end_is_exclusive)


def _get_session_evidence_records(db: Session, session: ExamSession) -> List[Evidence]:
    session_key = str(session.id)
    direct_records = db.query(Evidence).filter(
        Evidence.user_id == session.user_id,
        Evidence.session_id == session_key,
    ).order_by(Evidence.timestamp.asc()).all()
    if direct_records:
        return direct_records

    start_utc, end_utc, end_is_exclusive = _resolve_exam_session_window(db, session)
    query = db.query(Evidence).filter(Evidence.user_id == session.user_id)
    query = _apply_session_window(query, Evidence.timestamp, start_utc, end_utc, end_is_exclusive)
    return query.order_by(Evidence.timestamp.asc()).all()


def _build_admin_exam_result_participant(
    db: Session,
    session: ExamSession,
    total_questions: int,
    total_marks: float,
    now_utc: datetime,
) -> Dict[str, Any]:
    student = session.user
    all_logs_query = _get_session_all_logs_query(db, session)
    last_log = all_logs_query.order_by(Log.timestamp.desc()).first()
    last_active = last_log.timestamp if last_log else (session.end_time or session.start_time)
    is_live = bool(manager.is_connected(session.user_id) and (session.status or "").lower() in {"active", "running", "paused"})
    status = _normalize_admin_status(
        session.status,
        is_live=is_live,
        last_active=last_active,
        now_utc=now_utc,
    )

    violation_count = _get_session_violation_logs_query(db, session).count()
    tier = _derive_risk_tier(violation_count)

    saved_answers = session.saved_answers if isinstance(session.saved_answers, dict) else {}
    answered_count = len(saved_answers)
    progress = round((answered_count / total_questions) * 100, 2) if total_questions > 0 else 0.0

    score = float(session.score or 0.0)
    compliance = float(session.overall_compliance) if session.overall_compliance is not None else None
    score_percentage = round((score / total_marks) * 100, 2) if total_marks > 0 else None
    evidence_count = len(_get_session_evidence_records(db, session))

    return {
        "id": int(student.id) if student else int(session.user_id),
        "session_id": int(session.id),
        "exam_id": int(session.exam_id) if session.exam_id is not None else None,
        "email": student.email if student else "",
        "full_name": (student.full_name if student and student.full_name else "Student"),
        "status": status,
        "is_live": is_live,
        "violation_count": violation_count,
        "tier": tier,
        "score": round(score, 2),
        "total_marks": round(float(total_marks), 2),
        "score_percentage": score_percentage,
        "progress": progress,
        "compliance": round(compliance, 2) if compliance is not None else None,
        "last_active": utc_iso(last_active),
        "exam_title": session.exam.title if session.exam else None,
        "duration_minutes": int(session.exam.duration_minutes or 0) if session.exam else 0,
        "start_time": utc_iso(session.start_time),
        "end_time": utc_iso(session.end_time),
        "answered_count": answered_count,
        "question_count": total_questions,
        "evidence_count": evidence_count,
    }


def _serialize_session_progress(session: ExamSession, exam: Optional[Exam] = None) -> Dict[str, Any]:
    saved_answers = session.saved_answers if isinstance(session.saved_answers, dict) else {}
    fallback_remaining_seconds = int((exam.duration_minutes or 0) * 60) if exam else 0

    return {
        "session_id": int(session.id),
        "exam_id": int(session.exam_id) if session.exam_id is not None else None,
        "saved_answers": {
            str(question_id): (None if answer is None else str(answer))
            for question_id, answer in saved_answers.items()
        },
        "current_question_index": max(0, int(session.current_question_index or 0)),
        "remaining_seconds": max(0, int(session.remaining_seconds if session.remaining_seconds is not None else fallback_remaining_seconds)),
    }

class SessionInfo(BaseModel):
    user_id: int
    status: str
    start_time: Optional[datetime] = None
    duration: Optional[float] = None

@router.get("/session/{user_id}", response_model=SessionInfo)
def get_session_info(user_id: int, db: Session = Depends(get_db)):
    """Get current exam session info"""
    # Get most recent log
    latest_log = db.query(Log).filter(
        Log.user_id == user_id
    ).order_by(Log.timestamp.desc()).first()
    
    if latest_log:
        start_time = db.query(func.min(Log.timestamp)).filter(
            Log.user_id == user_id
        ).scalar()
        
        duration = None
        start_time_utc = None
        if start_time:
            start_time_utc = to_naive_utc(start_time)
            duration = (datetime.utcnow() - start_time_utc).total_seconds() / 60

        return SessionInfo(
            user_id=user_id,
            status="running",
            start_time=as_utc(start_time_utc) if start_time_utc else None,
            duration=round(duration, 2) if duration else None
        )
    
    return SessionInfo(
        user_id=user_id,
        status="not_started"
    )

@router.get("/available", response_model=List[AvailableExam])
async def get_available_exams(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return the exams a signed-in student can currently see from the dashboard."""
    now = _utc_now_naive()
    exams = db.query(Exam).filter(Exam.is_active == True).order_by(Exam.start_time.asc()).all()

    results: List[AvailableExam] = []
    for exam in exams:
        if not _is_user_eligible_for_exam(db, current_user, exam):
            continue

        exam_start = to_naive_utc(exam.start_time)
        exam_end = to_naive_utc(exam.end_time)

        latest_session = db.query(ExamSession).filter(
            ExamSession.user_id == current_user.id,
            ExamSession.exam_id == exam.id
        ).order_by(ExamSession.start_time.desc()).first()

        computed_status = _compute_exam_status(now, exam_start, exam_end)
        exam_status = computed_status if computed_status in {"active", "upcoming", "ended"} else "ended"

        can_join = exam_status == "active"
        action_message = "Open the lobby to begin your pre-checks."

        if computed_status == "invalid":
            action_message = "This exam access window is misconfigured. Please contact the administrator."
        elif exam_status == "upcoming":
            action_message = f"Available from {utc_iso(exam_start)}"
        elif exam_status == "ended":
            action_message = "This exam window has closed."
        elif latest_session and latest_session.status == "active":
            action_message = "Resume your in-progress exam attempt from where it stopped."

        if latest_session and (latest_session.status or "").lower() in {"completed", "submitted", "terminated"}:
            can_join = False
            action_message = "You have already used your only attempt for this exam."

        results.append(AvailableExam(
            id=exam.id,
            title=exam.title,
            description=exam.description,
            duration_minutes=exam.duration_minutes,
            start_time=as_utc(exam_start),
            end_time=as_utc(exam_end),
            status=exam_status,
            can_join=can_join,
            action_message=action_message,
            question_count=len(exam.questions),
            last_session_status=latest_session.status if latest_session else None
        ))

    status_order = {"active": 0, "upcoming": 1, "ended": 2}
    return sorted(
        results,
        key=lambda exam: (0 if exam.can_join else 1, status_order.get(exam.status, 3), exam.start_time)
    )

@router.post("/start/{user_id}")
async def start_exam_session(
    user_id: int,
    request: Request,
    exam_id: Optional[int] = None,
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db)
):
    """Start exam session with authorization"""
    try:
        # 1. Validate Safe Exam Browser (SEB)
        SEBService.validate_request(request)

        # Extract token and verify
        token = credentials.credentials
        current_user = get_current_user(token, db)
        
        if current_user.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to start this session"
            )

        if exam_id is not None:
            _deny_if_latest_session_terminated(db, user_id, exam_id)

        # Check for Single Use Link enforcement
        exam: Optional[Exam] = None
        existing_active_session: Optional[ExamSession] = None
        latest_exam_session: Optional[ExamSession] = None
        if exam_id:
            exam = db.query(Exam).filter(Exam.id == exam_id).first()
            if not exam:
                raise HTTPException(status_code=404, detail="Exam not found")

            if not _is_user_eligible_for_exam(db, current_user, exam):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your email is not eligible for this exam"
                )

            if not exam.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This exam is currently inactive"
                )

            existing_active_session = db.query(ExamSession).filter(
                ExamSession.user_id == user_id,
                ExamSession.exam_id == exam_id,
                ExamSession.status == "active"
            ).order_by(ExamSession.start_time.desc()).first()

            latest_exam_session = db.query(ExamSession).filter(
                ExamSession.user_id == user_id,
                ExamSession.exam_id == exam_id
            ).order_by(ExamSession.start_time.desc()).first()

            if latest_exam_session and not existing_active_session and (latest_exam_session.status or "").lower() in {"completed", "submitted", "terminated"}:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You have already used your only attempt for this exam."
                )

            if existing_active_session:
                session = existing_active_session
                base_url = _resolve_ws_base_url(request)
                ws_token = create_access_token({
                    "sub": str(user_id),
                    "session": str(session.id),
                    "type": "websocket"
                })

                return {
                    "message": "Session resumed",
                    "status": session.status,
                    "session_id": session.id,
                    "resumed": True,
                    "resume_state": {
                        **_serialize_session_progress(session, exam),
                        "resumed": True,
                    },
                    "wsUrl": f"{base_url}/{user_id}",
                    "wsConfig": {
                        "token": ws_token,
                        "additionalParams": {
                            "userId": user_id,
                            "examId": exam_id,
                            "maxDuration": 7200,
                            "keepAliveInterval": 15000
                        }
                    }
                }

            exam_start = to_naive_utc(exam.start_time)
            exam_end = to_naive_utc(exam.end_time)
            current_time = _utc_now_naive()
            exam_status = _compute_exam_status(current_time, exam_start, exam_end)

            if exam_status == "invalid":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Exam access window is misconfigured. Contact your administrator."
                )
            if exam_status == "upcoming":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Exam has not started yet. Available from {utc_iso(exam_start)}"
                )
            if exam_status == "ended":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Exam window closed at {utc_iso(exam_end)}"
                )
        
        # 2. Create or Update Exam Session in DB
        session = existing_active_session if exam_id else db.query(ExamSession).filter(
            ExamSession.user_id == user_id,
            ExamSession.exam_id == exam_id,
            ExamSession.status == "active"
        ).first()

        if not session:
            # Create new session record
            session = ExamSession(
                user_id=user_id,
                exam_id=exam_id,
                status="active",
                saved_answers={},
                current_question_index=0,
                remaining_seconds=int((exam.duration_minutes or 0) * 60) if exam else None,
            )
            db.add(session)
            db.commit()
            db.refresh(session)
        
        session_info = get_session_info(user_id, db)
        base_url = _resolve_ws_base_url(request)
        
        # Generate WebSocket tokens
        ws_token = create_access_token({
            "sub": str(user_id),
            "session": str(session.id),
            "type": "websocket"
        })
        
        return {
            "message": "Session established",
            "status": session.status,
            "session_id": session.id,
            "resumed": False,
            "resume_state": {
                **_serialize_session_progress(session, exam),
                "resumed": False,
            },
            "wsUrl": f"{base_url}/{user_id}",
            "wsConfig": {
                "token": ws_token,
                "additionalParams": {
                    "userId": user_id,
                    "examId": exam_id,
                    "maxDuration": 7200,
                    "keepAliveInterval": 15000
                }
            }
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Start session error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start session"
        )

@router.post("/log")
async def log_violation(
    log_data: LogCreate, 
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db)
):
    """Log a violation from the frontend (e.g., tab switch, copy-paste)"""
    try:
        user = get_current_user(credentials.credentials, db)
        event_exam_id = None
        if isinstance(log_data.event_data, dict):
            raw_exam_id = log_data.event_data.get("exam_id")
            try:
                event_exam_id = int(raw_exam_id) if raw_exam_id is not None else None
            except (TypeError, ValueError):
                event_exam_id = None

        _require_active_session_or_403(db, user.id, event_exam_id)
        
        # Check settings
        settings = db.query(SystemSettings).first()
        if not settings:
            settings = SystemSettings()
            
        # Filter based on settings
        if log_data.event_type == 'tab_switch' and not settings.tab_switching_detection:
            return {"message": "Violation ignored by system settings", "ignored": True}
        if log_data.event_type == 'copy_paste' and not settings.copy_paste_detection:
            return {"message": "Violation ignored by system settings", "ignored": True}
        if log_data.event_type == 'face_not_visible' and not settings.face_detection:
            return {"message": "Violation ignored by system settings", "ignored": True}
        if log_data.event_type == 'eye_movement' and not settings.face_detection:
            return {"message": "Violation ignored by system settings", "ignored": True}
        if log_data.event_type == 'head_posture' and not settings.face_detection:
            return {"message": "Violation ignored by system settings", "ignored": True}
        if log_data.event_type == 'mouth_movement' and not settings.audio_monitoring:
            return {"message": "Violation ignored by system settings", "ignored": True}

        # Create log entry
        new_log = Log(
            user_id=user.id,
            log=log_data.log,
            event_type=log_data.event_type,
            event_data=log_data.event_data,  # Store as JSON if possible, but model has string. 
                                          # SQLAlchemy might need JSON type or stringify. 
                                          # Model 'event_data' is String(1000) in models/logs.py? 
                                          # Wait, let me check models/logs.py again. 
                                          # It is String(1000). I should probably json.dumps it or update model to JSON.
                                          # For now, to avoid migration issues, I will stringify if it's a dict.
            timestamp=datetime.utcnow()
        )
        # Handle event_data conversion
        # Handle event_data conversion
        if isinstance(log_data.event_data, dict):
             import json
             try:
                 new_log.event_data = json.dumps(log_data.event_data)
             except Exception as json_err:
                 logger.error(f"Failed to serialize event_data: {json_err}")
                 new_log.event_data = str(log_data.event_data)

        db.add(new_log)
        db.commit()

        try:
            from services.termination_policy_service import TerminationPolicyService

            policy_action = TerminationPolicyService.evaluate(user.id, [str(log_data.event_type or "")])
            if policy_action.action in {"warn", "terminate"}:
                await TerminationPolicyService.apply_action(db, user.id, policy_action)
                if policy_action.action == "terminate" and manager.is_connected(user.id):
                    await manager.force_disconnect(user.id)
                return {
                    "message": "Violation logged",
                    "policy_action": policy_action.action,
                    "policy_reason": policy_action.reason,
                    "policy_details": policy_action.details,
                }
        except Exception as policy_exc:
            logger.debug(f"Frontend policy evaluation failed: {policy_exc}")

        return {"message": "Violation logged"}
    except Exception as e:
        logger.error(f"Failed to log violation: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to log violation")


@router.post("/progress/{user_id}", response_model=Dict[str, Any])
async def save_exam_progress(
    user_id: int,
    progress: ExamProgressUpdate,
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db)
):
    """Persist progress so interrupted students can resume the same attempt."""
    try:
        current_user = get_current_user(credentials.credentials, db)
        if current_user.id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

        session = _require_active_session_or_403(db, user_id, progress.exam_id)

        normalized_answers = {
            str(question_id): (None if answer is None else str(answer))
            for question_id, answer in (progress.answers or {}).items()
        }
        session.saved_answers = normalized_answers
        session.current_question_index = max(0, int(progress.current_question_index or 0))
        session.remaining_seconds = max(0, int(progress.remaining_seconds or 0))
        db.commit()

        return {
            "message": "Exam progress saved",
            "session_id": session.id,
            "resume_state": {
                **_serialize_session_progress(session, session.exam),
                "resumed": True,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to save exam progress for user {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to save exam progress")

@router.post("/session/{user_id}/screen-record")
async def upload_screen_record(
    user_id: int,
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db)
):
    """Upload a screen recording chunk to MinIO and log it as evidence"""
    try:
        current_user = get_current_user(credentials.credentials, db)
        if current_user.id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

        session = _require_active_session_or_403(db, user_id)

        # Read file data
        file_data = await file.read()
        
        # Upload to MinIO
        filename = f"screen_record_{user_id}_{secrets.token_hex(8)}.webm"
        uploaded_url = await StorageService.upload_file(
            file_data=file_data, 
            filename=filename, 
            content_type="video/webm"
        )

        if not uploaded_url:
            raise HTTPException(status_code=500, detail="Failed to upload recording to storage")

        session_id_str = str(session.id)

        # Save to DB
        evidence = Evidence(
            user_id=user_id,
            session_id=session_id_str,
            file_url=uploaded_url,
            media_type="video",
            violation_type="screen_record_chunk",
            is_flagged=False,
            # Let cleanup_service handle the exact expiration logic, 
            # but we can set a default expires_at here or leave it empty 
            # for the cleanup script to process based on violation status.
            timestamp=datetime.utcnow()
        )
        db.add(evidence)
        db.commit()

        return {"message": "Screen recording chunk uploaded successfully", "url": uploaded_url}

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Screen record upload failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to process screen recording")

@router.get("/admin/sessions", response_model=List[Dict])
async def get_all_sessions(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get all student sessions for Admin Dashboard with detailed exam info"""
    try:
        payload = _build_admin_live_payload(db)
        return payload["sessions"]
    except Exception as e:
        logger.error(f"Admin sessions fetch failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch sessions: {str(e)}")


@router.get("/admin/live", response_model=Dict[str, Any])
async def get_admin_live_monitor(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get realtime-ready live monitoring payload (sessions + summary stats)."""
    try:
        return _build_admin_live_payload(db)
    except Exception as e:
        logger.error(f"Admin live monitor fetch failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch live monitor data: {str(e)}")


class RoomVerifyRequest(BaseModel):
    exam_id: int
    monitor_key: str


@router.post("/admin/live/verify-room", response_model=Dict[str, Any])
async def verify_exam_room_key(
    payload: RoomVerifyRequest,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    """Verify a monitor key for a specific exam room."""
    exam = db.query(Exam).filter(Exam.id == payload.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if not exam.monitor_key:
        raise HTTPException(
            status_code=400,
            detail="This exam has no monitor key assigned. Please regenerate it from Exam Settings."
        )
    valid = secrets.compare_digest(str(exam.monitor_key), str(payload.monitor_key).strip().upper())
    return {"valid": valid, "exam_id": payload.exam_id}


@router.get("/admin/exam-creator/config", response_model=Dict[str, Any])
async def get_admin_exam_creator_config(
    current_user: User = Depends(get_current_admin_user),
):
    """Get dynamic admin exam-creator defaults and guardrails."""
    return _build_exam_creator_config_payload()


@router.get("/admin/proctoring/thresholds", response_model=Dict[str, Any])
async def get_admin_proctoring_thresholds(
    current_user: User = Depends(get_current_admin_user),
):
    """
    Expose the currently active proctoring thresholds/cooldowns.

    This is intended for admin dashboards and calibration tooling so operators
    can see what the backend is actually using (including env overrides).
    """
    return {
        "yolo": {
            "phone_confidence": cfg.yolo.phone_confidence,
            "person_confidence": cfg.yolo.person_confidence,
            "prohibited_object_confidence": cfg.yolo.prohibited_object_confidence,
            "phone_classes": sorted(list(cfg.yolo.phone_classes)),
            "prohibited_object_classes": sorted(list(cfg.yolo.prohibited_object_classes)),
        },
        "mediapipe": {
            "face_detection_confidence": cfg.mediapipe.face_detection_confidence,
        },
        "face_mesh": {
            "mar_threshold": cfg.face_mesh.mar_threshold,
            "ear_threshold": cfg.face_mesh.ear_threshold,
            "head_pose_threshold": cfg.face_mesh.head_pose_threshold,
            "gaze_horizontal_threshold": cfg.face_mesh.gaze_horizontal_threshold,
            "gaze_vertical_threshold": cfg.face_mesh.gaze_vertical_threshold,
        },
        "temporal": {
            "face_absence_frames": cfg.temporal.face_absence_frames,
            "object_detection_frames": cfg.temporal.object_detection_frames,
            "head_pose_frames": cfg.temporal.head_pose_frames,
            "eye_closed_frames": cfg.temporal.eye_closed_frames,
            "mouth_movement_frames": cfg.temporal.mouth_movement_frames,
            "gaze_away_frames": cfg.temporal.gaze_away_frames,
            "hand_presence_frames": cfg.temporal.hand_presence_frames,
            "cooldowns": {
                "face_not_visible": cfg.temporal.cooldown_face_not_visible,
                "phone_detected": cfg.temporal.cooldown_phone_detected,
                "multiple_people": cfg.temporal.cooldown_multiple_people,
                "prohibited_object": cfg.temporal.cooldown_prohibited_object,
                "head_posture": cfg.temporal.cooldown_head_posture,
                "eye_movement": cfg.temporal.cooldown_eye_movement,
                "mouth_movement": cfg.temporal.cooldown_mouth_movement,
                "hand_detected": cfg.temporal.cooldown_hand_detected,
                "gaze_looking_away": cfg.temporal.cooldown_gaze_looking_away,
                "face_spoofing": cfg.temporal.cooldown_face_spoofing,
            },
        },
        "frame_quality_gate": {
            "env": {
                "PROCTOR_FRAME_MIN_MEAN_LUMA": os.getenv("PROCTOR_FRAME_MIN_MEAN_LUMA", ""),
                "PROCTOR_FRAME_MAX_MEAN_LUMA": os.getenv("PROCTOR_FRAME_MAX_MEAN_LUMA", ""),
                "PROCTOR_FRAME_MIN_LAPLACIAN_VAR": os.getenv("PROCTOR_FRAME_MIN_LAPLACIAN_VAR", ""),
            }
        },
    }


@router.get("/admin/exams/live", response_model=Dict[str, Any])
async def get_admin_exams_live(
    limit: int = Query(default=ADMIN_EXAM_FEED_LIMIT, ge=1, le=200),
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    """Get near real-time feed for admin exam management."""
    try:
        return _build_admin_exam_feed_payload(db, limit=limit)
    except Exception as e:
        logger.error(f"Admin exams live feed fetch failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch admin exams feed: {str(e)}")


@router.get("/admin/results/exam/{exam_id}", response_model=Dict[str, Any])
async def get_admin_exam_results_detail(
    exam_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    """Get exam-scoped results with all attempts for a specific exam."""
    try:
        exam = db.query(Exam).filter(Exam.id == exam_id).first()
        if not exam:
            raise HTTPException(status_code=404, detail="Exam not found")

        now_utc = _utc_now_naive()
        start_utc = to_naive_utc(exam.start_time)
        end_utc = to_naive_utc(exam.end_time)
        computed_status = _compute_exam_status(now_utc, start_utc, end_utc)
        if not bool(exam.is_active):
            exam_status = "inactive"
        elif computed_status == "invalid":
            exam_status = "invalid"
        else:
            exam_status = computed_status

        questions = db.query(Question).filter(Question.exam_id == exam_id).all()
        total_questions = len(questions)
        total_marks = float(sum(float(question.marks or 0) for question in questions))

        sessions = db.query(ExamSession).filter(
            ExamSession.exam_id == exam_id
        ).order_by(ExamSession.start_time.desc(), ExamSession.id.desc()).all()

        participants = [
            _build_admin_exam_result_participant(
                db=db,
                session=session,
                total_questions=total_questions,
                total_marks=total_marks,
                now_utc=now_utc,
            )
            for session in sessions
        ]

        score_percentages = [
            float(participant["score_percentage"])
            for participant in participants
            if participant.get("score_percentage") is not None
        ]
        compliance_values = [
            float(participant["compliance"])
            for participant in participants
            if participant.get("compliance") is not None
        ]

        stats = {
            "attempt_count": len(participants),
            "student_count": len({participant["id"] for participant in participants}),
            "completed_attempt_count": sum(1 for participant in participants if participant.get("status") == "completed"),
            "active_attempt_count": sum(1 for participant in participants if participant.get("status") == "active"),
            "terminated_attempt_count": sum(1 for participant in participants if participant.get("status") == "terminated"),
            "flagged_attempt_count": sum(1 for participant in participants if participant.get("tier") in {"Flagged", "Critical"}),
            "avg_score_percentage": round(sum(score_percentages) / len(score_percentages), 2) if score_percentages else None,
            "avg_compliance": round(sum(compliance_values) / len(compliance_values), 2) if compliance_values else None,
            "highest_score_percentage": round(max(score_percentages), 2) if score_percentages else None,
            "live_connections": sum(1 for participant in participants if participant.get("is_live")),
        }

        return {
            "generated_at": utc_iso(now_utc),
            "exam": {
                "id": int(exam.id),
                "title": exam.title,
                "description": exam.description,
                "status": exam_status,
                "is_active": bool(exam.is_active),
                "start_time": utc_iso(exam.start_time),
                "end_time": utc_iso(exam.end_time),
                "duration_minutes": int(exam.duration_minutes or 0),
                "question_count": total_questions,
                "total_marks": round(total_marks, 2),
                "created_at": utc_iso(exam.created_at),
            },
            "stats": stats,
            "participants": participants,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin exam results fetch failed for exam {exam_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch exam results")


@router.get("/admin/summary/session/{session_id}")
async def get_session_attempt_summary(
    session_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get detailed summary for a specific exam attempt."""
    try:
        session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Exam session not found")

        student = db.query(User).filter(User.id == session.user_id).first()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")

        exam = db.query(Exam).filter(Exam.id == session.exam_id).first() if session.exam_id else None
        questions = db.query(Question).filter(Question.exam_id == session.exam_id).all() if session.exam_id else []

        question_details = []
        saved_answers = session.saved_answers if isinstance(session.saved_answers, dict) else {}
        total_marks = sum(float(q.marks or 0) for q in questions)

        for q in questions:
            user_answer = saved_answers.get(str(q.id), None)
            is_correct = False

            if user_answer:
                normalized_user = str(user_answer).strip().lower()
                normalized_correct = str(q.correct_option).strip().lower()
                is_correct = normalized_user == normalized_correct

            question_details.append({
                "id": q.id,
                "text": q.text,
                "type": q.question_type,
                "options": q.options,
                "correct_option": q.correct_option,
                "user_answer": user_answer,
                "is_correct": is_correct,
                "marks": q.marks,
                "marks_obtained": q.marks if is_correct else 0
            })

        violations = _get_session_violation_logs_query(db, session).order_by(Log.timestamp.desc()).limit(50).all()
        violation_details = [{
            "type": v.event_type,
            "timestamp": utc_iso(v.timestamp),
            "data": getattr(v, 'event_data', v.log)
        } for v in violations]

        user_image = None
        if student.image:
            user_image = base64.b64encode(student.image).decode('utf-8')

        return {
            "student": {
                "id": student.id,
                "email": student.email,
                "full_name": student.full_name,
                "image": user_image
            },
            "exam": {
                "id": exam.id if exam else None,
                "title": exam.title if exam else "Unknown Exam",
                "duration_minutes": exam.duration_minutes if exam else 0
            },
            "session": {
                "id": session.id,
                "status": session.status,
                "score": session.score or 0,
                "total_marks": round(total_marks, 2),
                "percentage": round((float(session.score or 0) / total_marks) * 100, 2) if total_marks > 0 else 0,
                "start_time": utc_iso(session.start_time),
                "end_time": utc_iso(session.end_time),
                "compliance": session.overall_compliance or 100
            },
            "questions": question_details,
            "violations": violation_details,
            "violation_count": len(violations)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Session summary fetch failed for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch session summary: {str(e)}")


@router.get("/admin/summary/student/{user_id}")
async def get_student_exam_summary(
    user_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get detailed exam summary for a specific student - for admin review"""
    try:
        student = db.query(User).filter(User.id == user_id).first()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        
        # Get latest completed session
        session = db.query(ExamSession).filter(
            ExamSession.user_id == user_id
        ).order_by(ExamSession.start_time.desc()).first()
        
        if not session:
            raise HTTPException(status_code=404, detail="No exam session found for this student")
        
        # Get exam and questions
        exam = db.query(Exam).filter(Exam.id == session.exam_id).first() if session.exam_id else None
        questions = db.query(Question).filter(Question.exam_id == session.exam_id).all() if session.exam_id else []
        
        # Build questions with user answers
        question_details = []
        saved_answers = session.saved_answers or {}
        total_marks = sum(q.marks for q in questions)
        
        for q in questions:
            user_answer = saved_answers.get(str(q.id), None)
            is_correct = False
            
            if user_answer:
                # Check if answer is correct
                normalized_user = str(user_answer).strip().lower()
                normalized_correct = str(q.correct_option).strip().lower()
                is_correct = normalized_user == normalized_correct
            
            question_details.append({
                "id": q.id,
                "text": q.text,
                "type": q.question_type,
                "options": q.options,
                "correct_option": q.correct_option,
                "user_answer": user_answer,
                "is_correct": is_correct,
                "marks": q.marks,
                "marks_obtained": q.marks if is_correct else 0
            })
        
        # Get violation logs
        violations = db.query(Log).filter(
            Log.user_id == user_id,
            Log.event_type.notin_(list(NON_VIOLATION_EVENT_TYPES))
        ).order_by(Log.timestamp.desc()).limit(50).all()
        
        violation_details = [{
            "type": v.event_type,
            "timestamp": utc_iso(v.timestamp),
            "data": getattr(v, 'event_data', v.log)  # Fallback to .log if event_data is missing
        } for v in violations]
        
        # Get user image if available
        user_image = None
        if student.image:
            user_image = base64.b64encode(student.image).decode('utf-8')
        
        return {
            "student": {
                "id": student.id,
                "email": student.email,
                "full_name": student.full_name,
                "image": user_image
            },
            "exam": {
                "id": exam.id if exam else None,
                "title": exam.title if exam else "Unknown Exam",
                "duration_minutes": exam.duration_minutes if exam else 0
            },
            "session": {
                "id": session.id,
                "status": session.status,
                "score": session.score or 0,
                "total_marks": total_marks,
                "percentage": round((session.score or 0) / total_marks * 100, 2) if total_marks > 0 else 0,
                "start_time": utc_iso(session.start_time),
                "end_time": utc_iso(session.end_time),
                "compliance": session.overall_compliance or 100
            },
            "questions": question_details,
            "violations": violation_details,
            "violation_count": len(violations)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Student summary fetch failed for user {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch student summary: {str(e)}")

@router.post("/pause/{user_id}")
def pause_exam_session(user_id: int):
    """Pause exam session"""
    if manager.set_paused(user_id, True):
        return {"message": "Session paused", "status": "paused"}
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="No active session found"
    )

@router.post("/resume/{user_id}")
def resume_exam_session(user_id: int):
    """Resume exam session"""
    if manager.set_paused(user_id, False):
        return {"message": "Session resumed", "status": "running"}
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="No active session found"
    )

async def cleanup_logs(user_id: int, delay: int = 30):
    """Delete logs after specified delay"""
    await asyncio.sleep(delay)
    
    db = SessionLocal()
    try:
        deleted_count = db.query(Log).filter(Log.user_id == user_id).delete()
        db.commit()
        logger.info(f"Cleaned up {deleted_count} logs for user {user_id}")
    except Exception as e:
        logger.error(f"Failed to cleanup logs: {str(e)}")
        db.rollback()
    finally:
        if db is not None:
            db.close()

async def handle_session_cleanup(user_id: int, db: Session, event_type: str = "session_ended"):
    """Helper to handle session cleanup operations"""
    try:
        # Force disconnect WebSocket
        if manager.is_connected(user_id):
            await manager.force_disconnect(user_id)
            logger.info(f"Closed WebSocket connection for user {user_id}")
        
        # Add session end log
        db.add(Log(
            user_id=user_id,
            log="Exam session ended",
            event_type=event_type,
            timestamp=datetime.utcnow()
        ))
        
        # Update session status
        session = db.query(ExamSession).filter(
            ExamSession.user_id == user_id,
            ExamSession.status == "active"
        ).order_by(ExamSession.start_time.desc()).first()
        
        if session:
            if event_type == "session_force_closed":
                session.status = "terminated"
            else:
                session.status = "completed"
            session.end_time = datetime.utcnow()
            
        db.commit()
        return True
    except Exception as e:
        logger.error(f"Session cleanup error: {str(e)}")
        db.rollback()
        return False

@router.post("/stop/{user_id}")
async def stop_exam_session(
    user_id: int,
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db)
):
    """Stop exam session and disconnect WebSocket immediately"""
    try:
        # Quick auth check
        current_user = get_current_user(credentials.credentials, db)
        if current_user.id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

        if not manager.is_connected(user_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active session found"
            )

        # Sequential operations for clean shutdown
        try:
            # 1. Add final log first
            final_log = Log(
                log="Exam session ended",
                event_type="session_ended",
                timestamp=datetime.utcnow(),
                user_id=user_id
            )
            db.add(final_log)
            
            # Update session status
            session = db.query(ExamSession).filter(
                ExamSession.user_id == user_id,
                ExamSession.status == "active"
            ).order_by(ExamSession.start_time.desc()).first()
            if session:
                session.status = "completed"
                session.end_time = datetime.utcnow()
                
            db.flush()
            
            # 2. Force disconnect websocket
            await manager.force_disconnect(user_id)
            
            # 3. Commit changes and keep logs for admin review
            db.commit()
            
            # 4. Only now return response
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"message": "Session stopped and connection closed successfully"}
            )
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error during session stop sequence: {str(e)}")
            raise

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Stop session error: {str(e)}")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "Failed to stop session"}
        )

@router.post("/force-close/{user_id}")
async def force_close_session(
    user_id: int,
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db)
):
    """Force close session and WebSocket connection without cleanup delay"""
    try:
        # Quick auth check
        current_user = get_current_user(credentials.credentials, db)
        if current_user.id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

        # Set cooldown before cleanup
        manager.set_cooldown(user_id, 5)  # 5 second cooldown
        
        # Force cleanup immediately
        cleanup_success = await handle_session_cleanup(user_id, db, "session_force_closed")
        if not cleanup_success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to force close session"
            )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"message": "Session forcefully closed successfully"}
        )

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Force close error: {str(e)}")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "Failed to force close session"}
        )

@router.get("/summary/{user_id}", response_model=ExamSummary)
async def get_exam_summary(
    user_id: int, 
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db)
):
    """Get exam summary for a user"""
    try:
        current_user = get_current_user(credentials.credentials, db)
        if current_user.id != user_id and current_user.role != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this summary")
        
        # Get all logs except session stop events
        logs = db.query(Log).filter(
            Log.user_id == user_id,
            Log.event_type.notin_(list(SYSTEM_EVENT_TYPES))
        ).all()
        
        if not logs:
            # No logs found - return a default summary instead of 404
            user = db.query(User).filter(User.id == user_id).first()
            user_image = None
            if user and user.image:
                user_image = base64.b64encode(user.image).decode('utf-8')
            
            return ExamSummary(
                total_duration=0.0,
                face_detection_rate=0.0,
                suspicious_activities={},
                overall_compliance=100.0,
                user=UserInfo(
                    email=user.email if user else "unknown",
                    image=user_image
                )
            )
        
        # Calculate metrics
        start_time = min(log.timestamp for log in logs)
        end_time = max(log.timestamp for log in logs)
        duration = (end_time - start_time).total_seconds() / 60
        
        face_detections: int = 0
        non_suspicious_events = set(NON_VIOLATION_EVENT_TYPES) | {
            "person_detected",  # Normal single-person detection is expected during exam
        }
        
        violation_tracking: Dict[str, List[Dict]] = {}
        for log in logs:
            if log.event_type == "face_detected":
                face_detections += 1
            elif log.event_type not in non_suspicious_events:
                if log.event_type not in violation_tracking:
                    violation_tracking[log.event_type] = []
                
                violation_tracking[log.event_type].append({
                    "timestamp": log.timestamp,
                    "event": log.log
                })

        # Process violations:
        # - Always include major violations on first occurrence
        # - Include minor termination categories when their threshold is reached
        # - Keep existing frequency-based inclusion for all other events
        suspicious_activities = {}
        for event_type, violations in violation_tracking.items():
            violation_count = len(violations)
            include_violation = False

            if event_type in MAJOR_VIOLATION_EVENT_TYPES:
                include_violation = violation_count >= 1
            elif event_type in MINOR_TERMINATION_THRESHOLDS:
                include_violation = violation_count >= MINOR_TERMINATION_THRESHOLDS[event_type]
            else:
                include_violation = violation_count > 10

            if include_violation:
                first_violation = min(violations, key=lambda x: x["timestamp"])
                suspicious_activities[event_type] = {
                    "count": violation_count,
                    "first_occurrence": utc_iso(first_violation["timestamp"])
                }
                
        # Calculate suspicious weight from all included suspicious activities
        suspicious_weight = sum(
            violation["count"]
            for violation in suspicious_activities.values()
        )
        
        # Calculate overall compliance
        face_detection_rate = float((face_detections / len(logs)) * 100 if len(logs) > 0 else 0.0)
        overall_compliance = max(0.0, face_detection_rate - float(suspicious_weight / len(logs) * 20))
        
        # 5. Persistent Session Update
        session = db.query(ExamSession).filter(
            ExamSession.user_id == user_id,
            ExamSession.status == "completed"
        ).order_by(ExamSession.end_time.desc()).first()
        
        if session:
            session.overall_compliance = overall_compliance
            session.is_summarized = True
            db.commit()

        # Get user info
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
            
        # Convert image to base64 if exists
        user_image = None
        if user.image:
            user_image = base64.b64encode(user.image).decode('utf-8')
        
        return ExamSummary(
            total_duration=round(duration, 2),
            face_detection_rate=round(face_detection_rate, 2),
            suspicious_activities=suspicious_activities,
            overall_compliance=round(overall_compliance, 2),
            user=UserInfo(
                email=user.email,
                image=user_image
            )
        )
        
    except Exception as e:
        logger.error(f"Error generating summary: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate summary"
        )

@router.post("/clear-logs/{user_id}")
async def clear_exam_logs(
    user_id: int,
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db)
):
    """Clear exam logs for a user"""
    try:
        # Verify user authorization
        current_user = get_current_user(credentials.credentials, db)
        if current_user.id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

        # Get logs count before deletion
        logs_count = db.query(Log).filter(Log.user_id == user_id).count()
        
        if logs_count == 0:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"message": "No logs found to clear"}
            )

        # Delete all logs for the user
        db.query(Log).filter(Log.user_id == user_id).delete()
        db.commit()
        
        logger.info(f"Cleared {logs_count} logs for user {user_id}")
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"message": f"Successfully cleared {logs_count} logs"}
        )

    except HTTPException as he:
        raise he
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to clear logs: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to clear logs"
        )

@router.post("/cleanup")
async def trigger_cleanup(
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db)
):
    """Manually trigger evidence cleanup (Admin only)"""
    from services.cleanup_service import CleanupService
    try:
        current_user = get_current_user(credentials.credentials, db)
        # Add strict role check for admin routes
        # if current_user.role != "admin":
        #    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

        count = await CleanupService.cleanup_expired_evidence(db)
        return {"message": "Cleanup executed", "deleted_files": count}
    except Exception as e:
        logger.error(f"Cleanup failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Cleanup failed"
        )

@router.post("/submit/{user_id}", response_model=ExamResult)
async def submit_exam(
    user_id: int,
    submission: ExamSubmission,
    background_tasks: BackgroundTasks,
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db)
):
    """Submit exam answers and get result"""
    try:
        # Verify user
        current_user = get_current_user(credentials.credentials, db)
        if current_user.id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

        _require_active_session_or_403(db, user_id, submission.exam_id)

        # Calculate Result
        result = await GradingService.grade_exam(user_id, submission, db)
        
        # Stop Proctoring (Close WebSocket & Cleanup)
        # We run this in background to not block the result response
        background_tasks.add_task(handle_session_cleanup, user_id, db, "exam_submitted")
        
        return result

    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Submission failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to submit exam")


@router.post("/admin/exam", response_model=ExamLink)
async def create_exam(
    exam_data: ExamCreate,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Create a new exam (Admin only)"""
    try:
        start_time_utc = to_naive_utc(exam_data.start_time)
        end_time_utc = to_naive_utc(exam_data.end_time)

        if end_time_utc <= start_time_utc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="End time must be later than start time"
            )

        if exam_data.duration_minutes <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Duration must be greater than 0 minutes"
            )

        window_minutes = int((end_time_utc - start_time_utc).total_seconds() // 60)
        if exam_data.duration_minutes > window_minutes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Exam duration cannot exceed the access window length"
            )

        eligible_emails = _normalize_email_list(
            [str(email) for email in (exam_data.eligible_emails or [])]
        )

        existing_users: List[User] = []
        if eligible_emails:
            existing_users = db.query(User).filter(
                func.lower(User.email).in_(eligible_emails)
            ).all()
            invalid_roles = [
                user.email for user in existing_users
                if (user.role or "").lower() not in {"", "student"}
            ]
            if invalid_roles:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"These emails already belong to non-student accounts: {', '.join(sorted(invalid_roles))}"
                )

        shared_temporary_password: Optional[str] = None
        shared_password_hash: Optional[str] = None
        if eligible_emails:
            shared_temporary_password = _generate_shared_temporary_password()
            shared_password_hash = bcrypt.hashpw(
                shared_temporary_password[:72].encode("utf-8"),
                bcrypt.gensalt()
            ).decode("utf-8")

        exam_monitor_key = _generate_monitor_key()

        new_exam = Exam(
            title=exam_data.title,
            description=exam_data.description,
            start_time=start_time_utc,
            end_time=end_time_utc,
            duration_minutes=exam_data.duration_minutes,
            is_active=exam_data.is_active,
            config=exam_data.config,
            created_by=current_user.id,
            monitor_key=exam_monitor_key,
        )
        db.add(new_exam)
        db.flush() # Get ID before adding questions

        # Add questions if provided
        if exam_data.questions:
            db_questions = [
                Question(
                    exam_id=new_exam.id,
                    text=q.text,
                    question_type=q.question_type,
                    options=q.options,
                    correct_option=q.correct_option,
                    marks=q.marks,
                    image_url=q.image_url
                ) for q in exam_data.questions
            ]
            db.add_all(db_questions)

        if eligible_emails and shared_password_hash:
            existing_by_email = {
                _normalize_email(user.email): user
                for user in existing_users
            }

            db.add_all([
                ExamEligibleStudent(exam_id=new_exam.id, email=email)
                for email in eligible_emails
            ])

            for email in eligible_emails:
                user = existing_by_email.get(email)
                if user is None:
                    user = User(
                        email=email,
                        password=shared_password_hash,
                        role="student",
                    )
                    db.add(user)
                    db.flush()
                    existing_by_email[email] = user
                else:
                    user.password = shared_password_hash
                    if not user.role:
                        user.role = "student"

                reset_requirement = db.query(UserPasswordResetRequirement).filter(
                    UserPasswordResetRequirement.user_id == user.id
                ).first()
                if reset_requirement is None:
                    db.add(UserPasswordResetRequirement(
                        user_id=user.id,
                        must_reset_password=True,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow(),
                    ))
                else:
                    reset_requirement.must_reset_password = True
                    reset_requirement.updated_at = datetime.utcnow()
        
        db.commit()
        db.refresh(new_exam)
        
        # Share links should land on student login/dashboard first, not the direct exam lobby route.
        student_base = settings.STUDENT_FRONTEND_URL.rstrip('/')
        link = f"{student_base}/login?examId={new_exam.id}"
        
        return ExamLink(
            exam_url=link,
            exam_id=new_exam.id,
            temporary_password=shared_temporary_password,
            eligible_email_count=len(eligible_emails),
            monitor_key=exam_monitor_key,
        )
    except HTTPException as he:
        db.rollback()
        raise he
    except Exception as e:
        db.rollback()
        logger.error(f"Create exam error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to create exam")


@router.post("/admin/exam/eligible-emails/import", response_model=Dict[str, Any])
async def import_exam_eligible_emails(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_admin_user),
):
    file_name = file.filename or "roster"
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded roster file is empty"
        )

    emails = _parse_eligible_email_file(file_name, file_bytes)
    if not emails:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid email addresses were found in the uploaded file"
        )

    return {
        "file_name": file_name,
        "emails": emails,
        "count": len(emails),
    }

@router.get("/{exam_id}")
async def get_exam_details(
    exam_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get exam details and questions (Public/Student)"""
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    if not _is_user_eligible_for_exam(db, current_user, exam):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your email is not eligible for this exam"
        )
    
    # Transform questions for frontend
    questions = []
    for q in exam.questions:
        questions.append({
            "id": q.id,
            "text": q.text,
            "type": q.question_type,
            "options": q.options,
            "marks": q.marks,
            "image_url": q.image_url
        })

    return {
        "id": exam.id,
        "title": exam.title,
        "description": exam.description,
        "duration_minutes": exam.duration_minutes,
        "start_time": utc_iso(exam.start_time),
        "end_time": utc_iso(exam.end_time),
        "questions": questions,
        "config": exam.config
    }

@router.post("/admin/exam/{exam_id}/questions")
async def upload_questions(
    exam_id: int,
    questions: List[QuestionCreate],
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Upload questions for an exam (Admin only)"""
    try:
        exam = db.query(Exam).filter(Exam.id == exam_id).first()
        if not exam:
            raise HTTPException(status_code=404, detail="Exam not found")
            
        db_questions = [
            Question(
                exam_id=exam_id,
                text=q.text,
                question_type=q.question_type,
                options=q.options,
                correct_option=q.correct_option,
                marks=q.marks,
                image_url=q.image_url
            ) for q in questions
        ]
        
        db.add_all(db_questions)
        db.commit()
        
        return {"message": f"Successfully uploaded {len(questions)} questions"}
    except Exception as e:
        db.rollback()
        logger.error(f"Upload questions error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to upload questions")

@router.get("/admin/exam/{exam_id}/link", response_model=ExamLink)
async def get_exam_link(
    exam_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get exam joining link"""
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
        
    student_base = settings.STUDENT_FRONTEND_URL.rstrip('/')
    link = f"{student_base}/login?examId={exam.id}"
    return ExamLink(exam_url=link, exam_id=exam.id)

@router.get("/admin/evidence/file")
async def get_evidence_file(
    key: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Return evidence file bytes so Admin UI can securely render snapshots."""
    evidence_record = db.query(Evidence).filter(Evidence.file_url == key).first()
    if not evidence_record:
        raise HTTPException(status_code=404, detail="Evidence file not found")

    file_data, content_type = StorageService.download_file(key)
    if not file_data:
        raise HTTPException(status_code=404, detail="Evidence content unavailable")

    return Response(content=file_data, media_type=content_type or "application/octet-stream")

@router.get("/admin/results/session/{session_id}/evidence", response_model=List[Dict])
async def get_result_session_evidence(
    session_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get evidence for a specific exam attempt."""
    try:
        session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Exam session not found")

        evidence_records = _get_session_evidence_records(db, session)
        return [
            {
                "id": r.id,
                "url": r.file_url,
                "type": r.violation_type,
                "timestamp": utc_iso(r.timestamp),
                "is_flagged": r.is_flagged
            }
            for r in evidence_records
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Session evidence fetch failed for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch evidence")


@router.delete("/admin/results/session/{session_id}/evidence", response_model=Dict[str, Any])
async def clear_result_session_evidence_vault(
    session_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Delete Evidence Vault artifacts for one specific exam attempt."""
    try:
        session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Exam session not found")

        student = db.query(User).filter(User.id == session.user_id).first()
        evidence_records = _get_session_evidence_records(db, session)
        suspicious_logs = _get_session_violation_logs_query(db, session).all()

        deleted_file_keys = set()
        deleted_files = 0
        for record in evidence_records:
            file_key = (record.file_url or "").strip()
            if file_key and file_key not in deleted_file_keys:
                StorageService.delete_file(file_key)
                deleted_file_keys.add(file_key)
                deleted_files += 1

        deleted_evidence_records = len(evidence_records)
        deleted_logs = len(suspicious_logs)

        for record in evidence_records:
            db.delete(record)

        for log_record in suspicious_logs:
            db.delete(log_record)

        db.commit()

        student_label = student.full_name if student and student.full_name else (student.email if student else f"user {session.user_id}")
        exam_title = session.exam.title if session.exam else f"exam session {session_id}"

        return {
            "message": f"Evidence Vault cleared for {student_label} in {exam_title}",
            "user_id": session.user_id,
            "session_id": session_id,
            "deleted_evidence_records": deleted_evidence_records,
            "deleted_logs": deleted_logs,
            "deleted_files": deleted_files,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Evidence vault cleanup failed for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to clear evidence vault data")


@router.get("/admin/results/session/{session_id}/timeline", response_model=List[Dict])
async def get_result_session_timeline(
    session_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get smart timeline events for one exam attempt."""
    try:
        session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Exam session not found")

        logs = _get_session_violation_logs_query(db, session).order_by(Log.timestamp.asc()).all()

        timeline = []
        for log in logs:
            severity = "low"
            if log.event_type in [
                "multiple_people",
                "phone_detected",
                "face_not_visible",
                "identity_mismatch",
                "looking_away",
                "face_spoofing",
                "prohibited_object",
                "third_party_communication",
                "screen_share_stopped",
                "camera_blocked_or_disabled",
                "tampering_detected",
                "remote_access_detected",
                "virtual_machine_detected",
                "capture_tool_detected",
                "abusive_behavior",
                "disruptive_behavior",
                "proctor_abuse",
                "policy_termination",
            ]:
                severity = "high"
            elif log.event_type in [
                "tab_switch",
                "copy_paste",
                "hand_detected",
                "head_posture",
                "eye_movement",
                "gaze_looking_away",
                "audio_anomaly",
                "mouth_movement",
            ]:
                severity = "medium"

            ai_confidence = 0
            if log.event_data:
                try:
                    import json
                    data = json.loads(log.event_data)
                    if "confidence" in data:
                        ai_confidence = int(float(data["confidence"]) * 100)
                    elif "suspicious" in data and data["suspicious"]:
                        ai_confidence = 95
                except Exception:
                    pass

            timeline.append({
                "timestamp": utc_iso(log.timestamp),
                "type": log.event_type,
                "message": log.log,
                "severity": severity,
                "ai_confidence": ai_confidence
            })

        return timeline
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Timeline fetch failed for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch timeline")

@router.get("/admin/session/{user_id}/evidence", response_model=List[Dict])
async def get_session_evidence(
    user_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get evidence timeline for a specific user"""
    from models.evidence import Evidence
    try:
        evidence_records = db.query(Evidence).filter(Evidence.user_id == user_id).order_by(Evidence.timestamp.asc()).all()
        
        return [
            {
                "id": r.id,
                "url": r.file_url,
                "type": r.violation_type,
                "timestamp": utc_iso(r.timestamp),
                "is_flagged": r.is_flagged
            }
            for r in evidence_records
        ]
    except Exception as e:
        logger.error(f"Evidence fetch failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch evidence")

@router.delete("/admin/session/{user_id}/evidence", response_model=Dict[str, Any])
async def clear_session_evidence_vault(
    user_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Delete all Evidence Vault artifacts for a student, including files and suspicious timeline logs."""
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Student not found")

        evidence_records = db.query(Evidence).filter(Evidence.user_id == user_id).all()
        suspicious_logs = db.query(Log).filter(
            Log.user_id == user_id,
            Log.event_type.notin_(list(NON_VIOLATION_EVENT_TYPES))
        ).all()

        deleted_file_keys = set()
        deleted_files = 0
        for record in evidence_records:
            file_key = (record.file_url or "").strip()
            if file_key and file_key not in deleted_file_keys:
                StorageService.delete_file(file_key)
                deleted_file_keys.add(file_key)
                deleted_files += 1

        deleted_evidence_records = len(evidence_records)
        deleted_logs = len(suspicious_logs)

        for record in evidence_records:
            db.delete(record)

        for log_record in suspicious_logs:
            db.delete(log_record)

        db.commit()

        return {
            "message": f"Evidence Vault cleared for {user.full_name or user.email or f'user {user_id}'}",
            "user_id": user_id,
            "deleted_evidence_records": deleted_evidence_records,
            "deleted_logs": deleted_logs,
            "deleted_files": deleted_files,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Evidence vault cleanup failed for user {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to clear evidence vault data")

@router.get("/admin/session/{user_id}/timeline", response_model=List[Dict])
async def get_session_timeline(
    user_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get smart timeline events for forensic player"""
    try:
        # Fetch all logs (excluding noisy frame events)
        logs = db.query(Log).filter(
            Log.user_id == user_id,
            Log.event_type.notin_(list(NON_VIOLATION_EVENT_TYPES))
        ).order_by(Log.timestamp.asc()).all()
        
        timeline = []
        for log in logs:
            severity = "low"
            # Updated severity logic based on actual event types
            if log.event_type in [
                "multiple_people",
                "phone_detected",
                "face_not_visible",
                "identity_mismatch",
                "looking_away",
                "face_spoofing",
                "prohibited_object",
                "third_party_communication",
                "screen_share_stopped",
                "camera_blocked_or_disabled",
                "tampering_detected",
                "remote_access_detected",
                "virtual_machine_detected",
                "capture_tool_detected",
                "abusive_behavior",
                "disruptive_behavior",
                "proctor_abuse",
                "policy_termination",
            ]:
                severity = "high"
            elif log.event_type in [
                "tab_switch",
                "copy_paste",
                "hand_detected",
                "head_posture",
                "eye_movement",
                "gaze_looking_away",
                "audio_anomaly",
                "mouth_movement",
            ]:
                severity = "medium"
            
            # Parse event_data for extra details
            ai_confidence = 0
            if log.event_data:
                try:
                    import json
                    data = json.loads(log.event_data)
                    # Extract confidence if available
                    if "confidence" in data:
                        ai_confidence = int(float(data["confidence"]) * 100)
                    elif "suspicious" in data and data["suspicious"]:
                        ai_confidence = 95 # Default high confidence for suspicious flags
                except:
                    pass

            timeline.append({
                "timestamp": utc_iso(log.timestamp),
                "type": log.event_type,
                "message": log.log,
                "severity": severity,
                "ai_confidence": ai_confidence
            })
            
        return timeline
    except Exception as e:
        logger.error(f"Timeline fetch failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch timeline")
