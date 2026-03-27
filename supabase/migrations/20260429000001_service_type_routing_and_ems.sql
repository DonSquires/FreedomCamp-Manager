-- ============================================================================
-- Roster-Driven Portal Routing, Multi-Service Dashboard &
-- Officer Activity Rates + EMS Attendances
-- Date: 2026-04-29
--
-- Changes:
--   1. roster_shifts  — adds service_type so the portal knows where to route
--   2. officer_shifts — links back to planned roster shift, stores service_type
--                       and the client org the officer is working for
--   3. user_profiles  — enabled_portals TEXT[] for multi-service dashboard
--   4. officer_activity_rates — per-officer pay rate overrides per activity
--   5. ems_attendances — Electronic Monitoring Services attendance log
-- ============================================================================

-- ── 1. roster_shifts: service_type ───────────────────────────────────────────

ALTER TABLE public.roster_shifts
  ADD COLUMN IF NOT EXISTS service_type TEXT
    CHECK (service_type IN (
      'freedom_camping', 'guarding', 'parking', 'noise',
      'patrol', 'alarm_response', 'ems'
    ));

COMMENT ON COLUMN public.roster_shifts.service_type IS
  'The service portal this shift maps to. Drives auto-routing on officer login.';

-- ── 2. officer_shifts: link to roster + service context ──────────────────────

ALTER TABLE public.officer_shifts
  ADD COLUMN IF NOT EXISTS roster_shift_id  UUID
    REFERENCES public.roster_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_type     TEXT
    CHECK (service_type IN (
      'freedom_camping', 'guarding', 'parking', 'noise',
      'patrol', 'alarm_response', 'ems'
    )),
  ADD COLUMN IF NOT EXISTS client_org_id    UUID
    REFERENCES public.organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.officer_shifts.roster_shift_id IS
  'Links the actual clock-in back to the planned roster_shifts row.';
COMMENT ON COLUMN public.officer_shifts.service_type IS
  'Copied from the roster_shifts.service_type on shift start. Used for payroll rate selection.';
COMMENT ON COLUMN public.officer_shifts.client_org_id IS
  'The client organisation this officer is working for during this shift. Copied from roster.';

CREATE INDEX IF NOT EXISTS idx_officer_shifts_roster
  ON public.officer_shifts(roster_shift_id) WHERE roster_shift_id IS NOT NULL;

-- ── 3. user_profiles: enabled_portals array ──────────────────────────────────
-- Controls which portal tiles are shown on the multi-service dashboard.
-- Defaults to freedom_camping so existing officers see the same UI.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS enabled_portals  TEXT[]
    NOT NULL DEFAULT ARRAY['freedom_camping']::TEXT[];

COMMENT ON COLUMN public.user_profiles.enabled_portals IS
  'List of service portals this officer has access to. Controls dashboard tiles.
   Valid values: freedom_camping, guarding, parking, noise, patrol, alarm_response, ems.';

-- ── 4. officer_activity_rates ─────────────────────────────────────────────────
-- Per-officer pay rate overrides. When an officer performs a specific activity
-- (e.g. alarm_response) their actual rate may differ from the base roster rate.

CREATE TABLE IF NOT EXISTS public.officer_activity_rates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id      UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  activity_type   TEXT        NOT NULL
    CHECK (activity_type IN (
      'freedom_camping', 'guarding', 'parking', 'noise',
      'patrol', 'alarm_response', 'ems', 'travel', 'overtime'
    )),

  rate_per_hour   NUMERIC(10, 4) NOT NULL,

  -- Date-range allows rate history and upcoming rate changes
  effective_from  DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,

  notes           TEXT,
  created_by      UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_officer_activity_rate
    UNIQUE (officer_id, activity_type, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_officer_activity_rates_officer
  ON public.officer_activity_rates(officer_id, activity_type);

ALTER TABLE public.officer_activity_rates ENABLE ROW LEVEL SECURITY;

-- Admins manage all rates in their org
DROP POLICY IF EXISTS "admins_manage_officer_activity_rates" ON public.officer_activity_rates;
CREATE POLICY "admins_manage_officer_activity_rates"
  ON public.officer_activity_rates FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Officers can read their own rates
DROP POLICY IF EXISTS "officers_read_own_activity_rates" ON public.officer_activity_rates;
CREATE POLICY "officers_read_own_activity_rates"
  ON public.officer_activity_rates FOR SELECT
  TO authenticated
  USING (officer_id = auth.uid());

-- ── 5. ems_attendances ────────────────────────────────────────────────────────
-- Electronic Monitoring Services attendance log.
-- Officers attend offenders (tagged with a de-identified reference) to
-- fit, remove, or check electronic monitoring devices (ankle trackers).
-- Rates vary by officer seniority level.

CREATE TABLE IF NOT EXISTS public.ems_attendances (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  officer_id            UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,

  -- Scheduling link
  roster_shift_id       UUID        REFERENCES public.roster_shifts(id) ON DELETE SET NULL,
  officer_shift_id      UUID        REFERENCES public.officer_shifts(id) ON DELETE SET NULL,

  -- Attendance details
  attendance_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  action                TEXT        NOT NULL
    CHECK (action IN ('fit', 'remove', 'check', 'escort', 'emergency_remove')),
  start_time            TIMESTAMPTZ,
  end_time              TIMESTAMPTZ,

  -- Location (address only — no precise GPS to protect offender privacy)
  attendance_address    TEXT,
  district              TEXT,

  -- Device / offender (de-identified — no PII directly stored)
  offender_ref          TEXT,       -- anonymised case reference
  device_serial         TEXT,
  device_type           TEXT        CHECK (device_type IN ('ankle_tracker', 'gps_unit', 'alcohol_monitor', 'other')),

  -- Travel
  travel_km             NUMERIC(8, 2) DEFAULT 0,
  travel_rate_per_km    NUMERIC(10, 4),

  -- Payroll
  officer_seniority_level INTEGER   NOT NULL DEFAULT 1
    CHECK (officer_seniority_level BETWEEN 1 AND 5),
  rate_per_hour         NUMERIC(10, 4),
  billable_hours        NUMERIC(6, 2),

  -- Status
  status                TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  approved_by           UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,
  admin_notes           TEXT,

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ems_attendances_officer
  ON public.ems_attendances(officer_id, attendance_date DESC);

CREATE INDEX IF NOT EXISTS idx_ems_attendances_org_date
  ON public.ems_attendances(organization_id, attendance_date DESC);

CREATE OR REPLACE FUNCTION public.update_ems_attendances_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_ems_attendances_updated_at
  BEFORE UPDATE ON public.ems_attendances
  FOR EACH ROW EXECUTE FUNCTION public.update_ems_attendances_updated_at();

ALTER TABLE public.ems_attendances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_ems_attendances" ON public.ems_attendances;
CREATE POLICY "admins_manage_ems_attendances"
  ON public.ems_attendances FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

DROP POLICY IF EXISTS "officers_manage_own_ems" ON public.ems_attendances;
CREATE POLICY "officers_manage_own_ems"
  ON public.ems_attendances FOR ALL
  TO authenticated
  USING (officer_id = auth.uid())
  WITH CHECK (officer_id = auth.uid() AND status = 'draft');

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260429000001 complete:';
  RAISE NOTICE '   roster_shifts.service_type added';
  RAISE NOTICE '   officer_shifts.roster_shift_id, service_type, client_org_id added';
  RAISE NOTICE '   user_profiles.enabled_portals added (default: [freedom_camping])';
  RAISE NOTICE '   officer_activity_rates table created';
  RAISE NOTICE '   ems_attendances table created';
END $$;
