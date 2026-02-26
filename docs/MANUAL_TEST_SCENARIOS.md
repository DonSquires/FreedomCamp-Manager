# Manual Testing Scenarios

This document provides detailed step-by-step test scenarios for manually verifying critical workflows in the FreedomCamp Manager application.

---

## 🎯 Testing Principles

- **Test with real production data** (Supabase backup already restored)
- **Use multiple user roles** (admin, officer, master)
- **Test on multiple devices** (desktop, mobile, tablet)
- **Test offline scenarios** (airplane mode, poor connectivity)
- **Verify data integrity** (no lost observations, correct compliance calculations)

---

## 📱 Scenario 1: Field Officer - Complete Scanning Workflow

**Goal:** Verify end-to-end scanning from camera to database

**User Role:** Officer  
**Prerequisites:** 
- Logged in as officer
- GPS enabled on device
- Camera permissions granted

### Steps:

1. **Navigate to Field Officer Portal**
   - [ ] Login page loads
   - [ ] Enter officer credentials
   - [ ] Click "Login"
   - [ ] Redirected to Field Officer Portal

2. **Start Scan**
   - [ ] Click "Scan Plate" button
   - [ ] Camera permission prompt appears (if first time)
   - [ ] Grant camera permission
   - [ ] Camera feed displays in PlateScanner component

3. **Capture Photo**
   - [ ] Point camera at vehicle registration plate
   - [ ] Click "Capture Photo" button
   - [ ] Photo captured and displayed
   - [ ] "Process Scan" and "Retake" buttons appear

4. **Process Scan**
   - [ ] Click "Process Scan"
   - [ ] Loading indicator shows "Processing..."
   - [ ] GPS location acquired
   - [ ] Photo uploaded to evidence bucket
   - [ ] ALPR processing completes (plate number detected)
   - [ ] Success message shows detected plate number

5. **Verify Data Created**
   - [ ] Check observations table in Supabase
   - [ ] New observation created with correct:
     - plate_number
     - photo_url
     - gps_latitude / gps_longitude
     - recorded_by (officer user ID)
     - zone_id (auto-detected from GPS)
   - [ ] Canonical vehicle created/updated
   - [ ] Compliance result created
   - [ ] Monthly stays updated

6. **Check Breach Detection**
   - [ ] If breach detected, verify breach_alerts table
   - [ ] Breach alert shows correct breach_type
   - [ ] Notification sent (if configured)

**Expected Result:** Complete observation record with photo evidence, GPS coordinates, and compliance evaluation

---

## 🚨 Scenario 2: Admin - Breach Alert Management

**Goal:** Verify admin can view, assign, and resolve breach alerts

**User Role:** Admin  
**Prerequisites:** 
- Logged in as admin
- At least one pending breach alert exists

### Steps:

1. **Navigate to Breach Alerts**
   - [ ] Click "Breach Alerts" in navigation
   - [ ] Breach Alerts page loads
   - [ ] List of breach alerts displays

2. **Filter Breach Alerts**
   - [ ] Filter by status: "Pending"
   - [ ] Only pending alerts shown
   - [ ] Filter by breach type: "No CSC"
   - [ ] Only "No CSC" breaches shown

3. **View Breach Details**
   - [ ] Click on a breach alert card
   - [ ] Modal/drawer opens with full details
   - [ ] Vehicle information displayed
   - [ ] Zone information displayed
   - [ ] Evidence photo displayed
   - [ ] Compliance history shown

4. **Assign Breach to Officer**
   - [ ] Click "Assign" button
   - [ ] Officer selection dropdown appears
   - [ ] Select an officer from list
   - [ ] Click "Confirm Assignment"
   - [ ] Success message shows
   - [ ] Breach status updates to "Assigned"
   - [ ] Officer receives notification (if configured)

5. **Resolve Breach**
   - [ ] Click "Resolve" button
   - [ ] Resolution modal appears
   - [ ] Enter resolution notes
   - [ ] Select resolution outcome (complied, warning issued, etc.)
   - [ ] Click "Confirm Resolution"
   - [ ] Breach status updates to "Resolved"
   - [ ] Resolution timestamp recorded

6. **Verify Audit Trail**
   - [ ] Check audit_log table in Supabase
   - [ ] Assignment action logged
   - [ ] Resolution action logged
   - [ ] User ID and timestamp correct

**Expected Result:** Breach alert successfully assigned and resolved with complete audit trail

---

## 📊 Scenario 3: Admin - Compliance Dashboard

**Goal:** Verify dashboard displays accurate statistics and responds to filters

**User Role:** Admin  
**Prerequisites:** 
- Logged in as admin
- Multiple observations exist across different zones

### Steps:

1. **Navigate to Compliance Dashboard**
   - [ ] Click "Compliance Dashboard" in navigation
   - [ ] Dashboard page loads
   - [ ] KPI tiles display with numbers

2. **Verify KPI Tiles**
   - [ ] Total Vehicles tile shows correct count
   - [ ] Total Observations tile shows correct count
   - [ ] Active Breaches tile shows pending breaches count
   - [ ] Compliance Rate tile shows percentage (0-100%)

3. **Apply Date Range Filter**
   - [ ] Click date range picker in GlobalFilterRibbon
   - [ ] Select "Last 7 Days"
   - [ ] KPI tiles update
   - [ ] Data refreshes to show only last 7 days

4. **Apply Zone Filter**
   - [ ] Select a specific zone from zone dropdown
   - [ ] KPI tiles update
   - [ ] Data shows only selected zone

5. **View Charts/Graphs** (if implemented)
   - [ ] Compliance trend chart displays
   - [ ] Breach type breakdown chart displays
   - [ ] Data matches selected filters

6. **Verify Data Accuracy**
   - [ ] Manually query Supabase for same filters
   - [ ] Compare counts with dashboard
   - [ ] Confirm accuracy

**Expected Result:** Dashboard displays real-time, accurate statistics that update correctly when filters applied

---

## 🚗 Scenario 4: Admin - Vehicle Management

**Goal:** Verify vehicle search, view, and update functionality

**User Role:** Admin  
**Prerequisites:** 
- Logged in as admin
- Multiple vehicles in database

### Steps:

1. **Navigate to Vehicle Management**
   - [ ] Click "Vehicle Management" in navigation
   - [ ] Vehicle list loads
   - [ ] VehicleCard components display

2. **Search for Vehicle**
   - [ ] Type plate number in search box (e.g., "ABC123")
   - [ ] List filters to matching vehicles
   - [ ] Matching vehicle(s) displayed

3. **View Vehicle Details**
   - [ ] Click "View Details" on a vehicle card
   - [ ] Vehicle details modal/page opens
   - [ ] All fields populated:
     - Plate number
     - Make, model, year, color
     - Self-contained status
     - Homeless status
     - Total observations
     - Total breaches
   - [ ] Profile photo displays (if exists)

4. **View Observation History**
   - [ ] Observation history list displays
   - [ ] Sorted by most recent first
   - [ ] Each observation shows:
     - Date/time
     - Zone
     - Compliance status
     - Photo thumbnail

5. **Update Vehicle Information**
   - [ ] Click "Edit" button
   - [ ] Edit form appears
   - [ ] Update self-contained status
   - [ ] Update self-contained expiry date
   - [ ] Click "Save"
   - [ ] Success message shows
   - [ ] Data updates in canonical_vehicles table

6. **Flag Vehicle**
   - [ ] Click "Flag Vehicle" button
   - [ ] Flag modal appears
   - [ ] Select priority (low/medium/high)
   - [ ] Enter flag reason
   - [ ] Click "Confirm"
   - [ ] Vehicle flagged
   - [ ] Flag badge appears on vehicle card

**Expected Result:** Complete vehicle information accessible and editable by admins

---

## 🗺️ Scenario 5: Admin - Zone Management

**Goal:** Verify zone creation and compliance rule configuration

**User Role:** Admin  
**Prerequisites:** 
- Logged in as admin
- Have organization selected

### Steps:

1. **Navigate to Zone Management**
   - [ ] Click "Zone Management" in navigation
   - [ ] Zone list loads
   - [ ] Zones displayed

2. **Create New Zone**
   - [ ] Click "Create Zone" button
   - [ ] Zone creation form appears
   - [ ] Fill in required fields:
     - Zone name
     - Description
     - Organization
   - [ ] Set GPS coordinates (center point)
   - [ ] Click "Create"
   - [ ] Success message shows
   - [ ] New zone appears in list

3. **Configure Compliance Rules**
   - [ ] Click on newly created zone
   - [ ] Click "Edit Compliance Rules"
   - [ ] Compliance matrix form appears
   - [ ] Configure rules:
     - [x] Requires CSC
     - Nights per month: 28
     - Max consecutive nights: 3
     - Homeless exemption: Yes
   - [ ] Click "Save Rules"
   - [ ] Rules saved to zone_compliance_matrix

4. **Verify Auto-Sync**
   - [ ] Check zones table in Supabase
   - [ ] Verify zone created
   - [ ] Check zone_compliance_matrix table
   - [ ] Verify compliance rules created (version 1)

5. **Update Compliance Rules**
   - [ ] Edit zone again
   - [ ] Change max consecutive nights to 2
   - [ ] Click "Save Rules"
   - [ ] New matrix version created (version 2)
   - [ ] Previous version marked as effective_to = now

6. **Verify Drift Detection** (if applicable)
   - [ ] Check drift_events table
   - [ ] If observations exist, drift event created
   - [ ] Drift event shows criteria_changed

**Expected Result:** Zone created with compliance rules, historical versioning working

---

## 📵 Scenario 6: Offline Mode Testing

**Goal:** Verify PWA works offline and syncs when back online

**User Role:** Officer  
**Prerequisites:** 
- PWA installed on device
- Previously loaded pages cached

### Steps:

1. **Load App While Online**
   - [ ] Open PWA
   - [ ] Login
   - [ ] Navigate to Vehicle Management
   - [ ] Navigate to Compliance Dashboard
   - [ ] View a few vehicles

2. **Go Offline**
   - [ ] Enable airplane mode (or disconnect WiFi)
   - [ ] NetworkStatusBar shows "No internet connection - working offline"

3. **Test Cached Pages**
   - [ ] Navigate to Vehicle Management
   - [ ] Previously viewed vehicles load from cache
   - [ ] Photos display from cache

4. **Test Scan Attempt** (expected to fail gracefully)
   - [ ] Try to scan a plate
   - [ ] Camera works
   - [ ] Capture photo works
   - [ ] Process scan fails with error message
   - [ ] Error message explains need for internet

5. **Go Back Online**
   - [ ] Disable airplane mode
   - [ ] NetworkStatusBar shows "Back online - syncing data..."
   - [ ] Banner auto-hides after 3 seconds

6. **Verify Sync** (if queue implemented)
   - [ ] Queued actions process
   - [ ] Data refreshes from server

**Expected Result:** App remains functional offline for viewing cached data, gracefully handles sync failures

---

## 🔒 Scenario 7: Role-Based Access Control

**Goal:** Verify officers cannot access admin functions

**User Role:** Officer  
**Prerequisites:** 
- Logged in as officer
- Admin features exist in app

### Steps:

1. **Test Direct URL Access**
   - [ ] Manually navigate to `/admin`
   - [ ] Access denied (redirected or error shown)

2. **Test Navigation Menu**
   - [ ] Check navigation menu
   - [ ] Admin-only items hidden (Zone Management, User Management, etc.)

3. **Test RLS Policies**
   - [ ] Try to query users table directly (via browser console)
     ```javascript
     const { data } = await supabase.from('user_profiles').select('*')
     ```
   - [ ] Should return only current user's profile, not all users

4. **Test Mutation Permissions**
   - [ ] Try to delete a breach alert via API
     ```javascript
     const { error } = await supabase.from('breach_alerts').delete().eq('id', 'some-id')
     ```
   - [ ] Should fail with permission error

5. **Login as Admin**
   - [ ] Logout
   - [ ] Login as admin
   - [ ] Admin menu items visible
   - [ ] Can access /admin routes
   - [ ] Can perform admin actions

**Expected Result:** Officers have read access to own data, no write/delete permissions; admins have full access

---

## 🚂 Scenario 8: Railway Services Integration

**Goal:** Verify NZSCV check and photo analysis work via Railway

**User Role:** Admin  
**Prerequisites:** 
- Railway services deployed
- Edge functions configured with Railway URLs

### Steps:

1. **Test NZSCV Status Check**
   - [ ] Open browser console
   - [ ] Run:
     ```javascript
     const result = await smokeTests.testRailwayServices()
     console.log(result)
     ```
   - [ ] Proxy service responds (may take 10-30s on cold start)
   - [ ] Returns health status

2. **Test via Edge Function**
   - [ ] Navigate to Vehicle Management
   - [ ] Click on a vehicle with known CSC warrant
   - [ ] Click "Check NZSCV Status"
   - [ ] Loading indicator shows
   - [ ] Warrant details returned:
     - Warrant type (green/blue)
     - Warrant number
     - Expiry date

3. **Test Photo Analysis** (if implemented)
   - [ ] Upload a vehicle photo
   - [ ] Click "Analyze Photo"
   - [ ] Inference service processes photo
   - [ ] Returns vehicle detection results
   - [ ] Returns 384-D embedding

4. **Test Error Handling**
   - [ ] Check NZSCV for invalid plate (e.g., "ZZZZZ999")
   - [ ] Should return "No warrant found" gracefully
   - [ ] No crash or unhandled errors

**Expected Result:** Railway services integrate correctly via Edge Functions, handle errors gracefully

---

## ✅ Testing Sign-Off

After completing all scenarios:

- [ ] All critical workflows tested
- [ ] No blocking bugs found
- [ ] Performance acceptable
- [ ] Security verified
- [ ] Documentation updated

**Tester Name:** _______________  
**Date:** _______________  
**Environment:** Production / Staging  
**Device:** Desktop / Mobile / Tablet  
**Browser:** Chrome / Safari / Firefox  

**Overall Status:** ✅ PASS / ⚠️ PASS WITH ISSUES / ❌ FAIL

**Notes:**
_______________________________________________________
_______________________________________________________
_______________________________________________________

---

**Last Updated:** Phase 8  
**Version:** 2.0 (Rebuild)
