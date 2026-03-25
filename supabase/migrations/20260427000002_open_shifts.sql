-- Migration: Open Shifts – Deputy-style shift marketplace
-- Admins post shifts that need coverage; officers claim them from the field
-- officer portal.  Claimed shifts are linked to the resulting officer_shift.

CREATE TABLE IF NOT EXISTS public.open_shifts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zone_id         UUID        REFERENCES public.zones(id) ON DELETE SET NULL,
  shift_date      DATE        NOT NULL,
  shift_type      TEXT        NOT NULL DEFAULT 'day'
                    CHECK (shift_type IN ('day', 'night', 'custom')),
  start_time      TIMESTAMPTZ,
  end_time        TIMESTAMPTZ,
  title           TEXT        NOT NULL,
  description     TEXT,
  requirements    TEXT,
  priority        TEXT        NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status          TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'filled', 'cancelled')),
  -- Officer who claimed this shift
  claimed_by      UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  claimed_at      TIMESTAMPTZ,
  -- Resulting officer_shift record once the officer clocks on
  officer_shift_id UUID       REFERENCES public.officer_shifts(id) ON DELETE SET NULL,
  created_by      UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_open_shifts_org_status
  ON public.open_shifts(organization_id, status, shift_date);

CREATE INDEX IF NOT EXISTS idx_open_shifts_claimed_by
  ON public.open_shifts(claimed_by) WHERE claimed_by IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_open_shifts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_open_shifts_updated_at
  BEFORE UPDATE ON public.open_shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_open_shifts_updated_at();

-- RLS
ALTER TABLE public.open_shifts ENABLE ROW LEVEL SECURITY;

-- Admins can do everything within their organisation
CREATE POLICY "admins manage open_shifts"
  ON public.open_shifts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master')
        AND up.organization_id = open_shifts.organization_id
    )
  );

-- Officers (and admin_officer acting as officer) can read open shifts for
-- their organisation and claim them (update status + claimed_by).
CREATE POLICY "officers read open_shifts"
  ON public.open_shifts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('officer', 'admin_officer')
        AND up.organization_id = open_shifts.organization_id
    )
  );

CREATE POLICY "officers claim open_shifts"
  ON public.open_shifts
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('officer', 'admin_officer')
        AND up.organization_id = open_shifts.organization_id
    )
  )
  WITH CHECK (
    -- Officers may only update the status/claimed_by columns (not title, dates, etc.)
    status IN ('open', 'filled')
  );
