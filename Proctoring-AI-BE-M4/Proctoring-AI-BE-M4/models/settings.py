from .base import Base
from sqlalchemy import Column, Integer, Boolean, Float, String
from typing import Any

class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Any = Column(Integer, primary_key=True, index=True) # type: ignore
    
    # Proctoring Rules
    face_detection: Any = Column(Boolean, default=True) # type: ignore
    phone_detection: Any = Column(Boolean, default=True) # type: ignore
    multiple_persons_detection: Any = Column(Boolean, default=True) # type: ignore
    audio_monitoring: Any = Column(Boolean, default=True) # type: ignore
    tab_switching_detection: Any = Column(Boolean, default=True) # type: ignore
    copy_paste_detection: Any = Column(Boolean, default=True) # type: ignore
    auto_terminate_on_critical: Any = Column(Boolean, default=False) # type: ignore
    
    # Thresholds
    ai_sensitivity: Any = Column(Integer, default=75) # type: ignore
    confidence_threshold: Any = Column(Integer, default=80) # type: ignore
    model_version: Any = Column(String(100), default="ProctorAI v3.2 (Recommended)") # type: ignore
    processing_mode: Any = Column(String(50), default="Real-time Optimized") # type: ignore
    
    # Notifications
    enable_notifications: Any = Column(Boolean, default=True) # type: ignore
    email_alerts: Any = Column(Boolean, default=True) # type: ignore
    sound_alerts: Any = Column(Boolean, default=False) # type: ignore
