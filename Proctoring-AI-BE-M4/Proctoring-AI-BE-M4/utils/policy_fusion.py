from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Set


@dataclass(frozen=True)
class FusionDecision:
    kept: List[Dict]
    dropped: List[Dict]


_LOW_TRUST_WHEN_FACE_MISSING: Set[str] = {
    "gaze_looking_away",
    "head_posture",
    "eye_movement",
    "mouth_movement",
    "hand_detected",
    "face_spoofing",
    "identity_mismatch",
}

_LOW_TRUST_WHEN_IDENTITY_UNVERIFIABLE: Set[str] = {
    "gaze_looking_away",
    "head_posture",
    "eye_movement",
    "mouth_movement",
    "face_spoofing",
}

_LOW_TRUST_WHEN_MULTIPLE_FACES: Set[str] = {
    "identity_mismatch",
    "identity_unverifiable",
}


def _event_types(logs: Iterable[Dict]) -> Set[str]:
    return {str(log.get("event_type") or "") for log in logs if log.get("event_type")}


def fuse_detector_logs(logs: List[Dict]) -> FusionDecision:
    """
    Apply cross-detector conflict rules and output stabilization.

    This does NOT make termination decisions; it only prevents contradictory,
    low-trust signals from being emitted together in the same frame batch.
    """
    if not logs:
        return FusionDecision(kept=[], dropped=[])

    event_types = _event_types(logs)
    dropped: List[Dict] = []
    kept: List[Dict] = []

    face_missing = "face_not_visible" in event_types
    identity_unverifiable = "identity_unverifiable" in event_types
    multiple_people = "multiple_people" in event_types
    low_quality = "frame_quality_low" in event_types
    # Face guide box signals mean the face is not in a stable / analyzable position.
    # Suppress landmark-derived events in the same frame batch to avoid noisy conflicts.
    face_guide_unstable = any(
        event in event_types
        for event in (
            "face_outside_box",
            "face_partially_visible",
            "face_too_close",
            "face_too_far",
        )
    )

    suppress: Set[str] = set()
    if face_missing:
        suppress |= _LOW_TRUST_WHEN_FACE_MISSING
    if identity_unverifiable:
        suppress |= _LOW_TRUST_WHEN_IDENTITY_UNVERIFIABLE
    if multiple_people:
        suppress |= _LOW_TRUST_WHEN_MULTIPLE_FACES
    if face_guide_unstable:
        suppress |= {
            "gaze_looking_away",
            "head_posture",
            "eye_movement",
            "mouth_movement",
            "hand_detected",
            "face_spoofing",
        }
    if low_quality:
        # Low-quality frames are extremely jittery for landmark-derived events.
        suppress |= {
            "gaze_looking_away",
            "head_posture",
            "eye_movement",
            "mouth_movement",
            "hand_detected",
            "face_spoofing",
        }

    for log in logs:
        event_type = str(log.get("event_type") or "")
        if event_type and event_type in suppress:
            dropped.append(log)
        else:
            kept.append(log)

    return FusionDecision(kept=kept, dropped=dropped)


def fuse_logs_inplace(logs: List[Dict], include_debug: bool = False) -> List[Dict]:
    decision = fuse_detector_logs(logs)
    if include_debug and decision.dropped:
        # Provide an optional debug marker without changing downstream semantics.
        decision.kept.append(
            {
                "event": "Fusion suppressed low-trust signals.",
                "event_type": "fusion_suppressed",
                "details": f"dropped_event_types={[str(item.get('event_type')) for item in decision.dropped]}",
                "suspicious": False,
            }
        )
    return decision.kept

