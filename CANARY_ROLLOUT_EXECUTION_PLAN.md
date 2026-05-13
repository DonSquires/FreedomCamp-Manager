# Phase B Canary Rollout — Execution Plan (May 26 - June 2, 2026)

**Status**: Ready for execution (smoke tests passed ✅)  
**Current State**: All 3 Phase B flags deployed at baseline rollout percentages  
**Goal**: Gradually expand rollout from 5% to 100% while monitoring canary health metrics

---

## Quick Reference: Rollout Schedule

| Date | Phase | Rollout % | Action | Duration | Health Gate |
|------|-------|-----------|--------|----------|-------------|
| May 26 | Canary | 5% | Enable + verify | 2 days | Error < 5%, P95 < 1s |
| May 28 | Early Adopter | 25% | Increase if healthy | 3 days | Error < 5%, P95 < 1s |
| May 31 | Broad | 50% | Increase if stable | 2 days | Error < 5%, P95 < 1s |
| Jun 2 | Full | 100% | Complete rollout | ∞ | Maintain health |

---

## Phase B Canary Flags — Current Deployment Status

**Deployed Flags** (as of May 13, 2026):

```
FF_PHASE_B_PATROL_EVENTS          | 25% | ✅ ENABLED | baseline_increased
FF_PHASE_B_DISPATCH_EVENTS        |  5% | ✅ ENABLED | starting_canary
FF_PHASE_B_ENFORCEMENT_EVENTS     |  5% | ✅ ENABLED | starting_canary
FF_PHASE_B_DISPATCH_ACK           |  0% | ❌ DISABLED | future_phase
FF_PHASE_B_ENFORCEMENT_TIMELINE   |  0% | ❌ DISABLED | future_phase
```

**Note**: `FF_PHASE_B_PATROL_EVENTS` already at 25% from prior deployment. Dispatch and Enforcement at 5% canary for Week 3 progression.

---

## Execution Procedure — Each Rollout Phase

### Phase 1: Canary Baseline (May 26, 2026)

**Activity**: Confirm 5% rollout is active and healthy

**Steps**:
1. Verify rollout percentages in Supabase:
   ```sql
   SELECT name, rollout_percentage, enabled FROM feature_flags 
   WHERE name LIKE 'FF_PHASE_B_%' AND phase = 'B'
   ORDER BY name;
   ```

2. Expected output (before any updates):
   ```
   name                           | rollout_percentage | enabled
   ---|---|---
   FF_PHASE_B_DISPATCH_EVENTS     | 5                  | true
   FF_PHASE_B_ENFORCEMENT_EVENTS  | 5                  | true
   FF_PHASE_B_PATROL_EVENTS       | 25                 | true
   ```

3. Monitor metrics for 24 hours:
   ```sql
   SELECT 
     flag_id, 
     error_rate, 
     p95_latency_ms, 
     evaluation_count,
     created_at
   FROM public.feature_flag_evaluations
   WHERE created_at > NOW() - INTERVAL '24 hours'
   ORDER BY created_at DESC
   LIMIT 20;
   ```

**Success Criteria**:
- ✅ Zero new 500 errors in application logs
- ✅ `error_rate` < 0.05 (5%) in evaluations table
- ✅ `p95_latency_ms` < 1000ms consistently
- ✅ Event row counts growing in patrol_events, dispatch_events, enforcement_events
- ✅ No officer/admin complaints in Slack

**If Healthy** → Proceed to Phase 2  
**If Issues** → Execute emergency rollback (see below)

---

### Phase 2: Early Adopter Expansion (May 28, 2026)

**Activity**: Increase rollout from 5% to 25%

**Steps**:
1. Connect to Supabase PostgreSQL console
2. Execute rollout update:
   ```sql
   UPDATE public.feature_flags 
   SET rollout_percentage = 25
   WHERE name IN (
     'FF_PHASE_B_DISPATCH_EVENTS',
     'FF_PHASE_B_ENFORCEMENT_EVENTS'
   );

   -- Verify update
   SELECT name, rollout_percentage FROM public.feature_flags 
   WHERE name LIKE 'FF_PHASE_B_%' AND rollout_percentage = 25;
   ```

3. Verify in production (refresh app, check feature flag endpoint):
   ```sql
   SELECT name, rollout_percentage, enabled FROM public.feature_flags
   WHERE name IN ('FF_PHASE_B_DISPATCH_EVENTS', 'FF_PHASE_B_ENFORCEMENT_EVENTS');
   -- Should return: 25%, true for both
   ```

4. Monitor for 48 hours:
   ```sql
   SELECT 
     COUNT(*) as event_count,
     error_rate,
     CASE 
       WHEN error_rate > 0.05 THEN 'BREACH'
       WHEN p95_latency_ms > 1000 THEN 'LATENCY_BREACH'
       ELSE 'HEALTHY'
     END as status
   FROM public.feature_flag_evaluations
   WHERE created_at > NOW() - INTERVAL '48 hours'
   GROUP BY error_rate, p95_latency_ms
   ORDER BY created_at DESC;
   ```

**Success Criteria**:
- ✅ Error rate stays < 5%
- ✅ P95 latency stays < 1s
- ✅ Event creation rate ~5x baseline (25% vs 5%)
- ✅ No correlation between 25% rollout and error spikes

**If Healthy** → Proceed to Phase 3  
**If Issues** → Pause and investigate or rollback to 5%

---

### Phase 3: Broad Rollout (May 31, 2026)

**Activity**: Increase rollout from 25% to 50%

**Steps**:
1. Execute rollout update:
   ```sql
   UPDATE public.feature_flags 
   SET rollout_percentage = 50
   WHERE name IN (
     'FF_PHASE_B_DISPATCH_EVENTS',
     'FF_PHASE_B_ENFORCEMENT_EVENTS'
   );
   ```

2. Monitor for 48 hours (same health checks as Phase 2)

3. Verify event distribution across userbase (sample check):
   ```sql
   SELECT 
     officer_id,
     COUNT(*) as event_count,
     MAX(created_at) as last_event
   FROM public.patrol_events
   WHERE created_at > NOW() - INTERVAL '24 hours'
   GROUP BY officer_id
   ORDER BY event_count DESC
   LIMIT 10;
   -- Should see roughly equal distribution (no single user dominating)
   ```

**Success Criteria**:
- ✅ Health metrics remain good (error < 5%, latency < 1s)
- ✅ No performance degradation as % increases
- ✅ Event distribution even across org/user population
- ✅ Canary thresholds NOT breached

**If Healthy** → Proceed to Phase 4  
**If Issues** → Hold at 50% or rollback to 25%

---

### Phase 4: Full Rollout (June 2, 2026)

**Activity**: Increase rollout from 50% to 100%

**Steps**:
1. Execute final rollout update:
   ```sql
   UPDATE public.feature_flags 
   SET rollout_percentage = 100
   WHERE name IN (
     'FF_PHASE_B_DISPATCH_EVENTS',
     'FF_PHASE_B_ENFORCEMENT_EVENTS'
   );

   -- Verify: all 3 Phase B flags should now be at 100%
   SELECT name, rollout_percentage FROM public.feature_flags
   WHERE name LIKE 'FF_PHASE_B_%' AND enabled = true;
   -- Expected: all 3 flags at 100%
   ```

2. Monitor continuously (no specific end time):
   ```sql
   -- Real-time health dashboard query
   SELECT 
     f.name,
     f.rollout_percentage,
     CASE 
       WHEN fe.error_rate > f.canary_error_rate_threshold THEN '🔴 ERROR_BREACH'
       WHEN fe.p95_latency_ms > f.canary_p95_latency_threshold_ms THEN '🟡 LATENCY_BREACH'
       ELSE '🟢 HEALTHY'
     END as status,
     fe.error_rate,
     fe.p95_latency_ms,
     fe.evaluation_count
   FROM public.feature_flags f
   LEFT JOIN public.feature_flag_evaluations fe ON f.id = fe.flag_id
   WHERE f.phase = 'B' AND f.enabled = true
   ORDER BY f.name;
   ```

3. Celebrate 🎉 — Phase B launch complete!

---

## Canary Health Monitoring

### Health Metrics Definition

**Error Rate** (`error_rate` column in `feature_flag_evaluations`):
- Formula: `(failed_evaluations / total_evaluations) * 100`
- Threshold: < 5% (canary_error_rate_threshold)
- Meaning: Events created successfully at least 95% of the time
- Alert: If > 5%, investigate logs for exception patterns

**P95 Latency** (`p95_latency_ms` column):
- Definition: 95th percentile request latency
- Threshold: < 1000ms (1 second)
- Meaning: 95% of event creations complete within 1s
- Alert: If > 1000ms, check database and API performance

**Evaluation Count** (`evaluation_count`):
- Definition: Total times feature flag was queried
- Expectation: Should grow proportionally with rollout %
- Sanity check: 25% → 5x baseline, 50% → 10x baseline, 100% → 20x baseline

### Dashboard Query (Real-Time Health)

```sql
-- Paste into Supabase SQL Editor for live monitoring
WITH flag_stats AS (
  SELECT 
    f.id,
    f.name,
    f.rollout_percentage,
    COUNT(fe.id) as total_evals,
    ROUND(AVG(fe.p95_latency_ms)::numeric, 2) as avg_p95_latency,
    ROUND(AVG((fe.error_rate * 100))::numeric, 2) as avg_error_percent,
    MAX(fe.created_at) as last_evaluation
  FROM public.feature_flags f
  LEFT JOIN public.feature_flag_evaluations fe ON f.id = fe.flag_id
    AND fe.created_at > NOW() - INTERVAL '1 hour'
  WHERE f.phase = 'B' AND f.enabled = true
  GROUP BY f.id, f.name, f.rollout_percentage
)
SELECT 
  name,
  rollout_percentage,
  total_evals,
  avg_error_percent,
  avg_p95_latency,
  CASE 
    WHEN avg_error_percent > 5 THEN '🔴 ERROR_BREACH'
    WHEN avg_p95_latency > 1000 THEN '🟡 LATENCY_BREACH'
    ELSE '🟢 HEALTHY'
  END as health_status,
  last_evaluation
FROM flag_stats
ORDER BY name;
```

---

## Emergency Rollback Procedure

**When to Use**: If error rate breaches 5% or latency exceeds 1s for > 15 minutes

**Steps**:
1. **Immediate**: Reduce rollout to 5% for affected flag(s):
   ```sql
   UPDATE public.feature_flags 
   SET rollout_percentage = 5
   WHERE name = 'FF_PHASE_B_DISPATCH_EVENTS'  -- or whichever flag is breaching
   AND enabled = true;
   ```

2. **Verification** (wait 5 minutes, then check):
   ```sql
   SELECT 
     name,
     error_rate,
     p95_latency_ms,
     evaluation_count
   FROM public.feature_flag_evaluations
   WHERE created_at > NOW() - INTERVAL '5 minutes'
   ORDER BY created_at DESC;
   ```

3. **Analysis**:
   - Check application error logs for exception patterns
   - Query database performance metrics (CPU, connections, query latency)
   - Review recent code changes or schema updates

4. **Resolution**:
   - If fixable: Patch code/schema and re-deploy
   - If blockers: Keep at reduced % and escalate to tech lead
   - If false alarm: Resume rollout progression

5. **Communication**:
   - Post incident summary in #platform-engineering Slack
   - Tag @tech-lead and field team for coordination

---

## Success Criteria — Phase B Canary Complete

✅ **All 3 flags reached 100% rollout without major incidents**  
✅ **Event creation rate matches expectations** (1/20 users → 1/1 user)  
✅ **No cascade failures or performance degradation**  
✅ **Officers/admins report normal workflow** (no complaints)  
✅ **Archive: all evaluation metrics archived for Phase A Gate Final Check**  

---

## Phase A Gate Final Check (June 2-9)

Once canary completes successfully, prepare Phase A Gate report:

1. **Org Isolation**: 5/5 tests passing ✅
2. **Bootstrap Routes**: 3/3 routes smoke tests passing ✅
3. **Feature Flags**: All 3 flags at 100%, canary healthy ✅
4. **Route/Role Truth**: 100+ routes validated (in progress Week 3)
5. **Team Ownership**: Roles assigned and acknowledged (leadership)

**Gate Sign-Off**: Requires all 5 green + stakeholder approval  
**Approval Path**: Tech Lead → Product → Exec Decision  
**Consequence**: Determines if Phase B launch proceeds June 10

---

## Quick Reference: SQL Commands

### View Current Rollout State
```sql
SELECT name, rollout_percentage, enabled, updated_at 
FROM public.feature_flags 
WHERE phase = 'B' 
ORDER BY name;
```

### Update Single Flag
```sql
UPDATE public.feature_flags 
SET rollout_percentage = 25  -- Change % here
WHERE name = 'FF_PHASE_B_DISPATCH_EVENTS';
```

### Update Multiple Flags (Batch)
```sql
UPDATE public.feature_flags 
SET rollout_percentage = 50
WHERE name IN (
  'FF_PHASE_B_DISPATCH_EVENTS',
  'FF_PHASE_B_ENFORCEMENT_EVENTS'
);
```

### Emergency Disable
```sql
UPDATE public.feature_flags 
SET enabled = false
WHERE name = 'FF_PHASE_B_DISPATCH_EVENTS';
```

### Re-Enable After Fix
```sql
UPDATE public.feature_flags 
SET enabled = true, rollout_percentage = 5  -- Reset to 5%
WHERE name = 'FF_PHASE_B_DISPATCH_EVENTS';
```

### View Evaluation Metrics (Last 24h)
```sql
SELECT 
  f.name,
  COUNT(fe.id) as evals,
  ROUND(AVG(fe.error_rate * 100)::numeric, 2) as error_pct,
  ROUND(AVG(fe.p95_latency_ms)::numeric, 0) as p95_ms
FROM public.feature_flags f
LEFT JOIN public.feature_flag_evaluations fe ON f.id = fe.flag_id
  AND fe.created_at > NOW() - INTERVAL '24 hours'
WHERE f.phase = 'B'
GROUP BY f.id, f.name
ORDER BY f.name;
```

---

## References

- **Canary Rollout Guide**: `docs/FEATURE_FLAGS_CANARY_ROLLOUT.md`
- **Phase A Week 2 Report**: `PHASE_A_WEEK_2_COMPLETE.md`
- **Event Family Contract**: `docs/EVENT_FAMILY_CONTRACT_2026-05-04.md`
- **Route Validation**: `scripts/validate-bootstrap-routes.mjs`
- **Feature Flag Setup**: `scripts/setup-phase-b-flags.mjs`

---

**Last Updated**: May 13, 2026  
**Created By**: AI Agent (GitHub Copilot)  
**Owner**: Platform Team  
**Status**: Ready for Week 3 Execution (May 26 start)
