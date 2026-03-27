# Manual Test Scenarios

**FreedomCamp Manager - User Acceptance Testing**

Step-by-step test scenarios for manual validation of all features.

---

## Test User Setup

Create 4 test users with different roles:

| Email | Role | Organization | Purpose |
|-------|------|--------------|---------|
| master@test.com | Master | - | Full system access |
| admin@org1.com | Admin | Organization 1 | Org 1 administration |
| officer@org1.com | Officer | Organization 1 | Field operations |
| admin@org2.com | Admin | Organization 2 | Org isolation testing |

---

## Scenario 1: Officer Daily Workflow

**Actor:** Officer (officer@org1.com)

### Morning Login
1. Open app: `https://your-app.onspace.app`
2. Login with email and password
3. Verify dashboard loads
4. Check notification bell (should be empty)

**Expected:**
- ✅ Login successful
- ✅ Dashboard shows today's date
- ✅ Navigation menu accessible
- ✅ No error messages

### Start Patrol
1. Click "Field Officer Portal" from navigation
2. Click "Active Patrol" card
3. Click "Start Patrol"
4. Allow location permissions

**Expected:**
- ✅ GPS coordinates captured
- ✅ Patrol status shows "In Progress"
- ✅ Current location shown on map
- ✅ Patrol timer starts

### Scan First Vehicle
1. Click "Scan Vehicle" card
2. PlateScanner opens
3. Click "Manual Entry"
4. Enter plate: `ABC123`
5. Select zone: "Beach Reserve"
6. Take photo (optional)
7. Click "Submit"

**Expected:**
- ✅ Plate validated (uppercase)
- ✅ Zone required before submit
- ✅ GPS auto-captured
- ✅ Photo uploaded if taken
- ✅ Toast: "Vehicle scanned successfully"
- ✅ Scanner closes

### Scan Second Vehicle (with camera)
1. Click "Scan Vehicle" again
2. Click "Camera Capture"
3. Allow camera permission
4. Take photo of vehicle plate
5. Wait for OCR processing (2-3 seconds)
6. Verify detected plate appears: `DEF456`
7. Correct if needed
8. Select zone
9. Submit

**Expected:**
- ✅ Camera opens
- ✅ Photo captured
- ✅ OCR detects plate automatically
- ✅ Railway inference service called
- ✅ Confidence score shown
- ✅ Observation created with photo

### Check Scan History
1. Click "My Scans" card
2. View today's scans
3. Verify 2 vehicles listed

**Expected:**
- ✅ Shows both ABC123 and DEF456
- ✅ Timestamps correct (NZ timezone)
- ✅ Zones correct
- ✅ Compliance status shown

### Scan Non-Compliant Vehicle
1. Scan vehicle: `BREACH1`
2. Zone: "Restricted Zone"
3. System detects overstay
4. Submit

**Expected:**
- ✅ Observation created
- ✅ Compliance check runs
- ✅ Breach detected
- ✅ Toast: "Non-compliant vehicle detected"
- ✅ Breach alert created for admin

### Report Incident
1. Click "Create Report" card
2. Select incident type: "Health & Safety"
3. Enter description: "Broken glass in parking area"
4. Take photo of hazard
5. Mark location on map
6. Submit

**Expected:**
- ✅ Report created
- ✅ Photo uploaded
- ✅ GPS coordinates saved
- ✅ Admin notified
- ✅ Toast confirmation

### End Patrol
1. Click "Active Patrol"
2. Click "End Patrol"
3. Confirm

**Expected:**
- ✅ Patrol status changes to "Completed"
- ✅ End time recorded
- ✅ Total observations counted
- ✅ GPS tracking stopped

### Afternoon Logout
1. Click profile menu
2. Click "Logout"

**Expected:**
- ✅ Session cleared
- ✅ Redirected to login
- ✅ Offline queue preserved (if any)

---

## Scenario 2: Admin Breach Management

**Actor:** Admin (admin@org1.com)

### Login & Dashboard
1. Login as admin
2. View dashboard
3. Check breach alert count

**Expected:**
- ✅ Dashboard shows organization stats
- ✅ Breach alert count: 1 (from BREACH1)
- ✅ Red badge on navigation

### Review Breach Alert
1. Navigate to "Breach Alerts"
2. Click on BREACH1 breach
3. Review details

**Expected:**
- ✅ Breach type: Overstay
- ✅ Zone: Restricted Zone
- ✅ Detected timestamp shown
- ✅ Vehicle details visible
- ✅ Status: Pending

### Check NZSCV Certification
1. From breach alert, click "View Vehicle"
2. Opens VehicleManagement modal
3. Click "Check Warrant" button
4. Wait for NZSCV lookup

**Expected:**
- ✅ Railway proxy server called
- ✅ NZSCV result displayed
- ✅ Certification status: Not Certified
- ✅ Result cached for 7 days
- ✅ canonical_vehicles updated

### Enrich Vehicle Data
1. Still in vehicle modal
2. Click "Enrich Data (MotorWeb)"
3. Wait for enrichment

**Expected:**
- ✅ Railway proxy called
- ✅ MotorWeb API queried
- ✅ Vehicle make/model updated
- ✅ Owner name populated
- ✅ Owner address populated
- ✅ Toast: "Vehicle data enriched"

### Issue Notice to Vacate
1. Back to breach alert
2. Click "Send Notice"
3. Review pre-filled owner details
4. Edit notice text if needed
5. Select delivery method: Email
6. Click "Generate & Send"

**Expected:**
- ✅ PDF generated via Edge Function
- ✅ Notice includes owner name/address
- ✅ Email sent to owner
- ✅ Breach status → "Notified"
- ✅ notified_at timestamp set
- ✅ Audit log entry created

### Assign Enforcement Action
1. Click "Create Enforcement Action"
2. Select action type: "Tow Request"
3. Select tow company from dropdown
4. Add notes: "Remove by 5pm"
5. Submit

**Expected:**
- ✅ Enforcement action created
- ✅ Tow company notified
- ✅ Status: Assigned
- ✅ Due date set
- ✅ Linked to breach alert

### Monitor Officer Safety
1. Navigate to "Live Officer Tracking"
2. View active officers on map
3. Check last update timestamp

**Expected:**
- ✅ Map shows officer locations
- ✅ Accuracy circles displayed
- ✅ Last update: <2 minutes ago
- ✅ Officer names shown
- ✅ Auto-refresh every 30 seconds

### Generate Daily Report
1. Navigate to "Reports Hub"
2. Click "Leadership Pack"
3. Select date range: Today
4. Click "Generate PDF"

**Expected:**
- ✅ PDF generation starts
- ✅ Progress indicator shown
- ✅ PDF downloads (~5-10 seconds)
- ✅ Includes org branding
- ✅ Compliance stats correct
- ✅ Breach summary included
- ✅ Charts render properly

---

## Scenario 3: Multi-Organization Isolation

**Actors:** admin@org1.com and admin@org2.com

### Setup Test Data
1. Login as admin@org1.com
2. Scan vehicle: `ORG1TEST`
3. Zone: Organization 1 zone
4. Logout

5. Login as admin@org2.com
6. Scan vehicle: `ORG2TEST`
7. Zone: Organization 2 zone
8. Logout

### Test Org 1 Isolation
1. Login as admin@org1.com
2. Navigate to VehicleManagement
3. Search for `ORG1TEST`
4. Search for `ORG2TEST`

**Expected:**
- ✅ ORG1TEST found
- ✅ ORG2TEST **NOT found** (isolated)
- ✅ RLS enforced at database level

### Test Org 2 Isolation
1. Login as admin@org2.com
2. Navigate to VehicleManagement
3. Search for `ORG1TEST`
4. Search for `ORG2TEST`

**Expected:**
- ✅ ORG2TEST found
- ✅ ORG1TEST **NOT found** (isolated)

### Test Master Access
1. Login as master@test.com
2. Navigate to VehicleManagement
3. Search for `ORG1TEST` and `ORG2TEST`

**Expected:**
- ✅ Both vehicles found
- ✅ Master sees all organizations
- ✅ Can filter by organization

### Test Global Filters
1. As master, open global filter ribbon
2. Select Organization: Organization 1
3. View VehicleManagement

**Expected:**
- ✅ Only Org 1 vehicles shown
- ✅ Filter persists across pages
- ✅ Can clear filter to see all

---

## Scenario 4: Offline Mode

**Actor:** Officer (officer@org1.com) on mobile device

### Enable Offline Mode
1. Open app on mobile (Chrome/Safari)
2. Enable airplane mode
3. Verify network disconnected

**Expected:**
- ✅ Network status bar: "Offline"
- ✅ App still functional
- ✅ Cached pages load

### Create Offline Observations
1. Navigate to Field Officer Portal
2. Scan vehicle: `OFFLINE1` (manual entry)
3. Take photo
4. Submit

**Expected:**
- ✅ Observation saved to IndexedDB
- ✅ Toast: "Saved offline (1 pending sync)"
- ✅ Badge shows queue count

2. Scan vehicle: `OFFLINE2`
3. Submit

**Expected:**
- ✅ Queue count: 2 pending
- ✅ Both observations in IndexedDB

### Go Back Online
1. Disable airplane mode
2. Wait for network reconnect
3. Observe auto-sync

**Expected:**
- ✅ Network detected automatically
- ✅ Auto-sync triggered
- ✅ Progress indicator shown
- ✅ Both observations uploaded
- ✅ Photos uploaded to Supabase Storage
- ✅ Queue cleared
- ✅ Toast: "2 observations synced"

### Verify Database
1. Open VehicleManagement (desktop)
2. Search for OFFLINE1 and OFFLINE2

**Expected:**
- ✅ Both observations in database
- ✅ Photos accessible
- ✅ Compliance evaluated
- ✅ Timestamps correct

---

## Scenario 5: PWA Installation

**Actor:** Any user on mobile

### Install PWA
1. Open app in Chrome (Android) or Safari (iOS)
2. Wait for install prompt
3. Click "Install"
4. Confirm installation

**Expected:**
- ✅ Install banner appears
- ✅ App installs to home screen
- ✅ Icon matches manifest
- ✅ Name: "FreedomCamp Manager"

### Launch from Home Screen
1. Close browser
2. Tap app icon on home screen
3. App launches

**Expected:**
- ✅ Opens in standalone mode
- ✅ No browser UI (fullscreen)
- ✅ Splash screen shows (if configured)
- ✅ Loads cached assets

### Test Offline Functionality
1. Enable airplane mode
2. Navigate app
3. Try to scan vehicle

**Expected:**
- ✅ UI loads from cache
- ✅ Can navigate pages
- ✅ Can scan (saves to queue)
- ✅ Syncs when back online

---

## Scenario 6: Real-time Notifications

**Setup:** Two devices/browsers

### Admin Monitoring
1. Device A: Login as admin
2. Open "Breach Alerts" page
3. Leave page open

### Officer Action
1. Device B: Login as officer
2. Scan non-compliant vehicle
3. Observation triggers breach

### Verify Real-time Update
**Expected on Device A:**
- ✅ New breach card appears (no refresh)
- ✅ Badge count increments
- ✅ Toast notification: "New breach alert"
- ✅ Latency: <2 seconds

---

## Scenario 7: Compliance Matrix Update

**Actor:** Admin (admin@org1.com)

### Update Zone Rules
1. Navigate to Zone Management
2. Select "Beach Reserve" zone
3. Click "Edit Compliance Rules"
4. Change max_consecutive_nights: 3 → 2
5. Save

**Expected:**
- ✅ New matrix version created
- ✅ zone_compliance_matrix.version incremented
- ✅ effective_from = now
- ✅ Previous version effective_to set

### Trigger Recalculation
1. Click "Recalculate Compliance"
2. Confirm action
3. Wait for completion

**Expected:**
- ✅ Edge Function: recalculate-compliance-v3 called
- ✅ All observations re-evaluated
- ✅ New breaches detected
- ✅ drift_events entry created
- ✅ Toast: "Compliance recalculated"

### Verify New Breaches
1. Navigate to Breach Alerts
2. Check for new alerts

**Expected:**
- ✅ New breach alerts created
- ✅ breach_type: consecutive_days
- ✅ Vehicles that stayed 3 consecutive nights now breached
- ✅ Notification sent to admins

---

## Scenario 8: Data Export

**Actor:** Admin (admin@org1.com)

### Export Observations CSV
1. Navigate to Compliance Dashboard
2. Apply filters:
   - Date range: Last 7 days
   - Zone: Beach Reserve
3. Click "Export CSV"

**Expected:**
- ✅ CSV downloads instantly
- ✅ Filename: `observations-2026-02-27.csv`
- ✅ Includes all filtered records
- ✅ Columns: plate_number, zone, date, time, status
- ✅ Dates in NZ timezone
- ✅ UTF-8 encoding (opens in Excel)

### Export Full Data Package
1. Navigate to Data Management Hub
2. Click "Full Export"
3. Select tables:
   - observations
   - canonical_vehicles
   - breach_alerts
   - enforcement_actions
4. Click "Export"

**Expected:**
- ✅ ZIP file created
- ✅ Contains 4 CSV files
- ✅ Each file has correct data
- ✅ Relationships preserved (via IDs)
- ✅ File size reasonable (<50MB for test data)

---

## Scenario 9: User Management

**Actor:** Admin (admin@org1.com)

### Create New User
1. Navigate to User Management
2. Click "Add User"
3. Fill form:
   - Email: newofficer@org1.com
   - First Name: Test
   - Last Name: Officer
   - Role: Officer
   - Organization: Organization 1
4. Submit

**Expected:**
- ✅ User created in auth.users
- ✅ Profile created in user_profiles
- ✅ Email invitation sent
- ✅ Role: officer
- ✅ Organization: Organization 1

### New User First Login
1. Open invitation email
2. Click setup password link
3. Set password
4. Login

**Expected:**
- ✅ Password set successfully
- ✅ Login successful
- ✅ Dashboard loads
- ✅ Role permissions applied
- ✅ Can only see Organization 1 data

### Update User Role
1. As admin, open User Management
2. Select newofficer@org1.com
3. Change role: Officer → Admin Officer
4. Save

**Expected:**
- ✅ Role updated immediately
- ✅ User gets elevated permissions
- ✅ Can now manage users (but not edit self)
- ✅ Audit log entry created

### Deactivate User
1. Select newofficer@org1.com
2. Click "Deactivate"
3. Confirm

**Expected:**
- ✅ User status: inactive
- ✅ Cannot login
- ✅ Appears in user list (grayed out)
- ✅ Can be reactivated later

---

## Scenario 10: System Diagnostics

**Actor:** Master (master@test.com)

### Check System Health
1. Navigate to System Diagnostics
2. Review service status cards

**Expected:**
- ✅ Database: ✓ Online
- ✅ Proxy Server: ✓ Online (latency ~200ms)
- ✅ Inference Service: ✓ Online (latency ~300ms)
- ✅ Authentication: ✓ Active

### Run Integrity Check
1. Click "Run Integrity Check"
2. Wait for completion

**Expected:**
- ✅ Check runs (~10-30 seconds)
- ✅ Results displayed:
  - ✅ No orphaned observations
  - ✅ No missing photos
  - ✅ No RLS violations
  - ✅ No data inconsistencies
- ✅ Green checkmark on all tests

### View Recent Errors
1. Scroll to "Recent Errors" section

**Expected:**
- ✅ No critical errors (ideally empty)
- ✅ If errors exist, details shown
- ✅ Timestamp and stack trace available

---

## Test Completion Checklist

Mark each scenario as complete:

- [ ] Scenario 1: Officer Daily Workflow
- [ ] Scenario 2: Admin Breach Management
- [ ] Scenario 3: Multi-Organization Isolation
- [ ] Scenario 4: Offline Mode
- [ ] Scenario 5: PWA Installation
- [ ] Scenario 6: Real-time Notifications
- [ ] Scenario 7: Compliance Matrix Update
- [ ] Scenario 8: Data Export
- [ ] Scenario 9: User Management
- [ ] Scenario 10: System Diagnostics

---

## Bug Reporting Template

If issues found during testing, use this template:

```markdown
**Bug ID:** [Unique ID]
**Scenario:** [Which scenario?]
**Severity:** Critical / High / Medium / Low
**User Role:** [Officer / Admin / Master]

**Steps to Reproduce:**
1. 
2. 
3. 

**Expected Result:**
[What should happen]

**Actual Result:**
[What actually happened]

**Screenshots:**
[Attach if applicable]

**Console Errors:**
[Paste any console errors]

**Environment:**
- Browser: [Chrome/Safari/Firefox]
- Device: [Desktop/Mobile/Tablet]
- OS: [Windows/Mac/iOS/Android]
```

---

**All scenarios pass? System ready for production! ✅**
