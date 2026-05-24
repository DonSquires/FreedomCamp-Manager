-- Auto-materialized by Bob backend fallback: performance index rollout
-- Generated because model output did not include direct file mutation content.

BEGIN;

-- Candidate 1: roster_schedules organization/time access pattern
DO $$
DECLARE
  org_col text;
  time_col text;
BEGIN
  SELECT col INTO org_col FROM (VALUES ('organization_id'), ('org_id')) AS v(col)
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roster_schedules' AND column_name = v.col
  ) LIMIT 1;
  SELECT col INTO time_col FROM (VALUES ('schedule_date'), ('scheduled_date'), ('shift_date'), ('shift_start_time'), ('start_time')) AS v(col)
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roster_schedules' AND column_name = v.col
  ) LIMIT 1;
  IF org_col IS NOT NULL AND time_col IS NOT NULL THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.roster_schedules (%I, %I)', 'idx_roster_schedules_org_time_bob_20260524', org_col, time_col);
  END IF;
END $$;

-- Candidate 2: roster_schedules officer/time dispatch pattern
DO $$
DECLARE
  officer_col text;
  time_col text;
BEGIN
  SELECT col INTO officer_col FROM (VALUES ('officer_id'), ('assigned_officer_id'), ('user_id')) AS v(col)
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roster_schedules' AND column_name = v.col
  ) LIMIT 1;
  SELECT col INTO time_col FROM (VALUES ('shift_start_time'), ('start_time'), ('scheduled_date'), ('schedule_date')) AS v(col)
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roster_schedules' AND column_name = v.col
  ) LIMIT 1;
  IF officer_col IS NOT NULL AND time_col IS NOT NULL THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.roster_schedules (%I, %I)', 'idx_roster_schedules_officer_time_bob_20260524', officer_col, time_col);
  END IF;
END $$;

-- Candidate 3: incident_reports organization/time query pattern
DO $$
DECLARE
  org_col text;
  ts_col text;
BEGIN
  SELECT col INTO org_col FROM (VALUES ('organization_id'), ('org_id')) AS v(col)
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incident_reports' AND column_name = v.col
  ) LIMIT 1;
  SELECT col INTO ts_col FROM (VALUES ('created_at'), ('reported_at'), ('incident_time'), ('occurred_at')) AS v(col)
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incident_reports' AND column_name = v.col
  ) LIMIT 1;
  IF org_col IS NOT NULL AND ts_col IS NOT NULL THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.incident_reports (%I, %I DESC)', 'idx_incident_reports_org_time_bob_20260524', org_col, ts_col);
  END IF;
END $$;

COMMIT;
