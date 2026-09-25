## Production deployment checklist (Phase 5)

This project can run in dev on localhost, but to keep proctoring stable and real-time in production you need a few hardening steps.

### Backend (FastAPI)
- **Run as containers**: use Docker image builds (avoid running ML model downloads at runtime).
- **Health/readiness**: monitor `GET /api/v1/settings/health` and alert if `ok=false`.
- **Timeouts**: ensure gunicorn/uvicorn timeouts are long enough to survive cold boot, but avoid heavy work on request paths.
- **Resources**: set CPU + memory limits (and test them) so inference latency is predictable.
- **Logs**: capture backend logs centrally (file/ELK/CloudWatch/etc). Include `processing_ms`, `queue_depth`, `dropped_frames` in dashboards.

### Database + Redis + Storage
- **Postgres**: persistent volume, backups, and connection pool sizing.
- **Redis**: persistence optional, but set max memory policy if enabled.
- **MinIO/S3**: confirm evidence bucket exists and credentials are correct.

### Frontends (Admin + Student)
- **Use production build**: avoid Vite dev servers in production.
- **Reverse proxy**: serve behind a single domain (Nginx/Caddy) to simplify CORS and WS.
- **WebSocket**: ensure proxy supports WS upgrade and long-lived connections.

### Proxy / Networking
- **Sticky routing** (if multiple backend replicas): student WS should stay on one replica for the session.
- **TLS**: use HTTPS/WSS in production.

### Baseline monitoring (minimum)
- **Backend**: request rate, p95 latency, error rate, container restarts.
- **Proctoring**: `processing_ms` p95, `dropped_frames` rate, WS disconnects.

