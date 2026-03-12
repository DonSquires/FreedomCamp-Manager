-- Fix evaluate_compliance_v4 for compliance_results column-compatibility.
-- Keeps homeless_records-first resolution but supports both old/new compliance_results schemas.

CREATE OR REPLACE FUNCTION public.evaluate_compliance_v4(p_observation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_obs observations%ROWTYPE;
  v_zone zones%ROWTYPE;
  v_matrix zone_compliance_matrix%ROWTYPE;
  v_canonical canonical_vehicles%ROWTYPE;
  v_monthly vehicle_monthly_stays%ROWTYPE;

  v_effective_homeless_status text := 'none';
  v_is_compliant boolean := true;
  v_is_homeless_exempt boolean := false;
  v_violation_reasons text[] := '{}';
  v_requirement_details jsonb := '{}'::jsonb;
  v_violation_type text := null;

  v_csc_status text;
  v_csc_reason text;
  v_consecutive_status text;
  v_consecutive_reason text;
  v_monthly_status text;
  v_monthly_reason text;
  v_time_status text;
  v_time_reason text;
  v_exempt_status text;
  v_exempt_reason text;

  has_is_homeless_exempt boolean;
  has_requirement_details boolean;
  has_fc_act_exempt boolean;
  has_is_exempt boolean;
  has_metrics_json boolean;
  has_exemption_reason boolean;
BEGIN
  SELECT * INTO v_obs FROM observations WHERE observation_id = p_observation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Observation % not found', p_observation_id;
  END IF;

  SELECT * INTO v_zone FROM zones WHERE id = v_obs.zone_id;

  SELECT * INTO v_matrix
  FROM zone_compliance_matrix
  WHERE zone_id = v_obs.zone_id
    AND effective_from <= v_obs.recorded_at
    AND (effective_to IS NULL OR effective_to > v_obs.recorded_at)
  ORDER BY version DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No compliance matrix found for zone %', v_obs.zone_id;
  END IF;

  SELECT * INTO v_canonical FROM canonical_vehicles WHERE plate_number = v_obs.plate_number;

  v_effective_homeless_status := public.get_effective_homeless_status(v_obs.organization_id, v_obs.plate_number);

  SELECT * INTO v_monthly
  FROM vehicle_monthly_stays
  WHERE plate_number = v_obs.plate_number
    AND zone_id = v_obs.zone_id
    AND organization_id = v_obs.organization_id
    AND calendar_month = date_trunc('month', v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland')::date;

  IF v_matrix.requires_csc = true THEN
    IF v_canonical.self_contained = true AND
       (v_canonical.self_contained_expiry IS NULL OR v_canonical.self_contained_expiry >= (v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland')::date) THEN
      v_csc_status := 'YES';
      v_csc_reason := format(
        'Vehicle has valid %s CSC warrant (expires %s)',
        COALESCE(v_canonical.nzscv_warrant_type, 'Green'),
        COALESCE(v_canonical.self_contained_expiry::text, 'never')
      );
    ELSE
      v_csc_status := 'BREACH';
      v_csc_reason := 'Vehicle does not have a valid self-contained certificate';
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'no_valid_csc');
    END IF;
  ELSE
    v_csc_status := 'YES';
    v_csc_reason := 'Self-contained certification not required in this zone';
  END IF;

  IF v_matrix.max_consecutive_nights IS NOT NULL THEN
    IF COALESCE(v_monthly.consecutive_nights, 0) > v_matrix.max_consecutive_nights THEN
      v_consecutive_status := 'BREACH';
      v_consecutive_reason := format(
        '%s/%s consecutive nights (limit exceeded)',
        COALESCE(v_monthly.consecutive_nights, 0),
        v_matrix.max_consecutive_nights
      );
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'consecutive_nights_exceeded');
    ELSE
      v_consecutive_status := 'YES';
      v_consecutive_reason := format(
        '%s/%s consecutive nights',
        COALESCE(v_monthly.consecutive_nights, 0),
        v_matrix.max_consecutive_nights
      );
    END IF;
  ELSE
    v_consecutive_status := 'YES';
    v_consecutive_reason := 'No consecutive night limit in this zone';
  END IF;

  IF v_matrix.nights_per_month IS NOT NULL THEN
    IF COALESCE(v_monthly.nights_stayed, 0) > v_matrix.nights_per_month THEN
      v_monthly_status := 'BREACH';
      v_monthly_reason := format(
        '%s/%s nights used this month (limit exceeded)',
        COALESCE(v_monthly.nights_stayed, 0),
        v_matrix.nights_per_month
      );
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'monthly_stays_exceeded');
    ELSE
      v_monthly_status := 'YES';
      v_monthly_reason := format(
        '%s/%s nights used this month',
        COALESCE(v_monthly.nights_stayed, 0),
        v_matrix.nights_per_month
      );
    END IF;
  ELSE
    v_monthly_status := 'YES';
    v_monthly_reason := 'No monthly stay limit in this zone';
  END IF;

  IF v_matrix.day_visit_only = true THEN
    IF EXTRACT(HOUR FROM v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland') >= 20
       OR EXTRACT(HOUR FROM v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland') < 8 THEN
      v_time_status := 'BREACH';
      v_time_reason := 'Overnight parking prohibited (day-visit only zone)';
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'overnight_parking_prohibited');
    ELSE
      v_time_status := 'YES';
      v_time_reason := 'Observed during permitted day-visit hours';
    END IF;
  ELSE
    v_time_status := 'YES';
    v_time_reason := 'Overnight parking permitted in this zone';
  END IF;

  IF v_matrix.homeless_exemption = true AND v_effective_homeless_status IN ('confirmed', 'claimed') THEN
    v_exempt_status := 'EXEMPT';
    v_exempt_reason := format('Effective homeless status is %s', v_effective_homeless_status);
    v_is_homeless_exempt := true;
  ELSE
    v_exempt_status := 'NO';
    v_exempt_reason := 'Not eligible for homeless exemption';
  END IF;

  v_requirement_details := jsonb_build_object(
    'self_contained', jsonb_build_object('status', v_csc_status, 'reason', v_csc_reason),
    'consecutive_nights', jsonb_build_object('status', v_consecutive_status, 'reason', v_consecutive_reason),
    'monthly_stays', jsonb_build_object('status', v_monthly_status, 'reason', v_monthly_reason),
    'time_restrictions', jsonb_build_object('status', v_time_status, 'reason', v_time_reason),
    'homeless_exemption', jsonb_build_object(
      'status', v_exempt_status,
      'reason', v_exempt_reason,
      'effective_status', v_effective_homeless_status
    )
  );

  v_violation_type := CASE
    WHEN array_length(v_violation_reasons, 1) > 0 THEN v_violation_reasons[1]
    ELSE null
  END;

  SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'compliance_results' AND column_name = 'is_homeless_exempt'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'compliance_results' AND column_name = 'requirement_details'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'compliance_results' AND column_name = 'fc_act_exempt'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'compliance_results' AND column_name = 'is_exempt'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'compliance_results' AND column_name = 'metrics_json'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'compliance_results' AND column_name = 'exemption_reason'
    )
  INTO has_is_homeless_exempt, has_requirement_details, has_fc_act_exempt, has_is_exempt, has_metrics_json, has_exemption_reason;

  IF has_is_homeless_exempt AND has_requirement_details THEN
    INSERT INTO compliance_results (
      observation_id,
      zone_id,
      organization_id,
      matrix_id,
      matrix_version,
      is_compliant,
      is_homeless_exempt,
      violation_reasons,
      requirement_details,
      matrix_snapshot,
      evaluated_at
    ) VALUES (
      p_observation_id,
      v_obs.zone_id,
      v_obs.organization_id,
      v_matrix.id,
      v_matrix.version,
      v_is_compliant,
      v_is_homeless_exempt,
      v_violation_reasons,
      v_requirement_details,
      to_jsonb(v_matrix),
      now()
    )
    ON CONFLICT (observation_id, matrix_id)
    DO UPDATE SET
      is_compliant = EXCLUDED.is_compliant,
      is_homeless_exempt = EXCLUDED.is_homeless_exempt,
      violation_reasons = EXCLUDED.violation_reasons,
      requirement_details = EXCLUDED.requirement_details,
      evaluated_at = EXCLUDED.evaluated_at;
  ELSE
    INSERT INTO compliance_results (
      observation_id,
      zone_id,
      organization_id,
      matrix_id,
      matrix_version,
      is_compliant,
      violation_type,
      violation_reasons,
      metrics_json,
      matrix_snapshot,
      evaluated_at,
      fc_act_exempt,
      is_exempt,
      exemption_reason
    ) VALUES (
      p_observation_id,
      v_obs.zone_id,
      v_obs.organization_id,
      v_matrix.id,
      v_matrix.version,
      v_is_compliant,
      v_violation_type,
      v_violation_reasons,
      v_requirement_details,
      to_jsonb(v_matrix),
      now(),
      CASE WHEN has_fc_act_exempt THEN v_is_homeless_exempt ELSE null END,
      CASE WHEN has_is_exempt THEN v_is_homeless_exempt ELSE null END,
      CASE WHEN has_exemption_reason THEN v_exempt_reason ELSE null END
    )
    ON CONFLICT (observation_id, matrix_id)
    DO UPDATE SET
      is_compliant = EXCLUDED.is_compliant,
      violation_type = EXCLUDED.violation_type,
      violation_reasons = EXCLUDED.violation_reasons,
      metrics_json = EXCLUDED.metrics_json,
      evaluated_at = EXCLUDED.evaluated_at,
      fc_act_exempt = COALESCE(EXCLUDED.fc_act_exempt, compliance_results.fc_act_exempt),
      is_exempt = COALESCE(EXCLUDED.is_exempt, compliance_results.is_exempt),
      exemption_reason = COALESCE(EXCLUDED.exemption_reason, compliance_results.exemption_reason);
  END IF;
END;
$$;
