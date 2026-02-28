-- ============================================================================
-- FIX: Zone Type Constraint Violation
-- ============================================================================
-- Error: new row for relation "zones" violates check constraint "zones_zone_type_check"
-- 
-- This fixes the zone_type constraint to allow both 'general' and 'specific'
-- ============================================================================

-- Drop existing constraint if it exists
ALTER TABLE zones DROP CONSTRAINT IF EXISTS zones_zone_type_check;

-- Add correct constraint allowing both 'general' and 'specific'
ALTER TABLE zones ADD CONSTRAINT zones_zone_type_check 
  CHECK (zone_type IN ('general', 'specific'));

-- Update any NULL values to 'specific' (default for child zones)
UPDATE zones 
SET zone_type = 'specific' 
WHERE zone_type IS NULL;

-- Verify the fix
SELECT 
  id,
  name,
  zone_type,
  parent_zone_id,
  organization_id
FROM zones
WHERE zone_type IS NOT NULL
ORDER BY zone_type DESC, name;

-- Expected Results:
-- - 'general' zones should appear first (parent/jurisdiction zones)
-- - 'specific' zones should follow (enforcement zones)
-- - "Other Location" zones should be 'general'
