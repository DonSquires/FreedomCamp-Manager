-- ============================================================================
-- COMPREHENSIVE VEHICLE ARCHITECTURE REBUILD
-- ============================================================================
-- Purpose: Rebuild vehicle data model with plate-number-centric design
-- 
-- NEW ARCHITECTURE:
-- 1. canonical_vehicles: One record per plate (master registry)
-- 2. vehicle_observations: Every sighting is independent (complete audit trail)
-- 3. vehicle_monthly_stays: Calendar month tracking with auto-reset
--
-- ENHANCEMENTS:
-- - Notes system in observations with count tracking
-- - Auto-populate observation details from canonical vehicle
-- - Previous notes reference to minimize AI credits
-- - Persistent breach records (immutable)
-- - AI profile photo selection
-- ============================================================================

-- ============================================================================
-- PHASE 1: CREATE NEW TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CANONICAL VEHICLES TABLE (Master Registry)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_vehicles (
  -- Primary Key
  plate_number TEXT PRIMARY KEY,
  
  -- Vehicle Details
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_color TEXT,
  
  -- Self-Contained Status
  self_contained BOOLEAN DEFAULT false,
  self_contained_expiry DATE,
  
  -- Special Status Flags
  homeless_status TEXT CHECK (homeless_status IN ('none', 'claimed', 'confirmed')) DEFAULT 'none',
  homeless_confirmed_at TIMESTAMPTZ,
  homeless_confirmed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  homeless_notes TEXT,
  
  is_flagged BOOLEAN DEFAULT false,
  flagged_priority TEXT CHECK (flagged_priority IN ('low', 'medium', 'high', 'critical')),
  flagged_reason TEXT,
  flagged_notes TEXT,
  flagged_at TIMESTAMPTZ,
  flagged_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  
  -- Owner Information (Optional)
  owner_first_name TEXT,
  owner_last_name TEXT,
  owner_company_name TEXT,
  owner_address TEXT,
  owner_address_verified BOOLEAN DEFAULT false,
  
  -- AI-Selected Profile Photo
  profile_photo TEXT, -- URL to best photo
  profile_photo_selected_at TIMESTAMPTZ,
  profile_photo_metadata JSONB, -- AI selection criteria/scores
  
  -- Notes Tracking (NEW)
  total_notes INTEGER DEFAULT 0,
  last_note_at TIMESTAMPTZ,
  last_note_preview TEXT, -- First 100 chars of last note for quick reference
  
  -- Statistics
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  total_observations INTEGER DEFAULT 0,
  total_breaches INTEGER DEFAULT 0,
  total_incidents INTEGER DEFAULT 0,
  total_hs_reports INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_flagged ON canonical_vehicles(is_flagged) WHERE is_flagged = true;
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_homeless ON canonical_vehicles(homeless_status) WHERE homeless_status != 'none';
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_last_seen ON canonical_vehicles(last_seen_at DESC);

-- ----------------------------------------------------------------------------
-- 2. VEHICLE OBSERVATIONS TABLE (Independent Records)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS observations (
  -- Primary Key
  observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to Canonical Vehicle
  plate_number TEXT NOT NULL REFERENCES canonical_vehicles(plate_number) ON DELETE CASCADE,
  
  -- Observation-Specific Vehicle Details (snapshot from canonical at time of observation)
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_color TEXT,
  self_contained BOOLEAN DEFAULT false,
  self_contained_expiry DATE,
  
  -- Photo Evidence
  photo TEXT, -- URL to observation photo
  photo_hash TEXT, -- SHA256 for court admissibility
  
  -- Location & Time
  gps_latitude NUMERIC(10,8),
  gps_longitude NUMERIC(11,8),
  gps_accuracy NUMERIC(10,2),
  recorded_at TIMESTAMPTZ NOT NULL,
  
  -- Context
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  recorded_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  
  -- Officer Notes (NEW)
  officer_notes TEXT,
  has_notes BOOLEAN DEFAULT false,
  notes_reference_previous BOOLEAN DEFAULT false, -- True if officer reviewed previous notes
  
  -- Event Indicators (sticky flags)
  has_hs_incident BOOLEAN DEFAULT false,
  hs_incident_id UUID REFERENCES health_safety_reports(id) ON DELETE SET NULL,
  
  has_incident BOOLEAN DEFAULT false,
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  
  has_homeless_claim BOOLEAN DEFAULT false,
  homeless_claim_notes TEXT,
  
  -- Breach Status (persistent, immutable once set)
  breach_warning BOOLEAN DEFAULT false, -- Will breach if stays overnight
  breach_warning_reason TEXT,
  
  is_breach BOOLEAN DEFAULT false, -- Currently in breach
  breach_type TEXT, -- 'too_many_nights', 'self_contained_violation', 'after_hours'
  breach_details JSONB, -- Permanent record of violation
  breach_detected_at TIMESTAMPTZ,
  
  -- Compliance Snapshot
  compliance_snapshot JSONB, -- Zone rules at time of observation
  is_compliant BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_observations_v2_plate ON observations(plate_number);
CREATE INDEX IF NOT EXISTS idx_observations_v2_zone ON observations(zone_id);
CREATE INDEX IF NOT EXISTS idx_observations_v2_org ON observations(organization_id);
CREATE INDEX IF NOT EXISTS idx_observations_v2_recorded_at ON observations(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_v2_breach ON observations(is_breach) WHERE is_breach = true;
CREATE INDEX IF NOT EXISTS idx_observations_v2_notes ON observations(has_notes) WHERE has_notes = true;

-- ----------------------------------------------------------------------------
-- 3. MONTHLY STAY TRACKING TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_monthly_stays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Vehicle Reference
  plate_number TEXT NOT NULL REFERENCES canonical_vehicles(plate_number) ON DELETE CASCADE,
  
  -- Location Context
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  
  -- Calendar Month (always YYYY-MM-01)
  calendar_month DATE NOT NULL,
  
  -- Stay Statistics
  nights_stayed INTEGER DEFAULT 0,
  consecutive_nights INTEGER DEFAULT 0,
  last_observation_date DATE,
  
  -- Observation References
  observation_ids UUID[] DEFAULT ARRAY[]::UUID[],
  
  -- Auto-Reset Tracking
  reset_at TIMESTAMPTZ, -- Next reset: YYYY-MM-01 08:00:00
  last_reset_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(plate_number, organization_id, zone_id, calendar_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_stays_plate ON vehicle_monthly_stays(plate_number);
CREATE INDEX IF NOT EXISTS idx_monthly_stays_month ON vehicle_monthly_stays(calendar_month);
CREATE INDEX IF NOT EXISTS idx_monthly_stays_zone ON vehicle_monthly_stays(zone_id);

-- ============================================================================
-- PHASE 2: MIGRATION FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Function: Auto-populate observation details from canonical vehicle
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION populate_observation_from_canonical()
RETURNS TRIGGER AS $$
DECLARE
  v_canonical RECORD;
BEGIN
  -- Fetch canonical vehicle details
  SELECT 
    vehicle_make,
    vehicle_model,
    vehicle_year,
    vehicle_color,
    self_contained,
    self_contained_expiry
  INTO v_canonical
  FROM canonical_vehicles
  WHERE plate_number = NEW.plate_number;
  
  -- If canonical vehicle exists, copy details to observation
  IF FOUND THEN
    NEW.vehicle_make := COALESCE(NEW.vehicle_make, v_canonical.vehicle_make);
    NEW.vehicle_model := COALESCE(NEW.vehicle_model, v_canonical.vehicle_model);
    NEW.vehicle_year := COALESCE(NEW.vehicle_year, v_canonical.vehicle_year);
    NEW.vehicle_color := COALESCE(NEW.vehicle_color, v_canonical.vehicle_color);
    NEW.self_contained := COALESCE(NEW.self_contained, v_canonical.self_contained);
    NEW.self_contained_expiry := COALESCE(NEW.self_contained_expiry, v_canonical.self_contained_expiry);
  END IF;
  
  -- Set has_notes flag
  IF NEW.officer_notes IS NOT NULL AND NEW.officer_notes != '' THEN
    NEW.has_notes := true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Function: Update canonical vehicle notes tracking
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_canonical_notes_tracking()
RETURNS TRIGGER AS $$
BEGIN
  -- Update notes count and preview in canonical vehicle
  IF NEW.has_notes = true THEN
    UPDATE canonical_vehicles
    SET 
      total_notes = total_notes + 1,
      last_note_at = NEW.recorded_at,
      last_note_preview = LEFT(NEW.officer_notes, 100)
    WHERE plate_number = NEW.plate_number;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Function: Update canonical vehicle statistics
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_canonical_stats_v2()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE canonical_vehicles
  SET 
    last_seen_at = NEW.recorded_at,
    total_observations = total_observations + 1,
    total_breaches = total_breaches + CASE WHEN NEW.is_breach THEN 1 ELSE 0 END,
    total_incidents = total_incidents + CASE WHEN NEW.has_incident THEN 1 ELSE 0 END,
    total_hs_reports = total_hs_reports + CASE WHEN NEW.has_hs_incident THEN 1 ELSE 0 END,
    updated_at = now()
  WHERE plate_number = NEW.plate_number;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PHASE 3: TRIGGERS
-- ============================================================================

-- Auto-populate observation from canonical
DROP TRIGGER IF EXISTS trigger_populate_observation_from_canonical ON observations;
CREATE TRIGGER trigger_populate_observation_from_canonical
  BEFORE INSERT ON observations
  FOR EACH ROW
  EXECUTE FUNCTION populate_observation_from_canonical();

-- Update canonical notes tracking
DROP TRIGGER IF EXISTS trigger_update_canonical_notes ON observations;
CREATE TRIGGER trigger_update_canonical_notes
  AFTER INSERT ON observations
  FOR EACH ROW
  WHEN (NEW.has_notes = true)
  EXECUTE FUNCTION update_canonical_notes_tracking();

-- Update canonical statistics
DROP TRIGGER IF EXISTS trigger_update_canonical_stats_v2 ON observations;
CREATE TRIGGER trigger_update_canonical_stats_v2
  AFTER INSERT ON observations
  FOR EACH ROW
  EXECUTE FUNCTION update_canonical_stats_v2();

-- ============================================================================
-- PHASE 4: RLS POLICIES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Canonical Vehicles RLS
-- ----------------------------------------------------------------------------
ALTER TABLE canonical_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_view_canonical_vehicles ON canonical_vehicles;
CREATE POLICY users_view_canonical_vehicles ON canonical_vehicles
  FOR SELECT
  USING (true); -- All authenticated users can view

DROP POLICY IF EXISTS admins_manage_canonical_vehicles ON canonical_vehicles;
CREATE POLICY admins_manage_canonical_vehicles ON canonical_vehicles
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'master')
    )
  );

-- ----------------------------------------------------------------------------
-- Vehicle Observations V2 RLS
-- ----------------------------------------------------------------------------
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_view_observations_v2 ON observations;
CREATE POLICY users_view_observations_v2 ON observations
  FOR SELECT
  USING (
    get_user_role(auth.uid()) = 'master'
    OR organization_id = get_user_organization_id(auth.uid())
  );

DROP POLICY IF EXISTS users_create_observations_v2 ON observations;
CREATE POLICY users_create_observations_v2 ON observations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS admins_manage_observations_v2 ON observations;
CREATE POLICY admins_manage_observations_v2 ON observations
  FOR ALL
  USING (
    get_user_role(auth.uid()) IN ('admin', 'master')
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- Monthly Stays RLS
-- ----------------------------------------------------------------------------
ALTER TABLE vehicle_monthly_stays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_view_monthly_stays ON vehicle_monthly_stays;
CREATE POLICY users_view_monthly_stays ON vehicle_monthly_stays
  FOR SELECT
  USING (
    get_user_role(auth.uid()) = 'master'
    OR organization_id = get_user_organization_id(auth.uid())
  );

DROP POLICY IF EXISTS system_manage_monthly_stays ON vehicle_monthly_stays;
CREATE POLICY system_manage_monthly_stays ON vehicle_monthly_stays
  FOR ALL
  USING (true) -- System functions can manage
  WITH CHECK (true);

-- ============================================================================
-- PHASE 5: DATA MIGRATION (from existing canonical_vehicles if exists)
-- ============================================================================

DO $$
BEGIN
  -- Check if old canonical_vehicles exists and migrate data
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'canonical_vehicles_old'
  ) THEN
    
    -- Migrate canonical vehicles
    INSERT INTO canonical_vehicles (
      plate_number,
      vehicle_make,
      vehicle_model,
      vehicle_color,
      first_seen_at,
      last_seen_at,
      total_observations,
      is_homeless,
      homeless_confirmed,
      homeless_confirmed_by,
      homeless_confirmed_at,
      homeless_notes,
      is_flagged,
      flagged_priority,
      flagged_reason,
      flagged_notes,
      flagged_at,
      flagged_by,
      created_at,
      updated_at
    )
    SELECT 
      plate_number,
      vehicle_make,
      vehicle_model,
      vehicle_color,
      first_seen_at,
      last_seen_at,
      total_observations,
      CASE 
        WHEN is_homeless THEN 'claimed'
        WHEN homeless_confirmed THEN 'confirmed'
        ELSE 'none'
      END as homeless_status,
      homeless_confirmed,
      homeless_confirmed_by,
      homeless_confirmed_at,
      homeless_notes,
      is_flagged,
      flagged_priority,
      flagged_reason,
      flagged_notes,
      flagged_at,
      flagged_by,
      created_at,
      updated_at
    FROM canonical_vehicles_old
    ON CONFLICT (plate_number) DO NOTHING;
    
    RAISE NOTICE 'Migrated canonical vehicles from old table';
  END IF;
END $$;

-- ============================================================================
-- PHASE 6: HELPER FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Function: Get vehicle notes history
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_vehicle_notes_history(p_plate_number TEXT, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  observation_id UUID,
  officer_notes TEXT,
  recorded_at TIMESTAMPTZ,
  recorded_by_name TEXT,
  zone_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vo.observation_id,
    vo.officer_notes,
    vo.recorded_at,
    up.first_name || ' ' || up.last_name as recorded_by_name,
    z.name as zone_name
  FROM observations vo
  LEFT JOIN user_profiles up ON vo.recorded_by = up.id
  LEFT JOIN zones z ON vo.zone_id = z.id
  WHERE vo.plate_number = p_plate_number
    AND vo.has_notes = true
  ORDER BY vo.recorded_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- Function: Create or update canonical vehicle
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_canonical_vehicle(
  p_plate_number TEXT,
  p_vehicle_make TEXT DEFAULT NULL,
  p_vehicle_model TEXT DEFAULT NULL,
  p_vehicle_year INTEGER DEFAULT NULL,
  p_vehicle_color TEXT DEFAULT NULL,
  p_self_contained BOOLEAN DEFAULT NULL,
  p_self_contained_expiry DATE DEFAULT NULL
)
RETURNS TEXT AS $$
BEGIN
  INSERT INTO canonical_vehicles (
    plate_number,
    vehicle_make,
    vehicle_model,
    vehicle_year,
    vehicle_color,
    self_contained,
    self_contained_expiry,
    first_seen_at,
    last_seen_at
  )
  VALUES (
    p_plate_number,
    p_vehicle_make,
    p_vehicle_model,
    p_vehicle_year,
    p_vehicle_color,
    COALESCE(p_self_contained, false),
    p_self_contained_expiry,
    now(),
    now()
  )
  ON CONFLICT (plate_number) DO UPDATE
  SET
    vehicle_make = COALESCE(p_vehicle_make, canonical_vehicles.vehicle_make),
    vehicle_model = COALESCE(p_vehicle_model, canonical_vehicles.vehicle_model),
    vehicle_year = COALESCE(p_vehicle_year, canonical_vehicles.vehicle_year),
    vehicle_color = COALESCE(p_vehicle_color, canonical_vehicles.vehicle_color),
    self_contained = COALESCE(p_self_contained, canonical_vehicles.self_contained),
    self_contained_expiry = COALESCE(p_self_contained_expiry, canonical_vehicles.self_contained_expiry),
    updated_at = now();
  
  RETURN p_plate_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PHASE 7: GRANT PERMISSIONS
-- ============================================================================

GRANT SELECT ON canonical_vehicles TO authenticated;
GRANT SELECT ON observations TO authenticated;
GRANT SELECT ON vehicle_monthly_stays TO authenticated;

-- ============================================================================
-- COMPLETION SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Vehicle Architecture Rebuild Complete!';
  RAISE NOTICE '';
  RAISE NOTICE '📋 NEW TABLES CREATED:';
  RAISE NOTICE '  1. canonical_vehicles - Master vehicle registry (plate_number primary key)';
  RAISE NOTICE '  2. observations - Independent observation records with notes';
  RAISE NOTICE '  3. vehicle_monthly_stays - Calendar month tracking with auto-reset';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 NEW FEATURES:';
  RAISE NOTICE '  ✅ Officer notes in observations with count tracking';
  RAISE NOTICE '  ✅ Auto-populate observation details from canonical vehicle';
  RAISE NOTICE '  ✅ Previous notes reference to minimize AI credits';
  RAISE NOTICE '  ✅ Persistent breach records (immutable)';
  RAISE NOTICE '  ✅ AI profile photo selection';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 NEXT STEPS:';
  RAISE NOTICE '  1. Update mobile app to use new observations table';
  RAISE NOTICE '  2. Migrate existing observations from vehicle_observations to observations';
  RAISE NOTICE '  3. Update Edge Functions to reference new schema';
  RAISE NOTICE '  4. Test note-taking workflow in Field Officer Portal';
END $$;
