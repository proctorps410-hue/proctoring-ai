import os
import threading
from datetime import datetime
from typing import Any, Dict, List

import cv2
import mediapipe as mp  # type: ignore
from ultralytics import YOLO

from config.detection_config import detection_config as cfg
from utils.logger import logger

MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "yolov8n.pt")


class YOLODetector:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(YOLODetector, cls).__new__(cls)
                    cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        self.model_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.user_states = {}

        try:
            try:
                import torch

                torch.set_grad_enabled(False)
                if torch.cuda.is_available():
                    torch.backends.cudnn.deterministic = True
                    torch.backends.cudnn.benchmark = False
            except Exception as exc:
                logger.debug(f"Unable to enable deterministic torch mode: {exc}")

            logger.info("Loading YOLOv8 model...")
            if os.path.exists(MODEL_PATH):
                self.model = YOLO(MODEL_PATH)
            else:
                logger.info("Downloading YOLOv8n model...")
                self.model = YOLO("yolov8n")
                self.model.save(MODEL_PATH)
        except Exception as exc:
            logger.error(f"Error loading YOLO model: {exc}")
            self.model = None

        try:
            # model_selection=1 covers full-range (0-5m), better for room scenes
            self.face_detector = mp.solutions.face_detection.FaceDetection(  # type: ignore
                model_selection=1,
                min_detection_confidence=0.5,  # slightly relaxed for multi-face detection
            )
        except Exception as exc:
            logger.error(f"Failed to initialize MediaPipe face detector: {exc}")
            self.face_detector = None

        self.phone_classes = cfg.yolo.phone_classes
        self.phone_confidence = cfg.yolo.phone_confidence
        self.person_confidence = cfg.yolo.person_confidence
        self.prohibited_classes = cfg.yolo.prohibited_object_classes
        self.prohibited_confidence = cfg.yolo.prohibited_object_confidence
        self.required_object_frames = max(1, cfg.temporal.object_detection_frames)
        self.detection_cooldown = {
            "face_not_visible": cfg.temporal.cooldown_face_not_visible,
            "phone_detected": cfg.temporal.cooldown_phone_detected,
            "multiple_people": cfg.temporal.cooldown_multiple_people,
            "prohibited_object": cfg.temporal.cooldown_prohibited_object,
        }

    def _state_key(self, user_id):
        return user_id if user_id is not None else "__default__"

    def _build_state(self):
        return {
            "last_detection_time": {},
            "consecutive_no_face": 0,
            "event_streaks": {
                "phone_detected": 0,
                "multiple_people": 0,
                "prohibited_object": 0,
            },
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

    def _check_cooldown(self, state, event_type: str) -> bool:
        current_time = datetime.now()
        last_time = state["last_detection_time"].get(event_type)
        if last_time is None:
            return True
        cooldown = self.detection_cooldown.get(event_type, 1.0)
        return (current_time - last_time).total_seconds() >= cooldown

    def _advance_streak(self, state, event_type: str, condition_met: bool) -> int:
        state["event_streaks"][event_type] = (
            state["event_streaks"][event_type] + 1 if condition_met else 0
        )
        return state["event_streaks"][event_type]

    def detect(self, frame, confidence_threshold=None, user_id=None) -> List[Dict[str, Any]]:
        if not self.model:
            logger.warning("YOLODetector.model is None")
            return []

        state = self._get_state(user_id)
        person_thresh = (
            confidence_threshold if confidence_threshold is not None else cfg.yolo.person_confidence
        )
        phone_thresh = cfg.yolo.phone_confidence
        inference_conf = min(phone_thresh, person_thresh, self.prohibited_confidence)
        detections = []
        current_time = datetime.now()

        with self.model_lock:
            try:
                results = self.model(frame, imgsz=640, conf=inference_conf, verbose=False)[0]

                # ── Face presence via MediaPipe ──────────────────────────────
                face_detected = False
                face_count_mp = 0
                if self.face_detector:
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    mp_results = self.face_detector.process(frame_rgb)
                    mp_detections = mp_results.detections or []
                    face_count_mp = len(mp_detections)
                    face_detected = face_count_mp >= 1

                if not face_detected:
                    state["consecutive_no_face"] += 1
                else:
                    state["consecutive_no_face"] = 0

                if (
                    state["consecutive_no_face"] >= cfg.temporal.face_absence_frames
                    and self._check_cooldown(state, "face_not_visible")
                ):
                    detections.append(
                        {
                            "class": "absence",
                            "event_type": "face_not_visible",
                            "confidence": 1.0,
                            "suspicious": True,
                            "duration": 0,
                            "reason": "Face not visible in camera",
                        }
                    )
                    state["last_detection_time"]["face_not_visible"] = current_time
                    state["consecutive_no_face"] = 0

                # ── Multiple faces via MediaPipe (primary signal) ─────────────
                # This is far more reliable than YOLO person boxes for a desk webcam
                # since a second person typically shows their face before their body.
                multiple_faces_mp = face_count_mp > 1
                all_boxes = results.boxes.data.tolist()

                phone_hits = []
                prohibited_hits = []
                person_detections = []

                for row in all_boxes:
                    confidence = float(row[4])
                    class_id = int(row[5])
                    if class_id >= len(self.model.names):
                        continue

                    class_name = self.model.names[class_id].lower()
                    if class_name in self.phone_classes and confidence >= phone_thresh:
                        phone_hits.append({"confidence": confidence, "class_name": class_name})

                    if class_name in self.prohibited_classes and confidence >= self.prohibited_confidence:
                        prohibited_hits.append({"confidence": confidence, "class_name": class_name})

                    if class_id == 0 and confidence >= person_thresh:
                        person_detections.append(row)

                phone_frames = self._advance_streak(state, "phone_detected", bool(phone_hits))
                if (
                    phone_frames >= self.required_object_frames
                    and self._check_cooldown(state, "phone_detected")
                ):
                    best_phone_hit = max(phone_hits, key=lambda hit: hit["confidence"])
                    detections.append(
                        {
                            "class": "phone",
                            "event_type": "phone_detected",
                            "confidence": best_phone_hit["confidence"],
                            "suspicious": True,
                        }
                    )
                    state["last_detection_time"]["phone_detected"] = current_time
                    state["event_streaks"]["phone_detected"] = 0

                prohibited_frames = self._advance_streak(
                    state, "prohibited_object", bool(prohibited_hits)
                )
                if (
                    prohibited_frames >= self.required_object_frames
                    and self._check_cooldown(state, "prohibited_object")
                ):
                    best_prohibited_hit = max(prohibited_hits, key=lambda hit: hit["confidence"])
                    detections.append(
                        {
                            "class": "prohibited_object",
                            "event_type": "prohibited_object",
                            "confidence": best_prohibited_hit["confidence"],
                            "suspicious": True,
                            "object_name": best_prohibited_hit["class_name"],
                        }
                    )
                    state["last_detection_time"]["prohibited_object"] = current_time
                    state["event_streaks"]["prohibited_object"] = 0

                # ── Multiple people: MediaPipe faces OR YOLO person boxes ────
                # Multiple faces via MP is our primary signal; YOLO person count is backup.
                multiple_people_condition = multiple_faces_mp or (len(person_detections) > 1)
                people_frames = self._advance_streak(
                    state, "multiple_people", multiple_people_condition
                )
                if (
                    people_frames >= self.required_object_frames
                    and self._check_cooldown(state, "multiple_people")
                ):
                    conf = float(person_detections[0][4]) if person_detections else 1.0
                    detections.append(
                        {
                            "class": "person",
                            "event_type": "multiple_people",
                            "confidence": conf,
                            "suspicious": True,
                            "count": max(2, len(person_detections)),
                        }
                    )
                    state["last_detection_time"]["multiple_people"] = current_time
                    state["event_streaks"]["multiple_people"] = 0
            except Exception as exc:
                logger.error(f"Inference error: {exc}")
                return []

        return detections


_detector = YOLODetector()


def detect_yolo(frame, confidence_threshold=None, user_id=None):
    logs = []
    timestamp = str(datetime.now())

    detector_results = _detector.detect(
        frame,
        confidence_threshold=confidence_threshold,
        user_id=user_id,
    )
    for detection in detector_results:
        if not detection.get("suspicious"):
            continue

        if detection["class"] == "prohibited_object":
            object_name = detection.get("object_name", "unknown")
            event_msg = f"Prohibited object detected: {object_name}"
        else:
            event_msg = {
                "phone": "Phone detected",
                "person": "Multiple people detected",
                "absence": "Face not visible in camera",
            }.get(detection["class"], "Suspicious activity")

        logs.append(
            {
                "time": timestamp,
                "event": event_msg,
                "event_type": detection["event_type"],
                "details": detection.get("reason", ""),
            }
        )

    return logs


def cleanup_yolo_user(user_id):
    _detector.cleanup_user(user_id)
