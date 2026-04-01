-- =============================================================================
-- MODULAR PLATFORM INFRASTRUCTURE (Standalone/White-label)
-- =============================================================================
-- This migration creates the foundational tables for the modular platform
-- architecture. The platform is designed as a standalone, white-label system
-- with pluggable service modules that can be individually licensed.
--
-- 3rd Party Integrations:
-- - NZSCV (NZ Self-Contained Vehicle registry)
-- - Motoweb (NZ vehicle registration)
-- - OpenAI (optional AI features)
-- - Self-hosted AI on Railway (ALPR, face recognition)
--
-- No vendor lock-in - fully self-hosted option available.
-- =============================================================================

-- =============================================================================
-- 1. SERVICE MODULES REGISTRY (Reference table)
-- =============================================================================
-- Stores the canonical list of available service modules

CREATE TABLE IF NOT EXISTS service_modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('enforcement', 'security', 'operations', 'communication')),
  icon_name TEXT NOT NULL,
  color TEXT NOT NULL,
  
  -- Pricing defaults (can be overridden per org)
  default_billing_model TEXT NOT NULL CHECK (default_billing_model IN ('seat', 'transaction', 'hybrid', 'flat')),
  default_base_fee_cents INTEGER DEFAULT 0,
  default_per_seat_fee_cents INTEGER DEFAULT 0,
  default_per_transaction_fee_cents INTEGER DEFAULT 0,
  
  -- Feature flags associated with this module
  feature_flags TEXT[] DEFAULT '{}',
  
  -- Dependencies (other modules that must be enabled)
  requires_modules TEXT[] DEFAULT '{}',
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  is_core BOOLEAN DEFAULT FALSE,  -- Core modules are always enabled
  
  -- Ordering for UI
  display_order INTEGER DEFAULT 100,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert the service modules
INSERT INTO service_modules (id, name, description, category, icon_name, color, default_billing_model, default_base_fee_cents, default_per_seat_fee_cents, default_per_transaction_fee_cents, is_core, display_order) VALUES
  ('core', 'Core Platform', 'Core platform features: auth, organizations, users, zones, tracking', 'operations', 'Shield', 'slate', 'flat', 0, 0, 0, TRUE, 0),
  ('freedom_camping', 'Freedom Camping', 'Vehicle compliance monitoring for freedom camping zones (integrates with NZSCV, Motoweb)', 'enforcement', 'Tent', 'green', 'hybrid', 19900, 2900, 5, FALSE, 10),
  ('parking', 'Parking Enforcement', 'Parking violations, infringements, and permit management', 'enforcement', 'ParkingSquare', 'blue', 'hybrid', 24900, 3900, 10, FALSE, 20),
  ('noise', 'Noise Control', 'Noise complaint management and RMA compliance', 'enforcement', 'Volume2', 'purple', 'hybrid', 14900, 2900, 25, FALSE, 30),
  ('guarding', 'Site Guarding', 'Static site security, checkpoints, and visitor management (self-hosted face recognition)', 'security', 'Shield', 'amber', 'seat', 29900, 4900, 0, FALSE, 40),
  ('patrol', 'General Patrol', 'Mobile patrol, alarm response, and incident reporting', 'security', 'Car', 'red', 'seat', 19900, 3900, 0, FALSE, 50),
  ('rostering', 'Roster & Scheduling', 'Shift planning and officer availability management', 'operations', 'Calendar', 'cyan', 'seat', 9900, 1900, 0, FALSE, 60),
  ('ptt_chat', 'PTT & Team Chat', 'Real-time push-to-talk and team communication', 'communication', 'Radio', 'indigo', 'seat', 4900, 900, 0, FALSE, 70),
  ('crm', 'Customer Relationship', 'Accounts, contacts, contracts, and compliance tracking', 'operations', 'Building2', 'emerald', 'seat', 9900, 1900, 0, FALSE, 80),
  ('ems', 'EMS Response', 'Emergency medical response coordination', 'security', 'Ambulance', 'rose', 'hybrid', 14900, 2900, 50, FALSE, 90),
  ('dispatch', 'Dispatch Console', 'CAD-style job dispatch across all services', 'operations', 'MonitorPlay', 'violet', 'seat', 14900, 2900, 0, FALSE, 100)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- =============================================================================
-- 2. ORGANIZATION MODULE SUBSCRIPTIONS
-- =============================================================================
-- Tracks which modules are enabled for each organization

CREATE TABLE IF NOT EXISTS organization_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES service_modules(id),
  
  -- Subscription status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled', 'trial', 'pending')),
  
  -- Licensing
  licensed_seats INTEGER DEFAULT NULL,  -- NULL = unlimited
  current_seats INTEGER DEFAULT 0,
  
  -- Billing (overrides module defaults)
  billing_model TEXT NOT NULL CHECK (billing_model IN ('seat', 'transaction', 'hybrid', 'flat')),
  base_fee_cents INTEGER DEFAULT 0,
  per_seat_fee_cents INTEGER DEFAULT 0,
  per_transaction_fee_cents INTEGER DEFAULT 0,
  
  -- Trial/promo
  trial_ends_at TIMESTAMPTZ DEFAULT NULL,
  promo_code TEXT DEFAULT NULL,
  discount_percent INTEGER DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  
  -- Audit trail
  enabled_at TIMESTAMPTZ DEFAULT NOW(),
  enabled_by UUID REFERENCES user_profiles(id),
  disabled_at TIMESTAMPTZ DEFAULT NULL,
  disabled_by UUID REFERENCES user_profiles(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (organization_id, module_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_org_modules_org_id ON organization_modules(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_modules_module_id ON organization_modules(module_id);
CREATE INDEX IF NOT EXISTS idx_org_modules_status ON organization_modules(status);
CREATE INDEX IF NOT EXISTS idx_org_modules_org_status ON organization_modules(organization_id, status);

-- =============================================================================
-- 3. MODULE USAGE EVENTS (for per-transaction billing)
-- =============================================================================

CREATE TABLE IF NOT EXISTS module_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES service_modules(id),
  
  -- Event details
  event_type TEXT NOT NULL,  -- 'scan', 'infringement', 'notice', 'job', 'shift', etc.
  event_id UUID,             -- Reference to the actual record (observation_id, etc.)
  event_table TEXT,          -- Which table the event_id refers to
  event_timestamp TIMESTAMPTZ DEFAULT NOW(),
  
  -- Billing
  billable_units INTEGER DEFAULT 1,
  unit_fee_cents INTEGER DEFAULT 0,  -- Captured at time of event
  
  -- Billing status
  billing_period TEXT,       -- '2026-03' format
  billed_at TIMESTAMPTZ DEFAULT NULL,
  invoice_id TEXT DEFAULT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for billing queries
CREATE INDEX IF NOT EXISTS idx_usage_events_billing ON module_usage_events(organization_id, billing_period, billed_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_module ON module_usage_events(module_id, event_timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_events_unbilled ON module_usage_events(organization_id, billed_at) WHERE billed_at IS NULL;

-- =============================================================================
-- 4. RLS POLICIES
-- =============================================================================

ALTER TABLE service_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_usage_events ENABLE ROW LEVEL SECURITY;

-- Service modules: readable by all authenticated users
CREATE POLICY "service_modules_read_all" ON service_modules
  FOR SELECT TO authenticated
  USING (TRUE);

-- Service modules: writable only by grand_master
CREATE POLICY "service_modules_write_grand_master" ON service_modules
  FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

-- Organization modules: grand_master can do everything
CREATE POLICY "org_modules_grand_master" ON organization_modules
  FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

-- Organization modules: org members can read their own
CREATE POLICY "org_modules_read_own" ON organization_modules
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
      UNION
      SELECT up.employer_organization_id FROM user_profiles up WHERE up.id = auth.uid()
    )
  );

-- Usage events: grand_master can do everything
CREATE POLICY "usage_events_grand_master" ON module_usage_events
  FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

-- Usage events: service functions can insert
CREATE POLICY "usage_events_insert_service" ON module_usage_events
  FOR INSERT TO authenticated
  WITH CHECK (TRUE);  -- Further restricted by Edge Function auth

-- Usage events: org admins can read their own
CREATE POLICY "usage_events_read_own" ON module_usage_events
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT up.organization_id FROM user_profiles up 
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'master', 'admin_officer')
    )
  );

-- =============================================================================
-- 5. HELPER FUNCTIONS
-- =============================================================================

-- Check if an organization has access to a module
CREATE OR REPLACE FUNCTION check_module_access(
  p_organization_id UUID,
  p_module_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_core BOOLEAN;
  v_is_enabled BOOLEAN;
BEGIN
  -- Check if module is a core module (always enabled)
  SELECT is_core INTO v_is_core
  FROM service_modules
  WHERE id = p_module_id;
  
  IF v_is_core THEN
    RETURN TRUE;
  END IF;
  
  -- Check organization subscription
  SELECT EXISTS (
    SELECT 1 FROM organization_modules
    WHERE organization_id = p_organization_id
      AND module_id = p_module_id
      AND status IN ('active', 'trial')
      AND (trial_ends_at IS NULL OR trial_ends_at > NOW())
  ) INTO v_is_enabled;
  
  RETURN v_is_enabled;
END;
$$;

-- Get all enabled modules for an organization
CREATE OR REPLACE FUNCTION get_enabled_modules(
  p_organization_id UUID
) RETURNS TABLE (
  module_id TEXT,
  module_name TEXT,
  status TEXT,
  licensed_seats INTEGER,
  current_seats INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sm.id AS module_id,
    sm.name AS module_name,
    COALESCE(om.status, CASE WHEN sm.is_core THEN 'active' ELSE 'disabled' END) AS status,
    om.licensed_seats,
    om.current_seats
  FROM service_modules sm
  LEFT JOIN organization_modules om ON om.module_id = sm.id AND om.organization_id = p_organization_id
  WHERE sm.is_active = TRUE
    AND (
      sm.is_core = TRUE 
      OR (om.status IN ('active', 'trial') AND (om.trial_ends_at IS NULL OR om.trial_ends_at > NOW()))
    )
  ORDER BY sm.display_order;
END;
$$;

-- Record a usage event
CREATE OR REPLACE FUNCTION record_module_usage(
  p_organization_id UUID,
  p_module_id TEXT,
  p_event_type TEXT,
  p_event_id UUID DEFAULT NULL,
  p_event_table TEXT DEFAULT NULL,
  p_billable_units INTEGER DEFAULT 1
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
  v_fee_cents INTEGER;
  v_billing_period TEXT;
BEGIN
  -- Get the per-transaction fee for this module
  SELECT COALESCE(om.per_transaction_fee_cents, sm.default_per_transaction_fee_cents)
  INTO v_fee_cents
  FROM service_modules sm
  LEFT JOIN organization_modules om ON om.module_id = sm.id AND om.organization_id = p_organization_id
  WHERE sm.id = p_module_id;
  
  -- Calculate billing period (YYYY-MM)
  v_billing_period := TO_CHAR(NOW() AT TIME ZONE 'Pacific/Auckland', 'YYYY-MM');
  
  -- Insert usage event
  INSERT INTO module_usage_events (
    organization_id,
    module_id,
    event_type,
    event_id,
    event_table,
    billable_units,
    unit_fee_cents,
    billing_period
  ) VALUES (
    p_organization_id,
    p_module_id,
    p_event_type,
    p_event_id,
    p_event_table,
    p_billable_units,
    v_fee_cents,
    v_billing_period
  )
  RETURNING id INTO v_event_id;
  
  RETURN v_event_id;
END;
$$;

-- Get usage summary for billing
CREATE OR REPLACE FUNCTION get_module_usage_summary(
  p_organization_id UUID,
  p_billing_period TEXT DEFAULT NULL
) RETURNS TABLE (
  module_id TEXT,
  module_name TEXT,
  event_type TEXT,
  event_count BIGINT,
  total_units BIGINT,
  total_fee_cents BIGINT,
  billed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mue.module_id,
    sm.name AS module_name,
    mue.event_type,
    COUNT(*) AS event_count,
    SUM(mue.billable_units)::BIGINT AS total_units,
    SUM(mue.billable_units * mue.unit_fee_cents)::BIGINT AS total_fee_cents,
    mue.billed_at IS NOT NULL AS billed
  FROM module_usage_events mue
  JOIN service_modules sm ON sm.id = mue.module_id
  WHERE mue.organization_id = p_organization_id
    AND (p_billing_period IS NULL OR mue.billing_period = p_billing_period)
  GROUP BY mue.module_id, sm.name, mue.event_type, (mue.billed_at IS NOT NULL)
  ORDER BY sm.name, mue.event_type;
END;
$$;

-- =============================================================================
-- 6. TRIGGERS
-- =============================================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_module_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_service_modules_updated
  BEFORE UPDATE ON service_modules
  FOR EACH ROW
  EXECUTE FUNCTION update_module_timestamp();

CREATE TRIGGER tr_organization_modules_updated
  BEFORE UPDATE ON organization_modules
  FOR EACH ROW
  EXECUTE FUNCTION update_module_timestamp();

-- =============================================================================
-- 7. BACKFILL EXISTING ORGANIZATIONS
-- =============================================================================
-- Grant all existing organizations access to all modules (grandfather clause)

INSERT INTO organization_modules (
  organization_id,
  module_id,
  status,
  billing_model,
  base_fee_cents,
  per_seat_fee_cents,
  per_transaction_fee_cents,
  enabled_at
)
SELECT 
  o.id AS organization_id,
  sm.id AS module_id,
  'active' AS status,
  sm.default_billing_model AS billing_model,
  sm.default_base_fee_cents AS base_fee_cents,
  sm.default_per_seat_fee_cents AS per_seat_fee_cents,
  sm.default_per_transaction_fee_cents AS per_transaction_fee_cents,
  NOW() AS enabled_at
FROM organizations o
CROSS JOIN service_modules sm
WHERE sm.is_core = FALSE  -- Don't create subscriptions for core (it's always enabled)
  AND o.is_active = TRUE
ON CONFLICT (organization_id, module_id) DO NOTHING;

-- =============================================================================
-- 8. GRANTS
-- =============================================================================

GRANT SELECT ON service_modules TO authenticated;
GRANT SELECT ON organization_modules TO authenticated;
GRANT SELECT ON module_usage_events TO authenticated;
GRANT INSERT ON module_usage_events TO authenticated;

GRANT EXECUTE ON FUNCTION check_module_access TO authenticated;
GRANT EXECUTE ON FUNCTION get_enabled_modules TO authenticated;
GRANT EXECUTE ON FUNCTION record_module_usage TO authenticated;
GRANT EXECUTE ON FUNCTION get_module_usage_summary TO authenticated;

-- =============================================================================
-- 9. 3RD PARTY API CACHE TABLES
-- =============================================================================
-- Cache external API responses to reduce costs and improve performance

-- NZSCV cache (NZ Self-Contained Vehicle registry)
CREATE TABLE IF NOT EXISTS nzscv_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number TEXT NOT NULL,
  
  -- NZSCV response data
  is_self_contained BOOLEAN,
  certificate_number TEXT,
  expiry_date DATE,
  vehicle_type TEXT,
  issuer TEXT,
  raw_response JSONB,
  
  -- Cache metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT nzscv_cache_plate_unique UNIQUE (plate_number)
);

CREATE INDEX IF NOT EXISTS idx_nzscv_cache_plate ON nzscv_cache(plate_number);
CREATE INDEX IF NOT EXISTS idx_nzscv_cache_expires ON nzscv_cache(expires_at);

-- Motoweb cache (NZ vehicle registration via NZTA)
CREATE TABLE IF NOT EXISTS motoweb_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number TEXT NOT NULL,
  
  -- Motoweb response data
  make TEXT,
  model TEXT,
  year INTEGER,
  color TEXT,
  body_type TEXT,
  fuel_type TEXT,
  cc_rating INTEGER,
  gross_vehicle_mass INTEGER,
  rego_expiry DATE,
  wof_expiry DATE,
  stolen_status TEXT,
  raw_response JSONB,
  
  -- Cache metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT motoweb_cache_plate_unique UNIQUE (plate_number)
);

CREATE INDEX IF NOT EXISTS idx_motoweb_cache_plate ON motoweb_cache(plate_number);
CREATE INDEX IF NOT EXISTS idx_motoweb_cache_expires ON motoweb_cache(expires_at);

-- RLS for cache tables
ALTER TABLE nzscv_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoweb_cache ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read cache
CREATE POLICY "nzscv_cache_read" ON nzscv_cache FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "motoweb_cache_read" ON motoweb_cache FOR SELECT TO authenticated USING (TRUE);

-- Service role can write to cache (Edge Functions)
CREATE POLICY "nzscv_cache_write" ON nzscv_cache FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "motoweb_cache_write" ON motoweb_cache FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- =============================================================================
-- 10. PLATFORM CONFIGURATION TABLE
-- =============================================================================
-- White-label settings and 3rd party API configuration

CREATE TABLE IF NOT EXISTS platform_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Branding (white-label)
  platform_name TEXT NOT NULL DEFAULT 'Security Platform',
  logo_url TEXT,
  favicon_url TEXT,
  primary_color TEXT DEFAULT '#3b82f6',
  secondary_color TEXT DEFAULT '#64748b',
  
  -- Contact
  support_email TEXT,
  support_phone TEXT,
  support_url TEXT,
  
  -- Legal
  terms_url TEXT,
  privacy_url TEXT,
  
  -- 3rd Party API Settings (keys stored in Supabase secrets, not here)
  enable_nzscv_integration BOOLEAN DEFAULT FALSE,
  nzscv_api_url TEXT DEFAULT 'https://api.nzscv.govt.nz',
  
  enable_motoweb_integration BOOLEAN DEFAULT FALSE,
  motoweb_api_url TEXT DEFAULT 'https://api.nzta.govt.nz',
  
  enable_openai_integration BOOLEAN DEFAULT FALSE,
  openai_model TEXT DEFAULT 'gpt-4o-mini',
  
  -- Self-hosted AI (Railway)
  enable_self_hosted_ai BOOLEAN DEFAULT TRUE,
  inference_service_url TEXT,
  
  -- Feature toggles
  enable_ptt BOOLEAN DEFAULT TRUE,
  enable_face_recognition BOOLEAN DEFAULT TRUE,
  enable_alpr BOOLEAN DEFAULT TRUE,
  
  -- Singleton pattern
  singleton_key TEXT NOT NULL DEFAULT 'config' UNIQUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default config
INSERT INTO platform_config (singleton_key) VALUES ('config')
ON CONFLICT (singleton_key) DO NOTHING;

-- RLS for platform config
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;

-- All authenticated can read
CREATE POLICY "platform_config_read" ON platform_config FOR SELECT TO authenticated USING (TRUE);

-- Only grand_master can write
CREATE POLICY "platform_config_write" ON platform_config FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
-- This migration creates the modular platform infrastructure:
-- 
-- 1. Service modules registry (defines available modules)
-- 2. Organization module subscriptions (which orgs have which modules)
-- 3. Usage events (for per-transaction billing)
-- 4. 3rd party API caches (NZSCV, Motoweb)
-- 5. Platform configuration (white-label, API settings)
--
-- Next steps:
-- 1. Update frontend to use useEnabledModules hook
-- 2. Wrap routes with ModuleRoute component
-- 3. Update Edge Functions to check module access
-- 4. Configure 3rd party API keys in Supabase secrets
-- 5. Deploy inference service to Railway
-- =============================================================================
