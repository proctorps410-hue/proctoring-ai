import os
import tempfile
from typing import Any, Dict, List

import cv2
import numpy as np

from utils.face_reference_utils import analyze_identity_frame_bytes
from utils.logger import logger

# ---------------------------------------------------------------------------
# Model configuration — Facenet512 is more robust than VGG-Face for
# cross-condition matching (lighting changes, slight angle, expression diff).
# ---------------------------------------------------------------------------
_FACE_MODEL = os.getenv("PROCTOR_FACE_MODEL", "Facenet512")
_FACE_THRESHOLD = float(os.getenv("PROCTOR_FACE_THRESHOLD", "0.70"))
_FACE_SOFT_THRESHOLD = float(os.getenv("PROCTOR_FACE_SOFT_THRESHOLD", "0.55"))


def compare_faces(known_image: bytes, unknown_image: bytes, threshold: float = _FACE_THRESHOLD):
    """Compare known and unknown face images using DeepFace (Facenet512).

    Returns:
        (verified: bool, result: dict | str)
        - verified=True  if cosine distance < threshold
        - result dict contains confidence (0-100), distance, model name
        - On failure, returns (False, error_string)
    """
    temp_known = None
    temp_unknown = None

    try:
        temp_known = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
        temp_unknown = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")

        known_arr = np.frombuffer(known_image, np.uint8)
        unknown_arr = np.frombuffer(unknown_image, np.uint8)

        known_img = cv2.imdecode(known_arr, cv2.IMREAD_COLOR)
        unknown_img = cv2.imdecode(unknown_arr, cv2.IMREAD_COLOR)

        if known_img is None or unknown_img is None:
            logger.error("Failed to decode image data in compare_faces")
            return False, "Invalid image data"

        cv2.imwrite(temp_known.name, known_img)
        cv2.imwrite(temp_unknown.name, unknown_img)

        # Lazy import — prevents startup crash if DeepFace models haven't downloaded yet.
        from deepface import DeepFace

        import time as _time
        _t0 = _time.monotonic()
        result = DeepFace.verify(
            img1_path=temp_known.name,
            img2_path=temp_unknown.name,
            model_name=_FACE_MODEL,
            distance_metric="cosine",
            enforce_detection=False,   # Graceful — returns no-match instead of exception
            detector_backend="opencv",
            align=False,
        )
        _elapsed = _time.monotonic() - _t0

        distance = float(result.get("distance", 1.0))
        verified = distance < threshold

        logger.info(
            f"Face comparison [{_FACE_MODEL}]: distance={distance:.3f} "
            f"threshold={threshold} verified={verified} elapsed={_elapsed:.2f}s"
        )

        return verified, {
            "match": verified,
            "confidence": round((1.0 - distance) * 100.0, 2),
            "model": _FACE_MODEL,
            "distance": distance,
        }

    except Exception as exc:
        logger.warning(f"Face comparison error: {exc}")
        return False, f"Face comparison failed: {exc}"

    finally:
        for temp_file in [temp_known, temp_unknown]:
            if temp_file:
                try:
                    os.unlink(temp_file.name)
                except Exception:
                    pass


def verify_face_against_references(
    reference_records: List[Dict[str, Any]],
    live_image: bytes,
    threshold: float = _FACE_THRESHOLD,
    skip_quality_check: bool = False,
) -> Dict[str, Any]:
    """Verify a live image against multiple enrolled reference photos.

    Strategy:
    - Hard-block only if NO face is detected at all in the live image.
    - Try every enrolled reference; take the best confidence match.
    - Verified=True if ANY reference clears the hard threshold.
    - Soft-match if best confidence ≥ PROCTOR_FACE_SOFT_THRESHOLD (logged but not blocked).
    - Separates "unverifiable" (no face) from "mismatch" (face seen but doesn't match).

    Args:
        skip_quality_check: If True, skip the mediapipe quality analysis
            (caller already verified face is visible). Saves ~2-5s of
            processing and avoids lock contention.
    """
    if skip_quality_check:
        quality_analysis = {"issues": [], "ready_to_capture": True}
        face_detected = True
    else:
        quality_analysis = analyze_identity_frame_bytes(live_image)
        issues = quality_analysis.get("issues", [])
        face_detected = "face_not_visible" not in issues and "invalid_image" not in issues

    if not face_detected:
        return {
            "status": "unverifiable",
            "verified": False,
            "reason": "no_face_detected",
            "quality": quality_analysis,
            "matches": [],
            "best_match": None,
        }

    comparable_matches: List[Dict[str, Any]] = []
    failures: List[str] = []

    for reference in reference_records:
        reference_image = reference.get("image")
        if not reference_image:
            continue

        match, result = compare_faces(
            known_image=reference_image,
            unknown_image=live_image,
            threshold=threshold,
        )

        if isinstance(result, dict):
            comparable_matches.append(
                {
                    "pose": reference.get("pose", "front"),
                    "match": bool(match),
                    "confidence": float(result.get("confidence", 0.0)),
                    "distance": float(result.get("distance", 1.0)),
                    "result": result,
                }
            )
        else:
            failures.append(str(result))

    if not comparable_matches:
        return {
            "status": "unverifiable",
            "verified": False,
            "reason": "comparison_unavailable",
            "quality": quality_analysis,
            "matches": [],
            "best_match": None,
            "failures": failures,
        }

    best_match = max(comparable_matches, key=lambda item: item["confidence"])
    matching_references = [item for item in comparable_matches if item["match"]]
    hard_verified = len(matching_references) > 0

    # Soft-match: confidence is high enough to be the same person even if just
    # below threshold (different lighting, slight angle). Flag it but allow pass.
    best_confidence = best_match.get("confidence", 0.0)
    soft_verified = (not hard_verified) and (best_confidence / 100.0 >= _FACE_SOFT_THRESHOLD)

    verified = hard_verified or soft_verified
    status = "match" if verified else "mismatch"

    if soft_verified:
        logger.info(
            f"Face soft-match accepted: best_confidence={best_confidence:.1f}% "
            f"soft_threshold={_FACE_SOFT_THRESHOLD * 100:.0f}%"
        )

    return {
        "status": status,
        "verified": verified,
        "soft_match": soft_verified,
        "quality": quality_analysis,
        "matches": comparable_matches,
        "match_count": len(matching_references),
        "best_match": best_match,
        "best_match_pose": best_match.get("pose"),
        "best_confidence": best_confidence,
        "consensus": len(matching_references) >= 2,
        "failures": failures,
    }
