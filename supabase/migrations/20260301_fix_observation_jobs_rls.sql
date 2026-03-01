-- ============================================================================
-- FIX: observation_jobs RLS blocking the scan pipeline
-- Date: 2026-03-01
-- Issue: "new row violates row-level security policy for table observation_jobs"
--        Officers cannot complete a scan because an AFTER INSERT trigger on
--        `observations` attempts to write a background-processing row into
--        `observation_jobs`, but that table had RLS enabled with no INSERT
--        policy for the `authenticated` role.
--
-- Fix:
--   1. Create observation_jobs table (IF NOT EXISTS – idempotent for live DB)
--   2. Enable RLS
--   3. Add permissive policies for `authenticated` and `service_role`
--   4. Create SECURITY DEFINER helper function so the trigger bypasses RLS
--   5. Create/replace AFTER INSERT trigger on observations to enqueue jobs
-- ============================================================================

-- ── 1. Create observation_jobs table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.observation_jobs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id   uuid        NOT NULL REFERENCES public.observations(id) ON DELETE CASCADE,
  job_type         text        NOT NULL DEFAULT 'alpr_processing',
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  -- Denormalised context for RLS without joins
  recorded_by      uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Job payload / result
  input_data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  output_data      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error_message    text,
  -- Retry tracking
  attempts         integer     NOT NULL DEFAULT 0,
  max_attempts     integer     NOT NULL DEFAULT 3,
  -- Timestamps
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  completed_at     timestamptz
);

COMMENT ON TABLE public.observation_jobs IS
  'Background-job queue for async ALPR/AI processing of vehicle observations.';

-- ── 2. Indexes ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_obs_jobs_status_created
  ON public.observation_jobs (status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_obs_jobs_observation_id
  ON public.observation_jobs (observation_id);

CREATE INDEX IF NOT EXISTS idx_obs_jobs_org
  ON public.observation_jobs (organization_id, created_at DESC);

-- ── 3. Enable RLS ─────────────────────────────────────────────────────────

ALTER TABLE public.observation_jobs ENABLE ROW LEVEL SECURITY;

-- ── 4. Drop any stale / conflicting policies ──────────────────────────────

DROP POLICY IF EXISTS "observation_jobs_insert_own"            ON public.observation_jobs;
DROP POLICY IF EXISTS "observation_jobs_select_org"            ON public.observation_jobs;
DROP POLICY IF EXISTS "observation_jobs_update_own"            ON public.observation_jobs;
DROP POLICY IF EXISTS "service_role_manage_observation_jobs"   ON public.observation_jobs;

-- ── 5. RLS policies ───────────────────────────────────────────────────────

-- Officers can insert jobs for their own observations
CREATE POLICY "observation_jobs_insert_own"
  ON public.observation_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (recorded_by = auth.uid());

-- Users can view jobs that belong to their organisation(s)
CREATE POLICY "observation_jobs_select_org"
  ON public.observation_jobs
  FOR SELECT
  TO authenticated
  USING (
    recorded_by = auth.uid()
    OR organization_id = ANY (get_user_organization_ids())
  );

-- Users can update jobs they own (e.g. retry)
CREATE POLICY "observation_jobs_update_own"
  ON public.observation_jobs
  FOR UPDATE
  TO authenticated
  USING (recorded_by = auth.uid());

-- Service-role (Edge Functions) has unrestricted access
CREATE POLICY "service_role_manage_observation_jobs"
  ON public.observation_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 6. updated_at auto-maintenance trigger ────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_observation_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_obs_jobs_updated_at ON public.observation_jobs;
CREATE TRIGGER trg_obs_jobs_updated_at
  BEFORE UPDATE ON public.observation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_observation_jobs_updated_at();

-- ── 7. SECURITY DEFINER helper – enqueue a job for a new observation ──────
--   Running SECURITY DEFINER means the function executes as its owner
--   (typically the migration user / postgres), which bypasses RLS.
--   This allows an AFTER INSERT trigger on observations to write to
--   observation_jobs even when called from an unprivileged officer session.

CREATE OR REPLACE FUNCTION public.enqueue_observation_job(
  p_observation_id  uuid,
  p_recorded_by     uuid,
  p_organization_id uuid,
  p_photo_url       text    DEFAULT NULL,
  p_job_type        text    DEFAULT 'alpr_processing'
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
      'photo_url',  p_photo_url,
      'enqueued_at', now()
    )
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_observation_job TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_observation_job TO service_role;

COMMENT ON FUNCTION public.enqueue_observation_job IS
  'SECURITY DEFINER wrapper that inserts an observation_jobs row, bypassing RLS '
  'so that AFTER INSERT triggers on observations (which run in the caller''s '
  'security context) do not hit an RLS violation.';

-- ── 8. Trigger function: auto-enqueue job on new observation ──────────────

CREATE OR REPLACE FUNCTION public.trg_fn_create_observation_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only create a job when a new observation is inserted with pending status
  -- Skip if already completed (e.g. inserted directly by an Edge Function)
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

-- ── 9. Attach trigger to observations table ───────────────────────────────

DROP TRIGGER IF EXISTS trg_create_observation_job ON public.observations;

CREATE TRIGGER trg_create_observation_job
  AFTER INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_create_observation_job();

COMMENT ON TRIGGER trg_create_observation_job ON public.observations IS
  'After each new observation is inserted, enqueue an alpr_processing job in '
  'observation_jobs via a SECURITY DEFINER function so RLS does not block the '
  'officer''s session.';

-- ── Verification ──────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✅ observation_jobs RLS fix applied';
  RAISE NOTICE '   + observation_jobs table created (IF NOT EXISTS)';
  RAISE NOTICE '   + RLS enabled with insert/select/update policies for authenticated';
  RAISE NOTICE '   + service_role full-access policy';
  RAISE NOTICE '   + enqueue_observation_job() SECURITY DEFINER function';
  RAISE NOTICE '   + trg_create_observation_job AFTER INSERT trigger on observations';
END;
$$;
