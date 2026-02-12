-- =====================================================
-- ARCHITECTURE INTEGRITY VERIFICATION
-- =====================================================
-- Purpose: Comprehensive data integrity checks after clean architecture migration
-- Verifies: Section 1 (Data) and Section 2 (Reporting) separation
-- =====================================================

DO $$
DECLARE
  v_orphaned_obs INTEGER;
  v_missing_compliance INTEGER;
  v_total_obs INTEGER;
  v_total_canonical INTEGER;
  v_compliance_coverage NUMERIC;
  v_issue_count INTEGER := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '🔍 ARCHITECTURE INTEGRITY VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Timestamp: %', NOW();
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════
  -- CHECK 1: Verify Observation Table Schema
  -- ═══════════════════════════════════════════════════════
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ CHECK 1: Observation Table Schema';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  
  -- Check for removed columns (should NOT exist)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_observations_v2' 
    AND column_name IN ('vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_color',
                       'self_contained', 'self_contained_expiry',
                       'is_compliant', 'is_breach', 'breach_type', 'breach_details')
  ) THEN
    RAISE NOTICE '❌ FAILED: vehicle_observations_v2 still contains duplicate/compliance columns';
    v_issue_count := v_issue_count + 1;
  ELSE
    RAISE NOTICE '✅ PASSED: vehicle_observations_v2 contains only observation data';
  END IF;
  
  -- Check for required columns (should exist)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_observations_v2' 
    AND column_name IN ('observation_id', 'plate_number', 'photo', 'recorded_at')
  ) THEN
    RAISE NOTICE '❌ FAILED: vehicle_observations_v2 missing required observation columns';
    v_issue_count := v_issue_count + 1;
  ELSE
    RAISE NOTICE '✅ PASSED: vehicle_observations_v2 has required observation columns';
  END IF;
  
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════
  -- CHECK 2: Orphaned Observations
  -- ═══════════════════════════════════════════════════════
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ CHECK 2: Orphaned Observations (Missing Canonical Records)';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  
  SELECT COUNT(*) INTO v_orphaned_obs
  FROM vehicle_observations_v2 obs
  LEFT JOIN canonical_vehicles cv ON obs.plate_number = cv.plate_number
  WHERE cv.plate_number IS NULL;
  
  SELECT COUNT(*) INTO v_total_obs
  FROM vehicle_observations_v2;
  
  IF v_orphaned_obs > 0 THEN
    RAISE NOTICE '❌ FAILED: Found % orphaned observations (out of % total)', v_orphaned_obs, v_total_obs;
    RAISE NOTICE '   🔧 Action: Run process to create canonical_vehicles for orphaned plates';
    v_issue_count := v_issue_count + 1;
  ELSE
    RAISE NOTICE '✅ PASSED: All % observations have canonical_vehicles records', v_total_obs;
  END IF;
  
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════
  -- CHECK 3: Compliance Results Coverage
  -- ═══════════════════════════════════════════════════════
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ CHECK 3: Compliance Results Coverage';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  
  SELECT COUNT(*) INTO v_missing_compliance
  FROM vehicle_observations_v2 obs
  LEFT JOIN compliance_results cr ON obs.observation_id = cr.observation_id
  WHERE cr.id IS NULL
    AND obs.recorded_at < NOW() - INTERVAL '1 hour';  -- Allow 1 hour grace period
  
  v_compliance_coverage := CASE 
    WHEN v_total_obs > 0 
    THEN ROUND(((v_total_obs - v_missing_compliance)::NUMERIC / v_total_obs) * 100, 2)
    ELSE 100
  END;
  
  RAISE NOTICE 'Total Observations: %', v_total_obs;
  RAISE NOTICE 'Missing Compliance Results: %', v_missing_compliance;
  RAISE NOTICE 'Coverage: %% %%', v_compliance_coverage;
  
  IF v_missing_compliance > v_total_obs * 0.1 THEN  -- More than 10% missing
    RAISE NOTICE '⚠️  WARNING: Low compliance results coverage (< 90%%)';
    RAISE NOTICE '   🔧 Action: Run compliance recalculation for recent observations';
    v_issue_count := v_issue_count + 1;
  ELSE
    RAISE NOTICE '✅ PASSED: Good compliance results coverage (≥ 90%%)';
  END IF;
  
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════
  -- CHECK 4: Compatibility View
  -- ═══════════════════════════════════════════════════════
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ CHECK 4: Compatibility View Functionality';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views 
    WHERE table_name = 'vehicle_observations_with_details'
  ) THEN
    RAISE NOTICE '❌ FAILED: vehicle_observations_with_details view not found';
    v_issue_count := v_issue_count + 1;
  ELSE
    RAISE NOTICE '✅ PASSED: vehicle_observations_with_details view exists';
    
    -- Test view query
    DECLARE
      v_view_test_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO v_view_test_count
      FROM vehicle_observations_with_details
      LIMIT 100;
      
      RAISE NOTICE '   ✅ View query successful (tested % rows)', v_view_test_count;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '   ❌ View query failed: %', SQLERRM;
      v_issue_count := v_issue_count + 1;
    END;
  END IF;
  
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════
  -- CHECK 5: Data Consistency Sample
  -- ═══════════════════════════════════════════════════════
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ CHECK 5: Data Consistency Sample (Recent 10 Observations)';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  
  DECLARE
    v_sample RECORD;
    v_sample_count INTEGER := 0;
  BEGIN
    FOR v_sample IN
      SELECT 
        obs.observation_id,
        obs.plate_number,
        obs.photo IS NOT NULL as has_photo,
        cv.vehicle_make IS NOT NULL as has_canonical_make,
        cr.is_compliant IS NOT NULL as has_compliance_result
      FROM vehicle_observations_v2 obs
      LEFT JOIN canonical_vehicles cv ON obs.plate_number = cv.plate_number
      LEFT JOIN compliance_results cr ON obs.observation_id = cr.observation_id
      ORDER BY obs.recorded_at DESC
      LIMIT 10
    LOOP
      v_sample_count := v_sample_count + 1;
      
      RAISE NOTICE '   Sample %: Plate % | Photo: % | Canonical: % | Compliance: %',
        v_sample_count,
        v_sample.plate_number,
        CASE WHEN v_sample.has_photo THEN '✅' ELSE '❌' END,
        CASE WHEN v_sample.has_canonical_make THEN '✅' ELSE '❌' END,
        CASE WHEN v_sample.has_compliance_result THEN '✅' ELSE '❌' END;
    END LOOP;
  END;
  
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════
  -- CHECK 6: Trigger Verification
  -- ═══════════════════════════════════════════════════════
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ CHECK 6: Trigger Configuration';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  
  -- Check for old trigger (should NOT exist)
  IF EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'trigger_create_breach_alert'
    AND event_object_table = 'vehicle_observations_v2'
  ) THEN
    RAISE NOTICE '❌ FAILED: Old trigger_create_breach_alert still exists on observations';
    RAISE NOTICE '   🔧 Action: Drop old trigger from vehicle_observations_v2';
    v_issue_count := v_issue_count + 1;
  ELSE
    RAISE NOTICE '✅ PASSED: Old observation trigger removed';
  END IF;
  
  -- Check for new trigger (should exist)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'trigger_create_breach_alert_from_compliance'
    AND event_object_table = 'compliance_results'
  ) THEN
    RAISE NOTICE '❌ FAILED: New trigger_create_breach_alert_from_compliance not found on compliance_results';
    v_issue_count := v_issue_count + 1;
  ELSE
    RAISE NOTICE '✅ PASSED: New compliance-driven trigger configured';
  END IF;
  
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════
  -- CHECK 7: Canonical Vehicles Stats
  -- ═══════════════════════════════════════════════════════
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ CHECK 7: Canonical Vehicles Health';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  
  SELECT COUNT(*) INTO v_total_canonical
  FROM canonical_vehicles;
  
  DECLARE
    v_enriched INTEGER;
    v_homeless INTEGER;
    v_flagged INTEGER;
  BEGIN
    SELECT 
      COUNT(*) FILTER (WHERE vehicle_make IS NOT NULL) INTO v_enriched
    FROM canonical_vehicles;
    
    SELECT COUNT(*) INTO v_homeless
    FROM canonical_vehicles
    WHERE homeless_status IN ('confirmed', 'claimed');
    
    SELECT COUNT(*) INTO v_flagged
    FROM canonical_vehicles
    WHERE is_flagged = true;
    
    RAISE NOTICE 'Total Canonical Vehicles: %', v_total_canonical;
    RAISE NOTICE 'Enriched (has make): % (%%)', v_enriched, ROUND((v_enriched::NUMERIC / v_total_canonical) * 100, 1);
    RAISE NOTICE 'Homeless Status: %', v_homeless;
    RAISE NOTICE 'Flagged Vehicles: %', v_flagged;
  END;
  
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════
  -- FINAL SUMMARY
  -- ═══════════════════════════════════════════════════════
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '📊 VERIFICATION SUMMARY';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  IF v_issue_count = 0 THEN
    RAISE NOTICE '✅✅✅ ALL CHECKS PASSED ✅✅✅';
    RAISE NOTICE '';
    RAISE NOTICE 'Architecture migration successful:';
    RAISE NOTICE '  - Observations contain ONLY observation data';
    RAISE NOTICE '  - Vehicle details in canonical_vehicles';
    RAISE NOTICE '  - Compliance results in compliance_results';
    RAISE NOTICE '  - Clean separation achieved';
  ELSE
    RAISE NOTICE '⚠️  FOUND % ISSUE(S) - REVIEW REQUIRED', v_issue_count;
    RAISE NOTICE '';
    RAISE NOTICE 'Please review the checks above and take corrective actions.';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  
END;
$$;
