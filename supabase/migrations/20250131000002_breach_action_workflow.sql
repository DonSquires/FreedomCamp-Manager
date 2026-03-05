-- Breach Alert Action Workflow Update
-- Changes breach alerts from manual confirmation to automatic recording with action options

-- Add new columns for action workflow
ALTER TABLE breach_alerts 
  ADD COLUMN IF NOT EXISTS action_status TEXT DEFAULT 'pending_review' CHECK (action_status IN ('pending_review', 'enforcement_required', 'monitoring', 'marked_homeless', 'closed')),
  ADD COLUMN IF NOT EXISTS action_taken_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS action_taken_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS monitoring_until DATE,
  ADD COLUMN IF NOT EXISTS monitoring_notes TEXT,
  ADD COLUMN IF NOT EXISTS marked_homeless_reason TEXT,
  ADD COLUMN IF NOT EXISTS closure_reason TEXT;

-- Add index on action_status for faster filtering
CREATE INDEX IF NOT EXISTS idx_breach_alerts_action_status ON breach_alerts(action_status);

-- Add index on monitoring_until for scheduled checks
CREATE INDEX IF NOT EXISTS idx_breach_alerts_monitoring_until ON breach_alerts(monitoring_until) WHERE action_status = 'monitoring';

-- Update existing breach alerts to new status
UPDATE breach_alerts 
SET action_status = CASE 
  WHEN status = 'resolved' THEN 'closed'
  WHEN status = 'pending' THEN 'pending_review'
  ELSE 'pending_review'
END
WHERE action_status IS NULL;

-- Create function to take action on breach alert
CREATE OR REPLACE FUNCTION take_breach_action(
  p_breach_alert_id UUID,
  p_action_status TEXT,
  p_user_id UUID,
  p_monitoring_until DATE DEFAULT NULL,
  p_monitoring_notes TEXT DEFAULT NULL,
  p_marked_homeless_reason TEXT DEFAULT NULL,
  p_closure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_breach_alert RECORD;
BEGIN
  -- Validate action_status
  IF p_action_status NOT IN ('enforcement_required', 'monitoring', 'marked_homeless', 'closed') THEN
    RAISE EXCEPTION 'Invalid action_status: %', p_action_status;
  END IF;

  -- Get breach alert details
  SELECT * INTO v_breach_alert
  FROM breach_alerts
  WHERE id = p_breach_alert_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Breach alert not found: %', p_breach_alert_id;
  END IF;

  -- Update breach alert with action
  UPDATE breach_alerts
  SET 
    action_status = p_action_status,
    action_taken_by = p_user_id,
    action_taken_at = NOW(),
    monitoring_until = CASE WHEN p_action_status = 'monitoring' THEN p_monitoring_until ELSE NULL END,
    monitoring_notes = CASE WHEN p_action_status = 'monitoring' THEN p_monitoring_notes ELSE NULL END,
    marked_homeless_reason = CASE WHEN p_action_status = 'marked_homeless' THEN p_marked_homeless_reason ELSE NULL END,
    closure_reason = CASE WHEN p_action_status = 'closed' THEN p_closure_reason ELSE NULL END,
    status = CASE 
      WHEN p_action_status = 'closed' THEN 'resolved'
      WHEN p_action_status = 'enforcement_required' THEN 'pending'
      ELSE 'pending'
    END,
    resolution_notes = COALESCE(
      p_monitoring_notes,
      p_marked_homeless_reason,
      p_closure_reason
    ),
    resolved_at = CASE WHEN p_action_status IN ('closed', 'marked_homeless') THEN NOW() ELSE NULL END
  WHERE id = p_breach_alert_id;

  -- If marked as homeless, update canonical vehicle and vehicle records
  IF p_action_status = 'marked_homeless' THEN
    -- Get vehicle_id from breach alert
    DECLARE
      v_vehicle_id UUID;
      v_plate_number TEXT;
    BEGIN
      SELECT vr.plate_number INTO v_plate_number
      FROM vehicle_records vr
      WHERE vr.id = v_breach_alert.vehicle_record_id;

      -- Update canonical vehicle
      UPDATE canonical_vehicles
      SET 
        is_homeless = TRUE,
        homeless_confirmed = TRUE,
        homeless_confirmed_by = p_user_id,
        homeless_confirmed_at = NOW(),
        homeless_notes = p_marked_homeless_reason
      WHERE plate_number = v_plate_number;

      -- Update all vehicle records for this plate
      UPDATE vehicle_records
      SET 
        homeless_confirmed = TRUE,
        homeless_confirmed_by = p_user_id,
        homeless_confirmed_at = NOW(),
        homeless_confirmation_notes = p_marked_homeless_reason
      WHERE plate_number = v_plate_number;
    END;
  END IF;

  -- Return result
  SELECT jsonb_build_object(
    'success', TRUE,
    'breach_alert_id', p_breach_alert_id,
    'action_status', p_action_status,
    'message', CASE 
      WHEN p_action_status = 'enforcement_required' THEN 'Breach marked for enforcement action'
      WHEN p_action_status = 'monitoring' THEN format('Breach set to monitoring until %s', p_monitoring_until)
      WHEN p_action_status = 'marked_homeless' THEN 'Vehicle marked as homeless - future observations will be exempt'
      WHEN p_action_status = 'closed' THEN 'Breach alert closed'
    END
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION take_breach_action TO authenticated;

COMMENT ON FUNCTION take_breach_action IS 'Takes action on a breach alert: enforcement, monitoring, homeless, or closure';

-- Create view for breach alerts with action details
CREATE OR REPLACE VIEW breach_alerts_with_actions AS
SELECT 
  ba.id,
  ba.organization_id,
  ba.zone_id,
  ba.vehicle_record_id,
  ba.breach_type,
  ba.breach_details,
  ba.status,
  ba.action_status,
  ba.action_taken_by,
  ba.action_taken_at,
  ba.monitoring_until,
  ba.monitoring_notes,
  ba.marked_homeless_reason,
  ba.closure_reason,
  ba.created_at,
  ba.updated_at,
  o.name AS organization_name,
  z.name AS zone_name,
  vr.plate_number,
  vr.vehicle_make,
  vr.vehicle_model,
  vr.vehicle_color,
  up.first_name || ' ' || up.last_name AS action_taken_by_name,
  -- Status indicators
  CASE 
    WHEN ba.action_status = 'monitoring' AND ba.monitoring_until < CURRENT_DATE THEN TRUE
    ELSE FALSE
  END AS monitoring_expired,
  CASE 
    WHEN ba.action_status = 'pending_review' THEN TRUE
    ELSE FALSE
  END AS requires_review
FROM breach_alerts ba
LEFT JOIN organizations o ON o.id = ba.organization_id
LEFT JOIN zones z ON z.id = ba.zone_id
LEFT JOIN vehicle_records vr ON vr.id = ba.vehicle_record_id
LEFT JOIN user_profiles up ON up.id = ba.action_taken_by;

GRANT SELECT ON breach_alerts_with_actions TO authenticated;

COMMENT ON VIEW breach_alerts_with_actions IS 'Breach alerts with action details and status indicators';
