# Phase B Canary Monitoring Checklist — May 16–17, 2026

**Observation Window:** 24–48 hours  
**Purpose:** Validate Phase B feature flags against error rate and latency thresholds before gate verification (May 19–20)  
**Time Commitment:** ~15 minutes per day

---

## Daily Monitoring Routine (May 16 & 17)

### Morning Check (09:00 NZ)

**⏱️ Time: ~10 minutes**

1. **Run Metrics Collection**
   ```bash
   node scripts/check-canary-thresholds.mjs
   ```
   Expected output:
   - ✅ **Healthy flags:** Error rate < threshold, p95 latency < threshold
   - ⚠️ **Warning flags:** Approaching thresholds (orange zone)
   - 🚨 **Critical flags:** Exceeded thresholds (red zone) — **IMMEDIATE ACTION REQUIRED**

2. **Record Results**
   - Take screenshot or copy output to `data/daily-canary-checks/` folder
   - Note filename: `canary-check-2026-05-16-morning.txt`
   - Log entry: timestamp, flag status, observations

3. **Check for Critical Alerts**
   - If any flags show 🚨 CRITICAL status:
     - Document the flag name and specific metric (error rate or latency)
     - Notify team lead immediately
     - Do NOT attempt rollback without team approval
   - If no critical alerts, continue to next section

### Afternoon Check (17:00 NZ)

**⏱️ Time: ~10 minutes**

1. **Run Metrics Collection Again**
   ```bash
   node scripts/check-canary-thresholds.mjs --save-report
   ```
   This saves a detailed JSON report to `data/daily-canary-checks/`

2. **Compare with Morning Results**
   - Are error rates stable, improving, or degrading?
   - Are latencies trending up or down?
   - Are affected user counts increasing (normal) or spiking (concerning)?

3. **Document Observations**
   - Create entry in `data/daily-canary-checks/OBSERVATIONS.md` with format:
     ```markdown
     ## May 16 (Day 1)
     
     ### Morning (09:00)
     - FF_PHASE_B_PATROL_EVENTS (100%): Error 0.2%, Latency 150ms ✅
     - FF_PHASE_B_ENFORCEMENT_TIMELINE (25%): Error 0.1%, Latency 120ms ✅
     - FF_PHASE_B_DISPATCH_EVENTS (50%): Error 0.8%, Latency 450ms ✅
     
     ### Afternoon (17:00)
     - FF_PHASE_B_PATROL_EVENTS (100%): Error 0.3%, Latency 155ms ✅ (stable)
     - FF_PHASE_B_ENFORCEMENT_TIMELINE (25%): Error 0.15%, Latency 125ms ✅ (stable)
     - FF_PHASE_B_DISPATCH_EVENTS (50%): Error 0.9%, Latency 460ms ✅ (stable)
     
     **Summary:** All flags nominal. No concerning trends observed.
     ```

---

## Critical Alert Response (If Triggered)

### 🚨 Critical Error Rate (> 1.5x threshold)

**Immediate Actions:**
1. Verify data is accurate: Run query directly against Supabase
   ```sql
   SELECT 
     flag_name, 
     COUNT(*) as total, 
     COUNT(CASE WHEN error_code IS NOT NULL THEN 1 END) as errors,
     ROUND(100.0 * COUNT(CASE WHEN error_code IS NOT NULL THEN 1 END) / COUNT(*), 2) as error_pct
   FROM patrol_events  -- or dispatch_events, enforcement_events
   WHERE created_at > NOW() - INTERVAL '1 hour'
   GROUP BY flag_name
   ```

2. Check logs for pattern:
   - Is error specific to one flag or affecting all Phase B flags?
   - Are errors concentrated in one org/user group or widespread?
   - What is the error code? (connection timeout, 500 error, validation, etc.)

3. Notify:
   - Team Lead (approve/reject rollback decision)
   - On-call Engineer (provide context for investigation)

4. Prepare rollback (do not execute without approval):
   ```bash
   bash scripts/rollback-feature-flag.sh FF_PHASE_B_[FLAG_NAME]
   ```

### ⚠️ Warning Latency (75–150% of threshold)

**Monitoring Actions:**
1. Is latency spike temporary or sustained?
   - Run query for last 5 minutes: `NOW() - INTERVAL '5 minutes'`
   - Run query for last 15 minutes: `NOW() - INTERVAL '15 minutes'`
   - Compare trend

2. Check for infrastructure issues:
   - VPS CPU/memory utilization (run `top` if on VPS)
   - Database slow-query log (check Supabase dashboard)
   - Network latency to services (check Bob/PTT health)

3. If temporary spike: No action needed (log and monitor)
4. If sustained: Escalate to team lead for investigation

---

## Success Criteria for Phase B Gate Verification (May 19–20)

After completing both days of monitoring, verify:

- [ ] **No Critical Alerts:** Zero 🚨 critical incidents during 48h window
- [ ] **Error Rate Sustained Below Threshold:** All flags avg error < configured threshold
- [ ] **Latency Sustained Below Threshold:** All flags avg p95 latency < configured threshold
- [ ] **User/Org Adoption Consistent:** No sudden spikes or drops in affected counts
- [ ] **Observations Documented:** Complete daily logs in `data/daily-canary-checks/`

If all criteria met → **Phase B Gate Verification can proceed** (May 19–20)

---

## Rollback Decision Matrix

| Scenario | Error Rate | Latency | Action |
|----------|-----------|---------|--------|
| Both healthy | ✅ | ✅ | Continue monitoring, promote on May 19 if sustained |
| Error rate warning | ⚠️ | ✅ | Escalate; monitor closely; rollback if critical |
| Latency warning | ✅ | ⚠️ | Investigate root cause; rollback if critical |
| Both critical | 🚨 | 🚨 | **EMERGENCY ROLLBACK REQUIRED** |

---

## Folder Structure for Monitoring Data

```
data/daily-canary-checks/
├── OBSERVATIONS.md                    # Daily summary entries
├── canary-check-2026-05-16-morning.txt
├── canary-check-2026-05-16-afternoon.json  # From --save-report
├── canary-check-2026-05-17-morning.txt
└── canary-check-2026-05-17-afternoon.json
```

---

## Environment Variables for Monitoring

Set these before running monitoring scripts:

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export ALERT_SLACK_WEBHOOK="https://hooks.slack.com/services/..." # optional
```

Or load from `.env.local`:
```bash
source .env.local
```

---

## Contact & Escalation

- **Team Lead:** @DonSquires
- **Escalation for Critical Alerts:** Notify immediately; do not wait for next scheduled check
- **Documentation:** Update `docs/PHASE_B_GATE_VERIFICATION_EVIDENCE.md` with results

---

## Related Documentation

- [Phase B Acceleration Status](docs/PHASE_B_ACCELERATION_STATUS_2026-05-15.md)
- [Feature Flags Overview](docs/FEATURE_FLAGS_GUIDE.md)
- [Canary Rollout Procedures](docs/CANARY_ROLLOUT_PROCEDURES.md)

---

**Monitoring Begins:** May 16, 2026 @ 09:00 NZ  
**Monitoring Ends:** May 17, 2026 @ 17:00 NZ  
**Gate Verification:** May 19–20, 2026
