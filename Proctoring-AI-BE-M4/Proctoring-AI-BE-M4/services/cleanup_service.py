from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from models.evidence import Evidence
from models.sessions import ExamSession
from services.storage_service import StorageService
from utils.logger import logger

class CleanupService:
    @staticmethod
    async def cleanup_expired_evidence(db: Session):
        """
        Delete evidence files based on Storage Tiers:
        - Green Tier (Compliance >= 90): Delete 2 hours after exam
        - Yellow Tier (Compliance 70-89): Delete 7 days after exam
        - Red Tier (Compliance < 70 or is_flagged): Never Auto-Delete
        """
        try:
            now = datetime.utcnow()
            count = 0
            
            # Target unflagged evidence
            evidences = db.query(Evidence).filter(
                Evidence.is_flagged == False
            ).all()

            if not evidences:
                logger.info("No evidence to clean up.")
                return 0

            for record in evidences:
                # If explicit expiration is already set and elapsed
                if record.expires_at and record.expires_at < now:
                    StorageService.delete_file(record.file_url)
                    db.delete(record)
                    count += 1
                    continue

                # If no expiry explicitly set, determine dynamically from ExamSession
                if record.session_id and str(record.session_id) != "unknown":
                    session_id = None
                    try:
                        session_id = int(record.session_id)
                    except ValueError:
                        continue
                        
                    session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
                    
                    if session and session.end_time:
                        compliance = session.overall_compliance or 100
                        expires_at = None

                        if compliance >= 90:
                            # Green tier
                            expires_at = session.end_time + timedelta(hours=2)
                        elif compliance >= 70:
                            # Yellow tier
                            expires_at = session.end_time + timedelta(days=7)
                        else:
                            # Red tier (promoted to flagged)
                            record.is_flagged = True
                            db.commit()
                            continue

                        if expires_at:
                            if not record.expires_at:
                                record.expires_at = expires_at
                                db.commit()
                            
                            if expires_at < now:
                                StorageService.delete_file(record.file_url)
                                db.delete(record)
                                count += 1

            db.commit()
            logger.info(f"Cleanup complete. Deleted {count} expired evidence records.")
            return count
            
        except Exception as e:
            logger.error(f"Error during evidence cleanup: {str(e)}")
            db.rollback()
            return 0
