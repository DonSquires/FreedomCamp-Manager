# Debug Recalculation Issue - Quick Steps

## 1. Check Browser Console (RIGHT NOW)

Open Chrome DevTools (F12) and look for these logs:
- `❌ Mutation error - Full object:` → Copy the entire error object
- `❌ Error type:` → Should show error class name
- `❌ Error instanceof FunctionsHttpError:` → Should be true or false
- `❌ Final error message:` → The actual error text

**PASTE THE OUTPUT HERE** and we can diagnose the exact issue.

---

## 2. Verify Edge Function is Deployed

Open terminal and run:

```bash
# Check if function exists
supabase functions list

# If NOT listed, deploy it:
supabase functions deploy recalculate-all-compliance

# Check deployment logs
supabase functions logs recalculate-all-compliance --limit 10
```

---

## 3. Get Your JWT Token for Testing

Open browser console on the Admin Recalculation page and run:

```javascript
// Get current session token
const session = await (await fetch('https://xbfnlzmpumthnjmtqufp.supabase.co/auth/v1/user', {
  headers: {
    'apikey': 'YOUR_ANON_KEY',
    'Authorization': 'Bearer ' + localStorage.getItem('sb-xbfnlzmpumthnjmtqufp-auth-token')
  }
})).json();

console.log('JWT Token:', session);
```

Or simpler:
```javascript
// From Supabase client
const { data: { session } } = await window.supabase.auth.getSession();
console.log('Access Token:', session?.access_token);
```

---

## 4. Test with CURL

Replace `YOUR_JWT_TOKEN` with the token from step 3:

```bash
curl -i --location --request POST "https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/recalculate-all-compliance" \
  --header "Authorization: Bearer YOUR_JWT_TOKEN" \
  --header "Content-Type: application/json" \
  --header "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhiZm5sem1wdW10aG5qbXRxdWZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY1NTU3NzIsImV4cCI6MjA1MjEzMTc3Mn0.DemoKeyReplaceMeWithActualKey" \
  --data '{
    "scope": "BUILD",
    "zoneIds": null,
    "orgIds": null,
    "dateRangeStart": null,
    "dateRangeEnd": null,
    "performedBy": "test"
  }'
```

**What to look for:**
- `HTTP/2 200` → Function works! Issue is in frontend
- `HTTP/2 404` → Function not deployed
- `HTTP/2 401` → JWT token invalid or expired
- `HTTP/2 403` → User doesn't have admin/master role
- `HTTP/2 500` → Function crashed (check logs)
- No response → Network/CORS issue

---

## 5. Quick Fixes Based on Error Type

### If "Network request failed" or CORS error:
```bash
# Check if function has CORS headers
# File: supabase/functions/_shared/cors.ts should exist
cat supabase/functions/_shared/cors.ts

# Re-deploy with CORS fix if needed
supabase functions deploy recalculate-all-compliance
```

### If "Function not found" (404):
```bash
# Deploy the function
supabase functions deploy recalculate-all-compliance

# Verify it's listed
supabase functions list
```

### If "Unauthorized" (401/403):
```sql
-- Check your user role
SELECT id, email, role, organization_id 
FROM user_profiles 
WHERE id = auth.uid();

-- Should show role = 'admin' or 'master'
-- If not, update it (as master user or direct SQL):
UPDATE user_profiles 
SET role = 'admin' 
WHERE email = 'your-email@example.com';
```

### If function crashes (500):
```bash
# Check real-time logs
supabase functions logs recalculate-all-compliance --tail

# Try to invoke manually and watch logs
```

---

## 6. Most Likely Issues

Based on the error message "Failed to send a request to the Edge Function", the most likely causes are:

### Cause A: Function Not Deployed (90% probability)
**Fix:** Run `supabase functions deploy recalculate-all-compliance`

### Cause B: CORS Headers Missing (5% probability)
**Check:** Does `supabase/functions/_shared/cors.ts` exist?
**Fix:** If missing, create it with:
```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
```

### Cause C: Network/DNS Issue (3% probability)
**Check:** Can you access `https://xbfnlzmpumthnjmtqufp.supabase.co` in browser?
**Fix:** Check internet connection, firewall, VPN

### Cause D: Supabase Project Paused (2% probability)
**Check:** Log into Supabase dashboard → Check project status
**Fix:** Resume project if paused

---

## Next Steps

1. **Check browser console NOW** - Copy all error logs
2. **Run `supabase functions list`** - Is `recalculate-all-compliance` listed?
3. **If not listed** → Deploy it: `supabase functions deploy recalculate-all-compliance`
4. **If listed** → Test with CURL to isolate issue
5. **Report back** with console output and CURL response

---

## Emergency Workaround (If Nothing Works)

If you need to populate compliance_results immediately while debugging the Edge Function:

```sql
-- Direct SQL recalculation (runs in database, bypasses Edge Function)
-- WARNING: This is slow for large datasets, use only for testing

DO $$
DECLARE
  obs RECORD;
  compliance JSONB;
BEGIN
  FOR obs IN 
    SELECT observation_id, vehicle_id, zone_id, organization_id, recorded_at
    FROM vehicle_observations
    WHERE NOT EXISTS (
      SELECT 1 FROM compliance_results 
      WHERE compliance_results.observation_id = vehicle_observations.observation_id
    )
    LIMIT 100 -- Process 100 at a time
  LOOP
    -- Get vehicle plate
    SELECT plate_number INTO STRICT compliance
    FROM canonical_vehicles
    WHERE vehicle_id = obs.vehicle_id;
    
    -- Calculate compliance (this calls the database function)
    -- Add compliance result insert here
    
    RAISE NOTICE 'Processed observation %', obs.observation_id;
  END LOOP;
END $$;
```

**Better Workaround:** Fix the Edge Function deployment - it's the proper solution.
