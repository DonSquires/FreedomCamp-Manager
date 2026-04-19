# Environment Variables Reference

Complete reference for all environment variables used in FreedomCamp Manager.

> **Looking for secrets setup instructions?** See the **[Secrets Registry](SECRETS_REGISTRY.md)** for a complete list of every secret — what it does, where to configure it (GitHub Actions, Supabase vault, or Railway service), accepted aliases, and a copy-paste setup checklist.

## Table of Contents

1. [Frontend (Vite) Variables](#frontend-vite-variables)
2. [Supabase Edge Function Variables](#supabase-edge-function-variables)
3. [Railway Service Variables](#railway-service-variables)
4. [Mobile App Variables](#mobile-app-variables)

---

## Frontend (Vite) Variables

All frontend variables must be prefixed with `VITE_` to be exposed to the browser.

### Required Variables

| Variable | Description | Format | Example |
|----------|-------------|--------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL | `https://<project-ref>.supabase.co` | `https://abc123xyz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous/public key | JWT string | `eyJhbGciOiJIUzI1NiI...` |

### Optional Variables

| Variable | Description | Default | Format |
|----------|-------------|---------|--------|
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps JavaScript API key | None | Alphanumeric string |
| `VITE_PROXY_SERVER_URL` | Railway proxy server URL | None | `https://<service>.railway.app` |
| `VITE_INFERENCE_SERVICE_URL` | Railway inference service URL | None | `https://<service>.railway.app` |
| `VITE_APP_VERSION` | Application version for display | `1.0.0` | Semver string |
| `VITE_ENVIRONMENT` | Environment name | `development` | `development`, `staging`, `production` |

### Deployment Environment Matrix (Vercel + Railway)

Use distinct values for preview and production. Do not point preview at production services.

| Deployment target | `VITE_SUPABASE_URL` | `VITE_INFERENCE_SERVICE_URL` | `VITE_PROXY_SERVER_URL` | `VITE_ENVIRONMENT` |
|----------|----------|----------|----------|----------|
| Vercel production | Production Supabase URL | Production inference Railway URL | Production proxy Railway URL | `production` |
| Vercel preview | Preview/staging Supabase URL | Preview inference Railway URL | Preview proxy Railway URL | `preview` |

### GitHub Secrets For Isolated Deployments

The frontend deployment workflow supports environment-specific secrets and enforces preview isolation.

| Secret | Purpose |
|----------|----------|
| `VITE_SUPABASE_URL_PRODUCTION` | Production frontend Supabase URL |
| `VITE_SUPABASE_ANON_KEY_PRODUCTION` | Production frontend Supabase anon key |
| `VITE_INFERENCE_SERVICE_URL_PRODUCTION` | Production inference URL (optional but recommended) |
| `VITE_PROXY_SERVER_URL_PRODUCTION` | Production proxy URL (optional but recommended) |
| `VITE_SUPABASE_URL_PREVIEW` | Preview frontend Supabase URL |
| `VITE_SUPABASE_ANON_KEY_PREVIEW` | Preview frontend Supabase anon key |
| `VITE_INFERENCE_SERVICE_URL_PREVIEW` | Preview inference URL |
| `VITE_PROXY_SERVER_URL_PREVIEW` | Preview proxy URL |

Notes:
- Legacy fallback still works for production: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Preview deployments are blocked if preview URLs match production URLs.
- In Railway, map Vercel Preview to a non-production Railway environment.

### Example `.env` File (Development)

```bash
# Required - Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Optional - Google Maps
VITE_GOOGLE_MAPS_API_KEY=AIza...

# Optional - Railway Services (if using local or custom inference)
VITE_PROXY_SERVER_URL=https://proxy-server-production.railway.app
VITE_INFERENCE_SERVICE_URL=https://focused-courage-production-ccee.up.railway.app

# Environment
VITE_ENVIRONMENT=development
```

---

## Supabase Edge Function Variables

These are set in Supabase Dashboard → Project Settings → Edge Functions → Secrets.

### Core Variables

| Variable | Description | Required | Format |
|----------|-------------|----------|--------|
| `SUPABASE_URL` | Auto-injected by Supabase | Auto | URL |
| `SUPABASE_ANON_KEY` | Auto-injected by Supabase | Auto | JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase | Auto | JWT |

### External Service Integration

| Variable | Description | Required | Notes |
|----------|-------------|----------|-------|
| `INFERENCE_SERVICE_URL` | Railway inference service URL | For AI features | Used by face recognition, ALPR |
| `INFERENCE_API_KEY` | API key for inference service | Optional | Set for additional security |
| `NZSCV_API_KEY` | NZ SCV API key | For SCV lookups | Ministry of Transport API |
| `PARKPOW_API_KEY` | ParkPow API key | For ALPR integration | Third-party ALPR service |
| `RESEND_API_KEY` | Resend email API key | For email notifications | Email service |
| `PTT_SERVER_URL` | PTT signaling base URL | For push-to-talk | Use `http://72.61.123.97:8080` (Edge Functions append `/ws`) |
| `PTT_PROXY_SECRET` | Shared secret for PTT token mint calls | For push-to-talk | Preferred secret for PTT token broker |

PTT proxy secret compatibility (Edge Functions):
- The `ptt-signaling-token` function accepts any one of these names:
- `PTT_PROXY_SECRET` (preferred)
- `PROXY_SECRET`
- `PROXY_SERVER_SECRET`
- `NZSCV_PROXY_SECRET`

### CORS Configuration

| Variable | Description | Values | Security Note |
|----------|-------------|--------|---------------|
| `DEV_CORS` | Enable wildcard CORS | `true` / `false` | ⚠️ Automatically disabled in production |
| `ENVIRONMENT` | Deployment environment | `development`, `staging`, `production` | Controls DEV_CORS behavior |

### CAPTCHA (Cloudflare Turnstile)

Public endpoints (case lookup, dispute submission) require CAPTCHA to prevent enumeration attacks and spam.

| Variable | Description | Required | Notes |
|----------|-------------|----------|-------|
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key | In production | Get from Cloudflare dashboard |

**Frontend Integration:**

Add the Turnstile site key to your frontend `.env`:
```bash
VITE_TURNSTILE_SITE_KEY=0x4AAAAA...  # Cloudflare Turnstile site key
```

**Setup Instructions:**
1. Go to Cloudflare Dashboard → Turnstile → Add Widget
2. Choose "Managed" challenge type (free, invisible to users)
3. Add your production domain(s)
4. Copy Site Key → Frontend (VITE_TURNSTILE_SITE_KEY)
5. Copy Secret Key → Supabase Edge Function Secrets (TURNSTILE_SECRET_KEY)

**Note:** In development (when `ENVIRONMENT` ≠ `production`), CAPTCHA is bypassed if `TURNSTILE_SECRET_KEY` is not set.

### Feature Flags

| Variable | Description | Values |
|----------|-------------|--------|
| `ENABLE_FACE_RECOGNITION` | Enable face recognition feature | `true` / `false` |
| `ENABLE_ALPR` | Enable automatic plate recognition | `true` / `false` |
| `ENABLE_PTT` | Enable push-to-talk | `true` / `false` |

---

## Railway Service Variables

### Inference Service (`/inference-service/`)

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | HTTP port to listen on | No | `3000` |
| `INFERENCE_API_KEY` | Shared secret for API auth | Optional | None |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Optional | For DB access |
| `MODEL_PATH` | Path to ONNX model files | No | `./models` |
| `CHAT_PROVIDER` | Chat provider mode | Recommended | `ollama` |
| `TABULAR_NLP_PROVIDER` | Tabular NLP provider mode | Recommended | `ollama` |
| `OLLAMA_BASE_URL` | Ollama endpoint for chat/NLP | Recommended | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Ollama model name | Recommended | `llama3.1:8b` |
| `RUNPOD_POD_ID` | RunPod pod id for lifecycle start/stop | Optional | None |
| `RUNPOD_API_KEY` | RunPod API key for pod lifecycle GraphQL | Optional | None |
| `RUNPOD_IDLE_TIMEOUT_MS` | Idle timeout before auto-stop of pod | Optional | `900000` |
| `RUNPOD_ENDPOINT_ID` | RunPod serverless endpoint id | Optional | None |
| `RUNPOD_ENDPOINT_URL` | Explicit RunPod serverless invoke URL | Optional | None |
| `RUNPOD_ENDPOINT_API_KEY` | RunPod serverless endpoint API key | Optional | None |
| `RUNPOD_ENDPOINT_TIMEOUT_MS` | Serverless invoke/poll timeout in ms | Optional | `120000` |
| `RUNPOD_ENDPOINT_POLL_INTERVAL_MS` | Serverless polling interval in ms | Optional | `3000` |

### Proxy Server (`/proxy-server/`)

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | HTTP port to listen on | No | `3001` |
| `NZSCV_API_BASE` | NZ SCV API base URL | Yes | - |
| `NZSCV_API_KEY` | NZ SCV API key | Yes | - |
| `SUPABASE_URL` | Supabase project URL | Yes | - |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes | - |

### PTT Server (`/ptt-server/`)

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | WebSocket port | No | `8080` |
| `TURN_URL` | TURN server URL | Recommended | `turn:72.61.123.97:3478` |
| `TURN_USERNAME` | TURN username | Recommended | - |
| `TURN_CREDENTIAL` | TURN credential/password | Recommended | - |
| `SUPABASE_URL` | Supabase project URL | Yes | - |
| `SUPABASE_SERVICE_ROLE_KEY` | For channel auth | Yes | - |
| `PTT_MEDIA_MODE` | Media topology metadata mode (`peer` or `sfu`) | No | `peer` |
| `PTT_SFU_PROVIDER` | SFU provider label when in `sfu` mode | No | - |
| `PTT_SFU_URL` | SFU URL when in `sfu` mode | No | - |

### Bob Edge Chat Routing (`supabase/functions/onspace-ai-chat`)

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `BOB_CHAT_PROVIDER` | Provider preference (`ollama`, `inference`, `auto`) | Recommended | `ollama` |
| `BOB_CHAT_ALLOW_FALLBACK` | Allow automatic fallback to secondary provider | Recommended | `false` |
| `OLLAMA_BASE_URL` | Optional override for direct Ollama edge calls | No | falls back to `INFERENCE_SERVICE_URL` |
| `OLLAMA_MODEL` | Ollama model name used by edge fallback path | No | request/default model |

### GitHub Actions Railway Secret Matrix

Canonical secret names used by deploy workflows:

| Secret | Used by |
|----------|----------|
| `RAILWAY_TOKEN` | Inference + proxy deploy workflows |
| `RAILWAY_BOB_TOKEN` | Bob + Ollama deploy workflows |
| `RAILWAY_INFERENCE_SERVICE_ID` | Inference deploy workflow |
| `RAILWAY_PROXY_SERVICE_ID` | Proxy deploy workflow |
| `RAILWAY_BOB_SERVICE_ID` | Bob deploy workflow |
| `RAILWAY_BOB_PROJECT_ID` | Bob service auto-resolution fallback |
| `RAILWAY_OLLAMA_SERVICE_ID` | Ollama deploy workflow |
| `INFERENCE_SERVICE_URL` | Health checks + Bob pretrain workflows |
| `PROXY_SERVICE_URL` | Proxy health check |
| `BOB_SERVICE_URL` | Bob health + chat route verification |
| `BOB_INFERENCE_API_KEY` | Bob ops workflow auth alias for `INFERENCE_API_KEY` |
| `OLLAMA_SERVICE_URL` | Ollama health/model pull verification |

Notes:
- Deploy workflows now accept token fallback (`RAILWAY_TOKEN` <-> `RAILWAY_BOB_TOKEN`) to reduce CI drift during token rotations.
- Bob ops workflows accept URL/key aliases to reduce naming drift: `BOB_SERVICE_URL` <-> `INFERENCE_SERVICE_URL` and `BOB_INFERENCE_API_KEY` <-> `INFERENCE_API_KEY`.
- Service IDs remain mandatory for deterministic deployments.

---

## Mobile App Variables

Located in `/mobile-app/.env`

| Variable | Description | Format |
|----------|-------------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL | URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | JWT |

PTT routing note:
- Mobile PTT uses the same Supabase Edge Function (`ptt-signaling-token`) and therefore the same `PTT_SERVER_URL` secret (`http://72.61.123.97:8080`).
- If your Expo client introduces a direct fallback URL, set it to `ws://72.61.123.97:8080/ws`.

---

## PTT Migration Quick Reference (Vercel / Expo / Supabase)

| Platform | Variable | Value |
|----------|----------|-------|
| Vercel (frontend env) | `VITE_PTT_SERVER_URL` | `ws://72.61.123.97:8080/ws` |
| Supabase Edge Function Secrets | `PTT_SERVER_URL` | `http://72.61.123.97:8080` |
| PTT server runtime | `TURN_URL` | `turn:72.61.123.97:3478` |
| PTT server runtime | `TURN_USERNAME` | `<your_turn_username>` |
| PTT server runtime | `TURN_CREDENTIAL` | `<your_turn_credential>` |

---

## Validation

### Frontend Validation

The application validates required variables at startup. If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` are missing, a "Setup Required" screen is displayed.

See: `/src/lib/supabase.ts` and `/src/main.tsx`

### Edge Function Validation

Edge functions should validate required secrets on startup:

```typescript
// Example validation
const INFERENCE_URL = Deno.env.get('INFERENCE_SERVICE_URL');
if (!INFERENCE_URL) {
  throw new Error('INFERENCE_SERVICE_URL is required');
}
```

---

## Security Best Practices

1. **Never commit `.env` files** - Use `.env.example` as a template
2. **Use separate keys per environment** - Don't reuse production keys in development
3. **Separate preview and production backends** - Never point Vercel preview at production Supabase/Railway services
4. **Rotate keys regularly** - Especially after team member departures
5. **Limit API key scopes** - Use least-privilege principle
6. **DEV_CORS protection** - The `DEV_CORS=true` setting is automatically disabled when `ENVIRONMENT=production`

---

## Troubleshooting

### "Supabase not configured" Error

1. Check that `VITE_SUPABASE_URL` is set
2. Check that `VITE_SUPABASE_ANON_KEY` is set
3. Restart the dev server after adding variables

### Edge Function Secrets Not Working

1. Verify secrets are set in Supabase Dashboard
2. Redeploy the edge function after adding secrets
3. Check function logs for initialization errors

### Railway Service Connection Issues

1. Verify the service URL is correct (check Railway dashboard)
2. Ensure the health endpoint is responding: `GET /health`
3. Check that required env vars are set in Railway service settings
