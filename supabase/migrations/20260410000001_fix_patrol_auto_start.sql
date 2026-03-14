-- ============================================================================
-- Fix: Patrol auto-start failures and missing patrols schema columns
-- Date: 2026-04-10
--
-- Problems:
--   1. "Failed to start patrol automatically"
--      Root cause: notify_patrol_assignment BEFORE INSERT trigger calls
--      send_push_via_edge_function() which is not defined as a SQL function.
--      Any INSERT into patrols where assigned_to IS NOT NULL triggers the
--      function → PostgreSQL throws "function send_push_via_edge_function
--      does not exist" → the INSERT is rolled back → the client sees
--      "Failed to start patrol automatically".
--
--   2. Missing columns on patrols table referenced by frontend hooks and
--      patrol counter RPCs (vehicles_checked, breaches_found, started_at,
--      ended_at).  Without these columns updates via useStartPatrol /
--      useCompletePatrol / increment_patrol_vehicles_checked fail with a
--      "column does not exist" error.
--
-- Fixes:
--   1. Replace notify_patrol_assignment() with a version that wraps the
--      push-notification attempt in a BEGIN/EXCEPTION block.  Any error
--      (including "function does not exist") is logged as a WARNING and the
--      INSERT is allowed to proceed.
--
--   2. Add the missing columns to patrols using ADD COLUMN IF NOT EXISTS so
--      the migration is safe to re-run.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Add missing columns to the patrols table
-- ============================================================================

ALTER TABLE public.patrols
  ADD COLUMN IF NOT EXISTS vehicles_checked  INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breaches_found    INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at          TIMESTAMPTZ;

COMMENT ON COLUMN public.patrols.vehicles_checked IS 'Count of vehicles scanned during this patrol';
COMMENT ON COLUMN public.patrols.breaches_found   IS 'Count of compliance breaches detected during this patrol';
COMMENT ON COLUMN public.patrols.started_at       IS 'Timestamp when the officer started the patrol';
COMMENT ON COLUMN public.patrols.ended_at         IS 'Timestamp when the officer ended the patrol';

-- ============================================================================
-- PART 2: Fix notify_patrol_assignment trigger
--
-- The previous version called send_push_via_edge_function() directly.  That
-- helper is not a SQL function (it was intended to be implemented later).
-- Wrapping the call in a BEGIN/EXCEPTION block ensures that any failure —
-- including "function does not exist" — degrades gracefully to a WARNING
-- without rolling back the patrol INSERT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_patrol_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone_name   TEXT;
  v_officer_name TEXT;
BEGIN
  -- Only notify on assignment (new insert with officer, or officer being added)
  IF NOT (
    (TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL) OR
    (TG_OP = 'UPDATE' AND OLD.assigned_to IS DISTINCT FROM NEW.assigned_to AND NEW.assigned_to IS NOT NULL)
  ) THEN
    RETURN NEW;
  END IF;

  -- Fetch display names for logging
  BEGIN
    SELECT name INTO v_zone_name FROM zones WHERE id = NEW.zone_id;
    SELECT first_name || ' ' || last_name
      INTO v_officer_name
      FROM user_profiles
     WHERE id = NEW.assigned_to;
  EXCEPTION WHEN OTHERS THEN
    -- Non-critical: just skip the names
    v_zone_name    := NEW.zone_id::text;
    v_officer_name := NEW.assigned_to::text;
  END;

  -- Attempt push notification; failure must NOT block the INSERT.
  BEGIN
    PERFORM send_push_via_edge_function(
      NEW.assigned_to,
      jsonb_build_object(
        'type',    'patrol_assigned',
        'title',   'New Patrol Assignment',
        'message', format(
          'You have been assigned to patrol %s on %s (%s shift)',
          v_zone_name,
          to_char(NEW.patrol_date, 'DD/MM/YYYY'),
          NEW.shift
        ),
        'data', jsonb_build_object(
          'patrol_id',           NEW.id,
          'zone_id',             NEW.zone_id,
          'zone_name',           v_zone_name,
          'patrol_date',         NEW.patrol_date,
          'shift',               NEW.shift,
          'auto_checkin_enabled', COALESCE(NEW.auto_checkin_enabled, true) -- column default is TRUE; fallback guards against NULLs on old rows
        )
      )
    );
    NEW.notification_sent    := TRUE;
    NEW.notification_sent_at := now();
  EXCEPTION WHEN OTHERS THEN
    -- Push notification unavailable — log and continue.  The patrol INSERT
    -- must succeed regardless of notification infrastructure availability.
    RAISE WARNING
      'notify_patrol_assignment: push notification skipped for officer % on patrol % (zone %): % (%)',
      v_officer_name, NEW.id, v_zone_name, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_patrol_assignment() IS
  'BEFORE INSERT/UPDATE trigger on patrols. Attempts to send a push notification '
  'when a patrol is assigned to an officer. Any push-notification failure is '
  'caught and logged as a WARNING so the patrol INSERT always succeeds.';

-- Recreate the trigger (idempotent)
DROP TRIGGER IF EXISTS trigger_notify_patrol_assignment ON public.patrols;

CREATE TRIGGER trigger_notify_patrol_assignment
  BEFORE INSERT OR UPDATE ON public.patrols
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_patrol_assignment();

COMMENT ON TRIGGER trigger_notify_patrol_assignment ON public.patrols IS
  'Sends a push notification when a patrol is assigned to an officer. '
  'Failures are logged as WARNINGs and do not block the INSERT/UPDATE.';

-- ============================================================================
-- PART 3: Force PostgREST schema cache reload
-- ============================================================================

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  v_has_vehicles_checked BOOLEAN;
  v_has_breaches_found   BOOLEAN;
  v_has_started_at       BOOLEAN;
  v_has_ended_at         BOOLEAN;
  v_trigger_exists       BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patrols'
      AND column_name = 'vehicles_checked'
  ) INTO v_has_vehicles_checked;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patrols'
      AND column_name = 'breaches_found'
  ) INTO v_has_breaches_found;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patrols'
      AND column_name = 'started_at'
  ) INTO v_has_started_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patrols'
      AND column_name = 'ended_at'
  ) INTO v_has_ended_at;

  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'patrols'
      AND t.tgname  = 'trigger_notify_patrol_assignment'
  ) INTO v_trigger_exists;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  20260410000001 — patrol auto-start fix';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  patrols.vehicles_checked : %', CASE WHEN v_has_vehicles_checked THEN 'OK ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '  patrols.breaches_found   : %', CASE WHEN v_has_breaches_found   THEN 'OK ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '  patrols.started_at       : %', CASE WHEN v_has_started_at       THEN 'OK ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '  patrols.ended_at         : %', CASE WHEN v_has_ended_at         THEN 'OK ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '  trigger_notify_patrol_assignment: %', CASE WHEN v_trigger_exists THEN 'OK ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '  notify_patrol_assignment: push notification failures are';
  RAISE NOTICE '  now caught and logged as WARNINGs (INSERT always succeeds).';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;

COMMIT;
