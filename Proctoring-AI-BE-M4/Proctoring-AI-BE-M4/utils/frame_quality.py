from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, Tuple

import cv2
import numpy as np


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class FrameQualityResult:
    ok: bool
    metrics: Dict[str, Any]
    issues: Tuple[str, ...]


def assess_frame_quality(frame) -> FrameQualityResult:
    """
    Lightweight, model-free frame quality gate.

    Purpose: avoid generating high-impact proctoring alerts from frames that are
    too dark/bright or too blurry to support reliable landmark/object inference.

    Tunables (env):
      - PROCTOR_FRAME_MIN_MEAN_LUMA (default 55)
      - PROCTOR_FRAME_MAX_MEAN_LUMA (default 210)
      - PROCTOR_FRAME_MIN_LAPLACIAN_VAR (default 40)
    """
    if frame is None:
        return FrameQualityResult(False, {"reason": "frame_none"}, ("frame_missing",))

    min_luma = _float_env("PROCTOR_FRAME_MIN_MEAN_LUMA", 55.0)
    max_luma = _float_env("PROCTOR_FRAME_MAX_MEAN_LUMA", 210.0)
    min_lap_var = _float_env("PROCTOR_FRAME_MIN_LAPLACIAN_VAR", 40.0)

    try:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    except Exception:
        # If input isn't BGR, try a safe conversion path
        gray = frame if len(getattr(frame, "shape", ())) == 2 else None
        if gray is None:
            return FrameQualityResult(False, {"reason": "frame_format"}, ("frame_format_invalid",))

    mean_luma = float(np.mean(gray))
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    issues = []
    if mean_luma < min_luma:
        issues.append("too_dark")
    if mean_luma > max_luma:
        issues.append("too_bright")
    if lap_var < min_lap_var:
        issues.append("too_blurry")

    ok = len(issues) == 0
    metrics: Dict[str, Any] = {
        "mean_luma": mean_luma,
        "laplacian_var": lap_var,
        "thresholds": {
            "min_mean_luma": min_luma,
            "max_mean_luma": max_luma,
            "min_laplacian_var": min_lap_var,
        },
    }
    return FrameQualityResult(ok, metrics, tuple(issues))

