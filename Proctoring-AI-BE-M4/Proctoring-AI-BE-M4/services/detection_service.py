import asyncio
import os
import threading
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

import cv2
from sqlalchemy.orm import Session

from config.detection_config import detection_config as cfg
from utils.logger import logger


class DetectionService:
    # Run heavier detectors less often so long sessions stay stable instead of
    # building thread backlogs that eventually starve real-time processing.
    DETECTOR_INTERVALS_SEC = {
        "Face Box": 0.0,
        "Face Mesh": 0.0,
        "YOLO": 0.8,       # was 1.25s — faster multi-person & phone detection
        "Hand": 0.5,       # was 0.8s
        "Gaze": 0.0,
        "Spoofing": 1.5,
    }
    MAX_FRAME_DIM = 640
    # Phase 3: compute budget (ms) for the full detector stack per frame.
    # If exceeded, we degrade by skipping deep detectors for that frame.
    FRAME_BUDGET_MS = float(os.getenv("PROCTOR_FRAME_BUDGET_MS", "450"))
    EVIDENCE_RETRY_BACKOFF_SEC = 45
    IDENTITY_CHECK_INTERVAL_SEC = float(os.getenv("PROCTOR_IDENTITY_CHECK_INTERVAL_SEC", "8.0"))
    IDENTITY_MISMATCH_STREAK = int(os.getenv("PROCTOR_IDENTITY_MISMATCH_STREAK", "2"))
    IDENTITY_ALERT_COOLDOWN_SEC = float(os.getenv("PROCTOR_IDENTITY_ALERT_COOLDOWN_SEC", "15.0"))
    IDENTITY_UNVERIFIABLE_STREAK = int(os.getenv("PROCTOR_IDENTITY_UNVERIFIABLE_STREAK", "2"))
    IDENTITY_UNVERIFIABLE_ALERT_COOLDOWN_SEC = float(
        os.getenv("PROCTOR_IDENTITY_UNVERIFIABLE_ALERT_COOLDOWN_SEC", "18.0")
    )
    # If "true", add terminate_exam=True to identity_mismatch logs so frontend auto-terminates.
    IDENTITY_MISMATCH_TERMINATE = os.getenv("PROCTOR_IDENTITY_MISMATCH_TERMINATE", "true").strip().lower() in {"1", "true", "yes", "on"}

    _detector_state_lock = threading.Lock()
    _detector_last_run: dict[int, dict[str, datetime]] = {}
    _evidence_state_lock = threading.Lock()
    _evidence_retry_after: Optional[datetime] = None
    _identity_state_lock = threading.Lock()
    _identity_state: dict[int, dict[str, Any]] = {}

    @classmethod
    def _should_run_detector(cls, user_id: int, detector_name: str, now: datetime) -> bool:
        interval = cls.DETECTOR_INTERVALS_SEC.get(detector_name, 0.0)
        if interval <= 0:
            return True

        with cls._detector_state_lock:
            user_state = cls._detector_last_run.setdefault(user_id, {})
            last_run = user_state.get(detector_name)
            if last_run and (now - last_run).total_seconds() < interval:
                return False
            user_state[detector_name] = now
            return True

    @staticmethod
    def _dedupe_logs(logs: List[Dict]) -> List[Dict]:
        unique_logs: List[Dict] = []
        seen: set[tuple[str, str, str]] = set()

        for log in logs:
            key = (
                str(log.get("event_type", "")),
                str(log.get("event", "")),
                str(log.get("details", "")),
            )
            if key in seen:
                continue
            seen.add(key)
            unique_logs.append(log)

        return unique_logs

    @classmethod
    def _prepare_frame(cls, frame):
        """Downscale oversized frames for stable detector throughput."""
        height, width = frame.shape[:2]
        max_dim = max(height, width)
        if max_dim <= cls.MAX_FRAME_DIM:
            return frame

        scale = cls.MAX_FRAME_DIM / float(max_dim)
        resized_w = max(1, int(width * scale))
        resized_h = max(1, int(height * scale))
        return cv2.resize(frame, (resized_w, resized_h), interpolation=cv2.INTER_AREA)

    @classmethod
    def _can_attempt_evidence_upload(cls, now: datetime) -> bool:
        with cls._evidence_state_lock:
            return cls._evidence_retry_after is None or now >= cls._evidence_retry_after

    @classmethod
    def _mark_evidence_upload_success(cls) -> None:
        with cls._evidence_state_lock:
            cls._evidence_retry_after = None

    @classmethod
    def _mark_evidence_upload_failure(cls, now: datetime) -> None:
        with cls._evidence_state_lock:
            cls._evidence_retry_after = now + timedelta(seconds=cls.EVIDENCE_RETRY_BACKOFF_SEC)

    @classmethod
    def _get_identity_state(cls, user_id: int) -> dict[str, Any]:
        if user_id not in cls._identity_state:
            cls._identity_state[user_id] = {
                "last_check": None,
                "last_alert": None,
                "last_unverifiable_alert": None,
                "reference_images_loaded": False,
                "reference_images": None,
                "mismatch_streak": 0,
                "unverifiable_streak": 0,
            }
        return cls._identity_state[user_id]

    @classmethod
    def _should_run_identity_check(cls, user_id: int, now: datetime) -> bool:
        with cls._identity_state_lock:
            state = cls._get_identity_state(user_id)
            last_check = state.get("last_check")
            if last_check and (now - last_check).total_seconds() < cls.IDENTITY_CHECK_INTERVAL_SEC:
                return False
            state["last_check"] = now
            return True

    @classmethod
    def _get_reference_images(cls, db: Session, user_id: int) -> Optional[list[dict[str, Any]]]:
        with cls._identity_state_lock:
            state = cls._get_identity_state(user_id)
            if state.get("reference_images_loaded"):
                return state.get("reference_images")

        from utils.face_reference_utils import load_user_face_references

        reference_images: Optional[list[dict[str, Any]]] = None
        try:
            reference_images = load_user_face_references(db, user_id)
        except Exception as exc:
            logger.warning(f"Failed to load known face references for user {user_id}: {exc}")

        with cls._identity_state_lock:
            state = cls._get_identity_state(user_id)
            state["reference_images"] = reference_images
            state["reference_images_loaded"] = True
        return reference_images

    @staticmethod
    def _compare_identity_frame(reference_images: list[dict[str, Any]], frame) -> Optional[dict[str, Any]]:
        try:
            success, buffer = cv2.imencode(".jpg", frame)
            if not success:
                return None

            from utils.face_auth import verify_face_against_references

            verification = verify_face_against_references(
                reference_records=reference_images,
                live_image=buffer.tobytes(),
                threshold=0.6
            )
            return verification
        except Exception as exc:
            logger.warning(f"Identity frame comparison failed: {exc}")
            return None

    @classmethod
    def _register_identity_result(cls, user_id: int, status: str, now: datetime) -> Optional[str]:
        """
        Track identity verification status and return the alert type when one should be emitted.
        """
        with cls._identity_state_lock:
            state = cls._get_identity_state(user_id)
            if status == "match":
                state["mismatch_streak"] = 0
                state["unverifiable_streak"] = 0
                return None

            if status == "unverifiable":
                state["mismatch_streak"] = 0
                state["unverifiable_streak"] = int(state.get("unverifiable_streak", 0)) + 1
                last_alert = state.get("last_unverifiable_alert")
                cooldown_ok = (
                    last_alert is None
                    or (now - last_alert).total_seconds() >= cls.IDENTITY_UNVERIFIABLE_ALERT_COOLDOWN_SEC
                )
                if state["unverifiable_streak"] >= cls.IDENTITY_UNVERIFIABLE_STREAK and cooldown_ok:
                    state["unverifiable_streak"] = 0
                    state["last_unverifiable_alert"] = now
                    return "identity_unverifiable"
                return None

            state["unverifiable_streak"] = 0
            state["mismatch_streak"] = int(state.get("mismatch_streak", 0)) + 1
            last_alert = state.get("last_alert")
            cooldown_ok = (
                last_alert is None
                or (now - last_alert).total_seconds() >= cls.IDENTITY_ALERT_COOLDOWN_SEC
            )
            if state["mismatch_streak"] >= cls.IDENTITY_MISMATCH_STREAK and cooldown_ok:
                state["mismatch_streak"] = 0
                state["last_alert"] = now
                return "identity_mismatch"
            return None

    @classmethod
    async def process_frame(cls, db: Session, user_id: int, frame) -> List[Dict]:
        from detection.face_box_monitor import detect_face_box
        from detection.face_mesh_detection import detect_face_mesh
        from detection.face_spoofing import detect_spoofing
        from detection.gaze_tracking import detect_gaze
        from detection.hand_detection import detect_hands
        from detection.yolo_detection import detect_yolo

        all_logs: List[Dict] = []
        conf_thresh = cfg.yolo.person_confidence
        started_at = datetime.utcnow()
        frame_for_detection = cls._prepare_frame(frame)

        # ── Frame quality gate ───────────────────────────────────────────────
        # Avoid emitting high-impact proctoring events from frames that are too
        # dark/bright/blurry to support reliable inference.
        try:
            from utils.frame_quality import assess_frame_quality

            quality = assess_frame_quality(frame_for_detection)
            if not quality.ok:
                all_logs.append(
                    {
                        "time": str(datetime.utcnow()),
                        "event": "Frame quality too low for reliable detection.",
                        "event_type": "frame_quality_low",
                        "details": f"Issues={list(quality.issues)} Metrics={quality.metrics}",
                        "confidence": 0.0,
                        "suspicious": False,
                    }
                )
        except Exception as exc:
            logger.debug(f"Frame quality assessment failed: {exc}")

        # Phase 2: Real-time vs Deep lane
        # - Real-time lane must run first and stay stable under load.
        # - Deep lane runs opportunistically and must never block core monitoring.
        realtime_detectors: List[tuple[str, Callable[[], List[Dict]]]] = [
            ("Face Box", lambda: detect_face_box(frame_for_detection, user_id=user_id)),
            ("YOLO", lambda: detect_yolo(frame_for_detection, confidence_threshold=conf_thresh, user_id=user_id)),
            ("Face Mesh", lambda: detect_face_mesh(frame_for_detection, user_id=user_id)),
        ]
        deep_detectors: List[tuple[str, Callable[[], List[Dict]]]] = [
            ("Hand", lambda: detect_hands(frame_for_detection, user_id=user_id)),
            ("Gaze", lambda: detect_gaze(frame_for_detection, user_id=user_id)),
            ("Spoofing", lambda: detect_spoofing(frame_for_detection, user_id=user_id)),
        ]

        # If quality is poor, still allow face presence + object detection to run,
        # but suppress jitter-prone landmark detectors to reduce false positives.
        suppress_detectors = set()
        try:
            if "quality" in locals() and not quality.ok:
                suppress_detectors = {"Face Mesh", "Hand", "Gaze", "Spoofing"}
        except Exception:
            suppress_detectors = set()

        wall_start = time.perf_counter()
        for detector_name, detector_fn in realtime_detectors:
            if not cls._should_run_detector(user_id, detector_name, started_at):
                continue
            if detector_name in suppress_detectors:
                continue

            try:
                logs = await asyncio.to_thread(detector_fn)
                if logs:
                    all_logs.extend(logs)
            except Exception as exc:
                logger.error(
                    f"Error in {detector_name} detection for user {user_id}: {exc}",
                    exc_info=True,
                )

        # Phase 3: deep lane is opportunistic; never block the real-time lane.
        elapsed_ms = (time.perf_counter() - wall_start) * 1000
        remaining_ms = cls.FRAME_BUDGET_MS - elapsed_ms
        if remaining_ms > 0:
            for detector_name, detector_fn in deep_detectors:
                if not cls._should_run_detector(user_id, detector_name, started_at):
                    continue
                if detector_name in suppress_detectors:
                    continue

                # Stop deep processing if budget is exhausted
                elapsed_ms = (time.perf_counter() - wall_start) * 1000
                if elapsed_ms >= cls.FRAME_BUDGET_MS:
                    all_logs.append(
                        {
                            "time": str(datetime.utcnow()),
                            "event": "Proctoring running in degraded mode due to compute budget.",
                            "event_type": "proctoring_degraded",
                            "details": f"budget_ms={cls.FRAME_BUDGET_MS} elapsed_ms={round(elapsed_ms,2)}",
                            "confidence": 0.0,
                            "suspicious": False,
                        }
                    )
                    break

                try:
                    logs = await asyncio.to_thread(detector_fn)
                    if logs:
                        all_logs.extend(logs)
                except Exception as exc:
                    logger.error(
                        f"Error in {detector_name} detection for user {user_id}: {exc}",
                        exc_info=True,
                    )

        if cls._should_run_identity_check(user_id, started_at):
            reference_images = cls._get_reference_images(db, user_id)
            if reference_images:
                identity_payload = await asyncio.to_thread(
                    cls._compare_identity_frame,
                    reference_images,
                    frame_for_detection,
                )
                if identity_payload is not None:
                    verification_status = str(identity_payload.get("status") or "unverifiable")
                    alert_type = cls._register_identity_result(user_id, verification_status, datetime.utcnow())
                    if alert_type == "identity_unverifiable":
                        quality = identity_payload.get("quality") or {}
                        quality_metrics = quality.get("metrics") or {}
                        quality_score = float(quality_metrics.get("quality_score", 0.0))
                        instruction = quality.get("instruction") or "Unable to verify clearly. Face the camera."
                        all_logs.append(
                            {
                                "time": str(datetime.utcnow()),
                                "event": instruction,
                                "event_type": "identity_unverifiable",
                                "details": f"Frame quality too low for confident verification. Issues={quality.get('issues', [])}",
                                "confidence": max(0.0, min(1.0, quality_score / 100.0)),
                                "suspicious": False,
                            }
                        )
                    elif alert_type == "identity_mismatch":
                        result = identity_payload.get("best_match")
                        confidence_ratio = 0.0
                        distance = None
                        if isinstance(result, dict):
                            confidence_ratio = max(
                                0.0,
                                min(1.0, float(result.get("confidence", 0.0)) / 100.0),
                            )
                            distance = result.get("distance")

                        details = "Identity mismatch with enrolled student face."
                        if distance is not None:
                            details = f"{details} Distance={distance:.3f}"

                        mismatch_log: dict = {
                            "time": str(datetime.utcnow()),
                            "event": "Identity mismatch detected after repeated confident rechecks.",
                            "event_type": "identity_mismatch",
                            "details": details,
                            "confidence": confidence_ratio,
                            "suspicious": True,
                            "terminate_exam": cls.IDENTITY_MISMATCH_TERMINATE,
                        }

                        # ── Save mismatch frame as evidence immediately ──────
                        if cls._can_attempt_evidence_upload(datetime.utcnow()):
                            try:
                                import uuid
                                from services.storage_service import StorageService

                                success_enc, mismatch_buf = cv2.imencode(".jpg", frame_for_detection)
                                if success_enc:
                                    mismatch_filename = (
                                        f"evidence/{datetime.utcnow().strftime('%Y-%m-%d')}/"
                                        f"identity_mismatch_{user_id}_{uuid.uuid4()}.jpg"
                                    )
                                    file_url = await StorageService.upload_file(
                                        mismatch_buf.tobytes(), mismatch_filename
                                    )
                                    if file_url:
                                        mismatch_log["file_url"] = file_url
                                        mismatch_log["is_flagged"] = True
                                        cls._mark_evidence_upload_success()
                                    else:
                                        cls._mark_evidence_upload_failure(datetime.utcnow())
                            except Exception as ev_exc:
                                logger.warning(f"Failed to save identity mismatch evidence: {ev_exc}")

                        all_logs.append(mismatch_log)

        all_logs = cls._dedupe_logs(all_logs)
        try:
            from utils.policy_fusion import fuse_logs_inplace

            include_debug = (os.getenv("PROCTOR_FUSION_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"})
            all_logs = fuse_logs_inplace(all_logs, include_debug=include_debug)
        except Exception as exc:
            logger.debug(f"Policy fusion failed: {exc}")

        if all_logs and cls._can_attempt_evidence_upload(started_at):
            try:
                import uuid

                from services.storage_service import StorageService

                success, buffer = cv2.imencode(".jpg", frame_for_detection)
                if success:
                    filename = (
                        f"evidence/{datetime.utcnow().strftime('%Y-%m-%d')}/"
                        f"{user_id}_{uuid.uuid4()}.jpg"
                    )
                    try:
                        # StorageService already enforces remote timeout and local fallback.
                        # Avoid wrapping with a shorter timeout that can cancel fallback writes.
                        file_url = await StorageService.upload_file(buffer.tobytes(), filename)
                        if file_url:
                            for log in all_logs:
                                log["file_url"] = file_url
                                log["is_flagged"] = True
                            cls._mark_evidence_upload_success()
                        else:
                            cls._mark_evidence_upload_failure(datetime.utcnow())
                    except Exception:
                        cls._mark_evidence_upload_failure(datetime.utcnow())
            except Exception as exc:
                logger.warning(f"Evidence prep failed: {exc}")

        logger.debug(f"Returning {len(all_logs)} logs from process_frame for user {user_id}")
        return all_logs

    @classmethod
    def get_live_monitor_state(cls, user_id: int) -> Dict[str, Any]:
        from detection.face_box_monitor import get_face_box_state

        return {
            "face_guide": get_face_box_state(user_id),
        }

    @classmethod
    def clear_identity_cache(cls, user_id: int) -> None:
        """
        Clear only the lightweight cached identity state.
        This is safe to call from auth flows without importing detector modules.
        """
        with cls._identity_state_lock:
            cls._identity_state.pop(user_id, None)

    @classmethod
    def cleanup_user(cls, user_id: int) -> None:
        from detection.face_box_monitor import cleanup_face_box_user
        from detection.face_mesh_detection import cleanup_face_mesh_user
        from detection.face_spoofing import cleanup_spoofing_user
        from detection.gaze_tracking import cleanup_gaze_user
        from detection.hand_detection import cleanup_hand_user
        from detection.yolo_detection import cleanup_yolo_user

        with cls._detector_state_lock:
            cls._detector_last_run.pop(user_id, None)
        cls.clear_identity_cache(user_id)

        cleanup_face_box_user(user_id)
        cleanup_face_mesh_user(user_id)
        cleanup_spoofing_user(user_id)
        cleanup_gaze_user(user_id)
        cleanup_hand_user(user_id)
        cleanup_yolo_user(user_id)

    @classmethod
    async def cleanup(cls):
        with cls._detector_state_lock:
            cls._detector_last_run.clear()
        with cls._evidence_state_lock:
            cls._evidence_retry_after = None
        with cls._identity_state_lock:
            cls._identity_state.clear()
