from datetime import datetime
from typing import Any

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

from .base import Base


class ExamEligibleStudent(Base):
    __tablename__ = "exam_eligible_students"
    __table_args__ = (
        UniqueConstraint("exam_id", "email", name="uq_exam_eligible_students_exam_email"),
    )

    id: Any = Column(Integer, primary_key=True, index=True)  # type: ignore
    exam_id: Any = Column(Integer, ForeignKey("exams.id"), nullable=False, index=True)  # type: ignore
    email: Any = Column(String(255), nullable=False, index=True)  # type: ignore
    created_at: Any = Column(DateTime, default=datetime.utcnow, nullable=False)  # type: ignore
