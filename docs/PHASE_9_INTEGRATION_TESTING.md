# Phase 9 — Integration Testing

**FreedomCamp Manager - End-to-End Testing & Validation**

Comprehensive integration testing for all system components before production deployment.

---

## Testing Overview

Phase 9 validates 10 critical integration areas:

1. **Scan Flow** — PlateScanner → Railway → Database
2. **NZSCV Integration** — Proxy → Cache → Display
3. **MotorWeb Integration** — Enrichment → Update → Refresh
4. **ORC/AI Embedding** — Analysis → Storage → Search
5. **Compliance Recalculation** — Matrix → Pipeline → Alerts
6. **Report Generation** — Data → PDF → Download
7. **Multi-Org RLS Isolation** — Organization-scoped access
8. **Realtime Updates** — PostgreSQL subscriptions
9. **Offline Queue** — IndexedDB persistence
10. **PWA Features** — Service Worker, biometric auth

---

## Test Area 1: Scan Flow (PlateScanner → Railway → Database)

### Test Scenario 1.1: Manual Plate Entry

**Steps:**
1. Open FieldOfficerPortal (`/field`)
2. Click "Scan Vehicle"
3. Enter plate number manually: `TEST123`
4. Select zone from dropdown
5. Click "Submit"

**Expected Results:**
- ✅ Plate number validated (uppercase, 2-6 characters)
- ✅ Zone required before submission
- ✅ GPS coordinates captured automatically
- ✅ Observation created in database
- ✅ Compliance evaluation runs automatically
- ✅ Toast notification: "Vehicle scanned successfully"
- ✅ Scanner closes after submission

**Database Verification:**
```sql
SELECT 
  plate_number, 
  zone_id, 
  gps_latitude, 
  gps_longitude, 
  is_compliant,
  created_at
FROM observations 
WHERE plate_number = 'TEST123' 
ORDER BY created_at DESC 
LIMIT 1;
```

---

### Test Scenario 1.2: Camera Capture with OCR

**Steps:**
1. Open PlateScanner
2. Click "Camera Capture"
3. Allow camera permissions
4. Take photo of vehicle plate
5. Wait for OCR processing (Bob inference service on RunPod)
6. Verify detected plate number
7. Submit observation

**Expected Results:**
- ✅ Camera opens in device
- ✅ Photo captured and displayed
- ✅ OCR runs via Bob inference service (RunPod)
- ✅ Detected plate number auto-fills input
- ✅ Confidence score displayed (>80% preferred)
- ✅ Photo uploaded to Supabase Storage
- ✅ Photo hash calculated and stored
- ✅ Observation created with photo reference

**Bob Inference Call Verification:**
```javascript
// Check console for:
// POST https://<bob-runpod-url>/ocr
// Response: { plate_number: "ABC123", confidence: 0.92 }
```

---

### Test Scenario 1.3: AI Vehicle Detection & Embedding

**Steps:**
1. Complete Test 1.2 (with photo)
2. Open ComplianceDashboard (`/compliance`)
3. Click "Analyze Photos"
4. Wait for AI analysis to complete

**Expected Results:**
- ✅ Bob inference service called (RunPod)
- ✅ YOLO vehicle detection runs
- ✅ Vehicle count displayed
- ✅ MobileNetV3 embedding generated (384-D vector)
- ✅ Embedding stored in observations.vehicle_embedding
- ✅ Embedding quality score calculated
- ✅ Similar vehicles can be searched by embedding

**Database Verification:**
```sql
SELECT 
  plate_number,
  vehicle_embedding IS NOT NULL as has_embedding,
  embedding_quality,
  embedding_model_version
FROM observations 
WHERE plate_number = 'ABC123' 
ORDER BY created_at DESC 
LIMIT 1;
```

---

## Test Area 2: NZSCV Integration (Proxy → Cache → Display)

### Test Scenario 2.1: Check Self-Contained Certification

**Steps:**
1. Open VehicleManagement (`/vehicles`)
2. Search for vehicle: `TEST123`
3. Click vehicle to open details modal
4. Click "Check Warrant" button
5. Wait for NZSCV lookup (Railway proxy server)

**Expected Results:**
- ✅ Railway proxy server called
- ✅ NZSCV API queried via proxy
- ✅ Result cached in nzscv_cache table (7-day TTL)
- ✅ Certification status displayed (Certified/Not Certified)
- ✅ Warrant type shown (Green/Blue/None)
- ✅ Warrant number and expiry date displayed
- ✅ Toast notification confirms result

**Database Verification:**
```sql
SELECT 
  plate_number,
  warrant_type,
  warrant_number,
  expires_on,
  verified_at,
  cache_expires_at
FROM nzscv_cache 
WHERE plate_number = 'TEST123' 
ORDER BY verified_at DESC 
LIMIT 1;
```

**Cache TTL Test:**
- Click "Check Warrant" again
- Verify result returns instantly (cached)
- Check console: no Railway API call made
- Cache should expire after 7 days

---

### Test Scenario 2.2: Update Vehicle Self-Contained Status

**Steps:**
1. After NZSCV check, verify canonical_vehicles updated
2. Check self_contained field
3. Check self_contained_expiry field

**Expected Results:**
- ✅ canonical_vehicles.self_contained = true (if certified)
- ✅ canonical_vehicles.self_contained_expiry = warrant expiry date
- ✅ nzscv_warrant_type = 'green' or 'blue'
- ✅ Provenance recorded in canonical_vehicle_provenance

**Database Verification:**
```sql
SELECT 
  plate_number,
  self_contained,
  self_contained_expiry,
  nzscv_warrant_type,
  nzscv_last_checked
FROM canonical_vehicles 
WHERE plate_number = 'TEST123';

-- Check provenance
SELECT 
  attribute,
  old_value,
  new_value_text,
  source,
  changed_at
FROM canonical_vehicle_provenance 
WHERE plate_number = 'TEST123' 
  AND source = 'nzscv'
ORDER BY changed_at DESC;
```

---

## Test Area 3: MotorWeb Integration (Enrichment → Update → Refresh)

### Test Scenario 3.1: Enrich Vehicle Data from MotorWeb

**Steps:**
1. Open BreachAlerts (`/breaches`)
2. Select any breach
3. Click "Enrich Vehicle Data (MotorWeb)" button
4. Wait for enrichment to complete

**Expected Results:**
- ✅ Railway proxy server called
- ✅ MotorWeb API queried for vehicle details
- ✅ canonical_vehicles updated with:
  - make, model, year, colour
  - body_style, engine_size, fuel_type
  - owner_first_name, owner_last_name
  - owner_address, owner_address_verified
- ✅ Toast notification: "Vehicle data enriched from MotorWeb"
- ✅ Breach list refreshes with updated data

**Database Verification:**
```sql
SELECT 
  plate_number,
  make,
  model,
  year,
  colour,
  owner_first_name,
  owner_last_name,
  owner_address
FROM canonical_vehicles 
WHERE plate_number = 'TEST123';

-- Check provenance
SELECT 
  attribute,
  new_value_text,
  source,
  changed_at
FROM canonical_vehicle_provenance 
WHERE plate_number = 'TEST123' 
  AND source = 'motorweb'
ORDER BY changed_at DESC;
```

---

### Test Scenario 3.2: MotorWeb Owner Details for Breach Notices

**Steps:**
1. After enrichment, verify owner details available
2. Create enforcement action (notice to vacate)
3. Check owner name and address populate notice

**Expected Results:**
- ✅ Owner name appears on notice
- ✅ Owner address appears on notice
- ✅ Notice PDF includes owner details
- ✅ Delivery method uses owner address

---

## Test Area 4: Compliance Recalculation (Matrix → Pipeline → Alerts)

### Test Scenario 4.1: Manual Compliance Recalculation

**Steps:**
1. Update zone compliance rules in ZoneManagement
2. Change max_consecutive_nights from 3 to 2
3. Run compliance recalculation:
   ```bash
   curl -X POST https://your-project.supabase.co/functions/v1/recalculate-compliance-v2 \
     -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
     -d '{"zone_id": "zone-uuid", "comprehensive": true}'
   ```
4. Wait for recalculation to complete

**Expected Results:**
- ✅ New zone_compliance_matrix version created
- ✅ All observations re-evaluated against new rules
- ✅ observations compliance fields updated (`is_compliant`, `breach_type`, `breach_reason`)
- ✅ New breach_alerts created for new violations
- ✅ drift_events table logs criteria change
- ✅ Compliance dashboard reflects new status

**Database Verification:**
```sql
-- Check matrix version
SELECT version, effective_from, max_consecutive_nights 
FROM zone_compliance_matrix 
WHERE zone_id = 'zone-uuid' 
ORDER BY version DESC;

-- Check drift event
SELECT 
  criteria_changed,
  observations_affected,
  compliance_changed,
  status
FROM drift_events 
WHERE zone_id = 'zone-uuid' 
ORDER BY detected_at DESC 
LIMIT 1;

-- Check breach alerts created
SELECT COUNT(*) as new_breaches
FROM breach_alerts 
WHERE zone_id = 'zone-uuid' 
  AND created_at > NOW() - INTERVAL '5 minutes';
```

---

### Test Scenario 4.2: Automatic Compliance Evaluation on New Observation

**Steps:**
1. Create new observation via PlateScanner
2. Verify compliance automatically evaluated
3. Check if breach alert created (if non-compliant)

**Expected Results:**
- ✅ Trigger/function: compliance evaluation path fires on insert
- ✅ observations.is_compliant set correctly
- ✅ breach_alert created if non-compliant
- ✅ All happens in <1 second

**Database Verification:**
```sql
-- Check observation compliance
SELECT 
  plate_number,
  is_compliant,
  breach_type,
  breach_reason
FROM observations 
WHERE observation_id = 'obs-uuid';
```

---

## Test Area 5: Multi-Org RLS Isolation

### Test Scenario 5.1: Organization Data Isolation

**Setup:**
- Create 3 test users:
  - User A: Master role
  - User B: Admin, Organization 1
  - User C: Officer, Organization 2

**Steps:**
1. Login as User B (Org 1 admin)
2. Create observation in Org 1 zone
3. Logout, login as User C (Org 2 officer)
4. Try to view observations

**Expected Results:**
- ✅ User B sees all Org 1 data
- ✅ User B cannot see Org 2 data
- ✅ User C sees all Org 2 data
- ✅ User C cannot see Org 1 data
- ✅ User A (Master) sees all organizations
- ✅ RLS policies enforce isolation at database level

**Database Verification:**
```sql
-- As User B (should return 0)
SELECT COUNT(*) 
FROM observations 
WHERE organization_id = 'org-2-uuid';

-- As User A (should return all)
SELECT COUNT(*) 
FROM observations;
```

---

### Test Scenario 5.2: Multi-Org Hierarchy Access

**Setup:**
- Organization hierarchy:
  - FreedomCamp Security (parent)
    - Auckland Office (child)
    - Wellington Office (child)

**Steps:**
1. Login as admin of FreedomCamp Security
2. Open VehicleManagement
3. Check vehicle visibility

**Expected Results:**
- ✅ Parent org admin sees data from all child orgs
- ✅ Child org admin only sees own org data
- ✅ get_descendant_organizations() function works
- ✅ Global filter shows all accessible orgs

**Database Verification:**
```sql
-- Check hierarchy function
SELECT * FROM get_descendant_organizations('parent-org-uuid');

-- Check user access
SELECT * FROM get_user_organization_ids();
```

---

## Test Area 6: Report Generation (Data → PDF → Download)

### Test Scenario 6.1: Generate Leadership Pack PDF

**Steps:**
1. Open ReportsHub (`/reports`)
2. Click "Generate Leadership Pack"
3. Select date range
4. Click "Generate PDF"
5. Wait for generation

**Expected Results:**
- ✅ Edge Function: `generate-leadership-pack` called
- ✅ PDF generated with:
  - Organization branding
  - Date range
  - Compliance statistics
  - Breach summary
  - Charts and graphs
- ✅ PDF downloaded to device
- ✅ Filename: `leadership-pack-2026-02-27.pdf`

---

### Test Scenario 6.2: Export Observations CSV

**Steps:**
1. Open ComplianceDashboard
2. Apply filters (date range, zone)
3. Click "Export CSV"
4. Verify download

**Expected Results:**
- ✅ CSV includes all filtered observations
- ✅ Columns: plate_number, zone, recorded_at, is_compliant, breach_type
- ✅ NZ timezone applied to dates
- ✅ UTF-8 encoding
- ✅ Excel-compatible format

---

## Test Area 7: Realtime Updates (PostgreSQL Subscriptions)

### Test Scenario 7.1: Live Breach Alert Notifications

**Setup:**
- Two browser windows:
  - Window A: Admin viewing BreachAlerts page
  - Window B: Officer creating observation that triggers breach

**Steps:**
1. Window A: Open BreachAlerts, leave open
2. Window B: Create non-compliant observation
3. Observe Window A

**Expected Results:**
- ✅ Window A receives realtime update
- ✅ New breach card appears without refresh
- ✅ Notification bell shows badge count
- ✅ Toast notification appears
- ✅ Latency <2 seconds

**Implementation Verification:**
```typescript
// Check useRealtime hook is active
const { data: breaches } = useRealtime({
  channel: 'breach-alerts',
  event: 'INSERT',
  table: 'breach_alerts',
  filter: `organization_id=eq.${orgId}`,
})
```

---

### Test Scenario 7.2: Live Officer Location Tracking

**Steps:**
1. Admin: Open LiveOfficerTracking page
2. Officer: Start patrol (mobile device)
3. Officer: Move location
4. Admin: Watch map update

**Expected Results:**
- ✅ Officer location appears on map
- ✅ Location updates every 30 seconds (configurable)
- ✅ Accuracy circle displayed
- ✅ Last update timestamp shown
- ✅ Inactive officers grayed out

---

## Test Area 8: Offline Queue (IndexedDB Persistence)

### Test Scenario 8.1: Offline Observation Creation

**Steps:**
1. Open FieldOfficerPortal (mobile device)
2. Turn on airplane mode (disable network)
3. Scan 3 vehicles using PlateScanner
4. Verify queued in IndexedDB
5. Turn off airplane mode
6. Wait for sync

**Expected Results:**
- ✅ Observations saved to IndexedDB
- ✅ Queue count shown in UI: "3 pending sync"
- ✅ Network reconnect detected
- ✅ Auto-sync triggered
- ✅ Observations uploaded to Supabase
- ✅ Queue cleared after successful sync
- ✅ Toast: "3 observations synced"

**Implementation Verification:**
```typescript
// Check offline storage
import { saveOfflineObservation, syncOfflineQueue } from '@/lib/offlineStorage'

// Queue should be in IndexedDB 'offline_queue' object store
```

---

### Test Scenario 8.2: Offline Photo Upload

**Steps:**
1. Offline mode enabled
2. Capture vehicle photo
3. Create observation with photo
4. Go back online
5. Verify photo uploads

**Expected Results:**
- ✅ Photo stored as base64 in IndexedDB
- ✅ Photo uploaded to Supabase Storage when online
- ✅ Observation links to uploaded photo
- ✅ Base64 data removed from IndexedDB after upload

---

## Test Area 9: PWA Features (Service Worker, Biometric Auth)

### Test Scenario 9.1: PWA Installation

**Steps:**
1. Open app in Chrome (mobile)
2. Click "Install App" prompt
3. Install to home screen
4. Launch from home screen

**Expected Results:**
- ✅ Install banner appears
- ✅ App installs to home screen
- ✅ Icon and name correct
- ✅ Launches in standalone mode (no browser UI)
- ✅ Works offline (cached assets)

**Manifest Verification:**
```json
// public/manifest.json
{
  "name": "FreedomCamp Manager",
  "short_name": "FreedomCamp",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#1e40af",
  "background_color": "#ffffff"
}
```

---

### Test Scenario 9.2: Biometric Authentication

**Steps:**
1. Login to app
2. Navigate to Settings
3. Enable biometric authentication
4. Logout
5. Try to login with biometric

**Expected Results:**
- ✅ Biometric prompt appears (Touch ID/Face ID)
- ✅ Authentication succeeds
- ✅ User logged in without password
- ✅ Session persisted securely
- ✅ WebAuthn credential stored

**Implementation Verification:**
```typescript
import { registerBiometric, authenticateWithBiometric } from '@/lib/biometric'
```

---

### Test Scenario 9.3: Service Worker Cache

**Steps:**
1. Load app online
2. Inspect Service Worker in DevTools
3. Check cached assets
4. Go offline
5. Navigate app

**Expected Results:**
- ✅ Service Worker registered
- ✅ Static assets cached (JS, CSS, images)
- ✅ API responses cached (stale-while-revalidate)
- ✅ App navigable offline
- ✅ Critical pages load from cache

**Cache Verification:**
```javascript
// DevTools → Application → Cache Storage
// Should see: 'freedomcamp-cache-v1' with assets
```

---

## Test Area 10: System Integration (Full E2E Flow)

### Test Scenario 10.1: Complete Enforcement Workflow

**Full workflow from scan to enforcement:**

1. **Officer: Scan Vehicle**
   - Open FieldOfficerPortal
   - Scan plate: `BREACH1`
   - Vehicle observed in restricted zone
   - Non-compliant (overstay)

2. **System: Auto-Process**
   - Compliance evaluated
   - Breach alert created
   - NZSCV checked (not certified)
   - MotorWeb enriched (owner details)
   - Monthly stays updated

3. **Admin: Review Breach**
   - Open BreachAlerts
   - See new breach for `BREACH1`
   - Review vehicle history
   - Verify owner details from MotorWeb

4. **Admin: Issue Notice**
   - Click "Send Notice"
   - Generate Notice to Vacate PDF
   - Email sent to owner
   - Breach status → "notified"

5. **Officer: Follow-up**
   - Next day, scan same vehicle
   - System detects repeat breach
   - Enforcement escalation triggered

6. **Admin: Enforcement Action**
   - Create tow request
   - Assign to tow company
   - Mark breach as "resolved"

**Expected Results:**
- ✅ Each step completes successfully
- ✅ Audit trail recorded in audit_log
- ✅ All timestamps in NZ timezone
- ✅ RLS enforced throughout
- ✅ Realtime updates work
- ✅ Photos retained with legal integrity
- ✅ Owner contacted via MotorWeb data
- ✅ Compliance matrix respected
- ✅ Multi-org isolation maintained

---

## Integration Testing Checklist

Use this checklist to track testing progress:

### Core Functionality
- [ ] PlateScanner manual entry works
- [ ] PlateScanner camera capture works
- [ ] OCR via Bob inference service (RunPod) works
- [ ] Vehicle detection via Bob inference works
- [ ] Embedding generation works
- [ ] NZSCV certification check works
- [ ] MotorWeb enrichment works
- [ ] Compliance evaluation accurate
- [ ] Breach alerts created correctly
- [ ] Enforcement actions workflow complete

### Railway Services
- [ ] Inference service deployed and online
- [ ] Proxy server deployed and online
- [ ] Health endpoints return 200 OK
- [ ] Latency acceptable (<1000ms)
- [ ] Error handling works (500, 503)
- [ ] Cold start recovery works
- [ ] Supabase secrets configured
- [ ] check-railway-health function works

### Data Integrity
- [ ] RLS policies enforce org isolation
- [ ] Multi-org hierarchy works
- [ ] Canonical vehicles updated correctly
- [ ] Provenance tracked for all changes
- [ ] Photo hashes calculated correctly
- [ ] Evidence chain unbroken
- [ ] Timezone handling correct (NZ)
- [ ] No orphaned records

### Realtime Features
- [ ] Breach alerts appear live
- [ ] Officer location updates live
- [ ] Notification bell updates
- [ ] Toast notifications work
- [ ] Auto-refresh on data change

### Offline/PWA
- [ ] Offline queue saves observations
- [ ] Auto-sync on reconnect
- [ ] PWA installs correctly
- [ ] Service Worker caches assets
- [ ] Biometric auth works
- [ ] App works offline

### Reports & Export
- [ ] Leadership pack PDF generates
- [ ] CSV export includes correct data
- [ ] Timezone correct in exports
- [ ] Charts render correctly
- [ ] Filters applied to reports

### Performance
- [ ] Page load <3 seconds
- [ ] Query response <1 second
- [ ] Image upload <5 seconds
- [ ] Railway API calls <2 seconds
- [ ] No memory leaks
- [ ] No console errors

### Security
- [ ] Authentication required
- [ ] Session management works
- [ ] Password reset works
- [ ] RLS prevents data leaks
- [ ] CORS configured correctly
- [ ] API keys secured
- [ ] SQL injection prevented
- [ ] XSS prevented

---

## Test Reporting

After completing all tests, document results:

### Test Summary Report

```markdown
# Integration Testing Results - Phase 9

**Test Date:** [Date]
**Tester:** [Name]
**Environment:** [Production/Staging]

## Test Results

| Test Area | Pass | Fail | Notes |
|-----------|------|------|-------|
| Scan Flow | ✅ | ❌ | [Details] |
| NZSCV Integration | ✅ | ❌ | [Details] |
| MotorWeb Integration | ✅ | ❌ | [Details] |
| AI Embedding | ✅ | ❌ | [Details] |
| Compliance Recalc | ✅ | ❌ | [Details] |
| Report Generation | ✅ | ❌ | [Details] |
| Multi-Org RLS | ✅ | ❌ | [Details] |
| Realtime Updates | ✅ | ❌ | [Details] |
| Offline Queue | ✅ | ❌ | [Details] |
| PWA Features | ✅ | ❌ | [Details] |

## Critical Issues Found

[List any blocking issues]

## Recommendations

[Actions before production]

## Sign-off

- [ ] All critical tests pass
- [ ] All blockers resolved
- [ ] System ready for production
```

---

## Production Go-Live Criteria

System is ready for production when:

- ✅ All 10 integration test areas pass
- ✅ Railway services stable for 48 hours
- ✅ No critical bugs in last 7 days
- ✅ Performance benchmarks met
- ✅ Security audit passed
- ✅ User acceptance testing complete
- ✅ Backup/recovery tested
- ✅ Monitoring/alerting configured
- ✅ Documentation complete
- ✅ Training materials ready

---

**Phase 9 Complete when all tests pass! 🎉**

Next: Production deployment and user onboarding.
