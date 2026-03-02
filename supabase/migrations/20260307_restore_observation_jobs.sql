-- ============================================================================
-- RESTORE: observation_jobs queue + fix "sop" trigger bug
-- Date: 2026-03-07
--
-- PROBLEM 1: "Save failed: invalid reference to FROM-clause entry for table sop"
--   An AFTER INSERT trigger on public.observations references an alias "sop"
--   in a sub-query context where PostgreSQL cannot resolve the alias.
--   The trigger was applied directly to the live DB (not via a migration file),
--   so it cannot be identified by name — we drop ALL AFTER INSERT triggers on
--   observations and recreate only the one we need.
--
-- PROBLEM 2: observation_jobs not being populated
--   Migrations 20260303/20260304 removed the observation_jobs trigger.
--   The table still exists in the live DB with the original schema:
--     id, observation_id, job_type, status, attempts, last_error,
--     scheduled_at, started_at, completed_at, created_at
--   This migration restores the AFTER INSERT trigger using SECURITY DEFINER
--   so the officer's unprivileged session can always enqueue jobs.
--
-- CANONICAL SCHEMA (matches live DB data):
--   job_type = 'all'  (covers all background processing: ALPR + embedding + NZSCV)
--   status   = 'pending' | 'processing' | 'completed' | 'failed'
-- ============================================================================

-- ── 1. Drop ALL AFTER INSERT triggers on observations ─────────────────────
--      This removes whatever "sop"-aliased trigger is blocking saves,
--      regardless of its name.  BEFORE UPDATE triggers (e.g. updated_at) are
--      unaffected because this condition only matches AFTER + INSERT + ROW.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname  = 'observations'
      AND n.nspname  = 'public'
      AND (t.tgtype & 1)  = 1   -- ROW-level
      AND (t.tgtype & 2)  = 0   -- AFTER (not BEFORE)
      AND (t.tgtype & 4)  = 4   -- INSERT event
      AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.observations', r.tgname);
    RAISE NOTICE 'Dropped AFTER INSERT trigger on observations: %', r.tgname;
  END LOOP;
END;
$$;

-- ── 2. Drop any leftover enqueue/trigger functions ────────────────────────

DROP FUNCTION IF EXISTS public.trg_fn_create_observation_job()      CASCADE;
DROP FUNCTION IF EXISTS public.enqueue_observation_job(uuid, uuid, uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.enqueue_observation_job(uuid, uuid, uuid, text)       CASCADE;
DROP FUNCTION IF EXISTS public.enqueue_observation_job(uuid)                          CASCADE;

-- ── 3. Ensure observation_jobs table exists with canonical schema ─────────
--      CREATE TABLE IF NOT EXISTS is a no-op when the table already exists,
--      so existing rows (with status='pending') are preserved.

CREATE TABLE IF NOT EXISTS public.observation_jobs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id   uuid        NOT NULL REFERENCES public.observations(id) ON DELETE CASCADE,
  job_type         text        NOT NULL DEFAULT 'all',
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts         integer     NOT NULL DEFAULT 0,
  last_error       text,
  scheduled_at     timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.observation_jobs IS
  'Background-job queue for async processing of vehicle observations '
  '(ALPR plate recognition, vehicle embedding, NZSCV lookup). '
  'job_type=''all'' means all processing steps are needed. '
  'Consumed by the Railway inference service and alpr-process Edge Function.';

-- ── 4. Indexes ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_obs_jobs_status_scheduled
  ON public.observation_jobs (status, scheduled_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_obs_jobs_observation_id
  ON public.observation_jobs (observation_id);

-- ── 5. Enable RLS ─────────────────────────────────────────────────────────

ALTER TABLE public.observation_jobs ENABLE ROW LEVEL SECURITY;

-- ── 6. Drop stale policies (idempotent) ───────────────────────────────────

DROP POLICY IF EXISTS "postgres_manage_observation_jobs"       ON public.observation_jobs;
DROP POLICY IF EXISTS "service_role_manage_observation_jobs"   ON public.observation_jobs;
DROP POLICY IF EXISTS "observation_jobs_insert_own"            ON public.observation_jobs;
DROP POLICY IF EXISTS "observation_jobs_select_org"            ON public.observation_jobs;
DROP POLICY IF EXISTS "observation_jobs_update_own"            ON public.observation_jobs;

-- ── 7. RLS policies ───────────────────────────────────────────────────────

-- postgres role: unrestricted (SECURITY DEFINER trigger functions run as postgres)
CREATE POLICY "postgres_manage_observation_jobs"
  ON public.observation_jobs FOR ALL TO postgres
  USING (true) WITH CHECK (true);

-- service_role: unrestricted (Edge Functions with SERVICE_ROLE_KEY)
CREATE POLICY "service_role_manage_observation_jobs"
  ON public.observation_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- authenticated – INSERT: job is for an observation the user recorded
CREATE POLICY "observation_jobs_insert_own"
  ON public.observation_jobs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id  = observation_id
        AND o.recorded_by = auth.uid()
    )
  );

-- authenticated – SELECT: jobs for observations in the user's org(s)
CREATE POLICY "observation_jobs_select_org"
  ON public.observation_jobs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND (
          o.recorded_by     = auth.uid()
          OR o.organization_id = ANY (get_user_organization_ids())
        )
    )
  );

-- authenticated – UPDATE: user can mark their own jobs for retry
CREATE POLICY "observation_jobs_update_own"
  ON public.observation_jobs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND o.recorded_by = auth.uid()
    )
  );

-- ── 8. SECURITY DEFINER enqueue helper ───────────────────────────────────
--      Runs as postgres → bypasses RLS so AFTER INSERT triggers on
--      observations (which execute in the caller's security context)
--      can always write to observation_jobs.

CREATE OR REPLACE FUNCTION public.enqueue_observation_job(
  p_observation_id uuid,
  p_job_type       text DEFAULT 'all'
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
    scheduled_at
  ) VALUES (
    p_observation_id,
    p_job_type,
    'pending',
    now()
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

ALTER FUNCTION public.enqueue_observation_job(uuid, text) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.enqueue_observation_job(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_observation_job(uuid, text) TO service_role;

COMMENT ON FUNCTION public.enqueue_observation_job IS
  'SECURITY DEFINER wrapper — inserts an observation_jobs row as postgres, '
  'bypassing RLS so AFTER INSERT triggers on observations can always enqueue.';

-- ── 9. Trigger function ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_fn_create_observation_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only enqueue when observation is inserted with pending (or no) status.
  -- Skip when alpr-process Edge Function inserts with status='completed'.
  IF NEW.processing_status IS NULL OR NEW.processing_status = 'pending' THEN
    PERFORM public.enqueue_observation_job(NEW.id, 'all');
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trg_fn_create_observation_job() OWNER TO postgres;

COMMENT ON FUNCTION public.trg_fn_create_observation_job IS
  'AFTER INSERT trigger on observations: enqueues an observation_jobs row '
  'for background ALPR/embedding/NZSCV processing via the inference service.';

-- ── 10. Attach trigger ────────────────────────────────────────────────────

CREATE TRIGGER trg_create_observation_job
  AFTER INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_create_observation_job();

COMMENT ON TRIGGER trg_create_observation_job ON public.observations IS
  'Enqueues a background processing job on every new pending observation.';

-- ── 11. Verification ──────────────────────────────────────────────────────

DO $$
DECLARE
  v_trigger_count  integer;
  v_fn_owner       text;
  v_policy_count   integer;
BEGIN
  -- Count AFTER INSERT triggers on observations
  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'observations' AND n.nspname = 'public'
    AND (t.tgtype & 1) = 1
    AND (t.tgtype & 2) = 0
    AND (t.tgtype & 4) = 4
    AND NOT t.tgisinternal;

  -- Check function ownership
  SELECT pg_get_userbyid(p.proowner) INTO v_fn_owner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'trg_fn_create_observation_job';

  -- Count RLS policies
  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'observation_jobs';

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260307_restore_observation_jobs complete';
  RAISE NOTICE '   AFTER INSERT triggers on observations: %  (expected 1)', v_trigger_count;
  RAISE NOTICE '   trg_fn_create_observation_job owner: %  (expected postgres)', v_fn_owner;
  RAISE NOTICE '   observation_jobs RLS policies: %  (expected 5)', v_policy_count;
  RAISE NOTICE '';
  RAISE NOTICE '   Flow:';
  RAISE NOTICE '   1. Officer inserts observation (status=pending)';
  RAISE NOTICE '   2. trg_create_observation_job fires → enqueue_observation_job()';
  RAISE NOTICE '   3. observation_jobs row created (job_type=all, status=pending)';
  RAISE NOTICE '   4. alpr-process Edge Function polls / is invoked → updates observation';
END;
$$;
