-- ============================================================================
-- Remove observation_jobs table and all associated artifacts
-- Date: 2026-03-03
--
-- The observation_jobs table was an orphaned job queue:
--   • An AFTER INSERT trigger on observations enqueued rows into it
--   • But NO edge function or code ever consumed those rows
--   • The real ALPR pipeline uses observations.processing_status +
--     the alpr-process edge function directly
--   • The table's RLS policies caused 4 consecutive scan failures (v1–v4)
--
-- This migration removes:
--   1. The AFTER INSERT trigger on observations (trg_create_observation_job)
--   2. The trigger function (trg_fn_create_observation_job)
--   3. The enqueue helper function (enqueue_observation_job)
--   4. The updated_at trigger function (update_observation_jobs_updated_at)
--   5. The observation_jobs table itself (CASCADE drops indexes, policies, etc.)
-- ============================================================================

-- ── 1. Drop trigger on observations ───────────────────────────────────────
DROP TRIGGER IF EXISTS trg_create_observation_job ON public.observations;

-- ── 2. Drop trigger/helper functions ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.trg_fn_create_observation_job();
DROP FUNCTION IF EXISTS public.enqueue_observation_job(uuid, uuid, uuid, text, text);

-- ── 3. Drop the table (CASCADE removes indexes, policies, constraints) ────
DROP TABLE IF EXISTS public.observation_jobs CASCADE;

-- Now that dependent triggers are gone, remove updated_at helper function.
DROP FUNCTION IF EXISTS public.update_observation_jobs_updated_at();

-- ── 4. Verification ──────────────────────────────────────────────────────
DO $$
BEGIN
  -- Confirm table is gone
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'observation_jobs' AND relnamespace = 'public'::regnamespace
  ) THEN
    RAISE NOTICE '✅ observation_jobs table removed';
  ELSE
    RAISE NOTICE '⚠️  observation_jobs table still exists';
  END IF;

  -- Confirm trigger is gone
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'observations' AND t.tgname = 'trg_create_observation_job'
  ) THEN
    RAISE NOTICE '✅ trg_create_observation_job trigger removed from observations';
  ELSE
    RAISE NOTICE '⚠️  trg_create_observation_job trigger still exists';
  END IF;

  -- Confirm functions are gone
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enqueue_observation_job'
  ) THEN
    RAISE NOTICE '✅ enqueue_observation_job() function removed';
  ELSE
    RAISE NOTICE '⚠️  enqueue_observation_job() function still exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'trg_fn_create_observation_job'
  ) THEN
    RAISE NOTICE '✅ trg_fn_create_observation_job() function removed';
  ELSE
    RAISE NOTICE '⚠️  trg_fn_create_observation_job() function still exists';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260303_remove_observation_jobs complete';
  RAISE NOTICE '   The ALPR pipeline now uses only:';
  RAISE NOTICE '   • observations.processing_status (pending → processing → completed/failed)';
  RAISE NOTICE '   • alpr-process edge function (fire-and-forget from FieldOfficerPortal)';
END;
$$;
