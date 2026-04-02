# Database Migration Deployment Command Reference
**Last Updated:** 2026-04-02  
**Target:** Production Supabase Database  
**Total Migrations:** 12 (20260504–20260515)  
**Deployment Strategy:** 4-phase staged rollout with validation gates  

---

## Quick-Start Deployment

### Prerequisites
```bash
# 1. Set environment variables
export DATABASE_URL="postgresql://user:password@host:port/database"
# OR
export SUPABASE_DB_HOST=your-db-host
export SUPABASE_DB_PORT=5432
export SUPABASE_DB_USER=postgres
export SUPABASE_DB_PASSWORD=your-password
export SUPABASE_DB_NAME=postgres

# 2. Install Supabase CLI (official binary)
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/supabase-cli"
curl -L -o /tmp/supabase_linux_amd64.tar.gz \
	https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz
tar -xzf /tmp/supabase_linux_amd64.tar.gz -C "$HOME/.local/share/supabase-cli"
install -m 755 "$HOME/.local/share/supabase-cli/supabase" "$HOME/.local/bin/supabase"
export PATH="$HOME/.local/bin:$PATH"

# 3. Verify connectivity
psql $DATABASE_URL -c "SELECT version();"
supabase projects list
```

### Full Deployment Flow (All 4 Phases)
```bash
# Pre-flight validation
bash scripts/validate-migrations.sh

# One-time legacy migration history normalization (for 202603xx short versions)
supabase migration repair --linked -p "$DB_PASSWORD" --status reverted \
	20260313 20260315 20260317 20260318 20260319 20260323 20260326 20260329 20260330

# Phase 1: Foundation (15-20 min)
bash scripts/deploy-phase1.sh

# Wait 5-10 minutes for phase stability

# Phase 2: Features (20-30 min)
bash scripts/deploy-phase2.sh

# Wait 10 minutes

# Phase 3: Operational (25-35 min) — CRITICAL PHASE
bash scripts/deploy-phase3.sh

# Wait 15 minutes — MONITOR FOR AUTH ISSUES

# Phase 4: Reporting (10-15 min)
bash scripts/deploy-phase4.sh

# Post-deployment validation (1-2 hours)
bash scripts/post-deployment-smoke-test.sh
```

**Total Time:** ~2.5–3 hours (including monitoring between phases)

---

## Phase-by-Phase Execution

### Phase 1: Foundation Infrastructure
**Migrations:** 20260504, 20260514, 20260515  
**Duration:** 15–20 minutes  
**Risk:** LOW  

```bash
bash scripts/deploy-phase1.sh
```

**What it does:**
- Creates modular platform infrastructure tables
- Deploys org-specific SMTP/SMS configuration
- Hardens RLS policies (replaces `USING (true)` with org-scoped)
- Creates production backup automatically

**Health Check:** Monitor RLS policy update; verify auth not broken

---

### Phase 2: Feature Schema Expansions
**Migrations:** 20260505, 20260506, 20260507, 20260508  
**Duration:** 20–30 minutes  
**Risk:** MEDIUM  

```bash
bash scripts/deploy-phase2.sh
```

**What it does:**
- CRM hub comprehensive schema (leads, workflows, tracking)
- Platform enhancements (feature flags, modules, extensions)
- Patrol routes & geospatial features
- Officer/admin portal enhancements

**Health Check:** Reindexing; verify patrol query performance <200ms

---

### Phase 3: Operational & Governance Features
**Migrations:** 20260509, 20260510, 20260511, 20260512  
**Duration:** 25–35 minutes  
**Risk:** HIGH (Critical Phase)  

```bash
bash scripts/deploy-phase3.sh
```

**What it does:**
- Access Control Lists (ACL) & identity verification system
- ACL industry-standard enhancements
- On-call rostering, callout shifts, travel allowances
- Allowances, assets, key management, site information

**Health Check:** Test auth after ACL deployment; monitor for org_id context errors

⚠️ **CRITICAL:** This phase affects all authentication. Monitor logs closely.

---

### Phase 4: Reporting & Finalization
**Migration:** 20260513  
**Duration:** 10–15 minutes  
**Risk:** LOW  

```bash
bash scripts/deploy-phase4.sh
```

**What it does:**
- Comprehensive reporting system (tables, views, aggregation functions)
- Report templates, schedules, exports
- Compliance, patrol, breach, and officer activity reports

**Health Check:** Reporting endpoints functional; sample report generation

---

## Post-Deployment Validation

### Automated Smoke Test (1–2 hours post-Phase 4)
```bash
bash scripts/post-deployment-smoke-test.sh
```

**Tests:**
- ✓ All required migrations present in `supabase_migrations.schema_migrations`
- ✓ Core tables intact (organizations, users, patrols, observations, vehicles, zones)
- ✓ RLS policies applied and active
- ✓ ACL system operational
- ✓ Reporting tables created
- ✓ Query performance within baseline

---

## Emergency Procedures

### Emergency Rollback (All 12 Migrations)
```bash
bash scripts/rollback-emergency.sh
```

**When to use:**
- Deployment failure during any phase
- Critical auth or data integrity issue detected
- Need to abort and restore to pre-migration state

**What it does:**
- Terminates active database sessions
- Restores from pre-migration backup
- Verifies rollback successful
- Creates rollback audit record

**Time:** 5–15 minutes (depends on backup size)

---

### Validate Migration SQL Before Deployment
```bash
bash scripts/validate-migrations.sh
supabase db push --linked --include-all --dry-run -p "$DB_PASSWORD"
```

**Output:**
- Syntax validation
- Pattern checks (no dangerous DELETE/DROP without safeguards)
- DDL statement count per migration
- RLS policy usage summary

---

## Troubleshooting

### Issue: Phase Deployment Fails
**1. Check logs:**
```bash
tail -50 /path/to/supabase-deploy.log
```

**2. Verify database connectivity:**
```bash
psql $DATABASE_URL -c "SELECT version();"
```

**3. Check active locks:**
```bash
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE wait_event_type IS NOT NULL;"
```

**4. If needed, abort and rollback:**
```bash
bash scripts/rollback-emergency.sh
```

---

### Issue: Auth Failures After Phase 3
**Phase 3 introduces ACL system. If auth breaks:**

**Quick Fix:**
1. Check edge functions have access to new ACL tables
2. Verify org_id is being forwarded in JWT claims
3. Check RLS policies aren't blocking necessary data

**Rollback:**
```bash
bash scripts/rollback-emergency.sh
```

---

### Issue: Query Performance Degradation
**Check slow queries:**
```bash
psql $DATABASE_URL -c "SELECT query, calls, mean_exec_time FROM pg_stat_statements 
ORDER BY mean_exec_time DESC LIMIT 10;"
```

**Reindex if needed:**
```bash
psql $DATABASE_URL -c "REINDEX DATABASE $(echo $DATABASE_URL | sed -n 's/.*\///p');"
```

---

## Monitoring During Deployment

### Real-Time Monitoring (Terminal 1)
```bash
watch -n 5 'psql $DATABASE_URL -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"'
```

### Error Log Monitoring (Terminal 2)
```bash
# If using Supabase, tail the edge function logs:
supabase functions list --linked | grep -i error
```

### Query Performance Monitoring (Terminal 3)
```bash
watch -n 10 'psql $DATABASE_URL -c "SELECT datname, usename, query FROM pg_stat_activity WHERE state = '\''active'\'' AND query NOT LIKE '\''%pg_stat%'\'';"'
```

---

## Post-Deployment Checklist

After Phase 4 and smoke tests pass:

```
IMMEDIATE (1 hour):
☐ Monitor error logs for any auth anomalies
☐ Test all portal logins (admin, master, officer, admin_officer)
☐ Verify core workflows (patrol, observations, compliance)
☐ Check edge function logs for compatibility issues

SHORT-TERM (4-8 hours):
☐ Generate sample reports from each category
☐ Test role-based access control (RLS enforcement)
☐ Verify API endpoints return expected schema
☐ Check backup integrity

LONG-TERM (24 hours):
☐ Performance baseline comparison (indexes, query times)
☐ Data consistency audit
☐ Tag successful backup: git tag production-post-migration-20260504-20260515
☐ Team briefing and documentation update
☐ Notify stakeholders of successful deployment
```

---

## Rollback Procedures (Selective)

For granular rollback of specific phases, see:
**[docs/DB_MIGRATION_ROLLBACK_MATRIX.md](../docs/DB_MIGRATION_ROLLBACK_MATRIX.md)**

Provides per-migration reversal SQL in proper reverse-order sequence.

---

## Contact & Escalation

| Role | Contact | Trigger |
|------|---------|---------|
| Database Admin | #db-incidents | Connection pool exhausted, slow queries |
| Platform Lead | #platform-incidents | Auth system failure, data corruption |
| Supabase Support | support@supabase.io | Infrastructure/networking issues |
| Product Owner | Product Slack | Deployment blocked, business impact |

---

## Key Documentation

1. **Execution Plan:** [docs/DB_MIGRATION_EXECUTION_PLAN.md](../docs/DB_MIGRATION_EXECUTION_PLAN.md)
2. **Rollback Matrix:** [docs/DB_MIGRATION_ROLLBACK_MATRIX.md](../docs/DB_MIGRATION_ROLLBACK_MATRIX.md)
3. **Query Validation:** [scripts/validate-migrations.sh](validate-migrations.sh)
4. **Deployment Scripts:** [scripts/deploy-phase*.sh](deploy-phase1.sh)

---

## Success Criteria (Final)

✅ All 12 migrations executed without errors  
✅ No RLS auth failures for 2+ hours post-deploy  
✅ Patrol/route queries: <200ms (p95)  
✅ Reporting queries: <5s (p95)  
✅ All portals load and authenticate correctly  
✅ Edge functions compatible with new schema  
✅ Smoke test: 100% pass rate  

---

**Deployment Status:** Reserved for deployment coordinator  
**Last Deployed:** [To be filled in]  
**Team:** DonSquires, OnSpace AI  
