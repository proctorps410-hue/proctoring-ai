# Step-by-Step Deployment Guide: Railway + Vercel (~$5 / Month Total)

This guide will walk you through deploying your **Proctoring AI** stack for **~$5 (₹415) per month**:
* **Backend API & ML Engine:** Railway (Docker)
* **PostgreSQL Database:** Railway (Managed Plugin - 1 Click)
* **Redis Cache:** Railway (Managed Plugin - 1 Click)
* **Student Frontend:** Vercel (**Free $0**)
* **Admin Dashboard:** Vercel (**Free $0**)

---

## 🎯 Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    PRODUCTION ENVIRONMENT                    │
│                                                              │
│  Student Frontend  ──> https://proctoring-student.vercel.app │
│  Admin Dashboard   ──> https://proctoring-admin.vercel.app   │
│  Backend API       ──> https://your-backend.up.railway.app   │
│  WebSocket Stream  ──> wss://your-backend.up.railway.app/ws  │
└──────────────────────────────────────────────────────────────┘
```

---

## Step 1: Push Your Code to GitHub

Make sure your 3 project subfolders are pushed to your GitHub account:
1. `Proctoring-AI-BE-M4` (Backend)
2. `Proctoring-AI-Admin` (Admin Frontend)
3. `Proctoring-AI-FE-M4` (Student Frontend)

---

## Step 2: Deploy Backend & Database on Railway

1. Go to **[Railway.app](https://railway.app/)** and log in with your GitHub account.
2. Click **+ New Project** ➔ Select **Provision PostgreSQL**.
   * *Railway will automatically create a managed PostgreSQL database for you.*
3. Click **+ New** inside the same project ➔ Select **Provision Redis**.
   * *Railway will create a Redis instance for real-time WebSocket state.*

### Deploy the Backend Service:
4. Click **+ New** ➔ Select **GitHub Repo**.
5. Choose your **`Proctoring-AI-BE-M4`** repository.
   *(If prompted for Root Directory, set it to `Proctoring-AI-BE-M4` or the inner folder containing `Dockerfile`).*
6. Railway will automatically detect your `railway.toml` and `Dockerfile` and start building!

---

## Step 3: Configure Backend Environment Variables on Railway

Inside your Railway Backend service, click on **Variables** tab and add the following:

| Variable Name | Value / Connection String |
| :--- | :--- |
| `DB_TYPE` | `postgres` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` *(Select reference from Railway dropdown)* |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` *(Select reference from Railway dropdown)* |
| `JWT_SECRET_KEY` | `SuperSecretRailwayJWTKey123!` |
| `SECRET_KEY` | `SuperSecretRailwayJWTKey123!` |
| `ALGORITHM` | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` |
| `PORT` | `8000` |
| `CORS_ORIGINS` | `*` *(Or put your Vercel frontend URLs once deployed)* |
| `SEED_DEFAULT_USERS` | `true` |
| `SEED_ADMIN_EMAIL` | `admin@example.com` |
| `SEED_ADMIN_PASSWORD` | `admin1234` |

### Generate Public Domain on Railway:
1. Go to **Settings** tab in your Backend service on Railway.
2. Scroll to **Networking** ➔ Click **Generate Domain**.
3. Railway will give you a domain like:
   `https://proctoring-backend-production.up.railway.app`
   *(Copy this URL! Your WebSocket URL will automatically be `wss://proctoring-backend-production.up.railway.app/ws`).*

---

## Step 4: Deploy Student Frontend on Vercel (100% Free)

1. Go to **[Vercel.com](https://vercel.com/)** and log in with GitHub.
2. Click **Add New...** ➔ **Project**.
3. Import your **`Proctoring-AI-FE-M4`** repository.
4. Set **Root Directory** to `Proctoring-AI-FE-M4/Proctoring-AI-FE-M4`.
5. Expand **Environment Variables** and add:

   | Key | Value |
   | :--- | :--- |
   | `VITE_API_URL` | `https://your-backend.up.railway.app` |
   | `VITE_WS_URL` | `wss://your-backend.up.railway.app/ws` |
   | `VITE_ADMIN_URL` | `https://proctoring-admin.vercel.app` |

6. Click **Deploy**. Vercel will give you a live URL like `https://proctoring-student.vercel.app`.

---

## Step 5: Deploy Admin Dashboard on Vercel (100% Free)

1. On Vercel, click **Add New...** ➔ **Project**.
2. Import your **`Proctoring-AI-Admin`** repository.
3. Set **Root Directory** to `Proctoring-AI-Admin`.
4. Expand **Environment Variables** and add:

   | Key | Value |
   | :--- | :--- |
   | `VITE_API_URL` | `https://your-backend.up.railway.app/api/v1/` |

5. Click **Deploy**. Vercel will give you a live URL like `https://proctoring-admin.vercel.app`.

---

## Step 6: Log in and Test Your Application! 🎉

1. Open your live Admin Dashboard: `https://proctoring-admin.vercel.app`
2. Log in with your auto-seeded credentials:
   * **Email:** `admin@example.com`
   * **Password:** `admin1234`
3. Open your live Student Portal: `https://proctoring-student.vercel.app`
4. Start an exam session — video frames and proctoring telemetry will stream live over WebSockets to your Railway backend!
