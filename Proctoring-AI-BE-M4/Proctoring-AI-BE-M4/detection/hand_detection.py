import threading
from datetime import datetime

import cv2
import mediapipe as mp  # type: ignore

from config.detection_config import detection_config as cfg
from utils.logger import logger

mp_hands = mp.solutions.hands  # type: ignore


class HandDetector:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(HandDetector, cls).__new__(cls)
                    cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        self.process_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.user_states = {}
        self.detector = None
        self.required_frames = max(1, cfg.temporal.hand_presence_frames)
        self.cooldown = cfg.temporal.cooldown_hand_detected

        try:
            self.detector = mp_hands.Hands(
                static_image_mode=False,
                max_num_hands=2,
                min_detection_confidence=0.6,
                min_tracking_confidence=0.6,
            )
            logger.info("HandDetector initialized")
        except Exception as exc:
            logger.error(f"Failed to init HandDetector: {exc}")

    def _state_key(self, user_id):
        return user_id if user_id is not None else "__default__"

    def _build_state(self):
        return {
            "last_detection_time": None,
            "consecutive_hand_frames": 0,
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

    def _check_cooldown(self, state) -> bool:
        if state["last_detection_time"] is None:
            return True
        return (datetime.now() - state["last_detection_time"]).total_seconds() >= self.cooldown

    def process(self, frame, user_id=None):
        if not self.detector:
            return []

        logs = []
        timestamp = str(datetime.now())
        state = self._get_state(user_id)

        with self.process_lock:
            try:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                hand_results = self.detector.process(frame_rgb)

                if hand_results.multi_hand_landmarks:
                    state["consecutive_hand_frames"] += 1
                else:
                    state["consecutive_hand_frames"] = 0

                if (
                    state["consecutive_hand_frames"] >= self.required_frames
                    and self._check_cooldown(state)
                ):
                    logs.append(
                        {
                            "time": timestamp,
                            "event": "Hand detected",
                            "event_type": "hand_detected",
                        }
                    )
                    state["last_detection_time"] = datetime.now()
                    state["consecutive_hand_frames"] = 0
            except Exception as exc:
                logger.error(f"Hand detection processing error: {exc}")

        return logs


_global_hand_detector = HandDetector()


def detect_hands(frame, confidence_threshold=None, user_id=None):
    del confidence_threshold
    return _global_hand_detector.process(frame, user_id=user_id)


def cleanup_hand_user(user_id):
    _global_hand_detector.cleanup_user(user_id)
