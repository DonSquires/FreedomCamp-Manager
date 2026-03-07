# Phase 8: End-to-End Testing Checklist

This document provides a comprehensive testing checklist for the rebuilt FreedomCamp Manager application.

---

## 🎯 Testing Overview

**Test Environment**: Production Supabase database with live data
**Testing Approach**: Manual verification + automated smoke tests
**Critical Paths**: Authentication → Data Loading → Scanning → Compliance → Enforcement

---

## ✅ Pre-Deployment Checklist

### 1. Environment Variables
- [ ] `.env` file contains all required variables
- [ ] `VITE_SUPABASE_URL` is set correctly
- [ ] `VITE_SUPABASE_ANON_KEY` is set correctly
- [ ] Supabase Edge Function secrets configured (PROXY_SERVER_URL, INFERENCE_SERVICE_URL)
- [ ] Railway services are deployed and healthy

### 2. Build Verification
- [ ] `bun install` completes without errors
- [ ] `bun run build` completes without TypeScript errors
- [ ] No unused imports or dead code warnings
- [ ] Bundle size is reasonable (<5MB)

### 3. Database Verification
- [ ] All current migrations are applied
- [ ] All current Edge Functions are deployed
- [ ] RLS policies are enabled on all tables
- [ ] Storage buckets (evidence, incident-evidence) are accessible
- [ ] Test user accounts exist with proper roles (admin, officer, master)

---

## 🔐 Authentication Testing

### Login Flow
- [ ] Can login with valid credentials
- [ ] Invalid credentials show error message
- [ ] Login persists after page refresh
- [ ] Logout clears session properly
- [ ] Role-based redirect works (admin → AdminPortal, officer → FieldOfficerPortal)

### Session Management
- [ ] Session expires after 7 days
- [ ] Multiple tabs share same session
- [ ] Session survives page reload
- [ ] Auth state updates across components

**Test Users:**
- Admin: (create test admin account)
- Officer: (create test officer account)
- Master: (use existing master account)

---

## 📊 Data Loading Testing

### Vehicle Management Page
- [ ] Vehicle list loads successfully
- [ ] Pagination works (if applicable)
- [ ] Search/filter by plate number works
- [ ] Vehicle details modal opens
- [ ] Profile photos display correctly
- [ ] Compliance badges show correct status
- [ ] Total observations/breaches are accurate

### Zone Management Page
- [ ] Zone list loads successfully
- [ ] Zone details display correctly
- [ ] Compliance matrix shows for each zone
- [ ] Zone filters work
- [ ] Can create new zone (admin only)
- [ ] Can edit zone (admin only)
- [ ] Zone boundaries display on map (if implemented)

### Compliance Dashboard
- [ ] KPI tiles load with correct data
- [ ] Charts/graphs render properly
- [ ] Date range filter works
- [ ] Organization filter works (if multi-org)
- [ ] Zone filter works
- [ ] Real-time updates work (if implemented)

### Breach Alerts Page
- [ ] Breach alerts list loads
- [ ] Alerts show correct breach type
- [ ] Can filter by status (pending, resolved)
- [ ] Can assign alerts to officers
- [ ] Can mark alerts as resolved
- [ ] Breach details are accurate

---

## 📸 Scanning Workflow Testing

### Plate Scanner Component
- [ ] Camera permission prompt appears
- [ ] Camera feed displays correctly
- [ ] Can capture photo
- [ ] Can retake photo
- [ ] Photo uploads to evidence bucket
- [ ] ALPR processing completes (via alpr-process edge function)
- [ ] Plate number detected correctly
- [ ] GPS coordinates captured
- [ ] Loading states show during processing
- [ ] Error handling works (camera denied, upload failed, ALPR failed)

### Post-Scan Flow
- [ ] Observation created in database
- [ ] Vehicle created/updated in canonical_vehicles
- [ ] Compliance calculation runs automatically (via triggers)
- [ ] Breach detection runs (via scan-breaches function)
- [ ] Monthly stays updated
- [ ] Consecutive nights calculated correctly

---

## 🚨 Compliance & Breach Detection Testing

### Compliance Calculation
Test with known scenarios:

**Scenario 1: Non-Self-Contained in CSC-Required Zone**
- [ ] Create observation with `is_self_contained = false`
- [ ] Zone has `requires_csc = true`
- [ ] Verify compliance result shows `breach_type = 'no_csc'`
- [ ] Verify breach alert created

**Scenario 2: Overstay (>3 nights consecutive)**
- [ ] Create 4 observations for same vehicle/zone on consecutive days
- [ ] Verify 4th observation triggers overstay breach
- [ ] Verify `consecutive_nights = 4` in monthly stays

**Scenario 3: Homeless Exemption**
- [ ] Set vehicle `homeless_status = 'confirmed'`
- [ ] Create observation in CSC-required zone without CSC
- [ ] Verify NO breach alert created (exemption applied)

**Scenario 4: Monthly Limit (>28 nights/month)**
- [ ] Create 29 observations for same vehicle/zone in same month
- [ ] Verify 29th observation triggers monthly limit breach

---

## 🔄 Custom Hooks Testing

### useVehicles Hook
- [ ] `useVehicles()` fetches vehicle list
- [ ] `useVehicle(id)` fetches single vehicle
- [ ] `createVehicle` mutation works
- [ ] `updateVehicle` mutation works
- [ ] Query invalidation works after mutations

### useZones Hook
- [ ] `useZones()` fetches zone list
- [ ] `useZone(id)` fetches single zone
- [ ] Organization filtering works
- [ ] Query caching works

### useBreaches Hook
- [ ] `useBreaches()` fetches breach alerts
- [ ] Status filtering works
- [ ] `resolveBreachMutation` works
- [ ] Real-time updates work (if implemented)

### useDashboardStats Hook
- [ ] Stats fetch correctly
- [ ] Date range filtering works
- [ ] Organization filtering works

---

## 🧩 Feature Components Testing

### StatCard
- [ ] Displays title, value, icon
- [ ] Shows trend indicator (if provided)
- [ ] Variant styles work (default, success, warning, danger)

### VehicleCard
- [ ] Displays vehicle details
- [ ] Shows compliance badge
- [ ] Profile photo renders
- [ ] "View Details" button works

### GlobalFilterRibbon
- [ ] Date range picker works
- [ ] Organization filter works (if multi-org)
- [ ] Zone filter works
- [ ] Filters persist in globalFiltersStore
- [ ] Filter changes trigger data refetch

### NetworkStatusBar
- [ ] Shows banner when offline
- [ ] Hides banner when online
- [ ] Auto-hides after reconnection (3s delay)

### PWAInstallPrompt
- [ ] Prompt appears on first visit (if browser supports)
- [ ] "Install App" button triggers install
- [ ] "Not Now" dismisses for 7 days
- [ ] Doesn't show again if already installed

### KeepScreenAwake
- [ ] Button toggles wake lock
- [ ] Screen stays awake when enabled
- [ ] Wake lock released on page hide
- [ ] Re-acquired when page visible again

### PlateScanner
- [ ] Integrated properly (see Scanning Workflow above)

---

## 🚂 Railway Services Testing

### NZSCV Status Check
```typescript
// Test in browser console
import { checkNZSCVStatus } from '@/lib/railway'
const result = await checkNZSCVStatus('ABC123')
console.log(result)
```
- [ ] Returns warrant details for valid plates
- [ ] Handles invalid plates gracefully
- [ ] Cache works (subsequent calls faster)

### MotorWeb Enrichment
```typescript
import { enrichFromMotorWeb } from '@/lib/railway'
const data = await enrichFromMotorWeb('ABC123')
console.log(data)
```
- [ ] Returns vehicle make/model/year
- [ ] Handles API errors gracefully

### Vehicle Photo Analysis
```typescript
import { analyzeVehiclePhoto } from '@/lib/railway'
const analysis = await analyzeVehiclePhoto('https://example.com/photo.jpg')
console.log(analysis)
```
- [ ] Returns vehicle detection results
- [ ] Returns 384-D embedding
- [ ] Handles inference service timeout (cold start)

---

## 📱 PWA Functionality Testing

### Installation
- [ ] App can be installed on desktop (Chrome/Edge)
- [ ] App can be installed on mobile (iOS/Android)
- [ ] App icon appears on home screen
- [ ] App opens in standalone mode

### Offline Mode
- [ ] Service Worker registers successfully
- [ ] App loads when offline
- [ ] Previously viewed pages cached
- [ ] Photos cached for offline viewing
- [ ] Show "offline" banner when disconnected
- [ ] Queue actions for later sync (if implemented)

### Background Sync (if implemented)
- [ ] Observations sync when back online
- [ ] Failed uploads retry automatically

---

## 👥 Role-Based Access Testing

### Admin Role
- [ ] Can access AdminPortal
- [ ] Can view all organizations
- [ ] Can create/edit/delete zones
- [ ] Can create/edit/delete users
- [ ] Can view all observations
- [ ] Can resolve breaches
- [ ] Can run recalculations

### Officer Role
- [ ] Can access FieldOfficerPortal
- [ ] Can scan plates
- [ ] Can create observations
- [ ] Can view own organization's data
- [ ] CANNOT access admin functions
- [ ] CANNOT edit zones
- [ ] CANNOT create users

### Master Role
- [ ] Has all admin permissions
- [ ] Can access all organizations
- [ ] Can run super_delete operations
- [ ] Can manage system settings

---

## 🚀 Performance Testing

### Page Load Times
- [ ] Login page: <2s
- [ ] Vehicle Management: <3s
- [ ] Zone Management: <3s
- [ ] Compliance Dashboard: <4s (more data)
- [ ] Breach Alerts: <3s

### Query Performance
- [ ] Vehicle list query: <1s for 100 records
- [ ] Zone list query: <1s for 50 records
- [ ] Breach alerts query: <1s for 100 records
- [ ] Dashboard stats query: <2s

### Real-time Updates
- [ ] New observations appear within 5s
- [ ] Breach alerts update within 5s
- [ ] No excessive re-renders

---

## 🐛 Error Handling Testing

### Network Errors
- [ ] Show error message when API call fails
- [ ] Retry logic works (for transient failures)
- [ ] Offline mode kicks in gracefully

### Permission Errors
- [ ] Show "Access Denied" for unauthorized actions
- [ ] RLS policies prevent unauthorized data access

### Validation Errors
- [ ] Form validation works
- [ ] Required fields highlighted
- [ ] Error messages are clear

### Edge Cases
- [ ] Empty states show correctly (no vehicles, no zones, etc.)
- [ ] Loading states show during data fetch
- [ ] Infinite scroll works (if implemented)
- [ ] No memory leaks on long sessions

---

## 📋 Final Verification

### Code Quality
- [ ] No TypeScript errors
- [ ] No console errors in browser
- [ ] No React warnings
- [ ] ESLint passes
- [ ] All imports used
- [ ] No dead code

### Documentation
- [ ] README.md updated with setup instructions
- [ ] BUILD_PLAN.md reflects actual implementation
- [ ] RAILWAY_INTEGRATION.md accurate
- [ ] All edge functions documented

### Deployment
- [ ] Production build succeeds
- [ ] Deployed to Vercel/Netlify/hosting platform
- [ ] Environment variables set on hosting
- [ ] Custom domain configured (if applicable)
- [ ] HTTPS enabled
- [ ] Performance monitoring enabled

---

## 🎉 Go-Live Checklist

- [ ] All critical tests pass
- [ ] Stakeholder approval received
- [ ] User training completed
- [ ] Support documentation ready
- [ ] Rollback plan prepared
- [ ] Monitoring alerts configured
- [ ] Announce to users

---

## 🔧 Known Issues / Future Enhancements

Track any issues discovered during testing:

- [ ] Issue 1: (description)
- [ ] Issue 2: (description)
- [ ] Enhancement 1: (description)

---

**Last Updated**: (Date)  
**Tested By**: (Name)  
**Test Environment**: Production Supabase + Local Development  
**Status**: 🚧 In Progress
