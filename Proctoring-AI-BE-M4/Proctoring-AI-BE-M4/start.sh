#!/bin/sh

# Create logs directory
mkdir -p /app/logs

# Export default JWT secret if not set
if [ -z "$JWT_SECRET_KEY" ]; then
    export JWT_SECRET_KEY=$(python -c 'import secrets; print(secrets.token_hex(64))')
fi

# Set default port if not set
PORT="${PORT:-8080}"
HOST="${SERVER_HOST:-0.0.0.0}"

# Start the application using uvicorn
exec uvicorn main:app --host "$HOST" --port "$PORT" --workers 1