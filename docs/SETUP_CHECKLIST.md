# FieldOps Manager — Secrets & Credentials Setup Checklist

**Interactive operator checklist for provisioning a new or replacement deployment.**

Work through each phase in order.  Some values (Railway service URLs) are only available
after the first successful deploy of each service, so you will return to earlier phases
as those deploys complete.

> **References:**
> - Full variable descriptions and aliases → [SECRETS_REGISTRY.md](SECRETS_REGISTRY.md)
> - Environment variable reference → [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md)
> - Bob Railway setup → [BOB_PRODUCTION_RAILWAY_SETUP.md](BOB_PRODUCTION_RAILWAY_SETUP.md)
> - Service ownership → [RAILWAY_SERVICES_AUTHORITY.md](RAILWAY_SERVICES_AUTHORITY.md)
> - New project provisioning → [NEW_PROJECT_SETUP.md](NEW_PROJECT_SETUP.md)

---

## Phase 0 — Generate Secrets Locally

Run these commands on your machine **before** touching any dashboard.  Save the output securely.

```bash
# 1. Shared API key: Bob ↔ Edge Functions ↔ GitHub Actions
openssl rand -hex 32   # → INFERENCE_API_KEY

# 2. PTT proxy shared secret: PTT server ↔ ptt-signaling-token edge function
openssl rand -hex 32   # → PTT_PROXY_SECRET  (also used as PROXY_SECRET on the PTT Railway service)

# 3. PTT JWT signing secret: PTT server signs channel tokens
openssl rand -hex 32   # → PTT_JWT_SECRET

# 4. Intel bulletin HMAC key: signs intel feed bulletins
openssl rand -hex 32   # → INTEL_HMAC_KEY

# 5. VAPID key pair: web push notifications
node scripts/generate-vapid-keys.js
# → VITE_VAPID_PUBLIC_KEY  (goes in .env)
# → VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT  (go into Supabase secrets)
```

- [ ] `INFERENCE_API_KEY` generated and stored securely
- [ ] `PTT_PROXY_SECRET` generated and stored securely
- [ ] `PTT_JWT_SECRET` generated and stored securely
- [ ] `INTEL_HMAC_KEY` generated and stored securely
- [ ] VAPID key pair generated and stored securely

---

## Phase 1 — Collect Supabase Values

Log into **Supabase Dashboard → Your Project → Settings** and collect:

| Secret | Location |
|---|---|
| `VITE_SUPABASE_URL` | Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Settings → API → Project API Keys → **anon** |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → Project API Keys → **service_role** ⚠️ Never expose in browser |
| `SUPABASE_PROJECT_REF` | Settings → General → Reference ID |
| `SUPABASE_DB_PASSWORD` | Settings → Database → Database Password |
| `SUPABASE_ACCESS_TOKEN` | Account (top-right avatar) → Access Tokens → Generate new token |

- [ ] `VITE_SUPABASE_URL` noted
- [ ] `VITE_SUPABASE_ANON_KEY` noted
- [ ] `SUPABASE_SERVICE_ROLE_KEY` noted (keep secret)
- [ ] `SUPABASE_PROJECT_REF` noted
- [ ] `SUPABASE_DB_PASSWORD` noted
- [ ] `SUPABASE_ACCESS_TOKEN` generated and noted

---

## Phase 2 — Local `.env` Files

### 2a. Web Admin Portal (root `.env`)

```bash
cp .env.example .env
```

- [ ] `VITE_SUPABASE_URL` set
- [ ] `VITE_SUPABASE_ANON_KEY` set
- [ ] `VITE_VAPID_PUBLIC_KEY` set (from Phase 0 key pair)
- [ ] `VITE_TURNSTILE_SITE_KEY` set (from Cloudflare Dashboard → Turnstile → Site Key) *(optional in dev)*
- [ ] `VITE_GOOGLE_MAPS_API_KEY` set *(optional; falls back to Nominatim)*
- [ ] `VITE_APP_VERSION` set (e.g. `1.0.0`)
- [ ] `VITE_PROXY_SERVER_URL` — leave blank until proxy deploys
- [ ] `VITE_INFERENCE_SERVICE_URL` — leave blank until Bob deploys
- [ ] `VITE_PTT_SERVER_URL` — leave blank until PTT server deploys

### 2b. Inference Service (`inference-service/.env`)

```bash
cp inference-service/.env.example inference-service/.env
```

- [ ] `INFERENCE_API_KEY` set (from Phase 0)
- [ ] `SUPABASE_URL` set
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set
- [ ] `CHAT_PROVIDER` set (`heuristic` for local dev; `ollama` with local Ollama)
- [ ] `OLLAMA_BASE_URL` set (`http://localhost:11434` for local dev)
- [ ] `INTEL_HMAC_KEY` set (from Phase 0)

### 2c. Proxy Server (`proxy-server/.env`)

```bash
cp proxy-server/.env.example proxy-server/.env
```

- [ ] `NZSCV_API_KEY` set (PGDB-Authorization header value)
- [ ] `NZSCV_ID_KEY` set (PGDB-Identifier header value)
- [ ] `NZSCV_ENDPOINT_URL` set (test or production NZSCV endpoint)
- [ ] `MOTORWEB_API_KEY` set *(optional)*
- [ ] `MOTORWEB_ID_KEY` set *(optional)*
- [ ] `PROXY_SECRET` set (same value as `PTT_PROXY_SECRET` from Phase 0)
- [ ] `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` set

### 2d. PTT Server (`ptt-server/.env`)

```bash
cp ptt-server/.env.example ptt-server/.env
```

- [ ] `PROXY_SECRET` set (same value as `PTT_PROXY_SECRET` from Phase 0)
- [ ] `PTT_JWT_SECRET` set (from Phase 0)
- [ ] `SUPABASE_URL` set
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set

### 2e. Mobile App (`mobile-app/.env`)

```bash
cp mobile-app/.env.example mobile-app/.env
```

- [ ] `EXPO_PUBLIC_SUPABASE_URL` set
- [ ] `EXPO_PUBLIC_SUPABASE_ANON_KEY` set

### 2f. Local Edge Function testing (`supabase/.env.functions.local`)

File already exists — fill in values for local `supabase functions serve` testing:

- [ ] `SUPABASE_SERVICE_ROLE_KEY` set
- [ ] `INFERENCE_SERVICE_URL` set (or leave blank for local Bob)
- [ ] `INFERENCE_API_KEY` set (from Phase 0)
- [ ] `PROXY_SERVER_URL` set (or leave blank for local proxy)
- [ ] `PTT_SERVER_URL` set *(optional in local dev)*
- [ ] `PTT_PROXY_SECRET` set (from Phase 0)
- [ ] `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` set (from Phase 0 key pair)
- [ ] `ALPR_API_TOKEN` set *(optional; needed for ALPR edge function testing)*
- [ ] `PARKPOW_API_TOKEN` set *(optional)*
- [ ] `OPENAI_API_KEY` set *(optional; needed for AI edge function testing)*
- [ ] `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` set *(optional; for email function testing)*

---

## Phase 3 — GitHub Actions Secrets

Navigate to: **GitHub → DonSquires/FreedomCamp-Manager → Settings → Secrets and variables → Actions**

### 3a. Core (always required)

- [ ] `VITE_SUPABASE_URL`
- [ ] `VITE_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_ACCESS_TOKEN`
- [ ] `SUPABASE_PROJECT_REF`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `SUPABASE_DB_PASSWORD`
- [ ] `INFERENCE_API_KEY` (from Phase 0)
- [ ] `VERCEL_TOKEN` (Vercel Dashboard → Settings → Tokens)
- [ ] `VERCEL_ORG_ID` (Vercel Dashboard → Settings → General → Team ID)
- [ ] `VERCEL_PROJECT_ID` (Vercel Dashboard → Project → Settings → General → Project ID)
- [ ] `BOB_SYNC_PAT` (GitHub PAT — fine-grained, Contents: Read+Write on `DonSquires/Bob`)

### 3b. Railway deploy tokens and service IDs (set after creating Railway services)

| Secret | Source |
|---|---|
| `RAILWAY_BOB_TOKEN` | Railway → Bob project → Settings → Tokens |
| `RAILWAY_BOB_SERVICE_ID` | Railway → Bob project → Bob service → Settings → Service ID |
| `RAILWAY_BOB_PROJECT_ID` | Railway → Bob project → Settings → General → Project ID |
| `RAILWAY_OLLAMA_SERVICE_ID` | Railway → Bob project → Ollama service → Settings → Service ID |
| `RAILWAY_TOKEN` | Railway → Core project → Settings → Tokens |
| `RAILWAY_PROXY_SERVICE_ID` | Railway → Core project → Proxy service → Settings → Service ID |
| `RAILWAY_PTT_TOKEN` | Same as `RAILWAY_TOKEN` (same Core project) |
| `RAILWAY_PTT_SERVICE_ID` | Railway → Core project → PTT service → Settings → Service ID |

- [ ] `RAILWAY_BOB_TOKEN`
- [ ] `RAILWAY_BOB_SERVICE_ID`
- [ ] `RAILWAY_BOB_PROJECT_ID`
- [ ] `RAILWAY_OLLAMA_SERVICE_ID`
- [ ] `RAILWAY_TOKEN`
- [ ] `RAILWAY_PROXY_SERVICE_ID`
- [ ] `RAILWAY_PTT_SERVICE_ID`

### 3c. Service URLs (set after first successful deploy of each service)

- [ ] `BOB_SERVICE_URL` (Bob's Railway public URL)
- [ ] `INFERENCE_SERVICE_URL` (same value as `BOB_SERVICE_URL`)
- [ ] `PROXY_SERVER_URL` (Proxy's Railway public URL)
- [ ] `PTT_SERVER_URL` (PTT server's Railway public URL)
- [ ] `OLLAMA_SERVICE_URL` (Ollama's Railway public URL)

### 3d. PTT

- [ ] `PTT_PROXY_SECRET` (from Phase 0; must match `PROXY_SECRET` on PTT Railway service)

### 3e. Frontend environment isolation (Vercel production / preview split)

- [ ] `VITE_SUPABASE_URL_PRODUCTION`
- [ ] `VITE_SUPABASE_ANON_KEY_PRODUCTION`
- [ ] `VITE_INFERENCE_SERVICE_URL_PRODUCTION`
- [ ] `VITE_PROXY_SERVER_URL_PRODUCTION`
- [ ] `VITE_SUPABASE_URL_PREVIEW` *(separate Supabase project for preview)*
- [ ] `VITE_SUPABASE_ANON_KEY_PREVIEW`
- [ ] `VITE_INFERENCE_SERVICE_URL_PREVIEW`
- [ ] `VITE_PROXY_SERVER_URL_PREVIEW`

### 3f. Mobile app (Expo / EAS)

- [ ] `EXPO_TOKEN` (expo.dev → Account → Settings → Access Tokens)
- [ ] `EXPO_PROJECT_ID` (expo.dev → Project → Settings → Project ID)
- [ ] `EXPO_PUBLIC_SUPABASE_URL`
- [ ] `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `ANDROID_KEYSTORE_BASE64` (run `ops-generate-keystore.yml` workflow, then base64-encode)
- [ ] `ANDROID_KEYSTORE_PASSWORD`
- [ ] `ANDROID_KEY_ALIAS` (default: `freedomcamp`)
- [ ] `ANDROID_KEY_PASSWORD`

### 3g. Intel feeds (optional)

- [ ] `INTEL_FEED_URLS` (comma-separated feed URLs)
- [ ] `INTEL_HMAC_KEY` (from Phase 0; strongly recommended)
- [ ] `INTEL_ALLOWED_HOSTS`
- [ ] `INTEL_ORGANIZATION_ID`
- [ ] `INTEL_REGION_ORG_MAP` (JSON: `{"nelson":["<uuid>"]}`)
- [ ] `INTEL_ENABLE_DB_SYNC` (`true` to write to Supabase)
- [ ] `INTEL_DRY_RUN` (`true` for test runs)

### 3h. Bob ops automation

- [ ] `BOB_FEEDBACK_SYNC_URL` (`https://<BOB_URL>/learn/ingest-feedback`)
- [ ] `BOB_FEEDBACK_SYNC_KEY` (same value as `INFERENCE_API_KEY`)

### 3i. Monitoring & testing

- [ ] `FRONTEND_URL` (production Vercel URL, e.g. `https://fcmanager.co.nz`)
- [ ] `SYNTHETIC_MONITOR_USER_ID` (Supabase user UUID for synthetic login)
- [ ] `STATSNZ_API_KEY` (stats.govt.nz API key, for `ops-import-maps.yml`)
- [ ] `API_TEST_BEARER_TOKEN` *(optional)*
- [ ] `API_TEST_EMAIL` *(optional)*
- [ ] `API_TEST_PASSWORD` *(optional)*

---

## Phase 4 — Supabase Edge Function Secrets

Navigate to: **Supabase Dashboard → Your Project → Project Settings → Edge Functions → Secrets**

After adding or changing any secret here, redeploy the affected Edge Functions.

### 4a. Service connections (critical)

- [ ] `INFERENCE_SERVICE_URL` (Bob's Railway URL)
- [ ] `INFERENCE_API_KEY` (from Phase 0; must match Railway Bob service var)
- [ ] `PROXY_SERVER_URL` (Proxy's Railway URL)
- [ ] `PTT_SERVER_URL` (PTT server's Railway URL)
- [ ] `PTT_PROXY_SECRET` (from Phase 0; must match Railway PTT `PROXY_SECRET`)

### 4b. Push-to-Talk

- [ ] `PTT_JWT_SECRET` (from Phase 0; must match Railway PTT service)

### 4c. ALPR / vehicle recognition

- [ ] `PLATERECOGNIZER_TOKEN` (platerecognizer.com → Account)
- [ ] `PARKPOW_API_TOKEN` (parkpow.com → Account → API) *(optional)*

### 4d. AI providers (optional; blocked in strict self-contained mode)

- [ ] `OPENAI_API_KEY` *(optional)*
- [ ] `OPENAI_BASE_URL` *(optional; leave blank for OpenAI default)*
- [ ] `OPENAI_MODEL` *(optional; e.g. `gpt-4o-mini`)*

### 4e. Web push notifications (VAPID)

- [ ] `VAPID_PUBLIC_KEY` (from Phase 0 key pair)
- [ ] `VAPID_PRIVATE_KEY` (from Phase 0 key pair — **never expose to browser**)
- [ ] `VAPID_SUBJECT` (`mailto:admin@fcmanager.co.nz` or your domain)

### 4f. Email (SMTP from Edge Functions)

- [ ] `SMTP_HOST`
- [ ] `SMTP_PORT` (default: `465`)
- [ ] `SMTP_USERNAME`
- [ ] `SMTP_PASSWORD`
- [ ] `SMTP_FROM_EMAIL` (must match `SMTP_USERNAME`)
- [ ] `SMTP_FROM_NAME` (default: `FieldOps Manager`)

### 4g. Security / CAPTCHA

- [ ] `TURNSTILE_SECRET_KEY` (Cloudflare Dashboard → Turnstile → Secret Key)

> Also set `VITE_TURNSTILE_SITE_KEY` in the frontend `.env` and in Vercel project
> environment variables (this is the **public** site key, safe to expose in the browser).

### 4h. Bob ops

- [ ] `BOB_FEEDBACK_SYNC_KEY` (same value as `INFERENCE_API_KEY`)

### 4i. SMS (optional — Twilio)

- [ ] `SMS_PROVIDER` (`twilio`)
- [ ] `SMS_ACCOUNT_SID`
- [ ] `SMS_AUTH_TOKEN`
- [ ] `SMS_FROM_NUMBER` (e.g. `+6421...`)

### 4j. Feature flags (optional)

- [ ] `ENVIRONMENT` (`production`)
- [ ] `DEV_CORS` (`false` or omit; auto-disabled when `ENVIRONMENT=production`)
- [ ] `ENABLE_FACE_RECOGNITION` (`true` / `false`)
- [ ] `ENABLE_ALPR` (`true` / `false`)
- [ ] `ENABLE_PTT` (`true` / `false`)

---

## Phase 5 — Railway Service Environment Variables

### 5a. Bob Inference Service (Railway: Bob project → `bob` service)

- [ ] `INFERENCE_API_KEY` (from Phase 0; must match Supabase vault + GitHub Actions)
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `SUPABASE_URL`
- [ ] `OLLAMA_BASE_URL` = `http://ollama.railway.internal:11434`
- [ ] `OLLAMA_MODEL` = `llama3.1:8b`
- [ ] `CHAT_PROVIDER` = `ollama`
- [ ] `TABULAR_NLP_PROVIDER` = `ollama`
- [ ] `INTEL_HMAC_KEY` (from Phase 0; must match GitHub Actions)
- [ ] `SELF_CONTAINED_MODE` = `true`
- [ ] `REQUIRE_SELF_CONTAINED_MODE` = `true`
- [ ] `SELF_CONTAINED_STRICT_EGRESS` = `true`
- [ ] `NODE_ENV` = `production`

### 5b. Ollama LLM Service (Railway: Bob project → `ollama` service)

- [ ] `OLLAMA_MODEL` = `llama3.1:8b`
- [ ] `OLLAMA_KEEP_ALIVE` = `24h`
- [ ] `OLLAMA_NO_CLOUD` = `true`
- [ ] `OLLAMA_ORIGINS` = `*`
- [ ] `OLLAMA_HOST` = `0.0.0.0:11434`

> ⚠️  Bob and Ollama **must be in the same Railway project** for `*.railway.internal` private
> networking to work.  `SELF_CONTAINED_STRICT_EGRESS=true` blocks public-internet fallback.

### 5c. Proxy Server (Railway: Core project → `proxy` service)

- [ ] `PROXY_SECRET` (same value as `PTT_PROXY_SECRET` from Phase 0)
- [ ] `NZSCV_API_KEY` (PGDB-Authorization header value)
- [ ] `NZSCV_ID_KEY` (PGDB-Identifier header value)
- [ ] `NZSCV_ENDPOINT_URL` = `https://www.nzscv.co.nz/api/rest/scv/v1/vehicleregistrationinfo`
- [ ] `MOTORWEB_API_KEY` *(optional)*
- [ ] `MOTORWEB_ID_KEY` *(optional)*
- [ ] `MOTORWEB_BASE_URL` = `https://robot.motorweb.co.nz` *(optional)*
- [ ] `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`
- [ ] `SMTP_FROM_NAME` = `FieldOps Manager`
- [ ] `SITE_URL` = `https://fcmanager.co.nz`
- [ ] `NODE_ENV` = `production`

### 5d. PTT Signaling Server (Railway: Core project → `ptt` service)

- [ ] `PROXY_SECRET` (same value as `PTT_PROXY_SECRET` from Phase 0)
- [ ] `PTT_JWT_SECRET` (from Phase 0; must match Supabase vault)
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `NODE_ENV` = `production`
- [ ] `MAX_PARTICIPANTS_PER_CHANNEL` = `50` *(optional)*
- [ ] `TURN_URL` *(optional — TURN server URL for NAT traversal)*
- [ ] `TURN_USERNAME` *(optional)*
- [ ] `TURN_CREDENTIAL` *(optional)*

---

## Phase 6 — Cross-Service Synchronisation Verification

These secrets **must have identical values** across multiple locations.
Verify before testing end-to-end:

| Secret | GitHub Actions | Supabase Vault | Railway: Bob | Railway: PTT |
|---|:---:|:---:|:---:|:---:|
| `INFERENCE_API_KEY` | ✅ | ✅ | ✅ | — |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | auto-injected | ✅ | ✅ |
| `PTT_PROXY_SECRET` / `PROXY_SECRET` | ✅ (`PTT_PROXY_SECRET`) | ✅ (`PTT_PROXY_SECRET`) | — | ✅ (`PROXY_SECRET`) |
| `PTT_JWT_SECRET` | — | ✅ | — | ✅ |
| `INTEL_HMAC_KEY` | ✅ | — | ✅ | — |

- [ ] `INFERENCE_API_KEY` matches in GitHub Actions, Supabase vault, and Railway Bob service vars
- [ ] `PTT_PROXY_SECRET` (Supabase vault) = `PROXY_SECRET` (Railway PTT service)
- [ ] `PTT_JWT_SECRET` matches in Supabase vault and Railway PTT service
- [ ] `INTEL_HMAC_KEY` matches in GitHub Actions and Railway Bob service vars

---

## Phase 7 — Post-Deploy Wiring

Run these steps after the first successful Railway deploy of each service:

### 7a. Copy Railway public URLs into GitHub Actions secrets (Phase 3c)

- [ ] `BOB_SERVICE_URL` + `INFERENCE_SERVICE_URL` set to Bob's Railway URL
- [ ] `PROXY_SERVER_URL` set to Proxy's Railway URL
- [ ] `PTT_SERVER_URL` set to PTT server's Railway URL
- [ ] `OLLAMA_SERVICE_URL` set to Ollama's Railway URL

### 7b. Run the PTT wiring workflow

- [ ] Run `.github/workflows/set-ptt-secret.yml` — this reads `PTT_SERVER_URL`,
  `PTT_PROXY_SECRET`, and `INFERENCE_SERVICE_URL` from GitHub secrets and writes
  them into Supabase vault automatically.

### 7c. Seed Bob's self-learning state

- [ ] Run `ops-bob-pretrain-on-push.yml` workflow (or via Actions manual dispatch)
  which calls `POST /learn/pretrain profile=nz-enforcement-v1 multiplier=12`

### 7d. Redeploy Edge Functions

After completing Phases 4 and 7b:

- [ ] Run `.github/workflows/deploy-edge-functions.yml` → mode: `deploy+verify`
  to redeploy all functions with the now-complete secrets.

### 7e. Verify end-to-end

- [ ] Run `.github/workflows/synthetic-monitor.yml` to validate the full stack.
- [ ] Bob health check passes: `GET <BOB_URL>/health` → `{"status":"ok","capabilities":{"chat_local_ollama_enabled":true}}`
- [ ] Proxy health check passes: `GET <PROXY_URL>/health` → `{"status":"ok"}`
- [ ] PTT server health check passes: `GET <PTT_URL>/health` → `{"status":"ok"}`

---

## Android Keystore (one-off, for mobile build)

1. Run `.github/workflows/ops-generate-keystore.yml` with a secure `keystore_password`
2. Download the artifact (available for 1 day)
3. Base64-encode the keystore: `base64 android.keystore | tr -d '\n'`
4. Add as GitHub Actions secrets:
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS` (default: `freedomcamp`)
   - `ANDROID_KEY_PASSWORD`
5. Delete the artifact from GitHub immediately after saving the keystore securely offline

---

## Security Best Practices

1. **Never commit `.env` files** — only `.env.example` files are tracked
2. **Use separate values per environment** — never reuse production keys in dev/staging
3. **Separate preview and production backends** — the deploy-frontend workflow enforces this
4. **Rotate keys after team member changes** — especially `INFERENCE_API_KEY` and `PTT_PROXY_SECRET`
5. **Back up Bob's state files** — `data/self-learning-state.json` and `data/intel-state.json`
   are lost on Railway redeploy unless Railway Volumes are configured
6. **Enable `SELF_CONTAINED_STRICT_EGRESS=true`** — required for production Bob deployments;
   Edge Functions must use `INFERENCE_API_KEY` (not user JWTs) to authenticate to Bob
