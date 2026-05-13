# Phase A Week 2 — Bootstrap Routes Implementation Guide

**Date**: May 19–25, 2026  
**Owner**: Frontend Platform Lead  
**Target**: All 3 bootstrap routes migrated to use case model (operational_cases + event tables)

---

## Overview

Week 2 focuses on integrating the 3 bootstrap routes with the operational case model. Each route will:

1. Switch data reads from legacy tables to `operational_cases` + `patrol_events`/`dispatch_events`/`enforcement_events`
2. Maintain org isolation via RLS on all queries
3. Pass smoke tests (already written in `tests/e2e/bootstrap-routes.test.ts`)

**Available Tools**:
- `src/hooks/useOperationalCases.ts` — Full hook suite for case model queries and mutations
- `docs/EVENT_FAMILY_CONTRACT_2026-05-04.md` — Event schema and payload examples
- `tests/e2e/bootstrap-routes.test.ts` — E2E smoke tests

---

## Route 1: Field Officer Patrol Dispatch (May 19–20)

**File**: `src/pages/FieldOfficerPortal.tsx`

**Current State**:
- Patrol dispatch UI exists
- Data reads from legacy patrol tables

**Migration Tasks**:

### Step 1: Import case model hooks
```typescript
import { 
  useOperationalCases, 
  useCreateOperationalCase,
  usePatrolEvents,
  useCreatePatrolEvent 
} from '@/hooks/useOperationalCases'
```

### Step 2: Replace patrol data query
Replace legacy `usePatrolRunData()` or similar with:
```typescript
const { data: cases, isLoading } = useOperationalCases({
  caseType: 'patrol',
  status: 'active',
  limit: 50,
})
```

### Step 3: When officer logs observation
Instead of inserting into legacy tables, insert into `patrol_events`:
```typescript
const createPatrolEvent = useCreatePatrolEvent()

const handleObservation = async (payload) => {
  const caseId = activePatrolCase.id // from useOperationalCases
  await createPatrolEvent.mutateAsync({
    caseId,
    eventType: 'patrol_observation',
    officerId: user.id,
    payload: {
      zone_id: payload.zone,
      vehicle_plate: payload.plate,
      occupation_type: payload.type,
      location: { lat, lng }
    }
  })
}
```

### Step 4: Update UI to use case metadata
- Display `case.title` as patrol run name
- Show `case.status` as patrol state
- Use `created_at` for timing

### Step 5: Test
```bash
npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts --grep "Patrol Dispatch"
```

**Success Criteria**:
- [ ] Patrol observations create `patrol_events` records
- [ ] Case model shows correct org isolation
- [ ] E2E test passes without auth gate

---

## Route 2: Dispatch Console Job List (May 21)

**File**: `src/pages/DispatchConsole.tsx`

**Current State**:
- Job list UI exists
- Data reads from legacy dispatch_jobs table

**Migration Tasks**:

### Step 1: Import hooks
```typescript
import {
  useOperationalCases,
  useDispatchEvents,
  useCreateDispatchEvent
} from '@/hooks/useOperationalCases'
```

### Step 2: Query dispatch cases
```typescript
const { data: dispatchCases } = useOperationalCases({
  caseType: 'dispatch',
  limit: 100,
})
```

### Step 3: Map dispatch lifecycle events
When job state changes (assigned → enroute → on_scene → resolved), create dispatch event:
```typescript
const createDispatchEvent = useCreateDispatchEvent()

const handleJobStateChange = async (jobId, newState) => {
  const caseId = findCaseByDispatchJob(jobId) // Find linked case
  await createDispatchEvent.mutateAsync({
    caseId,
    eventType: `dispatch_${newState}`, // dispatch_assigned, dispatch_on_scene, etc
    dispatchJobId: jobId,
    statusAtEvent: newState,
    payload: { escalation_level: currentLevel, notes: '' }
  })
}
```

### Step 4: Display unified timeline
Fetch all dispatch_events for a case:
```typescript
const events = useDispatchEvents(selectedCase.id)
// Render timeline showing: created → assigned → acknowledged → enroute → on_scene → resolved
```

### Step 5: Test
```bash
npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts --grep "Dispatch Console"
```

**Success Criteria**:
- [ ] Dispatch jobs create `dispatch_events` on state transitions
- [ ] Timeline shows event sequence (created, assigned, on_scene, resolved)
- [ ] Org isolation enforced (can't see other org's dispatch)
- [ ] E2E test passes

---

## Route 3: Enforcement Timeline (May 22)

**File**: `src/pages/EnforcementCommandCenter.tsx`

**Current State**:
- Enforcement actions UI exists
- Data reads from legacy enforcement tables

**Migration Tasks**:

### Step 1: Import hooks
```typescript
import {
  useOperationalCases,
  useEnforcementEvents,
  useCreateEnforcementEvent
} from '@/hooks/useOperationalCases'
```

### Step 2: Query enforcement cases
```typescript
const { data: enforcementCases } = useOperationalCases({
  caseType: 'enforcement',
  status: 'active',
})
```

### Step 3: Create enforcement event on action
When officer issues notice, warning, or trespass order:
```typescript
const handleIssueNotice = async (caseId, noticeData) => {
  await createEnforcementEvent.mutateAsync({
    caseId,
    eventType: 'enforcement_notice_issued',
    officerId: user.id,
    violationType: noticeData.violation,
    actionTaken: 'notice',
    outcome: 'issued',
    payload: {
      notice_number: noticeData.number,
      subject: noticeData.subject,
      location: noticeData.location,
    }
  })
}
```

### Step 4: Timeline view
Show enforcement event sequence:
```typescript
const events = useEnforcementEvents(selectedCase.id)
// Timeline: notice_issued → acknowledged → warning → trespass_order → completed
```

### Step 5: Test
```bash
npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts --grep "Enforcement Timeline"
```

**Success Criteria**:
- [ ] Enforcement actions create `enforcement_events` records
- [ ] Timeline shows event sequence with timestamps
- [ ] Org isolation enforced
- [ ] E2E test passes

---

## QA Checklist (May 23–24)

### All 3 Routes
- [ ] No TypeScript errors (`bun run build`)
- [ ] Lint passes (`bun run lint`)
- [ ] E2E smoke tests pass all 3 routes
- [ ] Org isolation verified (cross-org data hidden)
- [ ] Feature flagging ready (FF_PHASE_B_* flags can gate writes)

### Smoke Test Run
```bash
npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts
```

Expected output:
```
✅ Route 1: Field Officer Patrol Dispatch - PASS
✅ Route 2: Dispatch Console Job List - PASS
✅ Route 3: Enforcement Timeline - PASS
```

### Rollback Plan
If any route fails:
```bash
git revert <commit_hash>
npm run build  # Verify rollback cleans
npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts  # Re-test
```

---

## Commit Message Template

```
realignment: bootstrap route migration — [ROUTE_NAME]

**Task**: Migrate [route] to operational_cases + [event_type]_events

**Changes**:
- Replaced legacy [table] queries with useOperationalCases hook
- Added [event_type]_events creation on state transitions
- Updated UI to use case model metadata
- Verified org isolation via RLS

**Tests**:
- bun run build: ✅
- bun run lint: ✅
- npm run test:e2e -- bootstrap-routes.test.ts: ✅ [X/3 routes passing]

**Phase A Gate Impact**:
- [Route] ready for Phase B activation via feature flag
- Org isolation: ENFORCED
```

---

## Support

- **Questions about case model**: See `docs/EVENT_FAMILY_CONTRACT_2026-05-04.md`
- **Event schemas**: See `docs/EVENT_SEQUENCING_ROADMAP.md`
- **Hook API**: See `src/hooks/useOperationalCases.ts`
- **Blockers**: Log issue in GitHub and tag `@DonSquires/team-realignment`
