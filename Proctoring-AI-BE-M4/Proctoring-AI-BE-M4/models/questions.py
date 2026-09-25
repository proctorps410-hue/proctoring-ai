from .base import Base
from sqlalchemy import Column, Integer, String, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON
from typing import Optional, Any

class Question(Base):
    __tablename__ = "questions"

    id: Any = Column(Integer, primary_key=True, index=True) # type: ignore
    exam_id: Any = Column(Integer, ForeignKey("exams.id")) # type: ignore
    
    text: Any = Column(Text, nullable=False) # type: ignore
    question_type: Any = Column(String(50), default="MCQ") # MCQ, SUBJECTIVE # type: ignore
    
    # For MCQ
    options: Any = Column(JSON, nullable=True) # List of strings or objects # type: ignore
    correct_option: Any = Column(String(255), nullable=True) # The correct answer key/text # type: ignore
    
    marks: Any = Column(Float, default=1.0) # type: ignore
    image_url: Any = Column(String(500), nullable=True) # type: ignore
    
    # Relationships
    exam = relationship("Exam", back_populates="questions")
