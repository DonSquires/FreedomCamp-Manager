# Supabase Client - Best Practices & Common Pitfalls

**Last Updated:** Feb 22, 2026  
**Status:** ✅ PRODUCTION GUIDANCE

---

## 🎯 Quick Reference

### ✅ DO's
- Use `supabase.functions.invoke()` for Edge Functions
- Use `.maybeSingle()` when row might not exist
- Use `.single()` only when row MUST exist
- Include `.select()` to avoid fetching all columns
- Handle errors explicitly (check `error` before using `data`)
- Use auth automatically via SDK (don't manually set Authorization header)

### ❌ DON'Ts
- Raw `fetch()` for PostgREST queries (use SDK)
- `.single()` when row might be missing (causes 406 error)
- Ignoring errors (always check `error` before using `data`)
- Hard-coded API keys in frontend code
- Missing Accept headers in raw fetch (use SDK to avoid this)

---

## 📚 Common Patterns

### Pattern 1: Edge Function Invocation

**❌ Wrong (raw fetch):**
```typescript
const response = await fetch(`${SUPABASE_URL}/functions/v1/vehicle-ingest`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`, // Manual auth
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});
```

**✅ Correct (SDK):**
```typescript
const { data, error } = await supabase.functions.invoke('vehicle-ingest', {
  body: payload,
});

if (error) {
  // Handle error - check for FunctionsHttpError for detailed errors
  if (error instanceof FunctionsHttpError) {
    const statusCode = error.context?.status ?? 500;
    const errorText = await error.context?.text() || error.message;
    console.error(`Function error [${statusCode}]:`, errorText);
  }
  throw error;
}

return data;
```

### Pattern 2: Query for Optional Row

**❌ Wrong (causes 406 when row doesn't exist):**
```typescript
const { data } = await supabase
  .from('investigation_jobs')
  .select('id')
  .eq('assigned_to', userId)
  .eq('status', 'in_progress')
  .limit(1)
  .single(); // ⚠️ Throws 406 if no matching row
```

**✅ Correct (gracefully handles missing row):**
```typescript
const { data } = await supabase
  .from('investigation_jobs')
  .select('id')
  .eq('assigned_to', userId)
  .eq('status', 'in_progress')
  .limit(1)
  .maybeSingle(); // ✅ Returns null if no matching row

const hasActiveJob = !!data;
```

### Pattern 3: Query for Required Row

**✅ Correct (when row MUST exist):**
```typescript
const { data, error } = await supabase
  .from('user_profiles')
  .select('*')
  .eq('id', userId)
  .single(); // ✅ OK because user profile must exist

if (error) {
  console.error('Failed to fetch user profile:', error);
  throw new Error('User profile not found');
}

return data;
```

### Pattern 4: CSV/Binary Response from Edge Function

**✅ Correct (use raw fetch for binary responses):**
```typescript
// For CSV exports, raw fetch is required because Supabase SDK
// tries to parse responses as JSON

const { data: { session } } = await supabase.auth.getSession();
if (!session) throw new Error('Not authenticated');

const response = await fetch(`${supabase.supabaseUrl}/functions/v1/observations-export`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`, // Use SDK session
    'apikey': supabase.supabaseKey,
  },
  body: JSON.stringify(filters),
});

if (!response.ok) {
  const errorData = await response.json();
  throw new Error(errorData.error || 'Export failed');
}

const blob = await response.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'export.csv';
a.click();
URL.revokeObjectURL(url);
```

---

## 🐛 Common Errors & Fixes

### Error 1: 406 Not Acceptable

**Symptom:**
```
GET .../rest/v1/investigation_jobs?select=id&assigned_to=eq.xxx&status=eq.in_progress&limit=1
406 (Not Acceptable)
```

**Cause:** Using `.single()` when no matching row exists

**Fix:**
```typescript
// Before (❌)
.single()

// After (✅)
.maybeSingle()
```

### Error 2: Missing Authorization Header

**Symptom:**
```
{ error: "Missing authorization header" }
```

**Cause:** Raw fetch without auth token or using Edge Function without authenticated client

**Fix:**
```typescript
// Ensure you're using authenticated Supabase client
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  // Redirect to login
  return;
}

// SDK automatically includes Authorization header
const { data, error } = await supabase.functions.invoke('function-name', {
  body: payload,
});
```

### Error 3: CORS Policy Violation

**Symptom:**
```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

**Cause:** Edge Function doesn't include your domain in CORS allowlist

**Fix:** Add your domain to `_shared/cors.ts`:
```typescript
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://react-9b4t5o.onspace.build',
  'https://your-custom-domain.com', // Add this
];
```

### Error 4: Function Returns JSON Instead of CSV

**Symptom:** CSV download opens as JSON in browser

**Cause:** Using `supabase.functions.invoke()` for binary responses

**Fix:** Use raw `fetch()` for binary/CSV responses (see Pattern 4 above)

---

## 🔒 Security Checklist

- [ ] **Never expose service role key in frontend code**
- [ ] **Always use anon key for browser clients**
- [ ] **Rely on RLS for data access control** (not frontend filtering)
- [ ] **Validate auth session before sensitive operations**
- [ ] **Use HTTPS for all API calls** (enforced by Supabase)
- [ ] **Don't log sensitive data** (tokens, passwords, personal info)
- [ ] **Handle errors without leaking schema** (don't expose table names in user-facing errors)

---

## 📊 Performance Tips

1. **Select only needed columns:**
   ```typescript
   // ❌ Slow (fetches all columns)
   .select('*')
   
   // ✅ Fast (fetches only needed columns)
   .select('id, name, created_at')
   ```

2. **Use indexes for filters:**
   - Ensure columns used in `.eq()`, `.gte()`, `.lte()` have indexes
   - Check: `supabase/migrations/20260222_performance_indexes.sql`

3. **Paginate large datasets:**
   ```typescript
   .range(0, 49) // First 50 rows
   .range(50, 99) // Next 50 rows
   ```

4. **Cache static data:**
   - Use React Query for server state caching
   - Set appropriate `staleTime` and `cacheTime`

5. **Debounce search inputs:**
   ```typescript
   const debouncedSearch = useMemo(
     () => debounce((value: string) => {
       setSearch(value);
     }, 300),
     []
   );
   ```

---

## 🧪 Testing Checklist

Before deploying changes that use Supabase client:

- [ ] **Test with empty result sets** (ensure `.maybeSingle()` handles no rows)
- [ ] **Test with network errors** (ensure error handling shows user-friendly messages)
- [ ] **Test auth expiration** (ensure refresh token works)
- [ ] **Test offline mode** (if using offline queue)
- [ ] **Check browser console** (no 406 errors, no CORS errors)
- [ ] **Verify RLS policies** (users can only access their data)
- [ ] **Load test with large datasets** (ensure pagination works)

---

## 📞 Troubleshooting Guide

### Step 1: Check Console Errors
1. Open browser DevTools (F12)
2. Check Console tab for error messages
3. Note error codes (406, 401, 500, etc.)
4. Check Network tab for failed requests

### Step 2: Common Fixes
- **406 Error:** Change `.single()` to `.maybeSingle()`
- **401 Error:** Check auth session is valid
- **CORS Error:** Add domain to Edge Function allowlist
- **500 Error:** Check Edge Function logs

### Step 3: Verify Configuration
```typescript
// Check Supabase client is initialized
console.log('Supabase URL:', supabase.supabaseUrl);
console.log('Has auth session:', !!(await supabase.auth.getSession()).data.session);
```

### Step 4: Test Query Directly
```typescript
// Test query in isolation
const { data, error, count } = await supabase
  .from('your_table')
  .select('*', { count: 'exact' })
  .limit(1);

console.log('Query result:', { data, error, count });
```

---

## 🎓 Additional Resources

- **Supabase JS Docs:** https://supabase.com/docs/reference/javascript
- **PostgREST API Docs:** https://postgrest.org/en/stable/
- **RLS Examples:** https://supabase.com/docs/guides/auth/row-level-security
- **Edge Functions Guide:** https://supabase.com/docs/guides/functions

---

## ✅ Key Takeaways

1. **Always use the SDK** - Don't reinvent auth, CORS, headers
2. **Know when to use `.single()` vs `.maybeSingle()`** - Prevents 406 errors
3. **Handle errors explicitly** - Check `error` before using `data`
4. **Use raw fetch only for binary responses** - CSV, PDF, images
5. **Trust RLS, not frontend filtering** - Security happens on the server

---

**Document Version:** 1.0  
**Maintainer:** Tech Team  
**Status:** APPROVED FOR PRODUCTION
