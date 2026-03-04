-- =====================================================
-- CRITICAL FIXES - Database Schema & Performance
-- Migration Date: 2025-01-27
-- =====================================================

-- 1. FIX: Add public SELECT policy for incident-evidence bucket
-- Allows public access to court-ready evidence photos
-- DROP first for idempotency (CREATE POLICY IF NOT EXISTS is not valid PostgreSQL syntax)
DROP POLICY IF EXISTS "Allow public reads for incident evidence" ON storage.objects;

CREATE POLICY "Allow public reads for incident evidence"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'incident-evidence');

-- 2. FIX: Add missing performance indices on vehicle_observations
CREATE INDEX IF NOT EXISTS idx_observations_recorded_by 
ON vehicle_observations(recorded_by);

CREATE INDEX IF NOT EXISTS idx_observations_is_compliant 
ON vehicle_observations(is_compliant);

-- 3. FIX: Add missing performance indices on compliance_results
CREATE INDEX IF NOT EXISTS idx_compliance_evaluated_at 
ON compliance_results(evaluated_at);

CREATE INDEX IF NOT EXISTS idx_compliance_org 
ON compliance_results(organization_id);

-- 4. ENHANCEMENT: Add gps_accuracy to vehicle_records for consistency
-- This aligns vehicle_records with other GPS-enabled tables
ALTER TABLE vehicle_records 
ADD COLUMN IF NOT EXISTS gps_accuracy NUMERIC(10, 2);

COMMENT ON COLUMN vehicle_records.gps_accuracy IS 'GPS accuracy in meters - matches vehicle_observations, plate_scans, incidents';

-- 5. FIX: Constrain patrol shift values to match UI/TypeScript expectations
-- Current: text (any value)
-- Required: 'day', 'night', 'morning', or 'afternoon'
-- Note: This is a soft constraint via CHECK - existing data migration may be needed
ALTER TABLE patrols 
DROP CONSTRAINT IF EXISTS patrols_shift_check;

ALTER TABLE patrols 
ADD CONSTRAINT patrols_shift_check 
CHECK (shift IN ('day', 'night', 'morning', 'afternoon'));

COMMENT ON COLUMN patrols.shift IS 'Patrol shift type - must be "day", "night", "morning", or "afternoon"';

-- 6. PERFORMANCE: Add composite indices for common query patterns
CREATE INDEX IF NOT EXISTS idx_observations_zone_date 
ON vehicle_observations(zone_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_zone_compliant 
ON compliance_results(zone_id, is_compliant);

CREATE INDEX IF NOT EXISTS idx_drift_events_zone_status 
ON drift_events(zone_id, status);

-- 7. DATA INTEGRITY: Add foreign key index for canonical_vehicles
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_plate 
ON canonical_vehicles(plate_number);

CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_flagged 
ON canonical_vehicles(is_flagged) WHERE is_flagged = true;

-- 8. AUDIT: Log this migration
INSERT INTO audit_log (
  action,
  entity_type,
  entity_id,
  new_values,
  created_at
) VALUES (
  'MIGRATION_APPLIED',
  'database',
  '20250127_critical_fixes',
  jsonb_build_object(
    'description', 'Critical fixes for type safety, performance, and data integrity',
    'fixes', jsonb_build_array(
      'Added public policy for incident-evidence bucket',
      'Added performance indices on vehicle_observations and compliance_results',
      'Added gps_accuracy to vehicle_records',
      'Constrained patrol shift values to day/night',
      'Added composite indices for common queries',
      'Added canonical_vehicles indices'
    )
  ),
  NOW()
);

-- =====================================================
-- END OF MIGRATION
-- =====================================================
