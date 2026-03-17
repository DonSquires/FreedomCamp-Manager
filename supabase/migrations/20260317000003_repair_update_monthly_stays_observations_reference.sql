-- ============================================================================
-- Repair: Reapply update_monthly_stays_on_observation() against observations
-- Date: 2026-03-17
--
-- Purpose:
--   Fix live DB drift where the installed trigger function still queries
--   public.vehicle_observations_v2 even though the canonical table is
--   public.observations.
--
-- Root cause:
--   The repository migration 20250204000003 already uses observations, but the
--   live project still has an older function body. Inserts into observations
--   can therefore fail inside trigger_update_monthly_stays if the legacy name
--   is missing or out of sync.
--
-- Strategy:
--   - Force CREATE OR REPLACE FUNCTION update_monthly_stays_on_observation()
--     with queries against public.observations.
--   - Recreate trigger_update_monthly_stays on public.observations.
--   - Idempotent and safe to re-run.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.update_monthly_stays_on_observation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_calendar_month DATE;
  v_observation_date DATE;
  v_nights_stayed INTEGER;
  v_consecutive_nights INTEGER;
  v_last_obs_date DATE;
  v_prev_obs_date DATE;
BEGIN
  v_calendar_month := DATE_TRUNC('month', NEW.recorded_at)::DATE;
  v_observation_date := DATE(NEW.recorded_at);

  SELECT
    nights_stayed,
    consecutive_nights,
    last_observation_date
  INTO
    v_nights_stayed,
    v_consecutive_nights,
    v_last_obs_date
  FROM public.vehicle_monthly_stays
  WHERE plate_number = NEW.plate_number
    AND organization_id = NEW.organization_id
    AND zone_id = NEW.zone_id
    AND calendar_month = v_calendar_month;

  IF FOUND THEN
    IF v_last_obs_date IS NULL OR v_observation_date > v_last_obs_date THEN
      v_nights_stayed := v_nights_stayed + 1;

      SELECT DATE(recorded_at) INTO v_prev_obs_date
      FROM public.observations
      WHERE plate_number = NEW.plate_number
        AND zone_id = NEW.zone_id
        AND organization_id = NEW.organization_id
        AND recorded_at < NEW.recorded_at
      ORDER BY recorded_at DESC
      LIMIT 1;

      IF v_prev_obs_date IS NOT NULL THEN
        IF v_observation_date - v_prev_obs_date = 1 THEN
          v_consecutive_nights := COALESCE(v_consecutive_nights, 0) + 1;
        ELSE
          v_consecutive_nights := 1;
        END IF;
      ELSE
        v_consecutive_nights := 1;
      END IF;

      UPDATE public.vehicle_monthly_stays
      SET
        nights_stayed = v_nights_stayed,
        consecutive_nights = v_consecutive_nights,
        last_observation_date = v_observation_date,
        observation_ids = array_append(observation_ids, NEW.observation_id),
        updated_at = now()
      WHERE plate_number = NEW.plate_number
        AND organization_id = NEW.organization_id
        AND zone_id = NEW.zone_id
        AND calendar_month = v_calendar_month;
    ELSE
      UPDATE public.vehicle_monthly_stays
      SET
        observation_ids = array_append(observation_ids, NEW.observation_id),
        updated_at = now()
      WHERE plate_number = NEW.plate_number
        AND organization_id = NEW.organization_id
        AND zone_id = NEW.zone_id
        AND calendar_month = v_calendar_month;
    END IF;
  ELSE
    SELECT DATE(recorded_at) INTO v_prev_obs_date
    FROM public.observations
    WHERE plate_number = NEW.plate_number
      AND zone_id = NEW.zone_id
      AND organization_id = NEW.organization_id
      AND recorded_at < NEW.recorded_at
    ORDER BY recorded_at DESC
    LIMIT 1;

    IF v_prev_obs_date IS NOT NULL AND v_observation_date - v_prev_obs_date = 1 THEN
      SELECT consecutive_nights INTO v_consecutive_nights
      FROM public.vehicle_monthly_stays
      WHERE plate_number = NEW.plate_number
        AND zone_id = NEW.zone_id
        AND organization_id = NEW.organization_id
        AND calendar_month < v_calendar_month
      ORDER BY calendar_month DESC
      LIMIT 1;

      v_consecutive_nights := COALESCE(v_consecutive_nights, 0) + 1;
    ELSE
      v_consecutive_nights := 1;
    END IF;

    DECLARE
      v_next_month DATE;
      v_reset_at TIMESTAMPTZ;
    BEGIN
      v_next_month := (v_calendar_month + INTERVAL '1 month')::DATE;
      v_reset_at := v_next_month::TIMESTAMPTZ + INTERVAL '8 hours';

      INSERT INTO public.vehicle_monthly_stays (
        plate_number,
        organization_id,
        zone_id,
        calendar_month,
        nights_stayed,
        consecutive_nights,
        last_observation_date,
        observation_ids,
        reset_at
      ) VALUES (
        NEW.plate_number,
        NEW.organization_id,
        NEW.zone_id,
        v_calendar_month,
        1,
        v_consecutive_nights,
        v_observation_date,
        ARRAY[NEW.observation_id],
        v_reset_at
      );
    END;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_update_monthly_stays ON public.observations;
CREATE TRIGGER trigger_update_monthly_stays
  AFTER INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_monthly_stays_on_observation();

COMMENT ON FUNCTION public.update_monthly_stays_on_observation() IS
'Repaired 2026-03-17 to query public.observations instead of legacy vehicle_observations_v2.';

COMMIT;