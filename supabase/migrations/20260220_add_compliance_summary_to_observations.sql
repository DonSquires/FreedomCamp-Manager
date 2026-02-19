/**
 * Add Persistent Compliance Summary to Observations
 * 
 * Purpose: Store pre-calculated compliance metrics and human-readable explanations
 * with each observation for:
 * - Legal defensibility (immutable audit trail)
 * - Performance (no runtime queries)
 * - Court-ready documentation (clear explanations)
 * 
 * Changes:
 * 1. Add compliance_summary JSONB column to vehicle_observations_v2
 * 2. Create function to generate compliance explanation blurb
 * 3. Update compliance trigger to populate this data
 */

-- =====================================================================
-- 1. ADD COMPLIANCE_SUMMARY COLUMN
-- =====================================================================

ALTER TABLE public.vehicle_observations_v2
ADD COLUMN IF NOT EXISTS compliance_summary JSONB DEFAULT NULL;

COMMENT ON COLUMN public.vehicle_observations_v2.compliance_summary IS 
'Pre-calculated compliance metrics and explanation stored at observation time for legal audit trail and performance';

CREATE INDEX IF NOT EXISTS idx_observations_compliance_summary 
ON public.vehicle_observations_v2 USING gin(compliance_summary);

-- =====================================================================
-- 2. FUNCTION TO GENERATE COMPLIANCE EXPLANATION
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
BEGIN
  -- Get observation with all related data
  SELECT 
    obs.observation_id,
    obs.plate_number,
    obs.zone_id,
    obs.recorded_at,
    obs.self_contained,
    obs.self_contained_expiry,
    obs.is_compliant,
    obs.breach_type,
    obs.has_homeless_claim,
    z.name as zone_name,
    cv.homeless_status,
    cv.self_contained as canonical_sc,
    cv.self_contained_expiry as canonical_sc_expiry,
    cr.is_homeless_exempt
  INTO v_obs
  FROM vehicle_observations_v2 obs
  LEFT JOIN zones z ON z.id = obs.zone_id
  LEFT JOIN canonical_vehicles cv ON cv.plate_number = obs.plate_number
  LEFT JOIN compliance_results cr ON cr.observation_id = obs.observation_id
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
    consecutive_nights
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
    v_stays := ROW(0, 0);
  END IF;

  -- Determine status and generate explanation
  DECLARE
    v_nights_stayed INT := COALESCE(v_stays.nights_stayed, 0);
    v_consecutive INT := COALESCE(v_stays.consecutive_nights, 0);
    v_is_sc BOOLEAN := COALESCE(v_obs.canonical_sc, v_obs.self_contained, false);
    v_sc_expiry DATE := COALESCE(v_obs.canonical_sc_expiry, v_obs.self_contained_expiry);
    v_sc_expired BOOLEAN := (v_sc_expiry IS NOT NULL AND v_sc_expiry < CURRENT_DATE);
    v_is_homeless BOOLEAN := COALESCE(v_obs.is_homeless_exempt, false);
    v_homeless_status TEXT := COALESCE(v_obs.homeless_status, 'none');
  BEGIN
    -- Build explanation
    v_explanation := format('Vehicle %s observed at %s on %s. ', 
      v_obs.plate_number, 
      v_obs.zone_name,
      TO_CHAR(v_obs.recorded_at, 'DD/MM/YYYY at HH24:MI')
    );

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

    -- Determine overall status
    IF (v_nights_stayed > v_matrix.nights_per_month) OR 
       (v_consecutive > v_matrix.max_consecutive_nights) OR
       (v_matrix.self_contained_required AND (NOT v_is_sc OR v_sc_expired)) THEN
      
      IF v_is_homeless THEN
        v_status := 'breach_homeless_exempt';
        v_explanation := v_explanation || 'BREACH DETECTED but vehicle has CONFIRMED HOMELESS STATUS under Freedom Camping Act 2011. Enforcement restricted - focus on welfare pathways and support services.';
      ELSE
        v_status := 'breach';
        v_explanation := v_explanation || 'BREACH DETECTED: Zone requirements exceeded. Enforcement action recommended per organizational policy.';
      END IF;
    ELSIF (v_nights_stayed = v_matrix.nights_per_month) OR 
          (v_consecutive = v_matrix.max_consecutive_nights) THEN
      v_status := 'at_risk';
      v_explanation := v_explanation || 'AT RISK: Vehicle has reached zone limits. Monitor closely - next observation may trigger breach.';
    ELSE
      v_status := 'compliant';
      v_explanation := v_explanation || 'COMPLIANT: All zone requirements met. No enforcement action required.';
    END IF;

    -- Build summary JSON
    v_summary := jsonb_build_object(
      'status', v_status,
      'explanation', v_explanation,
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
      )
    );

    RETURN v_summary;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION generate_compliance_explanation IS 
'Generates pre-calculated compliance summary with human-readable explanation for legal audit trail';

-- =====================================================================
-- 3. UPDATE COMPLIANCE TRIGGER TO POPULATE SUMMARY
-- =====================================================================

CREATE OR REPLACE FUNCTION populate_compliance_summary()
RETURNS TRIGGER AS $$
BEGIN
  -- Only populate if observation has been through compliance evaluation
  IF NEW.is_compliant IS NOT NULL THEN
    NEW.compliance_summary := generate_compliance_explanation(NEW.observation_id);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_populate_compliance_summary ON public.vehicle_observations_v2;

-- Create new trigger
CREATE TRIGGER trigger_populate_compliance_summary
  BEFORE INSERT OR UPDATE OF is_compliant, breach_type, breach_details
  ON public.vehicle_observations_v2
  FOR EACH ROW
  EXECUTE FUNCTION populate_compliance_summary();

COMMENT ON TRIGGER trigger_populate_compliance_summary ON public.vehicle_observations_v2 IS 
'Automatically populates compliance_summary with pre-calculated metrics and explanation whenever compliance status changes';

-- =====================================================================
-- 4. BACKFILL EXISTING OBSERVATIONS
-- =====================================================================

-- Backfill compliance summaries for existing observations that have compliance results
UPDATE vehicle_observations_v2
SET compliance_summary = generate_compliance_explanation(observation_id)
WHERE is_compliant IS NOT NULL
  AND compliance_summary IS NULL
  AND observation_id IN (
    SELECT observation_id 
    FROM compliance_results 
    WHERE observation_id IS NOT NULL
  );

-- =====================================================================
-- 5. GRANT PERMISSIONS
-- =====================================================================

GRANT EXECUTE ON FUNCTION generate_compliance_explanation TO authenticated;
GRANT EXECUTE ON FUNCTION generate_compliance_explanation TO service_role;
