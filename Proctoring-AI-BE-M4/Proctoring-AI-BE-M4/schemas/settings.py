from pydantic import BaseModel
from typing import Optional

class SystemSettingsBase(BaseModel):
    face_detection: bool = True
    phone_detection: bool = True
    multiple_persons_detection: bool = True
    audio_monitoring: bool = True
    tab_switching_detection: bool = True
    copy_paste_detection: bool = True
    auto_terminate_on_critical: bool = False
    ai_sensitivity: int = 75
    confidence_threshold: int = 80
    enable_notifications: bool = True
    email_alerts: bool = True
    sound_alerts: bool = False
    model_version: str = "ProctorAI v3.2 (Recommended)"
    processing_mode: str = "Real-time Optimized"

class SystemSettingsUpdate(BaseModel):
    face_detection: Optional[bool] = None
    phone_detection: Optional[bool] = None
    multiple_persons_detection: Optional[bool] = None
    audio_monitoring: Optional[bool] = None
    tab_switching_detection: Optional[bool] = None
    copy_paste_detection: Optional[bool] = None
    auto_terminate_on_critical: Optional[bool] = None
    ai_sensitivity: Optional[int] = None
    confidence_threshold: Optional[int] = None
    enable_notifications: Optional[bool] = None
    email_alerts: Optional[bool] = None
    sound_alerts: Optional[bool] = None
    model_version: Optional[str] = None
    processing_mode: Optional[str] = None

class SystemSettingsResponse(SystemSettingsBase):
    id: int

    class Config:
        from_attributes = True
