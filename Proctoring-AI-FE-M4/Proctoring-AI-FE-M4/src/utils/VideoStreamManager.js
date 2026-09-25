export class VideoStreamManager {
    constructor(wsUrl, token, userId) {
        this.wsUrl = `${wsUrl}/${userId}?token=${token}`;
        this.socket = null;
        this.stream = null;
        this.videoElement = null;
        this.mediaRecorder = null;
        this.isStreaming = false;
        this.chunkInterval = 100;
        this.onConnectCallback = null;
        this.onDisconnectCallback = null;
    }

    setCallbacks(callbacks) {
        this.onConnectCallback = callbacks?.onConnect;
        this.onDisconnectCallback = callbacks?.onDisconnect;
    }

    async initialize(videoElement) {
        try {
            this.videoElement = videoElement;
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: 640,
                    height: 480,
                    frameRate: { ideal: 10, max: 15 }
                },
                audio: false
            });

            this.videoElement.srcObject = this.stream;
            await this.videoElement.play();

            this.socket = new WebSocket(this.wsUrl);
            this.setupWebSocket();

            return true;
        } catch (error) {
            console.error("Stream initialization failed:", error);
            return false;
        }
    }

    setupWebSocket() {
        this.socket.onopen = () => {
            console.log("WebSocket connected");
            this.onConnectCallback?.();
            this.startStreaming();
        };

        this.socket.onclose = () => {
            console.log("WebSocket closed");
            this.onDisconnectCallback?.();
            this.stopStreaming();
        };

        this.socket.onerror = (error) => {
            console.error("WebSocket error:", error);
        };

        this.socket.onmessage = (message) => {
            try {
                const data = JSON.parse(message.data);
                if (data.type === "logs" && data.stored) {
                    console.log("Detection logs:", data.data);
                }
            } catch (error) {
                console.error("Message parsing error:", error);
            }
        };
    }

    startStreaming() {
        if (!this.stream || !this.socket || this.isStreaming) return;
        this.isStreaming = true;
        this.captureFrames();
    }

    async captureFrames() {
        while (this.isStreaming && this.socket?.readyState === WebSocket.OPEN) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = this.videoElement.videoWidth;
                canvas.height = this.videoElement.videoHeight;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(this.videoElement, 0, 0);

                const imageData = canvas.toDataURL('image/jpeg', 0.7);
                this.socket.send(imageData);

                await new Promise(resolve => setTimeout(resolve, this.chunkInterval));
            } catch (error) {
                console.error("Frame capture error:", error);
            }
        }
    }

    stopStreaming() {
        this.isStreaming = false;
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.close();
        }
    }

    get isConnected() {
        return this.socket?.readyState === WebSocket.OPEN && this.isStreaming;
    }

    disconnect() {
        this.stopStreaming();
    }
}

export default VideoStreamManager;
