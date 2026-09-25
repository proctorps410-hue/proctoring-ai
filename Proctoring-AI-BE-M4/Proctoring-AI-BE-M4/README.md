# Proctoring AI System

A real-time AI proctoring system that monitors exam sessions using computer vision. The system detects suspicious activities and provides exam analytics through a secure WebSocket connection.

## Features

- **Real-time Detection**
  - Face presence/absence detection
  - Eye and mouth movement tracking
  - Hand gesture detection
  - Phone and multiple person detection

- **Authentication & Security**
  - JWT-based authentication
  - Face recognition login
  - Secure WebSocket connections
  - Session management

- **Exam Management**
  - Start/Stop exam sessions
  - Real-time activity logging
  - Session analytics
  - Compliance scoring

## Technical Stack

- **Backend Framework**: FastAPI
- **Database**: MySQL
- **ML/CV Libraries**:
  - MediaPipe (Face, Hand, Mesh detection)
  - YOLOv8 (Object detection)
  - OpenCV
  - face_recognition

## API Endpoints

### Authentication
- `POST /api/v1/auth/signup` - Register new user with face image
- `POST /api/v1/auth/login/password` - Login with email/password
- `POST /api/v1/auth/login/face` - Login with face recognition

### Exam Management
- `POST /api/v1/exam/start/{user_id}` - Start exam session
- `POST /api/v1/exam/stop/{user_id}` - Stop exam session
- `POST /api/v1/exam/pause/{user_id}` - Pause exam session
- `POST /api/v1/exam/resume/{user_id}` - Resume exam session
- `GET /api/v1/exam/summary/{user_id}` - Get exam analytics
- `POST /api/v1/exam/clear-logs/{user_id}` - Clear session logs

### WebSocket
- `ws://localhost:8080/ws/{user_id}` - Real-time proctoring connection

## Setup

### Using Docker (Recommended)

1. Build and run using Docker Compose:
```bash
docker-compose up --build
```

### Docker Troubleshooting

If you encounter the error "Cannot connect to the Docker daemon":

1. Make sure Docker Desktop is installed and running
2. On macOS:
   ```bash
   # Start Docker Desktop from terminal
   open -a Docker
   
   # Wait for Docker to start (about 30 seconds)
   # Then try running docker-compose again
   docker-compose up --build
   ```

3. Verify Docker is running:
   ```bash
   docker info
   ```

2. Or run with Docker directly:
```bash
docker build -t proctoring-ai .
docker run -p 8000:8000 proctoring-ai
```

### Manual Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/Proctoring-AI-BE.git
cd Proctoring-AI-BE
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Set up MySQL database:
```sql
CREATE DATABASE Proctoring_AI;
```

4. Configure environment:
```bash
# Update database URL in config/database.py if needed
SQLALCHEMY_DATABASE_URL = "mysql+mysqlconnector://user:password@localhost/Proctoring_AI"
```

5. Start the server:
```bash
uvicorn main:app --host localhost --port 8080 --reload
```

## API Documentation

A complete Postman collection is available at:
```bash
/postman_collection/Proctoring AI - Sharath.postman_collection.json
```

Import this collection into Postman to test all available endpoints:
1. Open Postman
2. Click "Import"
3. Select the collection JSON file
4. All endpoints will be available with example requests

The collection includes:
- Authentication endpoints (signup, login)
- Exam management endpoints
- WebSocket testing examples
- Environment variables

## Architecture

- `detection/` - ML model implementations
- `models/` - Database models
- `routers/` - API routes
- `schemas/` - Pydantic models
- `services/` - Business logic
- `utils/` - Helper functions

## WebSocket Protocol

### Client -> Server:
- Video frames as base64 or binary data

### Server -> Client:
```json
{
  "type": "logs",
  "data": [
    {
      "event": "Face not detected",
      "time": "2025-03-22T12:20:14.075"
    }
  ],
  "stored": true
}
```

## License

MIT License
