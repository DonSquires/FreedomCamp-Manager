-- ===========================================
-- SCHEDULE: OFFICER WELFARE MONITOR
-- Runs the monitor-officer-welfare edge function every minute via pg_cron.
-- Checks inactivity, GPS loss, and unacknowledged welfare alerts including
-- Man-Down escalation (Health & Safety at Work Act 2015, s36 PCBU duties).
-- NOTE: pg_cron requires Supabase Pro plan. If not available the schedule is
-- skipped but the edge function can still be triggered manually.
-- ===========================================

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron not available (requires Supabase Pro). Officer welfare monitor cron job will not be scheduled. Error: %', SQLERRM;
END $$;

-- Remove previous schedule if it exists (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor-officer-welfare') THEN
      PERFORM cron.unschedule('monitor-officer-welfare');
    END IF;

    PERFORM cron.schedule(
      'monitor-officer-welfare',
      '* * * * *',  -- Every minute
      $$
      SELECT
        net.http_post(
          url := current_setting('app.supabase_url') || '/functions/v1/monitor-officer-welfare',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
          ),
          body := '{}'::jsonb
        ) AS request_id;
      $$
    );
    RAISE NOTICE 'Scheduled monitor-officer-welfare (every minute)';
  ELSE
    RAISE WARNING 'pg_cron not available — monitor-officer-welfare cron job was NOT scheduled. Upgrade to Supabase Pro to enable scheduling.';
  END IF;
END $$;
