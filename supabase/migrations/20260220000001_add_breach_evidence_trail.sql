/**
 * Add Breach Evidence Trail to Compliance Summary
 * 
 * Purpose: Provide court-defensible proof of breach by showing:
 * - Sequential observations (proving overnight stays)
 * - GPS location correlation (proving same vehicle, same location)
 * - Officer contact attempts and outcomes
 * - Progression from "at risk" to "breach"
 * 
 * Changes:
 * 1. Enhance generate_compliance_explanation to include evidence trail
 * 2. Add helper function to calculate GPS distance
 * 3. Include sequential observation details in compliance_summary
 */

-- =====================================================================
-- 1. HELPER FUNCTION: CALCULATE GPS DISTANCE
-- =====================================================================

-- Function already exists from previous migrations, but ensure it's available
-- calculate_gps_distance(lat1, lon1, lat2, lon2) returns distance in meters

-- =====================================================================
-- 2. ENHANCED COMPLIANCE EXPLANATION WITH EVIDENCE TRAIL
-- =====================================================================

CREATE OR REPLACE FUNCTION generate_compliance_explanation(
  p_obs_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_obs RECORD;
  v_matrix RECORD;
  v_stays RECORD;
  v_explanation TEXT;
  v_status TEXT;
  v_summary JSONB;
  v_evidence_trail JSONB[];
  v_prev_obs RECORD;
  v_officer_contact TEXT;
  v_gps_distance NUMERIC;
BEGIN
  -- Get observation with all related data
  SELECT 
    obs.observation_id,
    obs.plate_number,
    obs.zone_id,
    obs.recorded_at,
    obs.gps_latitude,
    obs.gps_longitude,
    obs.gps_accuracy,
    obs.self_contained,
    obs.self_contained_expiry,
    obs.is_compliant,
    obs.breach_type,
    obs.has_homeless_claim,
    obs.officer_notes,
    z.name as zone_name,
    cv.homeless_status,
    cv.self_contained as canonical_sc,
    cv.self_contained_expiry as canonical_sc_expiry,
    cr.is_homeless_exempt,
    up.first_name || ' ' || up.last_name as officer_name
  INTO v_obs
  FROM observations obs
  LEFT JOIN zones z ON z.id = obs.zone_id
  LEFT JOIN canonical_vehicles cv ON cv.plate_number = obs.plate_number
  LEFT JOIN compliance_results cr ON cr.observation_id = obs.observation_id
  LEFT JOIN user_profiles up ON up.id = obs.recorded_by
  WHERE obs.observation_id = p_obs_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Get current active matrix for zone
  SELECT 
    nights_per_month,
    max_consecutive_nights,
    requires_csc as self_contained_required,
    homeless_exemption
  INTO v_matrix
  FROM zone_compliance_matrix
  WHERE zone_id = v_obs.zone_id
    AND effective_to IS NULL
  ORDER BY version DESC
  LIMIT 1;

  -- Get monthly stays
  SELECT 
    nights_stayed,
    consecutive_nights,
    last_observation_date,
    observation_ids
  INTO v_stays
  FROM vehicle_monthly_stays
  WHERE plate_number = v_obs.plate_number
    AND zone_id = v_obs.zone_id
    AND calendar_month = DATE_TRUNC('month', v_obs.recorded_at::date)::date;

  -- Default values if no data
  IF v_matrix IS NULL THEN
    v_matrix := ROW(28, 3, true, true);
  END IF;

  IF v_stays IS NULL THEN
    v_stays := ROW(0, 0, NULL, ARRAY[]::uuid[]);
  END IF;

  -- =====================================================================
  -- BUILD EVIDENCE TRAIL
  -- =====================================================================
  
  -- Get previous observations in this zone (last 7 days) to prove overnight stays
  v_evidence_trail := ARRAY[]::jsonb[];
  
  FOR v_prev_obs IN (
    SELECT 
      observation_id,
      recorded_at,
      gps_latitude,
      gps_longitude,
      gps_accuracy,
      officer_notes,
      has_homeless_claim,
      up.first_name || ' ' || up.last_name as officer_name
    FROM observations obs
    LEFT JOIN user_profiles up ON up.id = obs.recorded_by
    WHERE obs.plate_number = v_obs.plate_number
      AND obs.zone_id = v_obs.zone_id
      AND obs.observation_id != v_obs.observation_id
      AND obs.recorded_at >= (v_obs.recorded_at - INTERVAL '7 days')
      AND obs.recorded_at < v_obs.recorded_at
    ORDER BY obs.recorded_at DESC
    LIMIT 10
  ) LOOP
    -- Calculate GPS distance between observations
    v_gps_distance := NULL;
    IF v_prev_obs.gps_latitude IS NOT NULL 
       AND v_prev_obs.gps_longitude IS NOT NULL 
       AND v_obs.gps_latitude IS NOT NULL 
       AND v_obs.gps_longitude IS NOT NULL THEN
      v_gps_distance := calculate_gps_distance(
        v_prev_obs.gps_latitude,
        v_prev_obs.gps_longitude,
        v_obs.gps_latitude,
        v_obs.gps_longitude
      );
    END IF;

    -- Extract officer contact information from notes
    v_officer_contact := NULL;
    IF v_prev_obs.officer_notes IS NOT NULL THEN
      IF v_prev_obs.officer_notes ILIKE '%spoke with owner%' 
         OR v_prev_obs.officer_notes ILIKE '%contacted owner%'
         OR v_prev_obs.officer_notes ILIKE '%owner present%' THEN
        v_officer_contact := 'Officer contacted owner';
      ELSIF v_prev_obs.officer_notes ILIKE '%no contact%'
            OR v_prev_obs.officer_notes ILIKE '%owner absent%'
            OR v_prev_obs.officer_notes ILIKE '%vehicle unattended%' THEN
        v_officer_contact := 'No contact made - vehicle unattended';
      END IF;
    END IF;

    -- Build evidence entry
    v_evidence_trail := v_evidence_trail || jsonb_build_object(
      'observation_id', v_prev_obs.observation_id,
      'recorded_at', v_prev_obs.recorded_at,
      'time_ago_hours', EXTRACT(EPOCH FROM (v_obs.recorded_at - v_prev_obs.recorded_at)) / 3600,
      'gps_distance_meters', v_gps_distance,
      'same_location', (v_gps_distance IS NOT NULL AND v_gps_distance < 50),
      'officer_name', v_prev_obs.officer_name,
      'officer_contact', v_officer_contact,
      'has_homeless_claim', v_prev_obs.has_homeless_claim,
      'overnight_proven', (
        EXTRACT(EPOCH FROM (v_obs.recorded_at - v_prev_obs.recorded_at)) >= 21600 -- 6+ hours apart
        AND v_gps_distance IS NOT NULL 
        AND v_gps_distance < 50 -- within 50m
      )
    );
  END LOOP;

  -- =====================================================================
  -- GENERATE EXPLANATION WITH EVIDENCE
  -- =====================================================================

  DECLARE
    v_nights_stayed INT := COALESCE(v_stays.nights_stayed, 0);
    v_consecutive INT := COALESCE(v_stays.consecutive_nights, 0);
    v_is_sc BOOLEAN := COALESCE(v_obs.canonical_sc, v_obs.self_contained, false);
    v_sc_expiry DATE := COALESCE(v_obs.canonical_sc_expiry, v_obs.self_contained_expiry);
    v_sc_expired BOOLEAN := (v_sc_expiry IS NOT NULL AND v_sc_expiry < CURRENT_DATE);
    v_is_homeless BOOLEAN := COALESCE(v_obs.is_homeless_exempt, false);
    v_homeless_status TEXT := COALESCE(v_obs.homeless_status, 'none');
    v_overnight_proven BOOLEAN := false;
  BEGIN
    -- Build explanation
    v_explanation := format('OBSERVATION RECORD: Vehicle %s observed at %s on %s at %s by Officer %s. ', 
      v_obs.plate_number, 
      v_obs.zone_name,
      TO_CHAR(v_obs.recorded_at, 'DD/MM/YYYY'),
      TO_CHAR(v_obs.recorded_at, 'HH24:MI'),
      COALESCE(v_obs.officer_name, 'Unknown')
    );

    -- Add GPS coordinates if available
    IF v_obs.gps_latitude IS NOT NULL AND v_obs.gps_longitude IS NOT NULL THEN
      v_explanation := v_explanation || format('GPS Location: %s, %s (±%sm). ',
        ROUND(v_obs.gps_latitude::numeric, 6),
        ROUND(v_obs.gps_longitude::numeric, 6),
        ROUND(COALESCE(v_obs.gps_accuracy, 0))
      );
    END IF;

    -- Evidence trail: Prove overnight stays with sequential observations
    IF array_length(v_evidence_trail, 1) > 0 THEN
      v_explanation := v_explanation || E'\n\nEVIDENCE TRAIL (Sequential Observations): ';
      
      FOR i IN 1..LEAST(array_length(v_evidence_trail, 1), 3) LOOP
        DECLARE
          v_ev JSONB := v_evidence_trail[i];
        BEGIN
          v_explanation := v_explanation || format(E'\n• Previous observation %s hours earlier on %s at %s',
            ROUND((v_ev->>'time_ago_hours')::numeric, 1),
            TO_CHAR((v_ev->>'recorded_at')::timestamp, 'DD/MM/YYYY'),
            TO_CHAR((v_ev->>'recorded_at')::timestamp, 'HH24:MI')
          );

          IF (v_ev->>'same_location')::boolean THEN
            v_explanation := v_explanation || format(' (same GPS location, %sm apart)',
              ROUND((v_ev->>'gps_distance_meters')::numeric, 0)
            );
            v_overnight_proven := true;
          END IF;

          IF v_ev->>'officer_contact' IS NOT NULL THEN
            v_explanation := v_explanation || format(' - %s', v_ev->>'officer_contact');
          END IF;

          v_explanation := v_explanation || format(' [Officer: %s]', v_ev->>'officer_name');

          IF (v_ev->>'overnight_proven')::boolean THEN
            v_explanation := v_explanation || ' ✓ OVERNIGHT STAY PROVEN';
          END IF;

          v_explanation := v_explanation || '.';
        END;
      END LOOP;

      IF array_length(v_evidence_trail, 1) > 3 THEN
        v_explanation := v_explanation || format(E'\n• ... and %s additional observations on record.',
          array_length(v_evidence_trail, 1) - 3
        );
      END IF;

      v_explanation := v_explanation || E'\n\n';
    END IF;

    -- Officer contact for THIS observation
    IF v_obs.officer_notes IS NOT NULL THEN
      IF v_obs.officer_notes ILIKE '%spoke with owner%' 
         OR v_obs.officer_notes ILIKE '%contacted owner%'
         OR v_obs.officer_notes ILIKE '%owner present%' THEN
        v_explanation := v_explanation || 'OFFICER CONTACT: Officer spoke with vehicle owner. ';
      ELSIF v_obs.officer_notes ILIKE '%no contact%'
            OR v_obs.officer_notes ILIKE '%owner absent%'
            OR v_obs.officer_notes ILIKE '%vehicle unattended%' THEN
        v_explanation := v_explanation || 'OFFICER CONTACT: No contact made - vehicle was unattended at time of observation. ';
      END IF;
    END IF;

    -- Homeless claim if present
    IF v_obs.has_homeless_claim THEN
      v_explanation := v_explanation || 'NOTE: Vehicle occupant has claimed homeless status (pending verification). ';
    END IF;

    v_explanation := v_explanation || E'\n\nCOMPLIANCE ASSESSMENT: ';

    -- Monthly nights
    v_explanation := v_explanation || format('Monthly stays: %s of %s nights permitted this month', 
      v_nights_stayed, 
      v_matrix.nights_per_month
    );

    IF v_nights_stayed > v_matrix.nights_per_month THEN
      v_explanation := v_explanation || format(' (EXCEEDED by %s nights)', 
        v_nights_stayed - v_matrix.nights_per_month
      );
    ELSIF v_nights_stayed = v_matrix.nights_per_month THEN
      v_explanation := v_explanation || ' (AT LIMIT - one more night will breach)';
    END IF;

    v_explanation := v_explanation || '. ';

    -- Consecutive nights
    v_explanation := v_explanation || format('Consecutive stays: %s of %s nights permitted', 
      v_consecutive, 
      v_matrix.max_consecutive_nights
    );

    IF v_consecutive > v_matrix.max_consecutive_nights THEN
      v_explanation := v_explanation || format(' (EXCEEDED by %s nights)', 
        v_consecutive - v_matrix.max_consecutive_nights
      );
    ELSIF v_consecutive = v_matrix.max_consecutive_nights THEN
      v_explanation := v_explanation || ' (AT LIMIT - vehicle must move for at least 1 night)';
    END IF;

    v_explanation := v_explanation || '. ';

    -- Self-contained status
    IF v_matrix.self_contained_required THEN
      IF v_is_sc THEN
        IF v_sc_expired THEN
          v_explanation := v_explanation || format('Self-contained certification EXPIRED on %s (BREACH). ', 
            TO_CHAR(v_sc_expiry, 'DD/MM/YYYY')
          );
        ELSE
          v_explanation := v_explanation || 'Self-contained certification valid';
          IF v_sc_expiry IS NOT NULL THEN
            v_explanation := v_explanation || format(' (expires %s)', TO_CHAR(v_sc_expiry, 'DD/MM/YYYY'));
          END IF;
          v_explanation := v_explanation || '. ';
        END IF;
      ELSE
        v_explanation := v_explanation || 'Self-contained certification REQUIRED but MISSING (BREACH). ';
      END IF;
    ELSE
      v_explanation := v_explanation || 'Self-contained certification not required for this zone. ';
    END IF;

    -- Determine overall status with evidence-based justification
    v_explanation := v_explanation || E'\n\nVERDICT: ';

    IF (v_nights_stayed > v_matrix.nights_per_month) OR 
       (v_consecutive > v_matrix.max_consecutive_nights) OR
       (v_matrix.self_contained_required AND (NOT v_is_sc OR v_sc_expired)) THEN
      
      IF v_is_homeless THEN
        v_status := 'breach_homeless_exempt';
        v_explanation := v_explanation || 'BREACH DETECTED but vehicle has CONFIRMED HOMELESS STATUS under Freedom Camping Act 2011. Enforcement restricted - focus on welfare pathways and support services.';
      ELSE
        v_status := 'breach';
        v_explanation := v_explanation || 'BREACH DETECTED: Zone requirements exceeded.';
        
        IF v_overnight_proven THEN
          v_explanation := v_explanation || ' Overnight stay proven via sequential GPS-verified observations.';
        END IF;
        
        v_explanation := v_explanation || ' Enforcement action recommended per organizational policy.';
      END IF;
    ELSIF (v_nights_stayed = v_matrix.nights_per_month) OR 
          (v_consecutive = v_matrix.max_consecutive_nights) THEN
      v_status := 'at_risk';
      v_explanation := v_explanation || 'AT RISK: Vehicle has reached zone limits. Monitor closely - next observation may trigger breach.';
    ELSE
      v_status := 'compliant';
      v_explanation := v_explanation || 'COMPLIANT: All zone requirements met. No enforcement action required.';
    END IF;

    -- Build summary JSON with evidence trail
    v_summary := jsonb_build_object(
      'status', v_status,
      'explanation', v_explanation,
      'evidence_trail', v_evidence_trail,
      'overnight_proven', v_overnight_proven,
      'metrics', jsonb_build_object(
        'nights_per_month_allowed', v_matrix.nights_per_month,
        'nights_stayed_this_month', v_nights_stayed,
        'max_consecutive_nights_allowed', v_matrix.max_consecutive_nights,
        'consecutive_nights_stayed', v_consecutive,
        'self_contained_required', v_matrix.self_contained_required,
        'is_self_contained', v_is_sc,
        'self_contained_expiry', v_sc_expiry,
        'self_contained_expired', v_sc_expired
      ),
      'flags', jsonb_build_object(
        'exceeds_monthly_limit', (v_nights_stayed > v_matrix.nights_per_month),
        'exceeds_consecutive_limit', (v_consecutive > v_matrix.max_consecutive_nights),
        'sc_required_but_missing', (v_matrix.self_contained_required AND NOT v_is_sc),
        'sc_expired', v_sc_expired,
        'is_homeless_exempt', v_is_homeless,
        'homeless_status', v_homeless_status
      ),
      'calculated_at', NOW(),
      'zone_name', v_obs.zone_name,
      'zone_rules', jsonb_build_object(
        'nights_per_month', v_matrix.nights_per_month,
        'max_consecutive_nights', v_matrix.max_consecutive_nights,
        'self_contained_required', v_matrix.self_contained_required,
        'homeless_exemption', v_matrix.homeless_exemption
      ),
      'observation_details', jsonb_build_object(
        'observation_id', v_obs.observation_id,
        'recorded_at', v_obs.recorded_at,
        'gps_latitude', v_obs.gps_latitude,
        'gps_longitude', v_obs.gps_longitude,
        'gps_accuracy', v_obs.gps_accuracy,
        'officer_name', v_obs.officer_name,
        'officer_notes', v_obs.officer_notes
      )
    );

    RETURN v_summary;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION generate_compliance_explanation IS 
'Generates court-defensible compliance summary with sequential observation evidence trail, GPS correlation, and officer contact details';

-- =====================================================================
-- 3. BACKFILL EXISTING OBSERVATIONS WITH NEW EVIDENCE TRAIL
-- =====================================================================

-- This migration runs before 20260220000002 on a clean schema, so ensure the
-- target column exists before writing into it.
ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS compliance_summary JSONB DEFAULT NULL;

-- Backfill compliance summaries for existing observations
UPDATE observations
SET compliance_summary = generate_compliance_explanation(observation_id)
WHERE is_compliant IS NOT NULL
  AND observation_id IN (
    SELECT observation_id 
    FROM compliance_results 
    WHERE observation_id IS NOT NULL
  );

-- =====================================================================
-- 4. GRANT PERMISSIONS
-- =====================================================================

GRANT EXECUTE ON FUNCTION generate_compliance_explanation TO authenticated;
GRANT EXECUTE ON FUNCTION generate_compliance_explanation TO service_role;
