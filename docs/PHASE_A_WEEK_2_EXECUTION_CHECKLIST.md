# Phase A Week 2 — Execution Checklist

**Week**: May 19–25, 2026  
**Target**: All 3 bootstrap routes migrated + feature flags live  
**Status**: Ready for implementation

---

## Daily Standups

### Monday, May 19: Kickoff + Route 1 Start
- [ ] 09:00 — Team standoff: confirm assignments (Platform lead, Frontend leads × 3)
- [ ] 09:30 — Review `docs/WEEK_2_BOOTSTRAP_ROUTES_GUIDE.md` together
- [ ] 10:00 — Start Route 1 (Patrol Dispatch) implementation
  - Read `src/pages/FieldOfficerPortal.tsx` (existing structure)
  - Import case model hooks from `src/hooks/useOperationalCases.ts`
  - Replace legacy patrol table reads with `useOperationalCases({ caseType: 'patrol' })`
  - Add `patrol_event` creation when observation logged
- [ ] 16:00 — Commit Route 1 changes
- [ ] Log: `realignment: patrol dispatch route — case model integration (WIP)`

### Tuesday, May 20: Route 1 Complete + Route 2 Start
- [ ] 09:00 — Route 1 smoke test
  ```bash
  npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts --grep "Patrol Dispatch"
  ```
- [ ] 10:00 — If tests pass: merge Route 1 to main
- [ ] 11:00 — Start Route 2 (Dispatch Console)
  - Read `src/pages/DispatchConsole.tsx`
  - Import case model hooks
  - Pull `operational_cases` with `caseType: 'dispatch'`
  - Create `dispatch_event` on job state transitions
- [ ] 16:00 — Commit Route 2 changes

### Wednesday, May 21: Route 2 Complete + Route 3 Start
- [ ] 09:00 — Route 2 smoke test
- [ ] 10:00 — Merge Route 2 if tests pass
- [ ] 11:00 — Start Route 3 (Enforcement Timeline)
  - Read `src/pages/EnforcementCommandCenter.tsx`
  - Import case model hooks
  - Pull enforcement cases
  - Create `enforcement_event` on action (notice, warning, trespass order)
- [ ] 16:00 — Commit Route 3 changes

### Thursday, May 22: Route 3 Complete + Feature Flags Setup
- [ ] 09:00 — Route 3 smoke test
- [ ] 10:00 — Merge Route 3 if tests pass
- [ ] 11:00 — Feature flags setup
  - Verify `feature_flags` table deployed
  - Create 3 Phase B flags in DB:
    - `FF_PHASE_B_PATROL_EVENTS` (rollout 5%)
    - `FF_PHASE_B_DISPATCH_EVENTS` (rollout 5%)
    - `FF_PHASE_B_ENFORCEMENT_EVENTS` (rollout 5%)
  - Verify `useFeatureFlag()` works in all 3 routes
- [ ] 16:00 — All routes wrapped with feature flags

### Friday, May 23–24: Smoke Testing + Validation
- [ ] Full E2E test suite
  ```bash
  npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts
  ```
- [ ] Expected output: 3/3 routes PASS ✅
- [ ] Org isolation verification: cross-org data hidden ✅
- [ ] Build + lint check:
  ```bash
  npm run build && npm run lint
  ```
- [ ] All green → final commit

### Saturday, May 25: Gate Readiness Report
- [ ] Prepare Phase A Week 2 completion report:
  - Routes migrated: 3/3 ✅
  - Tests passing: Patrol ✅, Dispatch ✅, Enforcement ✅
  - Org isolation: Verified ✅
  - Feature flags: Live (5% rollout) ✅
- [ ] Final commit: `realignment: phase A week 2 complete — 3 bootstrap routes + feature flags ✅`
- [ ] Update: `docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md` section 12.1

---

## Code Snippets — Ready to Use

### Import pattern (all 3 routes)
```typescript
import { 
  useOperationalCases, 
  useCreateOperationalCase,
  usePatrolEvents,       // For Route 1
  useCreatePatrolEvent,
  useDispatchEvents,     // For Route 2
  useCreateDispatchEvent,
  useEnforcementEvents,  // For Route 3
  useCreateEnforcementEvent,
  useFeatureFlag,        // All routes
} from '@/hooks/useOperationalCases'
```

### Feature flag wrapper (all 3 routes)
```typescript
function BootstrapRoute() {
  const { data: featureEnabled } = useFeatureFlag('FF_PHASE_B_PATROL_EVENTS')  // Route 1
  // OR FF_PHASE_B_DISPATCH_EVENTS for Route 2
  // OR FF_PHASE_B_ENFORCEMENT_EVENTS for Route 3
  
  if (featureEnabled === undefined) return <Spinner />
  
  return featureEnabled ? <CaseModelView /> : <LegacyFallback />
}
```

### Event creation pattern (all 3 routes)
```typescript
// Route 1: Patrol observation
const createPatrolEvent = useCreatePatrolEvent()
await createPatrolEvent.mutateAsync({
  caseId,
  eventType: 'patrol_observation',
  officerId: user.id,
  payload: {
    zone_id, vehicle_plate, occupation_type, location
  }
})

// Route 2: Dispatch state change
const createDispatchEvent = useCreateDispatchEvent()
await createDispatchEvent.mutateAsync({
  caseId,
  eventType: 'dispatch_assigned', // or dispatch_on_scene, dispatch_resolved
  dispatchJobId: jobId,
  statusAtEvent: newStatus,
})

// Route 3: Enforcement action
const createEnforcementEvent = useCreateEnforcementEvent()
await createEnforcementEvent.mutateAsync({
  caseId,
  eventType: 'enforcement_notice_issued',
  officerId: user.id,
  violationType: 'overnight_camping',
  actionTaken: 'notice',
  payload: { notice_number, subject, location }
})
```

---

## Deployment Checklist

### Before Week 3 (May 26)
- [ ] All code committed and pushed to main
- [ ] No lint/build errors
- [ ] E2E tests passing 3/3 routes
- [ ] Feature flags verified at 5% rollout
- [ ] Org isolation tested
- [ ] Documentation updated: `docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md` section 11.2

### Blockers & Escalation
| Blocker | Escalate To | Action |
|---|---|---|
| Route test timeout | QA Lead | Increase timeout or simplify test |
| Feature flag query fails | Platform Infra | Verify table RLS + data load |
| Org isolation breach | Platform Arch | Revert route, investigate RLS |
| Build failure | Lead | Revert last commit, fix issue |

---

## Success Criteria

**Week 2 is COMPLETE when**:

- ✅ Route 1 (Patrol Dispatch) creates `patrol_events` on observation
- ✅ Route 2 (Dispatch Console) creates `dispatch_events` on state transition
- ✅ Route 3 (Enforcement Timeline) creates `enforcement_events` on action
- ✅ All 3 routes pass smoke tests
- ✅ Org isolation verified (RLS enforced)
- ✅ Feature flags live (FF_PHASE_B_* at 5% rollout)
- ✅ Build green: `npm run build` ✅
- ✅ Lint clean: `npm run lint` ✅
- ✅ No new TypeScript errors introduced

**Phase A Gate Progress**:
- Org isolation tests: 5/5 scenarios (ready for CI execution)
- Bootstrap routes: 3/3 migrated (Week 2 deliverable)
- Feature flags: Live and tested (Week 2 deliverable)
- Route/role truth: Validated via script (Week 3 deliverable)

---

## Resources

- **Routes guide**: `docs/WEEK_2_BOOTSTRAP_ROUTES_GUIDE.md`
- **Feature flags**: `docs/FEATURE_FLAGS_CANARY_ROLLOUT.md`
- **E2E tests**: `docs/PHASE_A_E2E_TESTING_GUIDE.md`
- **Event contracts**: `docs/EVENT_FAMILY_CONTRACT_2026-05-04.md`
- **Hooks API**: `src/hooks/useOperationalCases.ts` (350 lines, ready to use)

---

## Slack Updates (Post Daily)

Template:
```
🔄 **Phase A Week 2 — Day [N]**

**✅ Completed**:
- [Task 1]
- [Task 2]

**⏳ In Progress**:
- [Task 3]

**🚨 Blockers** (if any):
- [Issue]: [Action]

**➡️ Tomorrow**:
- [Task 4]

Tests: [X/3 routes passing] ✅
Build: ✅ | Lint: ✅
```
