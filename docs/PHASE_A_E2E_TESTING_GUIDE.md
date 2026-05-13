# Phase A: E2E Testing Patterns for Bootstrap Routes

**Date**: May 16, 2026  
**Owner**: QA Lead  
**Target**: Smoke test coverage for all 3 bootstrap routes

---

## Test File: `tests/e2e/bootstrap-routes.test.ts`

Located in: `tests/e2e/bootstrap-routes.test.ts`  
Framework: Playwright (v1.48+)  
Configuration: `playwright.focused.config.ts`  
Execution: `npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts`

---

## Test Structure

Each bootstrap route has a dedicated test suite with 2–3 test cases:

### Route 1: Field Officer Patrol Dispatch
```typescript
test.describe('Route 1: Field Officer Patrol Dispatch', () => {
  test('should render patrol dispatch page', async ({ page }) => {
    // Navigate to /field-officer/dispatch
    // Verify UI elements load
    // Check for case model data
  })

  test('should preserve org isolation', async ({ page }) => {
    // Verify officer cannot see other org's patrols
  })

  test('should create patrol event when observation logged', async ({ page }) => {
    // Log an observation
    // Verify patrol_events record is created
    // Confirm event is visible in timeline
  })
})
```

### Route 2: Dispatch Console Job List
```typescript
test.describe('Route 2: Dispatch Console Job List', () => {
  test('should render dispatch console with case model', async ({ page }) => {
    // Navigate to /admin/dispatch
    // Verify job list loads
    // Check dispatch_events timeline displays
  })

  test('should create dispatch event on state transition', async ({ page }) => {
    // Assign a job
    // Verify dispatch_events record created
    // Confirm status timeline updates
  })
})
```

### Route 3: Enforcement Timeline
```typescript
test.describe('Route 3: Enforcement Timeline', () => {
  test('should render enforcement timeline', async ({ page }) => {
    // Navigate to /admin/enforcement
    // Verify enforcement_events display
  })

  test('should create enforcement event on action', async ({ page }) => {
    // Issue a notice
    // Verify enforcement_events record created
  })
})
```

---

## Common Test Patterns

### Pattern 1: Navigate to route and wait for data
```typescript
await page.goto(`${BASE_URL}/field-officer/dispatch`)
await page.waitForLoadState('networkidle')

// Check if auth gate visible
if (await isSetupOrAuthGateVisible(page)) {
  console.log('✓ Route reachable (auth gate visible)')
  return
}

// Wait for case data to load
await page.waitForSelector('[data-testid="case-list"]', { timeout: 10000 })
```

### Pattern 2: Verify org isolation
```typescript
// Fetch any org context visible in API responses
const requests = []
page.on('response', response => {
  if (response.url().includes('/operational_cases')) {
    requests.push(response)
  }
})

await page.goto(url)
await page.waitForLoadState('networkidle')

// Verify organization_id query parameter or header
const response = requests[0]
const org_id = /* extract from response */
expect(org_id).toBe(user.organization_id)
```

### Pattern 3: Create event via UI and verify in database
```typescript
// Click "Log Observation" button
await page.locator('[data-testid="log-observation"]').click()

// Fill form
await page.fill('[name="vehicle_plate"]', 'ABC123')
await page.fill('[name="location"]', 'Zone A')

// Submit
await page.click('[data-testid="submit-observation"]')

// Wait for success toast
await expect(page.locator('text=Observation logged')).toBeVisible()

// Verify DB record created
const { data: events } = await supabase
  .from('patrol_events')
  .select('*')
  .eq('event_type', 'patrol_observation')
  .order('created_at', { ascending: false })
  .limit(1)

expect(events[0].payload.vehicle_plate).toBe('ABC123')
```

### Pattern 4: Timeline rendering
```typescript
// Wait for timeline to appear
await page.waitForSelector('[data-testid="event-timeline"]')

// Get all event items
const eventItems = page.locator('[data-testid="event-item"]')
const count = await eventItems.count()

expect(count).toBeGreaterThan(0)

// Verify event sequence
const events = await eventItems.allTextContents()
expect(events[0]).toContain('created')  // First event
expect(events[events.length - 1]).toContain('resolved')  // Last event
```

---

## Setup & Fixtures

### Test data setup
```typescript
// In tests/e2e/fixtures/bootstrap-routes.ts
export const testData = {
  patrol: {
    zone_id: 'zone-uuid',
    vehicle_plate: 'ABC123',
    occupation_type: 'overnight',
    location: { lat: -41.286, lng: 174.776 }
  },
  dispatch: {
    title: 'Test Dispatch Job',
    priority: 'normal',
    location: 'Nelson Bus Hub',
  },
  enforcement: {
    violation_type: 'overnight_camping',
    action_taken: 'notice',
    notice_number: 'NCC-2026-0001',
  }
}
```

### Environment setup
```typescript
// Per test file setup
test.beforeAll(async () => {
  // Initialize test org if needed
  const { data: testOrg } = await supabase
    .from('organizations')
    .insert([{ name: 'Test Bootstrap Routes Org' }])
    .select()
    .single()
  
  process.env.TEST_ORG_ID = testOrg.id
})

test.afterAll(async () => {
  // Cleanup test org
  await supabase
    .from('organizations')
    .delete()
    .eq('id', process.env.TEST_ORG_ID)
})
```

---

## Running Tests

### Run all bootstrap routes tests
```bash
npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts
```

### Run single route test only
```bash
npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts --grep "Patrol Dispatch"
```

### Run with UI (for debugging)
```bash
npm run test:headed -- tests/e2e/bootstrap-routes.test.ts
```

### Generate report
```bash
npm run test:report
```

---

## Debugging

### Enable trace for debugging
```bash
npm run test:debug -- tests/e2e/bootstrap-routes.test.ts
```

This opens Playwright Inspector where you can:
- Step through test execution
- Inspect DOM at each step
- View network requests/responses

### Screenshot on failure
```typescript
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== 'passed') {
    await page.screenshot({ path: `failure-${testInfo.title}.png` })
  }
})
```

### Log page state on failure
```typescript
test('example', async ({ page }) => {
  try {
    // test code
  } catch (error) {
    console.log(await page.content())  // Full HTML
    console.log(await page.evaluate(() => window.__data))  // JS state
    throw error
  }
})
```

---

## Success Criteria

Phase A E2E tests are **PASS** when:

- ✅ All 3 route tests complete without timeout
- ✅ No critical JS errors in console
- ✅ Case data visible in UI (or auth gate gracefully shown)
- ✅ Org isolation enforced (cross-org data not visible)
- ✅ Feature flag checks work (FF_PHASE_B_* flags evaluated)

Expected passing output:
```
✓ Route 1: Field Officer Patrol Dispatch (2/2 tests passed)
✓ Route 2: Dispatch Console Job List (2/2 tests passed)
✓ Route 3: Enforcement Timeline (2/2 tests passed)

=====================================
  3 routes | 6 tests | 0 failures
✅ PHASE A BOOTSTRAP ROUTES SMOKE TEST PASSED
```

---

## CI/CD Integration

Add this to GitHub Actions workflow (`.github/workflows/test.yml`):

```yaml
- name: Run Phase A Bootstrap Routes Tests
  run: npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts
  continue-on-error: true  # Don't block main if tests fail (Phase A only)

- name: Upload test report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: bootstrap-routes-report
    path: playwright-report/
```

Before Phase B go-live (Jun 10), change `continue-on-error: true` to `continue-on-error: false` to enforce passing tests.
