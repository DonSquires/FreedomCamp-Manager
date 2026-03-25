-- Migration: WelfareFirst-inspired lone-worker features
--
-- 1. Adds `sos` to the officer_welfare_alerts alert_type constraint
--    (the UI component OfficerWelfareWarningModal already references this type
--     but the DB constraint was missing it)
-- 2. Adds `check_in_interval_minutes` to officer_welfare_settings so admins
--    can configure how often officers must tap "I'm OK"
-- 3. Creates welfare_checkins table for the proactive check-in audit trail
-- 4. Adds post-shift feedback columns to officer_shifts (Deputy-style mood check)

-- ── 1. Add SOS to the alert_type CHECK constraint ─────────────────────────────
-- Drop and recreate because PostgreSQL cannot ADD a value to an inline CHECK.
ALTER TABLE public.officer_welfare_alerts
  DROP CONSTRAINT IF EXISTS officer_welfare_alerts_alert_type_check;

ALTER TABLE public.officer_welfare_alerts
  ADD CONSTRAINT officer_welfare_alerts_alert_type_check
  CHECK (alert_type IN (
    'inactivity',
    'gps_lost',
    'manual',
    'investigation_overdue',
    'man_down',
    'sos'
  ));

-- ── 2. Check-in interval on welfare settings ──────────────────────────────────
-- How many minutes may elapse between "I'm OK" taps before admin is alerted.
-- 0 = disabled (no scheduled check-in required).
ALTER TABLE public.officer_welfare_settings
  ADD COLUMN IF NOT EXISTS check_in_interval_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (check_in_interval_minutes >= 0);

-- ── 3. welfare_checkins – proactive I'm-OK audit trail ────────────────────────
-- Every time an officer taps "I'm OK" the app inserts a row here.
-- This gives a full, auditable timeline of welfare confirmations for the shift,
-- matching WelfareFirst's "check-in history" requirement.

CREATE TABLE IF NOT EXISTS public.welfare_checkins (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id        UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  officer_shift_id  UUID        REFERENCES public.officer_shifts(id) ON DELETE SET NULL,
  checked_in_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- GPS at time of check-in
  gps_latitude      NUMERIC(10, 8),
  gps_longitude     NUMERIC(11, 8),
  gps_accuracy      NUMERIC(10, 2),
  -- Was this check-in late relative to the configured interval?
  is_overdue        BOOLEAN     NOT NULL DEFAULT false,
  overdue_minutes   INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_welfare_checkins_officer_shift
  ON public.welfare_checkins(officer_id, officer_shift_id, checked_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_welfare_checkins_org
  ON public.welfare_checkins(organization_id, checked_in_at DESC);

ALTER TABLE public.welfare_checkins ENABLE ROW LEVEL SECURITY;

-- Officers can read and insert their own check-ins
CREATE POLICY "officers manage own welfare_checkins"
  ON public.welfare_checkins
  FOR ALL
  USING (officer_id = auth.uid());

-- Admins can read all check-ins for their organisation
CREATE POLICY "admins read org welfare_checkins"
  ON public.welfare_checkins
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master')
        AND up.organization_id = welfare_checkins.organization_id
    )
  );

-- ── 4. Post-shift feedback on officer_shifts (Deputy-style mood check) ─────────
-- Officers rate their shift (1–5) and optionally leave a note when it ends.
-- Admins can view aggregate mood on the PatrolKPIDashboard.
ALTER TABLE public.officer_shifts
  ADD COLUMN IF NOT EXISTS shift_rating   INTEGER CHECK (shift_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS shift_feedback TEXT;
