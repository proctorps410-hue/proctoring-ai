from .base import Base
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON
from datetime import datetime
from typing import Optional, Any

class Exam(Base):
    __tablename__ = "exams"

    id: Any = Column(Integer, primary_key=True, index=True) # type: ignore
    title: Any = Column(String(255), nullable=False) # type: ignore
    description: Any = Column(Text, nullable=True) # type: ignore
    
    # Scheduling
    start_time: Any = Column(DateTime, nullable=False) # type: ignore
    end_time: Any = Column(DateTime, nullable=False) # type: ignore
    duration_minutes: Any = Column(Integer, nullable=False) # type: ignore
    
    # Security Config
    is_active: Any = Column(Boolean, default=True) # type: ignore
    ip_range_restriction: Any = Column(JSON, nullable=True) # List of allowed CIDRs/IPs # type: ignore
    monitor_key: Any = Column(String(16), nullable=True)  # Room monitor credential (admin-only) # type: ignore
    
    # Proctoring Rules (JSON)
    config: Any = Column(JSON, default={})  # type: ignore
    
    created_by: Any = Column(Integer, ForeignKey("users.id")) # type: ignore
    created_at: Any = Column(DateTime, default=datetime.utcnow) # type: ignore

    # Relationships
    creator = relationship("User", back_populates="created_exams")
    questions = relationship("Question", back_populates="exam", cascade="all, delete-orphan")
    sessions = relationship("ExamSession", back_populates="exam")
