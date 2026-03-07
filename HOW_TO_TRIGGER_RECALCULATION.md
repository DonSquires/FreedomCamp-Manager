# How to Trigger Compliance Recalculation

## Quick Start Guide

### Step 1: Access Admin Recalculation Page
1. Log in as an **Admin** or **Master** user
2. Navigate to **Admin Portal** → **Compliance Matrix Management** → **Admin Recalculation** tab

### Step 2: Configure Recalculation Scope

#### Option A: Recalculate Specific Zones
1. **Scope Type:** Select "Zone(s)"
2. **Select Zones:** Check one or more zones from the list
3. **Date Range:** Choose preset (e.g., "Last 30 Days") or custom range
4. Click **Start Recalculation**

#### Option B: Recalculate Entire Organization
1. **Scope Type:** Select "Organization(s)"
2. **Select Organizations:** Check one or more organizations
3. **Date Range:** Choose preset or custom range
4. Click **Start Recalculation**

#### Option C: Recalculate Everything (System-Wide)
1. **Scope Type:** Select "Entire System"
2. **Date Range:** Choose "All Time" or specific range
3. ⚠️ **Warning:** This processes ALL observations across ALL zones
4. Click **Start Recalculation**

### Step 3: Monitor Progress
- Progress updates in **real-time** via Supabase Realtime
- Watch the progress bar and counters:
  - **Processed:** Total observations recalculated
  - **Changed:** Compliance status changed
  - **Drift Events:** Matrix version changes detected

### Step 4: Review Results
- Check **Recent Recalculations** section for history
- View drift events in **Drift Dashboard**
- Verify compliance results in **Compliance Analytics**

---

## Example Scenarios

### Scenario 1: New Zone Created
**Problem:** Zone "Beach Reserve" was just created with a compliance matrix, but shows 0 observations.

**Solution:**
1. Scope: **Zone(s)**
2. Select: **Beach Reserve**
3. Date Range: **All Time**
4. Run recalculation → This will evaluate all historical observations for that zone

### Scenario 2: Matrix Rules Changed
**Problem:** Changed "Max Consecutive Nights" from 3 to 2 for all zones in "Nelson City Council" organization.

**Solution:**
1. Scope: **Organization(s)**
2. Select: **Nelson City Council**
3. Date Range: **Last 90 Days** (to reprocess recent data)
4. Run recalculation → This creates drift events showing which vehicles became non-compliant

### Scenario 3: Fix Data After Bug
**Problem:** A bug in the scanning process incorrectly marked some vehicles as non-compliant last week.

**Solution:**
1. Scope: **Zone(s)** (or **Organization** if multiple zones affected)
2. Select: Affected zones
3. Date Range: **Custom** → Set to the week when the bug occurred
4. Run recalculation → This recalculates only affected observations

### Scenario 4: Populate Missing Compliance Status
**Problem:** ComplianceMatrixManagement shows "Total observations: 0" despite scans being recorded.

**Root Cause:** Observation compliance fields are missing/incorrect because:
- Zone matrix was created **after** observations were recorded
- `process-field-scan` Edge Function failed silently during historical scans
- Database function `calculate_vehicle_compliance()` wasn't called

**Solution (RECOMMENDED FOR CURRENT ISSUE):**
1. Scope: **Entire System** (or specific zones if known)
2. Date Range: **All Time**
3. Run recalculation → This updates compliance fields for all existing observations
4. Expected outcome: ComplianceMatrixManagement stats should now show correct counts

---

## Troubleshooting

### Error: "Failed to send a request to the Edge Function"
**Cause:** Edge Function not deployed or network/auth issue.

**Fix:**
1. Check `EDGE_FUNCTION_DEPLOYMENT_CHECKLIST.md` for deployment steps
2. Verify you're logged in with admin/master account
3. Check browser console for detailed error message

### Error: "No observations found to process"
**Cause:** No observations match the selected scope/date range.

**Fix:**
1. Expand date range to "All Time"
2. Check if zone actually has observations in database:
   ```sql
   SELECT COUNT(*) FROM observations WHERE zone_id = 'zone-uuid-here';
   ```

### Error: "Insufficient permissions"
**Cause:** User account doesn't have admin/master role.

**Fix:**
1. Check user role in `user_profiles` table
2. Update role via SQL or Admin user management page

### Recalculation Completes but Stats Still Show Zero
**Cause:** Multiple possible issues.

**Diagnosis:**
```sql
-- Check observations compliance fields
SELECT 
  z.name,
   COUNT(o.observation_id) as observations_count,
   COUNT(*) FILTER (WHERE o.is_compliant = false) as non_compliant_count
FROM zones z
LEFT JOIN observations o ON o.zone_id = z.id
GROUP BY z.id, z.name;
```

**If non_compliant_count is unexpectedly 0:**
1. Check Edge Function logs for errors during processing
2. Verify `calculate_vehicle_compliance()` function exists
3. Run recalculation again with logging enabled

---

## Best Practices

### 1. Test on Small Scope First
Before running system-wide recalculation:
- Test on a single zone with known data
- Verify results are correct
- Then expand to larger scope

### 2. Schedule During Low Traffic
- System-wide recalculations can take several minutes
- Run during off-peak hours to avoid performance impact

### 3. Monitor Real-time Progress
- Don't close the browser tab during recalculation
- Real-time updates require active connection
- If connection lost, check "Recent Recalculations" for status

### 4. Review Drift Events
- After recalculation, check Drift Dashboard
- Drift events indicate where compliance changed
- Investigate unexpected changes

### 5. Document Matrix Changes
- Add change reason when updating matrix rules
- This creates audit trail for compliance changes
- Useful for regulatory reporting

---

## Performance Expectations

| Scope | Observations | Expected Time |
|-------|--------------|---------------|
| Single zone, 1 week | ~100-500 | 5-10 seconds |
| Single zone, 1 month | ~500-2000 | 20-60 seconds |
| Organization, 1 month | ~2000-10000 | 1-5 minutes |
| System-wide, all time | ~10000+ | 5-30 minutes |

*Times vary based on database size and server load*

---

## After Recalculation

### Verify Results

1. **Check Compliance Matrix Management**
   - Navigate to Compliance Matrix Management page
   - Verify "Total observations" now shows correct count
   - Check "Compliant" vs "Non-compliant" percentages

2. **Check Compliance Analytics**
   - View compliance trends over time
   - Verify rates match expected values

3. **Check Drift Dashboard**
   - Review any drift events created
   - Investigate zones with high drift rates

4. **Check Breach Alerts**
   - New breach alerts may be created for non-compliant vehicles
   - Review and action as needed

### Export Results (Optional)

If you need to export recalculation results for reporting:
```sql
-- Export observation compliance status to CSV
COPY (
  SELECT 
      o.observation_id,
      o.plate_number,
    z.name as zone_name,
      o.is_compliant,
      o.breach_type,
      o.breach_reason,
      o.recorded_at
   FROM observations o
   LEFT JOIN zones z ON z.id = o.zone_id
   WHERE o.recorded_at >= '2025-01-01'
   ORDER BY o.recorded_at DESC
) TO '/tmp/observations_compliance.csv' WITH CSV HEADER;
```

---

## Support

If recalculation continues to fail:
1. Review `EDGE_FUNCTION_DEPLOYMENT_CHECKLIST.md`
2. Check Edge Function logs: `supabase functions logs recalculate-all-compliance --tail`
3. Test Edge Function directly with CURL (see checklist)
4. Contact support with:
   - Scope used
   - Date range
   - Error message
   - Recent recalculation action ID
