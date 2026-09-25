from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.types import JSON

from .base import Base


class PolicyAudit(Base):
    """
    Immutable audit record for policy decisions (warning/termination).
    """

    __tablename__ = "policy_audit"

    id: Any = Column(Integer, primary_key=True, index=True)  # type: ignore

    created_at: Any = Column(DateTime, default=datetime.utcnow, index=True)  # type: ignore
    user_id: Any = Column(Integer, index=True, nullable=False)  # type: ignore
    session_id: Any = Column(Integer, index=True, nullable=True)  # type: ignore
    exam_id: Any = Column(Integer, index=True, nullable=True)  # type: ignore

    action: Any = Column(String(24), nullable=False)  # warn | terminate
    reason: Any = Column(String(64), nullable=False)
    trigger_source: Any = Column(String(32), nullable=True)  # ws_detector | frontend_log | admin | system

    # Store rich structured data for forensic review.
    details: Any = Column(JSON, nullable=True)  # type: ignore
    thresholds: Any = Column(JSON, nullable=True)  # type: ignore
    trigger_event_types: Any = Column(JSON, nullable=True)  # type: ignore

    evidence_url: Any = Column(String(512), nullable=True)  # type: ignore

