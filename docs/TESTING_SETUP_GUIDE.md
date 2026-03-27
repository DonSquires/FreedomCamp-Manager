# Testing Setup Guide

**FreedomCamp Manager - Automated Testing with Playwright**

Complete guide for setting up and running automated E2E tests.

---

## Prerequisites

- Node.js 18+ installed
- Project running locally (`npm run dev`)
- Supabase local instance or connected to remote project
- Test data seeded in database

---

## Installation

### 1. Install Playwright

```bash
# Install Playwright and browsers
npm install -D @playwright/test
npx playwright install

# Install additional dependencies
npm install -D @supabase/supabase-js
```

### 2. Seed Test Data

```bash
# Connect to your Supabase database
psql -U postgres -d postgres -f supabase/seed/test-data.sql

# Or via Supabase CLI
supabase db reset
```

This creates:
- 3 test organizations
- 4 test users (master, 2 admins, 1 officer)
- 3 test zones
- 7 test vehicles
- Sample observations and breach alerts

### 3. Configure Environment Variables

Create `.env.test` file:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
PLAYWRIGHT_BASE_URL=http://localhost:5173

# Required for protected API response tests.
# Prefer a live bearer token from a real session.
API_TEST_BEARER_TOKEN=eyJ...

# Or let the test bootstrap a live token from a real user.
API_TEST_EMAIL=live-user@example.com
API_TEST_PASSWORD=your-live-password
```

On Alpine dev containers, Playwright now auto-detects the native browser at `/usr/bin/chromium`.
Override it only if needed with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

---

## Running Tests

### Run All Tests

```bash
# Run all test files
npx playwright test

# Run with UI mode
npx playwright test --ui

# Run specific browser
npx playwright test --project=chromium
```

### Run Specific Test Areas

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

### Run in Debug Mode

```bash
# Debug specific test
npx playwright test tests/e2e/scan-flow.spec.ts --debug

# Debug with headed browser
npx playwright test --headed

# Pause on failure
npx playwright test --pause-on-failure
```

---

## Test Reports

### View HTML Report

```bash
# Generate and open report
npx playwright show-report

# Report is saved to: playwright-report/index.html
```

### View JSON Results

```bash
# Results saved to: test-results/results.json
cat test-results/results.json | jq
```

### View Test Dashboard

1. Start dev server: `npm run dev`
2. Navigate to: `http://localhost:5173/test-dashboard`
3. Click "Refresh Results" to load latest test run
4. View progress, stats, and individual test results

---

## Test User Credentials

Use these credentials for manual testing:

| Email | Password | Role | Organization |
|-------|----------|------|--------------|
| master@test.com | Test123! | Master | All orgs |
| admin@org1.com | Test123! | Admin | Organization 1 |
| officer@org1.com | Test123! | Officer | Organization 1 |
| admin@org2.com | Test123! | Admin | Organization 2 |

---

## Test Data

### Vehicles

- `TEST123` - Compliant vehicle (self-contained, Org 1)
- `ABC123` - Non-self-contained vehicle
- `BREACH1` - Breach vehicle (overstay)
- `ORG1TEST` - Organization 1 test vehicle
- `ORG2TEST` - Organization 2 test vehicle (for RLS testing)
- `OFFLINE1`, `OFFLINE2` - Offline queue testing

### Zones

- `Beach Reserve` (Org 1) - Self-contained required, 28 nights/month, 3 consecutive
- `Restricted Zone` (Org 1) - No overnight parking
- `Org 2 Zone` (Org 2) - Organization 2 test zone

---

## Continuous Integration

### GitHub Actions Workflow

Create `.github/workflows/playwright.yml`:

```yaml
name: Playwright Tests
on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]
jobs:
  test:
    timeout-minutes: 60
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: 18
    - name: Install dependencies
      run: npm ci
    - name: Install Playwright Browsers
      run: npx playwright install --with-deps
    - name: Run Playwright tests
      run: npx playwright test
      env:
        VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
        VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
    - uses: actions/upload-artifact@v3
      if: always()
      with:
        name: playwright-report
        path: playwright-report/
        retention-days: 30
```

### Privacy Regression Checklist (CI Gate)

When a PR changes any of the following, run this checklist before merge:

- SQL migrations under `supabase/migrations/`
- Any page/hook reading tenant-sensitive tables (`audit_log`, `observations`, `breach_alerts`, `patrols`, `user_profiles`)
- Any route or role-guard logic

Required checks:

1. Verify DB-level tenant controls exist for new/changed tables:
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- At least one `FOR SELECT` policy scoped by organization or role
- Confirm service-role-only paths are explicit and justified

2. Verify frontend queries enforce org-safe filtering:
- Non-master users must use their own `organization_id`
- Master users may use GlobalFilter org scope
- No broad query should return cross-org rows by default

3. Add/refresh Playwright multi-org isolation coverage:
- Admin from Org A cannot view Org B records
- Master can switch org scope and see filtered results
- Audit views must not leak cross-org data for non-master roles

4. Evidence and auditability sanity checks:
- Sensitive actions remain visible in audit UI for authorized users
- No silent fallback that widens data scope when a column is missing

Recommended CI commands:

```bash
bun run build
bun run lint
npx playwright test tests/e2e/multi-org-rls.spec.ts
```

If any checklist item fails, block merge until fixed.

---

## Troubleshooting

### Tests Fail to Login

**Issue:** User credentials invalid or test users not created

**Solution:**
```bash
# Recreate test users via Supabase dashboard
# Or run seed script again
psql -U postgres -d postgres -f supabase/seed/test-data.sql
```

### Service Worker Issues

**Issue:** PWA tests fail due to service worker conflicts

**Solution:**
```bash
# Clear browser data before tests
npx playwright test --project=chromium --headed
# Manually: DevTools → Application → Clear Storage
```

### Offline Tests Don't Work

**Issue:** Playwright can't intercept network properly

**Solution:**
```javascript
// Use context.setOffline(true) instead of route blocking
await page.context().setOffline(true)
```

### Railway Services Timeout

**Issue:** NZSCV/MotorWeb tests fail due to cold start

**Solution:**
- Increase timeout in test: `test.setTimeout(60000)`
- Warm up Railway services before test run
- Use mock responses for CI/CD

---

## Best Practices

### 1. Use Test Fixtures

```typescript
import { test } from './setup'

test('my test', async ({ masterUser }) => {
  // masterUser is already authenticated
  await masterUser.goto('/vehicles')
})
```

### 2. Clean Up After Tests

```typescript
test.afterEach(async () => {
  await helpers.clearTestData()
})
```

### 3. Use Explicit Waits

```typescript
// ✅ Good
await page.waitForSelector('text=Vehicle scanned')

// ❌ Bad
await page.waitForTimeout(5000)
```

### 4. Verify Both UI and Database

```typescript
// Check UI
await expect(page.locator('text=TEST123')).toBeVisible()

// Verify in database
const { data } = await supabase.from('observations')...
expect(data).toHaveLength(1)
```

---

## Test Coverage Checklist

Track testing progress:

- [x] Scan Flow (Manual Entry)
- [x] Scan Flow (Camera Capture UI)
- [x] Scan Flow (GPS Capture)
- [x] Scan Flow (Compliance Evaluation)
- [x] Multi-Org RLS (Data Isolation)
- [x] Multi-Org RLS (Global Filters)
- [x] Offline Queue (Save to IndexedDB)
- [x] Offline Queue (Auto-sync)
- [x] PWA (Installation)
- [x] PWA (Service Worker)
- [ ] NZSCV Integration
- [ ] MotorWeb Integration
- [ ] AI Photo Analysis
- [ ] Compliance Recalculation
- [ ] Report Generation
- [ ] Realtime Updates
- [ ] Biometric Auth

---

## Next Steps

1. ✅ Seed test data
2. ✅ Install Playwright
3. ✅ Run test suite
4. ✅ View test dashboard
5. ⏳ Fix failing tests
6. ⏳ Add remaining test scenarios
7. ⏳ Setup CI/CD pipeline
8. ⏳ 100% test coverage

---

**Testing infrastructure complete!** 🎯

Run `npx playwright test` to start automated E2E testing.

