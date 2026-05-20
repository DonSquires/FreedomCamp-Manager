# Bob Autonomous E2E Testing

**Purpose**: Bob runs end-to-end tests in the background to validate that the application behavior matches the instruction manual specifications. Results are automatically analyzed and amendments are recommended when discrepancies are found.

---

## Overview

### What Bob Does
1. **Runs E2E tests** asynchronously without blocking user workflows
2. **Captures diagnostic output** from test execution
3. **Generates reports** with test results and manual-vs-actual findings
4. **Escalates amendments** when the app doesn't match the manual

### When Bob Runs Tests
- **Scheduled**: Daily at 2 AM NZ time (after nightly deployments)
- **On-demand**: Triggered by manual command `npm run bob:e2e:session`
- **Post-deployment**: Automatically after Railway deploys complete (via webhook)
- **On manual update**: When INSTRUCTION_MANUAL.md is edited, Bob re-validates

### Test Coverage
| Test Suite | Pattern | What It Validates | Frequency |
|---|---|---|---|
| **Session Lock** | `session-inactivity-timeout.spec.ts` | Manual § 2.1 (login) & § 2.2 (inactivity lock) | Daily |
| **Manual Validation** | All `*.spec.ts` files | Full manual compliance across all roles/paths | Weekly |

---

## How Bob Runs Tests

### 1. Direct Command (Immediate)
```bash
npm run bob:e2e:session
```

Runs session lock tests with immediate feedback and reporting.

**Output**:
```
[BOB] Starting E2E test runner
[BOB] Test file: tests/e2e/session-inactivity-timeout.spec.ts
[BOB] ✓ Test file found
[BOB] Running: npx playwright test tests/e2e/session-inactivity-timeout.spec.ts ...
[BOB] TEST SUMMARY:
  Total: 6
  Passed: 5
  Failed: 1
  Skipped: 0
  Success Rate: 83.3%
[BOB] ✓ Report written to: data/e2e-test-results/session-inactivity-2026-05-20T14-30-45.json
```

### 2. Autonomous Background Job (Scheduled)
```bash
npm run bob:e2e:manual-validation
```

Runs full E2E test suite against all manual specifications. Can be scheduled in GitHub Actions or as a cron job.

**Integration**:
Add to `.github/workflows/ops-bob-autonomous-e2e.yml`:
```yaml
name: Bob Autonomous E2E Testing

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM NZ time
  workflow_dispatch:

jobs:
  e2e-validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: npx playwright install chromium
      - run: npm run bob:e2e:manual-validation
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-test-results
          path: data/e2e-test-results/
```

---

## Test Results & Reporting

### Report Location
Tests write JSON reports to `data/e2e-test-results/`:

```
data/e2e-test-results/
├── session-inactivity-2026-05-20T14-30-45.json
├── session-inactivity-2026-05-20T14-45-20.json
└── session-inactivity-2026-05-21T02-00-00.json
```

### Report Format
```json
{
  "testRunId": "uuid",
  "timestamp": "2026-05-20T14:30:45.000Z",
  "testFile": "tests/e2e/session-inactivity-timeout.spec.ts",
  "testPattern": "session-inactivity",
  "status": "completed",
  "summary": {
    "total": 6,
    "passed": 5,
    "failed": 1,
    "skipped": 0,
    "successRate": "83.3%"
  },
  "diagnostics": [
    "✓ § 2.1: Sign in form is visible and functional",
    "✓ § 2.1 & 2.2: Complete login flow to authenticated portal",
    "⚠ Warning overlay NOT found after 15 seconds",
    "..."
  ],
  "errors": [
    "Error: Session lock feature not implemented"
  ]
}
```

### Manual Amendment Workflow

**If tests fail** or find discrepancies:

1. **Bob generates escalation payload** at `data/e2e-test-escalation-session-inactivity.json`
2. **Escalation contains**:
   - Test failure summary
   - Specific diagnostic findings
   - Recommendation to amend manual
   - Full test report JSON

3. **Human reviews** the escalation:
   - Compare actual behavior vs. manual spec
   - Decide: implement missing feature OR amend manual

4. **Update occurs** in one of two ways:

   **Option A: Implement Missing Feature**
   ```bash
   # Fix the feature
   git commit -m "feat: Implement session lock timeout per manual § 2.2"
   
   # Re-run tests
   npm run bob:e2e:session
   # Should now show 100% success
   ```

   **Option B: Amend Manual** (if behavior differs from spec)
   ```bash
   # Edit the manual
   nano docs/INSTRUCTION_MANUAL.md
   
   # Add note: "Coming Soon (Phase N)"
   # Or document actual behavior
   
   # Re-run tests
   npm run bob:e2e:session
   # Tests should document the intended vs. actual state
   ```

---

## Test Design for Manual Validation

Each E2E test follows this structure:

```typescript
test('§ 2.1: Sign in form is visible and functional', async ({ page }) => {
  // 1. Follow manual step-by-step
  // 2. Verify expected UI elements exist
  // 3. Log diagnostic output
  // 4. Record if behavior matches manual
  // 5. Report discrepancies
})
```

### Key Test Features
- **Diagnostic logging**: Every check prints to console (captured in report)
- **Manual section references**: Tests cite exact manual sections (e.g., § 2.1, § 2.2)
- **Fallback assertions**: If feature not found, test logs "NOT FOUND" instead of failing
- **Comprehensive output**: Test reports what actually happened, not just pass/fail

---

## Maintenance & Updates

### When Manual Changes
1. Update INSTRUCTION_MANUAL.md
2. Run `npm run bob:e2e:session` to validate
3. If tests fail, update test expectations OR revert manual change
4. Commit manual + tests together

### When Features Change
1. Implement feature in code
2. Run `npm run bob:e2e:session` to validate
3. Update manual if feature behavior differs from current docs
4. Commit feature + docs + tests together

### Adding New Tests
1. Create test file: `tests/e2e/new-feature-validation.spec.ts`
2. Add test pattern to identify manual sections
3. Create package.json script: `"bob:e2e:new-feature": "node scripts/bob-run-e2e-tests.mjs --test-pattern new-feature-validation"`
4. Document expected manual sections in test file
5. Add to Bob's weekly validation suite

---

## Integration with Self-Healing System

When E2E tests find discrepancies:

```
E2E Test Failure
       ↓
Escalation Payload Generated
       ↓
dr-bob-escalation-queue.jsonl Entry Added
       ↓
Safety Scorecard Updated
       ↓
Bob Analyzes Root Cause
       ↓
Recommendation (Feature or Manual Amendment)
       ↓
Escalation Issue Created in GitHub
```

### Example Escalation Entry
```jsonl
{
  "timestamp": "2026-05-20T14:30:45.000Z",
  "sourceFile": "bob-run-e2e-tests.mjs",
  "structured": true,
  "decision": "needs-manual-review",
  "reason": "e2e-manual-discrepancy",
  "summary": "Session lock feature not detected in E2E tests; manual § 2.2 specifies automatic inactivity lock but feature not found in app",
  "findingsCount": 1,
  "topFinding": "Session timeout blocking screen not appearing after inactivity",
  "testReport": "data/e2e-test-results/session-inactivity-2026-05-20T14-30-45.json"
}
```

---

## Command Reference

| Command | Purpose | Output |
|---|---|---|
| `npm run bob:e2e:session` | Run session lock tests immediately | JSON report + console summary |
| `npm run bob:e2e:manual-validation` | Run full E2E validation suite | Multiple JSON reports |
| `ls data/e2e-test-results/` | View all test reports | List of JSON files |
| `cat data/e2e-test-escalation-*.json` | View escalation payload | JSON with findings & recommendations |

---

## Troubleshooting

### Tests Time Out
**Problem**: Tests run for >10 minutes without completing

**Solution**: Increase timeout
```bash
npm run bob:e2e:manual-validation -- --timeout 1200000
```

### Chromium Not Found
**Problem**: `Error: Playwright Chromium browser not found`

**Solution**: Install browsers
```bash
npx playwright install chromium
```

### Tests Pass Locally but Fail in CI
**Problem**: Environment differences (headless, network, etc.)

**Solution**:
1. Check CI environment for browser binary
2. Verify test user credentials available
3. Check network/proxy settings
4. Run with `--headed` flag to see browser behavior

### Manual Amendment Ambiguity
**Problem**: Test shows feature missing; unclear whether to implement or amend manual

**Solution**:
1. Bob adds findings to escalation queue
2. PM reviews escalation with developers
3. Explicit decision made: implement OR amend
4. If amending: add "Coming Soon (Phase N)" note
5. If implementing: create feature ticket

---

## Next Steps

1. ✅ Test suite created and committed
2. ✅ Bob script for running tests created
3. ✅ npm scripts added
4. ⏳ **TODO**: Set up GitHub Actions workflow for scheduled runs
5. ⏳ **TODO**: Configure Bob to run tests daily at 2 AM
6. ⏳ **TODO**: Monitor escalation queue for discrepancies

Bob will begin autonomous E2E testing once scheduled job is enabled.
