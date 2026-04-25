# Self-Hosting Plan — FreedomCamp Manager

> **Document status:** Living architecture plan  
> **Domain:** `fcmanager.co.nz` (managed via iwantmyname)  
> **Target VPS:** Hostinger hPanel VPS (`72.61.123.97`)  
> **Goal:** Migrate 100% off managed/cloud services (GitHub Pages, Vercel, Railway, RunPod) to a fully self-hosted stack running on the existing hPanel server.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Containerisation & Orchestration](#2-containerisation--orchestration)
3. [Reverse Proxy & SSL](#3-reverse-proxy--ssl)
4. [Email Architecture (hPanel SMTP)](#4-email-architecture-hpanel-smtp)
5. [DNS Configuration (iwantmyname)](#5-dns-configuration-iwantmyname)
6. [Environment Variables & Secrets](#6-environment-variables--secrets)
7. [Deployment Strategy](#7-deployment-strategy)
8. [CI/CD Integration](#8-cicd-integration)
9. [Upgrade & Rollback Procedure](#9-upgrade--rollback-procedure)
10. [Post-Deployment Validation](#10-post-deployment-validation)

---

## 1. Architecture Overview

### Current (Managed-Service) Stack

| Service | Where it runs today |
|---|---|
| React frontend (`FreedomCamp-Manager-App`) | GitHub Pages / Vercel |
| TypeScript backend / Supabase Edge Functions | Supabase (managed) |
| AI inference service (`Bob` + Ollama) | RunPod serverless pod |
| NZSCV / MotorWeb proxy | Railway |
| PTT / TURN server | Hostinger hPanel VPS |
| Email | External SMTP (SendGrid / Zoho) |

### Target (Self-Hosted) Stack

```
                           iwantmyname DNS
                                │
                fcmanager.co.nz (A → 72.61.123.97)
                api.fcmanager.co.nz  (A → 72.61.123.97)
                mail.fcmanager.co.nz (A → 72.61.123.97)
                                │
                    ┌───────────▼───────────┐
                    │   Hostinger hPanel VPS │
                    │   72.61.123.97         │
                    │                        │
                    │  ┌──────────────────┐  │
                    │  │  Nginx (port 80/  │  │
                    │  │  443 + Let's Enc) │  │
                    │  └────────┬─────────┘  │
                    │           │             │
                    │  ┌────────▼──────────┐  │
                    │  │ Docker Compose    │  │
                    │  │                   │  │
                    │  │ ┌───────────────┐ │  │
                    │  │ │ frontend      │ │  │
                    │  │ │ (Nginx:80)    │ │  │
                    │  │ └───────────────┘ │  │
                    │  │ ┌───────────────┐ │  │
                    │  │ │ proxy-server  │ │  │
                    │  │ │ (Node:3001)   │ │  │
                    │  │ └───────────────┘ │  │
                    │  │ ┌───────────────┐ │  │
                    │  │ │ inference/Bob │ │  │
                    │  │ │ (Node:3002)   │ │  │
                    │  │ └───────────────┘ │  │
                    │  │ ┌───────────────┐ │  │
                    │  │ │ ollama        │ │  │
                    │  │ │ (11434)       │ │  │
                    │  │ └───────────────┘ │  │
                    │  │ ┌───────────────┐ │  │
                    │  │ │ ptt-server    │ │  │
                    │  │ │ (Node:3003)   │ │  │
                    │  │ └───────────────┘ │  │
                    │  └───────────────────┘  │
                    │                        │
                    │  Hostinger Mail         │
                    │  (MX → mail.hostinger)  │
                    └────────────────────────┘
```

**Supabase remains managed** (database, auth, RLS, Edge Functions) — self-hosting Postgres + GoTrue is out of scope and not recommended for this deployment size. All services on the VPS communicate back to Supabase over HTTPS as they do today.

---

## 2. Containerisation & Orchestration

### 2.1 Repository layout (unchanged)

All services already live in this monorepo:

| Directory | Service |
|---|---|
| `src/` + `index.html` | React frontend (Vite build) |
| `proxy-server/` | NZSCV/MotorWeb proxy (Node/Express) |
| `inference-service/` | Bob AI inference (Node + ONNX + Ollama) |
| `ptt-server/` | Push-to-Talk signalling server |

### 2.2 Docker Compose file

Place this file at the repository root. It replaces all external managed services.

```yaml
# docker-compose.yml  (repository root)
version: "3.9"

services:

  # ── React frontend (static build served by Nginx) ────────────────────────
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    restart: unless-stopped
    expose:
      - "80"
    environment:
      - VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
      - VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
    networks:
      - fcm

  # ── NZSCV / MotorWeb proxy ────────────────────────────────────────────────
  proxy-server:
    build:
      context: ./proxy-server
    restart: unless-stopped
    expose:
      - "3001"
    env_file: ./proxy-server/.env
    environment:
      - PORT=3001
      - NODE_ENV=production
    networks:
      - fcm

  # ── Ollama (local LLM engine) ─────────────────────────────────────────────
  ollama:
    image: ollama/ollama:latest
    restart: unless-stopped
    expose:
      - "11434"
    volumes:
      - ollama_data:/root/.ollama
    environment:
      - OLLAMA_NUM_PARALLEL=2
      - OLLAMA_KEEP_ALIVE=24h
    networks:
      - fcm
    # If the VPS has a CUDA-capable GPU, uncomment:
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]

  # ── Bob / inference service ───────────────────────────────────────────────
  inference:
    build:
      context: ./inference-service
    restart: unless-stopped
    expose:
      - "3002"
    env_file: ./inference-service/.env
    environment:
      - PORT=3002
      - NODE_ENV=production
      - OLLAMA_BASE_URL=http://ollama:11434
      - BOB_OPERATING_MODE=self-contained
      - SELF_CONTAINED_MODE=true
      - SELF_CONTAINED_STRICT_EGRESS=true
    depends_on:
      - ollama
    networks:
      - fcm

  # ── PTT server ────────────────────────────────────────────────────────────
  ptt-server:
    build:
      context: ./ptt-server
    restart: unless-stopped
    expose:
      - "3003"
    env_file: ./ptt-server/.env
    environment:
      - PORT=3003
      - NODE_ENV=production
    networks:
      - fcm

  # ── Nginx reverse proxy (terminates SSL, routes to containers) ───────────
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - certbot_www:/var/www/certbot:ro
      - certbot_certs:/etc/letsencrypt:ro
    depends_on:
      - frontend
      - proxy-server
      - inference
      - ptt-server
    networks:
      - fcm

  # ── Certbot (auto-renew Let's Encrypt certs) ─────────────────────────────
  certbot:
    image: certbot/certbot
    restart: unless-stopped
    volumes:
      - certbot_www:/var/www/certbot
      - certbot_certs:/etc/letsencrypt
    entrypoint: >
      /bin/sh -c "trap exit TERM;
      while :; do
        certbot renew --webroot -w /var/www/certbot --quiet;
        sleep 12h & wait $${!};
      done"
    networks:
      - fcm

volumes:
  ollama_data:
  certbot_www:
  certbot_certs:

networks:
  fcm:
    driver: bridge
```

### 2.3 Frontend Dockerfile

```dockerfile
# Dockerfile.frontend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN npm install -g bun && bun install --frozen-lockfile
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN bun run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

`nginx/spa.conf` (single-page-app fallback):

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(js|css|png|jpg|ico|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

---

## 3. Reverse Proxy & SSL

### 3.1 Nginx configuration

```
nginx/
├── nginx.conf          # main Nginx config
└── conf.d/
    ├── fcmanager.conf  # main vhost (frontend + API routes)
    └── ssl-params.conf # shared TLS hardening snippet
```

#### `nginx/nginx.conf`

```nginx
user  nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events { worker_connections 1024; }

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;
  sendfile      on;
  keepalive_timeout 65;
  gzip on;
  gzip_types text/plain text/css application/json application/javascript;

  include /etc/nginx/conf.d/*.conf;
}
```

#### `nginx/conf.d/fcmanager.conf`

```nginx
# ── HTTP: redirect all to HTTPS & serve ACME challenges ───────────────────
server {
  listen 80;
  server_name fcmanager.co.nz www.fcmanager.co.nz api.fcmanager.co.nz ptt.fcmanager.co.nz;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

# ── HTTPS: main web app ────────────────────────────────────────────────────
server {
  listen 443 ssl http2;
  server_name fcmanager.co.nz www.fcmanager.co.nz;

  ssl_certificate     /etc/letsencrypt/live/fcmanager.co.nz/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/fcmanager.co.nz/privkey.pem;
  include /etc/nginx/conf.d/ssl-params.conf;

  # Serve React SPA
  location / {
    proxy_pass         http://frontend:80;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}

# ── HTTPS: API / proxy server ──────────────────────────────────────────────
server {
  listen 443 ssl http2;
  server_name api.fcmanager.co.nz;

  ssl_certificate     /etc/letsencrypt/live/fcmanager.co.nz/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/fcmanager.co.nz/privkey.pem;
  include /etc/nginx/conf.d/ssl-params.conf;

  # NZSCV / MotorWeb proxy
  location /api/proxy/ {
    proxy_pass         http://proxy-server:3001/;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
  }

  # Bob / inference service
  location /api/inference/ {
    proxy_pass         http://inference:3002/;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    client_max_body_size 10m;
  }
}

# ── HTTPS: PTT signalling server (WebSocket) ───────────────────────────────
server {
  listen 443 ssl http2;
  server_name ptt.fcmanager.co.nz;

  ssl_certificate     /etc/letsencrypt/live/fcmanager.co.nz/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/fcmanager.co.nz/privkey.pem;
  include /etc/nginx/conf.d/ssl-params.conf;

  location / {
    proxy_pass         http://ptt-server:3003;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_read_timeout 86400s;
  }
}
```

#### `nginx/conf.d/ssl-params.conf`

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
ssl_stapling on;
ssl_stapling_verify on;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Frame-Options SAMEORIGIN always;
add_header X-Content-Type-Options nosniff always;
```

### 3.2 Initial SSL certificate issuance

Run this **once** on the VPS before starting Docker Compose (Nginx must be down or ports 80/443 must be free):

```bash
# Bootstrap: issue certs for all subdomains
docker run --rm \
  -v $(pwd)/certbot_certs:/etc/letsencrypt \
  -v $(pwd)/certbot_www:/var/www/certbot \
  -p 80:80 \
  certbot/certbot certonly \
    --standalone \
    --agree-tos \
    --no-eff-email \
    -m admin@fcmanager.co.nz \
    -d fcmanager.co.nz \
    -d www.fcmanager.co.nz \
    -d api.fcmanager.co.nz \
    -d ptt.fcmanager.co.nz

# Then start the full stack (certbot container renews automatically every 12h)
docker compose up -d
```

---

## 4. Email Architecture (hPanel SMTP)

### 4.1 How it works

```
Application (Edge Function / proxy-server)
        │
        │  SMTP over TLS (port 465 or 587)
        ▼
Hostinger hPanel Mail Server
  smtp.hostinger.com
        │
        │  Delivers via MX records
        ▼
Recipient inbox  (Gmail, Outlook, etc.)
```

Hostinger's mail servers are already on established IP reputation lists, which means transactional emails from `fcmanager.co.nz` will **not** be flagged as spam — a key advantage over running a raw Postfix server.

### 4.2 Create email accounts in hPanel

1. Log in to **hPanel** → **Emails** → **Email Accounts**
2. Create the following accounts under `fcmanager.co.nz`:

| Address | Purpose |
|---|---|
| `noreply@fcmanager.co.nz` | Transactional emails (reports, notices, invites) |
| `admin@fcmanager.co.nz` | Human admin inbox |
| `support@fcmanager.co.nz` | Officer support |

3. Note the SMTP credentials shown after creation. Hostinger SMTP details are typically:

| Setting | Value |
|---|---|
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` (implicit TLS) or `587` (STARTTLS) |
| `SMTP_USERNAME` | Full email address, e.g. `noreply@fcmanager.co.nz` |
| `SMTP_PASSWORD` | The mailbox password set in hPanel |

### 4.3 Configure Supabase Edge Function secrets (transactional email)

The three email-sending Edge Functions (`send-report-email`, `generate-infringement`, `generate-notice-to-vacate`) read these secrets from the Supabase vault:

```bash
supabase secrets set \
  SMTP_HOST=smtp.hostinger.com \
  SMTP_PORT=465 \
  SMTP_USERNAME=noreply@fcmanager.co.nz \
  SMTP_PASSWORD=<hpanel_mailbox_password> \
  SMTP_FROM_EMAIL=noreply@fcmanager.co.nz \
  SMTP_FROM_NAME="FreedomCamp Manager"
```

### 4.4 Configure proxy-server `.env` (invite emails)

The proxy-server also sends invitation emails via `/api/email/send-invite`. Update `proxy-server/.env` (or the VPS Docker env):

```dotenv
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USERNAME=noreply@fcmanager.co.nz
SMTP_PASSWORD=<hpanel_mailbox_password>
SMTP_FROM_EMAIL=noreply@fcmanager.co.nz
SMTP_FROM_NAME=FieldOps Manager
SITE_URL=https://fcmanager.co.nz
```

### 4.5 Supabase Auth email (invites / magic links)

In the **Supabase Dashboard**:

1. Go to **Authentication → SMTP Settings**
2. Toggle **Custom SMTP** to **Enabled**
3. Fill in the same hPanel credentials above
4. Go to **Authentication → URL Configuration** and set:
   - **Site URL:** `https://fcmanager.co.nz`
   - **Redirect URLs:** `https://fcmanager.co.nz/**`

### 4.6 Email volume limits

Hostinger's standard shared hosting plans impose a sending limit (typically **500 emails/hour**). For the current scale of FreedomCamp Manager (≤ 50 active officers) this is more than sufficient. If outbound volume ever grows beyond that, upgrade to Hostinger's **Business Email** plan or add a dedicated SMTP relay (e.g. Brevo free tier at 300/day).

---

## 5. DNS Configuration (iwantmyname)

Log in to **iwantmyname → fcmanager.co.nz → Manage DNS Records**.

> **Before you start:** Remove any existing A, CNAME, or MX records for `fcmanager.co.nz` that were previously pointing to GitHub Pages or Vercel. The records below replace them entirely.

### 5.1 Web traffic — point to the VPS

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `fcmanager.co.nz` (apex / `@`) | `72.61.123.97` | 3600 |
| `A` | `www` | `72.61.123.97` | 3600 |
| `A` | `api` | `72.61.123.97` | 3600 |
| `A` | `ptt` | `72.61.123.97` | 3600 |

### 5.2 Email traffic — point to Hostinger mail servers

These records tell the internet to deliver `@fcmanager.co.nz` email to Hostinger's infrastructure.

**MX Records** (get exact values from hPanel → Emails → DNS records):

| Type | Name | Value | Priority | TTL |
|---|---|---|---|---|
| `MX` | `fcmanager.co.nz` (`@`) | `mx1.hostinger.com.` | `10` | 3600 |
| `MX` | `fcmanager.co.nz` (`@`) | `mx2.hostinger.com.` | `20` | 3600 |

> **Note:** Hostinger may use different MX hostnames depending on your plan region. Always copy the exact values shown in hPanel after adding the domain.

### 5.3 Email authentication records (anti-spam)

These TXT records are required for your emails to reach recipients' inboxes instead of their spam folder.

**SPF** — authorises Hostinger's mail servers to send on behalf of `fcmanager.co.nz`:

| Type | Name | Value | TTL |
|---|---|---|---|
| `TXT` | `fcmanager.co.nz` (`@`) | `v=spf1 include:_spf.mail.hostinger.com ~all` | 3600 |

**DKIM** — cryptographic signing key (copy the exact record from hPanel):

| Type | Name | Value | TTL |
|---|---|---|---|
| `TXT` | `default._domainkey` | `v=DKIM1; k=rsa; p=<long_key_from_hPanel>` | 3600 |

**DMARC** — policy for handling unauthenticated mail:

| Type | Name | Value | TTL |
|---|---|---|---|
| `TXT` | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:admin@fcmanager.co.nz; pct=100` | 3600 |

### 5.4 DKIM key retrieval from hPanel

1. hPanel → **Emails** → **Email Accounts** → click the domain `fcmanager.co.nz`
2. Click **DNS Records** or **Manage DNS** (the wording varies by plan)
3. Hostinger will show you the exact DKIM TXT record. Copy it verbatim into iwantmyname.

### 5.5 Full DNS record summary

```
fcmanager.co.nz.          3600  IN  A      72.61.123.97
www.fcmanager.co.nz.       3600  IN  A      72.61.123.97
api.fcmanager.co.nz.       3600  IN  A      72.61.123.97
ptt.fcmanager.co.nz.       3600  IN  A      72.61.123.97

fcmanager.co.nz.           3600  IN  MX  10 mx1.hostinger.com.
fcmanager.co.nz.           3600  IN  MX  20 mx2.hostinger.com.

fcmanager.co.nz.           3600  IN  TXT    "v=spf1 include:_spf.mail.hostinger.com ~all"
default._domainkey.fcmanager.co.nz. 3600 IN TXT "v=DKIM1; k=rsa; p=<key_from_hpanel>"
_dmarc.fcmanager.co.nz.    3600  IN  TXT    "v=DMARC1; p=quarantine; rua=mailto:admin@fcmanager.co.nz; pct=100"
```

DNS propagation can take up to **24 hours** but usually completes within 1–2 hours via iwantmyname's infrastructure.

---

## 6. Environment Variables & Secrets

### 6.1 VPS root `.env` file

Create `/opt/fcm/.env` on the VPS. This file is bind-mounted into containers via Docker Compose (never committed to git):

```dotenv
# ── Supabase ────────────────────────────────────────────────────────────────
VITE_SUPABASE_URL=https://kxwjcupuxnnbnzcgmkoi.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>

# ── Proxy server ─────────────────────────────────────────────────────────────
NZSCV_API_KEY=<nzscv_api_key>
NZSCV_ID_KEY=<nzscv_id_key>
NZSCV_ENDPOINT_URL=https://www.nzscv.co.nz/api/rest/scv/v1/vehicleregistrationinfo
MOTORWEB_API_KEY=<motorweb_key>
MOTORWEB_ID_KEY=<motorweb_id>
MOTORWEB_BASE_URL=https://robot.motorweb.co.nz
PROXY_SECRET=<random_secret>

# ── Bob / inference ───────────────────────────────────────────────────────────
INFERENCE_API_KEY=<random_hex_32>
OLLAMA_BASE_URL=http://ollama:11434
BOB_OPERATING_MODE=self-contained
SELF_CONTAINED_MODE=true
CHAT_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:7b

# ── Email (hPanel SMTP) ───────────────────────────────────────────────────────
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USERNAME=noreply@fcmanager.co.nz
SMTP_PASSWORD=<hpanel_mailbox_password>
SMTP_FROM_EMAIL=noreply@fcmanager.co.nz
SMTP_FROM_NAME=FreedomCamp Manager
SITE_URL=https://fcmanager.co.nz

# ── PTT ──────────────────────────────────────────────────────────────────────
PTT_SECRET=<random_secret>
```

### 6.2 Supabase Edge Function secrets (unchanged from current)

Continue managing these in the **Supabase Dashboard → Edge Functions → Manage Secrets**. The only values that change are the service URLs (now pointing to the VPS instead of Railway/RunPod):

| Secret | New value |
|---|---|
| `INFERENCE_SERVICE_URL` | `https://api.fcmanager.co.nz/api/inference` |
| `PROXY_SERVER_URL` | `https://api.fcmanager.co.nz/api/proxy` |
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USERNAME` | `noreply@fcmanager.co.nz` |
| `SMTP_PASSWORD` | `<hpanel_mailbox_password>` |
| `SMTP_FROM_EMAIL` | `noreply@fcmanager.co.nz` |

---

## 7. Deployment Strategy

### 7.1 First-time server setup

SSH into the hPanel VPS and run these steps once:

```bash
ssh root@72.61.123.97

# 1. Install Docker + Docker Compose plugin
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | tee /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 2. Create deployment directory
mkdir -p /opt/fcm
cd /opt/fcm

# 3. Clone the repository
git clone https://github.com/DonSquires/FreedomCamp-Manager.git .

# 4. Create the .env file (fill in real values)
cp .env.example .env
nano .env

# 5. Issue SSL certificates (ports 80/443 must be free)
docker run --rm \
  -v /opt/fcm/certbot_certs:/etc/letsencrypt \
  -v /opt/fcm/certbot_www:/var/www/certbot \
  -p 80:80 \
  certbot/certbot certonly --standalone \
    --agree-tos --no-eff-email \
    -m admin@fcmanager.co.nz \
    -d fcmanager.co.nz -d www.fcmanager.co.nz \
    -d api.fcmanager.co.nz -d ptt.fcmanager.co.nz

# 6. Start all services
docker compose up -d --build

# 7. Pull the Ollama model (first time only — ~4GB download)
docker compose exec ollama ollama pull qwen2.5:7b

# 8. Verify all containers are healthy
docker compose ps
```

### 7.2 Firewall rules (UFW)

```bash
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (redirect to HTTPS + ACME)
ufw allow 443/tcp   # HTTPS
ufw allow 3478/tcp  # TURN (if running coturn for WebRTC)
ufw allow 3478/udp  # TURN UDP
ufw allow 49152:65535/udp  # TURN relay ports
ufw --force enable
```

### 7.3 Updating the application (rolling deploy)

```bash
cd /opt/fcm
git pull origin main

# Rebuild changed images only (Docker layer cache skips unchanged layers)
docker compose build --parallel

# Zero-downtime restart: bring up new containers, then remove old
docker compose up -d --remove-orphans
```

### 7.4 Updating the Ollama model

```bash
# Pull the new model version
docker compose exec ollama ollama pull qwen2.5:32b

# Update OLLAMA_MODEL in .env, then restart inference
docker compose restart inference
```

---

## 8. CI/CD Integration

The existing GitHub Actions workflows can be adapted to deploy to the VPS instead of Railway/Vercel. Add the following secrets to **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `VPS_HOST` | `72.61.123.97` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | Private key whose public key is in `/root/.ssh/authorized_keys` on the VPS |
| `VPS_DEPLOY_PATH` | `/opt/fcm` |

Create `.github/workflows/deploy-vps.yml`:

```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ${{ secrets.VPS_DEPLOY_PATH }}
            git pull origin main
            docker compose build --parallel
            docker compose up -d --remove-orphans
            docker image prune -f
```

---

## 9. Upgrade & Rollback Procedure

### Upgrade

```bash
cd /opt/fcm
git pull origin main
docker compose build --parallel
docker compose up -d --remove-orphans
```

### Rollback to a previous commit

```bash
cd /opt/fcm
git log --oneline -10             # identify target commit
git checkout <commit_sha>
docker compose build --parallel
docker compose up -d --remove-orphans
```

### Emergency rollback (images)

```bash
# List previous image tags (if you tag images before each deploy)
docker images

# Roll back inference service to previous image
docker compose stop inference
docker tag fcm-inference:previous fcm-inference:latest
docker compose start inference
```

---

## 10. Post-Deployment Validation

Run through this checklist after every deployment:

### Web & SSL

```bash
# Frontend loads with valid HTTPS
curl -I https://fcmanager.co.nz

# API proxy health check
curl https://api.fcmanager.co.nz/api/proxy/health

# Bob / inference health check
curl https://api.fcmanager.co.nz/api/inference/health

# PTT server health check
curl https://ptt.fcmanager.co.nz/health
```

### Email

```bash
# Send a test email from the proxy-server container
docker compose exec proxy-server node -e "
const nodemailer = require('nodemailer');
const t = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD }
});
t.sendMail({
  from: process.env.SMTP_FROM_EMAIL,
  to: 'admin@fcmanager.co.nz',
  subject: 'FCM Deployment Test',
  text: 'Self-hosting is live!'
}).then(() => console.log('OK')).catch(console.error);
"
```

### DNS verification

```bash
# Check A records
dig +short fcmanager.co.nz A
dig +short api.fcmanager.co.nz A

# Check MX records
dig +short fcmanager.co.nz MX

# Check SPF
dig +short fcmanager.co.nz TXT | grep spf

# Check DKIM
dig +short default._domainkey.fcmanager.co.nz TXT

# Check DMARC
dig +short _dmarc.fcmanager.co.nz TXT
```

### Application smoke test

1. Open `https://fcmanager.co.nz` → login page loads ✓  
2. Log in as admin → Admin Portal loads ✓  
3. Navigate to **Settings → System Diagnostics** → all services green ✓  
4. Run a plate scan → NZSCV result returned ✓  
5. Open Bob chat → AI response returned ✓  
6. Send a test report email from Admin Portal → email arrives in inbox ✓  
7. Open PTT on a mobile device → PTT connects ✓  

---

## Appendix A — Service Port Reference

| Container | Internal port | Nginx route |
|---|---|---|
| `frontend` | `80` | `https://fcmanager.co.nz/` |
| `proxy-server` | `3001` | `https://api.fcmanager.co.nz/api/proxy/` |
| `inference` | `3002` | `https://api.fcmanager.co.nz/api/inference/` |
| `ptt-server` | `3003` | `https://ptt.fcmanager.co.nz/` |
| `ollama` | `11434` | Internal only (inference → ollama) |

## Appendix B — Supabase remains managed

The following components are **not** self-hosted in this plan:

| Component | Reason |
|---|---|
| Supabase PostgreSQL | Managed RLS, migrations, and real-time are complex to self-host safely |
| Supabase Auth | GoTrue self-hosting requires significant ops overhead |
| Supabase Edge Functions (Deno Deploy) | Deployed via `supabase functions deploy` as today |
| Supabase Storage | Managed S3-compatible object storage |

If full data sovereignty is required in future, consider [Supabase self-hosted](https://supabase.com/docs/guides/self-hosting) on a second VPS or a Supabase Enterprise on-premises licence.

## Appendix C — Cost comparison

| Service | Current (cloud) | Self-hosted (hPanel VPS) |
|---|---|---|
| Frontend hosting | Vercel Free → ~$20/mo for Pro | ✅ Included in VPS |
| NZSCV proxy | Railway ~$5–20/mo | ✅ Included in VPS |
| Bob / Ollama | RunPod ~$20–80/mo (GPU hours) | ✅ CPU-only on VPS (slower) or keep GPU pod for heavy workloads |
| PTT server | Already on hPanel | ✅ Unchanged |
| Email | SendGrid / Zoho ~$5–15/mo | ✅ Included in Hostinger plan |
| **Total saved** | **~$50–130/mo** | |

> **GPU note:** Running Ollama on a CPU-only VPS is fine for `qwen2.5:7b` (~4GB RAM, ~2–4 tokens/sec). For `qwen2.5:32b` a GPU pod (RunPod or equivalent) is recommended and can be kept in the stack as a hybrid option — Ollama on VPS handles low-traffic chat, GPU pod handles heavy concurrent requests.
