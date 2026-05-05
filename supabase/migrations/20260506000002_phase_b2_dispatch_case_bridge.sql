-- Phase B2: Dispatch and Command — Case Model Bridge
-- Adds case_id reverse-lookup to dispatch_jobs and a lightweight
-- acknowledgement-log table for the dispatch lifecycle audit trail.

-- Add case_id back-reference to dispatch_jobs so the dispatch console
-- can surface the linked operational case without a join through
-- operational_cases.dispatch_job_id.
ALTER TABLE IF EXISTS public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_case_id
  ON public.dispatch_jobs(case_id)
  WHERE case_id IS NOT NULL;

-- Dispatch acknowledgement log ─ records every acknowledgement-style
-- lifecycle transition (assigned → acknowledged → en_route → on_scene)
-- with the callsign at time of transition and optional ETA.
CREATE TABLE IF NOT EXISTS public.dispatch_acknowledgement_log (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id                UUID        NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  dispatch_job_id        UUID        NOT NULL REFERENCES public.dispatch_jobs(id) ON DELETE CASCADE,
  officer_id             UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  -- Lifecycle stage being acknowledged
  lifecycle_stage        TEXT        NOT NULL DEFAULT 'acknowledged'
    CHECK (lifecycle_stage IN ('assigned', 'acknowledged', 'en_route', 'on_scene', 'completed', 'cancelled')),

  -- Callsign active at the moment of this acknowledgement
  callsign               TEXT,

  -- Optional ETA supplied by the officer at en_route stage
  eta_seconds            INTEGER,

  -- Free-form notes (e.g. "delayed by traffic")
  notes                  TEXT,

  acknowledged_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dispatch_acknowledgement_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_org_dispatch_ack_log" ON public.dispatch_acknowledgement_log;
CREATE POLICY "users_read_own_org_dispatch_ack_log"
  ON public.dispatch_acknowledgement_log FOR SELECT
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "users_manage_own_org_dispatch_ack_log" ON public.dispatch_acknowledgement_log;
CREATE POLICY "users_manage_own_org_dispatch_ack_log"
  ON public.dispatch_acknowledgement_log FOR ALL
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_dispatch_ack_log_case
  ON public.dispatch_acknowledgement_log(case_id, acknowledged_at DESC);

CREATE INDEX IF NOT EXISTS idx_dispatch_ack_log_job
  ON public.dispatch_acknowledgement_log(dispatch_job_id, acknowledged_at DESC);

GRANT SELECT, INSERT ON public.dispatch_acknowledgement_log TO authenticated;

COMMENT ON TABLE public.dispatch_acknowledgement_log IS
  'Phase B2: Dispatch acknowledgement lifecycle transitions with callsign and ETA capture';
