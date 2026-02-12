-- =====================================================
-- SELF-CONTAINED STATUS CONFIDENCE REPORT
-- =====================================================
-- Purpose: Find vehicles with potentially incorrect self-contained status
-- Use Case: Identify vehicles like BKN780 (van marked as non-SC when it IS SC)
-- Logic: If vehicle type is "van" or "motorhome" but marked non-SC, flag for review
-- =====================================================

DO $$
DECLARE
  v_vehicle RECORD;
  v_suspect_count INTEGER := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'SELF-CONTAINED STATUS CONFIDENCE REPORT';
  RAISE NOTICE 'Generated: %', NOW();
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Analyzing vehicles where SC status may be incorrect...';
  RAISE NOTICE '';
  
  -- CATEGORY 1: Vans marked as non-SC (likely incorrect)
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '📦 VANS MARKED AS NON-SELF-CONTAINED';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  
  FOR v_vehicle IN
    SELECT 
      cv.plate_number,
      cv.vehicle_make,
      cv.vehicle_model,
      cv.vehicle_year,
      cv.vehicle_color,
      cv.self_contained,
      cv.total_observations,
      cv.profile_photo,
      cv.last_seen_at,
      COUNT(DISTINCT vo.observation_id) FILTER (WHERE vo.recorded_at >= NOW() - INTERVAL '90 days') as scans_last_90d
    FROM canonical_vehicles cv
    LEFT JOIN vehicle_observations_v2 vo ON cv.plate_number = vo.plate_number
    WHERE cv.self_contained = false
      AND (
        cv.vehicle_make ILIKE '%van%' 
        OR cv.vehicle_model ILIKE '%van%'
        OR cv.vehicle_model ILIKE '%camper%'
        OR cv.vehicle_model ILIKE '%motor%home%'
      )
      AND cv.total_observations >= 2  -- At least 2 scans
    GROUP BY 
      cv.plate_number, cv.vehicle_make, cv.vehicle_model, cv.vehicle_year,
      cv.vehicle_color, cv.self_contained, cv.total_observations,
      cv.profile_photo, cv.last_seen_at
    ORDER BY cv.total_observations DESC
  LOOP
    v_suspect_count := v_suspect_count + 1;
    
    RAISE NOTICE '⚠️  %', v_vehicle.plate_number;
    RAISE NOTICE '   Make/Model: % %', 
      COALESCE(v_vehicle.vehicle_make, 'Unknown'), 
      COALESCE(v_vehicle.vehicle_model, 'Unknown');
    RAISE NOTICE '   Year/Color: % %', 
      COALESCE(v_vehicle.vehicle_year::TEXT, 'Unknown'),
      COALESCE(v_vehicle.vehicle_color, 'Unknown');
    RAISE NOTICE '   Total Scans: % (% in last 90 days)', 
      v_vehicle.total_observations,
      v_vehicle.scans_last_90d;
    RAISE NOTICE '   Last Seen: %', v_vehicle.last_seen_at;
    RAISE NOTICE '   Profile Photo: %', 
      CASE WHEN v_vehicle.profile_photo IS NOT NULL THEN '✅ Available' ELSE '❌ Missing' END;
    RAISE NOTICE '   🔧 Action: Review vehicle - likely needs SC certification';
    RAISE NOTICE '';
  END LOOP;
  
  IF v_suspect_count = 0 THEN
    RAISE NOTICE '✅ No vans found with suspicious non-SC status';
    RAISE NOTICE '';
  END IF;
  
  -- CATEGORY 2: Vehicles with contradictory SC observations
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '🔄 VEHICLES WITH MIXED SC STATUS HISTORY';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  RAISE NOTICE 'Finding vehicles where SC status changed between scans...';
  RAISE NOTICE '(This indicates potential data entry errors)';
  RAISE NOTICE '';
  
  -- Note: This query would need historical SC data from observations
  -- Since we removed self_contained from observations, we can't detect historical changes
  -- Instead, flag vehicles with frequent observations but no SC certification
  
  FOR v_vehicle IN
    SELECT 
      cv.plate_number,
      cv.vehicle_make,
      cv.vehicle_model,
      cv.self_contained,
      cv.self_contained_expiry,
      cv.total_observations,
      cv.last_seen_at,
      COUNT(DISTINCT vo.zone_id) as zones_visited
    FROM canonical_vehicles cv
    LEFT JOIN vehicle_observations_v2 vo ON cv.plate_number = vo.plate_number
    WHERE cv.total_observations >= 5  -- Frequent visitor
      AND cv.self_contained = false    -- Not SC
      AND cv.vehicle_make IS NOT NULL  -- Has vehicle details
      AND (
        cv.vehicle_make NOT ILIKE '%car%'
        AND cv.vehicle_make NOT ILIKE '%sedan%'
        AND cv.vehicle_make NOT ILIKE '%wagon%'
      )
    GROUP BY 
      cv.plate_number, cv.vehicle_make, cv.vehicle_model,
      cv.self_contained, cv.self_contained_expiry,
      cv.total_observations, cv.last_seen_at
    HAVING COUNT(DISTINCT vo.zone_id) >= 2  -- Visited multiple zones
    ORDER BY cv.total_observations DESC
    LIMIT 20
  LOOP
    RAISE NOTICE '⚠️  %', v_vehicle.plate_number;
    RAISE NOTICE '   Vehicle: % %', 
      COALESCE(v_vehicle.vehicle_make, 'Unknown'),
      COALESCE(v_vehicle.vehicle_model, 'Unknown');
    RAISE NOTICE '   Total Scans: % | Zones Visited: %',
      v_vehicle.total_observations,
      v_vehicle.zones_visited;
    RAISE NOTICE '   SC Status: % | Expiry: %',
      CASE WHEN v_vehicle.self_contained THEN 'YES' ELSE 'NO' END,
      COALESCE(v_vehicle.self_contained_expiry::TEXT, 'N/A');
    RAISE NOTICE '   Last Seen: %', v_vehicle.last_seen_at;
    RAISE NOTICE '   🔧 Action: Frequent visitor without SC - verify status';
    RAISE NOTICE '';
  END LOOP;
  
  -- CATEGORY 3: Expired SC certifications
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '⏰ EXPIRED SELF-CONTAINED CERTIFICATIONS';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  
  FOR v_vehicle IN
    SELECT 
      cv.plate_number,
      cv.vehicle_make,
      cv.vehicle_model,
      cv.self_contained_expiry,
      cv.total_observations,
      cv.last_seen_at,
      (cv.self_contained_expiry - CURRENT_DATE) as days_expired
    FROM canonical_vehicles cv
    WHERE cv.self_contained = true
      AND cv.self_contained_expiry < CURRENT_DATE
      AND cv.last_seen_at >= NOW() - INTERVAL '30 days'  -- Active in last 30 days
    ORDER BY cv.self_contained_expiry ASC
  LOOP
    RAISE NOTICE '⚠️  %', v_vehicle.plate_number;
    RAISE NOTICE '   Vehicle: % %',
      COALESCE(v_vehicle.vehicle_make, 'Unknown'),
      COALESCE(v_vehicle.vehicle_model, 'Unknown');
    RAISE NOTICE '   SC Expired: % (% days ago)',
      v_vehicle.self_contained_expiry,
      ABS(v_vehicle.days_expired);
    RAISE NOTICE '   Last Seen: %', v_vehicle.last_seen_at;
    RAISE NOTICE '   🔧 Action: Mark as non-SC or request renewed certification';
    RAISE NOTICE '';
  END LOOP;
  
  -- SUMMARY
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'SUMMARY & RECOMMENDATIONS';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 RECOMMENDED ACTIONS:';
  RAISE NOTICE '   1. Review all flagged vehicles in Admin Portal → Data Management Hub → Vehicles';
  RAISE NOTICE '   2. For vans/motorhomes marked non-SC: Verify with photo evidence';
  RAISE NOTICE '   3. For expired certifications: Request renewed SC sticker or mark non-SC';
  RAISE NOTICE '   4. For frequent visitors: Cross-reference with NZSCV database';
  RAISE NOTICE '';
  RAISE NOTICE '✅ To fix a vehicle (e.g., BKN780):';
  RAISE NOTICE '   UPDATE canonical_vehicles';
  RAISE NOTICE '   SET self_contained = true,';
  RAISE NOTICE '       self_contained_expiry = ''2025-12-31''';
  RAISE NOTICE '   WHERE plate_number = ''BKN780'';';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END;
$$;

-- EXPORT SUSPECT VEHICLES TO CSV (OPTIONAL)
-- Uncomment to export flagged vehicles for Excel review
/*
COPY (
  SELECT 
    cv.plate_number,
    cv.vehicle_make,
    cv.vehicle_model,
    cv.vehicle_year,
    cv.vehicle_color,
    cv.self_contained as "Currently SC?",
    cv.self_contained_expiry as "SC Expiry",
    cv.total_observations as "Total Scans",
    cv.last_seen_at as "Last Seen",
    CASE 
      WHEN cv.profile_photo IS NOT NULL THEN 'Yes'
      ELSE 'No'
    END as "Has Photo?",
    CASE
      WHEN cv.vehicle_make ILIKE '%van%' OR cv.vehicle_model ILIKE '%van%' THEN 'Likely SC Required'
      WHEN cv.self_contained_expiry < CURRENT_DATE THEN 'Expired SC'
      WHEN cv.total_observations >= 5 AND cv.self_contained = false THEN 'Frequent Non-SC'
      ELSE 'Review'
    END as "Issue Type"
  FROM canonical_vehicles cv
  WHERE (
    -- Vans marked non-SC
    (cv.self_contained = false AND (
      cv.vehicle_make ILIKE '%van%' OR 
      cv.vehicle_model ILIKE '%van%' OR
      cv.vehicle_model ILIKE '%camper%'
    ))
    -- OR expired SC
    OR (cv.self_contained = true AND cv.self_contained_expiry < CURRENT_DATE)
    -- OR frequent visitors without SC
    OR (cv.total_observations >= 5 AND cv.self_contained = false)
  )
  ORDER BY cv.total_observations DESC
) TO '/tmp/sc_status_suspects.csv' WITH CSV HEADER;
*/
