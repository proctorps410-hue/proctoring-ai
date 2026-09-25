from .base import Base
from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy import DateTime
from datetime import datetime
from typing import Any, Optional

class Log(Base):
    __tablename__ = "logs"

    id: Any = Column(Integer, primary_key=True, index=True) # type: ignore
    log: Any = Column(String(1000)) # type: ignore
    event_type: Any = Column(String(100)) # type: ignore
    timestamp: Any = Column(DateTime, default=datetime.utcnow) # type: ignore
    user_id: Any = Column(Integer, ForeignKey("users.id")) # type: ignore
    event_data: Any = Column(String(1000), nullable=True) # type: ignore
    
    user = relationship("User", back_populates="logs")
