# CORS Migration Guide

## Background

The FreedomCamp Manager project has two CORS implementations:

1. **`_shared/cors.ts`** (LEGACY - NOT SECURE)
   - Uses `Access-Control-Allow-Origin: *` (wildcard)
   - Allows any domain to make requests
   - **65 functions currently use this**

2. **`_shared/withCors.ts`** (SECURE - USE THIS)
   - Strict origin allowlist
   - Preview subdomain pattern matching
   - Dev mode toggle (disabled in production)
   - **7 functions currently use this**

## Why This Matters

Using wildcard CORS (`*`) in production allows:
- Any website to make authenticated API calls on behalf of users
- Cross-site request forgery (CSRF) attacks
- Data exfiltration from any malicious site

## Migration Steps

### Step 1: Identify Functions Using Legacy CORS

```bash
# List all functions using legacy cors.ts
grep -l "from.*cors.ts" supabase/functions/*/index.ts
```

### Step 2: Update Import Statement

**Before:**
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
```

**After:**
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
```

### Step 3: Wrap Handler with withCors

**Before:**
```typescript
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ... function logic ...
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
```

**After:**
```typescript
serve(withCors(async (req) => {
  // No need to handle OPTIONS - withCors does it automatically
  // No need to add CORS headers manually
  
  try {
    // ... function logic ...
    return jsonResponse(data, req)
  } catch (error) {
    return errorResponse(error.message, req, 500)
  }
}))
```

### Step 4: Use Helper Functions

The `withCors.ts` module provides helper functions:

```typescript
// Success response with CORS headers
jsonResponse(data, req, status = 200)

// Error response with CORS headers and correlation ID
errorResponse(message, req, status = 500, details?)
```

## Priority Functions to Migrate

These functions handle sensitive data and should be migrated first:

| Priority | Function | Reason |
|----------|----------|--------|
| 🔴 Critical | `create-user` | Creates auth users |
| 🔴 Critical | `set-user-password` | Password changes |
| 🔴 Critical | `process-face-scan` | Biometric data |
| 🔴 Critical | `generate-infringement` | Legal documents |
| 🟠 High | `send-report-email` | Org-specific SMTP |
| 🟠 High | `public-case-lookup` | Public endpoint |
| 🟠 High | `import-data` | Bulk data operations |
| 🟡 Medium | All others | General security |

## Testing After Migration

1. Test from allowed origin:
   ```bash
   curl -H "Origin: https://fcmanager.co.nz" \
        -H "Authorization: Bearer TOKEN" \
        https://YOUR_PROJECT.supabase.co/functions/v1/your-function
   ```

2. Test from disallowed origin (should be blocked):
   ```bash
   curl -H "Origin: https://malicious-site.com" \
        -H "Authorization: Bearer TOKEN" \
        https://YOUR_PROJECT.supabase.co/functions/v1/your-function
   ```

3. Test preflight:
   ```bash
   curl -X OPTIONS \
        -H "Origin: https://fcmanager.co.nz" \
        -H "Access-Control-Request-Method: POST" \
        https://YOUR_PROJECT.supabase.co/functions/v1/your-function
   ```

## Environment Configuration

The `withCors.ts` respects these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `ENVIRONMENT` | Set to `production` or `prod` for strict mode | `development` |
| `DEV_CORS` | Set to `true` for wildcard in dev (ignored in production) | `false` |

## Tracking Progress

Create a GitHub issue to track migration:

```markdown
## CORS Migration Tracker

### Completed
- [ ] check-railway-health
- [ ] ... (add as completed)

### In Progress
- [ ] create-user
- [ ] ... (add as working)

### Remaining (65 functions)
- [ ] alpr-process
- [ ] analyze-vehicle-photo
- [ ] ... (list all)
```

## Rollback

If issues occur after migration, you can temporarily revert by:

1. Re-adding the legacy import
2. Setting `DEV_CORS=true` (development only)

**⚠️ Never enable DEV_CORS in production environments.**
