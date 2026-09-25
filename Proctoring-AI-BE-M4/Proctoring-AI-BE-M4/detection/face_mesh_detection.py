"""
Face Mesh Detection Module
==========================
Uses MediaPipe FaceMesh to detect head pose, eye closure/squinting, and mouth
movement with temporal smoothing for long-running exam sessions.
"""

import math
import threading
from datetime import datetime

import cv2
import mediapipe as mp  # type: ignore
import numpy as np

from config.detection_config import detection_config as cfg
from utils.logger import logger

mp_face_mesh = mp.solutions.face_mesh  # type: ignore

MODEL_POINTS_3D = np.array(
    [
        (0.0, 0.0, 0.0),
        (0.0, -330.0, -65.0),
        (-225.0, 170.0, -135.0),
        (225.0, 170.0, -135.0),
        (-150.0, -150.0, -125.0),
        (150.0, -150.0, -125.0),
    ],
    dtype=np.float64,
)

LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

UPPER_LIP_OUTER = [61, 40, 37]
LOWER_LIP_OUTER = [270, 310, 321]
UPPER_LIP_INNER = 13
LOWER_LIP_INNER = 14
LEFT_LIP = 78
RIGHT_LIP = 308


def _dist(p1, p2):
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)


class FaceMeshDetector:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(FaceMeshDetector, cls).__new__(cls)
                    cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        self.process_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.user_states = {}
        self.face_mesh = None
        # Use config values directly — no max() clamps that silently override settings
        self.cooldowns = {
            "eye_movement": cfg.temporal.cooldown_eye_movement,
            "mouth_movement": cfg.temporal.cooldown_mouth_movement,
            "head_posture": cfg.temporal.cooldown_head_posture,
        }
        self.required_frames = {
            "eye_movement": max(1, cfg.temporal.eye_closed_frames),
            "mouth_movement": max(1, cfg.temporal.mouth_movement_frames),
            "head_posture": max(1, cfg.temporal.head_pose_frames),
        }
        # yaw_threshold = head_pose_threshold * 100, pitch = * 70
        # e.g. 0.30 → 30° yaw / 21° pitch (catches looking at notes)
        self.head_yaw_threshold = cfg.face_mesh.head_pose_threshold * 100
        self.head_pitch_threshold = cfg.face_mesh.head_pose_threshold * 70
        self.mouth_mar_threshold = cfg.face_mesh.mar_threshold
        self.head_pose_window_size = 4
        self.mouth_window_size = 5
        self._camera_matrix = None
        self._dist_coeffs = np.zeros((4, 1))

        try:
            self.face_mesh = mp_face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
        except Exception as exc:
            logger.error(f"Failed to initialize FaceMesh: {exc}")

    def _state_key(self, user_id):
        return user_id if user_id is not None else "__default__"

    def _build_state(self):
        return {
            "last_detection_time": {},
            "event_streaks": {
                "eye_movement": 0,
                "mouth_movement": 0,
                "head_posture": 0,
            },
            "head_pose_window": [],
            "mar_window": [],
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

    def _reset_event_streaks(self, state):
        for event_type in state["event_streaks"]:
            state["event_streaks"][event_type] = 0
        state["head_pose_window"].clear()
        state["mar_window"].clear()

    def _check_cooldown(self, state, event_type):
        if not self.face_mesh:
            return False

        last_time = state["last_detection_time"].get(event_type)
        if last_time is None:
            return True

        return (datetime.now() - last_time).total_seconds() >= self.cooldowns.get(event_type, 1.0)

    def _advance_streak(self, state, event_type, condition_met):
        state["event_streaks"][event_type] = (
            state["event_streaks"][event_type] + 1 if condition_met else 0
        )
        return state["event_streaks"][event_type]

    def _get_camera_matrix(self, w, h):
        if self._camera_matrix is None or self._camera_matrix[0, 2] != w / 2:
            focal_length = w
            self._camera_matrix = np.array(
                [[focal_length, 0, w / 2], [0, focal_length, h / 2], [0, 0, 1]],
                dtype=np.float64,
            )
        return self._camera_matrix

    def _calculate_head_pose_3d(self, landmarks, w, h):
        try:
            image_points = np.array(
                [
                    (landmarks[1].x * w, landmarks[1].y * h),
                    (landmarks[152].x * w, landmarks[152].y * h),
                    (landmarks[33].x * w, landmarks[33].y * h),
                    (landmarks[263].x * w, landmarks[263].y * h),
                    (landmarks[61].x * w, landmarks[61].y * h),
                    (landmarks[291].x * w, landmarks[291].y * h),
                ],
                dtype=np.float64,
            )

            camera_matrix = self._get_camera_matrix(w, h)
            success, rotation_vector, translation_vector = cv2.solvePnP(
                MODEL_POINTS_3D,
                image_points,
                camera_matrix,
                self._dist_coeffs,
                flags=cv2.SOLVEPNP_ITERATIVE,
            )
            if not success:
                return {"pitch": 0, "yaw": 0, "roll": 0}

            del translation_vector
            rmat, _ = cv2.Rodrigues(rotation_vector)
            angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)
            pitch, yaw, roll = angles[0], angles[1], angles[2]

            return {
                "pitch": pitch,
                "yaw": yaw,
                "roll": roll,
            }
        except Exception as exc:
            logger.debug(f"Head pose calculation error: {exc}")
            return {"pitch": 0, "yaw": 0, "roll": 0}

    def _append_window_value(self, state, key, value, max_size):
        values = state[key]
        values.append(value)
        if len(values) > max_size:
            values.pop(0)
        return values

    def _calculate_ear(self, landmarks, eye_indices, w, h):
        try:
            pts = [(landmarks[i].x * w, landmarks[i].y * h) for i in eye_indices]
            v1 = _dist(pts[1], pts[5])
            v2 = _dist(pts[2], pts[4])
            h1 = _dist(pts[0], pts[3])
            if h1 == 0:
                return 0.3
            return (v1 + v2) / (2.0 * h1)
        except Exception:
            return 0.3

    def _calculate_mar(self, landmarks, w, h):
        try:
            upper_inner = (landmarks[UPPER_LIP_INNER].x * w, landmarks[UPPER_LIP_INNER].y * h)
            lower_inner = (landmarks[LOWER_LIP_INNER].x * w, landmarks[LOWER_LIP_INNER].y * h)

            outer_v_sum = 0.0
            for top_idx, bottom_idx in zip(UPPER_LIP_OUTER, LOWER_LIP_OUTER):
                top_pt = (landmarks[top_idx].x * w, landmarks[top_idx].y * h)
                bottom_pt = (landmarks[bottom_idx].x * w, landmarks[bottom_idx].y * h)
                outer_v_sum += _dist(top_pt, bottom_pt)

            inner_v = _dist(upper_inner, lower_inner)
            left_pt = (landmarks[LEFT_LIP].x * w, landmarks[LEFT_LIP].y * h)
            right_pt = (landmarks[RIGHT_LIP].x * w, landmarks[RIGHT_LIP].y * h)
            h_dist = _dist(left_pt, right_pt)
            if h_dist == 0:
                return 0.0

            return (outer_v_sum / 3.0 + inner_v) / (2.0 * h_dist)
        except Exception:
            return 0.0

    def process(self, frame, thresholds=None, user_id=None):
        del thresholds

        logs = []
        timestamp = str(datetime.now())
        current_time = datetime.now()
        h, w, _ = frame.shape
        state = self._get_state(user_id)

        with self.process_lock:
            try:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = self.face_mesh.process(frame_rgb)

                if not results.multi_face_landmarks:
                    self._reset_event_streaks(state)
                    return logs

                face_landmarks = results.multi_face_landmarks[0]
                landmarks = face_landmarks.landmark

                head_pose = self._calculate_head_pose_3d(landmarks, w, h)
                head_pose_window = self._append_window_value(
                    state,
                    "head_pose_window",
                    (head_pose["yaw"], head_pose["pitch"]),
                    self.head_pose_window_size,
                )
                avg_yaw = float(np.mean([sample[0] for sample in head_pose_window]))
                avg_pitch = float(np.mean([sample[1] for sample in head_pose_window]))
                is_centered = (
                    abs(avg_yaw) < self.head_yaw_threshold
                    and abs(avg_pitch) < self.head_pitch_threshold
                )
                head_frames = self._advance_streak(state, "head_posture", not is_centered)
                if (
                    head_frames >= self.required_frames["head_posture"]
                    and self._check_cooldown(state, "head_posture")
                ):
                    yaw = avg_yaw
                    pitch = avg_pitch
                    direction = "right" if abs(yaw) > abs(pitch) and yaw > 0 else None
                    if direction is None and abs(yaw) > abs(pitch):
                        direction = "left"
                    if direction is None and pitch > 0:
                        direction = "up"
                    if direction is None:
                        direction = "down"

                    logs.append(
                        {
                            "time": timestamp,
                            "event": f"Head orientation drifted {direction}",
                            "event_type": "head_posture",
                            "details": (
                                f"Yaw(avg): {yaw:.1f} deg, Pitch(avg): {pitch:.1f} deg "
                                f"(yaw threshold: {self.head_yaw_threshold:.1f}, "
                                f"pitch threshold: {self.head_pitch_threshold:.1f})"
                            ),
                        }
                    )
                    state["last_detection_time"]["head_posture"] = current_time
                    state["event_streaks"]["head_posture"] = 0

                left_ear = self._calculate_ear(landmarks, LEFT_EYE, w, h)
                right_ear = self._calculate_ear(landmarks, RIGHT_EYE, w, h)
                avg_ear = (left_ear + right_ear) / 2.0
                eye_frames = self._advance_streak(
                    state, "eye_movement", avg_ear < cfg.face_mesh.ear_threshold
                )
                if (
                    eye_frames >= self.required_frames["eye_movement"]
                    and self._check_cooldown(state, "eye_movement")
                ):
                    logs.append(
                        {
                            "time": timestamp,
                            "event": "Eyes closed or squinting",
                            "event_type": "eye_movement",
                            "details": (
                                f"EAR: {avg_ear:.3f} "
                                f"(threshold: {cfg.face_mesh.ear_threshold})"
                            ),
                        }
                    )
                    state["last_detection_time"]["eye_movement"] = current_time
                    state["event_streaks"]["eye_movement"] = 0

                mar = self._calculate_mar(landmarks, w, h)
                mar_window = self._append_window_value(
                    state,
                    "mar_window",
                    mar,
                    self.mouth_window_size,
                )
                avg_mar = float(np.mean(mar_window))
                mouth_frames = self._advance_streak(
                    state, "mouth_movement", avg_mar > self.mouth_mar_threshold
                )
                if (
                    mouth_frames >= self.required_frames["mouth_movement"]
                    and self._check_cooldown(state, "mouth_movement")
                ):
                    logs.append(
                        {
                            "time": timestamp,
                            "event": "Sustained mouth activity detected",
                            "event_type": "mouth_movement",
                            "details": (
                                f"MAR(avg): {avg_mar:.3f} "
                                f"(threshold: {self.mouth_mar_threshold:.3f})"
                            ),
                        }
                    )
                    state["last_detection_time"]["mouth_movement"] = current_time
                    state["event_streaks"]["mouth_movement"] = 0
            except Exception as exc:
                logger.error(f"Face mesh detection error: {exc}")

        return logs


_global_mesh_detector = FaceMeshDetector()


def detect_face_mesh(frame, thresholds=None, user_id=None):
    return _global_mesh_detector.process(frame, thresholds=thresholds, user_id=user_id)


def cleanup_face_mesh_user(user_id):
    _global_mesh_detector.cleanup_user(user_id)
