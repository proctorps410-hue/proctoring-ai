# Proctoring AI Frontend

A modern React-based web application for AI-powered exam proctoring. The system provides real-time monitoring, face detection, and suspicious activity logging during online examinations.

## Features

- **Authentication**
  - Password-based login
  - Face recognition login
  - Secure signup with face registration
  - Protected routes and session management

- **Exam Proctoring**
  - Real-time webcam monitoring
  - Face detection and tracking
  - Suspicious activity detection
  - Live exam progress tracking
  - Timer management

- **Results & Analytics**
  - Detailed exam summary
  - Compliance rate visualization
  - Suspicious activity logs
  - Performance metrics
  - Session duration tracking

## Tech Stack

- React 18
- Redux Toolkit (State Management)
- React Router v7
- Chart.js & React-Chartjs-2
- WebSocket for real-time communication
- SweetAlert2 for notifications
- Modern CSS with Flexbox & Grid

## Setup & Installation

1. **Clone the repository:**

   ```sh
   git clone https://github.com/Joshuapavan/Proctoring-AI-FE
   ```

2. **Install dependencies:**

   ```sh
   npm install
   ```

3. **Configure environment variables:**
   Create a `.env` file in the root directory:
   ```
   VITE_API_URL=http://localhost:8080
   VITE_WS_URL=ws://localhost:8080
   ```

4. **Start development server:**

   ```sh
   npm run dev
   ```

## Project Structure

- `src/`
  - `App.jsx`: Main component that sets up the video stream and WebSocket connection.
  - `Logs.jsx`: Component to display logs received from the backend.
  - `Actions.jsx`: Component with buttons to toggle the video and drop from the exam.
  - `index.css`: Global CSS styles.
  - `App.css`: Component-specific CSS styles.
  - `main.jsx`: Entry point of the application.

## How It Works

1. **WebSocket Connection:**

   - The frontend connects to a WebSocket server using the configured `VITE_WS_URL` environment variable.
   - Logs received from the server are displayed in the `Logs` component.
   - The connection is automatically retried if it is closed.
2. **Video Streaming:**

   - The user's webcam stream is displayed in the `video` element.
   - Video frames are captured and sent to the backend every 100ms.
3. **Actions:**

   - The `Actions` component provides buttons to toggle the video stream and drop from the exam.

## Available Scripts

In the project directory, you can run:

- `npm start`: Runs the app in the development mode.
- `npm build`: Builds the app for production to the `build` folder.

## License

This project is licensed under the MIT License.
