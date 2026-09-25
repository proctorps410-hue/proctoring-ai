from datetime import datetime, timezone
from typing import Optional

UTC = timezone.utc


def as_utc(value: datetime) -> datetime:
    """Return a timezone-aware UTC datetime."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def to_naive_utc(value: datetime) -> datetime:
    """Normalize any datetime to UTC and drop tzinfo for DB-safe arithmetic."""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def utc_iso(value: Optional[datetime]) -> Optional[str]:
    """Serialize datetime as ISO-8601 UTC with trailing Z."""
    if value is None:
        return None
    return as_utc(value).isoformat().replace("+00:00", "Z")


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
