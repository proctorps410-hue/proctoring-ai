import os
import time
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from config.database import get_db
from models.settings import SystemSettings
from schemas.settings import SystemSettingsResponse, SystemSettingsUpdate

router = APIRouter()

@router.get("/health", response_model=Dict[str, Any])
async def health_check(db: Session = Depends(get_db)):
    """
    Lightweight health/readiness endpoint for production monitoring.

    - Confirms DB connectivity
    - Reports detector warmup readiness
    """
    db_ok = True
    db_error = None
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db_ok = False
        db_error = str(exc)

    warmup_state: Dict[str, Any] = {}
    try:
        from services.warmup_service import WarmupService

        warmup_state = WarmupService.get_state()
    except Exception as exc:
        warmup_state = {
            "ready": False,
            "error": f"warmup_state_unavailable: {exc}",
        }

    return {
        "ok": bool(db_ok) and bool(warmup_state.get("ready")),
        "server_time_ms": int(time.time() * 1000),
        "db": {
            "ok": db_ok,
            "error": db_error,
        },
        "proctoring": {
            "warmup": warmup_state,
        },
        "build": {
            "env": os.getenv("APP_ENV", "unknown"),
        },
    }

@router.get("/", response_model=SystemSettingsResponse)
async def get_settings(db: Session = Depends(get_db)):
    """Fetch global system settings. Creates default settings if none exist."""
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

@router.patch("/", response_model=SystemSettingsResponse)
async def update_settings(
    settings_update: SystemSettingsUpdate,
    db: Session = Depends(get_db)
):
    """Update global system settings."""
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    
    update_data = settings_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(settings, key, value)
    
    db.commit()
    db.refresh(settings)
    return settings
