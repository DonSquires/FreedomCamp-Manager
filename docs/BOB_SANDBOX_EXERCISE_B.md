# Bob's Sandbox Exercise B: Data Flow Tracing

**Duration**: 45 minutes  
**Prerequisite**: Exercise A (Environment Recon) completed  
**Goal**: Understand how data flows from user action → React state → Supabase database  
**Materials**: Browser (logged in as officer), Terminal, DevTools  

---

## Overview

In Exercise B, you'll create a test observation (scan a vehicle) and watch it flow through the system:

```
Officer fills form
  ↓
React validates input
  ↓
Component updates Zustand store
  ↓
API call to Supabase REST
  ↓
Database INSERT observation
  ↓
RLS policy filters (organization_id check)
  ↓
✅ Row inserted
  ↓
Trigger fires: auto_evaluate_compliance()
  ↓
✅ Breach alert created (if applicable)
```

---

## Step 1: Inspect Network Before Starting

**Goal**: See the dev server is properly configured

```bash
# Terminal: Check if dev server is running
lsof -i :5173
# Should show: vite process listening on port 5173

# If not running, start it:
npm run dev
```

**In Browser DevTools**:
1. Press `F12` to open DevTools
2. Click "Network" tab
3. Leave this open while you work (we'll check it later)

---

## Step 2: Log In as Officer (if not already)

**From Exercise A**, you should have the credentials in `.env.playwright.local`

```
Email:    officer_ncc_001@example.com
Password: (from .env.playwright.local)
```

**What you should see:**
- Officer Portal
- "Start Patrol" button visible
- Zone selector available

---

## Step 3: Open Patrol & Start Recording

**In Officer Portal**:

1. Click "Start Patrol"
   - Select zone: "Nelson City"
   - Click "Confirm"
   
2. After shift starts, click "Scan Vehicle" (or "Record Observation")

3. You should see a form with fields:
   - Plate number: `[_________]`
   - Vehicle color: `[dropdown]`
   - Location: `[GPS or manual entry]`
   - Notes: `[_________]`

---

## Step 4: Fill Form & Watch React State

**Action**: Fill the form with test data:

```
Plate number:  ABC1234
Vehicle color: Blue
Location:      Nelson City (auto)
Notes:         Test observation for training
```

**Now inspect React state**:

1. In DevTools, open "React" tab (if installed)
   - Or install React DevTools extension
   
2. Select the form component
3. Look at the component state tree
4. You should see:
   ```
   formData: {
     plate_number: "ABC1234",
     vehicle_color: "Blue",
     gps_latitude: -41.2865,
     gps_longitude: 173.2832,
     notes: "Test observation for training"
   }
   ```

**Bob's observation**: Does the state update in real-time as you type?

---

## Step 5: Click Submit & Watch Network Request

**Action**: Click "Submit Observation"

**In DevTools Network Tab**, you should see:

```
POST /rest/v1/observations?apikey=xxx
Request headers:
  Content-Type: application/json
  Authorization: Bearer [JWT_TOKEN]
  X-Client-Timezone: Pacific/Auckland

Request body:
{
  "plate_number": "ABC1234",
  "vehicle_color": "Blue",
  "gps_latitude": -41.2865,
  "gps_longitude": 173.2832,
  "organization_id": "[OFFICER'S_ORG_UUID]",
  "zone_id": "[NELSON_CITY_ZONE_UUID]",
  "recorded_by": "[OFFICER'S_USER_UUID]",
  "notes": "Test observation for training",
  "created_at": "2026-05-17T09:15:33.000Z"
}

Response (201 Created):
{
  "observation_id": "550e8400-e29b-41d4-a716-446655440000",
  "plate_number": "ABC1234",
  ...
}
```

**Bob's task**: Screenshot the network request and response

---

## Step 6: Verify Success Toast & App State

**You should see:**
1. Toast: "✅ Observation recorded successfully"
2. Page refreshes or shows new observation in history
3. Button disabled briefly during submission, then re-enabled

**Bob's observation**: How does the UI provide feedback?

---

## Step 7: Query Database Directly

**Goal**: Verify the row actually hit Supabase

### Option A: Use Supabase Dashboard

```
1. Go to supabase.com → Your Project
2. Click "SQL Editor"
3. Run this query:

SELECT observation_id, plate_number, organization_id, recorded_by, created_at
FROM observations
WHERE plate_number = 'ABC1234'
LIMIT 1;

Expected result:
┌──────────────────┬───────────────┬──────────────────┬──────────────────┬─────────────────────────┐
│ observation_id   │ plate_number  │ organization_id  │ recorded_by      │ created_at              │
├──────────────────┼───────────────┼──────────────────┼──────────────────┼─────────────────────────┤
│ 550e8400-e29b... │ ABC1234       │ [ORG_UUID]       │ [OFFICER_UUID]   │ 2026-05-17 09:15:33+00  │
└──────────────────┴───────────────┴──────────────────┴──────────────────┴─────────────────────────┘
```

### Option B: Use Terminal curl

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_KEY="your-anon-key"  # From .env

curl -s "${SUPABASE_URL}/rest/v1/observations?plate_number=eq.ABC1234" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SESSION_TOKEN}" | jq .

# Should return array with one object:
[
  {
    "observation_id": "550e8400-e29b-41d4-a716-446655440000",
    "plate_number": "ABC1234",
    "organization_id": "[YOUR_ORG_ID]",
    "recorded_by": "[YOUR_USER_ID]",
    ...
  }
]
```

---

## Step 8: Verify RLS Filtering

**Goal**: Prove that only this officer's organization can see this observation

### Test 1: Officer from same org CAN see it

```bash
# Officer from same organization fetches observation
curl -s "${SUPABASE_URL}/rest/v1/observations?organization_id=eq.${OFFICER_ORG_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${OFFICER_TOKEN}" | jq '.[] | .plate_number'

# Result: ✅ "ABC1234" appears in results
```

### Test 2: Officer from different org CANNOT see it

```bash
# Officer from different organization tries same query
curl -s "${SUPABASE_URL}/rest/v1/observations?organization_id=eq.${OTHER_ORG_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${OTHER_OFFICER_TOKEN}" | jq '.[] | .plate_number'

# Result: ❌ Empty array (RLS blocked cross-org access)
```

---

## Step 9: Check for Automatic Breach Alert

**If the observation is a breach**, an automatic trigger should have created a `breach_alert`

**Query**:
```sql
SELECT alert_id, observation_id, status, created_at
FROM breach_alerts
WHERE observation_id = '550e8400-e29b-41d4-a716-446655440000';
```

**Expected result**:
```
┌──────────────────┬──────────────────┬────────┬─────────────────────────┐
│ alert_id         │ observation_id   │ status │ created_at              │
├──────────────────┼──────────────────┼────────┼─────────────────────────┤
│ 660f9511-f30c... │ 550e8400-e29b... │ open   │ 2026-05-17 09:15:33+00  │
└──────────────────┴──────────────────┴────────┴─────────────────────────┘
```

**If no breach alert:** That means the vehicle was compliant (no rule violation)

---

## Step 10: Trace the Complete Flow

**Bob's task**: Create a diagram showing what happened:

```
1. Officer opens app
   ↓ [Form loaded in React]

2. Officer fills form
   ↓ [React state updated, Zustand store reflects data]

3. Officer clicks Submit
   ↓ [Network request: POST /rest/v1/observations]

4. Supabase receives request
   ↓ [RLS policy checks: organization_id = auth.jwt() → PASS]

5. Database INSERT executes
   ↓ [observation_id: 550e8400-e29b...]

6. Trigger fires: auto_evaluate_compliance()
   ↓ [Evaluates vehicle history + compliance rules]

7. Result: Breach detected OR Compliant
   ↓ [If breach → auto_create_breach_alert()]

8. App receives response (201 Created)
   ↓ [React state updated, toast shown]

9. User sees success feedback
   ↓ [✅ "Observation recorded successfully"]

10. Data now in Supabase, visible to admins
    ↓ [Admins see breach in queue]
```

---

## Exercise B Completion Checklist

✅ I understand the data flow from form → network → database  
✅ I saw the network request/response in DevTools  
✅ I queried the database and found my observation  
✅ I verified RLS filtering (my org saw it, other org didn't)  
✅ I checked for automatic breach alert creation  
✅ I traced the complete flow in a diagram  

---

## Reflection Questions

1. **Where does the organization_id come from?**
   - ________________

2. **Why does RLS need to check organization_id?**
   - ________________

3. **What would happen if RLS policy didn't exist?**
   - ________________

4. **How does the app ensure data consistency?**
   - ________________

5. **What role does the trigger play?**
   - ________________

---

## Troubleshooting

| Issue | Diagnosis | Fix |
|-------|-----------|-----|
| Network request fails (403) | RLS policy rejected | Check org_id matches auth JWT |
| Observation doesn't appear in database | API call didn't happen | Check Network tab for errors |
| Breach alert not created | Vehicle was compliant | Create new test observation with breach criteria |
| Can't access Supabase dashboard | Auth issue | Verify credentials in .env |

---

## Next Up

Exercise C: Multi-Organization Isolation
- 30 minutes
- Create two test organizations
- Verify data isolation between them
- Understand multi-tenant safety model

See: `docs/BOB_SANDBOX_EMULATOR_GUIDE.md` PART 4 for theory + checklist
