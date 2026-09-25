# Restart Backend - Kills all Python processes first to avoid port conflicts
Write-Host "Stopping old backend processes..." -ForegroundColor Yellow
Stop-Process -Name python -Force -ErrorAction SilentlyContinue
Stop-Process -Name uvicorn -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Host "Starting backend..." -ForegroundColor Green
Set-Location "d:\proctoring AI\Proctoring-AI-BE-M4\Proctoring-AI-BE-M4"
python main.py
