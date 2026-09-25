from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from config.database import Base
from typing import Any, Optional

class Evidence(Base):
    __tablename__ = "evidence"

    id: Any = Column(Integer, primary_key=True, index=True) # type: ignore
    user_id: Any = Column(Integer, ForeignKey("users.id")) # type: ignore
    session_id: Any = Column(String(100), index=True) # Link to exam session # type: ignore
    
    file_url: Any = Column(String(255), nullable=False) # type: ignore
    media_type: Any = Column(String(50), default="image") # image, video # type: ignore
    violation_type: Any = Column(String(100)) # e.g., person_detected, looking_away # type: ignore
    
    is_flagged: Any = Column(Boolean, default=False) # Red Tier if True # type: ignore
    expires_at: Any = Column(DateTime) # Auto-delete date (Green Tier) # type: ignore
    
    timestamp: Any = Column(DateTime, default=datetime.utcnow) # type: ignore
    
    # Relationships
    user = relationship("User", back_populates="evidence")

# Update User model to include relationship (will need to do this in user.py or here if circular import managed)
