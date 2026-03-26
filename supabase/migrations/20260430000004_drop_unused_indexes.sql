-- =============================================================================
-- Drop additional unused indexes — identified via Schema Extract #2 (2026-03-26)
--
-- All indexes below show 0 index scans since creation in the live database.
-- Removing unused indexes reduces write amplification on INSERT/UPDATE/DELETE
-- and frees storage.  Each can be recreated if query patterns change.
--
-- Indexes NOT dropped (conservative):
--   idx_observations_processing_status — ALPR pipeline (intermittently used)
--   idx_officer_shifts_approval/org   — FK / admin workflow, low traffic
--   idx_monthly_stays_*               — batch compliance jobs, intermittent
--   idx_welfare_checkins_officer_shift — join support
--   idx_observation_deletions_org      — FK cascade support
--   idx_investigation_job_types_active — low-traffic lookup
-- =============================================================================

-- ── canonical_scv ─────────────────────────────────────────────────────────────
-- Partial index on is_self_contained = true.  Self-contained queries are served
-- by the covering plate-number index; this partial index has never been used.
DROP INDEX IF EXISTS public.idx_canonical_scv_self_contained;

-- ── zones ────────────────────────────────────────────────────────────────────
-- Lat/lng btree index — superseded by the GiST geometry index being restored in
-- migration 20260430000002.  ST_DWithin and spatial operators use the GiST path;
-- this btree has 0 scans.
DROP INDEX IF EXISTS public.idx_zones_location;

-- ── user_profiles ─────────────────────────────────────────────────────────────
-- GIN index on authorized_activities (JSONB array).  Expensive to maintain
-- (GIN indexes re-index the full array on every row update).  0 scans; queries
-- use the org/role btree indexes instead.
DROP INDEX IF EXISTS public.idx_user_profiles_authorized_activities;

-- Certificate-of-authority expiry partial index.  0 scans; expiry UI queries
-- do a full scan of the small user_profiles table (10 rows) which is cheaper.
DROP INDEX IF EXISTS public.idx_user_profiles_coa_expiry;

-- Compliance status index.  0 scans; the compliance dashboard uses
-- idx_user_profiles_compliance which already covers this access pattern.
DROP INDEX IF EXISTS public.idx_user_profiles_compliance_status;

-- ── bug_reports ───────────────────────────────────────────────────────────────
-- bug_reports is a tiny administrative table (2 rows).  The planner always
-- chooses seq scan over index on tables this small.
DROP INDEX IF EXISTS public.idx_bug_reports_severity;
DROP INDEX IF EXISTS public.idx_bug_reports_created;
