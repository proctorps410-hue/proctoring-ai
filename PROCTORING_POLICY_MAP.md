## Proctoring policy + threshold map

This document maps each `event_type` emitted by the backend to the **source-of-truth thresholds/cooldowns** and the **frontend policy handling**.

### Backend: threshold sources

- **Central detector thresholds** live in `Proctoring-AI-BE-M4/Proctoring-AI-BE-M4/config/detection_config.py` and can be overridden via `PROCTOR_*` environment variables.
- **Identity cadence thresholds** live in `Proctoring-AI-BE-M4/Proctoring-AI-BE-M4/services/detection_service.py` and are controlled by `PROCTOR_IDENTITY_*` environment variables.
- **Tab-switch / copy-paste termination thresholds** are read in `Proctoring-AI-BE-M4/Proctoring-AI-BE-M4/routers/exam.py` via `PROCTOR_TAB_SWITCH_TERMINATION_THRESHOLD` and `PROCTOR_COPY_PASTE_TERMINATION_THRESHOLD`.
- **Legacy/unused-looking constants** exist in `routers/exam.py` (`YOLO_CONFIDENCE_THRESHOLD`, `SUSPICIOUS_ACTIVITY_THRESHOLD`) but the detection pipeline uses `config/detection_config.py` via `services/detection_service.py`.

### Frontend: policy sources

The student UI policy is enforced in `Proctoring-AI-FE-M4/Proctoring-AI-FE-M4/src/components/Exam.jsx` via `VITE_*` env vars:

- `VITE_*_GRACE_MS`, `VITE_*_HARD_TERMINATION_MS`
- `VITE_POLICY_*` (score window, termination score, critical confirmation windows)
- `EVENT_SCORE_WEIGHTS`, `WARNING_ONLY_EVENT_TYPES`, `CONFIRMED_CRITICAL_EVENT_TYPES`, `IMMEDIATE_TERMINATION_EVENT_TYPES`

---

## Event types and their controlling thresholds

### Face / camera presence & framing

- **`face_not_visible`**
  - **Backend emitter**: `detection/yolo_detection.py` (MediaPipe FaceDetection used as face-presence gate)
  - **Backend control**:
    - frames: `cfg.temporal.face_absence_frames` → `PROCTOR_FACE_ABSENCE_FRAMES` (default `4`)
    - cooldown: `cfg.temporal.cooldown_face_not_visible` → `PROCTOR_FACE_COOLDOWN_SEC` (default `5.0s`)
  - **Frontend control**: `VITE_FACE_ABSENCE_GRACE_MS`, `VITE_FACE_ABSENCE_HARD_TERMINATION_MS`, `VITE_FACE_ABSENCE_STALE_MS`

- **`face_outside_box` / `face_partially_visible` / `face_too_close` / `face_too_far`**
  - **Backend emitter**: `detection/face_box_monitor.py`
  - **Backend control**:
    - MediaPipe face detection confidence: `cfg.mediapipe.face_detection_confidence` → `PROCTOR_MP_FACE_CONF` (default `0.60`)
    - per-event cooldowns: uses `cfg.temporal.cooldown_face_not_visible` and `cfg.temporal.cooldown_head_posture`
    - required frames: internal `required_frames` table in `face_box_monitor.py`
  - **Frontend control**: face guide repeat/termination config:
    - `VITE_FACE_BOX_REPEAT_ELIGIBILITY_MS`, `VITE_FACE_BOX_CONTINUOUS_TERMINATION_MS`,
      `VITE_FACE_BOX_REPEAT_WINDOW_MS`, `VITE_FACE_BOX_REPEAT_THRESHOLD`,
      `VITE_FACE_GUIDE_VOICE_COOLDOWN_MS`

### Object detection (YOLO)

- **`phone_detected`**
  - **Backend emitter**: `detection/yolo_detection.py`
  - **Backend control**:
    - threshold: `cfg.yolo.phone_confidence` → `PROCTOR_YOLO_PHONE_THRESH` (default `0.60`)
    - streak frames: `cfg.temporal.object_detection_frames` → `PROCTOR_OBJECT_FRAMES` (default `2`)
    - cooldown: `cfg.temporal.cooldown_phone_detected` → `PROCTOR_PHONE_COOLDOWN_SEC` (default `8.0s`)

- **`prohibited_object`**
  - **Backend emitter**: `detection/yolo_detection.py`
  - **Backend control**:
    - threshold: `cfg.yolo.prohibited_object_confidence` → `PROCTOR_YOLO_PROHIBITED_THRESH` (default `0.55`)
    - streak frames: `cfg.temporal.object_detection_frames` → `PROCTOR_OBJECT_FRAMES` (default `2`)
    - cooldown: `cfg.temporal.cooldown_prohibited_object` → `PROCTOR_PROHIBITED_COOLDOWN_SEC` (default `8.0s`)

- **`multiple_people`**
  - **Backend emitter**: `detection/yolo_detection.py`
  - **Backend primary signal**: MediaPipe face count (`face_count_mp > 1`)
  - **Backend additional signal**: YOLO person class (`class_id==0`) using `cfg.yolo.person_confidence`
  - **Backend control**:
    - person threshold: `cfg.yolo.person_confidence` → `PROCTOR_YOLO_PERSON_THRESH` (default `0.45`)
    - streak frames: `cfg.temporal.object_detection_frames` → `PROCTOR_OBJECT_FRAMES` (default `2`)
    - cooldown: `cfg.temporal.cooldown_multiple_people` → `PROCTOR_MULTI_COOLDOWN_SEC` (default `8.0s`)

### FaceMesh-derived (head / eyes / mouth)

- **`head_posture`**
  - **Backend emitter**: `detection/face_mesh_detection.py`
  - **Backend control**:
    - threshold driver: `cfg.face_mesh.head_pose_threshold` → `PROCTOR_HEAD_POSE_THRESH` (default `0.30`)
      - yaw threshold = `head_pose_threshold * 100`
      - pitch threshold = `head_pose_threshold * 70`
    - streak frames: `cfg.temporal.head_pose_frames` → `PROCTOR_HEAD_POSE_FRAMES` (default `4`)
    - cooldown: `cfg.temporal.cooldown_head_posture` → `PROCTOR_HEAD_COOLDOWN_SEC` (default `8.0s`)

- **`eye_movement`** (actually “eyes closed / squint” style EAR-based)
  - **Backend emitter**: `detection/face_mesh_detection.py`
  - **Backend control**:
    - EAR threshold: `cfg.face_mesh.ear_threshold` → `PROCTOR_EAR_THRESH` (default `0.13`)
    - streak frames: `cfg.temporal.eye_closed_frames` → `PROCTOR_EYE_CLOSED_FRAMES` (default `3`)
    - cooldown: `cfg.temporal.cooldown_eye_movement` → `PROCTOR_EYE_COOLDOWN_SEC` (default `5.0s`)

- **`mouth_movement`**
  - **Backend emitter**: `detection/face_mesh_detection.py`
  - **Backend control**:
    - MAR threshold: `cfg.face_mesh.mar_threshold` → `PROCTOR_MAR_THRESH` (default `0.38`)
    - streak frames: `cfg.temporal.mouth_movement_frames` → `PROCTOR_MOUTH_MOVEMENT_FRAMES` (default `5`)
    - cooldown: `cfg.temporal.cooldown_mouth_movement` → `PROCTOR_MOUTH_COOLDOWN_SEC` (default `10.0s`)

### Gaze

- **`gaze_looking_away`**
  - **Backend emitter**: `detection/gaze_tracking.py`
  - **Backend intended control** (from `config/detection_config.py`):
    - h threshold: `cfg.face_mesh.gaze_horizontal_threshold` → `PROCTOR_GAZE_H_THRESH` (default `0.32`)
    - v threshold: `cfg.face_mesh.gaze_vertical_threshold` → `PROCTOR_GAZE_V_THRESH` (default `0.26`)
    - streak frames: `cfg.temporal.gaze_away_frames` → `PROCTOR_GAZE_AWAY_FRAMES` (default `4`)
    - cooldown: `cfg.temporal.cooldown_gaze_looking_away` → `PROCTOR_GAZE_COOLDOWN_SEC` (default `7.0s`)
  - **Known issue**: `gaze_tracking.py` currently clamps these values with hard-coded minimums (to be removed in implementation).

### Hands

- **`hand_detected`**
  - **Backend emitter**: `detection/hand_detection.py`
  - **Backend control**:
    - streak frames: `cfg.temporal.hand_presence_frames` → `PROCTOR_HAND_PRESENCE_FRAMES` (default `2`)
    - cooldown: `cfg.temporal.cooldown_hand_detected` → `PROCTOR_HAND_COOLDOWN_SEC` (default `5.0s`)
    - MediaPipe hands confidences are currently fixed at `0.6` in the detector.

### Spoofing / identity

- **`face_spoofing`**
  - **Backend emitter**: `detection/face_spoofing.py`
  - **Backend control**:
    - variance threshold: `cfg.spoofing.color_variance_threshold` → `PROCTOR_SPOOF_VARIANCE_THRESH` (default `0.68`)
    - cooldown: `cfg.temporal.cooldown_face_spoofing` → `PROCTOR_SPOOF_COOLDOWN_SEC` (default `8.0s`)

- **`identity_unverifiable` / `identity_mismatch`**
  - **Backend emitter**: `services/detection_service.py`
  - **Backend control**:
    - cadence: `PROCTOR_IDENTITY_CHECK_INTERVAL_SEC` (default `12s`)
    - mismatch streak/cooldown: `PROCTOR_IDENTITY_MISMATCH_STREAK`, `PROCTOR_IDENTITY_ALERT_COOLDOWN_SEC`
    - unverifiable streak/cooldown: `PROCTOR_IDENTITY_UNVERIFIABLE_STREAK`, `PROCTOR_IDENTITY_UNVERIFIABLE_ALERT_COOLDOWN_SEC`

### Browser-only events (client)

- **`tab_switch`**
  - **Client source**: `src/utils/tabVisibility.js` (student FE)
  - **Backend termination config**: `PROCTOR_TAB_SWITCH_TERMINATION_THRESHOLD` read in `routers/exam.py`

- **`copy_paste`**
  - **Client source**: `src/utils/copyPasteTracker.js` (student FE)
  - **Backend termination config**: `PROCTOR_COPY_PASTE_TERMINATION_THRESHOLD` read in `routers/exam.py`

- **`screen_share_stopped`**
  - **Client source**: screen recorder session (student FE)
  - **Frontend control**: `VITE_SCREEN_SHARE_LOSS_GRACE_MS`, `VITE_SCREEN_SHARE_HARD_TERMINATION_MS`

---

## Notes on “accuracy” and conflict avoidance

- Treat object detections (phone/prohibited) as **critical** only after temporal confirmation and minimum-quality gating.
- Suppress gaze/head/mouth/eye events when face is missing or identity is unverifiable to avoid noisy alerts.
- Use a backend fusion layer to apply consistent conflict rules and emit stable `event_type` outputs.
