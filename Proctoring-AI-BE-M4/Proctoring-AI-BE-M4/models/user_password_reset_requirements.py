from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer

from .base import Base


class UserPasswordResetRequirement(Base):
    __tablename__ = "user_password_reset_requirements"

    user_id: Any = Column(Integer, ForeignKey("users.id"), primary_key=True, index=True)  # type: ignore
    must_reset_password: Any = Column(Boolean, default=True, nullable=False)  # type: ignore
    created_at: Any = Column(DateTime, default=datetime.utcnow, nullable=False)  # type: ignore
    updated_at: Any = Column(DateTime, default=datetime.utcnow, nullable=False)  # type: ignore
