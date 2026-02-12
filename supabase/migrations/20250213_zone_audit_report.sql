-- =====================================================
-- ZONE COMPLIANCE MATRIX AUDIT REPORT
-- =====================================================
-- Purpose: Generate comprehensive audit of all zone compliance rules
-- Use Case: Verify Akerston/Kinzett have correct "no overnight" rules
-- Output: Full compliance matrix for all active zones
-- =====================================================

DO $$
DECLARE
  v_zone RECORD;
  v_issue_count INTEGER := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'ZONE COMPLIANCE MATRIX AUDIT REPORT';
  RAISE NOTICE 'Generated: %', NOW();
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  
  FOR v_zone IN
    SELECT 
      z.name,
      z.organization_id,
      o.name as org_name,
      z.zone_type,
      z.is_active,
      zcm.version,
      zcm.self_contained_required,
      zcm.nights_per_month,
      zcm.max_consecutive_nights,
      zcm.day_visit_only,
      zcm.homeless_exemption,
      zcm.allowed_days,
      zcm.effective_from,
      zcm.created_by,
      up.first_name || ' ' || up.last_name as created_by_name,
      COUNT(DISTINCT vo.observation_id) as total_observations
    FROM zones z
    LEFT JOIN organizations o ON z.organization_id = o.id
    LEFT JOIN zone_compliance_matrix zcm ON z.id = zcm.zone_id 
      AND zcm.effective_to IS NULL
    LEFT JOIN user_profiles up ON zcm.created_by = up.id
    LEFT JOIN vehicle_observations_v2 vo ON vo.zone_id = z.id
      AND vo.recorded_at >= NOW() - INTERVAL '30 days'
    WHERE z.is_active = true
    GROUP BY 
      z.name, z.organization_id, o.name, z.zone_type, z.is_active,
      zcm.version, zcm.self_contained_required, zcm.nights_per_month,
      zcm.max_consecutive_nights, zcm.day_visit_only, zcm.homeless_exemption,
      zcm.allowed_days, zcm.effective_from, zcm.created_by,
      up.first_name, up.last_name
    ORDER BY z.name
  LOOP
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE '📍 ZONE: %', v_zone.name;
    RAISE NOTICE '   Organization: %', COALESCE(v_zone.org_name, 'Unknown');
    RAISE NOTICE '   Type: % | Active: %', v_zone.zone_type, v_zone.is_active;
    RAISE NOTICE '   Recent Activity: % observations (last 30 days)', v_zone.total_observations;
    
    IF v_zone.version IS NULL THEN
      RAISE NOTICE '';
      RAISE NOTICE '   ⚠️  WARNING: NO COMPLIANCE MATRIX DEFINED';
      RAISE NOTICE '   🔧 Action Required: Create compliance matrix for this zone';
      v_issue_count := v_issue_count + 1;
    ELSE
      RAISE NOTICE '';
      RAISE NOTICE '   📋 COMPLIANCE RULES (Version %)', v_zone.version;
      RAISE NOTICE '   ├─ Self-Contained Required: %', v_zone.self_contained_required;
      RAISE NOTICE '   ├─ Max Nights/Month: %', v_zone.nights_per_month;
      RAISE NOTICE '   ├─ Max Consecutive Nights: %', v_zone.max_consecutive_nights;
      RAISE NOTICE '   ├─ Day Visit Only: %', v_zone.day_visit_only;
      RAISE NOTICE '   ├─ Homeless Exemption: %', v_zone.homeless_exemption;
      RAISE NOTICE '   ├─ Allowed Days: %', v_zone.allowed_days;
      RAISE NOTICE '   ├─ Effective From: %', v_zone.effective_from;
      RAISE NOTICE '   └─ Created By: %', COALESCE(v_zone.created_by_name, 'Unknown');
      
      -- VALIDATE RULES FOR SPECIFIC ZONES
      IF v_zone.name ILIKE '%akerston%' OR v_zone.name ILIKE '%kinzett%' THEN
        RAISE NOTICE '';
        RAISE NOTICE '   🔍 VALIDATION: "No Overnight" Zone';
        
        IF v_zone.nights_per_month > 0 THEN
          RAISE NOTICE '   ❌ ISSUE: nights_per_month = % (should be 0)', v_zone.nights_per_month;
          v_issue_count := v_issue_count + 1;
        ELSE
          RAISE NOTICE '   ✅ nights_per_month = 0';
        END IF;
        
        IF v_zone.max_consecutive_nights > 0 THEN
          RAISE NOTICE '   ❌ ISSUE: max_consecutive_nights = % (should be 0)', v_zone.max_consecutive_nights;
          v_issue_count := v_issue_count + 1;
        ELSE
          RAISE NOTICE '   ✅ max_consecutive_nights = 0';
        END IF;
        
        IF v_zone.day_visit_only != true THEN
          RAISE NOTICE '   ❌ ISSUE: day_visit_only = % (should be true)', v_zone.day_visit_only;
          v_issue_count := v_issue_count + 1;
        ELSE
          RAISE NOTICE '   ✅ day_visit_only = true';
        END IF;
        
      ELSIF v_zone.name ILIKE '%qeii%' OR v_zone.name ILIKE '%city%' THEN
        RAISE NOTICE '';
        RAISE NOTICE '   🔍 VALIDATION: "Overnight Allowed" Zone';
        
        IF v_zone.nights_per_month = 0 THEN
          RAISE NOTICE '   ⚠️  POTENTIAL ISSUE: nights_per_month = 0 (usually 28 for QEII/City)';
        ELSE
          RAISE NOTICE '   ✅ nights_per_month = %', v_zone.nights_per_month;
        END IF;
        
        IF v_zone.day_visit_only = true THEN
          RAISE NOTICE '   ⚠️  POTENTIAL ISSUE: day_visit_only = true (usually false for QEII/City)';
        ELSE
          RAISE NOTICE '   ✅ day_visit_only = false (overnight allowed)';
        END IF;
      END IF;
    END IF;
    
    RAISE NOTICE '';
  END LOOP;
  
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'AUDIT SUMMARY';
  RAISE NOTICE '========================================';
  
  IF v_issue_count = 0 THEN
    RAISE NOTICE '✅ No issues found - all zones configured correctly';
  ELSE
    RAISE NOTICE '⚠️  Found % configuration issue(s)', v_issue_count;
    RAISE NOTICE '';
    RAISE NOTICE '🔧 RECOMMENDED ACTIONS:';
    RAISE NOTICE '   1. Review zones marked with ❌ above';
    RAISE NOTICE '   2. Update compliance matrix in Admin Portal → Data Management Hub';
    RAISE NOTICE '   3. Run recalculation after fixing rules';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END;
$$;

-- EXPORT COMPLIANCE MATRIX TO CSV (OPTIONAL)
-- Uncomment and run this query to export to CSV format for Excel review
/*
COPY (
  SELECT 
    z.name as zone_name,
    o.name as organization,
    z.zone_type,
    zcm.self_contained_required as "SC Required?",
    zcm.nights_per_month as "Max Nights/Month",
    zcm.max_consecutive_nights as "Max Consecutive",
    zcm.day_visit_only as "Day Visit Only?",
    zcm.homeless_exemption as "Homeless Exempt?",
    zcm.allowed_days as "Allowed Days",
    zcm.version,
    zcm.effective_from,
    up.first_name || ' ' || up.last_name as created_by
  FROM zones z
  LEFT JOIN organizations o ON z.organization_id = o.id
  LEFT JOIN zone_compliance_matrix zcm ON z.id = zcm.zone_id 
    AND zcm.effective_to IS NULL
  LEFT JOIN user_profiles up ON zcm.created_by = up.id
  WHERE z.is_active = true
  ORDER BY z.name
) TO '/tmp/zone_compliance_audit.csv' WITH CSV HEADER;
*/
