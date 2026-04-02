# Environment Variables Reference

Complete reference for all environment variables used in FieldOps Manager.

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

### Example `.env` File (Development)

```bash
# Required - Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Optional - Google Maps
VITE_GOOGLE_MAPS_API_KEY=AIza...

# Optional - Railway Services (if using local or custom inference)
VITE_PROXY_SERVER_URL=https://proxy-server-production.railway.app
VITE_INFERENCE_SERVICE_URL=https://inference-service-production.railway.app

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
| `SUPABASE_URL` | Supabase project URL | Yes | - |
| `SUPABASE_SERVICE_ROLE_KEY` | For channel auth | Yes | - |

---

## Mobile App Variables

Located in `/mobile-app/.env`

| Variable | Description | Format |
|----------|-------------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL | URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | JWT |

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
3. **Rotate keys regularly** - Especially after team member departures
4. **Limit API key scopes** - Use least-privilege principle
5. **DEV_CORS protection** - The `DEV_CORS=true` setting is automatically disabled when `ENVIRONMENT=production`

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
