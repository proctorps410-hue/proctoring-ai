"""
Detection Configuration â€” Production-Grade Threshold Management
===============================================================
All AI model thresholds are defined here in one place.
Values are loaded ONCE at application startup from environment variables with
sensible, research-backed defaults.

Environment variable overrides (set in .env or OS env):
  PROCTOR_YOLO_PHONE_THRESH     - float, default 0.60
  PROCTOR_YOLO_PERSON_THRESH    - float, default 0.55
  PROCTOR_MP_FACE_CONF          - float, default 0.60
  PROCTOR_MAR_THRESH            - float, default 0.38
  PROCTOR_HEAD_POSE_THRESH      - float, default 0.45
  PROCTOR_EAR_THRESH            - float, default 0.13
  PROCTOR_FACE_ABSENCE_FRAMES   - int,   default 4
  PROCTOR_FACE_COOLDOWN_SEC     - float, default 5.0
  PROCTOR_PHONE_COOLDOWN_SEC    - float, default 8.0
  PROCTOR_MULTI_COOLDOWN_SEC    - float, default 8.0
  PROCTOR_HEAD_COOLDOWN_SEC     - float, default 6.0
  PROCTOR_EYE_COOLDOWN_SEC      - float, default 6.0
  PROCTOR_MOUTH_COOLDOWN_SEC    - float, default 8.0
"""

import os
from dataclasses import dataclass, field


def _float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


def _int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class YOLOConfig:
    """YOLOv8 object detection thresholds (0.0 â€“ 1.0)."""
    # Phone / electronic device detection confidence
    # Production baseline: 0.60 reduces desk-object false positives for phone detection.
    phone_confidence: float = field(
        default_factory=lambda: _float("PROCTOR_YOLO_PHONE_THRESH", 0.60)
    )

    # Person detection: 0.45 catches partially-visible persons in webcam frame
    # (was 0.55 - missed second person who was half in frame)
    person_confidence: float = field(
        default_factory=lambda: _float("PROCTOR_YOLO_PERSON_THRESH", 0.45)
    )

    # Phone class names that YOLO should match
    phone_classes: frozenset = field(
        default_factory=lambda: frozenset({
            "cell phone", "phone", "mobile phone", "smartphone", "mobile"
        })
    )

    # Prohibited object class names (books, laptops, earphones, etc.)
    prohibited_object_classes: frozenset = field(
        default_factory=lambda: frozenset({
            "book", "laptop", "remote", "mouse", "keyboard"
        })
    )

    # Confidence threshold for prohibited object detection
    prohibited_object_confidence: float = field(
        default_factory=lambda: _float("PROCTOR_YOLO_PROHIBITED_THRESH", 0.55)
    )


@dataclass(frozen=True)
class MediaPipeConfig:
    """MediaPipe face detection confidence (higher = fewer false positives)."""
    # 0.60 reduces noisy detections while staying stable in standard room lighting.
    face_detection_confidence: float = field(
        default_factory=lambda: _float("PROCTOR_MP_FACE_CONF", 0.60)
    )


@dataclass(frozen=True)
class FaceMeshConfig:
    """
    Face mesh landmark-based detection thresholds.

    MAR (Mouth Aspect Ratio):
      - Closed mouth at rest: ~0.0 â€“ 0.10
      - Light speech / whispering: ~0.25 â€“ 0.35
      - Loud speech / yawning: ~0.45+
      â†’ 0.38 reduces false positives from brief lip movement/breathing.

    Head Pose (yaw / pitch â€” normalised landmark ratio):
      - Looking straight: Â±0.10
      - Casual glance: Â±0.20
      - Looking sideways at notes: Â±0.35+
      â†’ 0.45 tolerates normal posture shifts before flagging.

    EAR (Eye Aspect Ratio):
      - Eyes open: ~0.25 â€“ 0.35
      - Slow blink mid-close: ~0.15 â€“ 0.20
      - Eyes fully closed / squinting: < 0.15
      â†’ 0.13 reduces false positives from normal blinking.
    """
    # MAR (mouth): 0.38 catches normal talking; 0.46 was too high (only loud yawning).
    mar_threshold: float = field(
        default_factory=lambda: _float("PROCTOR_MAR_THRESH", 0.38)
    )
    # head_pose_threshold drives both yaw and pitch multipliers.
    # 0.30 → yaw_thresh = 30°, pitch_thresh = 21° — catches looking sideways at notes.
    # Previous 0.52 → 52° yaw only fired at extreme turning.
    head_pose_threshold: float = field(
        default_factory=lambda: _float("PROCTOR_HEAD_POSE_THRESH", 0.30)
    )
    ear_threshold: float = field(
        default_factory=lambda: _float("PROCTOR_EAR_THRESH", 0.13)
    )

    # Gaze tracking â€” iris off-center ratio thresholds
    # Slightly higher defaults reduce jitter and brief glance false positives.
    # Gaze: 0.32 horizontal / 0.26 vertical catches clear sideways eye movement
    # without triggering on normal reading glances.
    gaze_horizontal_threshold: float = field(
        default_factory=lambda: _float("PROCTOR_GAZE_H_THRESH", 0.32)
    )
    gaze_vertical_threshold: float = field(
        default_factory=lambda: _float("PROCTOR_GAZE_V_THRESH", 0.26)
    )


@dataclass(frozen=True)
class TemporalConfig:
    """
    Temporal smoothing and cooldown configuration.

    face_absence_frames:
      Number of consecutive missed frames before a "Face Not Visible" alert fires.
      Higher values tolerate brief tracking drops and focus on sustained absence.

    cooldown_*:
      Minimum seconds between consecutive alerts of the same type.
      Prevents alert flooding while ensuring genuine violations are still recorded.
    """
    face_absence_frames: int = field(
        default_factory=lambda: _int("PROCTOR_FACE_ABSENCE_FRAMES", 4)
    )
    object_detection_frames: int = field(
        default_factory=lambda: _int("PROCTOR_OBJECT_FRAMES", 2)
    )
    # 4 consecutive frames of head-away before flagging (was 6 — too slow to fire)
    head_pose_frames: int = field(
        default_factory=lambda: _int("PROCTOR_HEAD_POSE_FRAMES", 4)
    )
    eye_closed_frames: int = field(
        default_factory=lambda: _int("PROCTOR_EYE_CLOSED_FRAMES", 3)
    )
    # 5 consecutive mouth-open frames before flagging (was 8 — almost never fired)
    mouth_movement_frames: int = field(
        default_factory=lambda: _int("PROCTOR_MOUTH_MOVEMENT_FRAMES", 5)
    )
    # 4 gaze-away frames (was 6)
    gaze_away_frames: int = field(
        default_factory=lambda: _int("PROCTOR_GAZE_AWAY_FRAMES", 4)
    )
    hand_presence_frames: int = field(
        default_factory=lambda: _int("PROCTOR_HAND_PRESENCE_FRAMES", 2)
    )

    # Per-event cooldowns (seconds)
    cooldown_face_not_visible: float = field(
        default_factory=lambda: _float("PROCTOR_FACE_COOLDOWN_SEC", 5.0)
    )
    cooldown_phone_detected: float = field(
        default_factory=lambda: _float("PROCTOR_PHONE_COOLDOWN_SEC", 8.0)
    )
    cooldown_multiple_people: float = field(
        default_factory=lambda: _float("PROCTOR_MULTI_COOLDOWN_SEC", 8.0)
    )
    # 8s head posture cooldown (was 12s — violations could be missed for too long)
    cooldown_head_posture: float = field(
        default_factory=lambda: _float("PROCTOR_HEAD_COOLDOWN_SEC", 8.0)
    )
    cooldown_eye_movement: float = field(
        default_factory=lambda: _float("PROCTOR_EYE_COOLDOWN_SEC", 5.0)
    )
    # 10s mouth cooldown (was 18s — too long between repeated talking alerts)
    cooldown_mouth_movement: float = field(
        default_factory=lambda: _float("PROCTOR_MOUTH_COOLDOWN_SEC", 10.0)
    )
    cooldown_hand_detected: float = field(
        default_factory=lambda: _float("PROCTOR_HAND_COOLDOWN_SEC", 5.0)
    )
    # 7s gaze cooldown (was 10s)
    cooldown_gaze_looking_away: float = field(
        default_factory=lambda: _float("PROCTOR_GAZE_COOLDOWN_SEC", 7.0)
    )
    cooldown_face_spoofing: float = field(
        default_factory=lambda: _float("PROCTOR_SPOOF_COOLDOWN_SEC", 8.0)
    )
    cooldown_prohibited_object: float = field(
        default_factory=lambda: _float("PROCTOR_PROHIBITED_COOLDOWN_SEC", 8.0)
    )


@dataclass(frozen=True)
class SpoofingConfig:
    """
    Face spoofing detection thresholds.
    color_variance_threshold: spoofing score above this â†’ flagged as spoofed.
    Real faces typically score 0.2â€“0.4; photos/screens score 0.6â€“0.9.
    """
    color_variance_threshold: float = field(
        default_factory=lambda: _float("PROCTOR_SPOOF_VARIANCE_THRESH", 0.68)
    )


@dataclass(frozen=True)
class DetectionConfig:
    """Top-level container â€” import this singleton throughout the app."""
    yolo: YOLOConfig = field(default_factory=YOLOConfig)
    mediapipe: MediaPipeConfig = field(default_factory=MediaPipeConfig)
    face_mesh: FaceMeshConfig = field(default_factory=FaceMeshConfig)
    temporal: TemporalConfig = field(default_factory=TemporalConfig)
    spoofing: SpoofingConfig = field(default_factory=SpoofingConfig)


# Singleton loaded once at import time (startup)
detection_config = DetectionConfig()


