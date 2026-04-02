# Database Migration Rollback Matrix
**Document Version:** 1.0  
**Date Generated:** 2026-04-02  
**Scope:** Migrations 20260504–20260515  

---

## Quick Rollback Methods

### Option A: Full Restore from Backup (Zero Risk)
```bash
# Recommended for emergency scenarios
pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME \
  < backup-pre-migration-20260504-20260515.dump

# Verify rollback
psql $DATABASE_URL -c "SELECT version FROM _realtime_migrations WHERE name LIKE '202605%';"
# Expected: Should return NO rows
```

### Option B: Selective Migration Rollback (Medium Risk)
Use reversal scripts in this matrix for granular rollback. Proceed in **reverse deployment order**.

---

## Reversal Scripts by Migration (Reverse Order)

### 12. 20260515_fix_rls_org_scoped_policies (Reverse First)

**Reversal Strategy:** Restore original RLS policies with `USING (true)`

```sql
-- Rollback 20260515: Revert org-scoped RLS to original
-- WARNING: Exposes data; transition back to previous auth model required

-- Step 1: Save current RLS policies for audit
CREATE TABLE audit_rls_policies_pre_rollback AS
SELECT * FROM pg_policies WHERE tablename IN (
  SELECT tablename FROM information_schema.tables 
  WHERE table_schema = 'public'
)
ORDER BY tablename, policyname;

-- Step 2: Drop org-scoped policies (or recreate with USING (true) for legacy)
-- Example for 'observations' table:
DROP POLICY IF EXISTS "obs_org_scoped_select" ON public.observations;
DROP POLICY IF EXISTS "obs_org_scoped_insert" ON public.observations;
DROP POLICY IF EXISTS "obs_org_scoped_update" ON public.observations;
DROP POLICY IF EXISTS "obs_org_scoped_delete" ON public.observations;

-- Recreate with USING (true) if needed for immediate service restoration
CREATE POLICY "obs_legacy_select" ON public.observations 
  FOR SELECT USING (true);
CREATE POLICY "obs_legacy_insert" ON public.observations 
  FOR INSERT WITH CHECK (true);

-- Repeat for other tables: patrols, vehicles, zones, users, etc.
-- See full list in forward migration 20260515000001_fix_rls_org_scoped_policies.sql

-- Step 3: Verify policies reverted
SELECT tablename, policyname, qual FROM pg_policies 
WHERE tablename IN ('observations', 'patrols', 'vehicles')
ORDER BY tablename;
```

**Safety Checklist:**
- [ ] Audit `audit_rls_policies_pre_rollback` table to confirm old policies captured  
- [ ] Test portal login after policy revert  
- [ ] Monitor for auth exceptions in logs  

**Estimated Duration:** 2–3 minutes

---

### 11. 20260514_org_smtp_sms_and_critical_fixes (Reverse Second)

**Reversal Strategy:** Remove SMTP/SMS config tables; revert critical vendor fixes

```sql
-- Rollback 20260514: Org SMTP/SMS Configuration
-- NOTE: Any emails sent via new config will be lost if tables dropped

-- Step 1: Backup org-specific SMTP/SMS records
CREATE TABLE audit_smtp_sms_rollback AS
SELECT * FROM org_smtp_configs;
INSERT INTO audit_smtp_sms_rollback 
SELECT * FROM org_sms_configs;

-- Step 2: Drop new config tables
DROP TABLE IF EXISTS org_sms_configs CASCADE;
DROP TABLE IF EXISTS org_smtp_configs CASCADE;
DROP TABLE IF EXISTS email_log_v2 CASCADE;

-- Step 3: Revert critical fixes (if safe to undo)
-- Example: If migration added columns, drop them:
-- ALTER TABLE organizations DROP COLUMN IF EXISTS smtp_enabled_at;
-- ALTER TABLE organizations DROP COLUMN IF EXISTS sms_enabled_at;

-- Step 4: Restore any prior state (reference forward migration for detail)
-- (See specific fix details in 20260514000001_org_smtp_sms_and_critical_fixes.sql)
```

**Safety Checklist:**
- [ ] Confirm `audit_smtp_sms_rollback` contains complete config records  
- [ ] Email/SMS outbound service will fall back to default  
- [ ] Test email sending after rollback  

**Estimated Duration:** 1–2 minutes

---

### 10. 20260513_comprehensive_reporting_system (Reverse Third)

**Reversal Strategy:** Drop reporting tables, views, and aggregation functions

```sql
-- Rollback 20260513: Comprehensive Reporting System
-- WARNING: Any in-progress report generation will fail

-- Step 1: Disable reporting endpoints (edge functions)
-- (Handled separately; see edge-function rollback below)

-- Step 2: Drop reporting materialized views
DROP MATERIALIZED VIEW IF EXISTS public.report_compliance_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.report_patrol_performance CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.report_breach_trends CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.report_officer_activities CASCADE;

-- Step 3: Drop reporting aggregate functions
DROP FUNCTION IF EXISTS calculate_compliance_score(uuid, DATE, DATE) CASCADE;
DROP FUNCTION IF EXISTS generate_patrol_report(uuid, DATERANGE) CASCADE;
DROP FUNCTION IF EXISTS get_hotspots_by_zone(uuid) CASCADE;

-- Step 4: Drop reporting tables
DROP TABLE IF EXISTS report_templates CASCADE;
DROP TABLE IF EXISTS report_schedules CASCADE;
DROP TABLE IF EXISTS report_exports CASCADE;

-- Step 5: Verify
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'report_%';
-- Expected: 0 (all reporting tables removed)
```

**Safety Checklist:**
- [ ] No scheduled reports running  
- [ ] Export jobs canceled  
- [ ] Admin dashboard fallback to prior reporting setup  

**Estimated Duration:** 2–3 minutes

---

### 9. 20260512_allowances_assets_keys_site_info (Reverse Fourth)

**Reversal Strategy:** Drop allowance/asset/key management tables

```sql
-- Rollback 20260512: Allowances, Assets, Keys, Site Info
-- CRITICAL: Affects payroll and asset tracking

-- Step 1: Backup operational records
CREATE TABLE audit_allowances_pre_rollback AS
SELECT * FROM public.allowances;
INSERT INTO audit_allowances_pre_rollback 
SELECT * FROM public.asset_inventory;
INSERT INTO audit_allowances_pre_rollback 
SELECT * FROM public.site_access_keys;

-- Step 2: Cascade drop dependent tables
DROP TABLE IF EXISTS allowance_types CASCADE;  -- Deletes allowance_schedules -> allowances
DROP TABLE IF EXISTS asset_inventory CASCADE;
DROP TABLE IF EXISTS asset_maintenance_log CASCADE;
DROP TABLE IF EXISTS site_access_keys CASCADE;
DROP TABLE IF EXISTS key_audit_log CASCADE;
DROP TABLE IF EXISTS site_info CASCADE;

-- Step 3: Remove officer portal enhancements tied to this
ALTER TABLE public.officers DROP COLUMN IF EXISTS allowance_enabled;
ALTER TABLE public.officers DROP COLUMN IF EXISTS asset_responsible_for;

-- Step 4: Verify
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name 
  IN ('allowance_types', 'allowances', 'asset_inventory', 'site_access_keys');
-- Expected: 0
```

**Safety Checklist:**
- [ ] `audit_allowances_pre_rollback` captured all allowance history  
- [ ] Payroll system notified (external integration)  
- [ ] Asset tracking will revert to prior manual system (if applicable)  

**Estimated Duration:** 3–5 minutes

---

### 8. 20260511_oncall_rostering_callout_shifts (Reverse Fifth)

**Reversal Strategy:** Drop rostering and shift management tables

```sql
-- Rollback 20260511: On-Call Rostering, Callout Shifts
-- CRITICAL: Affects shift scheduling and on-call alerting

-- Step 1: Backup shift records
CREATE TABLE audit_rosters_pre_rollback AS
SELECT * FROM public.rosters;
INSERT INTO audit_rosters_pre_rollback 
SELECT * FROM public.shifts;
INSERT INTO audit_rosters_pre_rollback 
SELECT * FROM public.callout_alerts;

-- Step 2: Cascade drop
DROP TABLE IF EXISTS roster_patterns CASCADE;       -- Deletes rosters
DROP TABLE IF EXISTS shift_templates CASCADE;       -- Deletes shifts
DROP TABLE IF EXISTS callout_alerts CASCADE;
DROP TABLE IF EXISTS shift_swaps CASCADE;
DROP TABLE IF EXISTS on_call_schedule CASCADE;

-- Step 3: Remove from officers table
ALTER TABLE public.officers DROP COLUMN IF EXISTS on_call_frequency;
ALTER TABLE public.officers DROP COLUMN IF EXISTS rostered_start_date;

-- Step 4: Verify
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name 
  IN ('rosters', 'shifts', 'shift_templates', 'callout_alerts');
-- Expected: 0
```

**Safety Checklist:**
- [ ] Shift schedules exported/archived (before drop)  
- [ ] On-call alerting system disabled  
- [ ] Back-fill manual schedule process (if needed)  

**Estimated Duration:** 2–3 minutes

---

### 7. 20260510_access_control_industry_enhancements (Reverse Sixth)

**Reversal Strategy:** Drop extended ACL tables and industry-standard patterns

```sql
-- Rollback 20260510: Access Control Industry Enhancements
-- Depends on: 20260509 (core ACL) — do NOT rollback 20260509 first

-- Step 1: Backup industry control records
CREATE TABLE audit_acl_industry_pre_rollback AS
SELECT * FROM public.role_hierarchies;
INSERT INTO audit_acl_industry_pre_rollback 
SELECT * FROM public.delegation_chains;

-- Step 2: Drop industry-standard tables
DROP TABLE IF EXISTS role_hierarchies CASCADE;     -- Deletes hierarchy rules
DROP TABLE IF EXISTS delegation_chains CASCADE;    -- Deletes delegations
DROP TABLE IF EXISTS audit_access_decisions CASCADE;

-- Step 3: Revert policy changes
ALTER TABLE public.access_controls DROP COLUMN IF EXISTS delegation_token;
ALTER TABLE public.access_controls DROP COLUMN IF EXISTS hierarchy_level;

-- Step 4: Verify
SELECT COUNT(*) FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'access_controls' 
  AND column_name IN ('delegation_token', 'hierarchy_level');
-- Expected: 0
```

**Safety Checklist:**
- [ ] Audit hierarchy rules saved  
- [ ] Access control policies simplified to pre-20260510 state  
- [ ] Verify no active delegations in progress  

**Estimated Duration:** 1–2 minutes

---

### 6. 20260509_access_control_identity_verification (Reverse Seventh)

**Reversal Strategy:** Drop ACL and identity verification tables

```sql
-- Rollback 20260509: Access Control & Identity Verification System
-- CRITICAL: Affects all authentication and authorization

-- Step 1: Backup access control records
CREATE TABLE audit_acl_pre_rollback AS
SELECT * FROM public.access_controls;
INSERT INTO audit_acl_pre_rollback 
SELECT * FROM public.identity_proofs;

-- Step 2: Disable identity verification (set flag)
UPDATE public.organizations 
SET identity_verification_enabled = false 
WHERE identity_verification_enabled = true;

-- Step 3: Cascade drop (ORDER MATTERS)
DROP TABLE IF EXISTS identity_proofs CASCADE;
DROP TABLE IF EXISTS credential_documents CASCADE;
DROP TABLE IF EXISTS verification_audit_log CASCADE;
DROP TABLE IF EXISTS access_controls CASCADE;

-- Step 4: Revert organizations table
ALTER TABLE public.organizations 
DROP COLUMN IF EXISTS identity_verification_enabled;
ALTER TABLE public.organizations 
DROP COLUMN IF EXISTS identity_verification_required_at;

-- Step 5: Verify
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name 
  IN ('access_controls', 'identity_proofs', 'credential_documents');
-- Expected: 0
```

**Safety Checklist:**
- [ ] `audit_acl_pre_rollback` captured all ACL state  
- [ ] All active sessions invalidated (force re-login)  
- [ ] Edge functions redeploy without ACL/identity logic  
- [ ] Test login with simpler auth model  

**Estimated Duration:** 3–5 minutes

---

### 5. 20260508_officer_admin_portal_enhancements (Reverse Eighth)

**Reversal Strategy:** Drop portal enhancement tables

```sql
-- Rollback 20260508: Officer & Admin Portal Enhancements

-- Step 1: Backup enhancement records
CREATE TABLE audit_portal_enhancements_pre_rollback AS
SELECT * FROM public.portal_preferences;
INSERT INTO audit_portal_enhancements_pre_rollback 
SELECT * FROM public.admin_dashboards;

-- Step 2: Cascade drop
DROP TABLE IF EXISTS portal_preferences CASCADE;
DROP TABLE IF EXISTS admin_dashboards CASCADE;
DROP TABLE IF EXISTS portal_widgets CASCADE;

-- Step 3: Revert officers/users table columns
ALTER TABLE public.officers DROP COLUMN IF EXISTS portal_theme;
ALTER TABLE public.officers DROP COLUMN IF EXISTS dashboard_layout;
ALTER TABLE public.users DROP COLUMN IF EXISTS admin_dashboard_id;

-- Step 4: Verify
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name 
  IN ('portal_preferences', 'admin_dashboards', 'portal_widgets');
-- Expected: 0
```

**Safety Checklist:**
- [ ] Portal preferences backed up  
- [ ] Admin dashboard customizations reset to defaults  
- [ ] Test portal loads with default layout  

**Estimated Duration:** 1–2 minutes

---

### 4. 20260507_patrol_routes_advanced_features (Reverse Ninth)

**Reversal Strategy:** Drop patrol route and geospatial tables

```sql
-- Rollback 20260507: Patrol Routes & Advanced Features

-- Step 1: Backup route records
CREATE TABLE audit_patrol_routes_pre_rollback AS
SELECT * FROM public.patrol_routes;
INSERT INTO audit_patrol_routes_pre_rollback 
SELECT * FROM public.route_checkpoints;

-- Step 2: Cascade drop
DROP TABLE IF EXISTS patrol_routes CASCADE;         -- Deletes route_checkpoints, route_analytics
DROP TABLE IF EXISTS route_checkpoints CASCADE;
DROP TABLE IF EXISTS route_analytics CASCADE;
DROP TABLE IF EXISTS geospatial_segments CASCADE;

-- Step 3: Revert patrols table
ALTER TABLE public.patrols DROP COLUMN IF EXISTS route_id;
ALTER TABLE public.patrols DROP COLUMN IF EXISTS route_deviation_meters;
ALTER TABLE public.patrols DROP COLUMN IF EXISTS geospatial_analysis_json;

-- Step 4: Verify
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name 
  IN ('patrol_routes', 'route_checkpoints', 'geospatial_segments');
-- Expected: 0
```

**Safety Checklist:**
- [ ] Route audit history captured  
- [ ] Patrol tracking reverts to GPS-only (no route enforcement)  
- [ ] Officers' patrol UI simplified  

**Estimated Duration:** 2–3 minutes

---

### 3. 20260506_platform_enhancements_complete (Reverse Tenth)

**Reversal Strategy:** Drop extended feature tables

```sql
-- Rollback 20260506: Platform Enhancements — Complete Implementation
-- LARGEST MIGRATION: 58 KB; highest table count

-- Step 1: Backup enhancement records
CREATE TABLE audit_platform_enhancements_pre_rollback AS
SELECT * FROM public.feature_flags;
INSERT INTO audit_platform_enhancements_pre_rollback 
SELECT * FROM public.platform_modules;

-- Step 2: Disable feature flags (safer than dropping)
UPDATE public.feature_flags 
SET enabled = false 
WHERE enabled = true;

-- Step 3: Cascade drop (ORDER CRITICAL — reverse of forward)
DROP TABLE IF EXISTS feature_flags CASCADE;
DROP TABLE IF EXISTS platform_modules CASCADE;
DROP TABLE IF EXISTS module_dependencies CASCADE;
DROP TABLE IF EXISTS ui_extensions CASCADE;

-- Step 4: Revert base tables
ALTER TABLE public.organizations 
DROP COLUMN IF EXISTS features_enabled_json;
ALTER TABLE public.organizations 
DROP COLUMN IF EXISTS module_config_json;

-- Step 5: Verify
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name 
  IN ('feature_flags', 'platform_modules', 'ui_extensions');
-- Expected: 0
```

**Safety Checklist:**
- [ ] Extensive feature state captured  
- [ ] Custom UI extensions disabled  
- [ ] Portal reverts to core feature set  

**Estimated Duration:** 3–5 minutes

---

### 2. 20260505_crm_hub_comprehensive (Reverse Eleventh)

**Reversal Strategy:** Drop CRM and workflow tables

```sql
-- Rollback 20260505: CRM Hub Comprehensive Schema

-- Step 1: Backup CRM records
CREATE TABLE audit_crm_pre_rollback AS
SELECT * FROM public.crm_leads;
INSERT INTO audit_crm_pre_rollback 
SELECT * FROM public.crm_workflows;
INSERT INTO audit_crm_pre_rollback 
SELECT * FROM public.crm_tracking;

-- Step 2: Cascade drop
DROP TABLE IF EXISTS crm_workflows CASCADE;        -- Deletes workflow_steps, workflow_assignments
DROP TABLE IF EXISTS crm_leads CASCADE;            -- Deletes lead_interactions
DROP TABLE IF EXISTS crm_tracking CASCADE;
DROP TABLE IF EXISTS crm_touchpoints CASCADE;

-- Step 3: Verify
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'crm_%';
-- Expected: 0
```

**Safety Checklist:**
- [ ] CRM data fully archived in `audit_crm_pre_rollback`  
- [ ] External CRM integration stopped  
- [ ] Platform reverts to core duty/compliance focus  

**Estimated Duration:** 2–3 minutes

---

### 1. 20260504_modular_platform_infrastructure (Reverse Last)

**Reversal Strategy:** Drop foundation modular platform tables

```sql
-- Rollback 20260504: Modular Platform Infrastructure
-- FINAL ROLLBACK: Reverts foundational infrastructure

-- Step 1: Backup modular config
CREATE TABLE audit_modular_platform_pre_rollback AS
SELECT * FROM public.platform_config;
INSERT INTO audit_modular_platform_pre_rollback 
SELECT * FROM public.module_registry;

-- Step 2: Cascade drop
DROP TABLE IF EXISTS platform_config CASCADE;
DROP TABLE IF EXISTS module_registry CASCADE;
DROP TABLE IF EXISTS module_instances CASCADE;
DROP TABLE IF EXISTS module_permissions CASCADE;

-- Step 3: Revert organizations
ALTER TABLE public.organizations 
DROP COLUMN IF EXISTS platform_config_id;

-- Step 4: Verify database clean
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name 
  IN ('platform_config', 'module_registry', 'module_instances');
-- Expected: 0

-- Final: Verify migrations table
SELECT name FROM _realtime_migrations 
WHERE name LIKE '202605%' 
ORDER BY name DESC;
-- Expected: EMPTY (all migration records cleaned up by Supabase)
```

**Safety Checklist:**
- [ ] All modular platform config captured  
- [ ] Database returns to pre-20260504 state  
- [ ] All 12 migrations rolled back successfully  

**Estimated Duration:** 1–2 minutes

---

## Rollback Dependencies & Ordering

**DO NOT deviate from reverse order above.** Forward migration dependencies:

```
20260504 (Foundation)
  ↓
20260505 (CRM)
  ↓
20260506 (Enhancements)
  ↓
20260507 (Patrol routes)
  ↓
20260508 (Portal)
  ↓
20260509 (ACL/Identity)
  ↓
20260510 (ACL Industry)
  ↓
20260511 (Rostering)
  ↓
20260512 (Allowances/Assets)
  ↓
20260513 (Reporting)
  ↓
20260514 (SMTP/SMS fixes)
  ↓
20260515 (RLS hardening)
```

**Rollback order:** 20260515 → 20260514 → ... → 20260504

---

## Emergency Contacts

- **Database Admin (on-call):** DBA Slack channel  
- **Supabase Incident:** Support@supabase.io  
- **Platform Owner:** Product Slack #platform-incidents  

---

## Validation Queries (Post-Rollback)

```sql
-- Confirm all migrations rolled back
SELECT COUNT(*) FROM _realtime_migrations 
WHERE name LIKE '202605%';
-- Expected: 0

-- Verify core tables still present
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name 
  IN ('organizations', 'users', 'officers', 'patrols', 'observations', 'zones');
-- Expected: >= 6 (core tables survive rollback)

-- Confirm RLS policies reset
SELECT COUNT(DISTINCT tablename) FROM pg_policies 
WHERE tablename IN ('observations', 'patrols', 'vehicles');
-- Expected: Policy count should reflect pre-migration state

-- Test auth
SELECT current_user_id();  -- Edge function test (if available)
```

---

## Post-Rollback Tasks

1. **Communication:** Notify stakeholders rollback complete; ETA for re-deployment
2. **Root Cause:** Investigate why deployment was rolled back; document findings
3. **Testing:** Validate all portals, workflows, and critical paths
4. **Backup:** Tag current DB state `post-rollback-emergency-20260504-20260515`
5. **Re-plan:** Adjust migrations (if needed) and schedule safe re-deployment
