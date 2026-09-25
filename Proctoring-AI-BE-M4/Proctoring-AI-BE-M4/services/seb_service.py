from fastapi import Request, HTTPException
from config.settings import settings
import hashlib

from typing import Any

class SEBService:
    @staticmethod
    def validate_request(request: Request, exam_config: Any = None):
        """
        Validate X-SafeExamBrowser-RequestHash header.
        This ensures the request comes from a valid SEB client.
        """
        # If global strict mode is False, skip check (useful for dev/testing)
        if not settings.SEB_STRICT_MODE:
            return True

        # If strict mode is NOT enabled for this exam specifically, skip check
        if exam_config and not exam_config.get("seb_strict_mode", False):
            return True

        seb_hash = request.headers.get("X-SafeExamBrowser-RequestHash")
        
        if not seb_hash:
            raise HTTPException(
                status_code=403, 
                detail="Access denied. You must use Safe Exam Browser."
            )

        # In a real SEB setup, you compute the hash of the URL + Config Key
        # For now, we will validate against a known "Classroom Key"
        # configured in settings
        
        expected_key = settings.SEB_config_key # We need to add this to settings
        
        # Simple validation (Equality check for MVP)
        # In full production, this involves hashing the full URL
        if seb_hash != expected_key:
             raise HTTPException(
                status_code=403, 
                detail="Invalid SEB Configuration. Please re-download the config file."
            )
        
        return True
