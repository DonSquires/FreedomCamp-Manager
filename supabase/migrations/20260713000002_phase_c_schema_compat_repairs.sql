-- ============================================================================
-- Phase C Schema Compatibility Repairs
-- Date: 2026-07-13
--
-- Purpose:
-- 1) Ensure C1 tables exist in drifted environments.
-- 2) Align access_control_incidents with C2 case-bridge test contract.
-- 3) Align service_agreements with C4 case-bridge test contract while
--    preserving older dispatch-contract columns.
--
-- This migration is intentionally idempotent and additive.
-- ============================================================================

-- ── C1: Ensure site_guard_shifts exists ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_guard_shifts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id          UUID NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  officer_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  client_site_id   UUID REFERENCES public.client_sites(id) ON DELETE SET NULL,
  roster_shift_id  UUID REFERENCES public.roster_shifts(id) ON DELETE SET NULL,
  shift_start      TIMESTAMPTZ NOT NULL DEFAULT now(),
  shift_end        TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned')),
  start_gps_lat    DOUBLE PRECISION,
  start_gps_lng    DOUBLE PRECISION,
  briefing_notes   TEXT,
  handover_notes   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_guard_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_guard_shifts_org_policy" ON public.site_guard_shifts;
CREATE POLICY "site_guard_shifts_org_policy" ON public.site_guard_shifts
  FOR ALL USING (
    organization_id = (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_site_guard_shifts_org_officer
  ON public.site_guard_shifts(organization_id, officer_id, shift_start DESC);

CREATE INDEX IF NOT EXISTS idx_site_guard_shifts_case
  ON public.site_guard_shifts(case_id);

CREATE INDEX IF NOT EXISTS idx_site_guard_shifts_site_active
  ON public.site_guard_shifts(client_site_id, status)
  WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE ON public.site_guard_shifts TO authenticated;

-- ── C1: Ensure emergency_assist_events exists ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_assist_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id          UUID NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  officer_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  client_site_id   UUID REFERENCES public.client_sites(id) ON DELETE SET NULL,
  assist_type      TEXT NOT NULL DEFAULT 'emergency'
    CHECK (assist_type IN (
      'emergency', 'medical', 'aggressive_person', 'supervisor_required', 'police_required'
    )),
  severity         TEXT NOT NULL DEFAULT 'high'
    CHECK (severity IN ('medium', 'high', 'critical')),
  description      TEXT,
  gps_lat          DOUBLE PRECISION,
  gps_lng          DOUBLE PRECISION,
  welfare_event_id UUID,
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolved_at      TIMESTAMPTZ,
  resolution_notes TEXT,
  status           TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'acknowledged', 'resolved', 'false_alarm')),
  triggered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.emergency_assist_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emergency_assist_events_org_policy" ON public.emergency_assist_events;
CREATE POLICY "emergency_assist_events_org_policy" ON public.emergency_assist_events
  FOR ALL USING (
    organization_id = (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_emergency_assist_events_org_officer
  ON public.emergency_assist_events(organization_id, officer_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_emergency_assist_events_case
  ON public.emergency_assist_events(case_id);

CREATE INDEX IF NOT EXISTS idx_emergency_assist_events_active
  ON public.emergency_assist_events(organization_id, status)
  WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE ON public.emergency_assist_events TO authenticated;

-- ── C1: Ensure site_incidents has case link ─────────────────────────────────
ALTER TABLE public.site_incidents
  ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_incidents_case
  ON public.site_incidents(case_id)
  WHERE case_id IS NOT NULL;

-- ── C2: Align access_control_incidents with case bridge contract ────────────
ALTER TABLE public.access_control_incidents
  ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES public.operational_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS officer_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_access_control_incidents_case
  ON public.access_control_incidents(case_id)
  WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_access_control_incidents_officer
  ON public.access_control_incidents(officer_id);

-- Legacy schema required zone_id/title on insert. Relax for C2 bridge writes.
ALTER TABLE public.access_control_incidents
  ALTER COLUMN zone_id DROP NOT NULL,
  ALTER COLUMN title DROP NOT NULL;

ALTER TABLE public.access_control_incidents
  ALTER COLUMN title SET DEFAULT 'Access control incident';

-- ── C4: Align service_agreements with case bridge contract ──────────────────
ALTER TABLE public.service_agreements
  ADD COLUMN IF NOT EXISTS agreement_number TEXT,
  ADD COLUMN IF NOT EXISTS service_type TEXT,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renewal_notice_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS patrol_frequency_hours DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS min_officers INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS client_site_id UUID REFERENCES public.client_sites(id) ON DELETE SET NULL;

-- Backfill contract columns from legacy dispatch contract fields where present.
UPDATE public.service_agreements
SET
  agreement_number = COALESCE(NULLIF(agreement_number, ''), NULLIF(reference_number, ''), 'LEGACY-' || LEFT(id::text, 8)),
  service_type = COALESCE(
    NULLIF(service_type, ''),
    CASE agreement_type
      WHEN 'alarm' THEN 'other'
      WHEN 'investigation' THEN 'other'
      ELSE agreement_type
    END,
    'other'
  ),
  start_date = COALESCE(start_date, active_from),
  end_date = COALESCE(end_date, active_to),
  status = COALESCE(
    NULLIF(status, ''),
    CASE
      WHEN is_active IS true THEN 'active'
      WHEN is_active IS false THEN 'suspended'
      ELSE 'active'
    END
  )
WHERE
  agreement_number IS NULL
  OR service_type IS NULL
  OR start_date IS NULL
  OR status IS NULL;

ALTER TABLE public.service_agreements
  ALTER COLUMN agreement_number SET NOT NULL,
  ALTER COLUMN service_type SET NOT NULL;

ALTER TABLE public.service_agreements
  DROP CONSTRAINT IF EXISTS service_agreements_service_type_check;

ALTER TABLE public.service_agreements
  ADD CONSTRAINT service_agreements_service_type_check
  CHECK (service_type IN (
    'guarding', 'patrol', 'freedom_camping', 'parking', 'noise_control',
    'biosecurity', 'ems', 'event_security', 'access_control', 'other'
  ));

ALTER TABLE public.service_agreements
  DROP CONSTRAINT IF EXISTS service_agreements_status_check;

ALTER TABLE public.service_agreements
  ADD CONSTRAINT service_agreements_status_check
  CHECK (status IN ('draft', 'active', 'suspended', 'expired', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_agreement_number
  ON public.service_agreements(organization_id, agreement_number);

CREATE INDEX IF NOT EXISTS idx_service_agreements_client_status
  ON public.service_agreements(client_org_id, status);
