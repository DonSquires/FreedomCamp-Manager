-- Migration: Dispatch Jobs – GDS CATS-inspired computer-aided dispatch system
--
-- Full lifecycle modelled on GDS CATS:
--   pending → dispatched → acknowledged → en_route → on_scene → completed
--                                ↘ cancelled (at any stage)
--
-- Auto-escalation columns allow the dispatch console to highlight jobs that
-- have sat in a stage beyond their SLA (response_sla_minutes).

CREATE TABLE IF NOT EXISTS public.dispatch_jobs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Job number for human reference (e.g. "J-20260427-0042")
  job_number          TEXT        UNIQUE,

  -- Classification
  job_type            TEXT        NOT NULL DEFAULT 'general'
                        CHECK (job_type IN (
                          'general', 'welfare_check', 'alarm_response', 'patrol',
                          'noise_complaint', 'freedom_camping', 'parking',
                          'medical', 'fire', 'suspicious_activity', 'escort',
                          'lock_unlock', 'property_check', 'vandalism', 'other'
                        )),
  priority            TEXT        NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  -- Location / site
  client_site_id      UUID        REFERENCES public.client_sites(id)           ON DELETE SET NULL,
  zone_id             UUID        REFERENCES public.zones(id)                   ON DELETE SET NULL,
  address             TEXT,
  gps_lat             DOUBLE PRECISION,
  gps_lng             DOUBLE PRECISION,

  -- Description
  title               TEXT        NOT NULL,
  description         TEXT,
  caller_name         TEXT,
  caller_phone        TEXT,

  -- Assignment
  assigned_to         UUID        REFERENCES public.user_profiles(id)           ON DELETE SET NULL,
  dispatched_by       UUID        REFERENCES public.user_profiles(id)           ON DELETE SET NULL,

  -- Full GDS CATS status lifecycle
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending',
                          'dispatched',
                          'acknowledged',
                          'en_route',
                          'on_scene',
                          'completed',
                          'cancelled'
                        )),

  -- Timestamps for each stage (enables SLA reporting)
  dispatched_at       TIMESTAMPTZ,
  acknowledged_at     TIMESTAMPTZ,
  en_route_at         TIMESTAMPTZ,
  on_scene_at         TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,

  -- SLA / escalation
  response_sla_minutes INTEGER DEFAULT 60,       -- target: pending→on_scene
  escalation_level    INTEGER NOT NULL DEFAULT 0, -- 0=none,1=warn,2=alert,3=critical
  escalated_at        TIMESTAMPTZ,
  sla_breached        BOOLEAN     NOT NULL DEFAULT false,

  -- Officer completion notes
  completion_notes    TEXT,
  completion_photo_urls TEXT[],

  -- Relationship to other tables
  breach_alert_id     UUID        REFERENCES public.breach_alerts(id)           ON DELETE SET NULL,
  investigation_job_id UUID       REFERENCES public.investigation_jobs(id)      ON DELETE SET NULL,

  created_by          UUID        REFERENCES public.user_profiles(id)           ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the dispatch console (hot queries)
CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_org_status
  ON public.dispatch_jobs(organization_id, status, priority DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_assigned
  ON public.dispatch_jobs(assigned_to, status) WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_active
  ON public.dispatch_jobs(organization_id)
  WHERE status NOT IN ('completed', 'cancelled');

-- Auto-generate job_number on insert
CREATE OR REPLACE FUNCTION public.generate_dispatch_job_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  seq  INTEGER;
  date TEXT;
BEGIN
  date := to_char(now(), 'YYYYMMDD');
  SELECT COALESCE(MAX(
    (regexp_match(job_number, 'J-[0-9]+-([0-9]+)'))[1]::integer
  ), 0) + 1
  INTO seq
  FROM public.dispatch_jobs
  WHERE job_number LIKE 'J-' || date || '-%';

  NEW.job_number := 'J-' || date || '-' || lpad(seq::text, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dispatch_job_number
  BEFORE INSERT ON public.dispatch_jobs
  FOR EACH ROW WHEN (NEW.job_number IS NULL)
  EXECUTE FUNCTION public.generate_dispatch_job_number();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_dispatch_jobs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_dispatch_jobs_updated_at
  BEFORE UPDATE ON public.dispatch_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_dispatch_jobs_updated_at();

-- RLS
ALTER TABLE public.dispatch_jobs ENABLE ROW LEVEL SECURITY;

-- Admins manage all jobs in their org
CREATE POLICY "admins manage dispatch_jobs"
  ON public.dispatch_jobs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master')
        AND up.organization_id = dispatch_jobs.organization_id
    )
  );

-- Officers can read and update jobs assigned to them
CREATE POLICY "officers read assigned dispatch_jobs"
  ON public.dispatch_jobs FOR SELECT
  USING (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('officer', 'admin_officer')
        AND up.organization_id = dispatch_jobs.organization_id
    )
  );

CREATE POLICY "officers update own dispatch_jobs"
  ON public.dispatch_jobs FOR UPDATE
  USING (assigned_to = auth.uid());
