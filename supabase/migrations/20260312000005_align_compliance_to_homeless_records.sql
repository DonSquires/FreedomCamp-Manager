-- Align compliance calculators to homeless_records (org + plate scoped)
-- with fallback to canonical_vehicles.homeless_status.

-- ---------------------------------------------------------------------------
-- Helper: normalize plate key for safe matching
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_plate_key(p_plate text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(upper(coalesce(trim(p_plate), '')), '[^A-Z0-9]', '', 'g');
$$;

-- ---------------------------------------------------------------------------
-- Helper: resolve effective homeless status from homeless_records first,
-- then canonical_vehicles as fallback.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_effective_homeless_status(
  p_organization_id uuid,
  p_plate_number text
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_status text;
BEGIN
  IF to_regclass('public.homeless_records') IS NOT NULL THEN
    SELECT hr.status
    INTO v_status
    FROM public.homeless_records hr
    WHERE hr.is_active = true
      AND hr.organization_id = p_organization_id
      AND public.normalize_plate_key(hr.plate_number) = public.normalize_plate_key(p_plate_number)
    ORDER BY hr.last_reported_at DESC NULLS LAST,
             hr.updated_at DESC NULLS LAST,
             hr.created_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_status IS NULL THEN
    SELECT cv.homeless_status
    INTO v_status
    FROM public.canonical_vehicles cv
    WHERE public.normalize_plate_key(cv.plate_number) = public.normalize_plate_key(p_plate_number)
    LIMIT 1;
  END IF;

  RETURN coalesce(v_status, 'none');
END;
$$;

-- ---------------------------------------------------------------------------
-- Update calculate_vehicle_compliance_v3 to use helper resolver.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_vehicle_compliance_v3(
  p_plate_number TEXT,
  p_zone_id UUID,
  p_check_date DATE DEFAULT CURRENT_DATE,
  p_observation_id UUID DEFAULT NULL,
  p_observation_time TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  is_compliant BOOLEAN,
  at_risk BOOLEAN,
  breach_type TEXT,
  violation_reasons TEXT[],
  nights_stayed INTEGER,
  nights_allowed INTEGER,
  consecutive_nights INTEGER,
  consecutive_allowed INTEGER,
  is_overnight_stay BOOLEAN,
  is_day_visit_only_zone BOOLEAN,
  is_homeless_exempt BOOLEAN,
  matrix_snapshot JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_matrix RECORD;
  v_monthly_stay RECORD;
  v_zone_org_id UUID;
  v_homeless_status TEXT := 'none';
  v_is_homeless BOOLEAN := FALSE;
  v_is_overnight BOOLEAN := FALSE;
  v_violations TEXT[] := ARRAY[]::TEXT[];
  v_compliant BOOLEAN := TRUE;
  v_at_risk BOOLEAN := FALSE;
  v_breach_type TEXT := NULL;
  v_observation_hour INT;
BEGIN
  -- Get active compliance matrix for this zone
  SELECT * INTO v_matrix
  FROM zone_compliance_matrix
  WHERE zone_id = p_zone_id
    AND effective_from <= p_observation_time
    AND (effective_to IS NULL OR effective_to > p_observation_time)
  ORDER BY version DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No compliance matrix found for zone %', p_zone_id;
  END IF;

  -- Resolve organization for org-scoped homeless lookup.
  SELECT z.organization_id INTO v_zone_org_id
  FROM zones z
  WHERE z.id = p_zone_id;

  -- Homeless exemption source of truth: homeless_records, fallback canonical_vehicles.
  v_homeless_status := public.get_effective_homeless_status(v_zone_org_id, p_plate_number);
  v_is_homeless := (v_homeless_status IN ('confirmed', 'claimed'));

  -- Determine if this is an overnight stay based on NZ time (8pm-8am)
  v_observation_hour := EXTRACT(HOUR FROM p_observation_time AT TIME ZONE 'Pacific/Auckland');
  v_is_overnight := (v_observation_hour >= 20 OR v_observation_hour < 8);

  -- =========================================
  -- CRITICAL CHECK 1: DAY-VISIT-ONLY ZONES
  -- =========================================
  IF v_matrix.day_visit_only = TRUE THEN
    IF v_is_overnight THEN
      -- Any nighttime observation (8pm-8am) in day-visit-only zone = IMMEDIATE BREACH
      v_compliant := FALSE;
      v_at_risk := TRUE; -- Also flag as at-risk
      v_breach_type := 'day_visit_only_violation';
      v_violations := array_append(v_violations,
        'NIGHT VISIT IN DAY-ONLY ZONE: Vehicle observed at ' ||
        TO_CHAR(p_observation_time AT TIME ZONE 'Pacific/Auckland', 'HH24:MI') ||
        ' NZ time. This zone prohibits overnight stays (8pm-8am).'
      );

      RAISE NOTICE 'DAY-VISIT-ONLY BREACH: % observed at night (% NZ time) in day-only zone',
        p_plate_number, v_observation_hour;
    END IF;

    -- Skip other checks for day-visit-only zones
    RETURN QUERY SELECT
      v_compliant,
      v_at_risk,
      v_breach_type,
      v_violations,
      0, -- nights_stayed
      0, -- nights_allowed
      0, -- consecutive_nights
      0, -- consecutive_allowed
      v_is_overnight,
      TRUE, -- is_day_visit_only_zone
      v_is_homeless,
      jsonb_build_object(
        'zone_id', p_zone_id,
        'day_visit_only', v_matrix.day_visit_only,
        'homeless_exemption', v_matrix.homeless_exemption,
        'effective_homeless_status', v_homeless_status
      );
    RETURN;
  END IF;

  -- =========================================
  -- CRITICAL CHECK 2: MONTHLY STAY LIMITS
  -- =========================================
  SELECT * INTO v_monthly_stay
  FROM vehicle_monthly_stays
  WHERE plate_number = p_plate_number
    AND zone_id = p_zone_id
    AND calendar_month = DATE_TRUNC('month', p_check_date)::DATE;

  IF FOUND THEN
    -- Check if EXCEEDS monthly limit
    IF v_monthly_stay.nights_stayed > v_matrix.nights_per_month THEN
      v_compliant := FALSE;
      v_breach_type := 'monthly_limit_exceeded';
      v_violations := array_append(v_violations,
        'MONTHLY LIMIT EXCEEDED: ' || v_monthly_stay.nights_stayed || ' nights stayed this month (limit: ' || v_matrix.nights_per_month || ' nights)'
      );

      RAISE NOTICE 'MONTHLY BREACH: % has % nights (max %)',
        p_plate_number, v_monthly_stay.nights_stayed, v_matrix.nights_per_month;

    -- Check if AT MONTHLY LIMIT (will breach if stays tonight)
    ELSIF v_monthly_stay.nights_stayed >= v_matrix.nights_per_month THEN
      v_at_risk := TRUE;
      v_violations := array_append(v_violations,
        'AT RISK: Vehicle at monthly limit (' || v_monthly_stay.nights_stayed || '/' || v_matrix.nights_per_month || ' nights). One more overnight stay will trigger breach.'
      );

      RAISE NOTICE 'MONTHLY AT RISK: % at %/% nights',
        p_plate_number, v_monthly_stay.nights_stayed, v_matrix.nights_per_month;

    -- Check if APPROACHING monthly limit (1-2 nights away)
    ELSIF v_monthly_stay.nights_stayed >= (v_matrix.nights_per_month - 2) THEN
      v_at_risk := TRUE;
      v_violations := array_append(v_violations,
        'APPROACHING MONTHLY LIMIT: ' || v_monthly_stay.nights_stayed || '/' || v_matrix.nights_per_month || ' nights used this month. ' || (v_matrix.nights_per_month - v_monthly_stay.nights_stayed) || ' nights remaining.'
      );
    END IF;

    -- =========================================
    -- CRITICAL CHECK 3: CONSECUTIVE STAY LIMITS
    -- =========================================
    IF v_monthly_stay.consecutive_nights > v_matrix.max_consecutive_nights THEN
      v_compliant := FALSE;
      v_breach_type := COALESCE(v_breach_type, 'consecutive_limit_exceeded');
      v_violations := array_append(v_violations,
        'CONSECUTIVE LIMIT EXCEEDED: ' || v_monthly_stay.consecutive_nights || ' consecutive nights (limit: ' || v_matrix.max_consecutive_nights || ' nights)'
      );

      RAISE NOTICE 'CONSECUTIVE BREACH: % has % consecutive nights (max %)',
        p_plate_number, v_monthly_stay.consecutive_nights, v_matrix.max_consecutive_nights;

    -- Check if AT consecutive limit
    ELSIF v_monthly_stay.consecutive_nights >= v_matrix.max_consecutive_nights THEN
      v_at_risk := TRUE;
      v_violations := array_append(v_violations,
        'AT RISK: Vehicle at consecutive night limit (' || v_monthly_stay.consecutive_nights || '/' || v_matrix.max_consecutive_nights || '). Must leave tonight or face breach.'
      );

      RAISE NOTICE 'CONSECUTIVE AT RISK: % at %/% consecutive',
        p_plate_number, v_monthly_stay.consecutive_nights, v_matrix.max_consecutive_nights;

    -- Check if APPROACHING consecutive limit
    ELSIF v_monthly_stay.consecutive_nights >= (v_matrix.max_consecutive_nights - 1) THEN
      v_at_risk := TRUE;
      v_violations := array_append(v_violations,
        'APPROACHING CONSECUTIVE LIMIT: ' || v_monthly_stay.consecutive_nights || '/' || v_matrix.max_consecutive_nights || ' consecutive nights. ' || (v_matrix.max_consecutive_nights - v_monthly_stay.consecutive_nights) || ' more allowed.'
      );
    END IF;
  END IF;

  -- =========================================
  -- RETURN COMPREHENSIVE RESULTS
  -- =========================================
  RETURN QUERY SELECT
    v_compliant,
    v_at_risk,
    v_breach_type,
    v_violations,
    COALESCE(v_monthly_stay.nights_stayed, 0),
    v_matrix.nights_per_month,
    COALESCE(v_monthly_stay.consecutive_nights, 0),
    v_matrix.max_consecutive_nights,
    v_is_overnight,
    v_matrix.day_visit_only,
    v_is_homeless,
    jsonb_build_object(
      'zone_id', p_zone_id,
      'matrix_id', v_matrix.id,
      'matrix_version', v_matrix.version,
      'self_contained_required', v_matrix.self_contained_required,
      'nights_per_month', v_matrix.nights_per_month,
      'max_consecutive_nights', v_matrix.max_consecutive_nights,
      'day_visit_only', v_matrix.day_visit_only,
      'homeless_exemption', v_matrix.homeless_exemption,
      'allowed_days', v_matrix.allowed_days,
      'effective_homeless_status', v_homeless_status
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Update evaluate_compliance_v4 to resolve homeless exemption from helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION evaluate_compliance_v4(p_observation_id uuid)
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
BEGIN
  -- Load observation with all enriched data
  SELECT * INTO v_obs FROM observations WHERE observation_id = p_observation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Observation % not found', p_observation_id;
  END IF;

  -- Load zone and active compliance matrix
  SELECT * INTO v_zone FROM zones WHERE id = v_obs.zone_id;

  SELECT * INTO v_matrix
  FROM zone_compliance_matrix
  WHERE zone_id = v_obs.zone_id
    AND effective_from <= v_obs.recorded_at
    AND (effective_to IS NULL OR effective_to > v_obs.recorded_at)
  ORDER BY version DESC
  LIMIT 1;

  -- Load canonical vehicle data
  SELECT * INTO v_canonical FROM canonical_vehicles WHERE plate_number = v_obs.plate_number;

  -- Resolve homeless status via homeless_records first.
  v_effective_homeless_status := public.get_effective_homeless_status(v_obs.organization_id, v_obs.plate_number);

  -- Load monthly stays context
  SELECT * INTO v_monthly
  FROM vehicle_monthly_stays
  WHERE plate_number = v_obs.plate_number
    AND zone_id = v_obs.zone_id
    AND organization_id = v_obs.organization_id
    AND calendar_month = date_trunc('month', v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland')::date;

  -- -------------------------------------------------------------------------
  -- REQUIREMENT 1: Self-Contained Certification (CSC)
  -- -------------------------------------------------------------------------
  IF v_matrix.requires_csc = true THEN
    IF v_canonical.self_contained = true AND
       (v_canonical.self_contained_expiry IS NULL OR v_canonical.self_contained_expiry >= (v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland')::date) THEN
      v_csc_status := 'YES';
      v_csc_reason := format('Vehicle has valid %s CSC warrant (expires %s)',
                             COALESCE(v_canonical.nzscv_warrant_type, 'Green'),
                             COALESCE(v_canonical.self_contained_expiry::text, 'never'));
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

  -- -------------------------------------------------------------------------
  -- REQUIREMENT 2: Consecutive Nights Limit
  -- -------------------------------------------------------------------------
  IF v_matrix.max_consecutive_nights IS NOT NULL THEN
    IF COALESCE(v_monthly.consecutive_nights, 0) > v_matrix.max_consecutive_nights THEN
      v_consecutive_status := 'BREACH';
      v_consecutive_reason := format('%s/%s consecutive nights (limit exceeded)',
                                    COALESCE(v_monthly.consecutive_nights, 0),
                                    v_matrix.max_consecutive_nights);
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'consecutive_nights_exceeded');
    ELSE
      v_consecutive_status := 'YES';
      v_consecutive_reason := format('%s/%s consecutive nights',
                                    COALESCE(v_monthly.consecutive_nights, 0),
                                    v_matrix.max_consecutive_nights);
    END IF;
  ELSE
    v_consecutive_status := 'YES';
    v_consecutive_reason := 'No consecutive night limit in this zone';
  END IF;

  -- -------------------------------------------------------------------------
  -- REQUIREMENT 3: Monthly Stays Limit
  -- -------------------------------------------------------------------------
  IF v_matrix.nights_per_month IS NOT NULL THEN
    IF COALESCE(v_monthly.nights_stayed, 0) > v_matrix.nights_per_month THEN
      v_monthly_status := 'BREACH';
      v_monthly_reason := format('%s/%s nights used this month (limit exceeded)',
                                COALESCE(v_monthly.nights_stayed, 0),
                                v_matrix.nights_per_month);
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'monthly_stays_exceeded');
    ELSE
      v_monthly_status := 'YES';
      v_monthly_reason := format('%s/%s nights used this month',
                                COALESCE(v_monthly.nights_stayed, 0),
                                v_matrix.nights_per_month);
    END IF;
  ELSE
    v_monthly_status := 'YES';
    v_monthly_reason := 'No monthly stay limit in this zone';
  END IF;

  -- -------------------------------------------------------------------------
  -- REQUIREMENT 4: Time Restrictions (day-visit-only)
  -- -------------------------------------------------------------------------
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

  -- -------------------------------------------------------------------------
  -- REQUIREMENT 5: Homeless Exemption
  -- -------------------------------------------------------------------------
  IF v_matrix.homeless_exemption = true AND v_effective_homeless_status IN ('confirmed', 'claimed') THEN
    v_exempt_status := 'EXEMPT';
    v_exempt_reason := format('Effective homeless status is %s', v_effective_homeless_status);
    v_is_homeless_exempt := true;
  ELSE
    v_exempt_status := 'NO';
    v_exempt_reason := 'Not eligible for homeless exemption';
  END IF;

  v_requirement_details := jsonb_build_object(
    'self_contained', jsonb_build_object(
      'status', v_csc_status,
      'reason', v_csc_reason
    ),
    'consecutive_nights', jsonb_build_object(
      'status', v_consecutive_status,
      'reason', v_consecutive_reason
    ),
    'monthly_stays', jsonb_build_object(
      'status', v_monthly_status,
      'reason', v_monthly_reason
    ),
    'time_restrictions', jsonb_build_object(
      'status', v_time_status,
      'reason', v_time_reason
    ),
    'homeless_exemption', jsonb_build_object(
      'status', v_exempt_status,
      'reason', v_exempt_reason,
      'effective_status', v_effective_homeless_status
    )
  );

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
END;
$$;
