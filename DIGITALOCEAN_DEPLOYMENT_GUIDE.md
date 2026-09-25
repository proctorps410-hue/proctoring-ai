# DigitalOcean Deployment Guide for Droplet IP: 157.245.104.59

This guide is custom-configured for your DigitalOcean Droplet (`157.245.104.59`) using **`nip.io`** with **full HTTPS & WSS SSL support**.

---

## 🌐 Your Live Production URLs

| Service | Public URL | SSL / Secure |
| :--- | :--- | :--- |
| **Student Portal** | `https://157-245-104-59.nip.io` | ✅ HTTPS |
| **Admin Dashboard** | `https://admin.157-245-104-59.nip.io` | ✅ HTTPS |
| **Backend REST API** | `https://api.157-245-104-59.nip.io` | ✅ HTTPS |
| **Proctoring WebSockets** | `wss://api.157-245-104-59.nip.io/ws` | ✅ WSS |

---

## 🔐 Default Admin Login Credentials (Auto-Seeded)

Once deployed, log into the Admin Dashboard (`https://admin.157-245-104-59.nip.io`) using:

* **Email:** `admin@example.com`
* **Password:** `admin1234`
*(Or change these values in your root `.env` before running Docker Compose).*

---

## 🚀 Step-by-Step Deployment Commands

### Step 1: Connect to your Droplet via SSH

Open terminal/PowerShell and connect:
```bash
ssh root@157.245.104.59
```

---

### Step 2: Install Docker, Nginx & Certbot

Run this single command block to update software and install all required tools:

```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 git nginx certbot python3-certbot-nginx nodejs npm
systemctl enable --now docker nginx
```

---

### Step 3: Clone Code to Server

```bash
mkdir -p /var/www
cd /var/www
git clone <YOUR_GIT_REPOSITORY_URL> proctoring-ai
cd proctoring-ai
```

---

### Step 4: Configure Production `.env` File

Create the root `.env` file on the server:

```bash
cat << 'EOF' > /var/www/proctoring-ai/.env
# Database (PostgreSQL)
POSTGRES_USER=proctoring_user
POSTGRES_PASSWORD=ProctoringPass123!
POSTGRES_DB=proctoring_db
DATABASE_PORT=5434

# Redis
REDIS_PORT=6379

# Backend auth/session
JWT_SECRET_KEY=SuperSecretJWTKey15724510459!
SECRET_KEY=SuperSecretJWTKey15724510459!
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60

# Networking & CORS for 157.245.104.59.nip.io
CORS_ORIGINS=https://157-245-104-59.nip.io,https://admin.157-245-104-59.nip.io,https://api.157-245-104-59.nip.io
STUDENT_FRONTEND_URL=https://157-245-104-59.nip.io
ADMIN_FRONTEND_URL=https://admin.157-245-104-59.nip.io
WS_BASE_URL=wss://api.157-245-104-59.nip.io/ws

# MinIO (Storage)
MINIO_ENDPOINT=minio:9000
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=MinioAdminPassword123!
MINIO_BUCKET_NAME=evidence-bucket
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001

# Adminer (DB Viewer)
ADMINER_PORT=8081

# Admin Seeding
SEED_DEFAULT_USERS=true
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=admin1234
EOF
```

---

### Step 5: Build & Start Backend Containers

```bash
cd /var/www/proctoring-ai
docker compose up -d --build
```

Verify backend is running:
```bash
docker compose ps
```

---

### Step 6: Build Frontends for Production

#### 1. Student Frontend (`157-245-104-59.nip.io`)
```bash
cd /var/www/proctoring-ai/Proctoring-AI-FE-M4/Proctoring-AI-FE-M4

cat << 'EOF' > .env.production
VITE_API_URL=https://api.157-245-104-59.nip.io
VITE_WS_URL=wss://api.157-245-104-59.nip.io/ws
VITE_ADMIN_URL=https://admin.157-245-104-59.nip.io
EOF

npm install
npm run build
```

#### 2. Admin Frontend (`admin.157-245-104-59.nip.io`)
```bash
cd /var/www/proctoring-ai/Proctoring-AI-Admin

cat << 'EOF' > .env.production
VITE_API_URL=https://api.157-245-104-59.nip.io/api/v1/
EOF

npm install
npm run build
```

---

### Step 7: Configure Nginx Proxy

Create Nginx site configuration:

```bash
cat << 'EOF' > /etc/nginx/sites-available/proctoring-ai
# 1. Student Frontend
server {
    listen 80;
    server_name 157-245-104-59.nip.io;

    root /var/www/proctoring-ai/Proctoring-AI-FE-M4/Proctoring-AI-FE-M4/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

# 2. Admin Frontend
server {
    listen 80;
    server_name admin.157-245-104-59.nip.io;

    root /var/www/proctoring-ai/Proctoring-AI-Admin/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

# 3. Backend API & WebSockets
server {
    listen 80;
    server_name api.157-245-104-59.nip.io;

    client_max_body_size 50M;

    # REST API
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Proctoring WebSockets
    location /ws {
        proxy_pass http://127.0.0.1:8080/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF
```

Enable config and restart Nginx:

```bash
ln -s /etc/nginx/sites-available/proctoring-ai /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
```

---

### Step 8: Obtain Free SSL Certificates with Certbot

Run Certbot to enable HTTPS and WSS for all 3 subdomains:

```bash
certbot --nginx -d 157-245-104-59.nip.io -d admin.157-245-104-59.nip.io -d api.157-245-104-59.nip.io --non-interactive --agree-tos -m admin@example.com --redirect
```

---

## 🎯 Final Login Verification

1. Navigate to: **`https://admin.157-245-104-59.nip.io`**
2. Enter your credentials:
   - **Email:** `admin@example.com`
   - **Password:** `admin1234`
3. Click **Login** ➔ You will access your live Admin Proctoring Dashboard!
