-- Migration: Add sticky photo behavior and AI vehicle analysis
-- Ensures profile photos persist and vehicle details are analyzed once

-- Add comment to document sticky photo behavior
COMMENT ON COLUMN canonical_vehicles.profile_photo_url IS 'AI-selected best vehicle photo URL (sticky - only set once unless forced update)';

-- Add function to check if vehicle needs analysis
CREATE OR REPLACE FUNCTION should_analyze_vehicle(p_vehicle_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM canonical_vehicles
    WHERE vehicle_id = p_vehicle_id
    AND vehicle_make IS NOT NULL
    AND vehicle_model IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment
COMMENT ON FUNCTION should_analyze_vehicle IS 'Checks if a vehicle needs AI analysis (true if make/model are missing)';
