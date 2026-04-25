-- ============================================================================
-- Fix observations table: ensure idempotency_key column exists and reload
-- the PostgREST schema cache.
-- Date: 2026-03-30
--
-- Symptoms fixed:
--   • alpr-process and vehicle-ingest fail with:
--     "Database error: Could not find the 'idempotency_key' column of
--     'observations' in the schema cache"
--
-- Root cause:
--   The 20260221_rebuild_observations_clean.sql migration dropped and
--   recreated the observations table WITH idempotency_key, but PostgREST's
--   in-memory schema cache was not refreshed after the rebuild.  PostgREST
--   therefore returned "column not found" errors when any query referenced
--   idempotency_key, even though the column exists at the PostgreSQL level.
--
-- This migration:
--   1. Adds idempotency_key IF NOT EXISTS (safe no-op when already present).
--   2. Drops the full-table UNIQUE constraint (if still present from the
--      original rebuild) and replaces it with a partial unique index that
--      also permits NULL values (for legacy / imported observations that
--      have no device key).
--   3. Issues NOTIFY pgrst, 'reload schema' to force PostgREST to rebuild
--      its schema cache from pg_catalog immediately.
-- ============================================================================

-- ── 1. Ensure column exists ───────────────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN public.observations.idempotency_key IS
  'Format: {deviceId}:{localCaptureId} — used for offline-first deduplication. '
  'NULL is permitted for legacy / imported observations.';

-- ── 2. Replace full-table UNIQUE with a partial unique index ──────────────
--
-- The original rebuild migration created UNIQUE NOT NULL.  A later migration
-- (20260320) dropped NOT NULL and replaced the constraint with a partial
-- index.  We repeat that step here with IF NOT EXISTS / DO guards so the
-- migration is safe to run in any database state.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  table_schema     = 'public'
      AND  table_name       = 'observations'
      AND  constraint_name  = 'observations_idempotency_key_key'
      AND  constraint_type  = 'UNIQUE'
  ) THEN
    ALTER TABLE public.observations
      DROP CONSTRAINT observations_idempotency_key_key;
    RAISE NOTICE 'Dropped full-table UNIQUE constraint observations_idempotency_key_key';
  END IF;
END;
$$;

-- Drop the old full-column index (created by the original rebuild migration)
-- and replace with a partial one that only enforces uniqueness on non-NULL keys.
DROP INDEX IF EXISTS public.idx_obs_idempotency;

CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_idempotency_notnull
  ON public.observations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON INDEX public.idx_obs_idempotency_notnull IS
  'Prevents duplicate live-scan observations by device idempotency key. '
  'NULL keys (legacy / imported observations) are excluded from the uniqueness check.';

-- ── 3. Force PostgREST schema cache reload ────────────────────────────────
--
-- This notifies the PostgREST process to discard its in-memory schema cache
-- and reload from pg_catalog.  Required after any DDL that PostgREST was
-- not aware of at startup (e.g. the 20260221 table rebuild).

NOTIFY pgrst, 'reload schema';

-- ── 4. Verification ───────────────────────────────────────────────────────

DO $$
DECLARE
  v_col_exists  boolean;
  v_idx_exists  boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'observations'
      AND  column_name  = 'idempotency_key'
  ) INTO v_col_exists;

  SELECT EXISTS (
    SELECT 1
    FROM   pg_indexes
    WHERE  schemaname = 'public'
      AND  tablename  = 'observations'
      AND  indexname  = 'idx_obs_idempotency_notnull'
  ) INTO v_idx_exists;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260330_fix_observations_idempotency_key complete';
  RAISE NOTICE '   observations.idempotency_key column present: %', v_col_exists;
  RAISE NOTICE '   Partial unique index idx_obs_idempotency_notnull: %', v_idx_exists;
  RAISE NOTICE '   PostgREST schema cache reload issued.';
  RAISE NOTICE '';
END;
$$;
