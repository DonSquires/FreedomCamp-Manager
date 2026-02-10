# Live Officer Tracking Troubleshooting

## Issue: Officer Not Appearing in Live Tracking

**User:** squires.don@live.com  
**Expected:** Should appear on live tracking map  
**Actual:** Not visible

---

## Root Cause Analysis

Live Officer Tracking displays officers based on data in the `officer_activity_log` table, queried via the `get_live_officer_locations()` RPC function.

### Requirements for Visibility:

1. ✅ **User must be logged in** - Officer authenticated
2. ✅ **Field Officer Portal active** - Not Admin Portal
3. ✅ **GPS permission granted** - Browser location access allowed
4. ✅ **GPS accuracy acceptable** - Must be < 100m accuracy
5. ✅ **Welfare ping fired** - At least one 30-second GPS ping recorded
6. ✅ **Recent activity** - Within RPC function's time window (likely 15 minutes)

---

## Diagnostic Steps

### 1. Check Officer Activity Log

Run this query in Supabase SQL Editor to see if ANY GPS updates exist for this user:

```sql
-- Find user_id for squires.don@live.com
SELECT id, email, first_name, last_name, organization_id, role
FROM user_profiles
WHERE email = 'squires.don@live.com';

-- Check recent GPS activity (replace USER_ID with actual ID from above)
SELECT 
  activity_type,
  gps_latitude,
  gps_longitude,
  gps_accuracy,
  recorded_at,
  created_at
FROM officer_activity_log
WHERE user_id = 'USER_ID'
ORDER BY created_at DESC
LIMIT 10;
```

### 2. Check RPC Function Output

```sql
-- See all officers currently visible in live tracking
SELECT * FROM get_live_officer_locations();
```

### 3. Verify Welfare Monitoring is Active

In Field Officer Portal:
- Open browser console (F12)
- Look for GPS ping logs: `💓 Welfare ping: -41.270600, 173.284000 (±45m)`
- Should appear every 30 seconds

---

## Quick Fix Steps

### For Officer (squires.don@live.com):

1. **Switch to Field Officer Portal:**
   - If currently in Admin Portal, click "Switch to Field Portal" button
   - URL should show field officer interface

2. **Enable GPS:**
   - When prompted, click "Allow" for location access
   - Grant "Precise location" (not approximate)

3. **Activate GPS Tracking:**
   - Navigate to Dashboard or Scanning screen
   - GPS tracking starts automatically
   - Check browser console for GPS logs

4. **Wait for First Ping:**
   - Wait 30 seconds for first welfare ping
   - Console should show: `💓 Welfare ping: LAT, LNG (±XXm)`
   - If accuracy > 100m, wait for better GPS signal

5. **Verify in Live Tracking:**
   - Admin can refresh Live Officer Tracking page
   - Officer should now appear on map with green marker

---

## Expected Console Logs (Field Officer Portal)

When GPS tracking is working correctly, you should see:

```
📍 GPS Update: -41.270600, 173.284000 (±45m)
✅ GPS tracking started with 30s welfare ping interval
💓 Welfare ping: -41.270600, 173.284000 (±45m)
✅ GPS activity recorded
```

---

## Common Issues & Solutions

### Issue: GPS Permission Denied
**Solution:** 
- Chrome: Settings → Privacy → Site Settings → Location → Allow
- Safari: Settings → Safari → Location → Allow

### Issue: GPS Accuracy Too Low (>100m)
**Solution:**
- Move to open area (away from buildings)
- Wait 1-2 minutes for GPS to stabilize
- Indoor GPS can be 100-500m accuracy

### Issue: No Console Logs at All
**Solution:**
- Refresh page
- Check if GPS permission was granted
- Try different browser (Chrome recommended)

### Issue: GPS Updates But Not in Database
**Solution:**
- Check RLS policies on `officer_activity_log`
- Verify user organization_id exists
- Check `recordGPSUpdate()` function for errors

---

## RPC Function Logic

The `get_live_officer_locations()` function likely filters:
- Only officers with GPS updates in last 15 minutes
- Only gps_update activity types
- Groups by user to get latest location

---

## Testing Checklist

- [ ] User logged into Field Officer Portal (not Admin)
- [ ] GPS permission granted in browser
- [ ] GPS accuracy < 100m
- [ ] Console shows GPS ping logs every 30 seconds
- [ ] At least 30 seconds elapsed since login
- [ ] Live tracking page refreshed
- [ ] No RLS policy errors in console

---

## Expected Timeline

From login to visibility:
1. **0s:** Officer logs into Field Portal
2. **5s:** GPS permission requested and granted
3. **10s:** First high-accuracy GPS fix obtained
4. **30s:** First welfare ping fires → GPS recorded to database
5. **35s:** Officer appears in Live Tracking (after admin refreshes)

---

## Contact Support

If issue persists after following all steps:
- Email: contact@onspace.ai
- Include: Browser console logs, user email, timestamp
