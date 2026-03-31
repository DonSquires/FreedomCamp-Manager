-- =============================================================================
-- OFFICER & ADMIN PORTAL ENHANCEMENTS
-- =============================================================================
-- Based on Wilson Security WILSAR, TrackTik, PatrolX, and industry best practices
-- 
-- New Features:
-- 1. Cold Start Registration (Wilson: OnTime style)
-- 2. Duress/SOS Alerts with discrete trigger
-- 3. Client Portal Access
-- 4. Patrol Exceptions/Accountability
-- 5. Client Patrol Requests
-- 6. Enhanced Site Information
-- =============================================================================

-- ============================================================================
-- 1. COLD START REGISTRATION
-- ============================================================================
-- Officers can indicate intention to attend a shift ahead of time

CREATE TABLE IF NOT EXISTS public.shift_cold_starts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id              UUID        NOT NULL REFERENCES public.rostered_shifts(id) ON DELETE CASCADE,
  officer_id            UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  registered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_arrival_time TIMESTAMPTZ,
  notes                 TEXT,
  
  -- Status
  status                TEXT        DEFAULT 'registered'
                          CHECK (status IN ('registered', 'confirmed', 'cancelled')),
  
  confirmed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (shift_id, officer_id)
);

CREATE INDEX IF NOT EXISTS idx_cold_starts_shift ON shift_cold_starts(shift_id);
CREATE INDEX IF NOT EXISTS idx_cold_starts_officer ON shift_cold_starts(officer_id);

-- ============================================================================
-- 2. DURESS/SOS ALERTS
-- ============================================================================
-- Discrete panic button with evidence capture

CREATE TABLE IF NOT EXISTS public.duress_alerts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id            UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Trigger details
  triggered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_method        TEXT        CHECK (trigger_method IN (
                          'button',        -- Manual SOS button
                          'triple_tap',    -- Discrete triple-tap
                          'voice',         -- Voice command
                          'fall_detection', -- Man down
                          'timer',         -- Dead man's timer
                          'shake'          -- Rapid shake
                        )),
  
  -- Location at trigger
  gps_lat               DECIMAL(10, 7),
  gps_lng               DECIMAL(11, 7),
  gps_accuracy_meters   INTEGER,
  address               TEXT,
  
  -- Context
  shift_id              UUID        REFERENCES public.rostered_shifts(id),
  patrol_id             UUID        REFERENCES public.patrols(id),
  site_id               UUID        REFERENCES public.client_sites(id),
  
  -- Evidence (auto-captured)
  audio_recording_url   TEXT,
  video_url             TEXT,
  screenshot_url        TEXT,
  
  -- Response
  acknowledged_at       TIMESTAMPTZ,
  acknowledged_by       UUID        REFERENCES public.user_profiles(id),
  response_notes        TEXT,
  response_time_seconds INTEGER,    -- Calculated: acknowledged_at - triggered_at
  
  -- Resolution
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID        REFERENCES public.user_profiles(id),
  resolution            TEXT,
  
  -- False alarm
  is_false_alarm        BOOLEAN     DEFAULT FALSE,
  false_alarm_reason    TEXT,
  
  -- Escalation
  escalation_level      INTEGER     DEFAULT 0,
  escalated_at          TIMESTAMPTZ,
  escalated_to          UUID[]      DEFAULT '{}',  -- User IDs notified
  
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_duress_alerts_officer ON duress_alerts(officer_id);
CREATE INDEX IF NOT EXISTS idx_duress_alerts_org ON duress_alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_duress_alerts_active ON duress_alerts(organization_id) 
  WHERE resolved_at IS NULL;

-- ============================================================================
-- 3. CLIENT PORTAL USERS
-- ============================================================================
-- Self-service portal for client organization contacts

CREATE TABLE IF NOT EXISTS public.client_portal_users (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id    UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Credentials
  email                     TEXT        NOT NULL UNIQUE,
  password_hash             TEXT        NOT NULL,
  
  -- Profile
  first_name                TEXT,
  last_name                 TEXT,
  phone                     TEXT,
  job_title                 TEXT,
  
  -- Permissions
  can_view_patrol_reports   BOOLEAN     DEFAULT TRUE,
  can_view_incidents        BOOLEAN     DEFAULT TRUE,
  can_view_checkpoints      BOOLEAN     DEFAULT TRUE,
  can_request_patrols       BOOLEAN     DEFAULT FALSE,
  can_view_officer_details  BOOLEAN     DEFAULT FALSE,
  can_download_reports      BOOLEAN     DEFAULT TRUE,
  can_view_invoices         BOOLEAN     DEFAULT FALSE,
  
  -- Site access (empty = all sites for their org)
  site_ids                  UUID[]      DEFAULT '{}',
  
  -- Status
  is_active                 BOOLEAN     DEFAULT TRUE,
  email_verified            BOOLEAN     DEFAULT FALSE,
  email_verified_at         TIMESTAMPTZ,
  
  -- Session tracking
  last_login_at             TIMESTAMPTZ,
  last_login_ip             INET,
  login_count               INTEGER     DEFAULT 0,
  
  -- Password reset
  password_reset_token      TEXT,
  password_reset_expires    TIMESTAMPTZ,
  
  -- Audit
  created_by                UUID        REFERENCES public.user_profiles(id),
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_portal_users_org ON client_portal_users(client_organization_id);
CREATE INDEX IF NOT EXISTS idx_client_portal_users_email ON client_portal_users(email);

-- ============================================================================
-- 4. PATROL EXCEPTIONS / ACCOUNTABILITY
-- ============================================================================
-- Track deviations from expected patrol behavior

CREATE TABLE IF NOT EXISTS public.patrol_exceptions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_id             UUID        NOT NULL REFERENCES public.patrols(id) ON DELETE CASCADE,
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Exception details
  exception_type        TEXT        NOT NULL CHECK (exception_type IN (
                          'missed_checkpoint',    -- Checkpoint not scanned
                          'late_start',           -- Patrol started late
                          'early_end',            -- Patrol ended early
                          'off_route',            -- Officer deviated from route
                          'no_gps',               -- GPS signal lost
                          'extended_break',       -- Excessive time between checkpoints
                          'unauthorized_area',    -- Officer in restricted zone
                          'scan_too_fast',        -- Checkpoints scanned suspiciously fast
                          'photo_missing',        -- Required photo not taken
                          'checklist_incomplete'  -- Checklist not completed
                        )),
  
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details               TEXT,
  
  -- Related checkpoint (if applicable)
  checkpoint_id         UUID        REFERENCES public.patrol_route_checkpoints(id),
  
  -- Location when detected
  gps_lat               DECIMAL(10, 7),
  gps_lng               DECIMAL(11, 7),
  
  -- Severity
  severity              TEXT        DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  
  -- Acknowledgment
  acknowledged          BOOLEAN     DEFAULT FALSE,
  acknowledged_by       UUID        REFERENCES public.user_profiles(id),
  acknowledged_at       TIMESTAMPTZ,
  explanation           TEXT,       -- Officer's explanation
  supervisor_notes      TEXT,       -- Supervisor's notes
  
  -- Auto-resolved (e.g., GPS regained)
  auto_resolved         BOOLEAN     DEFAULT FALSE,
  resolved_at           TIMESTAMPTZ,
  
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patrol_exceptions_patrol ON patrol_exceptions(patrol_id);
CREATE INDEX IF NOT EXISTS idx_patrol_exceptions_org ON patrol_exceptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_patrol_exceptions_unacked ON patrol_exceptions(organization_id) 
  WHERE acknowledged = FALSE;

-- ============================================================================
-- 5. CLIENT PATROL REQUESTS
-- ============================================================================
-- Clients can request additional patrols/services

CREATE TABLE IF NOT EXISTS public.client_patrol_requests (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id    UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Requested by
  requested_by_portal_user  UUID        REFERENCES public.client_portal_users(id),
  requested_by_contact      UUID        REFERENCES public.crm_contacts(id),
  requester_name            TEXT,
  requester_email           TEXT,
  requester_phone           TEXT,
  
  -- Request details
  site_id                   UUID        REFERENCES public.client_sites(id),
  site_address              TEXT,
  
  request_type              TEXT        NOT NULL CHECK (request_type IN (
                              'additional_patrol',
                              'welfare_check',
                              'alarm_response',
                              'lock_unlock',
                              'escort',
                              'property_check',
                              'noise_complaint',
                              'other'
                            )),
  
  description               TEXT        NOT NULL,
  priority                  TEXT        DEFAULT 'normal' 
                              CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  
  -- Scheduling
  requested_date            DATE,
  requested_time_start      TIME,
  requested_time_end        TIME,
  recurring                 BOOLEAN     DEFAULT FALSE,
  recurrence_pattern        TEXT,       -- 'daily', 'weekly', etc.
  
  -- Status workflow
  status                    TEXT        DEFAULT 'pending' CHECK (status IN (
                              'pending',      -- Awaiting review
                              'approved',     -- Approved, not yet scheduled
                              'rejected',     -- Request denied
                              'scheduled',    -- Dispatch job created
                              'in_progress',  -- Being executed
                              'completed',    -- Request fulfilled
                              'cancelled'     -- Cancelled by client or provider
                            )),
  
  -- Handling
  handled_by                UUID        REFERENCES public.user_profiles(id),
  handled_at                TIMESTAMPTZ,
  handler_notes             TEXT,
  rejection_reason          TEXT,
  
  -- Linked dispatch job
  dispatch_job_id           UUID        REFERENCES public.dispatch_jobs(id),
  
  -- Cost (if billable)
  is_billable               BOOLEAN     DEFAULT FALSE,
  estimated_cost            DECIMAL(10, 2),
  actual_cost               DECIMAL(10, 2),
  invoice_id                UUID        REFERENCES public.crm_invoices(id),
  
  -- Feedback
  client_rating             INTEGER     CHECK (client_rating BETWEEN 1 AND 5),
  client_feedback           TEXT,
  
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_requests_org ON client_patrol_requests(client_organization_id);
CREATE INDEX IF NOT EXISTS idx_client_requests_status ON client_patrol_requests(status);
CREATE INDEX IF NOT EXISTS idx_client_requests_pending ON client_patrol_requests(client_organization_id) 
  WHERE status = 'pending';

-- ============================================================================
-- 6. ENHANCED SITE INFORMATION
-- ============================================================================
-- Additional site details for officers

ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS
  access_instructions       TEXT;
  
ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS
  alarm_codes_encrypted     TEXT;       -- Store encrypted, decrypt only when on-site
  
ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS
  key_location              TEXT;
  
ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS
  patrol_instructions       TEXT;
  
ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS
  special_instructions      TEXT[];
  
ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS
  site_map_url              TEXT;
  
ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS
  emergency_procedures_url  TEXT;
  
ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS
  common_issues             TEXT[];
  
ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS
  hazards                   TEXT[];     -- Safety hazards to be aware of
  
ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS
  ppe_required              TEXT[];     -- Required PPE

-- Site contacts (key holders, emergency contacts)
CREATE TABLE IF NOT EXISTS public.site_contacts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID        NOT NULL REFERENCES public.client_sites(id) ON DELETE CASCADE,
  
  contact_type          TEXT        NOT NULL CHECK (contact_type IN (
                          'key_holder',
                          'emergency',
                          'client_contact',
                          'building_manager',
                          'alarm_company',
                          'other'
                        )),
  
  name                  TEXT        NOT NULL,
  phone                 TEXT,
  phone_secondary       TEXT,
  email                 TEXT,
  company               TEXT,
  role                  TEXT,
  
  -- Availability
  available_24_7        BOOLEAN     DEFAULT FALSE,
  available_hours_start TIME,
  available_hours_end   TIME,
  available_days        INTEGER[]   DEFAULT '{1,2,3,4,5,6,7}',
  
  -- Priority
  call_priority         INTEGER     DEFAULT 1,  -- 1 = call first
  
  notes                 TEXT,
  is_active             BOOLEAN     DEFAULT TRUE,
  
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_contacts_site ON site_contacts(site_id);

-- ============================================================================
-- 7. HELPER FUNCTIONS
-- ============================================================================

-- Trigger duress alert and notify supervisors
CREATE OR REPLACE FUNCTION trigger_duress_alert(
  p_officer_id UUID,
  p_trigger_method TEXT,
  p_gps_lat DECIMAL,
  p_gps_lng DECIMAL,
  p_gps_accuracy INTEGER DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_org_id UUID;
  v_alert_id UUID;
  v_shift_id UUID;
  v_patrol_id UUID;
  v_supervisors UUID[];
BEGIN
  -- Get officer's org
  SELECT organization_id INTO v_org_id
  FROM user_profiles WHERE id = p_officer_id;
  
  -- Get active shift/patrol
  SELECT id INTO v_shift_id
  FROM rostered_shifts
  WHERE officer_id = p_officer_id
    AND shift_date = CURRENT_DATE
    AND actual_end IS NULL
  LIMIT 1;
  
  SELECT id INTO v_patrol_id
  FROM patrols
  WHERE assigned_to = p_officer_id
    AND status = 'in_progress'
  LIMIT 1;
  
  -- Create alert
  INSERT INTO duress_alerts (
    officer_id, organization_id, trigger_method,
    gps_lat, gps_lng, gps_accuracy_meters,
    shift_id, patrol_id
  ) VALUES (
    p_officer_id, v_org_id, p_trigger_method,
    p_gps_lat, p_gps_lng, p_gps_accuracy,
    v_shift_id, v_patrol_id
  )
  RETURNING id INTO v_alert_id;
  
  -- Find supervisors to notify
  SELECT ARRAY_AGG(id) INTO v_supervisors
  FROM user_profiles
  WHERE organization_id = v_org_id
    AND role IN ('admin', 'admin_officer', 'master')
    AND is_active = TRUE;
  
  -- Update with escalated_to
  UPDATE duress_alerts
  SET escalated_to = v_supervisors
  WHERE id = v_alert_id;
  
  -- Create notifications for supervisors
  INSERT INTO notifications (user_id, organization_id, type, title, body, data)
  SELECT 
    sup_id,
    v_org_id,
    'duress_alert',
    '🚨 DURESS ALERT',
    'Officer requires immediate assistance',
    jsonb_build_object(
      'alert_id', v_alert_id,
      'officer_id', p_officer_id,
      'gps_lat', p_gps_lat,
      'gps_lng', p_gps_lng
    )
  FROM UNNEST(v_supervisors) AS sup_id;
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'alert_id', v_alert_id,
    'supervisors_notified', ARRAY_LENGTH(v_supervisors, 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check for patrol exceptions
CREATE OR REPLACE FUNCTION check_patrol_exceptions(
  p_patrol_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_patrol RECORD;
  v_route RECORD;
  v_exceptions JSONB[] := '{}';
  v_checkpoint RECORD;
  v_scan RECORD;
  v_last_scan TIMESTAMPTZ;
  v_expected_checkpoints INTEGER;
  v_scanned_checkpoints INTEGER;
BEGIN
  -- Get patrol details
  SELECT * INTO v_patrol
  FROM patrols WHERE id = p_patrol_id;
  
  IF v_patrol.patrol_route_id IS NULL THEN
    RETURN jsonb_build_object('checked', FALSE, 'reason', 'No route assigned');
  END IF;
  
  -- Get route details
  SELECT * INTO v_route
  FROM patrol_routes WHERE id = v_patrol.patrol_route_id;
  
  -- Check for late start
  IF v_patrol.started_at IS NOT NULL AND v_patrol.scheduled_start_time IS NOT NULL THEN
    IF v_patrol.started_at > (v_patrol.patrol_date || ' ' || v_patrol.scheduled_start_time)::TIMESTAMPTZ + INTERVAL '15 minutes' THEN
      v_exceptions := v_exceptions || jsonb_build_object(
        'type', 'late_start',
        'details', 'Patrol started ' || 
          EXTRACT(MINUTES FROM v_patrol.started_at - (v_patrol.patrol_date || ' ' || v_patrol.scheduled_start_time)::TIMESTAMPTZ) || 
          ' minutes late'
      );
    END IF;
  END IF;
  
  -- Count expected vs scanned checkpoints
  SELECT COUNT(*) INTO v_expected_checkpoints
  FROM patrol_route_checkpoints
  WHERE patrol_route_id = v_patrol.patrol_route_id
    AND is_mandatory = TRUE
    AND is_active = TRUE;
  
  SELECT COUNT(DISTINCT checkpoint_id) INTO v_scanned_checkpoints
  FROM patrol_checkpoint_scans
  WHERE patrol_id = p_patrol_id;
  
  -- Check for missed checkpoints (only if patrol is complete or past expected end)
  IF v_patrol.status = 'completed' OR 
     (v_patrol.scheduled_end_time IS NOT NULL AND NOW() > (v_patrol.patrol_date || ' ' || v_patrol.scheduled_end_time)::TIMESTAMPTZ) THEN
    IF v_scanned_checkpoints < v_expected_checkpoints THEN
      v_exceptions := v_exceptions || jsonb_build_object(
        'type', 'missed_checkpoint',
        'details', 'Only ' || v_scanned_checkpoints || ' of ' || v_expected_checkpoints || ' checkpoints scanned'
      );
    END IF;
  END IF;
  
  -- Insert any new exceptions
  FOR i IN 1..ARRAY_LENGTH(v_exceptions, 1) LOOP
    INSERT INTO patrol_exceptions (
      patrol_id, organization_id, exception_type, details
    ) VALUES (
      p_patrol_id, v_patrol.organization_id,
      (v_exceptions[i]->>'type')::TEXT,
      (v_exceptions[i]->>'details')::TEXT
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
  
  RETURN jsonb_build_object(
    'patrol_id', p_patrol_id,
    'exceptions_found', ARRAY_LENGTH(v_exceptions, 1),
    'exceptions', v_exceptions
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 8. RLS POLICIES
-- ============================================================================

ALTER TABLE shift_cold_starts ENABLE ROW LEVEL SECURITY;
ALTER TABLE duress_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_patrol_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_contacts ENABLE ROW LEVEL SECURITY;

-- Cold starts - officers see own, admins see all org
CREATE POLICY cold_starts_select ON shift_cold_starts
  FOR SELECT USING (
    officer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN rostered_shifts rs ON rs.id = shift_cold_starts.shift_id
      WHERE up.id = auth.uid()
      AND up.organization_id = rs.organization_id
      AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

CREATE POLICY cold_starts_insert ON shift_cold_starts
  FOR INSERT WITH CHECK (officer_id = auth.uid());

CREATE POLICY cold_starts_update ON shift_cold_starts
  FOR UPDATE USING (officer_id = auth.uid());

-- Duress alerts - org members can view
CREATE POLICY duress_alerts_select ON duress_alerts
  FOR SELECT USING (
    organization_id = get_user_organization_id(auth.uid())
    OR officer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master'))
  );

CREATE POLICY duress_alerts_insert ON duress_alerts
  FOR INSERT WITH CHECK (officer_id = auth.uid());

-- Client portal users - provider org admins
CREATE POLICY client_portal_users_select ON client_portal_users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN crm_contracts c ON c.provider_organization_id = up.organization_id
      WHERE up.id = auth.uid()
      AND c.client_organization_id = client_portal_users.client_organization_id
      AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

CREATE POLICY client_portal_users_manage ON client_portal_users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN crm_contracts c ON c.provider_organization_id = up.organization_id
      WHERE up.id = auth.uid()
      AND c.client_organization_id = client_portal_users.client_organization_id
      AND up.role IN ('admin', 'master', 'grand_master')
    )
  );

-- Patrol exceptions - org members
CREATE POLICY patrol_exceptions_select ON patrol_exceptions
  FOR SELECT USING (
    organization_id = get_user_organization_id(auth.uid())
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master'))
  );

CREATE POLICY patrol_exceptions_update ON patrol_exceptions
  FOR UPDATE USING (
    organization_id = get_user_organization_id(auth.uid())
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master', 'grand_master'))
  );

-- Client requests - client org or provider org
CREATE POLICY client_requests_select ON client_patrol_requests
  FOR SELECT USING (
    client_organization_id = get_user_organization_id(auth.uid())
    OR EXISTS (
      SELECT 1 FROM crm_contracts c
      WHERE c.client_organization_id = client_patrol_requests.client_organization_id
      AND c.provider_organization_id = get_user_organization_id(auth.uid())
    )
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master'))
  );

-- Site contacts - org members with site access
CREATE POLICY site_contacts_select ON site_contacts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM client_sites cs
      WHERE cs.id = site_contacts.site_id
      AND cs.organization_id = get_user_organization_id(auth.uid())
    )
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master'))
  );

CREATE POLICY site_contacts_manage ON site_contacts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM client_sites cs
      WHERE cs.id = site_contacts.site_id
      AND cs.organization_id = get_user_organization_id(auth.uid())
    )
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master', 'grand_master'))
  );

-- ============================================================================
-- 9. GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON shift_cold_starts TO authenticated;
GRANT SELECT, INSERT ON duress_alerts TO authenticated;
GRANT SELECT ON client_portal_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_portal_users TO authenticated;
GRANT SELECT, UPDATE ON patrol_exceptions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON client_patrol_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON site_contacts TO authenticated;

GRANT EXECUTE ON FUNCTION trigger_duress_alert TO authenticated;
GRANT EXECUTE ON FUNCTION check_patrol_exceptions TO authenticated;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
