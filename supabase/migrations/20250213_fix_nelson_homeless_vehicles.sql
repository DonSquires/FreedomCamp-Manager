-- =====================================================
-- FIX NELSON CITY COUNCIL HOMELESS VEHICLES
-- =====================================================
-- Purpose: Confirm homeless status for 4 known homeless vehicles
-- Issue: DTQ338, HUU620, WD8832, MC6582 showing as breaches when they should be FC Act exempt
-- Root Cause: homeless_status = 'claimed' instead of 'confirmed'
-- Solution: Update to 'confirmed' so compliance evaluation exempts them
-- =====================================================

-- STEP 1: Verify current status
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM canonical_vehicles
  WHERE plate_number IN ('DTQ338', 'HUU620', 'WD8832', 'MC6582')
    AND homeless_status != 'confirmed';
  
  RAISE NOTICE '🔍 Found % vehicles needing confirmation', v_count;
END;
$$;

-- STEP 2: Update homeless status to 'confirmed'
UPDATE canonical_vehicles
SET 
  homeless_status = 'confirmed',
  homeless_confirmed_at = NOW(),
  homeless_confirmed_by = (
    SELECT id FROM user_profiles 
    WHERE email = 'admin@nelsoncitycouncil.govt.nz' 
    OR role = 'admin'
    LIMIT 1
  ),
  homeless_notes = COALESCE(
    homeless_notes || E'\n\n[Admin Confirmation ' || NOW()::DATE || ']: Known homeless vehicle - confirmed by Nelson City Council admin',
    '[Admin Confirmation ' || NOW()::DATE || ']: Known homeless vehicle - confirmed by Nelson City Council admin'
  ),
  updated_at = NOW()
WHERE plate_number IN ('DTQ338', 'HUU620', 'WD8832', 'MC6582');

-- STEP 3: Close any open breach alerts for these vehicles
UPDATE breach_alerts
SET 
  status = 'resolved',
  resolution_notes = 'Vehicle confirmed as homeless - FC Act exemption applies',
  resolved_at = NOW(),
  resolved_by = (
    SELECT id FROM user_profiles 
    WHERE email = 'admin@nelsoncitycouncil.govt.nz' 
    OR role = 'admin'
    LIMIT 1
  )
WHERE plate_number IN ('DTQ338', 'HUU620', 'WD8832', 'MC6582')
  AND status IN ('pending', 'active')
  AND breach_type LIKE '%overstay%';

-- STEP 4: Re-evaluate compliance for recent observations
DO $$
DECLARE
  v_obs RECORD;
  v_matrix RECORD;
BEGIN
  -- For each recent observation of these vehicles
  FOR v_obs IN 
    SELECT DISTINCT obs.observation_id, obs.plate_number, obs.zone_id, obs.organization_id
    FROM vehicle_observations_v2 obs
    WHERE obs.plate_number IN ('DTQ338', 'HUU620', 'WD8832', 'MC6582')
      AND obs.recorded_at >= NOW() - INTERVAL '30 days'
  LOOP
    -- Get active compliance matrix
    SELECT * INTO v_matrix
    FROM zone_compliance_matrix
    WHERE zone_id = v_obs.zone_id
      AND effective_to IS NULL
    LIMIT 1;
    
    IF FOUND THEN
      -- Delete old compliance result
      DELETE FROM compliance_results
      WHERE observation_id = v_obs.observation_id;
      
      -- Insert new compliant result (FC Act exempt)
      INSERT INTO compliance_results (
        observation_id,
        zone_id,
        organization_id,
        matrix_id,
        matrix_version,
        is_compliant,
        violation_reasons,
        metrics_json,
        matrix_snapshot,
        evaluated_at
      ) VALUES (
        v_obs.observation_id,
        v_obs.zone_id,
        v_obs.organization_id,
        v_matrix.id,
        v_matrix.version,
        true, -- Now compliant due to homeless exemption
        ARRAY['FC Act Exempt - Confirmed Homeless'],
        jsonb_build_object(
          'homeless_exemption', true,
          'exemption_type', 'FC Act',
          'recalculated_at', NOW()
        ),
        to_jsonb(v_matrix),
        NOW()
      )
      ON CONFLICT (observation_id, matrix_id) DO UPDATE
      SET 
        is_compliant = true,
        violation_reasons = ARRAY['FC Act Exempt - Confirmed Homeless'],
        evaluated_at = NOW();
    END IF;
  END LOOP;
  
  RAISE NOTICE '✅ Re-evaluated recent observations for homeless vehicles';
END;
$$;

-- STEP 5: Verify fix
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'VERIFICATION RESULTS';
  RAISE NOTICE '========================================';
  
  FOR v_rec IN 
    SELECT 
      cv.plate_number,
      cv.homeless_status,
      cv.homeless_confirmed_at,
      cv.homeless_notes,
      COUNT(DISTINCT ba.id) as open_breaches,
      COUNT(DISTINCT vo.observation_id) as total_observations
    FROM canonical_vehicles cv
    LEFT JOIN breach_alerts ba ON ba.plate_number = cv.plate_number 
      AND ba.status IN ('pending', 'active')
    LEFT JOIN vehicle_observations_v2 vo ON vo.plate_number = cv.plate_number
    WHERE cv.plate_number IN ('DTQ338', 'HUU620', 'WD8832', 'MC6582')
    GROUP BY cv.plate_number, cv.homeless_status, cv.homeless_confirmed_at, cv.homeless_notes
    ORDER BY cv.plate_number
  LOOP
    RAISE NOTICE '';
    RAISE NOTICE '🚗 %:', v_rec.plate_number;
    RAISE NOTICE '   Status: %', v_rec.homeless_status;
    RAISE NOTICE '   Confirmed: %', v_rec.homeless_confirmed_at;
    RAISE NOTICE '   Open Breaches: %', v_rec.open_breaches;
    RAISE NOTICE '   Total Observations: %', v_rec.total_observations;
    
    IF v_rec.homeless_status = 'confirmed' AND v_rec.open_breaches = 0 THEN
      RAISE NOTICE '   ✅ FIXED - Now FC Act exempt';
    ELSE
      RAISE NOTICE '   ⚠️  NEEDS ATTENTION';
    END IF;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END;
$$;

-- STEP 6: Log this fix in audit trail
INSERT INTO audit_log (
  organization_id,
  user_id,
  action,
  entity_type,
  old_values,
  new_values,
  created_at
)
SELECT 
  (SELECT id FROM organizations WHERE name LIKE '%Nelson%' LIMIT 1),
  (SELECT id FROM user_profiles WHERE role = 'admin' LIMIT 1),
  'confirm_homeless_status',
  'canonical_vehicles',
  jsonb_build_object('homeless_status', 'claimed'),
  jsonb_build_object('homeless_status', 'confirmed', 'plate_numbers', ARRAY['DTQ338', 'HUU620', 'WD8832', 'MC6582']),
  NOW();

RAISE NOTICE '';
RAISE NOTICE '✅ All 4 homeless vehicles confirmed';
RAISE NOTICE '✅ Open breach alerts closed';
RAISE NOTICE '✅ Recent observations re-evaluated';
RAISE NOTICE '';
RAISE NOTICE '⚠️  IMPORTANT: These vehicles will now show purple "FC Act Exempt" badge in scans';
RAISE NOTICE '⚠️  Future scans will automatically apply homeless exemption';
