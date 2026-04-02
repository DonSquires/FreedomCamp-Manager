# Database Migration Execution Plan
**Date Generated:** 2026-04-02  
**Branch:** copilot/fix-duplicate-vehicle-observations  
**Total Migrations:** 12 new migrations (20260504–20260515)  
**Estimated Deployment Duration:** 45–90 minutes

---

## Migration Execution Order & Dependency Analysis

### Phase 1: Foundation Infrastructure (Low Risk)
Deploy in sequence. No dependencies on concurrent work.

| Order | Migration | Size | Scope | Risk | Pre-Check |
|-------|-----------|------|-------|------|-----------|
| 1 | 20260504_modular_platform_infrastructure | 22 KB | Standalone/White-label platform tables, RLS | LOW | Verify `organizations` table exists |
| 2 | 20260514_org_smtp_sms_critical_fixes | 13 KB | SMTP/SMS config, critical vendor fixes | MEDIUM | Check for conflicting SMTP policies |
| 3 | 20260515_fix_rls_org_scoped_policies | 7 KB | RLS policy hardening (replace true → org-scoped) | MEDIUM | Snapshot RLS state before; ensure no active sessions |

**Validation Gate 1:** Run health check after Phase 1; verify no RLS auth failures.

---

### Phase 2: Feature Schema Expansions (Medium Risk)
Deploy in sequence. Dependencies: Phase 1 complete.

| Order | Migration | Size | Scope | Risk | Pre-Check |
|-------|-----------|------|-------|------|-----------|
| 4 | 20260505_crm_hub_comprehensive | 39 KB | CRM tables, workflows, tracking | MEDIUM | Verify no active CRM processes |
| 5 | 20260506_platform_enhancements_complete | 58 KB | Extended feature tables, indexes, RLS updates | HIGH | Backup database; review index impact |
| 6 | 20260507_patrol_routes_advanced_features | 30 KB | Patrol/route tables, geospatial optimization | MEDIUM | Verify PostGIS available; check existing patrol data |
| 7 | 20260508_officer_admin_portal_enhancements | 26 KB | Officer portal tables, admin UI support | LOW | Existing officer data compatibility check |

**Validation Gate 2:** Reindex tables; verify query performance on patrol/route/admin tables.

---

### Phase 3: Operational & Governance Features (Medium Risk)
Deploy in sequence. Dependencies: Phase 2 complete.

| Order | Migration | Size | Scope | Risk | Pre-Check |
|-------|-----------|------|-------|------|-----------|
| 8 | 20260509_access_control_identity_verification | 49 KB | ACL, identity tables, crypto/verification | HIGH | Review access policies; ensure secrets manager ready |
| 9 | 20260510_access_control_industry_enhancements | 43 KB | Extended ACL, industry standard patterns | MEDIUM | Confirm no active identity verification sessions |
| 10 | 20260511_oncall_rostering_callout_shifts | 37 KB | Rostering, shifts, shift swaps, allowances | MEDIUM | Validate existing roster compatibility |
| 11 | 20260512_allowances_assets_keys_site_info | 48 KB | Assets, keys, allowance schedules, site tables | MEDIUM | Check for orphaned asset/key records |

**Validation Gate 3:** ACL audit; allowance calculation test on sample records.

---

### Phase 4: Reporting & Finalization (Low Risk)
Deploy in sequence. Dependencies: Phase 3 complete.

| Order | Migration | Size | Scope | Risk | Pre-Check |
|-------|-----------|------|-------|------|-----------|
| 12 | 20260513_comprehensive_reporting_system | 41 KB | Reporting tables, views, aggregation functions | LOW | Test reporting queries on sample data |

**Validation Gate 4 (Final):** Full smoke test: all portal logins, core workflows, reporting queries.

---

## Pre-Deployment Checklist

- [ ] Database backup created (tag: `pre-migration-20260504-20260515`)
- [ ] Supabase staging environment cloned from production
- [ ] Staging migration dry-run successful (all 12 migrations)
- [ ] Performance baseline captured (indexes, query plans)
- [ ] Edge functions deployed and tested against new schema
- [ ] Rollback runbook reviewed and team briefed
- [ ] Maintenance window scheduled; stakeholders notified
- [ ] Monitoring alerts enabled (CPU, query time, connection pool)

---

## Deployment Instructions (CLI)

### Automated Sequential Deployment
```bash
cd /workspaces/FreedomCamp-Manager

# Legacy history normalization (required once for this project lineage)
supabase migration repair --linked -p "$DB_PASSWORD" --status reverted \
	20260313 20260315 20260317 20260318 20260319 20260323 20260326 20260329 20260330

# If dry-run reports old out-of-order files, include them explicitly
supabase db push --linked --include-all --dry-run

# Deploy Phase 1 (Foundation)
supabase db push --dry-run  # Verify plan
supabase db push --linked --include-all   # Execute (production)

# Wait for health check after Phase 1
supabase functions deploy

# Deploy Phase 2–4
# (Repeat supabase db push --linked --include-all for each phase if prompted)
```

### Manual CLI Validation (Post-Deploy)
```bash
# Verify migration history table presence
psql $DATABASE_URL -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20;"

# Verify RLS policies applied
psql $DATABASE_URL -c "SELECT tablename, policyname FROM pg_policies ORDER BY tablename, policyname;"

# Reindex (optional, improves performance)
psql $DATABASE_URL -c "REINDEX DATABASE $(echo $DATABASE_URL | awk -F/ '{print $NF}');"
```

---

## Rollback Strategy (Detailed in separate matrix)

Each migration has a reverse script available in `docs/DB_MIGRATION_ROLLBACK_MATRIX.md`.

**Quick Rollback (all 12):**
```bash
# Restore from backup
pg_restore -h $HOST -p $PORT -U $USER -d $DATABASE < backup-pre-migration.dump
```

**Selective Rollback (e.g., Phase 2 only):**
See detailed rollback matrix for per-migration reversal SQL and dependencies.

---

## Success Criteria

✓ All 12 migrations execute without errors  
✓ No RLS auth failures in monitoring for 1 hour post-deploy  
✓ Patrol/route queries remain <200ms (p95)  
✓ Reporting queries remain <5s (p95)  
✓ All portal logins succeed  
✓ Edge functions process successfully with new schema  

---

## Emergency Contacts & Escalation

- **DB Incident:** Contact DBA on-call  
- **RLS/Auth Issue:** Check edge functions logs; validate org_id forwarding  
- **Performance Degradation:** Analyze slow query logs; reindex or rollback Phase 2  

---

## Post-Deployment Tasks

1. **Monitor** (24 hours): Error logs, query performance, user reports
2. **Backup** (post-success): Tag production backup `post-migration-20260504-20260515`
3. **Documentation**: Update data dictionary for new tables/fields
4. **Team Briefing**: Share final success stats and lessons learned
