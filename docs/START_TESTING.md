# 🚀 Start Testing Guide

**Quick Start for Phase 9 Integration Testing**

---

## ⚡ Quick Setup (5 Minutes)

### Step 1: Install Playwright

```bash
npm install -D @playwright/test
npx playwright install
```

### Step 2: Seed Test Data

```bash
# Connect to your Supabase database
psql -U postgres -h db.kxwjcupuxnnbnzcgmkoi.supabase.co -d postgres -f supabase/seed/test-data.sql

# Or copy/paste the SQL directly in Supabase SQL Editor:
# https://supabase.com/dashboard/project/kxwjcupuxnnbnzcgmkoi/sql
```

### Step 3: Create Test Users in Supabase Auth

**⚠️ IMPORTANT:** You must manually create these users in Supabase Dashboard:

Go to: **Supabase Dashboard → Authentication → Users → Add User**

Create 4 test users:

| Email | Password | Role | Organization |
|-------|----------|------|--------------|
| master@test.com | Test123! | Master | (Will auto-assign) |
| admin@org1.com | Test123! | Admin | (Will auto-assign) |
| officer@org1.com | Test123! | Officer | (Will auto-assign) |
| admin@org2.com | Test123! | Admin | (Will auto-assign) |

**Note:** The `user_profiles` table will auto-populate via the `on_auth_user_created` trigger when you create these users in Supabase Auth.

### Step 4: Run Tests

```bash
# Protected API tests now require live auth.
# Prefer a bearer token, or supply live credentials so the harness can mint one.
export API_TEST_BEARER_TOKEN=eyJ...
# or
export API_TEST_EMAIL=live-user@example.com
export API_TEST_PASSWORD=your-live-password

# Run all tests
npx playwright test

# Or run with UI mode
npx playwright test --ui
```

On Alpine dev containers, Playwright auto-detects the native browser at `/usr/bin/chromium`.

### Step 5: View Results

**Option A: HTML Report**
```bash
npx playwright show-report
```

**Option B: Test Dashboard**
1. Start dev server: `npm run dev`
2. Login as master@test.com / Test123!
3. Navigate to: http://localhost:5173/test-dashboard
4. Click "Refresh Results" to load latest test results

---

## 📊 Test Coverage

**Current Test Suites (4/10 areas):**

✅ **Scan Flow** (6 tests)
- Manual plate entry with validation
- Camera capture UI
- GPS coordinate capture
- Automatic compliance evaluation
- Breach detection
- Zone requirement validation

✅ **Multi-Org RLS** (6 tests)
- Organization data isolation
- Different admins see different data
- Master user sees all organizations
- Global filter by organization
- Filter persistence across pages
- Breach alerts isolation

✅ **Offline Queue** (6 tests)
- Save observations to IndexedDB when offline
- Auto-sync when back online
- Photo storage as base64
- Photo upload when online
- Sync progress indicator
- Queue persistence on app close/reopen

✅ **PWA Features** (9 tests)
- PWA install prompt
- Service worker registration
- Static asset caching
- Offline page serving
- Cache updates on deployment
- Offline indicator
- Offline navigation
- Push notifications
- WebAuthn biometric support

⏳ **Remaining Test Areas:**
- [ ] NZSCV Integration (2 scenarios)
- [ ] MotorWeb Integration (2 scenarios)
- [ ] Compliance Recalculation (2 scenarios)
- [ ] Report Generation (2 scenarios)
- [ ] Realtime Updates (2 scenarios)
- [ ] System Integration (1 scenario)

---

## 🎯 Common Test Commands

### Run All Tests
```bash
npx playwright test
```

### Run Specific Test Suite
```bash
# Scan flow tests
npx playwright test tests/e2e/scan-flow.spec.ts

# Multi-org RLS tests
npx playwright test tests/e2e/multi-org-rls.spec.ts

# Offline queue tests
npx playwright test tests/e2e/offline-queue.spec.ts

# PWA features tests
npx playwright test tests/e2e/pwa-features.spec.ts
```

### Debug Tests
```bash
# Debug mode (step through tests)
npx playwright test --debug

# Headed mode (see browser)
npx playwright test --headed

# UI mode (interactive)
npx playwright test --ui
```

### Run Single Test
```bash
# Run specific test by name
npx playwright test -g "should create observation with manual plate entry"
```

---

## 🔍 Verify Setup

### Check Test Data
```sql
-- Run in Supabase SQL Editor
SELECT 'Organizations' as table_name, COUNT(*) as count 
FROM organizations 
WHERE id LIKE '%-1111-1111-1111-%' 
   OR id LIKE '%-2222-2222-2222-%' 
   OR id LIKE '%-3333-3333-3333-%'
UNION ALL
SELECT 'User Profiles', COUNT(*) 
FROM user_profiles 
WHERE id LIKE 'aaaaaaaa-%' 
   OR id LIKE 'bbbbbbbb-%' 
   OR id LIKE 'cccccccc-%' 
   OR id LIKE 'dddddddd-%'
UNION ALL
SELECT 'Zones', COUNT(*) 
FROM zones 
WHERE id LIKE 'z%'
UNION ALL
SELECT 'Canonical Vehicles', COUNT(*) 
FROM canonical_vehicles 
WHERE plate_number IN ('TEST123', 'ABC123', 'BREACH1', 'ORG1TEST', 'ORG2TEST', 'OFFLINE1', 'OFFLINE2');
```

Expected results:
- Organizations: 3
- User Profiles: 4
- Zones: 3
- Canonical Vehicles: 7

### Test Manual Login
```bash
# 1. Start dev server
npm run dev

# 2. Open browser: http://localhost:5173/login

# 3. Login with:
# Email: master@test.com
# Password: Test123!

# 4. Should redirect to admin portal
```

---

## 🐛 Troubleshooting

### Tests Fail to Login

**Problem:** "Invalid credentials" error

**Solution:**
1. Verify test users exist in Supabase Auth Dashboard
2. Check password is exactly: `Test123!`
3. Wait 1-2 minutes after creating users (database trigger delay)

### No Test Data Found

**Problem:** Tests can't find vehicles or zones

**Solution:**
```bash
# Re-run seed script
psql -U postgres -h db.kxwjcupuxnnbnzcgmkoi.supabase.co -d postgres -f supabase/seed/test-data.sql

# Or copy/paste SQL directly in Supabase SQL Editor
```

### Service Worker Conflicts

**Problem:** PWA tests fail due to old service worker

**Solution:**
```bash
# Clear browser data before running tests
# Or run in incognito mode
npx playwright test --project=chromium --headed
```

### Railway Services Timeout

**Problem:** Tests timeout waiting for Railway services

**Solution:**
1. Warm up Railway services first:
   - Visit: https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync/health
   - Visit: https://your-proxy.railway.app/health
2. Increase test timeout:
   ```typescript
   test.setTimeout(60000) // 60 seconds
   ```

---

## 📈 Test Dashboard Usage

**Access:** http://localhost:5173/test-dashboard

**Features:**
- ✅ Overall progress tracking (0-100%)
- ✅ Stats grid (Total/Passed/Failed/Pending)
- ✅ 10 test areas organized by priority
- ✅ Individual test status with icons
- ✅ Test duration display
- ✅ "Run All Tests" and "Refresh Results" buttons
- ✅ Test execution guide with CLI commands

**How to Use:**
1. Run tests: `npx playwright test`
2. Open dashboard: http://localhost:5173/test-dashboard
3. Click "Refresh Results" to load test-results/results.json
4. View progress, stats, and individual test details
5. Run specific test areas or all tests from UI

---

## 🎬 Next Steps

1. ✅ Install Playwright
2. ✅ Seed test data
3. ✅ Create test users in Supabase Auth
4. ✅ Run initial test suite
5. ⏳ Fix any failing tests
6. ⏳ Add remaining test scenarios (NZSCV, MotorWeb, Reports, Realtime)
7. ⏳ Achieve 100% test coverage
8. ⏳ Setup CI/CD pipeline

---

## 📞 Support

**Documentation:**
- Full Testing Guide: `docs/TESTING_SETUP_GUIDE.md`
- Manual Test Scenarios: `docs/MANUAL_TEST_SCENARIOS.md`
- Phase 9 Plan: `docs/PHASE_9_INTEGRATION_TESTING.md`

**Quick Links:**
- Playwright Docs: https://playwright.dev
- Supabase Dashboard: https://supabase.com/dashboard/project/kxwjcupuxnnbnzcgmkoi

---

**Ready to test!** 🎯

Run `npx playwright test` to start automated E2E testing.
