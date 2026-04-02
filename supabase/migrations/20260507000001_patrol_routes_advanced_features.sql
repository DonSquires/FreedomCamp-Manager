-- =============================================================================
-- PATROL ROUTES & ADVANCED FEATURES MIGRATION
-- =============================================================================
-- Implements:
-- 1. Named Patrol Routes with checkpoints
-- 2. User Rostering System
-- 3. Checkpoint auto-scan tracking
-- 4. Cross-org PTT authorization
-- 5. Activity-based welfare monitoring
-- =============================================================================

-- ============================================================================
-- 1. PATROL ROUTES — Permanent named patrol templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patrol_routes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Route identification
  route_name            TEXT        NOT NULL,
  route_code            TEXT        UNIQUE,
  description           TEXT,
  
  -- Route type
  route_type            TEXT        NOT NULL DEFAULT 'regular'
                          CHECK (route_type IN (
                            'regular',
                            'mobile',
                            'static',
                            'roving',
                            'response'
                          )),
  
  -- Default timing
  default_shift         TEXT        DEFAULT 'day' CHECK (default_shift IN ('day', 'swing', 'night')),
  default_start_time    TIME,
  default_end_time      TIME,
  expected_duration_minutes INTEGER,
  
  -- Coverage
  primary_zone_id       UUID        REFERENCES public.zones(id),
  secondary_zone_ids    UUID[]      DEFAULT '{}',
  client_site_ids       UUID[]      DEFAULT '{}',
  
  -- Checkpoint configuration
  checkpoint_mode       TEXT        DEFAULT 'sequential'
                          CHECK (checkpoint_mode IN (
                            'sequential',
                            'any_order',
                            'random',
                            'none'
                          )),
  min_checkpoints_required INTEGER,
  
  -- Recurrence
  active_days           INTEGER[]   DEFAULT '{1,2,3,4,5,6,7}',
  is_active             BOOLEAN     DEFAULT TRUE,
  
  -- Metadata
  color                 TEXT        DEFAULT '#3B82F6',
  icon                  TEXT        DEFAULT 'route',
  tags                  TEXT[]      DEFAULT '{}',
  
  created_by            UUID        REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patrol_routes_org ON patrol_routes(organization_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_patrol_routes_code ON patrol_routes(route_code) WHERE route_code IS NOT NULL;

-- ============================================================================
-- 2. PATROL CHECKPOINTS — Required scan/visit points within a route
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patrol_route_checkpoints (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_route_id       UUID        NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  
  -- Checkpoint info
  name                  TEXT        NOT NULL,
  description           TEXT,
  
  -- Location (for GPS verification)
  location_lat          DECIMAL(10, 7),
  location_lng          DECIMAL(11, 7),
  geofence_radius_meters INTEGER    DEFAULT 50,
  
  -- Sequence
  sequence_order        INTEGER     NOT NULL DEFAULT 0,
  
  -- Scan requirements
  scan_type             TEXT        DEFAULT 'gps'
                          CHECK (scan_type IN ('gps', 'nfc', 'qr', 'manual')),
  nfc_tag_id            TEXT,
  qr_code_data          TEXT,
  
  -- Timing
  expected_arrival_offset_minutes INTEGER,
  max_time_at_checkpoint_minutes INTEGER DEFAULT 15,
  
  -- Task requirements
  required_actions      JSONB       DEFAULT '[]',
  
  is_mandatory          BOOLEAN     DEFAULT TRUE,
  is_active             BOOLEAN     DEFAULT TRUE,
  
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patrol_checkpoints_route ON patrol_route_checkpoints(patrol_route_id);

-- ============================================================================
-- 3. PATROL ROUTE ZONE COVERAGE (Many-to-Many)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patrol_route_zones (
  patrol_route_id       UUID        NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  zone_id               UUID        NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  coverage_priority     INTEGER     DEFAULT 1,
  PRIMARY KEY (patrol_route_id, zone_id)
);

-- ============================================================================
-- 4. PATROL ROUTE SITE COVERAGE (Many-to-Many)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patrol_route_sites (
  patrol_route_id       UUID        NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  site_id               UUID        NOT NULL REFERENCES public.client_sites(id) ON DELETE CASCADE,
  coverage_priority     INTEGER     DEFAULT 1,
  PRIMARY KEY (patrol_route_id, site_id)
);

-- ============================================================================
-- 5. ROSTER TEMPLATES — Weekly/monthly roster patterns
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.roster_templates (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  name                  TEXT        NOT NULL,
  description           TEXT,
  
  -- Template type
  template_type         TEXT        DEFAULT 'weekly'
                          CHECK (template_type IN ('weekly', 'fortnightly', 'monthly')),
  
  -- Active period
  effective_from        DATE,
  effective_to          DATE,
  
  is_active             BOOLEAN     DEFAULT TRUE,
  created_by            UUID        REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roster_templates_org ON roster_templates(organization_id) WHERE is_active;

-- ============================================================================
-- 6. ROSTER ASSIGNMENTS — Officer assignments to patrol routes
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.roster_assignments (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  roster_template_id    UUID        REFERENCES public.roster_templates(id) ON DELETE SET NULL,
  
  -- Who
  officer_id            UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- What
  patrol_route_id       UUID        NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  
  -- When (for recurring)
  day_of_week           INTEGER     CHECK (day_of_week BETWEEN 1 AND 7),
  shift                 TEXT        NOT NULL CHECK (shift IN ('day', 'swing', 'night')),
  start_time            TIME,
  end_time              TIME,
  
  -- OR specific date (for one-off)
  specific_date         DATE,
  
  -- Status
  assignment_status     TEXT        DEFAULT 'scheduled'
                          CHECK (assignment_status IN (
                            'scheduled',
                            'confirmed',
                            'declined',
                            'swapped',
                            'cancelled'
                          )),
  
  -- Swap tracking
  swapped_with_id       UUID        REFERENCES public.roster_assignments(id),
  swap_reason           TEXT,
  
  -- Notification
  notification_sent_at  TIMESTAMPTZ,
  accepted_at           TIMESTAMPTZ,
  declined_at           TIMESTAMPTZ,
  decline_reason        TEXT,
  
  created_by            UUID        REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  
  CHECK (
    (day_of_week IS NOT NULL AND specific_date IS NULL) OR
    (day_of_week IS NULL AND specific_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_roster_officer ON roster_assignments(officer_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_roster_route ON roster_assignments(patrol_route_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_roster_date ON roster_assignments(specific_date) WHERE specific_date IS NOT NULL;

-- ============================================================================
-- 7. PATROL CHECKPOINT SCANS — Scan records
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patrol_checkpoint_scans (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_id             UUID        NOT NULL REFERENCES public.patrols(id) ON DELETE CASCADE,
  checkpoint_id         UUID        NOT NULL REFERENCES public.patrol_route_checkpoints(id),
  
  -- Scan details
  scanned_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scan_method           TEXT        NOT NULL DEFAULT 'gps'
                          CHECK (scan_method IN ('gps', 'nfc', 'qr', 'manual')),
  
  -- Location at scan
  gps_lat               DECIMAL(10, 7),
  gps_lng               DECIMAL(11, 7),
  gps_accuracy_meters   INTEGER,
  
  -- Verification
  auto_verified         BOOLEAN     DEFAULT FALSE,
  verified_by           UUID        REFERENCES public.user_profiles(id),
  
  -- Actions completed
  actions_completed     JSONB       DEFAULT '[]',
  notes                 TEXT,
  
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_scans_patrol ON patrol_checkpoint_scans(patrol_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_scans_date ON patrol_checkpoint_scans(scanned_at);

-- ============================================================================
-- 8. PTT CHANNEL AUTHORIZATIONS — Cross-org communication permissions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ptt_channel_authorizations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- The channel being accessed
  channel_organization_id UUID      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_type          TEXT        NOT NULL DEFAULT 'contract'
                          CHECK (channel_type IN (
                            'contract',
                            'mutual_aid',
                            'emergency',
                            'inter_org'
                          )),
  
  -- Who is authorized
  authorized_org_id     UUID        REFERENCES public.organizations(id) ON DELETE CASCADE,
  authorized_user_id    UUID        REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- Authorization details
  authorization_name    TEXT,
  authorization_reason  TEXT,
  
  -- Validity
  valid_from            TIMESTAMPTZ DEFAULT NOW(),
  valid_until           TIMESTAMPTZ,
  
  -- Permissions
  can_listen            BOOLEAN     DEFAULT TRUE,
  can_transmit          BOOLEAN     DEFAULT TRUE,
  can_create_channels   BOOLEAN     DEFAULT FALSE,
  
  -- Status
  is_active             BOOLEAN     DEFAULT TRUE,
  
  created_by            UUID        REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  
  CHECK (
    (authorized_org_id IS NOT NULL AND authorized_user_id IS NULL) OR
    (authorized_org_id IS NULL AND authorized_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ptt_auth_channel_org ON ptt_channel_authorizations(channel_organization_id);
CREATE INDEX IF NOT EXISTS idx_ptt_auth_org ON ptt_channel_authorizations(authorized_org_id);

-- ============================================================================
-- 9. PTT CONTRACT AUTHORIZATIONS — Linked to CRM contracts
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ptt_contract_authorizations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           UUID        NOT NULL REFERENCES public.crm_contracts(id) ON DELETE CASCADE,
  
  -- Provider org (e.g., First Security)
  provider_org_id       UUID        NOT NULL REFERENCES public.organizations(id),
  
  -- Client org (e.g., Nelson City Council)
  client_org_id         UUID        NOT NULL REFERENCES public.organizations(id),
  
  -- Auto-created channel
  channel_key           TEXT        UNIQUE,
  channel_name          TEXT,
  
  -- Which provider staff can access
  all_provider_staff    BOOLEAN     DEFAULT FALSE,
  authorized_roles      TEXT[]      DEFAULT '{}',
  authorized_users      UUID[]      DEFAULT '{}',
  
  -- Status
  is_active             BOOLEAN     DEFAULT TRUE,
  
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (contract_id, provider_org_id, client_org_id)
);

CREATE INDEX IF NOT EXISTS idx_ptt_contract_auth_contract ON ptt_contract_authorizations(contract_id);
CREATE INDEX IF NOT EXISTS idx_ptt_contract_auth_provider ON ptt_contract_authorizations(provider_org_id);

-- ============================================================================
-- 10. ADD PATROL_ROUTE_ID TO PATROLS TABLE
-- ============================================================================

ALTER TABLE public.patrols ADD COLUMN IF NOT EXISTS
  patrol_route_id UUID REFERENCES public.patrol_routes(id);

CREATE INDEX IF NOT EXISTS idx_patrols_route ON patrols(patrol_route_id);

-- ============================================================================
-- 11. ADD PATROL_ROUTE_ID TO DISPATCH_JOBS TABLE
-- ============================================================================

ALTER TABLE public.dispatch_jobs ADD COLUMN IF NOT EXISTS
  patrol_route_id UUID REFERENCES public.patrol_routes(id);

-- ============================================================================
-- 12. ENHANCE OFFICER WELFARE SETTINGS FOR ACTIVITY BYPASS
-- ============================================================================

ALTER TABLE public.officer_welfare_settings ADD COLUMN IF NOT EXISTS
  activity_bypass_enabled     BOOLEAN     DEFAULT TRUE;
  
ALTER TABLE public.officer_welfare_settings ADD COLUMN IF NOT EXISTS
  activity_window_minutes     INTEGER     DEFAULT 15;
  
ALTER TABLE public.officer_welfare_settings ADD COLUMN IF NOT EXISTS
  min_gps_updates_for_bypass  INTEGER     DEFAULT 3;
  
ALTER TABLE public.officer_welfare_settings ADD COLUMN IF NOT EXISTS
  min_actions_for_bypass      INTEGER     DEFAULT 1;

-- ============================================================================
-- 13. HELPER FUNCTIONS
-- ============================================================================

-- Get officer currently on a patrol route
CREATE OR REPLACE FUNCTION get_officer_on_patrol_route(
  p_route_id UUID,
  p_organization_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_officer_id UUID;
BEGIN
  SELECT p.assigned_to INTO v_officer_id
  FROM patrols p
  WHERE p.patrol_route_id = p_route_id
    AND p.status = 'in_progress'
    AND (p_organization_id IS NULL OR p.organization_id = p_organization_id)
  ORDER BY p.started_at DESC
  LIMIT 1;
  
  RETURN v_officer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dispatch job to patrol route
CREATE OR REPLACE FUNCTION dispatch_job_to_route(
  p_job_id UUID,
  p_route_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_officer_id UUID;
  v_job RECORD;
BEGIN
  SELECT get_officer_on_patrol_route(p_route_id) INTO v_officer_id;
  
  IF v_officer_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'No officer currently on this patrol route'
    );
  END IF;
  
  UPDATE dispatch_jobs
  SET assigned_to = v_officer_id,
      patrol_route_id = p_route_id,
      status = 'dispatched',
      dispatched_at = NOW()
  WHERE id = p_job_id
  RETURNING * INTO v_job;
  
  INSERT INTO notifications (
    user_id, organization_id, type, title, body, data
  ) VALUES (
    v_officer_id,
    v_job.organization_id,
    'job_dispatched',
    'New Job: ' || v_job.title,
    COALESCE(v_job.description, ''),
    jsonb_build_object('job_id', p_job_id, 'route_id', p_route_id)
  );
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'officer_id', v_officer_id,
    'job_id', p_job_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check officer activity for welfare bypass
CREATE OR REPLACE FUNCTION check_officer_activity(
  p_officer_id UUID,
  p_window_minutes INTEGER DEFAULT 15
)
RETURNS JSONB AS $$
DECLARE
  v_gps_count INTEGER;
  v_action_count INTEGER;
  v_last_gps TIMESTAMPTZ;
  v_last_action TIMESTAMPTZ;
BEGIN
  SELECT COUNT(*), MAX(recorded_at)
  INTO v_gps_count, v_last_gps
  FROM officer_locations
  WHERE officer_id = p_officer_id
    AND recorded_at >= NOW() - (p_window_minutes || ' minutes')::INTERVAL;
  
  SELECT COUNT(*), MAX(recorded_at)
  INTO v_action_count, v_last_action
  FROM (
    SELECT recorded_at FROM observations WHERE recorded_by = p_officer_id
    UNION ALL
    SELECT scanned_at AS recorded_at FROM patrol_checkpoint_scans pcs
      JOIN patrols p ON p.id = pcs.patrol_id
      WHERE p.assigned_to = p_officer_id
  ) actions
  WHERE recorded_at >= NOW() - (p_window_minutes || ' minutes')::INTERVAL;
  
  RETURN jsonb_build_object(
    'gps_updates', COALESCE(v_gps_count, 0),
    'actions', COALESCE(v_action_count, 0),
    'last_gps', v_last_gps,
    'last_action', v_last_action,
    'is_active', (COALESCE(v_gps_count, 0) >= 3 OR COALESCE(v_action_count, 0) >= 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-scan checkpoint
CREATE OR REPLACE FUNCTION auto_scan_checkpoint(
  p_patrol_id UUID,
  p_checkpoint_id UUID,
  p_gps_lat DECIMAL,
  p_gps_lng DECIMAL
)
RETURNS JSONB AS $$
DECLARE
  v_checkpoint RECORD;
  v_distance FLOAT;
  v_existing UUID;
BEGIN
  SELECT * INTO v_checkpoint
  FROM patrol_route_checkpoints
  WHERE id = p_checkpoint_id;
  
  IF v_checkpoint IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Checkpoint not found');
  END IF;
  
  SELECT id INTO v_existing
  FROM patrol_checkpoint_scans
  WHERE patrol_id = p_patrol_id
    AND checkpoint_id = p_checkpoint_id
    AND scanned_at::DATE = CURRENT_DATE;
  
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Already scanned today');
  END IF;
  
  -- Calculate distance using earth_distance if available, else approximate
  v_distance := 111320 * SQRT(
    POWER(v_checkpoint.location_lat - p_gps_lat, 2) +
    POWER((v_checkpoint.location_lng - p_gps_lng) * COS(RADIANS(p_gps_lat)), 2)
  );
  
  IF v_distance > COALESCE(v_checkpoint.geofence_radius_meters, 50) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'Not within checkpoint geofence',
      'distance', v_distance
    );
  END IF;
  
  INSERT INTO patrol_checkpoint_scans (
    patrol_id, checkpoint_id, scan_method, gps_lat, gps_lng, auto_verified
  ) VALUES (
    p_patrol_id, p_checkpoint_id, 'gps', p_gps_lat, p_gps_lng, TRUE
  );
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'message', 'Checkpoint scanned',
    'checkpoint_name', v_checkpoint.name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto welfare check-in on geofence entry
CREATE OR REPLACE FUNCTION auto_welfare_checkin_geofence(
  p_officer_id UUID,
  p_zone_id UUID,
  p_gps_lat DECIMAL,
  p_gps_lng DECIMAL
)
RETURNS JSONB AS $$
DECLARE
  v_org_id UUID;
  v_shift_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM user_profiles WHERE id = p_officer_id;
  
  SELECT id INTO v_shift_id
  FROM rostered_shifts
  WHERE officer_id = p_officer_id
    AND shift_date = CURRENT_DATE
    AND actual_end IS NULL
  LIMIT 1;
  
  INSERT INTO welfare_checkins (
    officer_id,
    organization_id,
    shift_id,
    check_type,
    gps_lat,
    gps_lng,
    notes
  ) VALUES (
    p_officer_id,
    v_org_id,
    v_shift_id,
    'geofence_auto',
    p_gps_lat,
    p_gps_lng,
    'Auto check-in on zone entry: ' || COALESCE(p_zone_id::TEXT, 'unknown')
  );
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'message', 'Welfare check-in recorded via geofence entry'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user has PTT authorization for cross-org channel
CREATE OR REPLACE FUNCTION check_ptt_cross_org_auth(
  p_user_id UUID,
  p_target_org_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_user_org_id UUID;
  v_user_role TEXT;
  v_auth RECORD;
  v_contract_auth RECORD;
BEGIN
  SELECT organization_id, role INTO v_user_org_id, v_user_role
  FROM user_profiles WHERE id = p_user_id;
  
  IF v_user_org_id = p_target_org_id THEN
    RETURN jsonb_build_object('authorized', TRUE, 'reason', 'Same organization');
  END IF;
  
  IF v_user_role IN ('master', 'grand_master') THEN
    RETURN jsonb_build_object('authorized', TRUE, 'reason', 'Admin access');
  END IF;
  
  SELECT * INTO v_auth
  FROM ptt_channel_authorizations
  WHERE channel_organization_id = p_target_org_id
    AND (authorized_org_id = v_user_org_id OR authorized_user_id = p_user_id)
    AND is_active = TRUE
    AND (valid_until IS NULL OR valid_until > NOW())
  LIMIT 1;
  
  IF v_auth IS NOT NULL THEN
    RETURN jsonb_build_object(
      'authorized', TRUE,
      'channel', 'interorg:' || p_target_org_id,
      'can_transmit', v_auth.can_transmit,
      'authorization_name', v_auth.authorization_name
    );
  END IF;
  
  SELECT pca.* INTO v_contract_auth
  FROM ptt_contract_authorizations pca
  JOIN crm_contracts c ON c.id = pca.contract_id
  WHERE pca.provider_org_id = v_user_org_id
    AND pca.client_org_id = p_target_org_id
    AND pca.is_active = TRUE
    AND c.status = 'active'
    AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
  LIMIT 1;
  
  IF v_contract_auth IS NOT NULL THEN
    IF v_contract_auth.all_provider_staff OR 
       v_user_role = ANY(v_contract_auth.authorized_roles) OR
       p_user_id = ANY(v_contract_auth.authorized_users) THEN
      RETURN jsonb_build_object(
        'authorized', TRUE,
        'channel', 'contract:' || v_contract_auth.contract_id,
        'channel_name', v_contract_auth.channel_name
      );
    END IF;
  END IF;
  
  SELECT pca.* INTO v_contract_auth
  FROM ptt_contract_authorizations pca
  JOIN crm_contracts c ON c.id = pca.contract_id
  WHERE pca.client_org_id = v_user_org_id
    AND pca.provider_org_id = p_target_org_id
    AND pca.is_active = TRUE
    AND c.status = 'active'
  LIMIT 1;
  
  IF v_contract_auth IS NOT NULL THEN
    RETURN jsonb_build_object(
      'authorized', TRUE,
      'channel', 'contract:' || v_contract_auth.contract_id,
      'channel_name', v_contract_auth.channel_name
    );
  END IF;
  
  RETURN jsonb_build_object('authorized', FALSE, 'reason', 'No authorization found');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 14. RLS POLICIES
-- ============================================================================

ALTER TABLE patrol_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_route_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_route_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_route_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_checkpoint_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ptt_channel_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ptt_contract_authorizations ENABLE ROW LEVEL SECURITY;

-- Patrol routes - org members can view, admins can manage
DROP POLICY IF EXISTS "patrol_routes_select" ON patrol_routes;
CREATE POLICY "patrol_routes_select" ON patrol_routes
  FOR SELECT USING (
    organization_id = get_user_organization_id(auth.uid())
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master'))
  );

DROP POLICY IF EXISTS "patrol_routes_manage" ON patrol_routes;
CREATE POLICY "patrol_routes_manage" ON patrol_routes
  FOR ALL USING (
    organization_id = get_user_organization_id(auth.uid())
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master', 'grand_master'))
  );

-- Checkpoints - same as routes
DROP POLICY IF EXISTS "patrol_checkpoints_select" ON patrol_route_checkpoints;
CREATE POLICY "patrol_checkpoints_select" ON patrol_route_checkpoints
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM patrol_routes pr 
      WHERE pr.id = patrol_route_id 
      AND (pr.organization_id = get_user_organization_id(auth.uid()) OR
           EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master')))
    )
  );

DROP POLICY IF EXISTS "patrol_checkpoints_manage" ON patrol_route_checkpoints;
CREATE POLICY "patrol_checkpoints_manage" ON patrol_route_checkpoints
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM patrol_routes pr 
      WHERE pr.id = patrol_route_id 
      AND pr.organization_id = get_user_organization_id(auth.uid())
      AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master', 'grand_master'))
    )
  );

-- Roster templates - org admins
DROP POLICY IF EXISTS "roster_templates_select" ON roster_templates;
CREATE POLICY "roster_templates_select" ON roster_templates
  FOR SELECT USING (
    organization_id = get_user_organization_id(auth.uid())
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master'))
  );

DROP POLICY IF EXISTS "roster_templates_manage" ON roster_templates;
CREATE POLICY "roster_templates_manage" ON roster_templates
  FOR ALL USING (
    organization_id = get_user_organization_id(auth.uid())
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master', 'grand_master'))
  );

-- Roster assignments - officers see own, admins see all
DROP POLICY IF EXISTS "roster_assignments_select" ON roster_assignments;
CREATE POLICY "roster_assignments_select" ON roster_assignments
  FOR SELECT USING (
    officer_id = auth.uid()
    OR organization_id = get_user_organization_id(auth.uid())
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master'))
  );

DROP POLICY IF EXISTS "roster_assignments_manage" ON roster_assignments;
CREATE POLICY "roster_assignments_manage" ON roster_assignments
  FOR ALL USING (
    organization_id = get_user_organization_id(auth.uid())
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master', 'grand_master'))
  );

-- Checkpoint scans - officers see own patrols
DROP POLICY IF EXISTS "checkpoint_scans_select" ON patrol_checkpoint_scans;
CREATE POLICY "checkpoint_scans_select" ON patrol_checkpoint_scans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM patrols p 
      WHERE p.id = patrol_id 
      AND (p.assigned_to = auth.uid() OR p.organization_id = get_user_organization_id(auth.uid()))
    )
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master'))
  );

DROP POLICY IF EXISTS "checkpoint_scans_insert" ON patrol_checkpoint_scans;
CREATE POLICY "checkpoint_scans_insert" ON patrol_checkpoint_scans
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM patrols p 
      WHERE p.id = patrol_id 
      AND p.assigned_to = auth.uid()
    )
  );

-- PTT authorizations - org admins
DROP POLICY IF EXISTS "ptt_auth_select" ON ptt_channel_authorizations;
CREATE POLICY "ptt_auth_select" ON ptt_channel_authorizations
  FOR SELECT USING (
    channel_organization_id = get_user_organization_id(auth.uid())
    OR authorized_org_id = get_user_organization_id(auth.uid())
    OR authorized_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master'))
  );

DROP POLICY IF EXISTS "ptt_auth_manage" ON ptt_channel_authorizations;
CREATE POLICY "ptt_auth_manage" ON ptt_channel_authorizations
  FOR ALL USING (
    channel_organization_id = get_user_organization_id(auth.uid())
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master', 'grand_master'))
  );

-- PTT contract authorizations - org admins
DROP POLICY IF EXISTS "ptt_contract_auth_select" ON ptt_contract_authorizations;
CREATE POLICY "ptt_contract_auth_select" ON ptt_contract_authorizations
  FOR SELECT USING (
    provider_org_id = get_user_organization_id(auth.uid())
    OR client_org_id = get_user_organization_id(auth.uid())
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('master', 'grand_master'))
  );

DROP POLICY IF EXISTS "ptt_contract_auth_manage" ON ptt_contract_authorizations;
CREATE POLICY "ptt_contract_auth_manage" ON ptt_contract_authorizations
  FOR ALL USING (
    (provider_org_id = get_user_organization_id(auth.uid()) OR client_org_id = get_user_organization_id(auth.uid()))
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master', 'grand_master'))
  );

-- ============================================================================
-- 15. GRANTS
-- ============================================================================

GRANT SELECT ON patrol_routes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON patrol_routes TO authenticated;

GRANT SELECT ON patrol_route_checkpoints TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON patrol_route_checkpoints TO authenticated;

GRANT SELECT ON patrol_route_zones TO authenticated;
GRANT SELECT, INSERT, DELETE ON patrol_route_zones TO authenticated;

GRANT SELECT ON patrol_route_sites TO authenticated;
GRANT SELECT, INSERT, DELETE ON patrol_route_sites TO authenticated;

GRANT SELECT ON roster_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON roster_templates TO authenticated;

GRANT SELECT ON roster_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON roster_assignments TO authenticated;

GRANT SELECT ON patrol_checkpoint_scans TO authenticated;
GRANT INSERT ON patrol_checkpoint_scans TO authenticated;

GRANT SELECT ON ptt_channel_authorizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ptt_channel_authorizations TO authenticated;

GRANT SELECT ON ptt_contract_authorizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ptt_contract_authorizations TO authenticated;

GRANT EXECUTE ON FUNCTION get_officer_on_patrol_route TO authenticated;
GRANT EXECUTE ON FUNCTION dispatch_job_to_route TO authenticated;
GRANT EXECUTE ON FUNCTION check_officer_activity TO authenticated;
GRANT EXECUTE ON FUNCTION auto_scan_checkpoint TO authenticated;
GRANT EXECUTE ON FUNCTION auto_welfare_checkin_geofence TO authenticated;
GRANT EXECUTE ON FUNCTION check_ptt_cross_org_auth TO authenticated;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
