-- ============================================================================
-- FINAL: Remove observation_jobs table and ALL associated artifacts
-- Date: 2026-03-04
--
-- PROBLEM:
-- The observation_jobs table causes "new row violates row-level security policy"
-- errors when officers scan vehicles. The table has RLS enabled but no policies
-- that allow the trigger function to insert rows.
--
-- ROOT CAUSE:
-- Multiple migration files (v1, v2, v3) attempted to fix RLS policies on
-- observation_jobs, but due to alphabetical migration ordering:
--   1. 20260303_observation_jobs_rls_v3.sql recreates the trigger
--   2. 20260303_remove_observation_jobs.sql removes it
-- This creates a race condition where the trigger may exist after migrations.
--
-- SOLUTION:
-- This migration runs AFTER all 20260303_* migrations and ensures:
--   1. The trigger on observations is removed (if it exists)
--   2. All trigger/helper functions are removed (if they exist)
--   3. The observation_jobs table is dropped (if it exists)
--
-- The ALPR pipeline works correctly WITHOUT observation_jobs:
--   • Frontend inserts into observations with processing_status='pending'
--   • Frontend calls alpr-process edge function with observation_id
--   • Edge function updates observation with AI results + status='completed'
-- ============================================================================

-- ── 1. Drop trigger on observations (idempotent) ───────────────────────────
DROP TRIGGER IF EXISTS trg_create_observation_job ON public.observations;

-- ── 2. Drop all observation_jobs related functions (idempotent) ────────────
DROP FUNCTION IF EXISTS public.trg_fn_create_observation_job() CASCADE;
DROP FUNCTION IF EXISTS public.enqueue_observation_job(uuid, uuid, uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.enqueue_observation_job(uuid, uuid, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.enqueue_observation_job(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.update_observation_jobs_updated_at() CASCADE;

-- ── 3. Drop the observation_jobs table (idempotent, CASCADE) ───────────────
DROP TABLE IF EXISTS public.observation_jobs CASCADE;

-- ── 4. Verify cleanup and report status ────────────────────────────────────
DO $$
DECLARE
  v_table_exists boolean;
  v_trigger_exists boolean;
  v_func_count integer;
BEGIN
  -- Check if table still exists
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'observation_jobs' AND n.nspname = 'public'
  ) INTO v_table_exists;

  -- Check if trigger still exists
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'observations' 
      AND n.nspname = 'public'
      AND t.tgname = 'trg_create_observation_job'
  ) INTO v_trigger_exists;

  -- Count related functions
  SELECT COUNT(*) INTO v_func_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' 
    AND (
      p.proname = 'enqueue_observation_job' 
      OR p.proname = 'trg_fn_create_observation_job'
      OR p.proname = 'update_observation_jobs_updated_at'
    );

  -- Report results
  IF v_table_exists THEN
    RAISE WARNING '⚠️  observation_jobs table still exists (unexpected)';
  ELSE
    RAISE NOTICE '✅ observation_jobs table removed';
  END IF;

  IF v_trigger_exists THEN
    RAISE WARNING '⚠️  trg_create_observation_job trigger still exists (unexpected)';
  ELSE
    RAISE NOTICE '✅ trg_create_observation_job trigger removed';
  END IF;

  IF v_func_count > 0 THEN
    RAISE WARNING '⚠️  % observation_jobs function(s) still exist', v_func_count;
  ELSE
    RAISE NOTICE '✅ All observation_jobs functions removed';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260304_remove_observation_jobs_final complete';
  RAISE NOTICE '';
  RAISE NOTICE '   ALPR Pipeline (working flow):';
  RAISE NOTICE '   1. Officer scans vehicle → observations INSERT (status=pending)';
  RAISE NOTICE '   2. Frontend calls alpr-process edge function';
  RAISE NOTICE '   3. Edge function processes AI → observations UPDATE (status=completed)';
  RAISE NOTICE '';
  RAISE NOTICE '   ❌ NO observation_jobs table or triggers needed';
END;
$$;
