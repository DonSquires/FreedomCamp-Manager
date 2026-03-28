-- ──────────────────────────────────────────────────────────────────────────────
-- Web Push subscriptions + welfare reminder scheduling
-- ──────────────────────────────────────────────────────────────────────────────
-- Adds:
--   1. push_subscription (jsonb) column on user_profiles  → stores the full
--      Web Push PushSubscription JSON (endpoint + keys) so the edge function
--      can send VAPID-signed push messages to the browser even when closed.
--   2. welfare_push_schedule table → one row per active shift; tracks when the
--      next push reminder should fire so the cron function can batch-process.
--   3. pg_cron job (if extension is available) calling send-welfare-reminders
--      every 2 minutes.
--   4. Roster-posted trigger → pushes a notification when a new shift row is
--      inserted for an officer.
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. push_subscription column on user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS push_subscription jsonb DEFAULT NULL;

COMMENT ON COLUMN user_profiles.push_subscription IS
  'Serialised Web Push API PushSubscription JSON: {endpoint, keys:{p256dh,auth}}. '
  'Stored instead of (or alongside) push_token so the edge function can send '
  'VAPID-encrypted browser push messages.';

-- 2. welfare_push_schedule table
CREATE TABLE IF NOT EXISTS welfare_push_schedule (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id          uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  organization_id     uuid NOT NULL,
  shift_id            uuid,                -- officer_shifts.id (nullable — pre-shift)
  interval_minutes    integer NOT NULL DEFAULT 30,
  last_checkin_at     timestamptz,
  next_reminder_at    timestamptz,         -- NULL = scheduler not yet computed
  -- alert states: prevent duplicate fires per cycle
  alert_10min_sent    boolean NOT NULL DEFAULT false,
  alert_5min_sent     boolean NOT NULL DEFAULT false,
  overdue_sent        boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wps_officer   ON welfare_push_schedule(officer_id);
CREATE INDEX IF NOT EXISTS idx_wps_active    ON welfare_push_schedule(is_active, next_reminder_at)
  WHERE is_active = true;

COMMENT ON TABLE welfare_push_schedule IS
  'One active row per officer shift. The send-welfare-reminders edge function '
  'polls this table every ~2 minutes and sends web push for 10-min, 5-min, '
  'and overdue welfare check-in alerts.';

-- RLS
ALTER TABLE welfare_push_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY wps_officer_own ON welfare_push_schedule
  FOR ALL USING (officer_id = auth.uid());

CREATE POLICY wps_admin_org ON welfare_push_schedule
  FOR SELECT USING (
    get_user_role(auth.uid()) IN ('admin','master','grand_master')
    AND organization_id = get_user_organization_id(auth.uid())
  );

-- 3. Helper: upsert welfare schedule (called from edge functions / client)
CREATE OR REPLACE FUNCTION upsert_welfare_push_schedule(
  p_officer_id       uuid,
  p_organization_id  uuid,
  p_shift_id         uuid,
  p_interval_minutes integer,
  p_last_checkin_at  timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_next timestamptz;
BEGIN
  IF p_interval_minutes > 0 AND p_last_checkin_at IS NOT NULL THEN
    v_next := p_last_checkin_at + (p_interval_minutes * interval '1 minute');
  ELSE
    v_next := NULL;
  END IF;

  INSERT INTO welfare_push_schedule (
    officer_id, organization_id, shift_id,
    interval_minutes, last_checkin_at, next_reminder_at,
    alert_10min_sent, alert_5min_sent, overdue_sent,
    is_active, updated_at
  ) VALUES (
    p_officer_id, p_organization_id, p_shift_id,
    p_interval_minutes, p_last_checkin_at, v_next,
    false, false, false,
    true, now()
  )
  ON CONFLICT (officer_id) WHERE is_active = true
  DO UPDATE SET
    shift_id         = EXCLUDED.shift_id,
    interval_minutes = EXCLUDED.interval_minutes,
    last_checkin_at  = EXCLUDED.last_checkin_at,
    next_reminder_at = EXCLUDED.next_reminder_at,
    alert_10min_sent = false,
    alert_5min_sent  = false,
    overdue_sent     = false,
    updated_at       = now();
END;
$$;

-- Unique partial index so ON CONFLICT works
CREATE UNIQUE INDEX IF NOT EXISTS idx_wps_officer_active
  ON welfare_push_schedule(officer_id)
  WHERE is_active = true;

-- 4. Roster-posted push trigger
--    Fires when a new roster_shifts row is inserted for a specific officer.
CREATE OR REPLACE FUNCTION notify_officer_shift_posted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_officer_id uuid;
BEGIN
  -- roster_shifts may use 'officer_id' or 'user_id' depending on schema version
  v_officer_id := COALESCE(
    (NEW::jsonb)->>'officer_id',
    (NEW::jsonb)->>'user_id'
  )::uuid;

  IF v_officer_id IS NULL THEN RETURN NEW; END IF;

  -- Insert a notification row (picked up by the client's realtime subscription)
  INSERT INTO notifications (
    user_id, title, body, type, priority, data, created_at
  ) VALUES (
    v_officer_id,
    'New shift available',
    'A shift has been posted for you. Tap to view your roster.',
    'shift_posted',
    'high',
    jsonb_build_object('shift_id', NEW.id, 'url', '/roster'),
    now()
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- Attach trigger to roster_shifts if the table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'roster_shifts') THEN
    DROP TRIGGER IF EXISTS trg_notify_shift_posted ON roster_shifts;
    CREATE TRIGGER trg_notify_shift_posted
      AFTER INSERT ON roster_shifts
      FOR EACH ROW EXECUTE FUNCTION notify_officer_shift_posted();
  END IF;
END $$;

-- 5. Optional pg_cron: run send-welfare-reminders every 2 minutes
--    Wrapped in a DO block so it silently skips if pg_cron is not installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'welfare-push-reminders',
      '*/2 * * * *',
      $$
        SELECT net.http_post(
          url := current_setting('app.supabase_url') || '/functions/v1/send-welfare-reminders',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || current_setting('app.service_role_key')
          ),
          body := '{}'::jsonb
        )
      $$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron not available; welfare reminders will rely on client-side timers
END $$;
