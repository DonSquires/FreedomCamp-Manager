-- Migration: Officer Availability
-- Officers declare when they are available or unavailable to work.
-- Supports both recurring weekly patterns (day_of_week) and specific date blocks.
-- The Roster Planner uses this to flag conflicts when scheduling.

CREATE TABLE IF NOT EXISTS public.officer_availability (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id      UUID    NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id UUID    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Recurring pattern OR specific date (one or the other must be set)
  day_of_week     SMALLINT CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun … 6=Sat; NULL = specific date
  specific_date   DATE,

  -- Time window (NULL = all day)
  available_from  TIME,
  available_to    TIME,

  -- TRUE = available during this slot; FALSE = unavailable (leave, training, etc.)
  is_available    BOOLEAN NOT NULL DEFAULT true,

  -- Reason for unavailability (annual leave, sick, training, personal, etc.)
  unavailability_reason TEXT CHECK (unavailability_reason IN (
    'annual_leave', 'sick_leave', 'training', 'personal',
    'public_holiday', 'lieu_day', 'other'
  )),

  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Cannot have both recurring and specific-date
  CONSTRAINT chk_availability_type CHECK (
    (day_of_week IS NOT NULL AND specific_date IS NULL)
    OR (day_of_week IS NULL AND specific_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_officer_avail_officer  ON public.officer_availability(officer_id);
CREATE INDEX IF NOT EXISTS idx_officer_avail_org      ON public.officer_availability(organization_id);
CREATE INDEX IF NOT EXISTS idx_officer_avail_date     ON public.officer_availability(specific_date) WHERE specific_date IS NOT NULL;

ALTER TABLE public.officer_availability ENABLE ROW LEVEL SECURITY;

-- Officers manage their own availability
CREATE POLICY "officers manage own availability"
  ON public.officer_availability FOR ALL
  USING (officer_id = auth.uid());

-- Admins can read all availability in their org
CREATE POLICY "admins read org availability"
  ON public.officer_availability FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master')
        AND up.organization_id = officer_availability.organization_id
    )
  );
