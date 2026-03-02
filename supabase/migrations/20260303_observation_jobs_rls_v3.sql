-- ============================================================================
-- FIX v3: observation_jobs RLS – schema-defensive, handles any table state
-- Date: 2026-03-03
--
-- Problem:
--   "new row violates row-level security policy for table observation_jobs"
--   RLS is enabled on observation_jobs but NO policies exist.
--   Previous migrations (v1, v2) may have failed because the live table
--   has a different column set than what CREATE TABLE IF NOT EXISTS expected
--   (e.g. missing recorded_by / organization_id / input_data).
--
-- This migration is fully defensive:
--   1. Adds missing columns via ALTER TABLE ADD COLUMN IF NOT EXISTS
--      (no-op if they already exist, safe if the table uses the old schema).
--   2. Backfills recorded_by / organization_id from the observations table.
--   3. Drops ALL existing policies and recreates them.
--   4. Authenticated policies use sub-queries to observations so they work
--      regardless of whether denormalised columns are populated.
--   5. postgres and service_role get unrestricted access.
--   6. SECURITY DEFINER functions are re-owned to postgres.
--   7. Trigger is re-attached.
--   8. Recommended indexes are added.
-- ============================================================================

-- ── 1. Add missing columns (IF NOT EXISTS – safe for any table state) ─────

ALTER TABLE public.observation_jobs
  ADD COLUMN IF NOT EXISTS recorded_by      uuid REFERENCES public.user_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.observation_jobs
  ADD COLUMN IF NOT EXISTS organization_id  uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.observation_jobs
  ADD COLUMN IF NOT EXISTS input_data       jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.observation_jobs
  ADD COLUMN IF NOT EXISTS output_data      jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.observation_jobs
  ADD COLUMN IF NOT EXISTS error_message    text;

ALTER TABLE public.observation_jobs
  ADD COLUMN IF NOT EXISTS max_attempts     integer DEFAULT 3;

ALTER TABLE public.observation_jobs
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz DEFAULT now();

-- ── 2. Backfill denormalised columns from observations ────────────────────

UPDATE public.observation_jobs oj
SET
  recorded_by     = o.recorded_by,
  organization_id = o.organization_id
FROM public.observations o
WHERE oj.observation_id = o.id
  AND (oj.recorded_by IS NULL OR oj.organization_id IS NULL);

-- ── 3. Ensure RLS is enabled ──────────────────────────────────────────────

ALTER TABLE public.observation_jobs ENABLE ROW LEVEL SECURITY;

-- ── 4. Drop every known / possible stale policy ───────────────────────────

DROP POLICY IF EXISTS "observation_jobs_insert_own"            ON public.observation_jobs;
DROP POLICY IF EXISTS "observation_jobs_select_org"            ON public.observation_jobs;
DROP POLICY IF EXISTS "observation_jobs_update_own"            ON public.observation_jobs;
DROP POLICY IF EXISTS "service_role_manage_observation_jobs"   ON public.observation_jobs;
DROP POLICY IF EXISTS "postgres_manage_observation_jobs"       ON public.observation_jobs;

-- ── 5. Create comprehensive RLS policies ──────────────────────────────────

-- 5a. postgres role: unrestricted (SECURITY DEFINER trigger functions run
--     as the function owner = postgres).  Even if postgres has BYPASSRLS in
--     this environment, an explicit policy guarantees INSERT succeeds.
CREATE POLICY "postgres_manage_observation_jobs"
  ON public.observation_jobs
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- 5b. service_role: unrestricted (Edge Functions using SERVICE_ROLE_KEY)
CREATE POLICY "service_role_manage_observation_jobs"
  ON public.observation_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5c. authenticated – INSERT: officer can enqueue jobs for observations
--     they recorded.  Uses a sub-query so it works even if recorded_by
--     is not yet populated on observation_jobs.
CREATE POLICY "observation_jobs_insert_own"
  ON public.observation_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND o.recorded_by = auth.uid()
    )
  );

-- 5d. authenticated – SELECT: users can read jobs for observations in
--     their organisation(s) or that they recorded.
CREATE POLICY "observation_jobs_select_org"
  ON public.observation_jobs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND (
          o.recorded_by = auth.uid()
          OR o.organization_id = ANY (get_user_organization_ids())
        )
    )
  );

-- 5e. authenticated – UPDATE: officer can update (retry) their own jobs
CREATE POLICY "observation_jobs_update_own"
  ON public.observation_jobs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND o.recorded_by = auth.uid()
    )
  );

-- ── 6. SECURITY DEFINER helper – enqueue a job for a new observation ──────

CREATE OR REPLACE FUNCTION public.enqueue_observation_job(
  p_observation_id  uuid,
  p_recorded_by     uuid,
  p_organization_id uuid,
  p_photo_url       text DEFAULT NULL,
  p_job_type        text DEFAULT 'alpr_processing'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
BEGIN
  INSERT INTO public.observation_jobs (
    observation_id,
    job_type,
    status,
    recorded_by,
    organization_id,
    input_data
  ) VALUES (
    p_observation_id,
    p_job_type,
    'pending',
    p_recorded_by,
    p_organization_id,
    jsonb_build_object(
      'photo_url',   p_photo_url,
      'enqueued_at', now()
    )
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

-- Force owner to postgres so SECURITY DEFINER bypasses RLS
ALTER FUNCTION public.enqueue_observation_job(uuid, uuid, uuid, text, text)
  OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.enqueue_observation_job TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_observation_job TO service_role;

-- ── 7. Trigger function – auto-enqueue on new observation ─────────────────

CREATE OR REPLACE FUNCTION public.trg_fn_create_observation_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.processing_status IS NULL OR NEW.processing_status = 'pending' THEN
    PERFORM public.enqueue_observation_job(
      p_observation_id  => NEW.id,
      p_recorded_by     => NEW.recorded_by,
      p_organization_id => NEW.organization_id,
      p_photo_url       => NEW.photo_url,
      p_job_type        => 'alpr_processing'
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Force owner to postgres
ALTER FUNCTION public.trg_fn_create_observation_job()
  OWNER TO postgres;

-- ── 8. Re-attach trigger to observations ──────────────────────────────────

DROP TRIGGER IF EXISTS trg_create_observation_job ON public.observations;

CREATE TRIGGER trg_create_observation_job
  AFTER INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_create_observation_job();

-- ── 9. Indexes for processor performance ──────────────────────────────────

-- Index on observations for the sub-query RLS policies (SELECT/INSERT/UPDATE)
CREATE INDEX IF NOT EXISTS idx_observations_recorded_by_org
  ON public.observations (recorded_by, organization_id);

-- Partial index for job queue polling.
-- Valid statuses: pending, processing, completed/done, failed/error.
CREATE INDEX IF NOT EXISTS idx_obs_jobs_status_created
  ON public.observation_jobs (status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_obs_jobs_observation_id
  ON public.observation_jobs (observation_id);

CREATE INDEX IF NOT EXISTS idx_obs_jobs_org
  ON public.observation_jobs (organization_id, created_at DESC);

-- ── 10. Verification ──────────────────────────────────────────────────────

DO $$
DECLARE
  v_owner      text;
  v_is_secdef  boolean;
  v_policy_ct  integer;
BEGIN
  -- Check enqueue_observation_job ownership
  SELECT pg_get_userbyid(p.proowner), p.prosecdef
  INTO   v_owner, v_is_secdef
  FROM   pg_proc p
  JOIN   pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'enqueue_observation_job'
  LIMIT  1;

  IF v_owner IS NOT NULL THEN
    RAISE NOTICE 'enqueue_observation_job: owner=%, security_definer=%',
      v_owner, v_is_secdef;
  END IF;

  -- Check trg_fn_create_observation_job ownership
  SELECT pg_get_userbyid(p.proowner), p.prosecdef
  INTO   v_owner, v_is_secdef
  FROM   pg_proc p
  JOIN   pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'trg_fn_create_observation_job'
  LIMIT  1;

  IF v_owner IS NOT NULL THEN
    RAISE NOTICE 'trg_fn_create_observation_job: owner=%, security_definer=%',
      v_owner, v_is_secdef;
  END IF;

  -- Count policies
  SELECT count(*)
  INTO   v_policy_ct
  FROM   pg_policies
  WHERE  tablename = 'observation_jobs'
    AND  schemaname = 'public';

  RAISE NOTICE '✅ 20260303_observation_jobs_rls_v3 applied';
  RAISE NOTICE '   Total policies on observation_jobs: %', v_policy_ct;
  RAISE NOTICE '   + postgres_manage_observation_jobs (ALL)';
  RAISE NOTICE '   + service_role_manage_observation_jobs (ALL)';
  RAISE NOTICE '   + observation_jobs_insert_own (INSERT, sub-query based)';
  RAISE NOTICE '   + observation_jobs_select_org (SELECT, sub-query based)';
  RAISE NOTICE '   + observation_jobs_update_own (UPDATE, sub-query based)';
  RAISE NOTICE '   + enqueue_observation_job OWNER TO postgres';
  RAISE NOTICE '   + trg_fn_create_observation_job OWNER TO postgres';
  RAISE NOTICE '   + trg_create_observation_job trigger on observations';
END;
$$;
