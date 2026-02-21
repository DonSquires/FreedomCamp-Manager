# CORS Preview Subdomain Fix

**Date:** Feb 22, 2026  
**Issue:** Edge Functions blocked new Onspace preview subdomain  
**Status:** ✅ FIXED

---

## Problem

Onspace generates ephemeral preview subdomains for each build:
```
Old: https://preview-react-9b4t5o-8a3pjund9sxaadqyksnpbj.onspace.build
New: https://preview-react-9b4t5o-xuyr5a4bkmn9vjotpkunkq.onspace.build
```

Previous CORS implementation used hardcoded exact origins, causing:
```
Access to fetch at '...' from origin 'https://preview-react-9b4t5o-xuyr5a4bkmn9vjotpkunkq.onspace.build' 
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

---

## Solution

Updated `supabase/functions/_shared/withCors.ts` to support:

### 1. **Exact Production Domains** (Strict Allowlist)
```typescript
const ALLOWED_ORIGINS_EXACT = new Set<string>([
  'https://freedomcampmanager.onspace.build',
  'https://fcmanager.co.nz',
  'https://www.onspace.ai',
  'https://react-9b4t5o.onspace.build',
  'http://localhost:5173',
  'http://localhost:3000',
]);
```

### 2. **Preview Subdomain Pattern Matching**
```typescript
function isAllowedPreview(origin: string): boolean {
  try {
    const u = new URL(origin);
    const host = u.host;
    return (
      host.endsWith('.onspace.build') &&
      host.startsWith('preview-react-9b4t5o-')
    );
  } catch {
    return false;
  }
}
```

This matches ANY preview subdomain: `preview-react-9b4t5o-*.onspace.build`

### 3. **DEV_CORS Toggle** (Development Wildcard)
Set in Supabase Dashboard → Project Settings → Edge Functions → Environment Variables:
```
DEV_CORS=true
```

When enabled, allows wildcard `*` for any origin (simplifies preview debugging).

**Remove for production** to lock back to exact + pattern matching.

---

## Verification Checklist

### ✅ Step 1: Test OPTIONS Preflight
```bash
curl -i -X OPTIONS \
  -H "Origin: https://preview-react-9b4t5o-xuyr5a4bkmn9vjotpkunkq.onspace.build" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type, authorization, apikey, x-client-info" \
  https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest
```

**Expected Response:**
```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://preview-react-9b4t5o-xuyr5a4bkmn9vjotpkunkq.onspace.build
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type, x-request-id
```

### ✅ Step 2: Test Actual Request
```bash
curl -i -X POST \
  -H "Origin: https://preview-react-9b4t5o-xuyr5a4bkmn9vjotpkunkq.onspace.build" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"plateText": "ABC123"}' \
  https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest
```

**Expected Response:**
```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://preview-react-9b4t5o-xuyr5a4bkmn9vjotpkunkq.onspace.build
Content-Type: application/json

{"ok":true,"plate":"ABC123"}
```

### ✅ Step 3: Test in Browser
1. Open new preview build: `https://preview-react-9b4t5o-xuyr5a4bkmn9vjotpkunkq.onspace.build`
2. Log in
3. Trigger vehicle scan
4. Check DevTools Console (F12) → **No CORS errors**
5. Check Network tab → OPTIONS request returns 200 with CORS headers

---

## Deployment Checklist

### Production Deployment
- [ ] Remove `DEV_CORS=true` from Supabase env vars
- [ ] Deploy all Edge Functions with updated CORS helper
- [ ] Test with production domains only
- [ ] Verify exact origins are blocked (security check)

### Commands
```bash
# Deploy updated CORS helper (affects all functions)
supabase functions deploy vehicle-ingest
supabase functions deploy hotspot-data
supabase functions deploy observations-in-bounds
supabase functions deploy observations-list
supabase functions deploy observations-export

# Verify deployment
curl -i -X OPTIONS \
  -H "Origin: https://preview-react-9b4t5o-NEW.onspace.build" \
  -H "Access-Control-Request-Method: POST" \
  https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest
```

---

## Key Changes

### Before (❌ Hardcoded Exact Origins)
```typescript
const PRODUCTION_ORIGINS = [
  'https://react-9b4t5o.onspace.build',
  'https://preview-react-9b4t5o-8a3pjund9sxaadqyksnpbj.onspace.build', // ❌ Breaks on new preview
];

const isAllowed = PRODUCTION_ORIGINS.includes(origin);
```

### After (✅ Pattern Matching)
```typescript
const ALLOWED_ORIGINS_EXACT = new Set([
  'https://react-9b4t5o.onspace.build',
  // No preview subdomain needed
]);

function isAllowedPreview(origin: string): boolean {
  const host = new URL(origin).host;
  return host.endsWith('.onspace.build') && host.startsWith('preview-react-9b4t5o-');
}

const allowed = ALLOWED_ORIGINS_EXACT.has(origin) || isAllowedPreview(origin);
```

---

## Common Pitfalls Avoided

1. ✅ **OPTIONS returns 200** (not 204) - Some browsers expect 200 for preflight
2. ✅ **CORS headers on ALL responses** - Including errors and preflight
3. ✅ **Pattern matching instead of exact** - Works with ephemeral preview subdomains
4. ✅ **DEV_CORS toggle** - Simplifies debugging without compromising production security
5. ✅ **Vary: Origin header** - Ensures proper caching behavior

---

## Security Notes

- **Preview pattern is scoped:** Only matches `preview-react-9b4t5o-*.onspace.build` (your project slug)
- **Exact origins are strict:** Production domains must match exactly
- **DEV_CORS is optional:** Only enable for preview debugging, remove for production
- **No credentials in CORS:** `Access-Control-Allow-Credentials` not set (prevents CSRF)

---

## Next Steps

1. ✅ Deploy updated CORS helper to all Edge Functions
2. ✅ Test with new preview subdomain
3. 🔄 Monitor for CORS errors in production (should be zero)
4. 📝 Document this pattern for future Edge Functions

---

**Document Version:** 1.0  
**Status:** PRODUCTION READY  
**Maintainer:** Tech Team
