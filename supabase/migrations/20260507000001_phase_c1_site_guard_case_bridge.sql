-- ============================================================================
-- Phase C1: Site Guard / Static Guard — Case Model Bridge
-- Date: 2026-05-07
--
-- Links static-guard shift operations and emergency-assist requests to the
-- shared operational_cases backbone, enabling a unified timeline view
-- alongside patrol, dispatch, and enforcement events.
--
-- Changes:
--   1. operational_cases — extend case_type + created_from CHECK constraints
--                          to include 'site_guard'
--   2. site_guard_shifts — new table for guard shift start/end events,
--                          linked to operational_cases and client_sites
--   3. emergency_assist_events — new table for one-tap emergency assist
--                                requests, linked to operational_cases and
--                                welfare_events (optional)
--   4. site_incidents — add case_id FK for timeline attachment
-- ============================================================================

-- ── 1. Extend operational_cases CHECK constraints ────────────────────────────

-- Drop old case_type constraint and add new one including 'site_guard'
ALTER TABLE public.operational_cases
  DROP CONSTRAINT IF EXISTS operational_cases_case_type_check;

ALTER TABLE public.operational_cases
  ADD CONSTRAINT operational_cases_case_type_check
  CHECK (case_type IN (
    'dispatch', 'patrol', 'enforcement', 'investigation', 'audit', 'site_guard'
  ));

-- Drop old created_from constraint and add new one including 'site_guard'
ALTER TABLE public.operational_cases
  DROP CONSTRAINT IF EXISTS operational_cases_created_from_check;

ALTER TABLE public.operational_cases
  ADD CONSTRAINT operational_cases_created_from_check
  CHECK (created_from IN (
    'dispatch', 'patrol', 'breach', 'observation', 'manual', 'site_guard'
  ));

COMMENT ON COLUMN public.operational_cases.case_type IS
  'Logical type of case: dispatch | patrol | enforcement | investigation | audit | site_guard';

COMMENT ON COLUMN public.operational_cases.created_from IS
  'What triggered case creation: dispatch | patrol | breach | observation | manual | site_guard';

-- ── 2. site_guard_shifts ─────────────────────────────────────────────────────
-- Records the lifecycle of a single static-guard shift at a client site,
-- linking it to an operational_case for unified timeline queries.

CREATE TABLE IF NOT EXISTS public.site_guard_shifts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id             UUID        NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,

  -- Guard context
  officer_id          UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  client_site_id      UUID        REFERENCES public.client_sites(id) ON DELETE SET NULL,
  roster_shift_id     UUID        REFERENCES public.roster_shifts(id) ON DELETE SET NULL,

  -- Shift lifecycle
  shift_start         TIMESTAMPTZ NOT NULL DEFAULT now(),
  shift_end           TIMESTAMPTZ,
  status              TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned')),

  -- Geolocation at shift start
  start_gps_lat       DOUBLE PRECISION,
  start_gps_lng       DOUBLE PRECISION,

  -- Officer notes
  briefing_notes      TEXT,
  handover_notes      TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.site_guard_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_guard_shifts_org_policy" ON public.site_guard_shifts;
CREATE POLICY "site_guard_shifts_org_policy" ON public.site_guard_shifts
  FOR ALL USING (
    organization_id = (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_site_guard_shifts_org_officer
  ON public.site_guard_shifts(organization_id, officer_id, shift_start DESC);

CREATE INDEX IF NOT EXISTS idx_site_guard_shifts_case
  ON public.site_guard_shifts(case_id);

CREATE INDEX IF NOT EXISTS idx_site_guard_shifts_site_active
  ON public.site_guard_shifts(client_site_id, status)
  WHERE status = 'active';

COMMENT ON TABLE public.site_guard_shifts IS
  'Lifecycle record for each static-guard shift at a client site, '
  'linked to an operational_case for timeline and reporting purposes.';

-- ── 3. emergency_assist_events ───────────────────────────────────────────────
-- Records one-tap emergency assist requests raised by a guard officer.
-- Links to an operational_case and optionally back-fills a welfare_events row.
-- Case status is NOT automatically closed; the supervisor resolves it.

CREATE TABLE IF NOT EXISTS public.emergency_assist_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id             UUID        NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,

  -- Who triggered it
  officer_id          UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  client_site_id      UUID        REFERENCES public.client_sites(id) ON DELETE SET NULL,

  -- Context
  assist_type         TEXT        NOT NULL DEFAULT 'emergency'
    CHECK (assist_type IN (
      'emergency', 'medical', 'aggressive_person', 'supervisor_required', 'police_required'
    )),
  severity            TEXT        NOT NULL DEFAULT 'high'
    CHECK (severity IN ('medium', 'high', 'critical')),
  description         TEXT,

  -- Location at time of trigger
  gps_lat             DOUBLE PRECISION,
  gps_lng             DOUBLE PRECISION,

  -- Optional back-link to welfare_events (if dispatcher creates one on acknowledgement)
  welfare_event_id    UUID,

  -- Resolution tracking
  acknowledged_at     TIMESTAMPTZ,
  acknowledged_by     UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,
  resolution_notes    TEXT,
  status              TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'acknowledged', 'resolved', 'false_alarm')),

  triggered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.emergency_assist_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emergency_assist_events_org_policy" ON public.emergency_assist_events;
CREATE POLICY "emergency_assist_events_org_policy" ON public.emergency_assist_events
  FOR ALL USING (
    organization_id = (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_emergency_assist_events_org_officer
  ON public.emergency_assist_events(organization_id, officer_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_emergency_assist_events_case
  ON public.emergency_assist_events(case_id);

CREATE INDEX IF NOT EXISTS idx_emergency_assist_events_active
  ON public.emergency_assist_events(organization_id, status)
  WHERE status = 'active';

COMMENT ON TABLE public.emergency_assist_events IS
  'One-tap emergency assist events raised by guard officers at a client site. '
  'Linked to the operational_case timeline. Case is NOT auto-closed; '
  'supervisor resolves the event and may update welfare records separately.';

-- ── 4. site_incidents: attach to case ────────────────────────────────────────

ALTER TABLE public.site_incidents
  ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_incidents_case
  ON public.site_incidents(case_id)
  WHERE case_id IS NOT NULL;

COMMENT ON COLUMN public.site_incidents.case_id IS
  'Optional link to an operational_case. Set when the incident is logged '
  'during an active site-guard shift so it appears on the unified timeline.';

-- ── Grants ────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.site_guard_shifts        TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.emergency_assist_events  TO authenticated;
