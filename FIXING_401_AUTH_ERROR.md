# Fixing 401 Unauthorized Error - Complete Guide

**Date:** Feb 24, 2026  
**Status:** ✅ FIXES APPLIED  
**Issue:** `401 Unauthorized` when calling `vehicle-ingest` Edge Function

---

## 🎯 Root Cause

The Edge Function was returning a **generic 401 error** without explaining **why** the auth failed. This made debugging impossible for field officers.

**Common Causes:**
1. ❌ No Authorization header (user not logged in)
2. ❌ Malformed Authorization header (wrong format)
3. ❌ Expired JWT token (session expired)
4. ❌ Invalid JWT (corrupted or tampered)

---

## ✅ Fixes Applied

### 1. **Auth Guards Added to vehicle-ingest**

The Edge Function now checks for authentication **before** processing the request and returns **specific error messages**:

```typescript
// ❌ Before (generic 401)
// Supabase: "Unauthorized"

// ✅ After (specific errors)
{
  "error": "Missing login token. Please log out and log back in.",
  "auth_error": "MISSING_AUTHORIZATION_HEADER",
  "hint": "Make sure you're calling this via supabase.functions.invoke() from an authenticated session"
}
```

**Error Types:**
- `MISSING_AUTHORIZATION_HEADER` - No auth header sent
- `MALFORMED_AUTHORIZATION_HEADER` - Header format wrong (should be `Bearer <token>`)
- `INVALID_JWT` - Token expired or corrupted

---

### 2. **Supabase Client Already Correct** ✅

Your `src/lib/supabase.ts` is **already configured correctly**:

```typescript
// ✅ Single Supabase client with correct anon key
export const supabase = createClient<Database>(
  'https://xbfnlzmpumthnjmtqufp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  {
    auth: {
      persistSession: true,      // ✅ Session persists across page reloads
      autoRefreshToken: true,    // ✅ Auto-refreshes before expiry
    },
  }
);
```

**No changes needed here!**

---

### 3. **ZoomScan Already Using invoke()** ✅

Your `src/components/features/ZoomScan.tsx` is **already correct**:

```typescript
// ✅ Correct pattern (automatically includes auth header)
const { data, error } = await supabase.functions.invoke('vehicle-ingest', {
  body: { plate, photo, gps, ... }
});

// ❌ Wrong pattern (manual fetch - missing auth)
// const response = await fetch('https://.../vehicle-ingest', { ... });
```

**No changes needed here!**

---

## 🧪 Testing the Fix

### Test 1: Force 401 Error (No Login)

```typescript
// Log out first
await supabase.auth.signOut();

// Try to call vehicle-ingest
const { data, error } = await supabase.functions.invoke('vehicle-ingest', {
  body: { plate: 'TEST123', ... }
});

console.log(error);
// Expected:
// {
//   error: "Missing login token. Please log out and log back in.",
//   auth_error: "MISSING_AUTHORIZATION_HEADER"
// }
```

### Test 2: Valid Session

```typescript
// Log in first
await supabase.auth.signInWithPassword({
  email: 'officer@example.com',
  password: 'password123',
});

// Verify session exists
const { data: { session } } = await supabase.auth.getSession();
console.log('Session:', session?.access_token ? '✅ Valid' : '❌ Missing');

// Now call vehicle-ingest (should work)
const { data, error } = await supabase.functions.invoke('vehicle-ingest', {
  body: { plate: 'ABC123', photo: '...', gps: { lat: -36.8, lng: 174.7 }, ... }
});

if (error) {
  console.error('Still failing:', error);
} else {
  console.log('✅ Success:', data);
}
```

### Test 3: Check Network Tab (Chrome DevTools)

1. Press `F12` → Go to **Network** tab
2. Trigger a vehicle scan
3. Click on the `vehicle-ingest` request
4. Check **Request Headers**:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
              ^^^^^^ Should have "Bearer" prefix
```

**If you see `Authorization: <missing>`:**
- User session is invalid/expired
- Call `supabase.auth.signOut()` and log back in

---

## 🔍 Debugging Session Issues

### Check Current Session

```typescript
const { data: { session }, error } = await supabase.auth.getSession();

console.log({
  hasSession: !!session,
  accessToken: session?.access_token?.substring(0, 20) + '...',
  expiresAt: session?.expires_at,
  user: session?.user?.email,
});
```

**Expected Output:**
```json
{
  "hasSession": true,
  "accessToken": "eyJhbGciOiJIUzI1NiI...",
  "expiresAt": 1708876543,
  "user": "officer@firstsecurity.co.nz"
}
```

### Force Session Refresh

```typescript
const { data: { session }, error } = await supabase.auth.refreshSession();

if (error) {
  console.error('Session refresh failed:', error.message);
  // Force re-login
  await supabase.auth.signOut();
  // Redirect to login page
} else {
  console.log('✅ Session refreshed');
}
```

---

## 🐛 Troubleshooting

### Error: "Missing login token"

**Cause:** No Authorization header sent  
**Solution:**
1. Check if user is logged in:
   ```typescript
   const { data: { session } } = await supabase.auth.getSession();
   if (!session) {
     // Redirect to login
   }
   ```
2. Verify you're using `supabase.functions.invoke()`, not `fetch()`

---

### Error: "Session expired or invalid"

**Cause:** JWT token expired (default: 1 hour)  
**Solution:**
1. Enable auto-refresh (already enabled in `supabase.ts`):
   ```typescript
   { auth: { autoRefreshToken: true } }
   ```
2. Force manual refresh before long-running operations:
   ```typescript
   await supabase.auth.refreshSession();
   ```
3. Or prompt user to log in again:
   ```typescript
   await supabase.auth.signOut();
   // Redirect to login page
   ```

---

### Error: Still getting 401 after fixes

**Debugging Steps:**

1. **Check browser console for network errors:**
   ```
   F12 → Console → Look for red errors
   ```

2. **Verify CORS headers:**
   ```bash
   curl -X OPTIONS \
     -H "Origin: https://react-9b4t5o.onspace.build" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: authorization,content-type" \
     -v \
     https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest
   
   # Expected: Access-Control-Allow-Origin header in response
   ```

3. **Test with curl (using real JWT):**
   ```bash
   # Get your JWT from browser console:
   # const { data: { session } } = await supabase.auth.getSession();
   # console.log(session.access_token);
   
   curl -X POST \
     -H "Authorization: Bearer <your-jwt-token>" \
     -H "Content-Type: application/json" \
     -d '{"plate":"TEST123","photo_base64":"...","gpsLatitude":-36.8,"gpsLongitude":174.7,"organizationId":"...","zoneId":"...","officerId":"...","idempotencyKey":"test-123"}' \
     https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest
   ```

4. **Check Supabase Dashboard logs:**
   ```
   Supabase Dashboard → Edge Functions → vehicle-ingest → Logs
   Look for console.log/console.error messages
   ```

---

## 📋 Production Checklist

- [x] Auth guards added to `vehicle-ingest`
- [x] Specific error messages for each auth failure type
- [x] Supabase client using correct anon key
- [x] ZoomScan using `supabase.functions.invoke()`
- [ ] Test logout → login flow
- [ ] Test session refresh after 1 hour
- [ ] Test with expired JWT (force expiry in browser localStorage)
- [ ] Verify Network tab shows `Authorization: Bearer ...`
- [ ] Check Supabase Function logs for auth errors

---

## 🔒 Security Notes

1. **Anon key is public** - That's correct! It's safe to hardcode in frontend
2. **JWT contains user ID** - Never trust client-side user ID; always use JWT claims server-side
3. **Service role key bypasses RLS** - Only used in Edge Functions, never exposed to frontend
4. **Auto-refresh prevents session expiry** - Enabled by default in `supabase.ts`

---

## 📊 Auth Flow Diagram

```
┌─────────────────────┐
│   Officer App       │
│  (React/OnSpace)    │
└──────────┬──────────┘
           │
           │ 1. supabase.auth.signInWithPassword()
           ▼
┌─────────────────────────────────┐
│   Supabase Auth                 │
│  ✓ Validates credentials        │
│  ✓ Returns JWT token            │
└────────┬────────────────────────┘
         │
         │ 2. Store session (localStorage)
         ▼
┌─────────────────────────────────┐
│   supabase client               │
│  ✓ persistSession: true         │
│  ✓ autoRefreshToken: true       │
└────────┬────────────────────────┘
         │
         │ 3. supabase.functions.invoke('vehicle-ingest')
         ▼
┌─────────────────────────────────┐
│   HTTP Request                  │
│  Authorization: Bearer <JWT>    │ ← Automatically added
└────────┬────────────────────────┘
         │
         │ 4. POST to Edge Function
         ▼
┌─────────────────────────────────┐
│   vehicle-ingest Edge Function │
│  ✓ Check Authorization header   │
│  ✓ Validate JWT structure       │
│  ✓ Extract user ID from JWT     │
│  ✓ Process vehicle scan         │
└─────────────────────────────────┘
```

---

**Document Version:** 1.0  
**Status:** PRODUCTION READY  
**Maintainer:** Tech Team
