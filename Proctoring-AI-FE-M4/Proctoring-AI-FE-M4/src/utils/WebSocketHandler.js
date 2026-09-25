/**
 * VideoStreamManager — Enterprise-grade WebSocket + Camera manager.
 *
 * Architecture (key invariant):
 *   Camera is acquired ONCE at session start and held for the entire exam.
 *   WebSocket reconnects NEVER touch the camera. They only reconnect the socket.
 *   This prevents the visible "refresh" effect caused by camera re-init.
 */
export class VideoStreamManager {
    constructor(wsUrl, token, userId) {
        this.baseWsUrl = wsUrl;
        this.token = token;
        this.userId = userId;

        // Camera state (long-lived — survives WS reconnects)
        this.stream = null;
        this.videoElement = null;
        this.cameraReady = false;

        // Canvas capture state
        this.captureCanvas = null;
        this.captureContext = null;

        // WebSocket state
        this.socket = null;
        this.wsInitialized = false;
        this.isShuttingDown = false;

        // Frame capture
        this.isStreaming = false;
        this.captureIntervalId = null;
        this.captureIntervalMs = 320;
        this.minCaptureIntervalMs = 180;
        this.maxCaptureIntervalMs = 750;
        this.frameInFlight = false;
        this.frameAckTimeoutId = null;

        // Reconnect state
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 20;         // Never give up during exam
        this.maxReconnectDelayMs = 16000;       // Cap at 16s backoff
        this.reconnectTimer = null;

        // Health monitor — forgiving enough for slow networks and heavy detection
        this.healthCheckInterval = null;
        this.lastMessageTime = Date.now();
        this.healthCheckIntervalMs = 15000;      // Check every 15s
        this.healthTimeoutMs = 45000;           // Dead after 45s silence (allows for slow detection + network)

        // Keep-alive
        this.keepAliveInterval = null;

        // Callbacks
        this.onConnectCallback = null;
        this.onDisconnectCallback = null;
        this.onMessageCallback = null;
    }

    setCallbacks(callbacks) {
        this.onConnectCallback = callbacks?.onConnect;
        this.onDisconnectCallback = callbacks?.onDisconnect;
        this.onMessageCallback = callbacks?.onMessage;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Phase 1: Acquire camera only. Call this first so the exam UI can go live
     * before the WebSocket is even connected.
     */
    async acquireCamera(videoElement) {
        this.videoElement = videoElement;
        try {
            await this._initVideo();
            this.cameraReady = true;
            console.log('[WS] Camera acquired and ready');
            return true;
        } catch (err) {
            console.error('[WS] Camera acquisition failed:', err.message);
            return false;
        }
    }

    /**
     * Phase 2: Connect WebSocket. Camera must already be acquired.
     * This is a background operation — failures schedule silent reconnects.
     */
    async connectWS() {
        if (this.isShuttingDown) return false;
        try {
            await this._connect();
            return true;
        } catch (err) {
            console.warn('[WS] Initial connect failed, scheduling reconnect:', err.message);
            this._scheduleReconnect();
            return false;
        }
    }

    /**
     * Legacy entry-point: acquire camera THEN connect WS (for callers that call
     * initialize() directly). Returns true as soon as camera is ready — WS
     * connecting happens in background.
     */
    async initialize(videoElement) {
        const camOk = await this.acquireCamera(videoElement);
        // Fire-and-forget WS connect so caller isn't blocked waiting for socket
        this.connectWS().catch(() => {});
        return camOk;  // Return camera status, not WS status
    }

    async endSession() {
        console.log('[WS] Ending session...');
        this.isShuttingDown = true;

        this._stopFrameCapture();
        this._stopKeepAlive();
        this._stopHealthMonitor();
        this._clearFrameAckTimeout();

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }

        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.close(1000, 'Exam ended');
        }

        this.wsInitialized = false;
        this.isStreaming = false;
        this.cameraReady = false;
        return true;
    }

    get isConnected() {
        return this.socket?.readyState === WebSocket.OPEN && this.isStreaming;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CAMERA (acquired once, never re-acquired on WS reconnect)
    // ─────────────────────────────────────────────────────────────────────────

    async _initVideo() {
        // If we already have an active stream, reuse it
        if (this.stream?.active) {
            if (this.videoElement && this.videoElement.srcObject !== this.stream) {
                this.videoElement.srcObject = this.stream;
            }
            if (this.videoElement?.paused) {
                await this.videoElement.play().catch(() => {});
            }
            console.log('[WS] Reusing existing camera stream');
            return;
        }

        // Check if video element already has an active stream attached externally
        const existing = this.videoElement?.srcObject;
        if (existing instanceof MediaStream && existing.active) {
            this.stream = existing;
            if (this.videoElement.paused) {
                await this.videoElement.play().catch(() => {});
            }
            console.log('[WS] Adopted externally-set camera stream');
            return;
        }

        // Request camera permissions and build stream
        this.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640, max: 1280 },
                height: { ideal: 480, max: 720 },
                frameRate: { ideal: 10, max: 15 },
                facingMode: 'user',
            },
            audio: false,
        });

        this.videoElement.srcObject = this.stream;

        await new Promise((resolve, reject) => {
            const onMeta = () => { resolve(); cleanup(); };
            const onErr = () => { reject(new Error('Video element error')); cleanup(); };
            const cleanup = () => {
                this.videoElement.removeEventListener('loadedmetadata', onMeta);
                this.videoElement.removeEventListener('error', onErr);
                clearTimeout(tid);
            };
            const tid = setTimeout(() => {
                cleanup();
                reject(new Error('Camera metadata timeout (5s)'));
            }, 5000);  // Was 8s — tightened for faster failure detection
            this.videoElement.addEventListener('loadedmetadata', onMeta, { once: true });
            this.videoElement.addEventListener('error', onErr, { once: true });
        });

        await this.videoElement.play();
        console.log('[WS] Camera initialized from scratch');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WEBSOCKET
    // ─────────────────────────────────────────────────────────────────────────

    async _connect() {
        if (this.isShuttingDown) return;

        return new Promise((resolve, reject) => {
            console.log(`[WS] Connecting (attempt ${this.reconnectAttempts + 1})…`);
            
            // Append token to URL
            const connectUrl = `${this.baseWsUrl}?token=${this.token}`;
            const socket = new WebSocket(connectUrl);
            this.socket = socket;

            // Tightened: 5s timeout (was 10s)
            const timeout = setTimeout(() => {
                reject(new Error('WebSocket connection timeout (5s)'));
                socket.close();
            }, 5000);

            socket.onopen = () => {
                clearTimeout(timeout);
                console.log('[WS] Connected');
                this.reconnectAttempts = 0;
                this.lastMessageTime = Date.now();
                this.wsInitialized = true;
                this._attachHandlers();
                this._startKeepAlive();
                this._startHealthMonitor();
                // Only start frame capture if camera is ready
                if (this.cameraReady) {
                    this._startFrameCapture();
                }
                this.onConnectCallback?.();
                resolve();
            };

            socket.onerror = (err) => {
                clearTimeout(timeout);
                reject(err);
            };

            socket.onclose = (event) => {
                clearTimeout(timeout);
                // During initial connect promise, onclose = failure
                this._onClose();
                reject(new Error(`WebSocket closed before open (${event.code})`));
            };
        });
    }

    _attachHandlers() {
        if (!this.socket) return;

        this.socket.onmessage = (event) => {
            this.lastMessageTime = Date.now();
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'frame_processed' || data.type === 'frame_error') {
                    this._clearFrameAckTimeout();
                    this.frameInFlight = false;
                }

                if (data.type === 'frame_processed' && Number.isFinite(data.processing_ms)) {
                    const target = Math.min(
                        this.maxCaptureIntervalMs,
                        Math.max(this.minCaptureIntervalMs, Math.round(data.processing_ms * 0.85)),
                    );
                    this.captureIntervalMs = Math.round(this.captureIntervalMs * 0.7 + target * 0.3);
                }

                if (data.type === 'keepalive') return;

                this.onMessageCallback?.(data);
            } catch {
                // ignore non-JSON frames
            }
        };

        this.socket.onclose = (event) => {
            console.warn(`[WS] Disconnected (code=${event.code})`);
            this._onClose();
        };

        this.socket.onerror = (err) => {
            console.error('[WS] Socket error:', err);
        };
    }

    _onClose() {
        this._stopKeepAlive();
        this._stopHealthMonitor();
        this._stopFrameCapture();
        this._clearFrameAckTimeout();
        this.wsInitialized = false;
        this.frameInFlight = false;
        this.onDisconnectCallback?.();
        // Camera is NOT touched here — only the socket reconnects
        if (!this.isShuttingDown) {
            this._scheduleReconnect();
        }
    }

    _scheduleReconnect() {
        if (this.isShuttingDown || this.reconnectTimer) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WS] Max reconnect attempts reached. Stopping.');
            return;
        }

        // Exponential backoff capped at maxReconnectDelayMs
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelayMs);
        this.reconnectAttempts += 1;
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})…`);

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            if (this.isShuttingDown) return;
            try {
                // ONLY reconnect the socket — camera is untouched
                await this._connect();
            } catch (err) {
                console.warn('[WS] Reconnect attempt failed:', err.message);
                this._scheduleReconnect();
            }
        }, delay);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // KEEP-ALIVE & HEALTH MONITOR
    // ─────────────────────────────────────────────────────────────────────────

    _startKeepAlive() {
        this._stopKeepAlive();
        this.keepAliveInterval = setInterval(() => {
            if (this.socket?.readyState === WebSocket.OPEN) {
                // Update lastMessageTime on send so we know the connection is still
                // alive even if the server's response is delayed (slow network).
                this.lastMessageTime = Date.now();
                this.socket.send(JSON.stringify({ type: 'keepalive' }));
            }
        }, 10000);  // Every 10s — faster than health timeout so we never false-trigger
    }

    _stopKeepAlive() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    }

    _startHealthMonitor() {
        this._stopHealthMonitor();
        this.healthCheckInterval = setInterval(() => {
            const elapsed = Date.now() - this.lastMessageTime;
            if (elapsed > this.healthTimeoutMs) {
                console.warn(`[WS] Health timeout — no message in ${elapsed}ms. Forcing reconnect.`);
                this.socket?.close(4000, 'Health timeout');
            }
        }, this.healthCheckIntervalMs);
    }

    _stopHealthMonitor() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FRAME CAPTURE
    // ─────────────────────────────────────────────────────────────────────────

    _startFrameCapture() {
        this._stopFrameCapture();
        this.isStreaming = true;
        const tick = () => {
            if (!this.isStreaming) return;
            this._captureAndSendFrame();
            this.captureIntervalId = setTimeout(tick, this.captureIntervalMs);
        };
        tick();
        console.log('[WS] Frame capture started');
    }

    _stopFrameCapture() {
        this.isStreaming = false;
        if (this.captureIntervalId) {
            clearTimeout(this.captureIntervalId);
            this.captureIntervalId = null;
        }
        this._clearFrameAckTimeout();
        // Do NOT null the canvas — reuse it on reconnect
    }

    _clearFrameAckTimeout() {
        if (this.frameAckTimeoutId) {
            clearTimeout(this.frameAckTimeoutId);
            this.frameAckTimeoutId = null;
        }
    }

    _captureAndSendFrame() {
        if (!this.isStreaming) return;
        if (this.socket?.readyState !== WebSocket.OPEN) return;
        if (this.socket.bufferedAmount > 1_500_000) return;
        if (this.frameInFlight) return;
        if (!this.videoElement?.videoWidth) return;

        try {
            if (!this.captureCanvas) {
                this.captureCanvas = document.createElement('canvas');
                this.captureContext = this.captureCanvas.getContext('2d', { alpha: false });
            }
            if (!this.captureContext) return;

            const vw = this.videoElement.videoWidth;
            const vh = this.videoElement.videoHeight;
            if (this.captureCanvas.width !== vw) this.captureCanvas.width = vw;
            if (this.captureCanvas.height !== vh) this.captureCanvas.height = vh;

            this.captureContext.drawImage(this.videoElement, 0, 0);
            this.frameInFlight = true;

            this._clearFrameAckTimeout();
            this.frameAckTimeoutId = setTimeout(() => {
                this.frameInFlight = false;
                this.frameAckTimeoutId = null;
            }, 2500);

            if (this.captureCanvas.toBlob) {
                this.captureCanvas.toBlob((blob) => {
                    if (!blob) { this._clearFrameAckTimeout(); this.frameInFlight = false; return; }
                    if (this.socket?.readyState !== WebSocket.OPEN) { this._clearFrameAckTimeout(); this.frameInFlight = false; return; }
                    this.socket.send(blob);
                }, 'image/jpeg', 0.65);
                return;
            }

            const imageData = this.captureCanvas.toDataURL('image/jpeg', 0.65);
            this.socket.send(imageData);
        } catch (err) {
            console.error('[WS] Frame capture error:', err);
            this._clearFrameAckTimeout();
            this.frameInFlight = false;
        }
    }
}
