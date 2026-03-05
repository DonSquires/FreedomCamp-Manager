-- ===========================================
-- SCHEDULE: OFFICER WELFARE MONITOR
-- Runs the monitor-officer-welfare edge function every minute via pg_cron.
-- Checks inactivity, GPS loss, and unacknowledged welfare alerts including
-- Man-Down escalation (Health & Safety at Work Act 2015, s36 PCBU duties).
-- ===========================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove previous schedule if it exists (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor-officer-welfare') THEN
    PERFORM cron.unschedule('monitor-officer-welfare');
  END IF;
END $$;

SELECT cron.schedule(
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
