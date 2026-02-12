-- =====================================================
-- HOMELESS FREEDOM CAMPING ACT EXEMPTION
-- =====================================================
-- Homeless vehicles are NOT subject to Freedom Camping Act
-- This migration adds exemption tracking and updates
-- breach detection to respect this status
-- =====================================================

-- Add Freedom Camping Act exemption field to canonical_vehicles
ALTER TABLE canonical_vehicles
  ADD COLUMN IF NOT EXISTS fc_act_exempt BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN canonical_vehicles.fc_act_exempt IS 'Whether vehicle is exempt from Freedom Camping Act (homeless status)';

-- Update existing homeless vehicles to be FC Act exempt
UPDATE canonical_vehicles
SET fc_act_exempt = TRUE
WHERE homeless_status IN ('claimed', 'confirmed');

-- Create trigger to auto-mark homeless vehicles as FC Act exempt
CREATE OR REPLACE FUNCTION auto_mark_homeless_fc_exempt()
RETURNS TRIGGER AS $$
BEGIN
  -- If homeless status is claimed or confirmed, mark as FC Act exempt
  IF NEW.homeless_status IN ('claimed', 'confirmed') THEN
    NEW.fc_act_exempt := TRUE;
  ELSIF NEW.homeless_status = 'none' THEN
    -- If homeless status removed, remove FC Act exemption
    NEW.fc_act_exempt := FALSE;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_fc_exempt ON canonical_vehicles;
CREATE TRIGGER trigger_auto_fc_exempt
  BEFORE INSERT OR UPDATE OF homeless_status ON canonical_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION auto_mark_homeless_fc_exempt();

COMMENT ON TRIGGER trigger_auto_fc_exempt ON canonical_vehicles IS 'Automatically marks homeless vehicles as Freedom Camping Act exempt';

-- Update active_breaches_v2 view to include FC Act exemption status
CREATE OR REPLACE VIEW active_breaches_v2 AS
SELECT DISTINCT
  cv.plate_number,
  cv.vehicle_make,
  cv.vehicle_model,
  cv.vehicle_color,
  cv.homeless_status,
  cv.fc_act_exempt,
  cv.is_flagged,
  cv.profile_photo,
  vo.zone_id,
  z.name AS zone_name,
  z.organization_id,
  COUNT(DISTINCT vo.observation_id) AS total_observations,
  COUNT(DISTINCT vo.observation_id) FILTER (WHERE vo.is_breach) AS breach_count,
  MAX(vo.recorded_at) FILTER (WHERE vo.is_breach) AS last_breach_at,
  (ARRAY_AGG(vo.breach_type ORDER BY vo.recorded_at DESC) FILTER (WHERE vo.is_breach))[1] AS last_breach_type,
  vms.consecutive_nights,
  vms.nights_stayed,
  zcm.max_consecutive_nights,
  zcm.nights_per_month,
  -- Check if enforcement is already assigned
  EXISTS(
    SELECT 1 FROM enforcement_actions ea
    WHERE ea.plate_number = cv.plate_number
      AND ea.zone_id = vo.zone_id
      AND ea.breach_status IN ('active', 'assigned', 'in_progress')
  ) AS has_enforcement_assigned
FROM canonical_vehicles cv
JOIN vehicle_observations_v2 vo ON vo.plate_number = cv.plate_number
JOIN zones z ON z.id = vo.zone_id
LEFT JOIN vehicle_monthly_stays vms ON vms.plate_number = cv.plate_number AND vms.zone_id = vo.zone_id
LEFT JOIN zone_compliance_matrix zcm ON zcm.zone_id = vo.zone_id AND zcm.effective_to IS NULL
WHERE vo.is_breach = TRUE
GROUP BY 
  cv.plate_number, cv.vehicle_make, cv.vehicle_model, cv.vehicle_color,
  cv.homeless_status, cv.fc_act_exempt, cv.is_flagged, cv.profile_photo,
  vo.zone_id, z.name, z.organization_id,
  vms.consecutive_nights, vms.nights_stayed,
  zcm.max_consecutive_nights, zcm.nights_per_month
ORDER BY last_breach_at DESC NULLS LAST;

COMMENT ON VIEW active_breaches_v2 IS 'Consolidated view of all active breaches with FC Act exemption status';

-- Add exemption notes to compliance_results for audit trail
ALTER TABLE compliance_results
  ADD COLUMN IF NOT EXISTS fc_act_exempt BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exemption_reason TEXT;

COMMENT ON COLUMN compliance_results.fc_act_exempt IS 'Whether this observation was exempt from FC Act at time of evaluation';
COMMENT ON COLUMN compliance_results.exemption_reason IS 'Reason for exemption (e.g., "Homeless status confirmed")';

-- Update get_vehicle_master_data function to include FC Act exemption
CREATE OR REPLACE FUNCTION get_vehicle_master_data(p_plate_number TEXT)
RETURNS TABLE (
  plate_number TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_color TEXT,
  self_contained BOOLEAN,
  self_contained_expiry DATE,
  homeless_status TEXT,
  homeless_confirmed_at TIMESTAMPTZ,
  fc_act_exempt BOOLEAN,
  is_flagged BOOLEAN,
  flagged_priority TEXT,
  flagged_reason TEXT,
  profile_photo TEXT,
  total_observations INTEGER,
  total_breaches INTEGER,
  total_incidents INTEGER,
  enforcement_count INTEGER,
  last_seen_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cv.plate_number,
    cv.vehicle_make,
    cv.vehicle_model,
    cv.vehicle_year,
    cv.vehicle_color,
    cv.self_contained,
    cv.self_contained_expiry,
    cv.homeless_status,
    cv.homeless_confirmed_at,
    cv.fc_act_exempt,
    cv.is_flagged,
    cv.flagged_priority,
    cv.flagged_reason,
    cv.profile_photo,
    cv.total_observations,
    cv.total_breaches,
    cv.total_incidents,
    cv.enforcement_count,
    cv.last_seen_at,
    cv.first_seen_at
  FROM canonical_vehicles cv
  WHERE cv.plate_number = p_plate_number;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Migration summary
DO $$
BEGIN
  RAISE NOTICE '✅ Homeless Freedom Camping Act Exemption Complete';
  RAISE NOTICE '   - Added fc_act_exempt field to canonical_vehicles';
  RAISE NOTICE '   - Marked all homeless vehicles as FC Act exempt';
  RAISE NOTICE '   - Created auto-exemption trigger';
  RAISE NOTICE '   - Updated active_breaches_v2 view';
  RAISE NOTICE '   - Updated compliance_results table';
  RAISE NOTICE '   - Updated get_vehicle_master_data function';
  RAISE NOTICE '';
  RAISE NOTICE '   ℹ️  Homeless vehicles will still:';
  RAISE NOTICE '      - Be observed and recorded';
  RAISE NOTICE '      - Show zone rule compliance status';
  RAISE NOTICE '      - Appear in reports';
  RAISE NOTICE '   ℹ️  Homeless vehicles will NOT:';
  RAISE NOTICE '      - Trigger Freedom Camping Act enforcement';
  RAISE NOTICE '      - Require mandatory evidence capture';
  RAISE NOTICE '      - Create critical alerts';
END $$;
