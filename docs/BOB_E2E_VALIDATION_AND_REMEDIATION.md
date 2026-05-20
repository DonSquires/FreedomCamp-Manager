# Bob's Autonomous E2E Validation & Remediation System

**Latest Commits**:
- `6bb9864c` - Bob autonomous E2E testing infrastructure
- `bbb210fd` - E2E validation workflow and Bob escalation integration

This document describes how Bob autonomously runs E2E tests, validates specifications, and performs remediation actions.

---

## System Architecture

### Three-Layer Process

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: E2E Test Execution (Automated)                    │
├─────────────────────────────────────────────────────────────┤
│ • GitHub Actions triggers daily at 2 AM NZ time            │
│ • Runs Playwright E2E tests against app                    │
│ • Validates behavior matches INSTRUCTION_MANUAL.md         │
│ • Captures diagnostic output and test results              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: Escalation Processing (Automated)                 │
├─────────────────────────────────────────────────────────────┤
│ • Parses Playwright JSON results                           │
│ • Detects manual-vs-actual discrepancies                   │
│ • Creates escalation entries with diagnostic data          │
│ • Feeds into dr-bob-escalation-queue.jsonl                 │
│ • Creates GitHub issues for failures                       │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ LAYER 3: Bob's Autonomous Remediation (In Progress)        │
├─────────────────────────────────────────────────────────────┤
│ • Bob reviews escalation entries                           │
│ • Makes autonomous decisions:                              │
│   ✓ Implement missing feature (create ticket)             │
│   ✓ Amend INSTRUCTION_MANUAL.md (create PR)               │
│   ⚠ Escalate for human review (complex issues)            │
│ • Creates PRs with fixes and commits                       │
│ • Reports findings in INSTRUCTION_MANUAL.md                │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer 1: E2E Test Execution

### Workflow: `ops-bob-e2e-validation.yml`

**Triggers**:
- 📅 **Scheduled**: Daily 2 AM NZ time (14:00 UTC previous day)
- 🎯 **Manual**: `workflow_dispatch` with configurable options

**Configurable Options** (via `workflow_dispatch`):
```yaml
inputs:
  test_pattern:          # E2E test pattern (default: *.spec.ts)
  report_findings:       # Add to escalation queue (default: true)
  auto_amend_manual:     # Auto-amend INSTRUCTION_MANUAL.md (default: false)
```

**Execution Steps**:
1. Checkout code
2. Install bun, Node, dependencies
3. Install Playwright Chromium browser
4. Run E2E tests with JSON reporter
5. Process results and create escalations
6. Upload test artifacts (playwright-report/, test results)
7. Create GitHub issue if tests failed

**Test Coverage**:
- `tests/e2e/session-inactivity-timeout.spec.ts` - Validates manual § 2.1 & § 2.2
- Additional test files can be added (e.g., portal navigation, role-based access)

**Output Files**:
```
data/e2e-test-results/
├── playwright-raw.json          # Raw Playwright results
├── summary.md                   # Human-readable summary
└── session-inactivity-*.json    # Per-test escalation (if failures)

playwright-report/
└── index.html                   # Interactive Playwright report
```

### Example: Run E2E Tests Locally

```bash
# Quick test (session lock only)
npm run bob:e2e:session

# Full validation (all tests)
npm run bob:e2e:manual-validation

# From workflow (for testing)
npx playwright test tests/e2e/session-inactivity-timeout.spec.ts \
  --reporter=json --output-file=data/e2e-test-results/playwright-raw.json
```

---

## Layer 2: Escalation Processing

### Script: `scripts/e2e-escalation-processor.mjs`

**Input**: Playwright test results (JSON format)

**Processing**:
1. Parse test suite structure
2. Count pass/fail/skip
3. Extract failure messages
4. Detect manual discrepancies (specific sections)
5. Identify missing features
6. Generate escalation entry

**Output**: 
- `dr-bob-escalation-queue.jsonl` - Append-only escalation log
- `dr-bob-escalation-latest.json` - Latest escalation state
- `data/e2e-test-escalation-*.json` - Per-pattern escalation file
- `data/e2e-test-results/summary.md` - Report summary

### Escalation Entry Structure

```json
{
  "timestamp": "2026-05-20T14:30:45.000Z",
  "sourceFile": "e2e-escalation-processor.mjs",
  "structured": true,
  "testPattern": "*.spec.ts",
  "decision": "needs-manual-review|no-action",
  "reason": "e2e-test-failure|e2e-passed",
  "summary": "Human-readable summary of findings",
  "findingsCount": 2,
  "topFinding": "Session lock feature not appearing",
  "stats": {
    "total": 6,
    "passed": 4,
    "failed": 2,
    "skipped": 0
  },
  "failures": [
    {
      "title": "§ 2.2 Session lock feature detection",
      "error": "Timeout: element #lock-screen not found",
      "trace": "..."
    }
  ],
  "discrepancies": [
    {
      "section": "§ 2.2",
      "description": "Session Lock & Inactivity",
      "issue": "✗ Warning overlay NOT found after 15 seconds",
      "recommendation": "Check if session lock is implemented correctly"
    }
  ],
  "diagnosticSummary": [
    "✓ § 2.1: Sign in form is visible",
    "✓ Complete login flow to authenticated portal",
    "✗ Warning overlay NOT found after 15 seconds",
    "..."
  ]
}
```

### Decision Logic

```javascript
if (testsFailed) {
  decision = "needs-manual-review"
  reason = "e2e-test-failure"
} else {
  decision = "no-action"
  reason = "e2e-passed"
}
```

### GitHub Issue Creation

When tests fail, workflow creates issue:

**Title**: `E2E Test Escalation: <summary>`

**Body**:
```markdown
## E2E Validation Escalation

**Run**: [123456](https://github.com/...)
**Test Pattern**: *.spec.ts
**Timestamp**: 2026-05-20T14:30:45.000Z

### Finding
Session lock feature not detected in E2E tests

### Diagnostic Output
[Full JSON escalation object]

### Next Steps
1. Review test results in artifacts
2. Decide: implement missing feature OR amend manual
3. Create feature ticket if needed
4. Update INSTRUCTION_MANUAL.md if specs differ
```

---

## Layer 3: Bob's Autonomous Remediation

### Integration with Self-Healing System

E2E validation feeds into existing Bob autonomy infrastructure:

```
E2E Escalation Entry
       ↓
dr-bob-escalation-queue.jsonl
       ↓
Bob Reads Queue (autonomous cycle)
       ↓
  Analysis & Decision Making
       ↓
┌──────────────────┬──────────────────┬──────────────────┐
│                  │                  │                  │
v                  v                  v                  v
Amend Manual    Create Feature      Escalate to       Skip
Create PR       Create Ticket       Human (complex)   (passed)
Auto-merge      Mark for later      GitHub Issue
(if CI passes)                       (needs-manual)
```

### Bob's Decision Rules (To Be Implemented)

**✅ Can Remediate Autonomously**:
- Amend INSTRUCTION_MANUAL.md when feature is "Coming Soon (Phase X)"
- Update manual when actual behavior diverges but is working as intended
- Create feature tickets for clearly missing functionality
- Create PRs with documentation fixes
- Commit and push without human approval
- Auto-merge if CI passes

**⚠️ Must Escalate for Human Review**:
- Conflicts between multiple manual sections
- Ambiguous feature requirements
- Breaking changes needed
- Security or data integrity concerns
- Changes affecting multiple roles/permissions

**❌ Cannot Implement**:
- Feature code changes (frontend/backend)
- Database migrations
- Infrastructure changes
- Permission/RBAC modifications (without explicit approval)

### Example: Bob Finds Missing Feature

**Scenario**: Session lock feature not appearing in tests

**Bob's Analysis**:
1. Check manual § 2.2: "Automatically locks session after inactivity"
2. Check code: Feature code exists but has bug
3. Check status: Feature is in active development
4. Decision: This is a BUG, not a missing feature

**Bob's Action**:
```bash
# Create escalation noting the bug
echo "Feature implemented but not working; appears to be timer bug in useSessionInactivityLock"
# Create GitHub issue with diagnostic data
# Tag for manual developer review
# Do NOT try to fix code autonomously
```

### Example: Bob Finds Spec Divergence

**Scenario**: Feature implemented differently than documented

**Bob's Analysis**:
1. Check manual: "Session persists after lock/unlock"
2. Check actual behavior: Session data is cleared on unlock
3. Decision: Actual behavior is reasonable, amend manual

**Bob's Action**:
```bash
# Update INSTRUCTION_MANUAL.md § 2.2
# Add note: "Session data is preserved for read-only access;
#           mutable operations require re-authentication"
# Commit with message:
#   "docs: Clarify session persistence behavior in § 2.2"
# Auto-merge PR
```

---

## Integration Points

### 1. Integration with Self-Healing Watchdog

**File to Modify**: `scripts/run-ci-self-heal-cycle.mjs`

```javascript
// After CI failure check, add:
async function checkE2EValidation() {
  const e2eEscalation = readJson('data/dr-bob-escalation-latest.json')
  
  if (e2eEscalation && e2eEscalation.decision === 'needs-manual-review') {
    scorecard.selfHealing.e2eValidationIssues = {
      count: e2eEscalation.findingsCount,
      topFinding: e2eEscalation.topFinding,
      timestamp: e2eEscalation.timestamp
    }
    
    // E2E failures escalate same as CI failures
    failedChecks.push({
      name: 'E2E Validation',
      url: `https://github.com/.../data/e2e-test-escalation-*.json`
    })
  }
}
```

### 2. Integration with Automated Remediation

**File to Modify**: `scripts/auto-remediation-cycle.mjs`

```javascript
// After standard remediation, add:
async function processE2EEscalations() {
  const escalationQueue = readJsonLines('data/dr-bob-escalation-queue.jsonl')
  
  for (const entry of escalationQueue) {
    if (entry.sourceFile === 'e2e-escalation-processor.mjs') {
      // Bob decides whether to amend manual or create feature ticket
      // This is called autonomously, no human approval needed
      await handleE2EEscalation(entry)
    }
  }
}

async function handleE2EEscalation(entry) {
  if (entry.decision === 'needs-manual-review') {
    // Check if this is a feature amendment
    for (const disc of entry.discrepancies) {
      if (disc.recommendation.includes('amend manual')) {
        // Create PR to amend INSTRUCTION_MANUAL.md
        await amendManual(disc)
        await createAndMergePR(...)
      }
    }
  }
}
```

### 3. Integration with Bob's Brain Dump

**File to Update**: `docs/BOB_BRAIN_DUMP.md`

Bob's ingestor should include E2E testing knowledge:
```markdown
## E2E Validation System

Bob runs automated E2E tests daily to:
1. Validate app behavior matches INSTRUCTION_MANUAL.md
2. Detect UI feature regressions
3. Identify missing functionality
4. Amend documentation when specs diverge

Escalation Process:
- Test failures → create escalation entry
- Bob analyzes: feature missing vs. spec divergence
- If spec divergence: amend manual + create PR
- If feature missing: create feature ticket
- If bug: escalate to human for code fix
```

---

## Usage Guide

### Manual: Run E2E Tests Now

```bash
# Session lock validation (quick)
npm run bob:e2e:session

# Full manual validation suite
npm run bob:e2e:manual-validation

# View results
ls -la data/e2e-test-results/
cat data/e2e-test-results/summary.md
```

### Manual: Trigger Workflow

GitHub Actions → `Ops Bob E2E Validation Gate` → `Run workflow`

Options:
- Test pattern: `session-inactivity` (quick) or `*.spec.ts` (full)
- Report findings: `true` (create escalations)
- Auto-amend manual: `true` (update docs) or `false` (just report)

### Manual: Review Escalations

```bash
# Latest escalation
cat data/dr-bob-escalation-latest.json

# All escalations (append-only log)
tail -f data/dr-bob-escalation-queue.jsonl

# Escalation issue in GitHub
# Search: label:e2e-validation, label:escalation
```

### Manual: Amend Manual Based on E2E Findings

1. Run tests: `npm run bob:e2e:session`
2. Review summary: `cat data/e2e-test-results/summary.md`
3. Edit manual: `nano docs/INSTRUCTION_MANUAL.md`
4. Commit: `git commit -am "docs: Update manual based on E2E findings"`
5. Push and create PR for review

---

## Troubleshooting

### Tests Time Out
```bash
npm run bob:e2e:manual-validation -- --timeout 1200000
```

### Chromium Not Found
```bash
npx playwright install chromium
```

### Escalation Not Created
```bash
# Check processor output
node scripts/e2e-escalation-processor.mjs \
  --results-file data/e2e-test-results/playwright-raw.json \
  --report-to-bob true

# Check escalation queue
cat data/dr-bob-escalation-queue.jsonl | tail -5
```

### Manual Amendments Not Appearing
- E2E processor only auto-amends if `--auto-amend-manual=true`
- Workflow defaults to `false` (report only, no auto-amendments)
- Manual dispatch can enable auto-amendment
- Set to `true` in workflow if you want autonomous amendment

---

## Testing the E2E System

### Step-by-Step Test

1. **Create test failure manually** (for testing):
   ```bash
   # Edit test to fail
   nano tests/e2e/session-inactivity-timeout.spec.ts
   # Find a test and add: throw new Error('Forced test failure')
   ```

2. **Run tests locally**:
   ```bash
   npm run bob:e2e:session
   ```

3. **Verify escalation created**:
   ```bash
   cat data/e2e-test-escalation-session-inactivity.json
   ```

4. **Check escalation queue**:
   ```bash
   tail data/dr-bob-escalation-queue.jsonl
   ```

5. **Revert test change**:
   ```bash
   git checkout tests/e2e/session-inactivity-timeout.spec.ts
   ```

---

## Next Steps

### Immediate (Ready Now)
- ✅ E2E tests created and committed
- ✅ Bob test runner script created
- ✅ GitHub Actions workflow created
- ✅ Escalation processor created

### Short-Term (This Week)
- ⏳ Integrate with self-healing watchdog
- ⏳ Enable Bob's autonomous decision-making
- ⏳ Test escalation flow end-to-end

### Medium-Term (This Month)
- ⏳ Add more E2E test coverage (portal navigation, role-based access)
- ⏳ Implement Bob's feature ticket creation
- ⏳ Set up autonomous manual amendment workflow
- ⏳ Monitor escalation queue patterns for improvements

---

## Related Workflows

| Workflow | File | Purpose | Bob Autonomy |
|----------|------|---------|--------------|
| **E2E Validation** | `ops-bob-e2e-validation.yml` | Daily E2E tests + escalations | NEW (this doc) |
| **Self-Healing Watchdog** | `ops-self-healing-watchdog.yml` | CI failure detection & rerun | Detect issues |
| **Automated Remediation** | `ops-automated-remediation.yml` | Lint fixes, dependency updates | Create PR |
| **Operational Testing Gate** | `ops-bob-operational-testing-gate.yml` | Test Bob's governance quality | Introspection |

---

## Files Created/Modified

| File | Status | Purpose |
|------|--------|---------|
| `.github/workflows/ops-bob-e2e-validation.yml` | ✅ NEW | E2E test execution workflow |
| `scripts/e2e-escalation-processor.mjs` | ✅ NEW | Parse results & create escalations |
| `scripts/bob-run-e2e-tests.mjs` | ✅ EXISTING | Local E2E test runner |
| `tests/e2e/session-inactivity-timeout.spec.ts` | ✅ EXISTING | E2E test suite |
| `docs/BOB_AUTONOMOUS_E2E_TESTING.md` | ✅ EXISTING | E2E system documentation |
| `package.json` | ✅ MODIFIED | Added npm scripts |
| `scripts/run-ci-self-heal-cycle.mjs` | ⏳ TODO | Add E2E validation check |
| `scripts/auto-remediation-cycle.mjs` | ⏳ TODO | Add E2E escalation handling |

---

## References

- **E2E System Doc**: [docs/BOB_AUTONOMOUS_E2E_TESTING.md](docs/BOB_AUTONOMOUS_E2E_TESTING.md)
- **Instruction Manual**: [docs/INSTRUCTION_MANUAL.md](docs/INSTRUCTION_MANUAL.md)
- **Self-Healing System**: [scripts/run-ci-self-heal-cycle.mjs](scripts/run-ci-self-heal-cycle.mjs)
- **Escalation Queue**: [data/dr-bob-escalation-queue.jsonl](data/dr-bob-escalation-queue.jsonl)
