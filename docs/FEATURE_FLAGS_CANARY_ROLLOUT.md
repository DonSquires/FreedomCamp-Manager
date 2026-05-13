# Feature Flag & Canary Rollout Guide — Phase B

**Date**: May 16, 2026  
**Owner**: Platform Infra Lead  
**Target**: Enable gradual Phase B rollout (5% → 25% → 50% → 100%)

---

## Overview

Every Phase B feature is gated behind a feature flag following the naming pattern:

```
FF_PHASE_B_<FEATURE_NAME>
```

Examples:
- `FF_PHASE_B_PATROL_EVENTS` — Activate patrol_events writes
- `FF_PHASE_B_DISPATCH_EVENTS` — Activate dispatch_events writes
- `FF_PHASE_B_ENFORCEMENT_EVENTS` — Activate enforcement_events writes

Flags support **canary rollout** with health thresholds:
- Error rate > `canary_error_rate_threshold` → auto-disable to 5%
- P95 latency > `canary_p95_latency_threshold_ms` → auto-disable to 5%

---

## Client-Side Usage

### Check if feature is enabled for user's org

```typescript
import { useFeatureFlag } from '@/hooks/useOperationalCases'

function BootstrapRoute() {
  const { data: patrolEventsEnabled } = useFeatureFlag('FF_PHASE_B_PATROL_EVENTS')
  
  if (patrolEventsEnabled) {
    // Write to patrol_events instead of legacy tables
    return <PatrolDispatchWithCaseModel />
  } else {
    // Fall back to legacy flow
    return <LegacyPatrolDispatch />
  }
}
```

### Rollout pattern in code

```typescript
const { data: isEnabled } = useFeatureFlag('FF_PHASE_B_PATROL_EVENTS')

const handlePatrolStart = async () => {
  if (isEnabled) {
    // Phase B flow: Create operational_case + patrol_event
    const caseId = await createOperationalCase({ caseType: 'patrol' })
    await createPatrolEvent({ caseId, eventType: 'patrol_start' })
  } else {
    // Phase A flow: Write to legacy patrol_runs
    await legacyCreatePatrolRun()
  }
}
```

---

## Server-Side Usage (Edge Functions, RPC)

### Check feature flag in Supabase SQL

```sql
-- In an Edge Function or RPC
SELECT enabled, rollout_percentage 
FROM public.feature_flags 
WHERE name = 'FF_PHASE_B_PATROL_EVENTS' 
AND organization_id = $1;
```

### Canary evaluation

```sql
-- Evaluate flag with canary health checks
SELECT 
  f.enabled,
  f.rollout_percentage,
  fe.error_rate,
  fe.p95_latency_ms,
  CASE 
    WHEN fe.error_rate > f.canary_error_rate_threshold THEN 'ERROR_RATE_BREACH'
    WHEN fe.p95_latency_ms > f.canary_p95_latency_threshold_ms THEN 'LATENCY_BREACH'
    ELSE 'HEALTHY'
  END as canary_status
FROM public.feature_flags f
LEFT JOIN public.feature_flag_evaluations fe ON f.id = fe.flag_id
WHERE f.name = 'FF_PHASE_B_PATROL_EVENTS';
```

---

## Admin: Manage Flags

### Create new flag

```sql
INSERT INTO public.feature_flags (
  organization_id, 
  name, 
  phase, 
  enabled, 
  rollout_percentage,
  canary_error_rate_threshold,
  canary_p95_latency_threshold_ms
) VALUES (
  'org-uuid-here',
  'FF_PHASE_B_PATROL_EVENTS',
  'B',
  true,
  5,  -- Start at 5%
  0.05,  -- 5% error rate threshold
  1000   -- 1 second latency threshold
);
```

### Enable for more users (canary progression)

```sql
-- Week 1: 5% rollout
UPDATE public.feature_flags 
SET rollout_percentage = 5 
WHERE name = 'FF_PHASE_B_PATROL_EVENTS';

-- Week 2: 25% rollout
UPDATE public.feature_flags 
SET rollout_percentage = 25 
WHERE name = 'FF_PHASE_B_PATROL_EVENTS';

-- Week 3: 50% rollout
UPDATE public.feature_flags 
SET rollout_percentage = 50 
WHERE name = 'FF_PHASE_B_PATROL_EVENTS';

-- Week 4: 100% rollout
UPDATE public.feature_flags 
SET rollout_percentage = 100 
WHERE name = 'FF_PHASE_B_PATROL_EVENTS';
```

### Emergency rollback

```bash
bash scripts/rollback-feature-flag.sh FF_PHASE_B_PATROL_EVENTS
```

This sets `enabled = false` and resets `rollout_percentage = 5`.

---

## Phase B Flags (Week 2–4 Activation)

| Flag Name | Route | Activation | Rollout Schedule |
|---|---|---|---|
| `FF_PHASE_B_PATROL_EVENTS` | Field Officer Patrol Dispatch | May 20 | 5% (May 20) → 25% (May 22) → 50% (May 24) → 100% (May 27) |
| `FF_PHASE_B_DISPATCH_EVENTS` | Dispatch Console | May 20 | 5% (May 20) → 25% (May 23) → 50% (May 25) → 100% (May 28) |
| `FF_PHASE_B_ENFORCEMENT_EVENTS` | Enforcement Timeline | May 20 | 5% (May 20) → 25% (May 24) → 50% (May 26) → 100% (May 29) |

---

## Monitoring

### Alert: Error rate spike
If `feature_flag_evaluations.error_rate > FF.canary_error_rate_threshold`:
1. Auto-disable flag to 5% rollout
2. Post alert to Slack `#phase-b-feature-flags`
3. Developer must investigate and either:
   - Fix the bug
   - Adjust threshold if spike is expected

### Alert: Latency spike
If `feature_flag_evaluations.p95_latency_ms > FF.canary_p95_latency_threshold_ms`:
1. Auto-disable flag to 5% rollout
2. Post alert to Slack
3. Check database performance or query optimization

---

## Testing with Flags Disabled

To test Phase A (legacy) flow while Phase B flags are enabled:

```typescript
// Force flag to false locally
const mockUseFeatureFlag = vi.fn().mockReturnValue({ data: false })
vi.mock('@/hooks/useOperationalCases', () => ({
  useFeatureFlag: mockUseFeatureFlag
}))
```

Then run E2E tests:
```bash
npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts
```

---

## Success Criteria (Jun 9 Phase A Gate)

- [x] `feature_flags` table deployed with RLS
- [x] `feature_flag_evaluations` table tracks canary health
- [x] 3 Phase B flags created (PATROL, DISPATCH, ENFORCEMENT)
- [x] Rollback script tested (`rollback-feature-flag.sh`)
- [x] Client-side hook (`useFeatureFlag`) works in all 3 bootstrap routes
- [ ] Canary metrics collection (error_rate, p95_latency) working (Jun 2)
- [ ] Manual rollout tested: 5% → 25% → 50% → 100% (Jun 5)
