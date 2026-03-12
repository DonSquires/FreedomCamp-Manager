-- Fix create_breach_alert_from_compliance to remove legacy table references.

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
  IF NEW.is_compliant = true THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'id'
  ) THEN
    v_obs_id_col := 'id';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'observation_id'
  ) THEN
    v_obs_id_col := 'observation_id';
  END IF;

  IF v_obs_id_col IS NULL THEN
    RAISE WARNING 'Skipping breach alert creation: observations key column not found';
    RETURN NEW;
  END IF;

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

  v_effective_homeless_status := public.get_effective_homeless_status(v_org_id, v_plate_number);
  IF v_effective_homeless_status IN ('confirmed', 'claimed') THEN
    RETURN NEW;
  END IF;

  IF NEW.violation_reasons IS NOT NULL AND array_length(NEW.violation_reasons, 1) > 0 THEN
    v_violation_type := NEW.violation_reasons[1];
  ELSE
    v_violation_type := coalesce(NEW.violation_type, 'unknown_violation');
  END IF;

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
