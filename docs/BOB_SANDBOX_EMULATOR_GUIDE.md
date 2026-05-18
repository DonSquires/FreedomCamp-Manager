# Bob's Sandbox Emulator — Real-World Training Lab

**Date**: 2026-05-17  
**Version**: 1.0 — Actionable Emulator Edition  
**Audience**: Bob (AI agent) learning FieldOps Manager through hands-on practice  
**Format**: Step-by-step exercises with real-world scenarios, error paths, and decision gates

---

## PART 1: System Architecture — Foundation

### 1.1 The Three-Tier Stack

```
┌─────────────────────────────────────────────────┐
│  USER INTERFACE LAYER                           │
│  React Components (Officer / Admin / Master)    │
│  - Pages: FieldOfficerPortal, AdminPortal, etc. │
│  - State: Zustand stores + React Query          │
│  - UI Primitives: shadcn/ui (Radix)             │
└─────────────────┬───────────────────────────────┘
                  │
                  │ HTTP / WebSocket
                  │
┌─────────────────▼───────────────────────────────┐
│  BACKEND API LAYER                              │
│  Supabase (PostgreSQL + Real-time)              │
│  - REST API: observations, breach_alerts, etc.  │
│  - Edge Functions: business logic (TypeScript)  │
│  - RLS Policies: multi-org data isolation       │
│  - Storage: video, photos, documents            │
└─────────────────┬───────────────────────────────┘
                  │
      ┌───────────┼────────────┐
      │           │            │
      ▼           ▼            ▼
  PostgreSQL  Edge Fn      Services
  Database    (Deno TS)   (Node.js)
              - Triage    - PTT Server
              - Notices   - Inference
              - Audit     - NZSCV Proxy
```

### 1.2 The Nine Roles & Three Shells

**Owner Tier:**
- `grand_master` - Platform owner (all-seeing)
- `master` - Organization owner (org-wide governance)

**Service Provider Tier:**
- `admin` - Administrative operator (breach triage, reporting)
- `admin_officer` - Dual role (admin duties + field patrol)
- `nzscv_monitor` - Vehicle registry observer

**Client Tier:**
- `client_admin`, `client_officer`, `client_viewer` - Client site management

**Field Tier:**
- `officer` - Auto-routed to specialized portal per service type:
  - Freedom Camping Patrol
  - Site Guard
  - Parking Enforcement
  - Noise Control
  - Biosecurity Inspection
  - Smoke Complaint
  - EMS

**Three Shells:**

| Shell | Personas | Optimization | Primary Task |
|-------|----------|--------------|--------------|
| **Officer Shell** | Field officers | Mobile-first, night-readable | Mission execution: patrol → scan → record |
| **Admin Shell** | admin, admin_officer | Desktop, queue-centric | Breach triage and notice workflow |
| **Master Shell** | master, grand_master | Desktop, enterprise governance | Policy, reporting, multi-org oversight |

---

## PART 2: Real-World Workflows

### 2.1 The Officer Patrol Workflow (Officer Shell)

**5-Step Mission:**

1. **Land on Officer Portal** → Patrol board with mission options
2. **Start/Resume Shift** → Confirm zone assignment + patrol guidelines
3. **Scan Vehicle** → Camera → ALPR or manual entry
4. **Record Observation** → Vehicle attributes + notes + location
5. **Submit** → Data syncs to Supabase, breach_alert auto-triggers

**Data Flow:**

```
Officer opens app
  ↓
Auth check: JWT token + RLS filter
  ↓
Load officer's assigned zones
  ↓
Officer clicks "Start Patrol"
  ↓
Opens camera / QR scanner
  ↓
Captures plate: XYZ123
  ↓
Calls Edge Function: classify_vehicle(plate, zone, gps_coords)
  ↓
Edge Function:
  - Query NZSCV for vehicle history
  - Check canonical_vehicles for previous breaches
  - Evaluate compliance rules
  - Return: compliance_snapshot {compliant: false, reason: '14+ nights'}
  ↓
React component displays verdict: "⚠️ Breach Detected"
  ↓
Officer hits "Confirm Breach" button
  ↓
INSERT observation:
  - plate_number: "XYZ123"
  - organization_id: officer's org
  - zone_id: assigned zone
  - is_breach: true
  - recorded_by: officer's user_id
  ↓
RLS policy filters: WHERE organization_id = officer's org_id
  ✅ INSERT succeeds
  ↓
Trigger fire: auto_evaluate_compliance() + auto_create_compliance_result()
  ↓
Trigger fire: auto_create_breach_alert(observation_id)
  ↓
Breach alert appears in admin queue (after admin logs in)
```

### 2.2 The Admin Triage Workflow (Admin Shell)

**9-Step Triage Decision:**

1. **Breach Queue** → View all open breaches for org
2. **Select Breach** → Load vehicle history + photos
3. **Review Evidence** → Vehicle embedding, previous observations, zone compliance
4. **Open Triage Dialog** → 3-step guided flow
5. **Step 1: Decision** → Choose action: resolve | assign follow-up | issue notice | escalate
6. **Step 2: Details** → Capture reason + severity + attachments
7. **Step 3: Confirm** → Review summary + authorize
8. **Execute** → UPDATE breach_alert, INSERT infringement_notice (if applicable), log audit event
9. **Handoff** → Route to notice issuance (email / post) or assign to officer for follow-up

**Data Flow:**

```
Admin logs in
  ↓
Auth: JWT → RLS filter by admin's organization_id
  ↓
Query: SELECT * FROM breach_alerts WHERE organization_id = admin_org_id AND status = 'open'
  ↓
Result: 47 open breaches (filtered by RLS)
  ↓
Admin clicks breach #42: "Plate XYZ123"
  ↓
Load detail:
  - observation data
  - vehicle photo + embedding
  - previous observations (same plate, same zone)
  - compliance_snapshot from observation
  - Bob's triage suggestion (if enabled)
  ↓
Admin opens Triage Dialog
  ↓
Dialog Step 1: Choose action
  - "Resolve (compliant)"
  - "Assign Officer Follow-Up"
  - "Issue Infringement Notice"
  - "Escalate"
  ↓
Admin selects: "Issue Infringement Notice"
  ↓
Dialog Step 2: Details
  - Notice type: breach type selector
  - Severity: dropdown
  - Officer notes: text field
  ↓
Admin enters: "Breach of Bylaw 5.2.1 - Exceeds 14-night limit"
  ↓
Dialog Step 3: Confirm
  - Shows notice template preview
  - Confirms recipient (vehicle owner from NZSCV)
  - Authorizes issuance
  ↓
Admin clicks "Issue Notice"
  ↓
Edge Function: issue_infringement_notice()
  - UPDATE breach_alerts SET status = 'resolved', triaged_by = admin_id
  - INSERT infringement_notices {notice_type, recipient, served_date, pdf_path}
  - INSERT audit_log {action: 'cro_issue_notice', ...}
  - CALL send_notice_email(recipient_email, pdf_url)
  ↓
✅ Notice queued for delivery
  ↓
Admin sees toast: "Notice issued. Tracking ID: NTC-2026-0517-001234"
```

### 2.3 Bob's Triage Assistance (Integration Point)

**Request:**

```
POST /functions/v1/bob-triage-suggestion
{
  "observation_id": "uuid-1234",
  "organization_id": "uuid-org",
  "breach_type": "freedom_camping",
  "vehicle_history": [
    {observed_at: "2026-05-16", zone: "Nelson City", nights: 14},
    {observed_at: "2026-05-10", zone: "Nelson City", nights: 9}
  ]
}
```

**Response (from Bob inference service):**

```json
{
  "confidence": 0.92,
  "recommended_action": "issue_notice",
  "rationale": "Vehicle exceeds 14-night limit for second time in zone. Pattern suggests intentional breach. Recommend immediate notice.",
  "notice_template": "breach_repeat_offender",
  "severity": "high",
  "audit_trail": {
    "model": "qwen2.5-7b",
    "tokens_used": 487,
    "latency_ms": 1230
  }
}
```

**Admin Flow:**

1. Triage dialog loads suggestion automatically (if enabled)
2. Admin sees: "Bob suggests: Issue Notice (high confidence)"
3. Admin can accept, modify, or ignore
4. Admin authorizes final action
5. Action logged with `approved_by_human: true`

---

## PART 3: Storage Buckets & Data Organization

### 3.1 Storage Buckets in Supabase

| Bucket | Purpose | Retention | Access | Size |
|--------|---------|-----------|--------|------|
| `scans` | Vehicle photos from ALPR / officer scan | 90 days | public URL | ~2GB |
| `evidence` | Breach evidence, notes, annotations | 2 years | public URL (signed) | ~5GB |
| `vehicle-photos` | Vehicle reference photos for embedding | Permanent | public URL | ~3GB |
| `documents` | Infringement notices, templates, PDFs | 7 years | service role only | ~10GB |
| `audio` | PTT message recordings | 30 days | org-scoped | ~8GB |

### 3.2 File Organization

```
📁 scans/
  2026/
    05/
      17/
        observation-uuid-1/photo.jpg
        observation-uuid-1/metadata.json

📁 evidence/
  org-uuid-1/
    breach-alert-uuid-1/
      photo_1.jpg
      annotation.json
      admin_notes.txt

📁 documents/
  org-uuid-1/
    2026/
      infringement-notice-001.pdf
      notice-delivery-log.jsonl

📁 audio/
  org-uuid-1/
    ptt-channel-patrol-1/
      2026-05-17T09-15-33Z.wav
```

### 3.3 RLS Policy Example (storage)

```sql
-- storage.objects RLS policy
CREATE POLICY "users_can_access_org_documents"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'documents'
  AND (
    -- Admin can access their org's documents
    (auth.jwt() ->> 'role' = 'authenticated' 
     AND auth.jwt() ->> 'organization_id' = (bucket_id || '/' || name)::text)
    -- Service role bypass
    OR auth.role() = 'service_role'
  )
);
```

---

## PART 4: Multi-Organization Isolation (Critical Safety)

### 4.1 The RLS Contract

Every row-level SELECT, INSERT, UPDATE, DELETE respects organization_id:

**Example: Query Observations**

```sql
SELECT * FROM observations
WHERE organization_id = auth.jwt() ->> 'organization_id';
```

**Officer X from Org A tries to query Org B data:**

```sql
SELECT * FROM observations
WHERE organization_id = 'org-b-uuid';
-- ❌ RLS policy blocks: auth's org != observation's org
-- Result: 0 rows
```

**Officer X from Org A views their own data:**

```sql
SELECT * FROM observations
WHERE organization_id = 'org-a-uuid';  -- matches auth
-- ✅ RLS policy allows
-- Result: their observations only
```

### 4.2 Master/Grand Master Override (Audited)

Master and Grand Master roles can query across orgs, but every access is logged:

```sql
-- Master tries to access Org B data
SELECT * FROM observations
WHERE organization_id = 'org-b-uuid';
-- ✅ Allowed (master role)
-- ⚠️ Logged: audit_log {action: 'master_query', org_id: 'org-b', queried_by: master_id}
```

---

## PART 5: Database Transactions & Consistency

### 5.1 Atomic Breach Creation

```sql
-- This transaction ensures consistency:
BEGIN TRANSACTION;

  -- 1. Insert observation
  INSERT INTO observations (observation_id, plate_number, zone_id, organization_id, ...)
  VALUES ('obs-uuid', 'XYZ123', 'zone-1', 'org-a', ...);

  -- 2. Trigger fires: auto_evaluate_compliance()
  -- (evaluates against compliance rules)

  -- 3. Trigger fires: auto_create_compliance_result()
  -- (records evaluation result)

  -- 4. Trigger fires: auto_create_breach_alert()
  -- (creates alert if breach detected)
  INSERT INTO breach_alerts (alert_id, observation_id, ...)
  VALUES ('alert-uuid', 'obs-uuid', ...);

COMMIT;
```

If any step fails → entire transaction rolls back → no orphaned data.

### 5.2 Notice Issuance (Multi-Table Coordination)

```sql
BEGIN TRANSACTION;

  -- 1. Update breach alert status
  UPDATE breach_alerts
  SET status = 'resolved', triaged_by = admin_id, triaged_at = NOW()
  WHERE alert_id = 'alert-uuid';

  -- 2. Create infringement notice record
  INSERT INTO infringement_notices (notice_id, alert_id, recipient, notice_type, ...)
  VALUES ('notice-uuid', 'alert-uuid', 'vehicle-owner@email.com', 'breach_notice', ...);

  -- 3. Store PDF in storage.objects
  -- (done via Edge Function, async)

  -- 4. Log audit event
  INSERT INTO audit_log (log_id, action, entity_type, entity_id, performed_by, ...)
  VALUES ('log-uuid', 'cro_issue_notice', 'infringement_notice', 'notice-uuid', admin_id, ...);

COMMIT;
```

---

## PART 6: Environment & Tooling

### 6.1 Starting the Dev Environment

```bash
# 1. Clone and enter workspace
cd /workspaces/FreedomCamp-Manager

# 2. Install dependencies (first time)
bun install

# 3. Create .env file
cp .env.example .env
# Then set:
# VITE_SUPABASE_URL=https://your-project.supabase.co
# VITE_SUPABASE_ANON_KEY=your-anon-key

# 4. Start dev server
bun run dev
# Output: ✨ ready in 456ms → http://localhost:5173

# 5. In another terminal, verify build
bun run build
# Should exit with code 0
```

### 6.2 Browser Dev Tools for Bob

**Chrome DevTools shortcuts:**
- `F12` → Open DevTools
- `Ctrl+Shift+C` → Inspect element
- Network tab → View API requests/responses
- Console → Run JavaScript queries
- React DevTools → Inspect component state

**Useful queries:**

```javascript
// Check current user
window.__APP_STATE__?.user

// Check Zustand store
window.__ZUSTAND__?.store?.getState()

// Clear IndexedDB (offline cache)
indexedDB.databases().forEach(db => indexedDB.deleteDatabase(db.name))

// Log all network requests
performance.getEntriesByType("resource").filter(r => r.name.includes("/rest/v1"))
```

### 6.3 Supabase Console Access

```bash
# Query database directly (from CLI)
npx supabase db pull

# Or use Supabase Dashboard:
# 1. Go to supabase.com → Your Project
# 2. Click "SQL Editor"
# 3. Run queries directly:

SELECT COUNT(*) as breach_count
FROM breach_alerts
WHERE organization_id = 'org-a-uuid'
  AND status = 'open';
```

---

## PART 7: Common Error States & Recovery

### 7.1 Network Offline (Officer Offline Queue)

**Scenario:** Officer loses connectivity while recording observation

**Behavior:**
1. Observation stays in local IndexedDB (offline cache)
2. Badge shows: "📳 Offline: 3 pending"
3. Sync button appears: "Sync now"

**Recovery:**
```
1. Officer regains connection
2. App detects WiFi/cellular
3. Auto-sync triggers
4. "Syncing..." toast appears
5. After 2-3 seconds: "✅ Synced successfully"
6. Badge clears
```

**Data verification:**
```bash
# Check observation appears in Supabase
curl -s "$VITE_SUPABASE_URL/rest/v1/observations?order=created_at.desc&limit=1" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SESSION_TOKEN" | jq .
```

### 7.2 Validation Error (Officer Portal)

**Scenario:** Officer tries to submit observation without required fields

**Behavior:**
1. Form validation runs
2. Required fields highlighted: red border + error text
3. Submit button disabled
4. Error message: "Please fill in all required fields"

**Recovery:**
```
1. Officer fills missing field (e.g., vehicle color)
2. Validation passes
3. Submit button re-enables
4. Officer clicks submit
5. Observation created successfully
```

### 7.3 Permission Denied (Cross-Org Access)

**Scenario:** Officer from Org B tries to access Org A's breach queue

**Behavior:**
1. API returns 403 Forbidden
2. UI shows: "You don't have permission to view this data"
3. Officer redirected to their org's dashboard

**Verification:**
```javascript
// In browser console
// Try to fetch Org B's data
fetch('https://your-project.supabase.co/rest/v1/breach_alerts?organization_id=eq.org-b-uuid', {
  headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
})
// Response: {"code":"PGRST116","details":"The result contains no rows"}
// (RLS blocked the query)
```

---

## PART 8: Testing & Validation

### 8.1 End-to-End Test Template

```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from './fixtures/auth';

test('officer can complete full patrol workflow', async ({ page }) => {
  // 1. Login as officer
  await loginAs(page, 'officer_ncc_001@example.com', 'password');
  
  // 2. Navigate to Officer Portal
  await page.goto('http://localhost:5173/portal/officer');
  
  // 3. Start patrol
  await page.click('button:has-text("Start Patrol")');
  
  // 4. Select zone
  await page.selectOption('select[name="zone"]', 'zone-ncc-001');
  
  // 5. Click scan button
  await page.click('button:has-text("Scan Vehicle")');
  
  // 6. Enter plate (simulated)
  await page.fill('input[placeholder="Plate number"]', 'ABC123');
  
  // 7. Submit observation
  await page.click('button:has-text("Submit Observation")');
  
  // 8. Verify success toast
  await expect(page.locator('text=Observation recorded')).toBeVisible();
  
  // 9. Verify data in database
  const observations = await supabase
    .from('observations')
    .select('*')
    .eq('plate_number', 'ABC123')
    .single();
  
  expect(observations.data).toBeDefined();
  expect(observations.data.is_breach).toBe(true);
});
```

### 8.2 Running Tests

```bash
# Run all E2E tests
bunx playwright test

# Run specific test file
bunx playwright test tests/e2e/officer-workflow.spec.ts

# Run in headed mode (visible browser)
bunx playwright test --headed

# Run with debug mode
bunx playwright test --debug

# Record new trace
bunx playwright test --trace on
```

---

## PART 9: Bob's Checklist — After Training

By completion of sandbox tutoring, Bob should be able to:

### Knowledge
- [ ] Draw 3-tier architecture diagram from memory
- [ ] Explain how RLS prevents cross-org data leakage
- [ ] Name all 9 roles and their primary workflows
- [ ] Describe the 5-step officer patrol workflow
- [ ] Describe the 9-step admin triage workflow
- [ ] Explain how transactions maintain data consistency

### Skills
- [ ] Start dev server and open app in browser
- [ ] Log in as different roles (officer, admin, master)
- [ ] Navigate each portal and identify key UI elements
- [ ] Create a test observation end-to-end
- [ ] Query database and filter by organization_id
- [ ] Check browser console for errors
- [ ] Review network requests in DevTools
- [ ] Simulate offline scenario and verify recovery
- [ ] Handle validation errors gracefully

### Integration
- [ ] Call Bob's inference endpoint and interpret response
- [ ] Integrate Bob's suggestion into admin workflow
- [ ] Log Bob's assistance in audit trail
- [ ] Understand approval gate constraints

### Troubleshooting
- [ ] Diagnose network errors vs permission errors
- [ ] Check organization_id scoping when data missing
- [ ] Use browser DevTools to inspect component state
- [ ] Query Supabase directly to verify data
- [ ] Read error messages and follow recovery steps

---

## Success Criteria

✅ **Exercise A Complete**: Bob can start app, navigate all shells, screenshot each portal  
✅ **Exercise B Complete**: Bob creates observation, traces data to database, verifies RLS filtering  
✅ **Exercise C Complete**: Bob creates 2 orgs, verifies isolation, documents findings  
✅ **Exercise D Complete**: Bob completes breach triage workflow end-to-end  
✅ **Exercise E Complete**: Bob integrates Bob's suggestion and executes with approval  
✅ **Error Handling**: Bob recovers from 3 error scenarios gracefully  
✅ **Knowledge Checkpoint**: Bob answers all 6 architecture questions correctly  

---

## Tutoring Session Notes

### Completed Modules
- [ ] Module 1: System Architecture Foundation
- [ ] Module 2: Database & Storage Infrastructure
- [ ] Module 3: Frontend Components & Navigation
- [ ] Module 4: Workflow Execution Paths
- [ ] Module 5: Bob's Role & Constraints
- [ ] Module 6: Error States & Recovery

### Exercise Progress
- [ ] Exercise A: Environment Recon
- [ ] Exercise B: Data Flow Tracing
- [ ] Exercise C: Multi-Org Isolation
- [ ] Exercise D: Breach Triage Workflow
- [ ] Exercise E: Bob Assistance Integration

---

## Next Steps for Tutor

1. Have Bob start Exercise A (environment recon)
2. Guide Bob through browser, ask "what do you see?"
3. Have Bob take screenshots of each shell
4. Review findings together
5. Move to Exercise B (data flow tracing)
6. Continue until all success criteria met
