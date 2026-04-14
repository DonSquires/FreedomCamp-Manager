# Secrets Registry

**Single source of truth for every secret, variable, and API key used in FieldOps Manager.**

Secrets live in exactly one of three places:

| Location | Use case |
|---|---|
| **GitHub Actions Secrets** (`Settings → Secrets and variables → Actions`) | CI/CD deploy tokens, workflow credentials |
| **Supabase Edge Function Secrets** (Supabase Dashboard → Project Settings → Edge Functions → Secrets) | Runtime config available to all Edge Functions |
| **Railway Service Environment Variables** (Railway Dashboard → Service → Variables) | Runtime config per Railway service (Bob, Ollama, Proxy, PTT) |

> **Rule:** A secret belongs in exactly the place(s) listed in this document.
> Never store Railway tokens in Supabase. Never store Supabase service role keys in GitHub plain variables.
> Always use the **canonical name** listed here; aliases are accepted by fallback logic but should not be the names you configure.

---

## Table of Contents

1. [Minimum Required Secrets (start here)](#minimum-required-secrets)
2. [GitHub Actions Secrets](#github-actions-secrets)
3. [Supabase Edge Function Secrets](#supabase-edge-function-secrets)
4. [Railway Service Environment Variables](#railway-service-environment-variables)
5. [Alias / Fallback Map](#alias--fallback-map)
6. [Secrets Checklist](#secrets-checklist)

---

## Minimum Required Secrets

The absolute minimum to get the system running. Every item must be set before any deploy or ops workflow will succeed.

### Step 1 — GitHub Actions

| Secret | Where to get it | Notes |
|---|---|---|
| `RAILWAY_BOB_TOKEN` | Railway → Bob project → Settings → Tokens | Deploys Bob + Ollama |
| `RAILWAY_BOB_SERVICE_ID` | Railway → Bob project → Bob service → Settings → Service ID | |
| `RAILWAY_OLLAMA_SERVICE_ID` | Railway → Bob project → Ollama service → Settings → Service ID | |
| `RAILWAY_TOKEN` | Railway → Core project → Settings → Tokens | Deploys Proxy + PTT |
| `RAILWAY_PROXY_SERVICE_ID` | Railway → Core project → Proxy service → Settings → Service ID | |
| `VITE_SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL | |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → Project API Keys → anon/public | |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens | Needed for CLI + Edge Function deploy |
| `SUPABASE_PROJECT_REF` | Supabase Dashboard → Settings → General → Reference ID | e.g. `kxwjcupuxnnbnzcgmkoi` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → service_role key | **Never expose in browser** |
| `SUPABASE_DB_PASSWORD` | Supabase Dashboard → Settings → Database → Database Password | Needed for `db-push` |
| `INFERENCE_API_KEY` | Generate: `openssl rand -hex 32` | Shared secret between Bob + Edge Functions |
| `VERCEL_TOKEN` | Vercel Dashboard → Settings → Tokens | Frontend deploys |
| `VERCEL_ORG_ID` | Vercel Dashboard → Settings → General → Team ID | |
| `VERCEL_PROJECT_ID` | Vercel Dashboard → Project → Settings → General → Project ID | |
| `BOB_SYNC_PAT` | GitHub → Settings → Developer settings → PATs | Contents: Read+Write on `DonSquires/Bob` |
| `BOB_SERVICE_URL` | Set after first Bob deploy | Bob's public Railway URL; enables post-deploy health checks |
| `PROXY_SERVER_URL` | Set after first Proxy deploy | Proxy's public Railway URL |
| `PTT_SERVER_URL` | Set after first PTT deploy | PTT server's public Railway URL |

### Step 2 — Supabase Edge Function Secrets

| Secret | Value |
|---|---|
| `INFERENCE_SERVICE_URL` | Same as `BOB_SERVICE_URL` (Bob's public Railway URL) |
| `INFERENCE_API_KEY` | Same value as the GitHub Actions secret `INFERENCE_API_KEY` |
| `PROXY_SERVER_URL` | Same as GitHub Actions `PROXY_SERVER_URL` |
| `PTT_SERVER_URL` | Same as GitHub Actions `PTT_SERVER_URL` |
| `PTT_PROXY_SECRET` | Generate: `openssl rand -hex 32` — also set as `PROXY_SECRET` on the PTT Railway service |

### Step 3 — Railway: Bob service

| Variable | Value |
|---|---|
| `INFERENCE_API_KEY` | Same as GitHub Actions `INFERENCE_API_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as GitHub Actions `SUPABASE_SERVICE_ROLE_KEY` |
| `OLLAMA_BASE_URL` | `http://ollama.railway.internal:11434` |
| `OLLAMA_MODEL` | `llama3.1:8b` |
| `CHAT_PROVIDER` | `ollama` |
| `TABULAR_NLP_PROVIDER` | `ollama` |

### Step 4 — Railway: Proxy service

| Variable | Value |
|---|---|
| `PROXY_SECRET` | A strong random string — set this same value as the Supabase Edge Function secret `NZSCV_PROXY_SECRET` |
| `NZSCV_API_KEY` | NZSCV PGDB-Authorization header value (from PGDB account) |
| `NZSCV_ID_KEY` | NZSCV PGDB-Identifier header value (from PGDB account) |
| `NZSCV_ENDPOINT_URL` | `https://www.nzscv.co.nz/api/rest/scv/v1/vehicleregistrationinfo` (production) |

---

## GitHub Actions Secrets

Set at: **DonSquires/FreedomCamp-Manager → Settings → Secrets and variables → Actions**

### Railway Deploy Tokens

| Secret | Canonical | Accepted Aliases | Required For | Notes |
|---|---|---|---|---|
| `RAILWAY_BOB_TOKEN` | ✅ | `RAILWAY_TOKEN_BOB` (deprecated) | Bob + Ollama deploy | Bob Railway project token |
| `RAILWAY_TOKEN` | ✅ | `RAILWAY_CORE_TOKEN` (deprecated) | Proxy + PTT + legacy inference deploy | Core Railway project token |

Alias resolution is handled by `scripts/load-railway-secrets-from-github-env.sh`. Always configure the canonical name.

### Railway Service IDs

| Secret | Canonical | Required For | Notes |
|---|---|---|---|
| `RAILWAY_BOB_SERVICE_ID` | ✅ | `deploy-bob-railway.yml` | Bob inference service ID |
| `RAILWAY_BOB_PROJECT_ID` | ✅ | `deploy-bob-railway.yml` | Used for service auto-resolution when SERVICE_ID is missing |
| `RAILWAY_OLLAMA_SERVICE_ID` | ✅ | `deploy-ollama-railway.yml` | Ollama service ID |
| `RAILWAY_PROXY_SERVICE_ID` | ✅ | `deploy-proxy-railway.yml` | Proxy service ID |
| `RAILWAY_INFERENCE_SERVICE_ID` | ✅ | `deploy-railway.yml` (legacy core) | Legacy inference-in-core-project deploy |

> **Deprecated aliases** — never configure these directly; they exist only as backwards-compat fallbacks:
> - `RAILWAY_SERVICE_ID` → normalised to `RAILWAY_BOB_SERVICE_ID`
> - `RAILWAY_PROJECT_ID` → normalised to `RAILWAY_BOB_PROJECT_ID`
> - `RAILWAY_BOB_SERVICE_NAME` → name-based fallback if ID resolution fails

### Service URLs (Post-Deploy Health Checks + Wiring Audit)

| Secret | Canonical | Accepted Aliases | Used By | Notes |
|---|---|---|---|---|
| `BOB_SERVICE_URL` | ✅ | `INFERENCE_SERVICE_URL` | Bob deploy + all Bob ops workflows | Bob's public Railway URL |
| `INFERENCE_SERVICE_URL` | ✅ | `BOB_SERVICE_URL` | Ops workflows, wiring audit | Same value as `BOB_SERVICE_URL` |
| `PROXY_SERVER_URL` | ✅ | `PROXY_SERVICE_URL`, `NZSCV_PROXY_URL` (deprecated) | Proxy deploy, wiring audit | Proxy public Railway URL |
| `PTT_SERVER_URL` | ✅ | `PTT_SERVICE_URL` (deprecated) | PTT health check, wiring audit, `set-ptt-secret.yml` | PTT public Railway URL |
| `OLLAMA_SERVICE_URL` | ✅ | — | Ollama post-deploy health check | Ollama public Railway URL |

Both `BOB_SERVICE_URL` and `INFERENCE_SERVICE_URL` should contain the same value (Bob's URL). The normalisation script maps each as a fallback for the other.

### Bob Auth Key

| Secret | Canonical | Accepted Aliases | Required For | Notes |
|---|---|---|---|---|
| `INFERENCE_API_KEY` | ✅ | `BOB_INFERENCE_API_KEY` (deprecated) | All Bob ops workflows | Must match Bob Railway service var + Supabase vault |

Configure `INFERENCE_API_KEY` only. `BOB_INFERENCE_API_KEY` is accepted as an alias but is deprecated.

### Supabase

| Secret | Required | Used By | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Frontend deploy, bug escalator, triage, synthetic monitor | Project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Frontend deploy, build crossover gates, synthetic monitor | `anon` (public) key — safe for browser |
| `SUPABASE_ACCESS_TOKEN` | ✅ | `deploy-edge-functions.yml`, `db-push.yml`, `db-migration-check.yml`, `set-ptt-secret.yml` | Supabase CLI / Management API personal access token |
| `SUPABASE_PROJECT_REF` | ✅ | DB workflows, Edge Function deploy, `set-ptt-secret.yml` | Project reference ID (e.g. `kxwjcupuxnnbnzcgmkoi`) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Ops workflows that write to DB directly | **Never expose in browser or logs** |
| `SUPABASE_URL` | ⚠️ Alias | Some ops workflows (`ops-geofence-review.yml`, `ops-import-maps.yml`, etc.) | Normalised to `VITE_SUPABASE_URL` by the load script |
| `SUPABASE_DB_PASSWORD` | Required for DB ops | `db-push.yml`, `db-migration-check.yml`, `db-run-migrations.yml`, `db-schema-extract.yml` | PostgreSQL password |
| `SUPABASE_DB_URL` | Optional | `db-push.yml` | Full direct DB URL (alternative to host+password) |
| `SUPABASE_DB_POOLER_HOST` | Optional | `db-push.yml` | Connection pooler host |
| `SUPABASE_DB_USER` | Optional | `db-push.yml` | DB user |
| `SUPABASEV2_SERVICE_ROLE_KEY` | Only for data migration | `ops-data-migration.yml` | Second/target Supabase project service role key |
| `SUPABASE_DB_PASSWORD_SOURCE` | Only for DB migration | `ops-migrate-db.yml` | Source PostgreSQL password |
| `SUPABASE_DB_PASSWORD_TARGET` | Only for DB migration | `ops-migrate-db.yml` | Target PostgreSQL password |

### Frontend (Vercel)

| Secret | Required | Notes |
|---|---|---|
| `VERCEL_TOKEN` | ✅ | Vercel account token |
| `VERCEL_ORG_ID` | ✅ | Vercel team/org ID |
| `VERCEL_PROJECT_ID` | ✅ | Vercel project ID |
| `VITE_SUPABASE_URL_PRODUCTION` | Recommended | Production-environment Supabase URL |
| `VITE_SUPABASE_ANON_KEY_PRODUCTION` | Recommended | Production anon key |
| `VITE_INFERENCE_SERVICE_URL_PRODUCTION` | Recommended | Production Bob URL |
| `VITE_PROXY_SERVER_URL_PRODUCTION` | Recommended | Production Proxy URL |
| `VITE_SUPABASE_URL_PREVIEW` | Recommended | Preview-environment Supabase URL |
| `VITE_SUPABASE_ANON_KEY_PREVIEW` | Recommended | Preview anon key |
| `VITE_INFERENCE_SERVICE_URL_PREVIEW` | Recommended | Preview Bob URL |
| `VITE_PROXY_SERVER_URL_PREVIEW` | Recommended | Preview Proxy URL |

The `deploy-frontend.yml` workflow blocks preview deployments that use production backend URLs.

### Bob Sync + Intelligence Feeds

| Secret | Required | Used By | Notes |
|---|---|---|---|
| `BOB_SYNC_PAT` | ✅ | `sync-bob-repo.yml` | GitHub PAT (classic or fine-grained) with `Contents: Read+Write` on `DonSquires/Bob` |
| `INTEL_FEED_URLS` | Required for intel sync | `ops-intel-feed-sync.yml` | Comma or newline-separated feed URLs to harvest |
| `INTEL_HMAC_KEY` | ⚠️ Strongly recommended | `ops-intel-feed-sync.yml` | HMAC key for bulletin signing (`openssl rand -hex 32`). If absent, bulletin signature verification is disabled on Bob |
| `INTEL_INGEST_URL` | Optional | `ops-intel-feed-sync.yml` | Derived from `BOB_SERVICE_URL` if not set |
| `INTEL_ALLOWED_HOSTS` | Optional | `ops-intel-feed-sync.yml` | Comma-separated allowlist of feed hostnames |
| `INTEL_ORGANIZATION_ID` | Optional | `ops-intel-feed-sync.yml` | Org UUID for DB sync targeting |
| `INTEL_DB_TABLE` | Optional | `ops-intel-feed-sync.yml` | Default: `external_intel_bulletins` |
| `INTEL_REGION_ORG_MAP` | Optional | `ops-intel-feed-sync.yml` | JSON: `{"nelson":["<uuid>"],"tasman":["<uuid>"]}` |
| `INTEL_ENABLE_DB_SYNC` | Optional | `ops-intel-feed-sync.yml` | `true` to write bulletins to Supabase DB |
| `INTEL_DRY_RUN` | Optional | `ops-intel-feed-sync.yml` | `true` to test without ingesting |

### Bob Ops Automation

| Secret | Required | Used By | Notes |
|---|---|---|---|
| `BOB_FEEDBACK_SYNC_URL` | Required for feedback | `ops-bob-feedback-sync.yml` | Full URL to Bob's `/learn/ingest-feedback` endpoint |
| `BOB_FEEDBACK_SYNC_KEY` | Required for feedback | `ops-bob-feedback-sync.yml`, Edge Function `bob-learning-feedback-sync` | Auth key for feedback endpoint (same as `INFERENCE_API_KEY`) |

### PTT

| Secret | Required | Used By | Notes |
|---|---|---|---|
| `PTT_PROXY_SECRET` | Required for PTT | `set-ptt-secret.yml` | Written to Supabase vault as the PTT auth secret |

### Mobile (Expo / EAS)

| Secret | Required | Notes |
|---|---|---|
| `EXPO_TOKEN` | ✅ | EAS build + OTA update auth token |
| `EXPO_PROJECT_ID` | ✅ | EAS project UUID |
| `EXPO_PUBLIC_SUPABASE_URL` | ✅ | Supabase URL for mobile app |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key for mobile app |
| `ANDROID_KEYSTORE_BASE64` | Required for Android | Base64-encoded `.jks` keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | Required for Android | Keystore store password |
| `ANDROID_KEY_ALIAS` | Required for Android | Key alias inside keystore |
| `ANDROID_KEY_PASSWORD` | Required for Android | Key password |

### Monitoring + Testing

| Secret | Required | Used By | Notes |
|---|---|---|---|
| `FRONTEND_URL` | Required for monitor | `synthetic-monitor.yml` | Production frontend URL |
| `SYNTHETIC_MONITOR_USER_ID` | Required for monitor | `synthetic-monitor.yml` | Supabase user ID for synthetic login |
| `STATSNZ_API_KEY` | Required for map import | `ops-import-maps.yml` | Stats NZ API key |
| `API_TEST_BEARER_TOKEN` | Optional | `build-plan-crossover-gates.yml` | Bearer token for API integration tests |
| `API_TEST_EMAIL` | Optional | `build-plan-crossover-gates.yml` | Test user email |
| `API_TEST_PASSWORD` | Optional | `build-plan-crossover-gates.yml` | Test user password |

---

## Supabase Edge Function Secrets

Set at: **Supabase Dashboard → Project Settings → Edge Functions → Secrets**

These are available as `Deno.env.get('SECRET_NAME')` inside all Edge Functions. After adding or changing a secret, redeploy affected Edge Functions for the change to take effect.

### Service Connection

| Secret | Canonical | Aliases Accepted | Required | Notes |
|---|---|---|---|---|
| `INFERENCE_SERVICE_URL` | ✅ | — | For AI features | Bob's public Railway URL |
| `INFERENCE_API_KEY` | ✅ | — | Recommended | Auth header sent to Bob; must match Bob Railway service var |
| `PROXY_SERVER_URL` | ✅ | `NZSCV_PROXY_URL`, `RAILWAY_PROXY_URL`, `PROXY_BASE_URL` (deprecated) | For vehicle lookup | Proxy public Railway URL |
| `PTT_SERVER_URL` | ✅ | — | For PTT | PTT server public Railway URL |
| `PTT_PROXY_SECRET` | ✅ | `PROXY_SECRET`, `PROXY_SERVER_SECRET`, `NZSCV_PROXY_SECRET` | For PTT | Shared secret for ptt-signaling-token Edge Function; must match PTT server `PROXY_SECRET` |

> **PTT secret resolution order:** `ptt-signaling-token` checks `PTT_PROXY_SECRET` → `PROXY_SECRET` → `PROXY_SERVER_SECRET` → `NZSCV_PROXY_SECRET`. Set `PTT_PROXY_SECRET` in Supabase vault and `PROXY_SECRET` on the PTT Railway service.

### Bob Feedback Sync

| Secret | Required | Notes |
|---|---|---|
| `BOB_FEEDBACK_SYNC_KEY` | Required for feedback sync | Auth key for `bob-learning-feedback-sync` Edge Function; same value as GitHub Actions `BOB_FEEDBACK_SYNC_KEY` |

### ALPR (Automatic License Plate Recognition)

| Secret | Required | Notes |
|---|---|---|
| `PARKPOW_API_TOKEN` | For ParkPow ALPR | ParkPow API token |
| `PLATERECOGNIZER_TOKEN` | For Plate Recognizer | Plate Recognizer API token; also accepted as `PLATE_RECOGNIZER_TOKEN` |

### AI Providers (optional in self-contained mode)

| Secret | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Optional | OpenAI API key — blocked by `SELF_CONTAINED_STRICT_EGRESS` on Bob |
| `OPENAI_BASE_URL` | Optional | Default: `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Optional | Default: `gpt-4o-mini` |
| `OLLAMA_BASE_URL` | Optional | Direct Ollama URL for Edge Function fallback path |
| `OLLAMA_MODEL` | Optional | Model override for Edge Function Ollama path |
| `OLLAMA_API_KEY` | Optional | API key for remote Ollama instances (if secured) |

### Push Notifications

| Secret | Required | Notes |
|---|---|---|
| `VAPID_PRIVATE_KEY` | Required for web push | VAPID private key |
| `VAPID_PUBLIC_KEY` | Required for web push | VAPID public key |
| `VAPID_SUBJECT` | Required for web push | `mailto:admin@domain.com` or a URL |

### SMS

| Secret | Required | Notes |
|---|---|---|
| `SMS_PROVIDER` | Optional | `twilio` or other |
| `SMS_ACCOUNT_SID` | Required for SMS | Twilio account SID |
| `SMS_AUTH_TOKEN` | Required for SMS | Twilio auth token |
| `SMS_FROM_NUMBER` | Required for SMS | Twilio from number |

### Email (from Edge Functions)

| Secret | Required | Notes |
|---|---|---|
| `SMTP_HOST` | Required for email | e.g. `smtp.zoho.com` |
| `SMTP_PORT` | Optional | Default: `465` |
| `SMTP_USERNAME` | Required for email | Full mailbox email address |
| `SMTP_PASSWORD` | Required for email | App-specific password |
| `SMTP_FROM_EMAIL` | Required for email | Must match `SMTP_USERNAME` for reliable delivery |
| `SMTP_FROM_NAME` | Optional | Default: `FieldOps Manager` |

### Security + Feature Flags

| Secret | Required | Notes |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Required for CAPTCHA in production | Cloudflare Turnstile secret key |
| `DEV_CORS` | Optional | `true` enables wildcard CORS — automatically disabled when `ENVIRONMENT=production` |
| `ENVIRONMENT` | Optional | `development`, `staging`, or `production` |

### Monitoring (internal)

| Secret | Required | Notes |
|---|---|---|
| `SNAPSHOT_LOGIN_EMAIL` | Optional | Synthetic monitor login email |
| `SNAPSHOT_LOGIN_PASSWORD` | Optional | Synthetic monitor password |

---

## Railway Service Environment Variables

Set at: **Railway Dashboard → [Project] → [Service] → Variables**

### Bob Inference Service (`inference-service/`)

Railway project: **Bob** | Internal URL: `http://bob.railway.internal:3000`

| Variable | Required | Value / Notes |
|---|---|---|
| `PORT` | Auto-set by Railway | Do not override; Railway injects this |
| `INFERENCE_API_KEY` | ✅ Required | Same value as GitHub Actions `INFERENCE_API_KEY` and Supabase vault `INFERENCE_API_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Required | Supabase service role key — used for JWT verification fallback |
| `SUPABASE_URL` | Recommended | Supabase project URL (enables JWKS verification) |
| `SUPABASE_JWKS_URL` | Optional | Default: derived from `SUPABASE_URL`; `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_ISSUER` | Optional | Default: derived from `SUPABASE_URL`; `https://<ref>.supabase.co/auth/v1` |
| `OLLAMA_BASE_URL` | ✅ Required | **Must be** `http://ollama.railway.internal:11434` |
| `OLLAMA_MODEL` | Recommended | `llama3.1:8b` (must match model pulled by Ollama service) |
| `CHAT_PROVIDER` | ✅ Required | `ollama` |
| `TABULAR_NLP_PROVIDER` | Recommended | `ollama` |
| `INTEL_HMAC_KEY` | ⚠️ Strongly recommended | HMAC key for intel bulletin verification; same as GitHub Actions `INTEL_HMAC_KEY` |
| `SELF_CONTAINED_MODE` | Do not change | Hard-coded `true` in source; setting this to `false` will be rejected |
| `SELF_CONTAINED_STRICT_EGRESS` | Do not change | Hard-coded `true`; blocks all non-local outbound calls |
| `SELF_HEALING_ENABLED` | Optional | `true` (default) |
| `SELF_LEARNING_ENABLED` | Optional | `true` (default) |
| `INTEL_STATE_PATH` | Optional | Default: `./data/intel-state.json` |
| `SELF_LEARNING_STATE_PATH` | Optional | Default: `./data/self-learning-state.json` |

> **⚠️ Auth limitation in strict mode:** When `SELF_CONTAINED_STRICT_EGRESS=true`, user JWT verification via JWKS is disabled because it requires an outbound network call. Edge Functions **must** authenticate using `INFERENCE_API_KEY` (or `SUPABASE_SERVICE_ROLE_KEY` in `x-inference-api-key` header). User JWTs are not accepted by Bob in production.

> **⚠️ State persistence:** Bob writes learned state to the container filesystem (`data/*.json`). Railway's ephemeral filesystem means state is lost on redeploy. Back up `data/self-learning-state.json` and `data/intel-state.json` periodically using Railway volumes or set `SELF_LEARNING_PERSIST_URL` / `INTEL_STATE_PERSIST_URL` to Supabase Storage presigned URLs (opt-in feature).

### Ollama LLM Service (`ollama/`)

Railway project: **Bob** (same project as Bob service) | Internal URL: `http://ollama.railway.internal:11434`

| Variable | Required | Value / Notes |
|---|---|---|
| `OLLAMA_HOST` | ✅ Required | `0.0.0.0:11434` (baked into Dockerfile; override here if port changes) |
| `OLLAMA_MODEL` | ✅ Required | `llama3.1:8b` — controls which model `start.sh` pre-pulls on deploy |
| `OLLAMA_KEEP_ALIVE` | Recommended | `24h` — keeps model loaded in RAM between requests |
| `OLLAMA_NO_CLOUD` | ✅ Required | `true` — disables Ollama cloud telemetry |
| `OLLAMA_ORIGINS` | Required | `*` — allows requests from Bob's internal IP |

> **Networking:** Ollama and Bob **must be in the same Railway project** for private networking (`*.railway.internal`) to work. Putting them in separate projects requires going via the public internet, which is blocked by `SELF_CONTAINED_STRICT_EGRESS`.

> **Cold start:** The `start.sh` entrypoint pre-pulls `OLLAMA_MODEL` on first boot. Railway `healthcheckTimeout` is set to 300 s to accommodate the initial ~4.7 GB download. Subsequent restarts skip the pull if the model is already cached.

### Proxy Server (`proxy-server/`)

Railway project: **Core** | Internal URL: `http://proxy.railway.internal:3000`

| Variable | Required | Value / Notes |
|---|---|---|
| `PORT` | Auto-set by Railway | |
| `PROXY_SECRET` | ✅ Required | Shared secret — must match Supabase vault `NZSCV_PROXY_SECRET` / `PROXY_SECRET` / `PTT_PROXY_SECRET` |
| `NZSCV_API_KEY` | ✅ Required | PGDB-Authorization header value for NZSCV API |
| `NZSCV_ID_KEY` | ✅ Required | PGDB-Identifier header value for NZSCV API |
| `NZSCV_ENDPOINT_URL` | ✅ Required | `https://www.nzscv.co.nz/api/rest/scv/v1/vehicleregistrationinfo` (production) |
| `MOTORWEB_API_KEY` | Required for MotorWeb | MotorWeb API key |
| `MOTORWEB_ID_KEY` | Required for MotorWeb | MotorWeb identifier |
| `MOTORWEB_BASE_URL` | Optional | Default: `https://robot.motorweb.co.nz` |
| `SMTP_HOST` | Required for invite email | e.g. `smtp.zoho.com` |
| `SMTP_PORT` | Optional | Default: `465` |
| `SMTP_USERNAME` | Required for invite email | Full mailbox email address |
| `SMTP_PASSWORD` | Required for invite email | App-specific password |
| `SMTP_FROM_EMAIL` | Required for invite email | Must match `SMTP_USERNAME` |
| `SMTP_FROM_NAME` | Optional | Default: `FieldOps Manager` |
| `SITE_URL` | Optional | Default: `https://fcmanager.co.nz` |
| `NODE_ENV` | Recommended | `production` |

### PTT Signaling Server (`ptt-server/`)

Railway project: **Core** | Internal URL: `http://ptt.railway.internal:3002`

| Variable | Required | Value / Notes |
|---|---|---|
| `PORT` | Auto-set by Railway | |
| `PROXY_SECRET` | ✅ Required | Shared secret — must match Supabase vault `PTT_PROXY_SECRET` |
| `PTT_JWT_SECRET` | ✅ Required | JWT signing secret for PTT channel tokens — generate with `openssl rand -hex 32` |
| `SUPABASE_URL` | ✅ Required | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Required | For channel auth verification |
| `NODE_ENV` | Recommended | `production` |
| `MAX_PARTICIPANTS_PER_CHANNEL` | Optional | Default: `50` |
| `MAX_CLIP_DURATION_SECONDS` | Optional | Default: `30` |
| `TURN_URL` | Optional | TURN server URL for NAT traversal |
| `TURN_USERNAME` | Optional | TURN username |
| `TURN_CREDENTIAL` | Optional | TURN credential |

---

## Alias / Fallback Map

This table documents every alias accepted by `scripts/load-railway-secrets-from-github-env.sh` and individual workflows. Always configure the **canonical** name; aliases exist for backwards-compatibility only.

| Canonical Secret | Accepted Aliases (deprecated) | Resolution |
|---|---|---|
| `RAILWAY_BOB_TOKEN` | `RAILWAY_TOKEN_BOB` | load-railway-secrets-from-github-env.sh |
| `RAILWAY_TOKEN` | `RAILWAY_CORE_TOKEN` | load-railway-secrets-from-github-env.sh |
| `RAILWAY_BOB_SERVICE_ID` | `RAILWAY_SERVICE_ID` | load-railway-secrets-from-github-env.sh |
| `RAILWAY_BOB_PROJECT_ID` | `RAILWAY_PROJECT_ID` | load-railway-secrets-from-github-env.sh |
| `INFERENCE_SERVICE_URL` | `BOB_SERVICE_URL` | load-railway-secrets-from-github-env.sh (bidirectional) |
| `BOB_SERVICE_URL` | `INFERENCE_SERVICE_URL` | load-railway-secrets-from-github-env.sh (bidirectional) |
| `PROXY_SERVER_URL` | `PROXY_SERVICE_URL`, `NZSCV_PROXY_URL` | load-railway-secrets-from-github-env.sh |
| `PTT_SERVER_URL` | `PTT_SERVICE_URL` | load-railway-secrets-from-github-env.sh |
| `INFERENCE_API_KEY` | `BOB_INFERENCE_API_KEY` | load-railway-secrets-from-github-env.sh (bidirectional) |
| `VITE_SUPABASE_URL` | `SUPABASE_URL` | load-railway-secrets-from-github-env.sh |
| `PROXY_SERVER_URL` (Supabase) | `NZSCV_PROXY_URL`, `RAILWAY_PROXY_URL`, `PROXY_BASE_URL` | Edge Function source code |
| `PTT_PROXY_SECRET` (Supabase) | `PROXY_SECRET`, `PROXY_SERVER_SECRET`, `NZSCV_PROXY_SECRET` | `ptt-signaling-token` Edge Function |
| `PLATERECOGNIZER_TOKEN` (Supabase) | `PLATE_RECOGNIZER_TOKEN` | ALPR Edge Functions |

---

## Secrets Checklist

Use this checklist when setting up a new environment or after team changes.

### GitHub Actions — Core (all environments)

- [ ] `RAILWAY_BOB_TOKEN`
- [ ] `RAILWAY_BOB_SERVICE_ID`
- [ ] `RAILWAY_OLLAMA_SERVICE_ID`
- [ ] `RAILWAY_BOB_PROJECT_ID` (optional; required if SERVICE_ID not set)
- [ ] `RAILWAY_TOKEN`
- [ ] `RAILWAY_PROXY_SERVICE_ID`
- [ ] `VITE_SUPABASE_URL`
- [ ] `VITE_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_ACCESS_TOKEN`
- [ ] `SUPABASE_PROJECT_REF`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `SUPABASE_DB_PASSWORD`
- [ ] `INFERENCE_API_KEY`
- [ ] `VERCEL_TOKEN`
- [ ] `VERCEL_ORG_ID`
- [ ] `VERCEL_PROJECT_ID`
- [ ] `BOB_SYNC_PAT`
- [ ] `BOB_SERVICE_URL` (set after first Bob deploy)
- [ ] `PROXY_SERVER_URL` (set after first Proxy deploy)
- [ ] `PTT_SERVER_URL` (set after first PTT deploy)
- [ ] `OLLAMA_SERVICE_URL` (set after first Ollama deploy)

### GitHub Actions — Intel Feeds

- [ ] `INTEL_FEED_URLS`
- [ ] `INTEL_HMAC_KEY` (strongly recommended)

### GitHub Actions — Bob Ops

- [ ] `BOB_FEEDBACK_SYNC_URL`
- [ ] `BOB_FEEDBACK_SYNC_KEY`

### GitHub Actions — Frontend Environments

- [ ] `VITE_SUPABASE_URL_PRODUCTION`
- [ ] `VITE_SUPABASE_ANON_KEY_PRODUCTION`
- [ ] `VITE_INFERENCE_SERVICE_URL_PRODUCTION`
- [ ] `VITE_PROXY_SERVER_URL_PRODUCTION`
- [ ] `VITE_SUPABASE_URL_PREVIEW`
- [ ] `VITE_SUPABASE_ANON_KEY_PREVIEW`
- [ ] `VITE_INFERENCE_SERVICE_URL_PREVIEW`
- [ ] `VITE_PROXY_SERVER_URL_PREVIEW`

### GitHub Actions — Mobile

- [ ] `EXPO_TOKEN`
- [ ] `EXPO_PROJECT_ID`
- [ ] `EXPO_PUBLIC_SUPABASE_URL`
- [ ] `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `ANDROID_KEYSTORE_BASE64`
- [ ] `ANDROID_KEYSTORE_PASSWORD`
- [ ] `ANDROID_KEY_ALIAS`
- [ ] `ANDROID_KEY_PASSWORD`

### Supabase Edge Function Secrets

- [ ] `INFERENCE_SERVICE_URL`
- [ ] `INFERENCE_API_KEY`
- [ ] `PROXY_SERVER_URL`
- [ ] `PTT_SERVER_URL`
- [ ] `PTT_PROXY_SECRET`
- [ ] `BOB_FEEDBACK_SYNC_KEY`
- [ ] `TURNSTILE_SECRET_KEY`
- [ ] `VAPID_PRIVATE_KEY`
- [ ] `VAPID_PUBLIC_KEY`
- [ ] `VAPID_SUBJECT`
- [ ] `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`
- [ ] `PARKPOW_API_TOKEN` (if using ParkPow ALPR)
- [ ] `PLATERECOGNIZER_TOKEN` (if using Plate Recognizer)

### Railway: Bob service

- [ ] `INFERENCE_API_KEY` (matches GitHub Actions + Supabase vault)
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `SUPABASE_URL`
- [ ] `OLLAMA_BASE_URL` = `http://ollama.railway.internal:11434`
- [ ] `OLLAMA_MODEL` = `llama3.1:8b`
- [ ] `CHAT_PROVIDER` = `ollama`
- [ ] `TABULAR_NLP_PROVIDER` = `ollama`
- [ ] `INTEL_HMAC_KEY` (matches GitHub Actions `INTEL_HMAC_KEY`)

### Railway: Ollama service

- [ ] `OLLAMA_MODEL` = `llama3.1:8b`
- [ ] `OLLAMA_KEEP_ALIVE` = `24h`
- [ ] `OLLAMA_NO_CLOUD` = `true`

### Railway: Proxy service

- [ ] `PROXY_SECRET` (matches Supabase vault proxy secret)
- [ ] `NZSCV_API_KEY`
- [ ] `NZSCV_ID_KEY`
- [ ] `NZSCV_ENDPOINT_URL`
- [ ] `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` (if using invite emails from proxy)

### Railway: PTT service

- [ ] `PROXY_SECRET` (matches Supabase vault `PTT_PROXY_SECRET`)
- [ ] `PTT_JWT_SECRET`
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`

---

## References

- [RAILWAY_SERVICES_AUTHORITY.md](RAILWAY_SERVICES_AUTHORITY.md) — Railway service ownership + deploy authority
- [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) — Detailed env var reference per service
- [BOB_PRODUCTION_RAILWAY_SETUP.md](BOB_PRODUCTION_RAILWAY_SETUP.md) — Bob setup walkthrough
- `scripts/load-railway-secrets-from-github-env.sh` — Alias normalisation script
- `.github/workflows/` — All workflow files that consume secrets
