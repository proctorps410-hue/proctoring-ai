"""
Face Box Monitoring Module
==========================
Tracks whether the student's face stays within the on-screen guide box.
The detector exposes a lightweight live state for the frontend and emits
box-rule violations only after sustained breaches to reduce false positives.
"""

from __future__ import annotations

import math
import threading
from datetime import datetime
from typing import Any, Dict, Optional

import cv2
import mediapipe as mp  # type: ignore

from config.detection_config import detection_config as cfg
from utils.logger import logger

mp_face_detection = mp.solutions.face_detection  # type: ignore

GUIDE_WIDTH_RATIO = 0.72
GUIDE_HEIGHT_RATIO = 0.80
GUIDE_LEFT_RATIO = (1.0 - GUIDE_WIDTH_RATIO) / 2.0
GUIDE_TOP_RATIO = (1.0 - GUIDE_HEIGHT_RATIO) / 2.0
GUIDE_RIGHT_RATIO = GUIDE_LEFT_RATIO + GUIDE_WIDTH_RATIO
GUIDE_BOTTOM_RATIO = GUIDE_TOP_RATIO + GUIDE_HEIGHT_RATIO

FRAME_EDGE_MARGIN_RATIO = 0.025
GUIDE_EDGE_BUFFER_RATIO = 0.06
FACE_TOO_CLOSE_HEIGHT_RATIO = 0.82
FACE_TOO_CLOSE_WIDTH_RATIO = 0.78
FACE_TOO_FAR_HEIGHT_RATIO = 0.28
FACE_TOO_FAR_WIDTH_RATIO = 0.24

EDGE_WARNING_AFTER_SEC = 1.0
OUTSIDE_WARNING_AFTER_SEC = 1.0
OUTSIDE_CRITICAL_AFTER_SEC = 3.0
OUTSIDE_FLAG_AFTER_SEC = 8.0
OUTSIDE_TERMINATION_AFTER_SEC = 20.0
MISSING_WARNING_AFTER_SEC = 3.0
MISSING_CRITICAL_AFTER_SEC = 5.0


class FaceBoxMonitor:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(FaceBoxMonitor, cls).__new__(cls)
                    cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        self.process_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.user_states = {}
        self.face_detector = None
        self.required_frames = {
            "face_outside_box": 3,
            "face_partially_visible": 2,
            "face_too_close": 3,
            "face_too_far": 3,
        }
        self.cooldowns = {
            "face_outside_box": cfg.temporal.cooldown_face_not_visible,
            "face_partially_visible": cfg.temporal.cooldown_head_posture,
            "face_too_close": cfg.temporal.cooldown_head_posture,
            "face_too_far": cfg.temporal.cooldown_head_posture,
        }

        try:
            self.face_detector = mp_face_detection.FaceDetection(
                model_selection=0,
                min_detection_confidence=cfg.mediapipe.face_detection_confidence,
            )
        except Exception as exc:
            logger.error(f"Failed to initialize FaceBoxMonitor face detector: {exc}")

    def _state_key(self, user_id):
        return user_id if user_id is not None else "__default__"

    def _build_default_live_state(self):
        return {
            "status": "inside",
            "severity": "ok",
            "box_color": "green",
            "message": "Position your face within the box",
            "voice_prompt": None,
            "face_detected": False,
            "continuous_seconds": 0.0,
            "seconds_until_flag": None,
            "seconds_until_termination": None,
            "guide": {
                "width_ratio": GUIDE_WIDTH_RATIO,
                "height_ratio": GUIDE_HEIGHT_RATIO,
                "left_ratio": GUIDE_LEFT_RATIO,
                "top_ratio": GUIDE_TOP_RATIO,
            },
            "face_box": None,
            "updated_at": None,
        }

    def _build_state(self):
        return {
            "last_detection_time": {},
            "event_streaks": {
                "face_outside_box": 0,
                "face_partially_visible": 0,
                "face_too_close": 0,
                "face_too_far": 0,
            },
            "current_issue": "inside",
            "issue_started_at": None,
            "live_state": self._build_default_live_state(),
        }

    def _get_state(self, user_id):
        key = self._state_key(user_id)
        with self.state_lock:
            if key not in self.user_states:
                self.user_states[key] = self._build_state()
            return self.user_states[key]

    def cleanup_user(self, user_id):
        key = self._state_key(user_id)
        with self.state_lock:
            self.user_states.pop(key, None)

    def get_live_state(self, user_id) -> Dict[str, Any]:
        key = self._state_key(user_id)
        with self.state_lock:
            state = self.user_states.get(key)
            if not state:
                return self._build_default_live_state()
            live_state = dict(state["live_state"])
            face_box = live_state.get("face_box")
            live_state["face_box"] = dict(face_box) if isinstance(face_box, dict) else None
            return live_state

    def _check_cooldown(self, state, event_type: str, current_time: datetime) -> bool:
        last_time = state["last_detection_time"].get(event_type)
        if last_time is None:
            return True
        cooldown = self.cooldowns.get(event_type, 6.0)
        return (current_time - last_time).total_seconds() >= cooldown

    def _advance_streak(self, state, event_type: str, condition_met: bool) -> int:
        state["event_streaks"][event_type] = (
            state["event_streaks"][event_type] + 1 if condition_met else 0
        )
        return state["event_streaks"][event_type]

    @staticmethod
    def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
        return max(lower, min(upper, value))

    def _extract_bbox(self, detection) -> Optional[dict[str, float]]:
        if not detection:
            return None

        bbox = detection.location_data.relative_bounding_box
        left = self._clamp(float(bbox.xmin))
        top = self._clamp(float(bbox.ymin))
        width = self._clamp(float(bbox.width))
        height = self._clamp(float(bbox.height))
        right = self._clamp(left + width)
        bottom = self._clamp(top + height)

        if right <= left or bottom <= top:
            return None

        return {
            "left": left,
            "top": top,
            "right": right,
            "bottom": bottom,
            "width": right - left,
            "height": bottom - top,
            "center_x": (left + right) / 2.0,
            "center_y": (top + bottom) / 2.0,
        }

    def _pick_primary_face(self, detections) -> Optional[dict[str, float]]:
        boxes = [self._extract_bbox(detection) for detection in detections]
        boxes = [box for box in boxes if box is not None]
        if not boxes:
            return None
        return max(boxes, key=lambda box: box["width"] * box["height"])

    def _classify_bbox(self, bbox: dict[str, float]) -> dict[str, Any]:
        left = bbox["left"]
        top = bbox["top"]
        right = bbox["right"]
        bottom = bbox["bottom"]
        width = bbox["width"]
        height = bbox["height"]

        frame_margin = FRAME_EDGE_MARGIN_RATIO
        edge_margin_x = GUIDE_WIDTH_RATIO * GUIDE_EDGE_BUFFER_RATIO
        edge_margin_y = GUIDE_HEIGHT_RATIO * GUIDE_EDGE_BUFFER_RATIO

        partial_visible = (
            left <= frame_margin
            or top <= frame_margin
            or right >= 1.0 - frame_margin
            or bottom >= 1.0 - frame_margin
        )

        inside_box = (
            left >= GUIDE_LEFT_RATIO
            and right <= GUIDE_RIGHT_RATIO
            and top >= GUIDE_TOP_RATIO
            and bottom <= GUIDE_BOTTOM_RATIO
        )

        at_edge = (
            inside_box
            and (
                (left - GUIDE_LEFT_RATIO) <= edge_margin_x
                or (GUIDE_RIGHT_RATIO - right) <= edge_margin_x
                or (top - GUIDE_TOP_RATIO) <= edge_margin_y
                or (GUIDE_BOTTOM_RATIO - bottom) <= edge_margin_y
            )
        )

        face_height_ratio = height / GUIDE_HEIGHT_RATIO
        face_width_ratio = width / GUIDE_WIDTH_RATIO
        too_close = (
            face_height_ratio >= FACE_TOO_CLOSE_HEIGHT_RATIO
            or face_width_ratio >= FACE_TOO_CLOSE_WIDTH_RATIO
        )
        too_far = (
            face_height_ratio <= FACE_TOO_FAR_HEIGHT_RATIO
            or face_width_ratio <= FACE_TOO_FAR_WIDTH_RATIO
        )
        outside_box = not inside_box

        status = "inside"
        primary_event = None
        event_message = None
        status_message = "Face aligned in guide box"
        box_color = "green"
        voice_prompt = None

        if partial_visible:
            status = "partial"
            primary_event = "face_partially_visible"
            event_message = "Only part of the face is visible in the camera"
            status_message = "Show your full face in the frame"
            box_color = "red"
            voice_prompt = "Show your full face in the frame."
        elif outside_box:
            status = "outside"
            primary_event = "face_outside_box"
            event_message = "Face moved outside the guide box"
            status_message = "Stay inside the frame"
            box_color = "red"
            voice_prompt = "Stay inside the frame."
        elif too_close:
            status = "too_close"
            primary_event = "face_too_close"
            event_message = "Face is too close to the camera"
            status_message = "Move slightly back from the camera"
            box_color = "yellow"
            voice_prompt = "Move slightly back from the camera."
        elif too_far:
            status = "too_far"
            primary_event = "face_too_far"
            event_message = "Face is too far from the camera"
            status_message = "Move closer to the camera"
            box_color = "yellow"
            voice_prompt = "Move closer to the camera."
        elif at_edge:
            status = "edge"
            status_message = "Keep your face centered in the frame"
            box_color = "yellow"
            voice_prompt = "Keep your face centered in the frame."

        return {
            "status": status,
            "primary_event": primary_event,
            "event_message": event_message,
            "status_message": status_message,
            "box_color": box_color,
            "voice_prompt": voice_prompt,
            "face_box": {
                "left": round(left, 4),
                "top": round(top, 4),
                "width": round(width, 4),
                "height": round(height, 4),
            },
        }

    def _update_issue_tracking(self, state, issue: str, current_time: datetime) -> float:
        if state["current_issue"] != issue:
            state["current_issue"] = issue
            state["issue_started_at"] = current_time
            return 0.0

        started_at = state.get("issue_started_at")
        if started_at is None:
            state["issue_started_at"] = current_time
            return 0.0

        return max(0.0, (current_time - started_at).total_seconds())

    def _compose_live_state(self, issue: str, current_time: datetime, face_detected: bool, bbox=None, **kwargs):
        message = kwargs.get("message") or "Position your face within the box"
        voice_prompt = kwargs.get("voice_prompt")
        box_color = kwargs.get("box_color", "green")
        continuous_seconds = round(kwargs.get("continuous_seconds", 0.0), 1)
        seconds_until_flag = kwargs.get("seconds_until_flag")
        seconds_until_termination = kwargs.get("seconds_until_termination")
        severity = kwargs.get("severity", "ok")

        return {
            "status": issue,
            "severity": severity,
            "box_color": box_color,
            "message": message,
            "voice_prompt": voice_prompt,
            "face_detected": face_detected,
            "continuous_seconds": continuous_seconds,
            "seconds_until_flag": seconds_until_flag,
            "seconds_until_termination": seconds_until_termination,
            "guide": {
                "width_ratio": GUIDE_WIDTH_RATIO,
                "height_ratio": GUIDE_HEIGHT_RATIO,
                "left_ratio": GUIDE_LEFT_RATIO,
                "top_ratio": GUIDE_TOP_RATIO,
            },
            "face_box": bbox,
            "updated_at": current_time.isoformat(),
        }

    def _update_live_state(self, state, current_time: datetime, assessment: Optional[dict[str, Any]]) -> None:
        if not assessment:
            continuous_seconds = self._update_issue_tracking(state, "missing", current_time)
            severity = "warning"
            message = "Face not visible"
            voice_prompt = None
            if continuous_seconds >= MISSING_CRITICAL_AFTER_SEC:
                severity = "critical"
                message = "Face not visible. Return to the frame"
                voice_prompt = "Face not visible. Return to the frame."
            elif continuous_seconds >= MISSING_WARNING_AFTER_SEC:
                voice_prompt = "Face not visible."

            state["live_state"] = self._compose_live_state(
                "missing",
                current_time,
                face_detected=False,
                box_color="red",
                message=message,
                voice_prompt=voice_prompt,
                continuous_seconds=continuous_seconds,
                severity=severity,
            )
            return

        issue = assessment["status"]
        continuous_seconds = self._update_issue_tracking(state, issue, current_time)
        severity = "ok"
        message = assessment["status_message"]
        voice_prompt = None
        seconds_until_flag = None
        seconds_until_termination = None

        if issue == "inside":
            message = "Face aligned in guide box"
        elif issue == "edge":
            if continuous_seconds >= EDGE_WARNING_AFTER_SEC:
                severity = "warning"
                voice_prompt = assessment["voice_prompt"]
            else:
                severity = "notice"
        elif issue == "outside":
            if continuous_seconds < OUTSIDE_WARNING_AFTER_SEC:
                severity = "notice"
                message = "Stay inside the frame"
            elif continuous_seconds < OUTSIDE_CRITICAL_AFTER_SEC:
                severity = "warning"
                voice_prompt = assessment["voice_prompt"]
            else:
                severity = "critical"
                seconds_until_flag = max(
                    0,
                    math.ceil(OUTSIDE_FLAG_AFTER_SEC - continuous_seconds),
                )
                seconds_until_termination = max(
                    0,
                    math.ceil(OUTSIDE_TERMINATION_AFTER_SEC - continuous_seconds),
                )
                if continuous_seconds < OUTSIDE_FLAG_AFTER_SEC:
                    message = f"Return inside the frame in {seconds_until_flag} seconds"
                else:
                    message = f"Return inside the frame in {seconds_until_termination} seconds"
                voice_prompt = assessment["voice_prompt"]
        else:
            severity = "warning"
            voice_prompt = assessment["voice_prompt"]

        state["live_state"] = self._compose_live_state(
            issue,
            current_time,
            face_detected=True,
            bbox=assessment["face_box"],
            box_color=assessment["box_color"],
            message=message,
            voice_prompt=voice_prompt,
            continuous_seconds=continuous_seconds,
            seconds_until_flag=seconds_until_flag,
            seconds_until_termination=seconds_until_termination,
            severity=severity,
        )

    def process(self, frame, user_id=None):
        logs = []
        if not self.face_detector:
            return logs

        state = self._get_state(user_id)
        timestamp = str(datetime.now())
        current_time = datetime.now()

        with self.process_lock:
            try:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = self.face_detector.process(frame_rgb)
                detections = results.detections if results and results.detections else []
                bbox = self._pick_primary_face(detections)
                assessment = self._classify_bbox(bbox) if bbox else None
                self._update_live_state(state, current_time, assessment)

                active_event = assessment["primary_event"] if assessment else None
                for event_type in list(state["event_streaks"].keys()):
                    streak = self._advance_streak(state, event_type, event_type == active_event)
                    if event_type != active_event:
                        continue
                    required_frames = self.required_frames.get(event_type, 3)
                    if streak < required_frames or not self._check_cooldown(state, event_type, current_time):
                        continue

                    event_message = assessment["event_message"] if assessment else event_type.replace("_", " ")
                    details = assessment["status_message"] if assessment else "Face guide box rule violation"
                    logs.append(
                        {
                            "time": timestamp,
                            "event": event_message,
                            "event_type": event_type,
                            "details": details,
                            "confidence": 1.0,
                            "suspicious": True,
                        }
                    )
                    state["last_detection_time"][event_type] = current_time
                    state["event_streaks"][event_type] = 0
            except Exception as exc:
                logger.error(f"Face box monitoring error: {exc}")

        return logs


_global_face_box_monitor = FaceBoxMonitor()


def detect_face_box(frame, **kwargs):
    user_id = kwargs.pop("user_id", None)
    del kwargs
    return _global_face_box_monitor.process(frame, user_id=user_id)


def get_face_box_state(user_id):
    return _global_face_box_monitor.get_live_state(user_id)


def cleanup_face_box_user(user_id):
    _global_face_box_monitor.cleanup_user(user_id)
