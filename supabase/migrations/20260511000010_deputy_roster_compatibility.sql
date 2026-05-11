-- ============================================================================
-- Deputy Roster Compatibility
-- Date: 2026-05-11
--
-- Adds fields required to import and round-trip Deputy's schedule / timesheet
-- export format.  Changes are additive only — existing columns are untouched.
--
-- Deputy export columns handled:
--   Employee, Employee Display Name, Employee Export Code
--   Area, Location, Location Code, Area Export Code
--   Pay Period, Schedule Start/End/Duration/Cost, Approved
--   Is Leave, Leave Type, Leave Export Code, Is Leave Paid
--   Timesheet Start/End/Duration/Cost, Employee Comment
--   Schedule Warning (stress rules), Is In Progress, Auto-Rounded
-- ============================================================================

-- ── 1. deputy_locations  ────────────────────────────────────────────────────
--
-- Lookup table that maps Deputy's area/location identifiers to client_sites.
-- Created lazily on import; admins can also manage them manually.

CREATE TABLE IF NOT EXISTS public.deputy_locations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Deputy identifiers (from export columns "Area", "Location", "Location Code", "Area Export Code")
  area_name         TEXT        NOT NULL,               -- e.g. "MPP - Central"
  location_name     TEXT        NOT NULL,               -- e.g. "Manukau"
  location_code     TEXT,                               -- e.g. "6575"
  area_export_code  TEXT,                               -- e.g. "356310000|MPP"

  -- Internal FK (nullable — admin maps after import)
  client_site_id    UUID        REFERENCES public.client_sites(id) ON DELETE SET NULL,
  zone_id           UUID        REFERENCES public.zones(id)        ON DELETE SET NULL,

  -- Deputy meta
  is_workplace      BOOLEAN     NOT NULL DEFAULT true,
  is_pay_center     BOOLEAN     NOT NULL DEFAULT false,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (organization_id, area_export_code)
);

CREATE INDEX IF NOT EXISTS idx_deputy_locations_org
  ON public.deputy_locations(organization_id);

CREATE INDEX IF NOT EXISTS idx_deputy_locations_code
  ON public.deputy_locations(organization_id, location_code)
  WHERE location_code IS NOT NULL;

ALTER TABLE public.deputy_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage deputy_locations"
  ON public.deputy_locations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master')
        AND up.organization_id = deputy_locations.organization_id
    )
  );

-- ── 2. Deputy fields on user_profiles  ──────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS deputy_employee_id   TEXT,    -- "Employee Export Code" e.g. "512060"
  ADD COLUMN IF NOT EXISTS deputy_display_name  TEXT,    -- e.g. "(N)CAS - Angel Moerua [512060]"
  ADD COLUMN IF NOT EXISTS payroll_id           TEXT,    -- external payroll reference
  ADD COLUMN IF NOT EXISTS pay_center           TEXT;    -- Deputy pay-centre name

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_deputy_employee_id
  ON public.user_profiles(organization_id, deputy_employee_id)
  WHERE deputy_employee_id IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.deputy_employee_id  IS 'Deputy "Employee Export Code" — used to match imported rows to an officer profile.';
COMMENT ON COLUMN public.user_profiles.deputy_display_name IS 'Deputy display name string, e.g. "(N)CAS - Angel Moerua [512060]".';

-- ── 3. leave_requests  ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  officer_id        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  -- Deputy leave identifiers
  leave_type_name   TEXT        NOT NULL DEFAULT '',     -- e.g. "Annual Leave (Vacation)"
  leave_export_code TEXT,                               -- e.g. "12|ANN"
  is_paid           BOOLEAN     NOT NULL DEFAULT true,

  -- Dates / times (Deputy can have partial-day leave)
  date_start        DATE        NOT NULL,
  date_end          DATE        NOT NULL,
  time_start        TIME,                               -- null = full day
  time_end          TIME,
  total_hours       NUMERIC(8, 2),
  days              NUMERIC(6, 2),

  -- Workflow
  status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  leave_comment     TEXT,                               -- officer note
  manager_comment   TEXT,                               -- admin note on approve/reject
  approved_by       UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,

  -- Import provenance
  deputy_leave_id   TEXT,                               -- Deputy's own ID if available
  deputy_imported_at TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_org_date
  ON public.leave_requests(organization_id, date_start, status);

CREATE INDEX IF NOT EXISTS idx_leave_requests_officer
  ON public.leave_requests(officer_id, date_start) WHERE officer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_requests_deputy_id
  ON public.leave_requests(organization_id, deputy_leave_id)
  WHERE deputy_leave_id IS NOT NULL;

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage leave_requests"
  ON public.leave_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master')
        AND up.organization_id = leave_requests.organization_id
    )
  );

CREATE POLICY "officers read own leave_requests"
  ON public.leave_requests FOR SELECT
  USING (officer_id = auth.uid());

CREATE POLICY "officers create own leave_requests"
  ON public.leave_requests FOR INSERT
  WITH CHECK (officer_id = auth.uid());

-- ── 4. Deputy fields on roster_shifts  ─────────────────────────────────────

ALTER TABLE public.roster_shifts
  ADD COLUMN IF NOT EXISTS deputy_schedule_id    TEXT,    -- Deputy's schedule row ID
  ADD COLUMN IF NOT EXISTS deputy_area_name      TEXT,    -- Deputy Area column
  ADD COLUMN IF NOT EXISTS deputy_location_name  TEXT,    -- Deputy Location column
  ADD COLUMN IF NOT EXISTS location_code         TEXT,    -- Deputy Location Code (numeric)
  ADD COLUMN IF NOT EXISTS area_export_code      TEXT,    -- Deputy Area Export Code
  ADD COLUMN IF NOT EXISTS schedule_warning      TEXT,    -- Stress-rule text from Deputy
  ADD COLUMN IF NOT EXISTS schedule_cost         NUMERIC(12, 4),  -- Deputy computed cost
  ADD COLUMN IF NOT EXISTS pay_period_name       TEXT,    -- e.g. "Weekly Mon-Sun"
  ADD COLUMN IF NOT EXISTS deputy_approved       BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deputy_imported_at    TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_roster_shifts_deputy_schedule_id
  ON public.roster_shifts(organization_id, deputy_schedule_id)
  WHERE deputy_schedule_id IS NOT NULL;

COMMENT ON COLUMN public.roster_shifts.deputy_schedule_id IS 'Deputy schedule row identifier — used for upsert de-duplication on re-import.';
COMMENT ON COLUMN public.roster_shifts.schedule_warning   IS 'Deputy stress-rule violation text, displayed as a warning indicator on the shift card.';

-- ── 5. Deputy fields on officer_shifts (timesheets)  ───────────────────────

ALTER TABLE public.officer_shifts
  ADD COLUMN IF NOT EXISTS employee_comment     TEXT,
  ADD COLUMN IF NOT EXISTS auto_rounded         BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exported             BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid                 BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pay_approved         BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_in_progress       BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discarded            BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timesheet_cost       NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS real_time            BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_time_approved   BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS validation_flag      TEXT,    -- e.g. "early_start", "late_end", "no_break"
  ADD COLUMN IF NOT EXISTS deputy_timesheet_id  TEXT,    -- Deputy's timesheet row ID
  ADD COLUMN IF NOT EXISTS deputy_imported_at   TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_officer_shifts_deputy_timesheet_id
  ON public.officer_shifts(organization_id, deputy_timesheet_id)
  WHERE deputy_timesheet_id IS NOT NULL;

COMMENT ON COLUMN public.officer_shifts.deputy_timesheet_id IS 'Deputy timesheet row identifier — used for upsert de-duplication on re-import.';

DO $$
BEGIN
  RAISE NOTICE '✅ deputy_locations table created';
  RAISE NOTICE '✅ user_profiles: deputy_employee_id, deputy_display_name, payroll_id, pay_center added';
  RAISE NOTICE '✅ leave_requests table created';
  RAISE NOTICE '✅ roster_shifts: deputy fields added';
  RAISE NOTICE '✅ officer_shifts: deputy timesheet fields added';
END $$;
