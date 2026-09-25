from __future__ import annotations

import math
import threading
from typing import Any, Dict, List, Optional

import cv2
import mediapipe as mp  # type: ignore
import numpy as np
from sqlalchemy.orm import Session

from utils.logger import logger

mp_face_detection = mp.solutions.face_detection  # type: ignore
mp_face_mesh = mp.solutions.face_mesh  # type: ignore

POSE_SEQUENCE = ("front", "left", "right")

POSE_THRESHOLDS = {
    "front": {
        "strict": (-14.0, 14.0),
        "near": (-20.0, 20.0),
    },
    "left": {
        "strict": (10.0, 38.0),
        "near": (6.0, 45.0),
    },
    "right": {
        "strict": (-38.0, -10.0),
        "near": (-45.0, -6.0),
    },
}

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

KEY_LANDMARKS = (1, 33, 61, 152, 263, 291)
POSE_LABELS = {
    "front": "straight",
    "left": "left",
    "right": "right",
}

MIN_FACE_AREA_RATIO = 0.07
MAX_FACE_AREA_RATIO = 0.55
MIN_FACE_WIDTH_RATIO = 0.20
MAX_FACE_WIDTH_RATIO = 0.80
MIN_BLUR_SCORE = 45.0
MIN_BRIGHTNESS = 40.0
MAX_BRIGHTNESS = 230.0
MAX_ABS_PITCH = 40.0
MAX_ABS_ROLL = 40.0
MAX_FRAME_SIDE = 960
SIDE_YAW_STRICT_RANGE = (10.0, 38.0)
SIDE_YAW_NEAR_RANGE = (6.0, 45.0)


def normalize_face_pose(pose: Optional[str]) -> str:
    normalized = (pose or "front").strip().lower()
    return normalized if normalized in POSE_SEQUENCE else "front"


def load_user_face_references(db: Session, user_id: int) -> List[Dict[str, Any]]:
    from models.user_face_references import UserFaceReference

    pose_order = {pose: index for index, pose in enumerate(POSE_SEQUENCE)}
    rows = db.query(UserFaceReference).filter(
        UserFaceReference.user_id == user_id
    ).all()
    sorted_rows = sorted(rows, key=lambda row: pose_order.get(str(row.pose), 99))
    return [
        {
            "pose": normalize_face_pose(str(row.pose)),
            "image": bytes(row.image),
            "quality_score": float(row.quality_score) if row.quality_score is not None else None,
        }
        for row in sorted_rows
        if row.image
    ]


def get_reference_image_bytes(records: List[Dict[str, Any]]) -> List[bytes]:
    return [record["image"] for record in records if record.get("image")]


class FaceReferenceAnalyzer:
    _instance = None
    _instance_lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialize()
        return cls._instance

    def _initialize(self) -> None:
        self._process_lock = threading.Lock()
        self.face_detector = None
        self.face_mesh = None
        self._camera_matrix_cache: Dict[tuple[int, int], np.ndarray] = {}
        self._dist_coeffs = np.zeros((4, 1))

        try:
            self.face_detector = mp_face_detection.FaceDetection(
                model_selection=0,
                min_detection_confidence=0.55,
            )
        except Exception as exc:
            logger.error(f"Failed to initialize face detector for enrollment guidance: {exc}")

        try:
            self.face_mesh = mp_face_mesh.FaceMesh(
                static_image_mode=True,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
        except Exception as exc:
            logger.error(f"Failed to initialize face mesh for enrollment guidance: {exc}")

    def _resize_frame(self, frame):
        height, width = frame.shape[:2]
        max_side = max(height, width)
        if max_side <= MAX_FRAME_SIDE:
            return frame

        scale = MAX_FRAME_SIDE / float(max_side)
        resized_width = max(1, int(width * scale))
        resized_height = max(1, int(height * scale))
        return cv2.resize(frame, (resized_width, resized_height), interpolation=cv2.INTER_AREA)

    def _decode_image(self, image_bytes: bytes):
        image_array = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if frame is None:
            return None
        return self._resize_frame(frame)

    @staticmethod
    def _clamp_bbox(x_min: float, y_min: float, width: float, height: float) -> Dict[str, float]:
        x1 = max(0.0, x_min)
        y1 = max(0.0, y_min)
        x2 = min(1.0, x_min + width)
        y2 = min(1.0, y_min + height)
        return {
            "x": x1,
            "y": y1,
            "width": max(0.0, x2 - x1),
            "height": max(0.0, y2 - y1),
        }

    def _extract_face_boxes(self, detections) -> List[Dict[str, float]]:
        boxes: List[Dict[str, float]] = []
        for detection in detections or []:
            try:
                bbox = detection.location_data.relative_bounding_box
                boxes.append(
                    self._clamp_bbox(
                        float(bbox.xmin),
                        float(bbox.ymin),
                        float(bbox.width),
                        float(bbox.height),
                    )
                )
            except Exception:
                continue
        return boxes

    @staticmethod
    def _pick_primary_box(face_boxes: List[Dict[str, float]]) -> Optional[Dict[str, float]]:
        if not face_boxes:
            return None
        return max(face_boxes, key=lambda box: float(box["width"]) * float(box["height"]))

    @staticmethod
    def _crop_face(frame, box: Dict[str, float]):
        height, width = frame.shape[:2]
        x1 = max(0, int(box["x"] * width))
        y1 = max(0, int(box["y"] * height))
        x2 = min(width, int((box["x"] + box["width"]) * width))
        y2 = min(height, int((box["y"] + box["height"]) * height))
        if x2 <= x1 or y2 <= y1:
            return None
        return frame[y1:y2, x1:x2]

    @staticmethod
    def _camera_matrix(width: int, height: int, cache: Dict[tuple[int, int], np.ndarray]) -> np.ndarray:
        key = (width, height)
        if key not in cache:
            focal_length = width
            cache[key] = np.array(
                [[focal_length, 0, width / 2], [0, focal_length, height / 2], [0, 0, 1]],
                dtype=np.float64,
            )
        return cache[key]

    def _calculate_head_pose(self, landmarks, width: int, height: int) -> Dict[str, float]:
        try:
            image_points = np.array(
                [
                    (landmarks[1].x * width, landmarks[1].y * height),
                    (landmarks[152].x * width, landmarks[152].y * height),
                    (landmarks[33].x * width, landmarks[33].y * height),
                    (landmarks[263].x * width, landmarks[263].y * height),
                    (landmarks[61].x * width, landmarks[61].y * height),
                    (landmarks[291].x * width, landmarks[291].y * height),
                ],
                dtype=np.float64,
            )

            success, rotation_vector, _translation_vector = cv2.solvePnP(
                MODEL_POINTS_3D,
                image_points,
                self._camera_matrix(width, height, self._camera_matrix_cache),
                self._dist_coeffs,
                flags=cv2.SOLVEPNP_ITERATIVE,
            )
            if not success:
                return {"pitch": 0.0, "yaw": 0.0, "roll": 0.0}

            rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
            angles, _, _, _, _, _ = cv2.RQDecomp3x3(rotation_matrix)
            return {
                "pitch": float(angles[0]),
                "yaw": float(angles[1]),
                "roll": float(angles[2]),
            }
        except Exception as exc:
            logger.debug(f"Head pose estimation failed: {exc}")
            return {"pitch": 0.0, "yaw": 0.0, "roll": 0.0}

    @staticmethod
    def _landmark_in_bounds(landmark, margin: float = 0.01) -> bool:
        return (
            margin <= landmark.x <= (1.0 - margin)
            and margin <= landmark.y <= (1.0 - margin)
        )

    @classmethod
    def _landmarks_visible(
        cls,
        landmarks,
        *,
        target_pose: Optional[str] = None,
        yaw: float = 0.0,
    ) -> bool:
        if target_pose in {"left", "right"} or math.fabs(yaw) >= SIDE_YAW_NEAR_RANGE[0]:
            nose_visible = cls._landmark_in_bounds(landmarks[1], margin=0.02)
            chin_visible = cls._landmark_in_bounds(landmarks[152], margin=0.02)
            left_eye_visible = cls._landmark_in_bounds(landmarks[33], margin=-0.06)
            right_eye_visible = cls._landmark_in_bounds(landmarks[263], margin=-0.06)
            left_mouth_visible = cls._landmark_in_bounds(landmarks[61], margin=-0.06)
            right_mouth_visible = cls._landmark_in_bounds(landmarks[291], margin=-0.06)
            return (
                nose_visible
                and chin_visible
                and (left_eye_visible or right_eye_visible)
                and (left_mouth_visible or right_mouth_visible)
            )

        for index in KEY_LANDMARKS:
            landmark = landmarks[index]
            if not cls._landmark_in_bounds(landmark, margin=0.01):
                return False
        return True

    @staticmethod
    def _pose_check(yaw: float, target_pose: Optional[str]) -> tuple[bool, bool]:
        if not target_pose or target_pose not in POSE_THRESHOLDS:
            return True, True

        if target_pose in {"left", "right"}:
            abs_yaw = math.fabs(yaw)
            strict_ok = SIDE_YAW_STRICT_RANGE[0] <= abs_yaw <= SIDE_YAW_STRICT_RANGE[1]
            near_ok = SIDE_YAW_NEAR_RANGE[0] <= abs_yaw <= SIDE_YAW_NEAR_RANGE[1]
            return strict_ok, near_ok

        strict_min, strict_max = POSE_THRESHOLDS[target_pose]["strict"]
        near_min, near_max = POSE_THRESHOLDS[target_pose]["near"]
        strict_ok = strict_min <= yaw <= strict_max
        near_ok = near_min <= yaw <= near_max
        return strict_ok, near_ok

    @staticmethod
    def _quality_score(
        blur_score: float,
        brightness: float,
        face_area_ratio: float,
        checks: Dict[str, bool],
    ) -> float:
        score = 100.0

        if not checks.get("single_face_only", False):
            score -= 35.0
        if not checks.get("face_size_ok", False):
            score -= 20.0
        if not checks.get("blur_ok", False):
            score -= min(22.0, max(0.0, MIN_BLUR_SCORE - blur_score) * 0.15)
        if not checks.get("lighting_ok", False):
            score -= 12.0
        if not checks.get("occlusion_ok", False):
            score -= 18.0
        if not checks.get("pose_ok", True):
            score -= 15.0
        if not checks.get("pitch_ok", True):
            score -= 8.0

        if face_area_ratio > 0:
            score += min(5.0, face_area_ratio * 12.0)
        if brightness >= MIN_BRIGHTNESS and brightness <= MAX_BRIGHTNESS:
            score += 2.0

        return max(0.0, min(100.0, score))

    @staticmethod
    def _build_instruction(
        issues: List[str],
        target_pose: Optional[str],
        yaw: float,
        pitch: float,
    ) -> str:
        if "face_not_visible" in issues:
            return "Center your face inside the guide."
        if "multiple_faces" in issues:
            return "Make sure only one face is visible."
        if "face_too_far" in issues:
            return "Move a little closer to the camera."
        if "face_too_close" in issues:
            return "Move slightly back from the camera."
        if "too_blurry" in issues:
            return "Hold still so the camera can capture a sharp image."
        if "lighting_too_low" in issues:
            return "Increase light on your face."
        if "lighting_too_high" in issues:
            return "Reduce glare or bright backlight."
        if "heavy_occlusion_detected" in issues:
            return "Keep your full face visible without obstruction."
        if "pitch_out_of_range" in issues or "roll_out_of_range" in issues:
            return "Sit normally and keep your face inside the oval."

        if target_pose == "front":
            if yaw < POSE_THRESHOLDS["front"]["strict"][0]:
                return "Turn a little to your right."
            if yaw > POSE_THRESHOLDS["front"]["strict"][1]:
                return "Turn a little to your left."
            return "Look straight at the camera."

        if target_pose == "left":
            if math.fabs(yaw) < SIDE_YAW_STRICT_RANGE[0]:
                return "Turn slightly to one side."
            if math.fabs(yaw) > SIDE_YAW_NEAR_RANGE[1]:
                return "Turn back a little toward the center."
            return "Hold that side angle steady."

        if target_pose == "right":
            if math.fabs(yaw) < SIDE_YAW_STRICT_RANGE[0]:
                return "Turn to the opposite side from your first side photo."
            if math.fabs(yaw) > SIDE_YAW_NEAR_RANGE[1]:
                return "Turn back a little toward the center."
            return "Hold the opposite side angle steady."

        if math.fabs(pitch) > MAX_ABS_PITCH:
            return "Sit normally and look at the camera."
        return "Hold still. Capturing automatically."

    def analyze_frame(
        self,
        frame,
        target_pose: Optional[str] = None,
        require_pose_match: bool = True,
    ) -> Dict[str, Any]:
        target_pose = normalize_face_pose(target_pose)
        if frame is None:
            return {
                "ready_to_capture": False,
                "quality_passed": False,
                "pose_ok": False,
                "guide_color": "red",
                "instruction": "Invalid image data.",
                "issues": ["invalid_image"],
                "checks": {},
                "metrics": {},
            }

        if self.face_detector is None or self.face_mesh is None:
            return {
                "ready_to_capture": False,
                "quality_passed": False,
                "pose_ok": False,
                "guide_color": "red",
                "instruction": "Face analysis is not available right now.",
                "issues": ["analysis_unavailable"],
                "checks": {},
                "metrics": {},
            }

        frame = self._resize_frame(frame)
        frame_height, frame_width = frame.shape[:2]
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        with self._process_lock:
            face_detection_results = self.face_detector.process(frame_rgb)
            face_mesh_results = self.face_mesh.process(frame_rgb)

        face_boxes = self._extract_face_boxes(getattr(face_detection_results, "detections", None))
        face_count = len(face_boxes)
        primary_box = self._pick_primary_box(face_boxes)

        issues: List[str] = []

        if face_count == 0 or not primary_box:
            issues.append("face_not_visible")
            return {
                "target_pose": target_pose,
                "ready_to_capture": False,
                "quality_passed": False,
                "pose_ok": False,
                "guide_color": "red",
                "instruction": "Ready to capture. Hold still." if not require_pose_match else self._build_instruction(issues, target_pose, 0.0, 0.0),
                "issues": issues,
                "checks": {
                    "single_face_only": False,
                    "face_size_ok": False,
                    "blur_ok": False,
                    "lighting_ok": False,
                    "occlusion_ok": False,
                    "pose_ok": False,
                    "pitch_ok": False,
                },
                "metrics": {
                    "face_count": 0,
                },
            }

        if face_count > 1:
            issues.append("multiple_faces")

        face_area_ratio = float(primary_box["width"]) * float(primary_box["height"])
        face_width_ratio = float(primary_box["width"])
        if face_area_ratio < MIN_FACE_AREA_RATIO or face_width_ratio < MIN_FACE_WIDTH_RATIO:
            issues.append("face_too_far")
        if face_area_ratio > MAX_FACE_AREA_RATIO or face_width_ratio > MAX_FACE_WIDTH_RATIO:
            issues.append("face_too_close")

        face_crop = self._crop_face(frame, primary_box)
        blur_score = 0.0
        brightness = 0.0
        if face_crop is None or face_crop.size == 0:
            issues.append("invalid_face_crop")
        else:
            face_gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
            blur_score = float(cv2.Laplacian(face_gray, cv2.CV_64F).var())
            brightness = float(face_gray.mean())
            if blur_score < MIN_BLUR_SCORE:
                issues.append("too_blurry")
            if brightness < MIN_BRIGHTNESS:
                issues.append("lighting_too_low")
            if brightness > MAX_BRIGHTNESS:
                issues.append("lighting_too_high")

        has_mesh = bool(face_mesh_results.multi_face_landmarks)
        pose = {"pitch": 0.0, "yaw": 0.0, "roll": 0.0}
        if not has_mesh:
            issues.append("heavy_occlusion_detected")
        else:
            landmarks = face_mesh_results.multi_face_landmarks[0].landmark
            pose = self._calculate_head_pose(landmarks, frame_width, frame_height)
            if not self._landmarks_visible(landmarks, target_pose=target_pose, yaw=pose["yaw"]):
                issues.append("heavy_occlusion_detected")
            if require_pose_match:
                if math.fabs(pose["pitch"]) > MAX_ABS_PITCH:
                    issues.append("pitch_out_of_range")
                if math.fabs(pose["roll"]) > MAX_ABS_ROLL:
                    issues.append("roll_out_of_range")

        strict_pose_ok, near_pose_ok = self._pose_check(pose["yaw"], target_pose if require_pose_match else None)
        capture_pose_ok = strict_pose_ok if target_pose == "front" else near_pose_ok
        if require_pose_match and not capture_pose_ok:
            issues.append("pose_mismatch")

        checks = {
            "single_face_only": face_count == 1,
            "face_size_ok": "face_too_far" not in issues and "face_too_close" not in issues,
            "blur_ok": "too_blurry" not in issues,
            "lighting_ok": "lighting_too_low" not in issues and "lighting_too_high" not in issues,
            "occlusion_ok": "heavy_occlusion_detected" not in issues,
            "pose_ok": capture_pose_ok,
            "pitch_ok": "pitch_out_of_range" not in issues and "roll_out_of_range" not in issues,
        }

        quality_passed = (
            checks["single_face_only"]
            and checks["face_size_ok"]
            and checks["blur_ok"]
            and checks["lighting_ok"]
            and checks["occlusion_ok"]
            # pitch_ok excluded: pitch/roll only affect guidance, not identity match
        )
        ready_to_capture = quality_passed and (capture_pose_ok if require_pose_match else True)

        guide_color = "green" if ready_to_capture else "yellow"
        if not quality_passed and not (face_count == 1 and checks["face_size_ok"]):
            guide_color = "red"
        elif require_pose_match and not near_pose_ok:
            guide_color = "red"
        elif not quality_passed:
            guide_color = "yellow"

        quality_score = self._quality_score(blur_score, brightness, face_area_ratio, checks)

        return {
            "target_pose": target_pose,
            "ready_to_capture": ready_to_capture,
            "quality_passed": quality_passed,
            "pose_ok": strict_pose_ok,
            "pose_nearly_ok": near_pose_ok,
            "guide_color": guide_color,
            "instruction": "Ready to capture. Hold still." if not require_pose_match else self._build_instruction(issues, target_pose, pose["yaw"], pose["pitch"]),
            "issues": issues,
            "checks": checks,
            "metrics": {
                "face_count": face_count,
                "face_area_ratio": round(face_area_ratio, 4),
                "face_width_ratio": round(face_width_ratio, 4),
                "blur_score": round(blur_score, 2),
                "brightness": round(brightness, 2),
                "yaw": round(pose["yaw"], 2),
                "pitch": round(pose["pitch"], 2),
                "roll": round(pose["roll"], 2),
                "quality_score": round(quality_score, 2),
            },
        }

    def analyze_image(
        self,
        image_bytes: bytes,
        target_pose: Optional[str] = None,
        require_pose_match: bool = True,
    ) -> Dict[str, Any]:
        return self.analyze_frame(
            self._decode_image(image_bytes),
            target_pose=target_pose,
            require_pose_match=require_pose_match,
        )


_face_reference_analyzer = FaceReferenceAnalyzer()


def analyze_face_capture(
    image_bytes: bytes,
    target_pose: Optional[str] = None,
    require_pose_match: bool = True,
) -> Dict[str, Any]:
    return _face_reference_analyzer.analyze_image(
        image_bytes,
        target_pose=target_pose,
        require_pose_match=require_pose_match,
    )


def analyze_identity_frame_bytes(image_bytes: bytes) -> Dict[str, Any]:
    return analyze_face_capture(
        image_bytes,
        target_pose=None,
        require_pose_match=False,
    )
