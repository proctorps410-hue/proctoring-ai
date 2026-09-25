"""
Face Spoofing Detection Module — v2
====================================
Detects if a printed photo or screen image is being held up instead of a real face.

Layer 1: Color-space histogram entropy (YCrCb + LUV) — original approach
Layer 2: Local Binary Pattern (LBP) texture variance — real skin has micro-texture
Layer 3: Specular reflection analysis — real faces have natural skin highlights

All three layers run in parallel; any 2 of 3 flagging → spoof reported.
This dramatically reduces false positives on real faces while catching quality prints.
"""

import cv2
import numpy as np
import mediapipe as mp  # type: ignore
from datetime import datetime
from utils.logger import logger
import threading
from config.detection_config import detection_config as cfg


def _compute_lbp_variance(gray_img: np.ndarray) -> float:
    """Compute Local Binary Pattern variance over a grayscale face crop.

    Real skin texture produces high LBP variance (complex micro-texture).
    Printed photos and screens produce low LBP variance (flat, uniform).
    Typical real face: > 2500. Typical photo/screen: < 1200.
    """
    try:
        if gray_img is None or gray_img.size == 0:
            return 9999.0  # Unknown — don't flag

        h, w = gray_img.shape[:2]
        # LBP: for each pixel, compare with 8 neighbours
        center = gray_img[1:-1, 1:-1].astype(np.float32)

        lbp = np.zeros_like(center, dtype=np.uint8)
        neighbors = [
            gray_img[0:-2, 0:-2],   # top-left
            gray_img[0:-2, 1:-1],   # top
            gray_img[0:-2, 2:],     # top-right
            gray_img[1:-1, 2:],     # right
            gray_img[2:, 2:],       # bottom-right
            gray_img[2:, 1:-1],     # bottom
            gray_img[2:, 0:-2],     # bottom-left
            gray_img[1:-1, 0:-2],   # left
        ]
        for bit, neighbor in enumerate(neighbors):
            lbp |= ((neighbor.astype(np.float32) >= center).astype(np.uint8) << bit)

        return float(np.var(lbp.astype(np.float32)))

    except Exception as exc:
        logger.debug(f"LBP variance error: {exc}")
        return 9999.0


def _compute_specular_score(hsv_img: np.ndarray) -> float:
    """Compute reflection/highlight score from HSV image.

    Real faces have natural skin specular highlights: a small cluster of very
    bright pixels (V > 220) with low saturation (S < 60).
    Flat photos and screens have very few or very evenly distributed highlights.

    Returns:
        float: 0.0 = likely real (has natural highlights), 1.0 = likely spoof (no highlights)
    """
    try:
        if hsv_img is None or hsv_img.size == 0:
            return 0.0  # Don't flag unknown

        h_chan, s_chan, v_chan = cv2.split(hsv_img)

        # Specular mask: very bright + low saturation (the "sheen" on skin)
        specular_mask = (v_chan.astype(np.uint16) > 210) & (s_chan.astype(np.uint16) < 65)
        specular_ratio = float(np.sum(specular_mask)) / max(1, h_chan.size)

        # Real faces: specular ratio typically 0.002 – 0.04
        # Photos: either 0 (matte) or a huge area (screen glare)
        has_natural_highlights = 0.001 <= specular_ratio <= 0.05

        # Spatial spread: real highlights cluster; screen glare is large/uniform
        if has_natural_highlights:
            specular_pts = np.argwhere(specular_mask)
            if len(specular_pts) > 5:
                spread = float(np.std(specular_pts))
                if spread > 60:
                    # Too spread out — likely screen-wide glare, not skin highlight
                    return 0.5
            return 0.0  # Looks real

        if specular_ratio < 0.001:
            return 0.7  # Almost no highlights — likely matte print
        return 0.4  # Large glare area — likely screen

    except Exception as exc:
        logger.debug(f"Specular score error: {exc}")
        return 0.0


class FaceSpoofingDetector:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(FaceSpoofingDetector, cls).__new__(cls)
                    cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        self.process_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.user_states = {}
        self.face_detector = None
        try:
            self.face_detector = mp.solutions.face_detection.FaceDetection(  # type: ignore
                model_selection=0,
                min_detection_confidence=cfg.mediapipe.face_detection_confidence,
            )
            self.cooldown = cfg.temporal.cooldown_face_spoofing
            self.variance_threshold = cfg.spoofing.color_variance_threshold
            self.max_buffer = 6  # Slightly larger buffer for stability
            # Thresholds for the two new layers
            self.lbp_spoof_threshold = float(
                __import__("os").getenv("PROCTOR_SPOOF_LBP_THRESHOLD", "1400.0")
            )
            self.specular_spoof_threshold = float(
                __import__("os").getenv("PROCTOR_SPOOF_SPECULAR_THRESHOLD", "0.55")
            )
        except Exception as exc:
            logger.error(f"Failed to initialize FaceSpoofingDetector: {exc}")

    def _state_key(self, user_id):
        return user_id if user_id is not None else "__default__"

    def _build_state(self):
        return {
            "last_detection_time": None,
            # One rolling buffer per layer
            "histogram_scores": [],
            "lbp_scores": [],
            "specular_scores": [],
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
        if not self.face_detector:
            return False
        current_time = datetime.now()
        if state["last_detection_time"] is None:
            return True
        time_diff = (current_time - state["last_detection_time"]).total_seconds()
        return time_diff >= self.cooldown

    def _calc_histogram_score(self, img) -> float:
        """Layer 1: Color entropy (original approach, preserved)."""
        try:
            if img is None or img.size == 0:
                return 0.0

            img_ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCR_CB)
            img_luv = cv2.cvtColor(img, cv2.COLOR_BGR2LUV)
            img_hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

            features: list[float] = []
            for ch in range(3):
                hist = cv2.calcHist([img_ycrcb], [ch], None, [256], [0, 256]).flatten()
                hist_n = hist / (hist.sum() + 1e-7)
                features.append(-np.sum(hist_n * np.log2(hist_n + 1e-7)))  # entropy
                features.append(float(np.std(hist_n)))

            for ch in range(3):
                hist = cv2.calcHist([img_luv], [ch], None, [256], [0, 256]).flatten()
                hist_n = hist / (hist.sum() + 1e-7)
                features.append(-np.sum(hist_n * np.log2(hist_n + 1e-7)))

            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            sat_std = float(np.std(img_hsv[:, :, 1]))

            avg_entropy = float(np.mean(features[:6]))
            entropy_score = max(0.0, min(1.0, 1.0 - avg_entropy / 8.0))
            laplacian_score = max(0.0, min(1.0, 1.0 - laplacian_var / 300.0))
            saturation_score = max(0.0, min(1.0, 1.0 - sat_std / 50.0))

            return entropy_score * 0.4 + laplacian_score * 0.35 + saturation_score * 0.25

        except Exception as exc:
            logger.debug(f"Histogram spoof score error: {exc}")
            return 0.0

    def process(self, frame, user_id=None):
        logs = []
        if not self.face_detector:
            return logs

        timestamp = str(datetime.now())
        current_time = datetime.now()
        h, w, _ = frame.shape
        state = self._get_state(user_id)

        with self.process_lock:
            try:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = self.face_detector.process(frame_rgb)

                if not results.detections:
                    # Clear buffers — no face to analyze
                    state["histogram_scores"].clear()
                    state["lbp_scores"].clear()
                    state["specular_scores"].clear()
                    return logs

                for detection in results.detections:
                    bbox = detection.location_data.relative_bounding_box
                    x = max(0, int(bbox.xmin * w))
                    y = max(0, int(bbox.ymin * h))
                    bw = int(bbox.width * w)
                    bh = int(bbox.height * h)
                    x1 = min(w, x + bw)
                    y1 = min(h, y + bh)
                    face_roi = frame[y:y1, x:x1]
                    if face_roi.size == 0:
                        continue
                    face_roi = cv2.resize(face_roi, (128, 128))

                    # ── Layer 1: Histogram entropy ───────────────────────────
                    hist_score = self._calc_histogram_score(face_roi)
                    state["histogram_scores"].append(hist_score)
                    if len(state["histogram_scores"]) > self.max_buffer:
                        state["histogram_scores"].pop(0)
                    layer1_flagged = (
                        len(state["histogram_scores"]) >= 3
                        and float(np.mean(state["histogram_scores"])) > self.variance_threshold
                    )

                    # ── Layer 2: LBP texture ─────────────────────────────────
                    gray_roi = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
                    lbp_var = _compute_lbp_variance(gray_roi)
                    # Low LBP variance = flat texture = likely spoof
                    lbp_score = 1.0 if lbp_var < self.lbp_spoof_threshold else 0.0
                    state["lbp_scores"].append(lbp_score)
                    if len(state["lbp_scores"]) > self.max_buffer:
                        state["lbp_scores"].pop(0)
                    layer2_flagged = (
                        len(state["lbp_scores"]) >= 3
                        and float(np.mean(state["lbp_scores"])) >= 0.6
                    )

                    # ── Layer 3: Specular reflection ─────────────────────────
                    hsv_roi = cv2.cvtColor(face_roi, cv2.COLOR_BGR2HSV)
                    specular_score = _compute_specular_score(hsv_roi)
                    state["specular_scores"].append(specular_score)
                    if len(state["specular_scores"]) > self.max_buffer:
                        state["specular_scores"].pop(0)
                    layer3_flagged = (
                        len(state["specular_scores"]) >= 3
                        and float(np.mean(state["specular_scores"])) >= self.specular_spoof_threshold
                    )

                    # ── Decision: 2-of-3 layers must agree ──────────────────
                    flags_triggered = sum([layer1_flagged, layer2_flagged, layer3_flagged])
                    logger.debug(
                        f"Spoof layers: hist={layer1_flagged} lbp={layer2_flagged} "
                        f"specular={layer3_flagged} flags={flags_triggered} "
                        f"lbp_var={lbp_var:.0f}"
                    )

                    if flags_triggered >= 2 and self._check_cooldown(state):
                        avg_hist = float(np.mean(state["histogram_scores"])) if state["histogram_scores"] else 0.0
                        logs.append({
                            "time": timestamp,
                            "event": "Possible face spoofing detected",
                            "event_type": "face_spoofing",
                            "details": (
                                f"Layers flagged: {flags_triggered}/3 "
                                f"(hist={layer1_flagged}, lbp={layer2_flagged}, "
                                f"specular={layer3_flagged}) "
                                f"hist_score={avg_hist:.2f} lbp_var={lbp_var:.0f}"
                            ),
                            "suspicious": True,
                        })
                        state["last_detection_time"] = current_time
                        state["histogram_scores"].clear()
                        state["lbp_scores"].clear()
                        state["specular_scores"].clear()

                    break  # Only process the primary (largest) face

            except Exception as exc:
                logger.error(f"Face spoofing detection error: {exc}")

        return logs


_global_spoof_detector = FaceSpoofingDetector()


def detect_spoofing(frame, **kwargs):
    """Public face spoofing detection function using the singleton detector."""
    user_id = kwargs.pop("user_id", None)
    del kwargs
    return _global_spoof_detector.process(frame, user_id=user_id)


def cleanup_spoofing_user(user_id):
    _global_spoof_detector.cleanup_user(user_id)
