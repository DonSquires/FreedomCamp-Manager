# Deployment Guide - FieldOps Manager

This guide provides step-by-step instructions for deploying the rebuilt FieldOps Manager application to production.

## Baseline Plan (Original)

Use [NEW_PROJECT_SETUP.md](NEW_PROJECT_SETUP.md) as the baseline for full from-zero provisioning (new Supabase project, migrations, edge functions, Railway services, web portal, and mobile app).

This deployment guide is the operational companion for production rollout checks and drift recovery procedures.

## Codespaces Startup Log Interpretation

When reviewing `.codespaces/.persistedshare/creation.log`, multiple `devcontainer up`
entries during one startup are expected. Codespaces runs separate lifecycle phases
(create, blocking commands, attach), and each phase can invoke the devcontainer CLI.

Treat startup as healthy when outcomes are success and the process exits with code 0.
Repeated entries alone are not a failure signal.

To prevent duplicate side effects when post-start hooks run more than once, keep
startup commands idempotent (this repository uses `.devcontainer/postStart.sh` to
avoid launching duplicate Vite dev servers).

---

## 📋 Pre-Deployment Checklist

Before deploying, ensure all requirements are met:

### 1. Code Quality
- [ ] All TypeScript errors resolved (`bun run build` succeeds)
- [ ] No console errors in development mode
- [ ] ESLint passes with no warnings
- [ ] Bob governance regression passes (`bun run test:bob:governance`)
- [ ] All unused imports removed
- [ ] Phase 8 smoke tests pass

### 2. Environment Setup
- [ ] Production Supabase project created/configured
- [ ] All current database migrations applied (check `supabase/migrations/`)
- [ ] All current Edge Functions deployed (check `supabase/functions/`)
- [ ] Bob contract endpoints deployed together when changed: `onspace-ai-chat`, `grandmaster-studio`, `bob-code-change-task`
- [ ] Storage buckets created (evidence, incident-evidence)
- [ ] RLS policies enabled on all tables
- [ ] Test user accounts created (admin, officer, master)

### 3. External Services
- [ ] Railway proxy-server deployed and healthy
- [ ] Bob inference service (RunPod) deployed and healthy
- [ ] ParkPow ALPR credentials configured
- [ ] OnSpace AI credentials configured (if used)

### 4. Bob Governance Integrity
- [ ] Shared gateway path still flows through `src/lib/edgeFunctions.ts`
- [ ] Mutation contract enforcement is active on both client wrappers and receiving edge functions
- [ ] Execution review renders in Bob chat surfaces and persists to Bob conversation memory
- [ ] No new migration is required for execution review persistence; it uses `public.bob_conversation_memory.context` JSONB from migration `20260604000006_bob_conversation_memory.sql`

---

## Supabase DB Push And Drift Recovery (Canonical)

Use this section as the single operational guide for applying migrations and recovering from history drift.

### Required Auth

Use a Supabase Personal Access Token that starts with `sbp_`.

```bash
export SUPABASE_ACCESS_TOKEN='sbp_...'
```

Do not use a project JWT (`eyJ...`) for CLI auth.

### Standard Push Flow

```bash
/tmp/supabase migration list
/tmp/supabase db push --include-all --yes
```

### If You See "Remote migration versions not found"

1. Re-check migration history:

```bash
/tmp/supabase migration list
```

2. Repair obsolete short versions (known drift set):

```bash
/tmp/supabase migration repair --status reverted 20250127 20260309 20260312 20260313 20260316 20260320 --yes
```

3. Retry push:

```bash
/tmp/supabase db push --include-all --yes
```

### Migration Naming Rules

1. Keep every migration version unique.
2. Prefer full timestamp versions (`YYYYMMDDHHMMSS`) when there are multiple migrations on one day.
3. Avoid mixing short date-only and multiple same-day timestamp versions in active chains.

### Known Non-Blocking Warning

During `20260326_evidence_bucket_import_policy.sql`, this warning can appear and still finish green:

- `Skipping storage.objects policy updates: insufficient privileges for current role.`

### Post-Push Validation

```bash
/tmp/supabase migration list
```

Then run smoke tests for:

1. Scan ingest and observation writes
2. Breach alert generation
3. Photo recovery views and functions (if enabled)
4. Bob governance regression (`bun run test:bob:governance`) after deploying Bob edge functions

### Live Schema Verification Runbook (DBA)

Use this block to verify live database truth and reconcile docs/types after migrations.

1. Link the project and validate migration state:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
supabase migration list
```

2. Export live table/column metadata from information_schema:

```bash
supabase db query <<'SQL'
SELECT
   table_name,
   column_name,
   data_type,
   is_nullable,
   column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
SQL
```

3. Reconcile and update the following artifacts in one PR:

- `docs/LIVE_SCHEMA.md` (set a new Last verified date)
- `src/types/database.ts` (regenerated/updated to match live schema)
- Any migration notes in `docs/STAGING.md` when integrity issues are found

4. Re-run build/lint after type updates:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run lint && bun run build
```

5. Optional local guard before pushing migration changes:

```bash
scripts/check-migration-integrity.sh
```

---

## 🚀 Deployment Options

### Option 1: Vercel (Recommended)

**Advantages:**
- Automatic deployments from Git
- Edge network (global CDN)
- Free SSL certificates
- Serverless functions support
- Easy rollbacks

**Steps:**

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Configure Project**
   ```bash
   vercel
   ```
   - Select your project directory
   - Link to existing project or create new one
   - Set build command: `bun run build`
   - Set output directory: `dist`

4. **Set Environment Variables**
   
   In Vercel Dashboard → Settings → Environment Variables:
   
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

5. **Deploy**
   ```bash
   vercel --prod
   ```

6. **Verify Deployment**
   - Visit your deployment URL
   - Run smoke tests in browser console: `runSmokeTests()`
   - Test login flow
   - Test data loading
   - Validate Bob governance path by checking a Bob surface returns `Review Findings`, `Assessment`, and `Action Plan`, and that disallowed named mutation contracts are blocked

---

### Option 3: Railway (proxy-only)

Railway is used for the proxy static-IP surface (`proxy-server/`) only. Bob/Ollama inference runs on RunPod.

**Quick steps**
1. Install CLI & login:
   ```bash
   npm i -g @railway/cli
   railway login
   ```
2. From the service directory (`proxy-server/`):
   ```bash
   railway link   # or railway init
   railway up
   ```
3. Set environment variables:
   ```bash
   railway variables set VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=...
   ```
4. Copy the proxy deployment URL from `railway status` and wire it into app config/secrets.

See `docs/RAILWAY_DEPLOYMENT_GUIDE.md` for full instructions (including GitHub deployments and endpoint tests).

---

### Option 2: Netlify

**Advantages:**
- Simple drag-and-drop deployment
- Forms handling
- Split testing support
- Free starter tier

**Steps:**

1. **Build Production Bundle**
   ```bash
   bun run build
   ```

2. **Install Netlify CLI**
   ```bash
   npm install -g netlify-cli
   ```

3. **Login**
   ```bash
   netlify login
   ```

4. **Deploy**
   ```bash
   netlify deploy --prod --dir=dist
   ```

5. **Set Environment Variables**
   
   In Netlify Dashboard → Site Settings → Environment Variables:
   
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

6. **Configure Redirects**
   
   Create `public/_redirects`:
   ```
   /*    /index.html   200
   ```

---

### Option 3: Custom Server (VPS/Docker)

**For self-hosted deployments**

1. **Build Production Bundle**
   ```bash
   bun run build
   ```

2. **Serve with Nginx**
   
   Nginx config:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       root /var/www/fieldops/dist;
       index index.html;

       location / {
           try_files $uri $uri/ /index.html;
       }

       # Enable gzip compression
       gzip on;
       gzip_types text/css application/javascript application/json;
   }
   ```

3. **Setup SSL with Let's Encrypt**
   ```bash
   sudo certbot --nginx -d your-domain.com
   ```

4. **Setup systemd service (optional)**
   
   For auto-restart on server reboot.

---

## 🔧 Post-Deployment Configuration

### Bob Governance Notes

- Bob structural awareness is supplied by three client-side artifacts in `src/lib/`: `bobSchemaRegistry.ts`, `bobRouteEntityMap.ts`, and `bobMutationCatalog.ts`.
- The shared gateway in `src/lib/edgeFunctions.ts` injects compact summaries from those files into Bob requests and produces execution-review metadata for the UI.
- Execution-review persistence does not require a new schema migration because it is stored inside `public.bob_conversation_memory.context` JSONB.
- When Bob mutation rules change, redeploy these edge functions together: `onspace-ai-chat`, `grandmaster-studio`, `bob-code-change-task`, and any caller endpoint that forwards Bob requests such as `ask-bob`.

### 1. Supabase Edge Function Secrets

Set these via **Supabase Dashboard → Project Settings → Edge Functions → Manage Secrets**
(or via `supabase secrets set KEY=value` in the CLI):

```bash
PROXY_SERVER_URL=https://your-proxy-server.railway.app
INFERENCE_SERVICE_URL=https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync
INFERENCE_API_KEY=your-inference-shared-secret
ALPR_API_TOKEN=your-parkpow-token
ALPR_API_URL=https://app.parkpow.com/api/v1

# AI policy: inference-service only (no direct external AI provider secrets in Supabase)
# Keep INFERENCE_SERVICE_URL as a full HTTPS URL with scheme, for example:
#   https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync

# Edge Function SMTP email (report emails, infringement notices, notices to vacate)
# User invitation emails are sent by Supabase Auth invite flow, configured under
# Authentication → SMTP Settings / Email Templates / URL Configuration.
# See docs/EMAIL_SETUP.md for provider-specific examples.
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=apikey
SMTP_PASSWORD=your-smtp-password
SMTP_FROM_EMAIL=noreply@yourdomain.co.nz
SMTP_FROM_NAME=FieldOps Manager
```

Inference-service deployment env should enforce self-contained operation:

```bash
# Set these on RunPod pod for Bob inference service (not in Supabase function secrets)
SELF_CONTAINED_MODE=true
REQUIRE_SELF_CONTAINED_MODE=true
SELF_CONTAINED_STRICT_EGRESS=true
CHAT_PROVIDER=ollama
VEHICLE_ATTRS_PROVIDER=basic
TABULAR_NLP_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
SELF_HEALING_ENABLED=true
```

Bob edge routing should remain Ollama-first unless explicitly overridden:

```bash
# Set these in Supabase Edge Function secrets
BOB_CHAT_PROVIDER=ollama
BOB_CHAT_ALLOW_FALLBACK=false
```

### 2. Custom Domain (Optional)

**Vercel:**
1. Go to Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed
4. SSL auto-configured

**Netlify:**
1. Go to Domain Settings → Custom Domains
2. Add domain
3. Update DNS
4. SSL auto-configured

### 3. PWA Configuration

Ensure `public/manifest.json` has correct URLs:

```json
{
   "name": "FieldOps Manager",
  "short_name": "FCManager",
  "start_url": "https://your-domain.com/",
  "scope": "https://your-domain.com/",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

---

## 🧪 Post-Deployment Testing

### 1. Smoke Tests

Open browser console and run:

```javascript
runSmokeTests()
```

Should see:
```
✅ Passed: 10/10
🎉 All tests passed! Application is ready.
```

### 2. Manual Testing

Follow [Phase 8 Testing Checklist](./PHASE_8_TESTING_CHECKLIST.md):

- [ ] Login with test accounts
- [ ] Load each page (Vehicle Management, Zone Management, etc.)
- [ ] Test scanning workflow
- [ ] Verify compliance calculation
- [ ] Check breach detection
- [ ] Test role-based access

### 3. Performance Testing

```javascript
performanceTests.runBenchmark()
```

Expected results:
- Vehicle List: <1000ms
- Zone List: <1000ms
- Observation List: <1500ms
- Dashboard Stats: <2000ms

### 4. PWA Testing

- [ ] Install app on desktop
- [ ] Install app on mobile
- [ ] Test offline mode
- [ ] Verify service worker caching

---

## 🔍 Monitoring & Logging

### 1. Supabase Logs

Monitor Edge Function logs:
1. Go to Supabase Dashboard → Edge Functions
2. Select function
3. View logs for errors

### 2. Frontend Error Tracking (Optional)

Add Sentry for error tracking:

```bash
npm install @sentry/react
```

```typescript
// src/main.tsx
import * as Sentry from '@sentry/react'

Sentry.init({
  dsn: 'your-sentry-dsn',
  environment: import.meta.env.MODE,
})
```

### 3. Performance Monitoring

Use Vercel Analytics or Google Analytics for:
- Page load times
- User engagement
- Error rates

---

## 🚨 Rollback Procedure

### Vercel
```bash
vercel rollback
```

### Netlify
1. Go to Deploys
2. Click on previous deployment
3. Click "Publish deploy"

### Manual
```bash
git revert HEAD
git push origin main
vercel --prod
```

---

## 🔐 Security Hardening

### 1. Content Security Policy

Add to `index.html`:

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline'; 
               style-src 'self' 'unsafe-inline'; 
               img-src 'self' data: https:; 
               connect-src 'self' https://*.supabase.co https://*.railway.app">
```

### 2. HTTPS Enforcement

Ensure all API calls use HTTPS:
- Supabase URL: `https://`
- Railway services: `https://`

### 3. Environment Variable Protection

Never commit `.env` to Git. Use:
```bash
echo ".env" >> .gitignore
```

---

## 📊 Performance Optimization

### 1. Enable Gzip Compression

Most hosting platforms enable this by default. Verify:

```bash
curl -H "Accept-Encoding: gzip" -I https://your-domain.com
```

Should see: `Content-Encoding: gzip`

### 2. Image Optimization

All images should be:
- WebP format (when possible)
- Properly sized (no 4000x3000 images for 200x200 display)
- Lazy loaded

### 3. Code Splitting

Vite automatically code-splits. Verify in build output:

```
dist/assets/index-abc123.js      150 KB
dist/assets/vendor-def456.js     300 KB
dist/assets/AdminPortal-ghi789.js  50 KB (lazy)
```

---

## 🎯 Production Readiness Checklist

### Infrastructure
- [ ] Production Supabase project configured
- [ ] All migrations applied
- [ ] All Edge Functions deployed
- [ ] Storage buckets configured
- [ ] Railway services healthy
- [ ] Custom domain configured (optional)
- [ ] SSL certificate active

### Application
- [ ] Build succeeds without errors
- [ ] All smoke tests pass
- [ ] PWA installable
- [ ] Offline mode works
- [ ] Performance benchmarks acceptable

### Security
- [ ] Environment variables secured
- [ ] RLS policies enabled
- [ ] HTTPS enforced
- [ ] CSP headers configured
- [ ] No secrets in client code

### Monitoring
- [ ] Error tracking enabled
- [ ] Performance monitoring enabled
- [ ] Supabase logs monitored
- [ ] Backup strategy in place

### Documentation
- [ ] User manual updated
- [ ] Admin guide updated
- [ ] API documentation current
- [ ] Runbooks prepared

---

## 🆘 Troubleshooting

### "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT"

**Cause:** Ad blocker blocking API calls  
**Solution:** Whitelist your domain in ad blocker

### "CORS policy: No 'Access-Control-Allow-Origin' header"

**Cause:** Edge Function missing CORS headers  
**Solution:** Check `_shared/cors.ts` is imported and used

### "RLS policy violation"

**Cause:** User doesn't have permission for operation  
**Solution:** Check RLS policies in database, verify user role

### "Railway service timeout"

**Cause:** Cold start (service idle)  
**Solution:** Retry request, consider Railway paid plan for always-on

---

## 📞 Support

For deployment issues:
- **Email:** contact@onspace.ai
- **Documentation:** [docs/BUILD_PLAN.md](./BUILD_PLAN.md)
- **Railway Guide:** [docs/RAILWAY_INTEGRATION.md](./RAILWAY_INTEGRATION.md)

---

**Last Updated:** Phase 8 Deployment  
**Version:** 2.0 (Rebuild)  
**Status:** ✅ Ready for Production
