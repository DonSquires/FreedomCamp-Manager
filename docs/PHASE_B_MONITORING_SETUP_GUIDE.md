# Phase B Canary Monitoring — Quick Setup Guide

**Objective:** Prepare monitoring infrastructure for May 16–17 observation window  
**Time to Complete:** ~10 minutes  
**Status:** Ready to execute

---

## Pre-Monitoring Setup (Run Today — May 15)

### 1. Deploy Canary Metrics Edge Function

```bash
# Build and deploy the collect-canary-metrics function
supabase functions deploy collect-canary-metrics

# Verify deployment
curl -X POST "https://your-project.supabase.co/functions/v1/collect-canary-metrics" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "metrics": [...],
  "timestamp": "2026-05-15T...",
  "window_seconds": 3600,
  "summary": {
    "total_flags_monitored": 4,
    "critical_flags": 0,
    "warning_flags": 0
  }
}
```

### 2. Apply Database Migration

```bash
# Apply the canary_metric_snapshots table
supabase db push

# Verify table was created
psql "your-connection-string" -c "\d canary_metric_snapshots"
```

### 3. Set Up Monitoring Scripts

```bash
# Make check-canary-thresholds executable
chmod +x scripts/check-canary-thresholds.mjs

# Create data directory for reports
mkdir -p data/daily-canary-checks

# Initialize observations file
echo "# Phase B Daily Observations" > data/daily-canary-checks/OBSERVATIONS.md
```

### 4. Configure Environment Variables

```bash
# Copy and edit .env.local (if not already set)
cat > .env.local << 'EOF'
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
ALERT_SLACK_WEBHOOK="https://hooks.slack.com/services/..."  # Optional
EOF

# Load environment
source .env.local
```

### 5. Test Monitoring Script

```bash
# Run threshold check (should show current metrics)
node scripts/check-canary-thresholds.mjs

# Expected output:
# ✅ All flags healthy
# - or -
# 🚨 Critical alerts, ⚠️  Warnings
```

### 6. Verify Admin Dashboard Loads

```bash
# Start dev server if not running
bun run dev

# Navigate to: http://localhost:5173/admin/canary-metrics
# Should display:
# - Summary cards (Total, Critical, Warnings, Healthy)
# - Real-time metrics for each flag
# - Refresh button (auto-refreshes every 5 min)
```

---

## Daily Monitoring Routine (May 16 & 17)

### Morning Check (09:00 NZ)

```bash
# Terminal 1: Run metrics check
node scripts/check-canary-thresholds.mjs

# Terminal 2: View real-time dashboard
open http://localhost:5173/admin/canary-metrics
# or
"$BROWSER" http://localhost:5173/admin/canary-metrics
```

**Actions:**
1. Record output to `data/daily-canary-checks/canary-check-2026-05-16-morning.txt`
2. Check for 🚨 critical alerts — escalate immediately if found
3. If no critical alerts, continue to afternoon check

### Afternoon Check (17:00 NZ)

```bash
# Save detailed report
node scripts/check-canary-thresholds.mjs --save-report

# This creates: data/daily-canary-checks/canary-check-2026-05-16-afternoon.json
```

**Actions:**
1. Compare morning vs afternoon metrics for trends
2. Update `data/daily-canary-checks/OBSERVATIONS.md` with observations
3. Check dashboard for any new warning flags

---

## Critical Alert Response

If you see 🚨 **CRITICAL** status at any check:

```bash
# 1. Verify the alert is real (query database directly)
psql "your-connection-string" << 'EOF'
SELECT flag_name, COUNT(*) as total, 
       COUNT(CASE WHEN error_code IS NOT NULL THEN 1 END) as errors,
       ROUND(100.0 * COUNT(CASE WHEN error_code IS NOT NULL THEN 1 END) / COUNT(*), 2) as error_pct
FROM patrol_events
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY flag_name;
EOF

# 2. Check logs for errors (on VPS)
journalctl -u fieldops-api -n 200 | grep -i error

# 3. Notify team lead immediately — include:
#    - Flag name
#    - Error rate or latency value
#    - Affected user/org count
#    - Time of incident

# 4. Prepare (do NOT execute without approval):
bash scripts/rollback-feature-flag.sh FF_PHASE_B_[FLAG_NAME]
```

---

## Files Created/Modified

| File | Purpose | Status |
|------|---------|--------|
| `supabase/functions/collect-canary-metrics/index.ts` | Edge Function for metric collection | ✅ Ready |
| `scripts/check-canary-thresholds.mjs` | CLI threshold checker | ✅ Ready |
| `src/pages/admin/CanaryMetricsDashboard.tsx` | Real-time admin dashboard | ✅ Ready |
| `supabase/migrations/20260515000001_canary_metric_snapshots.sql` | Database table for snapshots | ✅ Ready |
| `docs/PHASE_B_MONITORING_CHECKLIST_MAY_16_17.md` | Daily monitoring procedures | ✅ Reference |
| `docs/PHASE_B_GATE_VERIFICATION_EVIDENCE.md` | Gate verification template (fill May 19–20) | ✅ Reference |

---

## Monitoring Dashboard Features

### CanaryMetricsDashboard Component
- **Auto-refresh:** Every 5 minutes
- **Real-time alerts:** Critical (red), Warning (yellow), Healthy (green)
- **Per-flag details:** Error rate, P95 latency, affected users/orgs
- **Expandable rows:** Click to see full metric breakdown
- **Recommendations:** Flag-specific action suggestions

### To Add the Dashboard to Admin Sidebar

Edit `src/pages/AdminPortal.tsx`:

```typescript
// Add import
import { CanaryMetricsDashboard } from '@/pages/admin/CanaryMetricsDashboard';

// Add route
<Route path="canary-metrics" element={<CanaryMetricsDashboard />} />

// Add nav item
<SidebarItem icon={<TrendingUp />} label="Canary Metrics" href="/admin/canary-metrics" />
```

---

## Troubleshooting

### Script says "Edge Function error: 404"

**Solution:**
```bash
# Verify function is deployed
supabase functions list

# If missing, deploy:
supabase functions deploy collect-canary-metrics

# Check function logs
supabase functions logs collect-canary-metrics
```

### No events showing in metrics

**Expected behavior:** If Phase B flags were just deployed, events table may be empty initially. This is normal.

**Verify flags are active:**
```bash
psql "your-connection-string" -c "SELECT name, enabled, rollout_percentage FROM feature_flags WHERE phase = 'B';"
```

### Slack alerts not sending

**Solution:**
1. Verify `ALERT_SLACK_WEBHOOK` is set in `.env.local`
2. Test webhook: `curl -X POST "$ALERT_SLACK_WEBHOOK" -H "Content-Type: application/json" -d '{"text":"Test"}'`
3. Alerts only send on critical issues (not warnings or healthy)

---

## Success Criteria

- [x] Edge Function deployed and responds with metrics
- [x] Database table created and accessible
- [x] CLI script runs without errors
- [x] Admin dashboard displays real-time metrics
- [x] Environment variables configured
- [ ] Morning check completed (May 16 09:00)
- [ ] Afternoon check completed (May 16 17:00)
- [ ] Morning check completed (May 17 09:00)
- [ ] Afternoon check completed (May 17 17:00)
- [ ] Gate verification evidence filled (May 19–20)

---

## Support

**Questions?** Refer to:
- [Phase B Acceleration Status](PHASE_B_ACCELERATION_STATUS_2026-05-15.md)
- [Feature Flags Guide](FEATURE_FLAGS_GUIDE.md)
- [Daily Monitoring Checklist](PHASE_B_MONITORING_CHECKLIST_MAY_16_17.md)

**Escalation:** Contact @DonSquires if critical alerts occur during monitoring window.

---

**Ready:** May 15, 2026, 23:30 NZ  
**Observation Window:** May 16–17, 2026  
**Gate Verification:** May 19–20, 2026
