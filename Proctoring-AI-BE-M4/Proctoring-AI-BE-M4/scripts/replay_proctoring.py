from __future__ import annotations

import argparse
import json
import os
import time
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import cv2

from config.detection_config import detection_config as cfg
from utils.frame_quality import assess_frame_quality
from utils.policy_fusion import fuse_logs_inplace


def _run_detectors(frame, user_id: int) -> List[Dict]:
    """
    Run the realtime detectors without DB dependencies.

    Notes:
    - Identity checks are intentionally excluded (they require enrolled reference images).
    - Evidence uploads are excluded (storage/minio).
    """
    from detection.face_box_monitor import detect_face_box
    from detection.face_mesh_detection import detect_face_mesh
    from detection.face_spoofing import detect_spoofing
    from detection.gaze_tracking import detect_gaze
    from detection.hand_detection import detect_hands
    from detection.yolo_detection import detect_yolo

    logs: List[Dict] = []

    q = assess_frame_quality(frame)
    if not q.ok:
        logs.append(
            {
                "time": str(datetime.utcnow()),
                "event": "Frame quality too low for reliable detection.",
                "event_type": "frame_quality_low",
                "details": f"Issues={list(q.issues)} Metrics={q.metrics}",
                "confidence": 0.0,
                "suspicious": False,
            }
        )

    suppress = set()
    if not q.ok:
        suppress = {"Face Mesh", "Hand", "Gaze", "Spoofing"}

    if "Face Box" not in suppress:
        logs.extend(detect_face_box(frame, user_id=user_id))
    if "Face Mesh" not in suppress:
        logs.extend(detect_face_mesh(frame, user_id=user_id))
    # YOLO is kept even when quality is low (phone/multi-person can still work)
    logs.extend(detect_yolo(frame, confidence_threshold=cfg.yolo.person_confidence, user_id=user_id))
    if "Hand" not in suppress:
        logs.extend(detect_hands(frame, user_id=user_id))
    if "Gaze" not in suppress:
        logs.extend(detect_gaze(frame, user_id=user_id))
    if "Spoofing" not in suppress:
        logs.extend(detect_spoofing(frame, user_id=user_id))

    return fuse_logs_inplace(logs)


def _percentile(values: List[float], p: float) -> Optional[float]:
    if not values:
        return None
    if p <= 0:
        return float(min(values))
    if p >= 100:
        return float(max(values))
    values_sorted = sorted(values)
    # Nearest-rank method
    k = max(0, min(len(values_sorted) - 1, int(round((p / 100.0) * (len(values_sorted) - 1))))))
    return float(values_sorted[k])


def _read_videos_file(path: str) -> List[str]:
    videos: List[str] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            candidate = line.strip().strip('"').strip("'")
            if not candidate or candidate.startswith("#"):
                continue
            videos.append(candidate)
    return videos


def _run_single_video(video_path: str, fps: float, user_id: int, max_seconds: float) -> Dict[str, Any]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise SystemExit(f"Unable to open video: {video_path}")

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    frame_interval = max(1, int(round((native_fps or 30.0) / max(fps, 0.1))))

    counts = Counter()
    per_minute = defaultdict(int)
    frames_seen = 0
    frames_sampled = 0
    per_frame_processing_ms: List[float] = []
    started = time.time()

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        frames_seen += 1
        if frames_seen % frame_interval != 0:
            continue

        frames_sampled += 1
        ts_sec = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        minute_bucket = int(ts_sec // 60)

        process_started_at = time.perf_counter()
        logs = _run_detectors(frame, user_id=int(user_id))
        per_frame_processing_ms.append(round((time.perf_counter() - process_started_at) * 1000, 3))

        for log in logs:
            event_type = str(log.get("event_type") or "")
            if not event_type:
                continue
            counts[event_type] += 1
            per_minute[(minute_bucket, event_type)] += 1

        if max_seconds and ts_sec >= max_seconds:
            break

    elapsed = time.time() - started
    cap.release()

    return {
        "video": video_path,
        "native_fps": native_fps,
        "sample_fps": fps,
        "frames_seen": frames_seen,
        "frames_sampled": frames_sampled,
        "elapsed_sec": elapsed,
        "latency_ms": {
            "p50": _percentile(per_frame_processing_ms, 50),
            "p95": _percentile(per_frame_processing_ms, 95),
            "p99": _percentile(per_frame_processing_ms, 99),
            "max": max(per_frame_processing_ms) if per_frame_processing_ms else None,
            "mean": round((sum(per_frame_processing_ms) / len(per_frame_processing_ms)), 3) if per_frame_processing_ms else None,
        },
        "counts": dict(counts),
        "counts_per_minute": [
            {"minute": minute, "event_type": et, "count": count}
            for (minute, et), count in sorted(per_minute.items(), key=lambda item: (item[0][0], item[0][1]))
        ],
    }


def _summarize_rows(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in results:
        latency = item.get("latency_ms") or {}
        rows.append(
            {
                "video": item.get("video"),
                "frames_sampled": item.get("frames_sampled"),
                "p95_ms": latency.get("p95"),
                "max_ms": latency.get("max"),
                "elapsed_sec": item.get("elapsed_sec"),
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Replay proctoring detectors on a video file.")
    parser.add_argument("--video", default="", help="Path to an input video file (mp4/webm/etc).")
    parser.add_argument("--videos-file", default="", help="Text file with one video path per line (supports # comments).")
    parser.add_argument("--fps", type=float, default=2.0, help="Sampling fps for analysis (default: 2).")
    parser.add_argument("--user-id", type=int, default=1, help="Synthetic user id for per-user state.")
    parser.add_argument("--max-seconds", type=float, default=0.0, help="Stop after N seconds (0 = full video).")
    parser.add_argument("--out", default="", help="Write JSON summary to this file path.")
    args = parser.parse_args()

    videos: List[str] = []
    if args.video:
        videos.append(args.video)
    if args.videos_file:
        videos.extend(_read_videos_file(args.videos_file))

    if not videos:
        raise SystemExit("Provide --video or --videos-file")

    results: List[Dict[str, Any]] = []
    combined_counts = Counter()
    started_all = time.time()

    for video_path in videos:
        item = _run_single_video(
            video_path=video_path,
            fps=float(args.fps),
            user_id=int(args.user_id),
            max_seconds=float(args.max_seconds),
        )
        results.append(item)
        combined_counts.update(item.get("counts") or {})

    elapsed_all = time.time() - started_all

    summary = {
        "videos": results,
        "combined": {
            "elapsed_sec": elapsed_all,
            "counts": dict(combined_counts),
            "rows": _summarize_rows(results),
        },
        "backend_thresholds": {
            "yolo": {
                "phone_confidence": cfg.yolo.phone_confidence,
                "person_confidence": cfg.yolo.person_confidence,
                "prohibited_object_confidence": cfg.yolo.prohibited_object_confidence,
                "phone_classes": sorted(list(cfg.yolo.phone_classes)),
                "prohibited_object_classes": sorted(list(cfg.yolo.prohibited_object_classes)),
            },
            "mediapipe": {"face_detection_confidence": cfg.mediapipe.face_detection_confidence},
            "face_mesh": {
                "mar_threshold": cfg.face_mesh.mar_threshold,
                "ear_threshold": cfg.face_mesh.ear_threshold,
                "head_pose_threshold": cfg.face_mesh.head_pose_threshold,
                "gaze_horizontal_threshold": cfg.face_mesh.gaze_horizontal_threshold,
                "gaze_vertical_threshold": cfg.face_mesh.gaze_vertical_threshold,
            },
            "temporal": {
                "face_absence_frames": cfg.temporal.face_absence_frames,
                "object_detection_frames": cfg.temporal.object_detection_frames,
                "head_pose_frames": cfg.temporal.head_pose_frames,
                "eye_closed_frames": cfg.temporal.eye_closed_frames,
                "mouth_movement_frames": cfg.temporal.mouth_movement_frames,
                "gaze_away_frames": cfg.temporal.gaze_away_frames,
                "hand_presence_frames": cfg.temporal.hand_presence_frames,
                "cooldowns": {
                    "face_not_visible": cfg.temporal.cooldown_face_not_visible,
                    "phone_detected": cfg.temporal.cooldown_phone_detected,
                    "multiple_people": cfg.temporal.cooldown_multiple_people,
                    "head_posture": cfg.temporal.cooldown_head_posture,
                    "eye_movement": cfg.temporal.cooldown_eye_movement,
                    "mouth_movement": cfg.temporal.cooldown_mouth_movement,
                    "hand_detected": cfg.temporal.cooldown_hand_detected,
                    "gaze_looking_away": cfg.temporal.cooldown_gaze_looking_away,
                    "face_spoofing": cfg.temporal.cooldown_face_spoofing,
                    "prohibited_object": cfg.temporal.cooldown_prohibited_object,
                },
            },
            "frame_quality_gate": {
                "env": {
                    "PROCTOR_FRAME_MIN_MEAN_LUMA": os.getenv("PROCTOR_FRAME_MIN_MEAN_LUMA", ""),
                    "PROCTOR_FRAME_MAX_MEAN_LUMA": os.getenv("PROCTOR_FRAME_MAX_MEAN_LUMA", ""),
                    "PROCTOR_FRAME_MIN_LAPLACIAN_VAR": os.getenv("PROCTOR_FRAME_MIN_LAPLACIAN_VAR", ""),
                }
            },
        },
    }

    payload = json.dumps(summary, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(payload)
    else:
        print(payload)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

