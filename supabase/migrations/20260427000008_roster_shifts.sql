-- Migration: Roster Shifts
-- The advance-planning roster table (InTime + Deputy style).
-- Distinct from officer_shifts (actual clock-in data) and patrols (zone-based
-- enforcement runs).  Roster shifts are the PLANNED schedule, published to
-- officers in advance and confirmed once the officer accepts.
--
-- Workflow: draft → published → confirmed → completed | cancelled
--
-- When an officer clocks in against a roster shift, the officer_shift_id FK
-- is populated, linking planned vs. actual.

CREATE TABLE IF NOT EXISTS public.roster_shifts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Shift identity
  officer_id          UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  client_site_id      UUID        REFERENCES public.client_sites(id)  ON DELETE SET NULL,
  zone_id             UUID        REFERENCES public.zones(id)          ON DELETE SET NULL,

  -- Schedule
  shift_date          DATE        NOT NULL,
  shift_type          TEXT        NOT NULL DEFAULT 'day'
                        CHECK (shift_type IN ('day', 'night', 'morning', 'afternoon', 'evening', 'custom')),
  start_time          TIMESTAMPTZ,
  end_time            TIMESTAMPTZ,
  break_minutes       INTEGER     NOT NULL DEFAULT 0,

  -- Role / skills required for this shift
  position_title      TEXT,                    -- e.g. "Patrol Officer", "Dog Handler", "Supervisor"
  required_skills     TEXT[]      DEFAULT ARRAY[]::TEXT[],  -- must match officer_skills.skill_name

  -- Lifecycle
  status              TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'confirmed', 'completed', 'cancelled')),
  published_at        TIMESTAMPTZ,
  confirmed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,

  -- Officer response
  officer_response    TEXT        CHECK (officer_response IN ('pending', 'accepted', 'declined')),
  officer_response_at TIMESTAMPTZ,
  officer_notes       TEXT,       -- Officer can leave a note when accepting/declining

  -- Conflict flags (set by the planner when saving)
  has_conflict        BOOLEAN     NOT NULL DEFAULT false,
  conflict_reason     TEXT,       -- e.g. "Officer unavailable", "Double-booked", "Skill missing"

  -- Actuals link
  officer_shift_id    UUID        REFERENCES public.officer_shifts(id) ON DELETE SET NULL,

  -- Recurrence support (generate children from a template)
  is_template         BOOLEAN     NOT NULL DEFAULT false,
  recurrence_rule     TEXT,       -- RRULE string (e.g. "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
  parent_template_id  UUID        REFERENCES public.roster_shifts(id) ON DELETE SET NULL,

  -- Notes
  notes               TEXT,
  internal_notes      TEXT,       -- Admin-only notes not visible to officer

  created_by          UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the roster planner (hot queries: week view, officer view, site view)
CREATE INDEX IF NOT EXISTS idx_roster_shifts_org_date
  ON public.roster_shifts(organization_id, shift_date, status);

CREATE INDEX IF NOT EXISTS idx_roster_shifts_officer
  ON public.roster_shifts(officer_id, shift_date) WHERE officer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roster_shifts_site
  ON public.roster_shifts(client_site_id) WHERE client_site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roster_shifts_template
  ON public.roster_shifts(parent_template_id) WHERE parent_template_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_roster_shifts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_roster_shifts_updated_at
  BEFORE UPDATE ON public.roster_shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_roster_shifts_updated_at();

ALTER TABLE public.roster_shifts ENABLE ROW LEVEL SECURITY;

-- Admins manage all roster shifts in their org
CREATE POLICY "admins manage roster_shifts"
  ON public.roster_shifts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master')
        AND up.organization_id = roster_shifts.organization_id
    )
  );

-- Officers read their own published/confirmed shifts
CREATE POLICY "officers read own roster_shifts"
  ON public.roster_shifts FOR SELECT
  USING (
    officer_id = auth.uid()
    AND status IN ('published', 'confirmed', 'completed', 'cancelled')
  );

-- Officers can respond (accept/decline) to their own published shifts
CREATE POLICY "officers respond to roster_shifts"
  ON public.roster_shifts FOR UPDATE
  USING (officer_id = auth.uid() AND status = 'published')
  WITH CHECK (officer_id = auth.uid());
