-- =====================================================
-- ENFORCEMENT WORKFLOW SYSTEM
-- =====================================================
-- Comprehensive enforcement job tracking with:
-- - Active breach management
-- - Job assignment to officers
-- - Completion tracking with "not on site" option
-- - Enforcement action tally per vehicle
-- =====================================================

-- Add enforcement tracking fields to canonical_vehicles
ALTER TABLE canonical_vehicles
  ADD COLUMN IF NOT EXISTS enforcement_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_enforcement_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_enforcement_type TEXT;

COMMENT ON COLUMN canonical_vehicles.enforcement_count IS 'Total tally of completed enforcement actions against this vehicle';
COMMENT ON COLUMN canonical_vehicles.last_enforcement_at IS 'Timestamp of most recent enforcement action';
COMMENT ON COLUMN canonical_vehicles.last_enforcement_type IS 'Type of last enforcement (warning, notice, tow, other)';

-- Add breach/job linking fields to enforcement_actions
ALTER TABLE enforcement_actions
  ADD COLUMN IF NOT EXISTS observation_id UUID REFERENCES observations(observation_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS compliance_result_id UUID REFERENCES compliance_results(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plate_number TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_outcome TEXT CHECK (completion_outcome IN ('completed', 'not_on_site', 'cancelled')),
  ADD COLUMN IF NOT EXISTS completion_notes TEXT,
  ADD COLUMN IF NOT EXISTS breach_status TEXT DEFAULT 'active' CHECK (breach_status IN ('active', 'assigned', 'in_progress', 'completed', 'not_on_site', 'cancelled'));

COMMENT ON COLUMN enforcement_actions.observation_id IS 'Links enforcement to specific observation that triggered breach';
COMMENT ON COLUMN enforcement_actions.compliance_result_id IS 'Links to compliance evaluation result';
COMMENT ON COLUMN enforcement_actions.plate_number IS 'Denormalized plate for quick queries';
COMMENT ON COLUMN enforcement_actions.assigned_to IS 'Officer assigned to handle this enforcement job';
COMMENT ON COLUMN enforcement_actions.breach_status IS 'Workflow status: active → assigned → in_progress → completed/not_on_site/cancelled';
COMMENT ON COLUMN enforcement_actions.completion_outcome IS 'How job was completed: completed, not_on_site, cancelled';

-- Create index for active breaches
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_breach_status ON enforcement_actions(breach_status);
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_assigned_to ON enforcement_actions(assigned_to);
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_plate ON enforcement_actions(plate_number);
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_observation ON enforcement_actions(observation_id);

-- Function: Auto-populate plate_number on INSERT
CREATE OR REPLACE FUNCTION set_enforcement_plate_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Get plate from vehicle_record if not already set
  IF NEW.plate_number IS NULL AND NEW.vehicle_record_id IS NOT NULL THEN
    SELECT plate_number INTO NEW.plate_number
    FROM vehicle_records
    WHERE id = NEW.vehicle_record_id;
  END IF;
  
  -- Get plate from observation if not already set
  IF NEW.plate_number IS NULL AND NEW.observation_id IS NOT NULL THEN
    SELECT plate_number INTO NEW.plate_number
    FROM observations
    WHERE observation_id = NEW.observation_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_enforcement_plate
  BEFORE INSERT OR UPDATE ON enforcement_actions
  FOR EACH ROW
  EXECUTE FUNCTION set_enforcement_plate_number();

-- Function: Update canonical vehicle enforcement tally on completion
CREATE OR REPLACE FUNCTION update_vehicle_enforcement_tally()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update if status changed to 'completed' and outcome is 'completed' (not 'not_on_site')
  IF NEW.breach_status = 'completed' 
     AND NEW.completion_outcome = 'completed'
     AND (OLD.breach_status IS NULL OR OLD.breach_status != 'completed') THEN
    
    UPDATE canonical_vehicles
    SET 
      enforcement_count = COALESCE(enforcement_count, 0) + 1,
      last_enforcement_at = NEW.completed_at,
      last_enforcement_type = NEW.action_type
    WHERE plate_number = NEW.plate_number;
    
    RAISE NOTICE 'Updated enforcement tally for plate %: count=%', 
      NEW.plate_number, 
      (SELECT enforcement_count FROM canonical_vehicles WHERE plate_number = NEW.plate_number);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_enforcement_tally
  AFTER INSERT OR UPDATE ON enforcement_actions
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_enforcement_tally();

-- Function: Get all active breaches (unresolved overstayers/violators)
CREATE OR REPLACE FUNCTION get_active_breaches(
  p_organization_id UUID DEFAULT NULL,
  p_date_from DATE DEFAULT CURRENT_DATE - INTERVAL '7 days',
  p_date_to DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  plate_number TEXT,
  zone_id UUID,
  zone_name TEXT,
  organization_id UUID,
  total_observations INTEGER,
  breach_count INTEGER,
  last_breach_date TIMESTAMPTZ,
  last_breach_type TEXT,
  homeless_status TEXT,
  is_flagged BOOLEAN,
  consecutive_nights INTEGER,
  nights_stayed INTEGER,
  max_allowed_consecutive INTEGER,
  max_allowed_monthly INTEGER,
  has_active_enforcement BOOLEAN,
  enforcement_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH breach_vehicles AS (
    SELECT DISTINCT
      vms.plate_number,
      vms.zone_id,
      vms.organization_id,
      vms.consecutive_nights,
      vms.nights_stayed,
      z.name AS zone_name,
      zcm.max_consecutive_nights,
      zcm.nights_per_month
    FROM vehicle_monthly_stays vms
    JOIN zones z ON z.id = vms.zone_id
    LEFT JOIN zone_compliance_matrix zcm ON zcm.zone_id = vms.zone_id AND zcm.effective_to IS NULL
    WHERE 
      vms.calendar_month >= DATE_TRUNC('month', p_date_from::TIMESTAMP)
      AND vms.calendar_month <= DATE_TRUNC('month', p_date_to::TIMESTAMP)
      AND (p_organization_id IS NULL OR vms.organization_id = p_organization_id)
      AND (
        vms.consecutive_nights > COALESCE(zcm.max_consecutive_nights, 3)
        OR vms.nights_stayed > COALESCE(zcm.nights_per_month, 28)
      )
  ),
  observation_counts AS (
    SELECT
      vo.plate_number,
      vo.zone_id,
      COUNT(*) AS total_obs,
      COUNT(*) FILTER (WHERE vo.is_breach) AS breach_count,
      MAX(vo.recorded_at) FILTER (WHERE vo.is_breach) AS last_breach_date,
      (ARRAY_AGG(vo.breach_type ORDER BY vo.recorded_at DESC) FILTER (WHERE vo.is_breach))[1] AS last_breach_type
    FROM observations vo
    WHERE vo.recorded_at >= p_date_from AND vo.recorded_at <= p_date_to
    GROUP BY vo.plate_number, vo.zone_id
  ),
  active_enforcements AS (
    SELECT
      ea.plate_number,
      ea.zone_id,
      ea.breach_status
    FROM enforcement_actions ea
    WHERE ea.breach_status IN ('active', 'assigned', 'in_progress')
  )
  SELECT
    bv.plate_number,
    bv.zone_id,
    bv.zone_name,
    bv.organization_id,
    COALESCE(oc.total_obs, 0)::INTEGER,
    COALESCE(oc.breach_count, 0)::INTEGER,
    oc.last_breach_date,
    oc.last_breach_type,
    cv.homeless_status,
    cv.is_flagged,
    bv.consecutive_nights,
    bv.nights_stayed,
    bv.max_consecutive_nights,
    bv.nights_per_month,
    (ae.plate_number IS NOT NULL) AS has_active_enforcement,
    ae.breach_status AS enforcement_status
  FROM breach_vehicles bv
  LEFT JOIN canonical_vehicles cv ON cv.plate_number = bv.plate_number
  LEFT JOIN observation_counts oc ON oc.plate_number = bv.plate_number AND oc.zone_id = bv.zone_id
  LEFT JOIN active_enforcements ae ON ae.plate_number = bv.plate_number AND ae.zone_id = bv.zone_id
  ORDER BY oc.last_breach_date DESC NULLS LAST, bv.consecutive_nights DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_active_breaches IS 'Returns all vehicles currently in breach (overstaying or violating compliance rules) with enforcement status';

-- Update RLS policies to allow officers to update assigned jobs
DROP POLICY IF EXISTS officers_update_assigned_jobs ON enforcement_actions;
CREATE POLICY officers_update_assigned_jobs
  ON enforcement_actions FOR UPDATE
  TO authenticated
  USING (assigned_to = auth.uid())
  WITH CHECK (assigned_to = auth.uid());

COMMENT ON POLICY officers_update_assigned_jobs ON enforcement_actions IS 'Officers can update enforcement jobs assigned to them';

-- Grant execute on function
GRANT EXECUTE ON FUNCTION get_active_breaches TO authenticated;

-- Migration summary
DO $$
BEGIN
  RAISE NOTICE '✅ Enforcement Workflow System Migration Complete';
  RAISE NOTICE '   - Added enforcement_count tally to canonical_vehicles';
  RAISE NOTICE '   - Extended enforcement_actions with job assignment fields';
  RAISE NOTICE '   - Created trigger for automatic enforcement tally updates';
  RAISE NOTICE '   - Added get_active_breaches() function for breach management';
  RAISE NOTICE '   - Updated RLS policies for officer job updates';
END $$;
