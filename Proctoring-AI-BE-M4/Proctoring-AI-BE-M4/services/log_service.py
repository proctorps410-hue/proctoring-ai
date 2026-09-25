from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from models.logs import Log
from models.evidence import Evidence
from models.sessions import ExamSession
from utils.logger import logger
import json

class LogService:
    @staticmethod
    async def store_logs(db: Session, user_id: int, logs: list) -> list:
        if not logs:
            return []

        logger.info(f"Attempting to store {len(logs)} logs for user {user_id}")
        log_entries = []
        evidence_entries = []

        try:
            latest_session = db.query(ExamSession).filter(
                ExamSession.user_id == user_id
            ).order_by(ExamSession.start_time.desc()).first()
            session_id = str(latest_session.id) if latest_session else None

            # Create all log entries first
            for log_entry in logs:
                try:
                    event_data = {}
                    if log_entry.get("details"):
                        event_data["details"] = log_entry.get("details")
                    if log_entry.get("confidence") is not None:
                        event_data["confidence"] = log_entry.get("confidence")
                    if log_entry.get("suspicious") is not None:
                        event_data["suspicious"] = log_entry.get("suspicious")

                    db_log = Log(
                        log=log_entry["event"],
                        event_type=log_entry.get("event_type", log_entry["event"].lower().replace(" ", "_")),
                        timestamp=datetime.utcnow(),
                        user_id=user_id,
                        event_data=json.dumps(event_data) if event_data else None
                    )
                    log_entries.append(db_log)
                    
                    # Create Evidence only if a valid file_url is present.
                    # Some detector payloads may carry file_url=None when upload fails.
                    raw_file_url = log_entry.get("file_url")
                    file_url = raw_file_url.strip() if isinstance(raw_file_url, str) else None
                    if file_url:
                        # Retention Policy:
                        # Green Tier (Not Flagged): Auto-delete after 72 hours
                        # Red Tier (Flagged): Keep indefinitely (None)
                        is_flagged = log_entry.get("is_flagged", False)
                        expires_at = None
                        if not is_flagged:
                            expires_at = datetime.utcnow() + timedelta(hours=72)

                        db_evidence = Evidence(
                            user_id=user_id,
                            session_id=session_id,
                            file_url=file_url,
                            media_type="image",
                            violation_type=log_entry.get("event_type") or log_entry.get("type", "unknown"),
                            is_flagged=is_flagged,
                            expires_at=expires_at,
                            timestamp=datetime.utcnow()
                        )
                        evidence_entries.append(db_evidence)
                        
                    logger.debug(f"Created log entry: {log_entry}")
                except Exception as e:
                    logger.error(f"Error creating log entry: {str(e)}")
                    continue
            
            if log_entries:
                try:
                    # Add all entries to session
                    for entry in log_entries:
                        db.add(entry)
                    for entry in evidence_entries:
                        db.add(entry)
                    
                    # Commit transaction
                    db.flush()  # Flush changes to DB
                    db.commit()  # Commit transaction
                    logger.info(f"Successfully stored {len(log_entries)} logs")
                    
                    # Refresh entries to get their IDs
                    for entry in log_entries:
                        db.refresh(entry)
                        
                    return log_entries
                except Exception as e:
                    logger.error(f"Database error: {str(e)}", exc_info=True)
                    db.rollback()
                    return []

        except Exception as e:
            logger.error(f"Transaction error: {str(e)}", exc_info=True)
            if 'db' in locals():
                db.rollback()
            return []

        return []
