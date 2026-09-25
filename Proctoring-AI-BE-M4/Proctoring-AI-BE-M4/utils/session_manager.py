from datetime import datetime
from typing import Dict, Optional
from utils.logger import logger

class SessionManager:
    def __init__(self):
        self._sessions: Dict[int, dict] = {}
    
    def start_session(self, user_id: int) -> None:
        self._sessions[user_id] = {
            "start_time": datetime.utcnow(),
            "status": "active"
        }
        logger.info(f"Started session for user {user_id}")
    
    def end_session(self, user_id: int) -> None:
        if user_id in self._sessions:
            self._sessions[user_id]["status"] = "completed"
            logger.info(f"Ended session for user {user_id}")
    
    def get_session(self, user_id: int) -> Optional[dict]:
        return self._sessions.get(user_id)
    
    def is_active(self, user_id: int) -> bool:
        session = self._sessions.get(user_id)
        return session is not None and session["status"] == "active"
    
    def cleanup(self, user_id: int) -> None:
        self._sessions.pop(user_id, None)
        logger.info(f"Cleaned up session for user {user_id}")

# Global instance
session_manager = SessionManager()
