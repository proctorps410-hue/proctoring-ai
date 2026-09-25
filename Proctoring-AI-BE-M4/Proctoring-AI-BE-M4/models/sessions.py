from .base import Base
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Float
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON
from datetime import datetime
from typing import Optional, Any

class ExamSession(Base):
    __tablename__ = "exam_sessions"

    id: Any = Column(Integer, primary_key=True, index=True) # type: ignore
    user_id: Any = Column(Integer, ForeignKey("users.id")) # type: ignore
    exam_id: Any = Column(Integer, ForeignKey("exams.id"), nullable=True) # type: ignore
    
    start_time: Any = Column(DateTime, default=datetime.utcnow) # type: ignore
    end_time: Any = Column(DateTime, nullable=True) # type: ignore
    
    status: Any = Column(String(20), default="active")  # active, paused, submitted, terminated # type: ignore
    
    # Crash Recovery & Progress
    remaining_seconds: Any = Column(Integer, nullable=True) # type: ignore
    current_question_index: Any = Column(Integer, default=0) # type: ignore
    saved_answers: Any = Column(JSON, default={}) # {"q_id": "answer"} # type: ignore
    
    is_summarized: Any = Column(Boolean, default=False) # type: ignore
    score: Any = Column(Float, nullable=True) # type: ignore
    overall_compliance: Any = Column(Float, nullable=True) # type: ignore

    # Relationships
    user = relationship("User", back_populates="exam_sessions")
    exam = relationship("Exam", back_populates="sessions")
