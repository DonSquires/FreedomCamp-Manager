-- ============================================================================
-- Fix breach_alerts not being populated from compliance_results
-- Date: 2026-04-02
--
-- ROOT CAUSE:
--   The create_breach_alert_from_compliance() trigger function checks for
--   observations.id column FIRST (a nullable secondary column) before
--   checking observations.observation_id (the actual PK). Because id is NULL
--   for most observations, the lookup returns no rows, and the function
--   silently returns without creating breach alerts.
--
-- FIX:
--   1. Rewrite create_breach_alert_from_compliance() to check for
--      observation_id column FIRST (the PK), falling back to id only
--      if observation_id doesn't exist.
--   2. Backfill breach_alerts from existing non-compliant compliance_results.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Fix the trigger function — prioritise observation_id over id
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_breach_alert_from_compliance()
RETURNS trigger
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_plate_number text;
  v_zone_id uuid;
  v_org_id uuid;
  v_effective_homeless_status text := 'none';
  v_violation_type text;
  v_violation_severity text;
  v_breach_message text;
  v_breach_type text;
  v_obs_id_col text;
BEGIN
  -- Only create breach alert if non-compliant
  IF NEW.is_compliant = true THEN
    RETURN NEW;
  END IF;

  -- Detect the observation PK column name.
  -- CRITICAL: Check observation_id FIRST (the live PK), then id as fallback.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'observation_id'
  ) THEN
    v_obs_id_col := 'observation_id';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'id'
  ) THEN
    v_obs_id_col := 'id';
  END IF;

  IF v_obs_id_col IS NULL THEN
    RAISE WARNING 'Skipping breach alert creation: observations key column not found';
    RETURN NEW;
  END IF;

  -- Look up the observation to get plate_number, zone_id, organization_id
  EXECUTE format(
    'SELECT obs.plate_number, obs.zone_id, obs.organization_id
       FROM public.observations obs
      WHERE obs.%I = $1',
    v_obs_id_col
  )
  INTO v_plate_number, v_zone_id, v_org_id
  USING NEW.observation_id;

  IF v_plate_number IS NULL OR v_zone_id IS NULL OR v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip homeless-exempt vehicles
  BEGIN
    v_effective_homeless_status := public.get_effective_homeless_status(v_org_id, v_plate_number);
  EXCEPTION WHEN OTHERS THEN
    v_effective_homeless_status := 'none';
  END;

  IF v_effective_homeless_status IN ('confirmed', 'claimed') THEN
    RETURN NEW;
  END IF;

  -- Determine violation type from compliance_results
  IF NEW.violation_reasons IS NOT NULL AND array_length(NEW.violation_reasons, 1) > 0 THEN
    v_violation_type := NEW.violation_reasons[1];
  ELSE
    v_violation_type := coalesce(NEW.violation_type, 'unknown_violation');
  END IF;

  -- Map violation type to breach_type CHECK constraint values
  CASE
    WHEN v_violation_type LIKE '%consecutive%' THEN v_breach_type := 'consecutive_nights';
    WHEN v_violation_type LIKE '%monthly%' OR v_violation_type LIKE '%month%' THEN v_breach_type := 'monthly_limit';
    WHEN v_violation_type LIKE '%self%contained%' OR v_violation_type LIKE '%self_contained%' OR v_violation_type LIKE '%no_valid_csc%' THEN v_breach_type := 'self_contained';
    WHEN v_violation_type LIKE '%after%hours%' OR v_violation_type LIKE '%overnight%' THEN v_breach_type := 'after_hours';
    WHEN v_violation_type LIKE '%day%visit%' THEN v_breach_type := 'day_visit_violation';
    WHEN v_violation_type LIKE '%allowed%days%' THEN v_breach_type := 'allowed_days_violation';
    ELSE v_breach_type := 'monthly_limit';
  END CASE;

  v_breach_message := coalesce((NEW.metrics_json->>'violation_message')::text, 'Zone compliance violation detected');
  v_violation_severity := coalesce((NEW.metrics_json->>'violation_severity')::text, 'moderate');

  -- Skip if a breach alert already exists for this observation
  IF EXISTS (
    SELECT 1
    FROM public.breach_alerts ba
    WHERE ba.organization_id = v_org_id
      AND ba.zone_id = v_zone_id
      AND ba.observation_id = NEW.observation_id
      AND ba.status IN ('pending', 'acknowledged', 'enforcement_started')
  ) THEN
    RETURN NEW;
  END IF;

  -- Insert the breach alert
  INSERT INTO public.breach_alerts (
    organization_id,
    zone_id,
    plate_number,
    observation_id,
    breach_type,
    breach_details,
    status
  ) VALUES (
    v_org_id,
    v_zone_id,
    v_plate_number,
    NEW.observation_id,
    v_breach_type,
    jsonb_build_object(
      'message', v_breach_message,
      'severity', v_violation_severity,
      'violation_type', v_violation_type,
      'violation_reasons', NEW.violation_reasons,
      'compliance_result_id', NEW.id,
      'matrix_version', NEW.matrix_version,
      'created_from_compliance', true,
      'effective_homeless_status', v_effective_homeless_status
    ),
    'pending'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create breach alert from compliance: % (%).', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.create_breach_alert_from_compliance() IS
  'AFTER INSERT trigger on compliance_results: creates a breach_alerts row '
  'for non-compliant observations. Checks observation_id column first (PK), '
  'then falls back to id. Skips homeless-exempt vehicles.';

-- ============================================================================
-- PART 2: Ensure trigger is attached to compliance_results
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'compliance_results'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trigger_create_breach_alert_from_compliance ON compliance_results';

    EXECUTE $sql$
      CREATE TRIGGER trigger_create_breach_alert_from_compliance
        AFTER INSERT ON compliance_results
        FOR EACH ROW
        WHEN (NEW.is_compliant = false)
        EXECUTE FUNCTION create_breach_alert_from_compliance()
    $sql$;

    -- Also drop old trigger name variant if it exists
    EXECUTE 'DROP TRIGGER IF EXISTS trigger_auto_create_breach_alert ON compliance_results';
  ELSE
    RAISE NOTICE 'compliance_results table not present; skipping trigger attachment';
  END IF;
END;
$$;

-- ============================================================================
-- PART 3: Backfill breach_alerts from existing non-compliant compliance_results
-- ============================================================================

DO $$
DECLARE
  v_obs_id_col text;
  v_backfilled integer := 0;
  v_skipped integer := 0;
  v_total integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'compliance_results'
  ) THEN
    RAISE NOTICE 'compliance_results table not present; skipping breach_alerts backfill';
    RETURN;
  END IF;

  -- Detect observation PK column (observation_id first, then id)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'observation_id'
  ) THEN
    v_obs_id_col := 'observation_id';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'id'
  ) THEN
    v_obs_id_col := 'id';
  ELSE
    RAISE NOTICE 'Cannot backfill: observations PK column not found';
    RETURN;
  END IF;

  -- Count non-compliant compliance_results without existing breach alerts
  EXECUTE format(
    'SELECT COUNT(*)
     FROM compliance_results cr
     JOIN observations obs ON obs.%I = cr.observation_id
     WHERE cr.is_compliant = false
       AND obs.plate_number IS NOT NULL
       AND obs.zone_id IS NOT NULL
       AND obs.organization_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM breach_alerts ba
         WHERE ba.observation_id = cr.observation_id
       )',
    v_obs_id_col
  ) INTO v_total;

  RAISE NOTICE 'Backfilling breach alerts: % non-compliant compliance_results to process', v_total;

  -- Fix the FK to reference the correct PK column BEFORE inserting.
  -- Migration 20260329 pointed breach_alerts.observation_id at observations(id)
  -- (the nullable secondary column), but on live databases the PK column is
  -- observation_id (NOT NULL).  Re-point the constraint to the detected PK column
  -- so the backfill INSERT does not violate the FK.
  EXECUTE 'ALTER TABLE breach_alerts DROP CONSTRAINT IF EXISTS breach_alerts_observation_id_fkey';
  EXECUTE format(
    'UPDATE breach_alerts
        SET observation_id = NULL
      WHERE observation_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM observations o WHERE o.%I = breach_alerts.observation_id
        )',
    v_obs_id_col
  );
  EXECUTE format(
    'ALTER TABLE breach_alerts
       ADD CONSTRAINT breach_alerts_observation_id_fkey
       FOREIGN KEY (observation_id)
       REFERENCES observations(%I)
       ON DELETE SET NULL',
    v_obs_id_col
  );
  RAISE NOTICE 'Re-pointed breach_alerts FK to observations(%)', v_obs_id_col;

  -- Backfill in a single INSERT ... SELECT
  EXECUTE format(
    'INSERT INTO breach_alerts (
       organization_id,
       zone_id,
       plate_number,
       observation_id,
       breach_type,
       breach_details,
       status,
       created_at
     )
     SELECT
       obs.organization_id,
       obs.zone_id,
       obs.plate_number,
       cr.observation_id,
       -- Map violation type to breach_type
       CASE
         WHEN COALESCE(cr.violation_reasons[1], cr.violation_type, ''unknown'') LIKE ''%%consecutive%%'' THEN ''consecutive_nights''
         WHEN COALESCE(cr.violation_reasons[1], cr.violation_type, ''unknown'') LIKE ''%%monthly%%''
           OR COALESCE(cr.violation_reasons[1], cr.violation_type, ''unknown'') LIKE ''%%month%%'' THEN ''monthly_limit''
         WHEN COALESCE(cr.violation_reasons[1], cr.violation_type, ''unknown'') LIKE ''%%self%%contained%%''
           OR COALESCE(cr.violation_reasons[1], cr.violation_type, ''unknown'') LIKE ''%%no_valid_csc%%'' THEN ''self_contained''
         WHEN COALESCE(cr.violation_reasons[1], cr.violation_type, ''unknown'') LIKE ''%%after%%hours%%''
           OR COALESCE(cr.violation_reasons[1], cr.violation_type, ''unknown'') LIKE ''%%overnight%%'' THEN ''after_hours''
         WHEN COALESCE(cr.violation_reasons[1], cr.violation_type, ''unknown'') LIKE ''%%day%%visit%%'' THEN ''day_visit_violation''
         WHEN COALESCE(cr.violation_reasons[1], cr.violation_type, ''unknown'') LIKE ''%%allowed%%days%%'' THEN ''allowed_days_violation''
         ELSE ''monthly_limit''
       END,
       jsonb_build_object(
         ''message'', ''Zone compliance violation detected'',
         ''severity'', ''moderate'',
         ''violation_type'', COALESCE(cr.violation_reasons[1], cr.violation_type, ''unknown_violation''),
         ''violation_reasons'', cr.violation_reasons,
         ''compliance_result_id'', cr.id,
         ''matrix_version'', cr.matrix_version,
         ''created_from_compliance'', true,
         ''backfilled'', true
       ),
       ''pending'',
       cr.evaluated_at
     FROM compliance_results cr
     JOIN observations obs ON obs.%I = cr.observation_id
     WHERE cr.is_compliant = false
       AND obs.plate_number IS NOT NULL
       AND obs.zone_id IS NOT NULL
       AND obs.organization_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM breach_alerts ba
         WHERE ba.observation_id = cr.observation_id
       )',
    v_obs_id_col
  );

  GET DIAGNOSTICS v_backfilled = ROW_COUNT;
  RAISE NOTICE 'Backfill complete: % breach alerts created from % total non-compliant records', v_backfilled, v_total;
END;
$$;

-- ============================================================================
-- PART 4: Force PostgREST schema cache reload
-- ============================================================================

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
