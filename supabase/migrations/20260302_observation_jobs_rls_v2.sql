-- ============================================================================
-- FIX v2: observation_jobs RLS – comprehensive patch for all role contexts
-- Date: 2026-03-02
--
-- Problem (still occurring after 20260301_fix_observation_jobs_rls.sql):
--   "new row violates row-level security policy for table observation_jobs"
--
-- Root cause analysis:
--   The AFTER INSERT trigger trg_create_observation_job on `observations` calls
--   SECURITY DEFINER function enqueue_observation_job(), which runs as the
--   function OWNER (postgres).  The existing INSERT policy is scoped
--   `TO authenticated`, so the postgres role has NO matching policy.
--
--   In standard PostgreSQL, postgres is a superuser with BYPASSRLS, so RLS is
--   skipped entirely for postgres.  In some Supabase-managed environments the
--   effective privilege set may differ (e.g. functions created/replaced by a
--   non-superuser owner, or an atypical BYPASSRLS configuration).
--
-- This migration fixes every plausible failure mode:
--   1. Ensure observation_jobs table exists (idempotent – safe if already present).
--   2. Explicitly re-assign both SECURITY DEFINER functions to postgres.
--   3. Add a catch-all policy for the postgres role (belt-and-suspenders so
--      the INSERT succeeds even if postgres is subject to RLS evaluation).
--   4. Re-create the trigger to guarantee it is SECURITY DEFINER.
-- ============================================================================

-- ── 1. Ensure observation_jobs table exists (idempotent) ──────────────────

CREATE TABLE IF NOT EXISTS public.observation_jobs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id   uuid        NOT NULL REFERENCES public.observations(id) ON DELETE CASCADE,
  job_type         text        NOT NULL DEFAULT 'alpr_processing',
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  recorded_by      uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  input_data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  output_data      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error_message    text,
  attempts         integer     NOT NULL DEFAULT 0,
  max_attempts     integer     NOT NULL DEFAULT 3,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  completed_at     timestamptz
);

-- Ensure RLS is enabled (idempotent)
ALTER TABLE public.observation_jobs ENABLE ROW LEVEL SECURITY;

-- ── 2. Drop stale / conflicting policies (safe – table now guaranteed to exist)

DROP POLICY IF EXISTS "observation_jobs_insert_own"            ON public.observation_jobs;
DROP POLICY IF EXISTS "observation_jobs_select_org"            ON public.observation_jobs;
DROP POLICY IF EXISTS "observation_jobs_update_own"            ON public.observation_jobs;
DROP POLICY IF EXISTS "service_role_manage_observation_jobs"   ON public.observation_jobs;
DROP POLICY IF EXISTS "postgres_manage_observation_jobs"       ON public.observation_jobs;

-- ── 3. Recreate RLS policies covering all role contexts ────────────────────

-- postgres role: full access
-- Belt-and-suspenders: even if postgres is subject to RLS in this environment,
-- this policy ensures the SECURITY DEFINER trigger INSERT always succeeds.
CREATE POLICY "postgres_manage_observation_jobs"
  ON public.observation_jobs
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- service_role: full access (used by Edge Functions with SERVICE_ROLE_KEY)
CREATE POLICY "service_role_manage_observation_jobs"
  ON public.observation_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated officers: insert jobs for their own observations
-- (covers the case where the trigger runs in the authenticated context)
CREATE POLICY "observation_jobs_insert_own"
  ON public.observation_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (recorded_by = auth.uid());

-- authenticated users: read jobs in their organisation(s)
CREATE POLICY "observation_jobs_select_org"
  ON public.observation_jobs
  FOR SELECT
  TO authenticated
  USING (
    recorded_by = auth.uid()
    OR organization_id = ANY (get_user_organization_ids())
  );

-- authenticated users: update their own jobs (e.g. manual retry)
CREATE POLICY "observation_jobs_update_own"
  ON public.observation_jobs
  FOR UPDATE
  TO authenticated
  USING (recorded_by = auth.uid());

-- ── 4. Re-create enqueue_observation_job with explicit postgres ownership ───
--   CREATE OR REPLACE keeps the original owner when the function already exists.
--   The subsequent ALTER FUNCTION ensures owner = postgres regardless.

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

-- Force owner to postgres so SECURITY DEFINER runs as superuser (bypasses RLS)
ALTER FUNCTION public.enqueue_observation_job(uuid, uuid, uuid, text, text)
  OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.enqueue_observation_job TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_observation_job TO service_role;

-- ── 5. Re-create trigger function with explicit postgres ownership ───────────

CREATE OR REPLACE FUNCTION public.trg_fn_create_observation_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Enqueue a background ALPR job only when the observation is first inserted
  -- with pending status. Skip if the Edge Function already set it to completed.
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

-- Force owner to postgres so SECURITY DEFINER runs as superuser (bypasses RLS)
ALTER FUNCTION public.trg_fn_create_observation_job()
  OWNER TO postgres;

-- ── 6. Re-attach trigger to observations ─────────────────────────────────────

DROP TRIGGER IF EXISTS trg_create_observation_job ON public.observations;

CREATE TRIGGER trg_create_observation_job
  AFTER INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_create_observation_job();

COMMENT ON TRIGGER trg_create_observation_job ON public.observations IS
  'Enqueues an alpr_processing job in observation_jobs on every new observation '
  'via SECURITY DEFINER function owned by postgres (bypasses RLS).';

-- ── 7. Verification notice ───────────────────────────────────────────────────

DO $$
DECLARE
  v_owner      text;
  v_is_secdef  boolean;
BEGIN
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

  RAISE NOTICE '✅ 20260302_observation_jobs_rls_v2 applied';
  RAISE NOTICE '   + postgres_manage_observation_jobs policy (NEW)';
  RAISE NOTICE '   + service_role_manage_observation_jobs policy';
  RAISE NOTICE '   + observation_jobs_insert_own / select_org / update_own (authenticated)';
  RAISE NOTICE '   + enqueue_observation_job OWNER TO postgres';
  RAISE NOTICE '   + trg_fn_create_observation_job OWNER TO postgres';
  RAISE NOTICE '   + trg_create_observation_job trigger re-created on observations';
END;
$$;
