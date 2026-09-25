from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram


# WebSocket lifecycle
WS_CONNECTIONS_TOTAL = Counter(
    "proctor_ws_connections_total",
    "Total WebSocket connections accepted",
    ["kind"],  # student|admin
)
WS_DISCONNECTS_TOTAL = Counter(
    "proctor_ws_disconnects_total",
    "Total WebSocket disconnections",
    ["kind", "reason"],  # reason=client|server|error|policy
)

WS_ACTIVE_CONNECTIONS = Gauge(
    "proctor_ws_active_connections",
    "Active WebSocket connections",
    ["kind"],  # student|admin
)

# Frame processing
FRAME_PROCESSING_MS = Histogram(
    "proctor_frame_processing_ms",
    "Detection worker processing time per frame (ms)",
    buckets=(10, 25, 50, 75, 100, 150, 250, 400, 600, 900, 1500, 2500),
)
FRAME_QUEUE_DEPTH = Gauge(
    "proctor_frame_queue_depth",
    "Current frame queue depth",
)
FRAMES_DROPPED_TOTAL = Counter(
    "proctor_frames_dropped_total",
    "Total frames dropped due to queue backpressure",
)

# Evidence upload
EVIDENCE_UPLOAD_TOTAL = Counter(
    "proctor_evidence_upload_total",
    "Evidence upload attempts",
    ["result"],  # success|fail
)

# Policy decisions
POLICY_ACTIONS_TOTAL = Counter(
    "proctor_policy_actions_total",
    "Policy actions applied",
    ["action", "reason", "source"],  # warn|terminate, reason, ws_detector|frontend_log|system
)

# Rate limiting
RATE_LIMIT_HITS_TOTAL = Counter(
    "proctor_rate_limit_hits_total",
    "Requests rejected due to rate limiting",
    ["endpoint"],  # stable key
)

