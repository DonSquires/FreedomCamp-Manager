-- ===========================================
-- PATROL SCHEDULE ENHANCEMENTS & KPI TRACKING
--
-- Extends the patrols table with scheduled time windows,
-- actual start/end times, duration metrics, and a multi-zone
-- schedule junction table. Adds an RPC for patrol KPIs.
-- ===========================================

-- ─── 0. Guard: ensure officer_shifts exists ──────────────────────────────
-- Migration 20260409000000 should have created this table, but in some
-- environments the migration history was repaired without executing the SQL.
-- This guard ensures the table exists before we add a FK reference to it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'officer_shifts'
  ) THEN
    CREATE TABLE public.officer_shifts (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      officer_id      UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
      organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
      parent_zone_id  UUID        REFERENCES public.zones(id) ON DELETE SET NULL,
      started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at        TIMESTAMPTZ,
      end_reason      TEXT        CHECK (end_reason IN ('logout', 'app_timeout', 'manual', 'zone_exit')),
      gps_start_lat   DOUBLE PRECISION,
      gps_start_lng   DOUBLE PRECISION,
      gps_end_lat     DOUBLE PRECISION,
      gps_end_lng     DOUBLE PRECISION,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_officer_shifts_officer
      ON public.officer_shifts(officer_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_officer_shifts_org
      ON public.officer_shifts(organization_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_officer_shifts_active
      ON public.officer_shifts(officer_id) WHERE ended_at IS NULL;

    ALTER TABLE public.officer_shifts ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "officers_read_own_shifts"
      ON public.officer_shifts FOR SELECT TO authenticated
      USING (officer_id = auth.uid());

    CREATE POLICY "officers_insert_own_shift"
      ON public.officer_shifts FOR INSERT TO authenticated
      WITH CHECK (officer_id = auth.uid());

    CREATE POLICY "officers_update_own_shift"
      ON public.officer_shifts FOR UPDATE TO authenticated
      USING (officer_id = auth.uid());

    CREATE POLICY "admins_read_org_shifts"
      ON public.officer_shifts FOR SELECT TO authenticated
      USING (
        organization_id IN (
          SELECT organization_id FROM public.user_profiles
          WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
        )
      );

    DROP TRIGGER IF EXISTS update_officer_shifts_updated_at ON public.officer_shifts;
    CREATE TRIGGER update_officer_shifts_updated_at
      BEFORE UPDATE ON public.officer_shifts
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ─── 1. Add scheduling & timing columns to patrols ─────────────────────

ALTER TABLE patrols
  ADD COLUMN IF NOT EXISTS scheduled_start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS recurrence TEXT DEFAULT 'none'
    CHECK (recurrence IN ('none', 'daily', 'weekly', 'fortnightly', 'monthly')),
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES officer_shifts(id) ON DELETE SET NULL;

COMMENT ON COLUMN patrols.scheduled_start_time IS 'Admin-set expected start time';
COMMENT ON COLUMN patrols.scheduled_end_time IS 'Admin-set expected end time';
COMMENT ON COLUMN patrols.actual_start_time IS 'Recorded when officer starts patrol';
COMMENT ON COLUMN patrols.actual_end_time IS 'Recorded when patrol completes';
COMMENT ON COLUMN patrols.duration_minutes IS 'Computed actual duration in minutes';
COMMENT ON COLUMN patrols.description IS 'Free-text description or special instructions';
COMMENT ON COLUMN patrols.priority IS 'Patrol priority level';
COMMENT ON COLUMN patrols.recurrence IS 'Schedule recurrence pattern';
COMMENT ON COLUMN patrols.shift_id IS 'Links to officer_shifts for shift-based tracking';

CREATE INDEX IF NOT EXISTS idx_patrols_schedule
  ON patrols(organization_id, patrol_date, scheduled_start_time);

CREATE INDEX IF NOT EXISTS idx_patrols_shift
  ON patrols(shift_id) WHERE shift_id IS NOT NULL;

-- ─── 2. Patrol schedule zones (multi-zone patrol routes) ────────────────

CREATE TABLE IF NOT EXISTS patrol_schedule_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_id UUID NOT NULL REFERENCES patrols(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  visit_order INTEGER NOT NULL DEFAULT 0,
  estimated_duration_minutes INTEGER,
  actual_duration_minutes INTEGER,
  visited_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (patrol_id, zone_id)
);

CREATE INDEX IF NOT EXISTS idx_patrol_schedule_zones_patrol
  ON patrol_schedule_zones(patrol_id, visit_order);
CREATE INDEX IF NOT EXISTS idx_patrol_schedule_zones_zone
  ON patrol_schedule_zones(zone_id);

COMMENT ON TABLE patrol_schedule_zones
  IS 'Ordered list of zones assigned to a patrol. Tracks estimated vs actual visit durations.';

-- ─── 3. RLS for patrol_schedule_zones ───────────────────────────────────

ALTER TABLE patrol_schedule_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_patrol_zones"
  ON patrol_schedule_zones FOR SELECT
  TO authenticated
  USING (
    patrol_id IN (
      SELECT p.id FROM patrols p
      JOIN user_profiles up ON up.organization_id = p.organization_id
      WHERE up.id = auth.uid()
    )
  );

CREATE POLICY "admins_manage_patrol_zones"
  ON patrol_schedule_zones FOR ALL
  TO authenticated
  USING (
    patrol_id IN (
      SELECT p.id FROM patrols p
      JOIN user_profiles up ON up.organization_id = p.organization_id
        AND up.role IN ('admin', 'admin_officer', 'master')
      WHERE up.id = auth.uid()
    )
  )
  WITH CHECK (
    patrol_id IN (
      SELECT p.id FROM patrols p
      JOIN user_profiles up ON up.organization_id = p.organization_id
        AND up.role IN ('admin', 'admin_officer', 'master')
      WHERE up.id = auth.uid()
    )
  );

CREATE POLICY "officers_update_own_patrol_zones"
  ON patrol_schedule_zones FOR UPDATE
  TO authenticated
  USING (
    patrol_id IN (
      SELECT p.id FROM patrols p WHERE p.assigned_to = auth.uid()
    )
  );

-- ─── 4. Patrol KPI / statistics RPC ────────────────────────────────────

CREATE OR REPLACE FUNCTION get_patrol_kpis(
  p_organization_id UUID,
  p_from TIMESTAMPTZ DEFAULT (now() - interval '30 days'),
  p_to TIMESTAMPTZ DEFAULT now(),
  p_officer_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_total_patrols INTEGER;
  v_completed INTEGER;
  v_scheduled INTEGER;
  v_in_progress INTEGER;
  v_cancelled INTEGER;
  v_avg_duration NUMERIC;
  v_total_vehicles INTEGER;
  v_total_breaches INTEGER;
  v_total_site_visits INTEGER;
  v_avg_site_visit_minutes NUMERIC;
  v_total_shift_hours NUMERIC;
  v_on_time_starts INTEGER;
  v_late_starts INTEGER;
  v_officer_stats JSONB;
BEGIN
  -- Patrol counts
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'completed'),
    count(*) FILTER (WHERE status = 'scheduled'),
    count(*) FILTER (WHERE status IN ('in_progress', 'active')),
    count(*) FILTER (WHERE status = 'cancelled'),
    coalesce(avg(duration_minutes) FILTER (WHERE duration_minutes IS NOT NULL), 0),
    coalesce(sum(vehicles_checked), 0),
    coalesce(sum(breaches_found), 0),
    count(*) FILTER (WHERE actual_start_time IS NOT NULL
      AND scheduled_start_time IS NOT NULL
      AND actual_start_time <= scheduled_start_time + interval '15 minutes'),
    count(*) FILTER (WHERE actual_start_time IS NOT NULL
      AND scheduled_start_time IS NOT NULL
      AND actual_start_time > scheduled_start_time + interval '15 minutes')
  INTO
    v_total_patrols, v_completed, v_scheduled, v_in_progress, v_cancelled,
    v_avg_duration, v_total_vehicles, v_total_breaches,
    v_on_time_starts, v_late_starts
  FROM patrols
  WHERE organization_id = p_organization_id
    AND created_at BETWEEN p_from AND p_to
    AND (p_officer_id IS NULL OR assigned_to = p_officer_id);

  -- Site visit counts
  SELECT
    count(*),
    coalesce(avg(EXTRACT(EPOCH FROM (exited_at - entered_at)) / 60) FILTER (WHERE exited_at IS NOT NULL), 0)
  INTO v_total_site_visits, v_avg_site_visit_minutes
  FROM patrol_site_visits
  WHERE organization_id = p_organization_id
    AND entered_at BETWEEN p_from AND p_to
    AND (p_officer_id IS NULL OR officer_id = p_officer_id);

  -- Shift hours
  SELECT coalesce(sum(EXTRACT(EPOCH FROM (coalesce(ended_at, now()) - started_at)) / 3600), 0)
  INTO v_total_shift_hours
  FROM officer_shifts
  WHERE organization_id = p_organization_id
    AND started_at BETWEEN p_from AND p_to
    AND (p_officer_id IS NULL OR officer_id = p_officer_id);

  -- Per-officer breakdown
  SELECT coalesce(jsonb_agg(officer_row), '[]'::jsonb)
  INTO v_officer_stats
  FROM (
    SELECT jsonb_build_object(
      'officer_id', up.id,
      'officer_name', up.first_name || ' ' || up.last_name,
      'total_patrols', count(p.id),
      'completed_patrols', count(p.id) FILTER (WHERE p.status = 'completed'),
      'avg_duration_minutes', coalesce(avg(p.duration_minutes) FILTER (WHERE p.duration_minutes IS NOT NULL), 0),
      'vehicles_checked', coalesce(sum(p.vehicles_checked), 0),
      'breaches_found', coalesce(sum(p.breaches_found), 0),
      'shift_hours', coalesce((
        SELECT sum(EXTRACT(EPOCH FROM (coalesce(s.ended_at, now()) - s.started_at)) / 3600)
        FROM officer_shifts s
        WHERE s.officer_id = up.id
          AND s.organization_id = p_organization_id
          AND s.started_at BETWEEN p_from AND p_to
      ), 0),
      'site_visits', coalesce((
        SELECT count(*)
        FROM patrol_site_visits sv
        WHERE sv.officer_id = up.id
          AND sv.organization_id = p_organization_id
          AND sv.entered_at BETWEEN p_from AND p_to
      ), 0)
    ) AS officer_row
    FROM user_profiles up
    LEFT JOIN patrols p ON p.assigned_to = up.id
      AND p.organization_id = p_organization_id
      AND p.created_at BETWEEN p_from AND p_to
    WHERE up.organization_id = p_organization_id
      AND up.role IN ('officer', 'admin_officer')
      AND (p_officer_id IS NULL OR up.id = p_officer_id)
    GROUP BY up.id, up.first_name, up.last_name
  ) sub;

  v_result := jsonb_build_object(
    'period_from', p_from,
    'period_to', p_to,
    'total_patrols', v_total_patrols,
    'completed', v_completed,
    'scheduled', v_scheduled,
    'in_progress', v_in_progress,
    'cancelled', v_cancelled,
    'completion_rate', CASE WHEN v_total_patrols > 0
      THEN round((v_completed::numeric / v_total_patrols) * 100, 1) ELSE 0 END,
    'avg_duration_minutes', round(v_avg_duration, 1),
    'total_vehicles_checked', v_total_vehicles,
    'total_breaches_found', v_total_breaches,
    'total_site_visits', v_total_site_visits,
    'avg_site_visit_minutes', round(v_avg_site_visit_minutes, 1),
    'total_shift_hours', round(v_total_shift_hours, 1),
    'on_time_starts', v_on_time_starts,
    'late_starts', v_late_starts,
    'punctuality_rate', CASE WHEN (v_on_time_starts + v_late_starts) > 0
      THEN round((v_on_time_starts::numeric / (v_on_time_starts + v_late_starts)) * 100, 1)
      ELSE 100 END,
    'officers', v_officer_stats
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_patrol_kpis TO authenticated;

COMMENT ON FUNCTION get_patrol_kpis
  IS 'Returns patrol KPI metrics: completion rate, avg duration, punctuality, vehicles checked, officer breakdown.';
