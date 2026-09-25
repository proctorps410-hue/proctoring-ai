from datetime import datetime
from typing import Any

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, LargeBinary, String, UniqueConstraint

from .base import Base


class UserFaceReference(Base):
    __tablename__ = "user_face_references"
    __table_args__ = (
        UniqueConstraint("user_id", "pose", name="uq_user_face_references_user_pose"),
    )

    id: Any = Column(Integer, primary_key=True, index=True)  # type: ignore
    user_id: Any = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)  # type: ignore
    pose: Any = Column(String(32), nullable=False, index=True)  # type: ignore
    image: Any = Column(LargeBinary, nullable=False)  # type: ignore
    quality_score: Any = Column(Float, nullable=True)  # type: ignore
    created_at: Any = Column(DateTime, default=datetime.utcnow, nullable=False)  # type: ignore
    updated_at: Any = Column(DateTime, default=datetime.utcnow, nullable=False)  # type: ignore
