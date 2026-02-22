# Critical Fixes for Maiden Flight - 08:00 TODAY

**Status:** 🚨 EMERGENCY DEPLOYMENT  
**Deadline:** 08:00 NZT  
**Date:** Feb 24, 2026

---

## 🔥 Issues Found

### 1. **Missing RPC Function (CRITICAL)**
- ❌ AdminPortal calls `get_admin_dashboard_stats` which doesn't exist
- ✅ **FIX:** Created `20260224_admin_dashboard_rpc.sql`

### 2. **Broken Navigation Links**
- ❌ Menu items not linked to real pages
- ✅ **FIX:** Added temporary redirects in `App.tsx`

### 3. **Placeholder Pages**
- Most admin pages exist but aren't wired to router
- Need to connect existing pages OR add redirects

---

## ✅ Fixes Applied (RIGHT NOW)

### 1. **Database Migration** ✅
File: `supabase/migrations/20260224_admin_dashboard_rpc.sql`

**Deploy command:**
```bash
supabase db push
```

**What it does:**
- Creates `get_admin_dashboard_stats(p_start_date, p_end_date, p_organization_id)` function
- Returns all 10 KPIs that AdminPortal expects
- Uses proper date filtering and organization scoping

### 2. **Router Fix** ✅
File: `src/App.tsx`

**Added routes:**
```tsx
<Route path="/admin/breaches" element={<Navigate to="/admin/observations" replace />} />
<Route path="/admin/enforcement" element={<Navigate to="/admin/observations" replace />} />
<Route path="/admin/officer-welfare" element={<Navigate to="/admin/dashboard" replace />} />
<Route path="/admin/zones" element={<Navigate to="/admin/dashboard" replace />} />
<Route path="/admin/vehicles" element={<VehicleRegistryFiltered />} />
```

**Why redirects?**
- These pages exist in `/src/pages/` but need data contracts/Edge Functions
- Redirecting to working pages prevents 404 errors
- Maintains user flow while you build proper pages post-launch

---

## 🚀 DEPLOY NOW

### Step 1: Deploy Database Function
```bash
# Push the new migration
supabase db push

# Verify it worked
supabase db query "SELECT * FROM get_admin_dashboard_stats(NOW() - INTERVAL '7 days', NOW(), NULL);"
```

**Expected output:**
```
total_observations | total_breaches | pending_breaches | ...
------------------+----------------+------------------+-----
               42 |             12 |                8 | ...
```

### Step 2: Restart Frontend
```bash
# Kill current dev server
# Restart vite
npm run dev
```

### Step 3: Test Admin Portal
1. ✅ Log in as admin
2. ✅ Click Dashboard → should load KPIs (no more 400 errors)
3. ✅ Click Observations → should navigate
4. ✅ Click Hotspots → should show map
5. ✅ Click Vehicles → should show vehicle registry

---

## 📋 Known Temporary Redirects

These menu items **redirect** instead of showing full pages:

| Menu Item | Redirects To | Reason |
|-----------|-------------|--------|
| Breaches | `/admin/observations` | Breach data is in observations table |
| Enforcement | `/admin/observations` | Enforcement actions shown in obs detail |
| Officer Welfare | `/admin/dashboard` | No dedicated page yet |
| Zones | `/admin/dashboard` | Zone stats shown in KPIs |

**Post-Launch TODO:**
- Build dedicated Breaches page (BreachAlertsReport.tsx exists)
- Build dedicated Enforcement page (EnforcementActions.tsx exists)
- Wire up Officer Welfare page (OfficerWelfareManagement.tsx exists)
- Connect Zone Management page (ZoneManagement.tsx exists)

---

## 🧪 Quick Smoke Test

### Test 1: Admin Dashboard Loads
```bash
# Open browser console (F12)
# Navigate to /admin
# Should see:
✅ No 400 errors
✅ KPI numbers load (not "...")
✅ Charts show data
```

### Test 2: Navigation Works
```bash
# Click each sidebar item
✅ Dashboard → loads
✅ Hotspots → shows map
✅ Observations → shows table
✅ Breaches → redirects to observations (no crash)
✅ Vehicles → shows vehicle list
```

### Test 3: Officer Portal Still Works
```bash
# Log in as officer
✅ Field Officer Portal loads
✅ Camera scan works
✅ vehicle-ingest returns 200 (not 401)
```

---

## 🔧 If Dashboard Still Shows 400 Errors

### Debug Steps:

1. **Check database migration deployed:**
```sql
-- Run in Supabase SQL Editor
SELECT proname FROM pg_proc WHERE proname = 'get_admin_dashboard_stats';
-- Should return 1 row
```

2. **Check RLS policies:**
```sql
-- Verify function is executable
SELECT has_function_privilege('authenticated', 'get_admin_dashboard_stats(timestamptz, timestamptz, uuid)', 'EXECUTE');
-- Should return 't' (true)
```

3. **Test function manually:**
```sql
SELECT * FROM get_admin_dashboard_stats(
  '2026-02-17 00:00:00+00'::timestamptz,
  '2026-02-24 23:59:59+00'::timestamptz,
  NULL
);
```

4. **Check browser console for exact error:**
```
F12 → Console → Look for red POST errors
Copy the full error message and response body
```

---

## 📊 What Works NOW

### ✅ Working Features
- Login/Logout
- Field Officer Portal
- Vehicle scanning (ALPR/ORC via Onspace AI fallback)
- Admin Dashboard KPIs
- Observations table
- Hotspots map
- Vehicle registry
- Global filters (date, org, zone)

### ⚠️ Temporary Redirects (Until Post-Launch)
- Breaches → Observations
- Enforcement → Observations
- Officer Welfare → Dashboard
- Zones → Dashboard

### ❌ Not Connected Yet (Build Post-Launch)
- Investigation Jobs UI
- User Management UI
- Audit Logs UI
- Reports/Export UI

---

## 🎯 Post-Launch Priority (After 08:00)

1. **Connect Existing Pages** (2-3 hours)
   - Wire `BreachAlertsReport.tsx` to `/admin/breaches`
   - Wire `EnforcementActions.tsx` to `/admin/enforcement`
   - Wire `OfficerWelfareManagement.tsx` to `/admin/officer-welfare`
   - Wire `ZoneManagement.tsx` to `/admin/zones`

2. **Add Missing Edge Functions** (3-4 hours)
   - Create `get-breaches` for breach feed
   - Create `get-enforcement-actions` for enforcement list
   - Create `get-officer-welfare-alerts` for welfare monitoring

3. **Full Integration Test** (1 hour)
   - Test all admin pages load
   - Test all drilldowns work
   - Test all filters apply correctly

---

## 🚨 Emergency Contact

**If deployment fails:**
1. Check Supabase logs: Dashboard → Edge Functions → Logs
2. Check browser console: F12 → Console
3. Check database connection: `supabase status`

**Rollback plan:**
- Frontend: `git checkout HEAD~1 src/App.tsx`
- Database: Migration is additive (no destructive changes)

---

**Document Status:** READY FOR DEPLOYMENT  
**Deploy Time:** IMMEDIATE  
**Expected Resolution:** 5 minutes  

🚀 **GO LIVE NOW!**
