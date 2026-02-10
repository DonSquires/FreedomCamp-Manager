-- =====================================================
-- UPDATE REPORTS - Enhanced Compliance Matrix Support
-- Migration Date: 2025-01-29
-- =====================================================
-- 
-- This migration updates reporting views and adds helper functions
-- to support the new enhanced compliance fields:
-- - after_hours_violation (time-based)
-- - stay_confirmed_by_gps (GPS-based stay confirmation)
-- - gps_distance_meters (movement tracking)
-- 
-- Changes:
-- 1. Add breach_summary helper function for readable violation types
-- 2. Create violation statistics view
-- 3. Add indexes for new compliance fields
-- =====================================================

-- 1. CREATE helper function to format violation reasons as human-readable text
CREATE OR REPLACE FUNCTION format_violation_reasons(
  violation_reasons TEXT[],
  after_hours BOOLEAN DEFAULT FALSE,
  gps_confirmed BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_summary TEXT := '';
BEGIN
  IF violation_reasons IS NULL OR array_length(violation_reasons, 1) IS NULL THEN
    RETURN 'Compliant';
  END IF;

  -- Build summary from violation reasons
  v_summary := array_to_string(
    ARRAY(
      SELECT CASE reason
        WHEN 'possible_stay_violation' THEN '🌙 Possible overnight stay (observed after 21:00)'
        WHEN 'possible_zone_violation' THEN '⚠️ Possible zone violation (limits reached + after hours)'
        WHEN 'confirmed_stay_violation' THEN '🔴 Confirmed stay violation (GPS: vehicle hasn''t moved)'
        WHEN 'monthly_limit_exceeded' THEN '📅 Monthly limit exceeded'
        WHEN 'consecutive_nights_exceeded' THEN '⏰ Consecutive nights exceeded'
        WHEN 'not_self_contained' THEN '🚫 Not self-contained'
        WHEN 'not_self_contained_possible_stay_violation' THEN '🚫🌙 Not self-contained + Possible stay'
        WHEN 'not_self_contained_confirmed_stay_violation' THEN '🚫🔴 Not self-contained + Confirmed stay'
        ELSE reason
      END
      FROM unnest(violation_reasons) AS reason
    ),
    ', '
  );

  -- Add GPS confirmation badge if applicable
  IF gps_confirmed = TRUE THEN
    v_summary := '📍 GPS CONFIRMED: ' || v_summary;
  END IF;

  -- Add after-hours badge if applicable
  IF after_hours = TRUE THEN
    v_summary := v_summary || ' [After 21:00]';
  END IF;

  RETURN v_summary;
END;
$$;

COMMENT ON FUNCTION format_violation_reasons IS 'Converts violation_reasons array into human-readable summary text with emojis for quick scanning';

-- 2. CREATE materialized view for violation statistics (refreshed nightly)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_violation_statistics AS
SELECT
  cr.zone_id,
  z.name as zone_name,
  z.organization_id,
  cr.evaluated_at::date as evaluation_date,
  
  -- Total counts
  COUNT(*) as total_evaluations,
  COUNT(*) FILTER (WHERE cr.is_compliant = true) as compliant_count,
  COUNT(*) FILTER (WHERE cr.is_compliant = false) as non_compliant_count,
  
  -- New enhanced violation counts
  COUNT(*) FILTER (WHERE cr.after_hours_violation = true) as after_hours_count,
  COUNT(*) FILTER (WHERE cr.stay_confirmed_by_gps = true) as gps_confirmed_stays,
  
  -- Violation type breakdown
  COUNT(*) FILTER (WHERE 'possible_stay_violation' = ANY(cr.violation_reasons)) as possible_stay_violations,
  COUNT(*) FILTER (WHERE 'possible_zone_violation' = ANY(cr.violation_reasons)) as possible_zone_violations,
  COUNT(*) FILTER (WHERE 'confirmed_stay_violation' = ANY(cr.violation_reasons)) as confirmed_stay_violations,
  COUNT(*) FILTER (WHERE 'monthly_limit_exceeded' = ANY(cr.violation_reasons)) as monthly_limit_violations,
  COUNT(*) FILTER (WHERE 'consecutive_nights_exceeded' = ANY(cr.violation_reasons)) as consecutive_violations,
  COUNT(*) FILTER (WHERE 'not_self_contained' = ANY(cr.violation_reasons)) as not_self_contained_violations,
  
  -- GPS distance metrics
  AVG(cr.gps_distance_meters) FILTER (WHERE cr.gps_distance_meters IS NOT NULL) as avg_gps_distance,
  MIN(cr.gps_distance_meters) FILTER (WHERE cr.gps_distance_meters IS NOT NULL) as min_gps_distance,
  MAX(cr.gps_distance_meters) FILTER (WHERE cr.gps_distance_meters IS NOT NULL) as max_gps_distance,
  
  -- Compliance rate
  ROUND(
    (COUNT(*) FILTER (WHERE cr.is_compliant = true)::NUMERIC / COUNT(*)::NUMERIC) * 100,
    2
  ) as compliance_rate_percent

FROM compliance_results cr
JOIN zones z ON z.id = cr.zone_id
GROUP BY cr.zone_id, z.name, z.organization_id, cr.evaluated_at::date
ORDER BY cr.evaluated_at::date DESC, z.name;

COMMENT ON MATERIALIZED VIEW mv_violation_statistics IS 'Aggregated violation statistics by zone and date with enhanced GPS/time-based metrics';

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_mv_violation_stats_zone_date 
ON mv_violation_statistics(zone_id, evaluation_date DESC);

CREATE INDEX IF NOT EXISTS idx_mv_violation_stats_org_date 
ON mv_violation_statistics(organization_id, evaluation_date DESC);

-- 3. ADD performance indices for new compliance fields
CREATE INDEX IF NOT EXISTS idx_compliance_results_after_hours 
ON compliance_results(after_hours_violation) 
WHERE after_hours_violation = TRUE;

CREATE INDEX IF NOT EXISTS idx_compliance_results_gps_confirmed 
ON compliance_results(stay_confirmed_by_gps) 
WHERE stay_confirmed_by_gps = TRUE;

CREATE INDEX IF NOT EXISTS idx_compliance_results_gps_distance 
ON compliance_results(gps_distance_meters) 
WHERE gps_distance_meters IS NOT NULL;

-- 4. CREATE refresh function for violation statistics
CREATE OR REPLACE FUNCTION refresh_violation_statistics()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_violation_statistics;
  RAISE NOTICE '✅ Violation statistics refreshed at %', NOW();
END;
$$;

COMMENT ON FUNCTION refresh_violation_statistics IS 'Refreshes mv_violation_statistics materialized view - run nightly or after major recalculations';

-- 5. AUDIT LOG
INSERT INTO audit_log (
  action,
  entity_type,
  entity_id,
  new_values,
  created_at
) VALUES (
  'MIGRATION_APPLIED',
  'database',
  '20250129_update_reports_enhanced_compliance',
  jsonb_build_object(
    'description', 'Updated reporting infrastructure for enhanced compliance matrix',
    'changes', jsonb_build_array(
      'Created format_violation_reasons() helper function',
      'Created mv_violation_statistics materialized view',
      'Added performance indices for after_hours_violation, stay_confirmed_by_gps, gps_distance_meters',
      'Created refresh_violation_statistics() function for nightly refresh'
    )
  ),
  NOW()
);

-- =====================================================
-- END OF MIGRATION
-- =====================================================
