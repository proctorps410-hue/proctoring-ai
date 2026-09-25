
# PowerShell Script to Run Full Stack Proctoring AI

Write-Host "--- Proctoring AI Stack Launcher ---" -ForegroundColor Cyan

# Function to check if a port is in use
function Check-Port($port) {
    return netstat -ano | findstr ":$port" | findstr "LISTENING"
}

# 1. Start Backend
if (Check-Port 8080) {
    Write-Host "Warning: Port 8080 is already in use (possibly by Docker). Backend might fail to start if not using Docker." -ForegroundColor Yellow
} else {
    Write-Host "Starting Backend on Port 8080..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'd:\proctoring AI\Proctoring-AI-BE-M4\Proctoring-AI-BE-M4'; python main.py"
}

# 2. Start Admin Frontend
if (Check-Port 5173) {
    Write-Host "Warning: Port 5173 is already in use." -ForegroundColor Yellow
} else {
    Write-Host "Starting Admin Frontend on Port 5173..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'd:\proctoring AI\Proctoring-AI-Admin'; npm run dev"
}

# 3. Start Student Frontend
if (Check-Port 5174) {
    Write-Host "Warning: Port 5174 is already in use." -ForegroundColor Yellow
} else {
    Write-Host "Starting Student Frontend on Port 5174..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'd:\proctoring AI\Proctoring-AI-FE-M4\Proctoring-AI-FE-M4'; npm run dev"
}

Write-Host "`nAll launch commands issued." -ForegroundColor Cyan
Write-Host "If things are 'not running', check if Docker is already using port 8080." -ForegroundColor White
