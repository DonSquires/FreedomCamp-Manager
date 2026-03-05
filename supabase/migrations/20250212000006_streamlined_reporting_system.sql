-- =====================================================
-- STREAMLINED REPORTING & ALERT SYSTEM
-- =====================================================
-- Unified reporting workflow with person tracking,
-- priority-based alerts, and full audit trail
-- =====================================================

-- =====================================================
-- 1. ALERT QUEUE TABLE (Priority-Based Alerts)
-- =====================================================

CREATE TABLE IF NOT EXISTS alert_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Alert classification
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'breach_detected',
    'homeless_fc_exempt',
    'flagged_vehicle',
    'hs_issue',
    'welfare_warning',
    'welfare_critical',
    'duplicate_scan',
    'new_vehicle',
    'compliant_scan'
  )),
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  
  -- Alert content
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  
  -- Linked entities
  vehicle_id TEXT REFERENCES canonical_vehicles(plate_number) ON DELETE SET NULL,
  zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  person_id UUID REFERENCES person_records(id) ON DELETE SET NULL,
  observation_id UUID REFERENCES vehicle_observations_v2(observation_id) ON DELETE SET NULL,
  
  -- Alert state
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'actioned', 'expired')),
  requires_acknowledgement BOOLEAN DEFAULT TRUE,
  can_dismiss BOOLEAN DEFAULT TRUE, -- Critical alerts set to FALSE
  expires_at TIMESTAMPTZ,
  
  -- Acknowledgement tracking
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  acknowledgement_notes TEXT,
  
  -- Background notification
  push_sent BOOLEAN DEFAULT FALSE,
  push_sent_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT nz_now(),
  updated_at TIMESTAMPTZ DEFAULT nz_now()
);

CREATE INDEX idx_alert_queue_user_status ON alert_queue(user_id, status);
CREATE INDEX idx_alert_queue_priority ON alert_queue(priority DESC, created_at DESC);
CREATE INDEX idx_alert_queue_type ON alert_queue(alert_type);
CREATE INDEX idx_alert_queue_pending ON alert_queue(user_id, status) WHERE status = 'pending';
CREATE INDEX idx_alert_queue_vehicle ON alert_queue(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_alert_queue_zone ON alert_queue(zone_id) WHERE zone_id IS NOT NULL;

COMMENT ON TABLE alert_queue IS 'Priority-based alert queue with mandatory acknowledgement for critical alerts';
COMMENT ON COLUMN alert_queue.can_dismiss IS 'FALSE for critical alerts (welfare, flagged vehicles) - must take action';
COMMENT ON COLUMN alert_queue.push_sent IS 'Whether background push notification was sent';

-- =====================================================
-- 2. ALERT ACKNOWLEDGEMENTS TABLE (Audit Trail)
-- =====================================================

CREATE TABLE IF NOT EXISTS alert_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alert_queue(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Acknowledgement details
  acknowledged_at TIMESTAMPTZ DEFAULT nz_now(),
  acknowledgement_type TEXT NOT NULL CHECK (acknowledgement_type IN (
    'dismissed',
    'actioned',
    'escalated',
    'resolved'
  )),
  
  -- Evidence
  notes TEXT,
  action_taken TEXT,
  evidence_photos TEXT[],
  
  -- Linked actions
  report_created_id UUID, -- Links to incidents/hs_reports/etc
  follow_up_required BOOLEAN DEFAULT FALSE,
  follow_up_date DATE,
  
  -- Device context
  gps_latitude NUMERIC(10,8),
  gps_longitude NUMERIC(11,8),
  device_info JSONB,
  
  created_at TIMESTAMPTZ DEFAULT nz_now()
);

CREATE INDEX idx_alert_acks_alert ON alert_acknowledgements(alert_id);
CREATE INDEX idx_alert_acks_user ON alert_acknowledgements(user_id, acknowledged_at DESC);
CREATE INDEX idx_alert_acks_type ON alert_acknowledgements(acknowledgement_type);

COMMENT ON TABLE alert_acknowledgements IS 'Full audit trail of all alert acknowledgements with evidence';
COMMENT ON COLUMN alert_acknowledgements.report_created_id IS 'ID of incident/hs_report/maintenance created in response to alert';

-- =====================================================
-- 3. PERSON INTERACTIONS TABLE (Interaction History)
-- =====================================================

CREATE TABLE IF NOT EXISTS person_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES person_records(id) ON DELETE CASCADE,
  
  -- Interaction details
  interaction_type TEXT NOT NULL CHECK (interaction_type IN (
    'first_contact',
    'welfare_check',
    'incident_report',
    'hs_report',
    'maintenance_report',
    'trespass_notice',
    'homeless_verification',
    'id_verification',
    'follow_up'
  )),
  
  -- Location
  zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  gps_latitude NUMERIC(10,8),
  gps_longitude NUMERIC(11,8),
  
  -- Officer
  officer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  officer_notes TEXT,
  
  -- Linked records
  vehicle_id TEXT REFERENCES canonical_vehicles(plate_number) ON DELETE SET NULL,
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  hs_report_id UUID REFERENCES health_safety_reports(id) ON DELETE SET NULL,
  
  -- Evidence
  photos TEXT[],
  attachments JSONB,
  
  -- Outcome
  outcome TEXT,
  requires_follow_up BOOLEAN DEFAULT FALSE,
  follow_up_date DATE,
  
  interaction_at TIMESTAMPTZ DEFAULT nz_now(),
  created_at TIMESTAMPTZ DEFAULT nz_now()
);

CREATE INDEX idx_person_interactions_person ON person_interactions(person_id, interaction_at DESC);
CREATE INDEX idx_person_interactions_officer ON person_interactions(officer_id, interaction_at DESC);
CREATE INDEX idx_person_interactions_type ON person_interactions(interaction_type);
CREATE INDEX idx_person_interactions_follow_up ON person_interactions(requires_follow_up, follow_up_date);
CREATE INDEX idx_person_interactions_zone ON person_interactions(zone_id) WHERE zone_id IS NOT NULL;

COMMENT ON TABLE person_interactions IS 'Complete history of all interactions with person records (tent dwellers, homeless, etc)';

-- =====================================================
-- 4. ENHANCE PERSON RECORDS TABLE
-- =====================================================

ALTER TABLE person_records
  ADD COLUMN IF NOT EXISTS tent_location_description TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_association TEXT REFERENCES canonical_vehicles(plate_number) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS freedom_camping_act_applies BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trespass_notice_issued BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trespass_notice_date DATE,
  ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_interactions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical'));

COMMENT ON COLUMN person_records.tent_location_description IS 'Description of tent/structure location within zone';
COMMENT ON COLUMN person_records.vehicle_association IS 'Vehicle this person is associated with (if applicable)';
COMMENT ON COLUMN person_records.freedom_camping_act_applies IS 'Whether Freedom Camping Act regulations apply to this person';
COMMENT ON COLUMN person_records.trespass_notice_issued IS 'Whether a trespass notice has been issued';
COMMENT ON COLUMN person_records.risk_level IS 'Risk assessment level for officer safety';

-- =====================================================
-- 5. TRIGGERS FOR AUTO-UPDATE
-- =====================================================

-- Auto-update person_records.total_interactions counter
CREATE OR REPLACE FUNCTION update_person_interaction_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE person_records
  SET 
    total_interactions = total_interactions + 1,
    last_contact_at = NEW.interaction_at,
    updated_at = nz_now()
  WHERE id = NEW.person_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_person_interaction_count ON person_interactions;
CREATE TRIGGER trigger_update_person_interaction_count
  AFTER INSERT ON person_interactions
  FOR EACH ROW
  EXECUTE FUNCTION update_person_interaction_count();

COMMENT ON TRIGGER trigger_update_person_interaction_count ON person_interactions IS 'Auto-updates person_records.total_interactions counter';

-- Auto-update alert_queue.updated_at
CREATE OR REPLACE FUNCTION update_alert_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := nz_now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_alert_queue_updated_at ON alert_queue;
CREATE TRIGGER trigger_update_alert_queue_updated_at
  BEFORE UPDATE ON alert_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_alert_queue_updated_at();

-- =====================================================
-- 6. RLS POLICIES
-- =====================================================

-- Alert Queue Policies
ALTER TABLE alert_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_view_own_alerts
  ON alert_queue FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY system_create_alerts
  ON alert_queue FOR INSERT
  WITH CHECK (true); -- Backend creates alerts

CREATE POLICY users_acknowledge_own_alerts
  ON alert_queue FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY admins_view_org_alerts
  ON alert_queue FOR SELECT
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  );

-- Alert Acknowledgements Policies
ALTER TABLE alert_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_create_acknowledgements
  ON alert_acknowledgements FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY users_view_own_acknowledgements
  ON alert_acknowledgements FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY admins_view_all_acknowledgements
  ON alert_acknowledgements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM alert_queue aq
      WHERE aq.id = alert_acknowledgements.alert_id
      AND (
        (get_user_role(auth.uid()) = 'master'::text)
        OR (aq.organization_id = get_user_organization_id(auth.uid()))
      )
    )
  );

-- Person Interactions Policies
ALTER TABLE person_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY officers_create_interactions
  ON person_interactions FOR INSERT
  WITH CHECK (
    (officer_id = auth.uid())
    AND (
      (organization_id = get_user_organization_id(auth.uid()))
      OR (get_user_role(auth.uid()) = 'master'::text)
    )
  );

CREATE POLICY users_view_org_interactions
  ON person_interactions FOR SELECT
  USING (
    (get_user_role(auth.uid()) = 'master'::text)
    OR (organization_id = get_user_organization_id(auth.uid()))
  );

CREATE POLICY officers_update_own_interactions
  ON person_interactions FOR UPDATE
  USING (officer_id = auth.uid())
  WITH CHECK (officer_id = auth.uid());

-- =====================================================
-- 7. HELPER FUNCTIONS
-- =====================================================

-- Get pending alerts for user
CREATE OR REPLACE FUNCTION get_pending_alerts(p_user_id UUID)
RETURNS TABLE (
  alert_id UUID,
  alert_type TEXT,
  priority TEXT,
  title TEXT,
  message TEXT,
  can_dismiss BOOLEAN,
  created_at TIMESTAMPTZ,
  vehicle_plate TEXT,
  zone_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    aq.id,
    aq.alert_type,
    aq.priority,
    aq.title,
    aq.message,
    aq.can_dismiss,
    aq.created_at,
    aq.vehicle_id,
    z.name
  FROM alert_queue aq
  LEFT JOIN zones z ON z.id = aq.zone_id
  WHERE aq.user_id = p_user_id
    AND aq.status = 'pending'
  ORDER BY
    CASE aq.priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    aq.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_pending_alerts IS 'Returns all pending alerts for user sorted by priority';

-- Get person interaction history
CREATE OR REPLACE FUNCTION get_person_interaction_history(p_person_id UUID)
RETURNS TABLE (
  interaction_id UUID,
  interaction_type TEXT,
  officer_name TEXT,
  zone_name TEXT,
  interaction_at TIMESTAMPTZ,
  officer_notes TEXT,
  outcome TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pi.id,
    pi.interaction_type,
    up.first_name || ' ' || up.last_name,
    z.name,
    pi.interaction_at,
    pi.officer_notes,
    pi.outcome
  FROM person_interactions pi
  LEFT JOIN user_profiles up ON up.id = pi.officer_id
  LEFT JOIN zones z ON z.id = pi.zone_id
  WHERE pi.person_id = p_person_id
  ORDER BY pi.interaction_at DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_person_interaction_history IS 'Returns complete interaction history for a person';

-- Migration summary
DO $$
DECLARE
  alert_count INTEGER;
  person_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO alert_count FROM alert_queue;
  SELECT COUNT(*) INTO person_count FROM person_records;
  
  RAISE NOTICE '✅ Streamlined Reporting System Migration Complete';
  RAISE NOTICE '   - Created alert_queue table';
  RAISE NOTICE '   - Created alert_acknowledgements table (audit trail)';
  RAISE NOTICE '   - Created person_interactions table';
  RAISE NOTICE '   - Enhanced person_records with 7 new fields';
  RAISE NOTICE '   - Created auto-update triggers';
  RAISE NOTICE '   - Created RLS policies for all tables';
  RAISE NOTICE '   - Created helper functions';
  RAISE NOTICE '';
  RAISE NOTICE '   📊 Current Data:';
  RAISE NOTICE '      - Alerts: %', alert_count;
  RAISE NOTICE '      - Person Records: %', person_count;
  RAISE NOTICE '';
  RAISE NOTICE '   🎯 Next Steps:';
  RAISE NOTICE '      - Implement UnifiedReportModal.tsx';
  RAISE NOTICE '      - Implement PersonRecordsManager.tsx';
  RAISE NOTICE '      - Implement UnifiedAlertQueue.tsx';
END $$;
