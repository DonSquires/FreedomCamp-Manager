# Feature Summary: Bob Patrol & Dispatch Intelligence (May 10, 2026)

**Commit**: `0b851b82`  
**Date**: 2026-05-10

## Overview

This update introduces deterministic patrol setup analysis and historical dispatch job classification for Bob AI Assistant, enabling self-correcting workflows for operational data import and compliance analysis.

## New Features

### 1. Bob Patrol Setup Blueprint (`src/lib/bobSetupBlueprint.ts`)
Automated extraction and analysis of patrol setup information from contract documents and schedules.

**What It Does:**
- Extracts facility requirements, patrol shifts, SOP steps, and compliance blockers from pasted text
- Evaluates patrol shift compliance (task time + break time + travel time vs. shift window)
- Analyzes historical patrol performance and identifies root-cause issues
- Classifies performance problems into **5 actionable types**:
  - `officer_execution` — Missed or incomplete jobs
  - `route_design` — Inefficient stop sequencing or geography
  - `onsite_time` — Inconsistent dwell time vs. standard
  - `schedule_design` — Timeline pressure or dispatch lag
  - (See `HistoricalPerformanceIssue` interface for details)

**Key Exports:**
```typescript
import {
  looksLikePatrolSetupBrief,
  coercePatrolSetupBlueprint,
  evaluatePatrolShiftCompliance,
  reviewHistoricalPatrolPerformance,
  formatHistoricalPerformanceAdminFeedback,
  findPrimaryShiftForCode,
  buildPatrolSetupBlueprintDocument,
  formatPatrolSetupBlueprintReply,
} from '@/lib/bobSetupBlueprint'
```

**Usage Example:**
```typescript
const blueprint = coercePatrolSetupBlueprint(parsed, rawText)
const compliance = evaluatePatrolShiftCompliance(blueprint)
const performance = reviewHistoricalPatrolPerformance(blueprint)
const adminFeedback = formatHistoricalPerformanceAdminFeedback(performance)
```

**Test Coverage:** 6 multi-scenario tests in `src/lib/__tests__/bobSetupBlueprint.test.ts` (279 lines)

---

### 2. Historical Dispatch Job Classification (`src/lib/historicalDispatchIntelligence.ts`)
Deterministic classification and verification of historical alarm/dispatch jobs before import.

**Supported Job Types:**
- `noise_control` — Noise complaints and assessments
- `alarm_activation` — Intruder/alarm system activations
- `fire_alarm` — Fire alarm responses
- `late_to_close` — Late-to-close (FTS) calls
- `atm_maintenance` — ATM service and maintenance
- `other_dispatch` — Unclassified generic dispatch

**Key Features:**
- **Pre-classification hints** guide Bob's mapping decisions
- **Placement verification** auto-detects and flags mismatches
- **Training tips** auto-generate recommendations for data structuring
- **Confidence scores** indicate classification certainty (0.6–0.95)

**Key Exports:**
```typescript
import {
  classifyHistoricalDispatchJob,
  buildHistoricalDispatchPlacementReview,
  verifyBobDispatchPlacementPlan,
} from '@/lib/historicalDispatchIntelligence'
```

**Usage Example:**
```typescript
const row = { despatchNo: '1001', clientName: 'NELSON NOISE CONTROL', ... }
const classified = classifyHistoricalDispatchJob(row)
// → { jobType: 'noise_control', confidence: 0.95, targetLocations: [...] }

const review = buildHistoricalDispatchPlacementReview(rawTabularData)
const verification = verifyBobDispatchPlacementPlan(bobPlan, review)
if (!verification.isValid) {
  console.log(verification.errors) // ['Dispatch 1001 expected noise_control, got alarm_activation']
}
```

**Test Coverage:** 3 tests in `src/lib/__tests__/historicalDispatchIntelligence.test.ts` (92 lines)

---

### 3. Fallback Patrol Zones (`src/lib/patrolZoneFallbacks.ts`)
Pre-configured geofence boundaries for common Nelson region deployment areas.

**Available Fallbacks:**
- **587 Nelson Patrol** — Nelson City boundary (primary)
- **586 Richmond Patrol** — Richmond/Tasman area
- **583 Motueka Patrol** — Motueka area
- **585 Day Shift Patrol** — Multi-area coverage for day shifts

**Usage:**
```typescript
const fallback = resolvePatrolZoneFallback(blueprint)
// Returns PatrolZoneFallback with geometry (Polygon), radius (250m), and source metadata
```

**When Used:**
- Activated automatically when new site coordinates are unavailable
- Can be overridden by explicit user-uploaded boundaries
- Provides deterministic zone startup during rapid onboarding

---

## Bob AI Integration

### In AiAnalysis Chat (Bob chat page - `/ai-analysis`)
- **New intake mode**: `historical_alarm_dispatch_data`
- **Pre-review hints** embedded in Prompt before Bob responds
- **Automatic verification** after Bob generates placement plan
- **Self-correction loop**: If verification fails, Bob receives correction prompt with mismatches

### In BobAssistantStudio Patrol Brief
- **Organization-wide patrol option analysis** — queries available patrols across org
- **Historical performance diagnostics** — classifies performance issues with severity
- **Admin-actionable feedback** — recommends fixes with approval gates

---

## Test Suite

### Unit Tests (Passing ✅)
1. **bobSetupBlueprint.test.ts** (279 lines, 6 tests)
   - Detects patrol briefs from multiple formats
   - Coerces parsed data into stable structures
   - Evaluates compliance and flags non-compliant shifts
   - Formats user-facing and admin summaries
   - Diagnoses performance patterns

2. **historicalDispatchIntelligence.test.ts** (92 lines, 3 tests)
   - Classifies noise, alarm, and ATM jobs with confidence
   - Builds placement review from tabular data
   - Verifies Bob's plan matches expected mappings

3. **patrolZoneFallbacks.test.ts** (35 lines, 2 tests)
   - Resolves fallback zones by shift code or facility name
   - Chains fallbacks automatically

### E2E Test Improvements
- **auth.ts** — Enhanced form selectors for headless and headed modes
- **crm-service-provider-visual.spec.ts** — Dynamic timeout scaling for large test suites
- **ptt-radio-smoke.spec.ts** — CORS header handling and multiplex context verification
- **pwa-features.spec.ts** — Improved offline state and app shell assertions

---

## PTT Radio Enhancements

### Multiplex Mode Resolution
- **New state management**: `resolvedMultiplexMode` (nullable, resolves via edge function)
- **Delegation detection**: Compares client_org_id against user's home/employer org
- **Fallback routing**: Defaults to `diplomatic` if delegated, `tactical` otherwise
- **Global filter support**: Uses persisted global filter org for cross-org context

**New Functions:**
```typescript
function readPersistedGlobalFilterOrgId(): string | null
function resolvePreferredClientOrgId(storeOrganizationId: string | null): string | null
```

---

## Other Updates

### Compiler & Build
- **tsconfig.json**: Added `ignoreDeprecations: "5.0"` for TypeScript compatibility

### Live Session Diagnostics
- **Actionable filtering**: Only flag errors that require investigation; suppress benign geocoding timeouts
- **Status classification**: Distinguish passive (non-actionable) from actionable diagnostic snapshots

### Vehicle Management Safety
- **Null-coercion**: Safe array handling for missing vehicle data using `safeVehicles` wrapper

### Mobile UX Testing
- **New test orchestrator**: `scripts/agentic-ui-comprehensive-mobile-ux.mjs`
  - Tests all mobile pages across all user roles (admin, master, officer, admin_officer)
  - Supports built-in test packs (login-health, tender-shadow, ptt-zindex)
  - Auto-publishes failures to bug_reports table

---

## Documentation

### Architecture Documentation
- **ADR 013** — [docs/adr/013-bob-patrol-dispatch-intelligence.md](docs/adr/013-bob-patrol-dispatch-intelligence.md)  
  Full architectural rationale, design decisions, and risk mitigations

### Decision Log
- **DECISIONS.md** — New entry documenting pre-classification and verification workflow

---

## Deployment Checklist

After merging to main:

- [ ] Run `bun run test:unit` to verify all unit tests pass
- [ ] Run `bun run build` to ensure production build succeeds
- [ ] Review bot-agentic-test-runs history logs for last successful run
- [ ] If deploying to production, confirm no lint or type errors in CI
- [ ] Update relevant Supabase Edge Function docs if Bob chat endpoints changed
- [ ] Verify fallback patrol zone boundaries are acceptable for your region

---

## Breaking Changes

**None.** All changes are additive. Existing Bob workflows remain unchanged; new patrol/dispatch workflows are opt-in via dedicated UI controls.

---

## Known Limitations

1. **Keyword-based job classifier** may have false positives on ambiguous dispatch comments. Mitigated by verification loop.
2. **Pre-review hints** may influence Bob's plan. Hints are non-binding; Bob can override with evidence.
3. **Fallback patrol zones** are approximate. Users should upload exact boundaries for precise operations.

---

## Support & Further Reading

- **Integration Guide**: See `src/pages/AiAnalysis.tsx` and `BobAssistantStudio.tsx` for usage patterns
- **Schema Reference**: `src/lib/bobSetupBlueprint.ts` line 1–50 (interface definitions)
- **Test Examples**: All test files in `src/lib/__tests__/` demonstrate real-world usage

---

## Files Changed

**New Files (7)**:
- `src/lib/bobSetupBlueprint.ts` (910 lines)
- `src/lib/historicalDispatchIntelligence.ts` (292 lines)
- `src/lib/patrolZoneFallbacks.ts` (121 lines)
- `src/lib/__tests__/bobSetupBlueprint.test.ts` (279 lines)
- `src/lib/__tests__/historicalDispatchIntelligence.test.ts` (92 lines)
- `src/lib/__tests__/patrolZoneFallbacks.test.ts` (35 lines)
- `scripts/agentic-ui-comprehensive-mobile-ux.mjs` (308 lines)
- `docs/adr/013-bob-patrol-dispatch-intelligence.md`

**Modified Files (13)**:
- `src/pages/PTTRadio.tsx` — +104 lines (multiplex mode resolution)
- `src/pages/VehicleManagement.tsx` — +8 lines (safe array handling)
- `tests/e2e/auth.ts` — +12 lines (form selector improvements)
- `tests/e2e/crm-service-provider-visual.spec.ts` — +4 lines (dynamic timeout)
- `tests/e2e/ptt-radio-smoke.spec.ts` — +64 lines (CORS & validation)
- `tests/e2e/pwa-features.spec.ts` — +14 lines (offline assertions)
- `tests/e2e/visual-regression.spec.ts` — -1 line (enum fix)
- `supabase/functions/live-session-diagnostics-ingest/index.ts` — +58 lines (actionable filtering)
- `tsconfig.json` — +1 line (compiler setting)
- `docs/DECISIONS.md` — +5 lines (new decision entry)
- Plus test reports and history logs

**Total**: ~2200 lines of new code + tests + docs

---

## Questions or Issues?

For questions about the new patrol/dispatch intelligence features, refer to ADR 013 or contact the development team. All code follows the existing Bob Truth Protocol and Change Intent Validation Gate best practices documented in [docs/DECISIONS.md](docs/DECISIONS.md).
