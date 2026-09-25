"""
Gaze Tracking Detection Module
==============================
Detects if the student is looking away from the screen using MediaPipe FaceMesh
iris landmarks with temporal smoothing to reduce jitter-driven false positives.
"""

from datetime import datetime
import threading

import cv2
import mediapipe as mp  # type: ignore
import numpy as np

from config.detection_config import detection_config as cfg
from utils.logger import logger

mp_face_mesh = mp.solutions.face_mesh  # type: ignore

LEFT_EYE_OUTER = 33
LEFT_EYE_INNER = 133
LEFT_EYE_TOP = 159
LEFT_EYE_BOTTOM = 145
LEFT_IRIS_CENTER = 468

RIGHT_EYE_OUTER = 362
RIGHT_EYE_INNER = 263
RIGHT_EYE_TOP = 386
RIGHT_EYE_BOTTOM = 374
RIGHT_IRIS_CENTER = 473


class GazeTracker:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(GazeTracker, cls).__new__(cls)
                    cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        self.process_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.user_states = {}
        self.face_mesh = None
        # Use config values directly — do not silently clamp/override env-driven settings.
        # Enterprise tuning requires that `config/detection_config.py` be authoritative.
        self.cooldown = cfg.temporal.cooldown_gaze_looking_away
        self.h_threshold = cfg.face_mesh.gaze_horizontal_threshold
        self.v_threshold = cfg.face_mesh.gaze_vertical_threshold
        self.required_frames = max(1, cfg.temporal.gaze_away_frames)
        self.max_ratio_window = 6

        try:
            self.face_mesh = mp_face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
        except Exception as exc:
            logger.error(f"Failed to initialize GazeTracker FaceMesh: {exc}")

    def _state_key(self, user_id):
        return user_id if user_id is not None else "__default__"

    def _build_state(self):
        return {
            "last_detection_time": None,
            "direction_streak": 0,
            "current_direction": None,
            "ratio_window": [],
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

    def _check_cooldown(self, state):
        if not self.face_mesh:
            return False
        if state["last_detection_time"] is None:
            return True
        return (datetime.now() - state["last_detection_time"]).total_seconds() >= self.cooldown

    def _calculate_gaze_ratio(self, landmarks, w, h):
        try:
            left_outer = np.array([landmarks[LEFT_EYE_OUTER].x * w, landmarks[LEFT_EYE_OUTER].y * h])
            left_inner = np.array([landmarks[LEFT_EYE_INNER].x * w, landmarks[LEFT_EYE_INNER].y * h])
            left_top = np.array([landmarks[LEFT_EYE_TOP].x * w, landmarks[LEFT_EYE_TOP].y * h])
            left_bottom = np.array([landmarks[LEFT_EYE_BOTTOM].x * w, landmarks[LEFT_EYE_BOTTOM].y * h])
            left_iris = np.array([landmarks[LEFT_IRIS_CENTER].x * w, landmarks[LEFT_IRIS_CENTER].y * h])

            right_outer = np.array([landmarks[RIGHT_EYE_OUTER].x * w, landmarks[RIGHT_EYE_OUTER].y * h])
            right_inner = np.array([landmarks[RIGHT_EYE_INNER].x * w, landmarks[RIGHT_EYE_INNER].y * h])
            right_top = np.array([landmarks[RIGHT_EYE_TOP].x * w, landmarks[RIGHT_EYE_TOP].y * h])
            right_bottom = np.array([landmarks[RIGHT_EYE_BOTTOM].x * w, landmarks[RIGHT_EYE_BOTTOM].y * h])
            right_iris = np.array([landmarks[RIGHT_IRIS_CENTER].x * w, landmarks[RIGHT_IRIS_CENTER].y * h])

            left_eye_width = np.linalg.norm(left_outer - left_inner)
            right_eye_width = np.linalg.norm(right_outer - right_inner)
            left_eye_height = np.linalg.norm(left_top - left_bottom)
            right_eye_height = np.linalg.norm(right_top - right_bottom)

            left_h_ratio = (
                np.linalg.norm(left_iris - left_inner) / left_eye_width if left_eye_width > 0 else 0.5
            )
            right_h_ratio = (
                np.linalg.norm(right_iris - right_inner) / right_eye_width if right_eye_width > 0 else 0.5
            )
            left_v_ratio = (
                np.linalg.norm(left_iris - left_top) / left_eye_height if left_eye_height > 0 else 0.5
            )
            right_v_ratio = (
                np.linalg.norm(right_iris - right_top) / right_eye_height if right_eye_height > 0 else 0.5
            )

            return (left_h_ratio + right_h_ratio) / 2.0, (left_v_ratio + right_v_ratio) / 2.0
        except Exception as exc:
            logger.debug(f"Gaze ratio calculation error: {exc}")
            return 0.5, 0.5

    def _get_direction(self, h_ratio, v_ratio):
        direction = None
        if abs(h_ratio - 0.5) > self.h_threshold:
            if h_ratio > 0.5 + self.h_threshold:
                direction = "left"
            elif h_ratio < 0.5 - self.h_threshold:
                direction = "right"

        if abs(v_ratio - 0.5) > self.v_threshold and v_ratio < 0.5 - self.v_threshold:
            direction = "up"

        return direction

    def _reset_tracking(self, state):
        state["direction_streak"] = 0
        state["current_direction"] = None
        state["ratio_window"].clear()

    def process(self, frame, user_id=None):
        logs = []
        if not self.face_mesh:
            return logs

        timestamp = str(datetime.now())
        current_time = datetime.now()
        h, w, _ = frame.shape
        state = self._get_state(user_id)

        with self.process_lock:
            try:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = self.face_mesh.process(frame_rgb)

                if not results.multi_face_landmarks:
                    self._reset_tracking(state)
                    return logs

                face_landmarks = results.multi_face_landmarks[0]
                landmarks = face_landmarks.landmark

                if len(landmarks) <= LEFT_IRIS_CENTER:
                    self._reset_tracking(state)
                    logger.debug("Iris landmarks not available")
                    return logs

                h_ratio, v_ratio = self._calculate_gaze_ratio(landmarks, w, h)
                state["ratio_window"].append((h_ratio, v_ratio))
                if len(state["ratio_window"]) > self.max_ratio_window:
                    state["ratio_window"].pop(0)

                avg_h_ratio = float(np.mean([ratio[0] for ratio in state["ratio_window"]]))
                avg_v_ratio = float(np.mean([ratio[1] for ratio in state["ratio_window"]]))
                direction = self._get_direction(avg_h_ratio, avg_v_ratio)

                if direction:
                    if direction == state["current_direction"]:
                        state["direction_streak"] += 1
                    else:
                        state["current_direction"] = direction
                        state["direction_streak"] = 1
                else:
                    self._reset_tracking(state)
                    return logs

                if state["direction_streak"] >= self.required_frames and self._check_cooldown(state):
                    logs.append(
                        {
                            "time": timestamp,
                            "event": f"Looking {direction} - gaze away from screen",
                            "event_type": "gaze_looking_away",
                            "details": (
                                f"H-ratio: {avg_h_ratio:.2f}, "
                                f"V-ratio: {avg_v_ratio:.2f}, Direction: {direction}"
                            ),
                        }
                    )
                    state["last_detection_time"] = current_time
                    self._reset_tracking(state)
            except Exception as exc:
                logger.error(f"Gaze tracking error: {exc}")

        return logs


_global_gaze_tracker = GazeTracker()


def detect_gaze(frame, **kwargs):
    user_id = kwargs.pop("user_id", None)
    del kwargs
    return _global_gaze_tracker.process(frame, user_id=user_id)


def cleanup_gaze_user(user_id):
    _global_gaze_tracker.cleanup_user(user_id)
