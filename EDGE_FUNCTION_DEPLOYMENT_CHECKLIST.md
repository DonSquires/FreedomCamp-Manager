# Edge Function Deployment & Testing Checklist

## Issue Summary
Users report "Failed to send a request" errors when calling `recalculate-all-compliance` Edge Function. This checklist helps diagnose and fix deployment issues.

---

## Step 1: Verify Edge Function Deployment

### Check Deployed Functions
```bash
# List all deployed Edge Functions
supabase functions list

# Expected output should include:
# - recalculate-all-compliance
# - process-field-scan
# - get-compliance-statistics
```

### Deploy Missing Functions
```bash
# Deploy specific function
supabase functions deploy recalculate-all-compliance

# Or deploy all functions
supabase functions deploy
```

---

## Step 2: Verify Environment Variables

### Required Environment Variables (Auto-configured)
These are automatically available in Edge Functions:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`

### Verify via Edge Function Logs
```bash
# Check function logs for environment variable errors
supabase functions logs recalculate-all-compliance --tail
```

**Look for:**
- ❌ `Missing authorization header` → Frontend not passing auth token
- ❌ `Unauthorized - invalid token` → Auth token expired/invalid
- ❌ `Insufficient permissions` → User doesn't have admin/master role
- ❌ `Invalid scope` → Scope parameter not 'ZONE', 'ORG', or 'BUILD'

---

## Step 3: Test Edge Function Directly

### Test 1: Simple CURL Test (Check if function responds)
```bash
# Get your anon key and project URL from Supabase dashboard
SUPABASE_URL="https://xbfnlzmpumthnjmtqufp.supabase.co"
ANON_KEY="your-anon-key-here"
USER_TOKEN="your-user-jwt-token-here"

# Test with minimal payload (BUILD scope, all time)
curl -i --location --request POST "${SUPABASE_URL}/functions/v1/recalculate-all-compliance" \
  --header "Authorization: Bearer ${USER_TOKEN}" \
  --header "Content-Type: application/json" \
  --header "apikey: ${ANON_KEY}" \
  --data '{"scope":"BUILD","performedBy":"user-id-here"}'
```

**Expected Response:**
- ✅ Status 200 with `{"success":true,"actionId":"...","summary":{...}}`
- ❌ Status 401 → Auth issue (check token)
- ❌ Status 403 → Permission issue (check user role)
- ❌ Status 400 → Invalid parameters
- ❌ Status 500 → Internal server error (check function logs)

### Test 2: Zone-specific Recalculation
```bash
# Replace with actual zone ID from your database
curl -i --location --request POST "${SUPABASE_URL}/functions/v1/recalculate-all-compliance" \
  --header "Authorization: Bearer ${USER_TOKEN}" \
  --header "Content-Type: application/json" \
  --header "apikey: ${ANON_KEY}" \
  --data '{
    "scope":"ZONE",
    "zoneIds":["zone-uuid-here"],
    "dateRangeStart":"2025-01-01",
    "dateRangeEnd":"2025-01-31",
    "performedBy":"user-id-here"
  }'
```

---

## Step 4: Check Database Function

The Edge Function calls `calculate_vehicle_compliance()` PostgreSQL function. Verify it exists:

```sql
-- Check if function exists
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'calculate_vehicle_compliance';

-- Expected: Should return 1 row with routine_type = 'FUNCTION'
```

### If Function Missing
The function should have been created by migrations. Check:
```bash
# Review migration files
ls supabase/migrations/

# Expected to see migration files creating:
# - calculate_vehicle_compliance()
# - zone_compliance_matrix table
# - observations compliance fields / triggers
```

---

## Step 5: Frontend Debugging

### Check Browser Network Tab
1. Open Chrome DevTools → Network tab
2. Trigger recalculation in AdminRecalculation page
3. Find the request to `recalculate-all-compliance`
4. Check:
   - **Request Headers** → Should include `Authorization: Bearer ...`
   - **Request Payload** → Should include `scope`, `zoneIds`/`orgIds`, dates
   - **Response Status** → Should be 200
   - **Response Body** → Should include `success: true`

### Common Frontend Issues

**Issue 1: "Failed to send a request to the Edge Function"**
```typescript
// This error comes from error handling in AdminRecalculation.tsx
// Check console for actual error details

// If you see FunctionsHttpError, the function returned non-2xx status
// Check the error.context.text() for server error message
```

**Issue 2: Authentication Token Missing**
```typescript
// Supabase client should automatically include auth token
// If missing, check that user is logged in:
const { user } = useAuthStore();
console.log('Current user:', user);

// Verify Supabase client has session:
const { data: { session } } = await supabase.auth.getSession();
console.log('Session:', session);
```

---

## Step 6: Check Observations Compliance Fields

After running recalculation, verify compliance fields were written on observations:

```sql
-- Check if observations include compliance states
SELECT
  COUNT(*) AS total_observations,
  COUNT(*) FILTER (WHERE is_compliant = false) AS non_compliant_observations
FROM observations;

-- Check recent evaluated observations
SELECT 
  o.observation_id,
  o.is_compliant,
  o.recorded_at,
  o.plate_number,
  z.name as zone_name,
  o.breach_type,
  o.breach_reason
FROM observations o
LEFT JOIN zones z ON z.id = o.zone_id
ORDER BY o.recorded_at DESC
LIMIT 10;
```

**If Zero Records:**
1. Check if `observations` table has data
2. Check if `zone_compliance_matrix` has active matrices
3. Check Edge Function logs for processing errors

---

## Step 7: Investigate Zero Observations in ComplianceMatrixManagement

**Symptom:** Stats page shows "Total observations: 0" despite recorded field data.

**Possible Causes:**
1. **No non-compliant observations found** → Ingest/compliance path may not be setting `is_compliant` and breach fields
2. **Matrix created after observations** → Observations recorded before matrix existed
3. **Query filtering out results** → Date range or zone filter too restrictive

**Debug Query:**
```sql
-- Check observations count for a zone
SELECT 
  z.name as zone_name,
  COUNT(o.observation_id) as total_observations,
  COUNT(*) FILTER (WHERE o.is_compliant = false) as total_non_compliant
FROM zones z
LEFT JOIN observations o ON o.zone_id = z.id
WHERE z.is_active = true
GROUP BY z.id, z.name
ORDER BY total_observations DESC;
```

**Fix:** Run recalculation for affected zones to populate missing observations compliance fields.

---

## Step 8: Real-time Subscription Test

The AdminRecalculation page uses Supabase Realtime to track progress. Test it:

```sql
-- Manually trigger an update to test subscription
UPDATE admin_recalculation_actions
SET observations_processed = 100,
    compliance_changed = 25
WHERE id = 'test-action-id';
```

**Expected:** Progress bars in AdminRecalculation page should update immediately.

**If not updating:**
1. Check browser console for Realtime connection errors
2. Verify Realtime is enabled in Supabase project settings
3. Check RLS policies on `admin_recalculation_actions` table

---

## Quick Fixes Checklist

- [ ] Edge Function deployed (`supabase functions deploy recalculate-all-compliance`)
- [ ] Environment variables configured (auto-configured, verify via logs)
- [ ] Database function exists (`calculate_vehicle_compliance()`)
- [ ] User has admin/master role
- [ ] Zone compliance matrix exists and is active
- [ ] Vehicle observations exist in database
- [ ] RLS policies allow access to required tables
- [ ] Frontend auth token is valid
- [ ] CORS headers configured in Edge Function (`_shared/cors.ts`)
- [ ] Supabase project is not paused/sleeping

---

## Next Steps Based on Test Results

### If CURL test succeeds but frontend fails
→ Issue is in frontend code or browser
- Check browser console for errors
- Verify Supabase client initialization
- Check auth token validity

### If CURL test fails with 401/403
→ Issue is with authentication/authorization
- Verify user has admin/master role in database
- Check JWT token is valid and not expired
- Verify RLS policies

### If CURL test fails with 500
→ Issue is in Edge Function logic
- Check Edge Function logs
- Verify database function exists
- Check database connectivity

### If everything works but results are zero
→ Issue is with data or logic
- Run recalculation with BUILD scope to populate observations compliance fields
- Check zone compliance matrix has active versions
- Verify observations exist for the date range

---

## Support Commands

```bash
# View Edge Function logs (real-time)
supabase functions logs recalculate-all-compliance --tail

# View Edge Function logs (recent)
supabase functions logs recalculate-all-compliance --limit 100

# Check project status
supabase status

# Test database connection
supabase db remote commit --dry-run
```
