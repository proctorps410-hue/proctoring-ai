from fastapi import FastAPI, WebSocket, Depends
import cv2
import numpy as np
from datetime import datetime
import json
from detection.face_detection import detect_face  # type: ignore
from detection.hand_detection import detect_hands
from detection.face_mesh_detection import detect_face_mesh
from detection.yolo_detection import detect_yolo
from sqlalchemy.orm import Session
from config.database import get_db, engine, Base
from models.users import User
from models.logs import Log
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from routers import auth

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI()

app.include_router(auth.router, prefix="/auth", tags=["authentication"])

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, db: Session = Depends(get_db)):
    await websocket.accept()
    print("WebSocket connection accepted")

    try:
        while True:
            # Receive frame data from the frontend
            data = await websocket.receive_bytes()
            nparr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            logs = []

            # Face Detection
            face_logs = detect_face(frame)
            print(f"Face logs: {face_logs}")
            logs.extend(face_logs)

            # Hand Detection
            hand_logs = detect_hands(frame)
            print(f"Hand logs: {hand_logs}")
            logs.extend(hand_logs)

            # Face Mesh for Eye and Mouth Tracking
            face_mesh_logs = detect_face_mesh(frame)
            print(f"Face mesh logs: {face_mesh_logs}")
            logs.extend(face_mesh_logs)

            # Phone and Person Detection (YOLOv5)
            yolo_logs = detect_yolo(frame)
            print(f"YOLO logs: {yolo_logs}")
            logs.extend(yolo_logs)

            # Send logs back to the frontend in real-time
            if logs:
                print(f"Sending logs: {logs}")
                await websocket.send_text(json.dumps({"logs": logs}))
    except Exception as e:
        print(f"WebSocket connection closed: {e}")
    finally:
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)