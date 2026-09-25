import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import numpy as np

from utils.logger import logger


@dataclass
class WarmupState:
    started_at_ms: Optional[int] = None
    completed_at_ms: Optional[int] = None
    last_error: Optional[str] = None
    in_progress: bool = False
    warmup_ms: Optional[int] = None


class WarmupService:
    """
    Enterprise warm-start for detector pipeline.

    Goal: ensure the FIRST real exam frame does not pay model init / import costs.
    The warmup runs entirely in a daemon thread so it never blocks the asyncio
    event loop or the Python import system.
    """

    _lock = threading.Lock()
    _state = WarmupState()
    _thread: Optional[threading.Thread] = None

    @classmethod
    def get_state(cls) -> Dict[str, Any]:
        with cls._lock:
            return {
                "in_progress": cls._state.in_progress,
                "started_at_ms": cls._state.started_at_ms,
                "completed_at_ms": cls._state.completed_at_ms,
                "warmup_ms": cls._state.warmup_ms,
                "last_error": cls._state.last_error,
                "ready": bool(cls._state.completed_at_ms and not cls._state.in_progress and not cls._state.last_error),
            }

    @classmethod
    def is_ready(cls) -> bool:
        state = cls.get_state()
        return bool(state.get("ready"))

    @classmethod
    def _do_warmup_sync(cls) -> None:
        """Run in a daemon thread — imports + inference, never touches the event loop."""
        try:
            # Lazy imports inside the thread so the module-level import of
            # warmup_service.py stays lightweight and doesn't block server startup.
            from detection.face_box_monitor import detect_face_box
            from detection.face_mesh_detection import detect_face_mesh
            from detection.face_spoofing import detect_spoofing
            from detection.gaze_tracking import detect_gaze
            from detection.hand_detection import detect_hands
            from detection.yolo_detection import detect_yolo

            # Tiny dummy frame (black).
            frame = np.zeros((480, 640, 3), dtype=np.uint8)

            # Run each detector once to force internal initialisation.
            detect_face_box(frame, user_id=0)
            detect_face_mesh(frame, user_id=0)
            detect_yolo(frame, confidence_threshold=None, user_id=0)
            detect_hands(frame, user_id=0)
            detect_gaze(frame, user_id=0)
            detect_spoofing(frame, user_id=0)

            completed_at_ms = int(time.time() * 1000)
            with cls._lock:
                cls._state.completed_at_ms = completed_at_ms
                cls._state.warmup_ms = completed_at_ms - int(cls._state.started_at_ms or completed_at_ms)
                cls._state.in_progress = False
                cls._state.last_error = None

            logger.info(f"[Warmup] Detector warmup completed in {cls._state.warmup_ms}ms")
        except Exception as exc:
            logger.error(f"[Warmup] Detector warmup failed: {exc}", exc_info=True)
            with cls._lock:
                cls._state.in_progress = False
                cls._state.last_error = str(exc)

    @classmethod
    def start_warmup(cls) -> Dict[str, Any]:
        """
        Fire-and-forget warmup.  Returns current state immediately.
        Safe to call from both sync (startup) and async (endpoint) contexts.
        """
        with cls._lock:
            # Already done
            if cls._state.completed_at_ms and not cls._state.last_error:
                return cls.get_state()
            # Already running
            if cls._state.in_progress:
                return cls.get_state()
            cls._state.in_progress = True
            cls._state.last_error = None
            cls._state.started_at_ms = int(time.time() * 1000)
            cls._state.completed_at_ms = None
            cls._state.warmup_ms = None

        # Spawn a plain daemon thread — no asyncio.to_thread, no GIL deadlock,
        # no event-loop blocking, no thread-pool exhaustion.
        t = threading.Thread(target=cls._do_warmup_sync, daemon=True, name="warmup-detectors")
        t.start()
        cls._thread = t
        return cls.get_state()
