-- ============================================================================
-- INITIAL SCHEMA — FieldOps Manager
-- ============================================================================
-- Purpose: Establish all base tables, extensions, and helper functions
--          so that every subsequent incremental migration can run cleanly
--          against a brand-new (empty) Supabase project.
--
-- This file MUST be the first migration in the sequence (timestamp 20250101).
-- All subsequent migrations use ALTER TABLE … ADD COLUMN IF NOT EXISTS,
-- CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, etc., so they are
-- safe to run over the schema created here.
--
-- Run order: this file → 20250124_schedule_zone_correction.sql → …
-- ============================================================================

-- ============================================================================
-- SECTION 0: EXTENSIONS
-- ============================================================================

-- PostGIS — required for geography column types and ST_* functions
-- (first actual geography column is added in 20260219_evidence_integrity…)
-- NOTE: PostGIS requires the Supabase Pro plan. On the Free plan this step
-- is skipped gracefully — spatial features will be unavailable until the
-- project is upgraded and the extension is enabled manually.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'PostGIS not available on this plan (requires Supabase Pro). Spatial features disabled. Enable it later with: CREATE EXTENSION postgis; Error: %', SQLERRM;
END $$;

-- pg_trgm — trigram text-search indexes (available on all Supabase plans)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- pg_cron is enabled in 20250124_schedule_zone_correction.sql (CREATE EXTENSION IF NOT EXISTS pg_cron)
-- vector (pgvector) is enabled in 20260220_phase1_orc_ai_vector_support.sql

-- ============================================================================
-- SECTION 1: HELPER FUNCTIONS
-- ============================================================================

-- update_updated_at — standard BEFORE UPDATE trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- update_updated_at_column — alias for update_updated_at for backward compatibility.
-- Many migrations (from 20250202 onwards) use EXECUTE FUNCTION update_updated_at_column()
-- without ever defining it, relying on it being present in the live DB from
-- pre-migration setup. This alias ensures all such migrations work on fresh databases.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- get_user_role — returns the role of the given user (default 'officer')
-- Drop any prior definition (parameter name may differ, e.g. "uid" vs "p_user_id")
DROP FUNCTION IF EXISTS get_user_role(UUID);
CREATE OR REPLACE FUNCTION get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM user_profiles
  WHERE id = p_user_id;
  RETURN COALESCE(v_role, 'officer');
END;
$$;

-- get_user_organization_id — returns the primary organisation of the caller
-- Drop any prior definition (parameter name may differ)
DROP FUNCTION IF EXISTS get_user_organization_id(UUID);
CREATE OR REPLACE FUNCTION get_user_organization_id(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM user_profiles
  WHERE id = p_user_id;
  RETURN v_org_id;
END;
$$;

-- get_descendant_organizations — recursive org hierarchy helper
-- Drop any prior definition (parameter name may differ, e.g. "root_org_id" vs "org_id")
DROP FUNCTION IF EXISTS get_descendant_organizations(UUID);
CREATE OR REPLACE FUNCTION get_descendant_organizations(org_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  descendants UUID[];
BEGIN
  WITH RECURSIVE org_tree AS (
    SELECT id, parent_organization_id
    FROM organizations
    WHERE id = org_id
    UNION ALL
    SELECT o.id, o.parent_organization_id
    FROM organizations o
    INNER JOIN org_tree ot ON o.parent_organization_id = ot.id
  )
  SELECT array_agg(id) INTO descendants FROM org_tree;
  RETURN COALESCE(descendants, ARRAY[]::UUID[]);
END;
$$;

-- get_user_organization_ids — all org IDs accessible to the current user
CREATE OR REPLACE FUNCTION get_user_organization_ids()
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM user_profiles
  WHERE id = auth.uid();
  IF v_org_id IS NULL THEN
    RETURN ARRAY[]::UUID[];
  END IF;
  RETURN get_descendant_organizations(v_org_id);
END;
$$;

-- ============================================================================
-- SECTION 2: CORE TABLES (dependency order)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1 organizations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT        NOT NULL,
  contact_email        TEXT,
  contact_phone        TEXT,
  address              TEXT,
  is_active            BOOLEAN     DEFAULT true,
  enforcement_workflow TEXT        DEFAULT 'admin_first'
                         CHECK (enforcement_workflow IN ('admin_first', 'officer_direct', 'hybrid')),
  logo_url             TEXT,
  -- multi-org hierarchy (added by 20260215_multi_organization_hierarchy.sql via ALTER TABLE)
  parent_organization_id UUID      REFERENCES organizations(id) ON DELETE SET NULL,
  organization_level   INTEGER     DEFAULT 1 CHECK (organization_level >= 1),
  organization_type    TEXT        DEFAULT 'client'
                         CHECK (organization_type IN ('owner', 'service_provider', 'client', 'operator', 'security_company')),
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_active   ON organizations(is_active);
CREATE INDEX IF NOT EXISTS idx_organizations_parent   ON organizations(parent_organization_id);
CREATE INDEX IF NOT EXISTS idx_organizations_type     ON organizations(organization_type);

-- ----------------------------------------------------------------------------
-- 2.2 user_profiles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  id                        UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id           UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  email                     TEXT        NOT NULL,
  first_name                TEXT,
  last_name                 TEXT,
  role                      TEXT        DEFAULT 'officer'
                              CHECK (role IN ('master', 'admin', 'officer', 'admin_officer')),
  phone                     TEXT,
  is_active                 BOOLEAN     DEFAULT true,
  permissions               JSONB       DEFAULT '[]'::jsonb,
  -- multi-org / contractor fields
  employer_organization_id  UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  authorized_work_locations UUID[]      DEFAULT ARRAY[]::UUID[],
  -- GPS / welfare tracking
  last_gps_latitude         NUMERIC(10,8),
  last_gps_longitude        NUMERIC(11,8),
  last_gps_accuracy         NUMERIC(10,2),
  last_gps_update           TIMESTAMPTZ,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_org    ON user_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role   ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_active ON user_profiles(is_active);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_view_own_profile ON user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master'));

CREATE POLICY users_update_own_profile ON user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY admins_manage_profiles ON user_profiles
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master'));

-- ----------------------------------------------------------------------------
-- 2.3 zones
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zones (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                    TEXT        NOT NULL,
  description             TEXT,
  self_contained_required BOOLEAN     DEFAULT false,
  nights_per_month        INTEGER     DEFAULT 28,
  max_consecutive_nights  INTEGER     DEFAULT 3,
  day_visit_only          BOOLEAN     DEFAULT false,
  allowed_days            TEXT[],
  is_active               BOOLEAN     DEFAULT true,
  location_lat            NUMERIC(10,8),
  location_lng            NUMERIC(11,8),
  geometry                JSONB,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zones_org    ON zones(organization_id);
CREATE INDEX IF NOT EXISTS idx_zones_active ON zones(is_active);

ALTER TABLE zones ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.4 zone_compliance_matrix
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zone_compliance_matrix (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id                 UUID        NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  organization_id         UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  version                 INTEGER     DEFAULT 1,
  effective_from          TIMESTAMPTZ DEFAULT now(),
  effective_to            TIMESTAMPTZ,
  self_contained_required BOOLEAN     DEFAULT false,
  requires_csc            BOOLEAN     DEFAULT false,
  nights_per_month        INTEGER     DEFAULT 28,
  max_consecutive_nights  INTEGER     DEFAULT 3,
  day_visit_only          BOOLEAN     DEFAULT false,
  allowed_days            TEXT[],
  homeless_exemption      BOOLEAN     DEFAULT true,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zone_matrix_zone ON zone_compliance_matrix(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_matrix_active ON zone_compliance_matrix(zone_id)
  WHERE effective_to IS NULL;

-- ----------------------------------------------------------------------------
-- 2.5 canonical_vehicles
--     Uses plate_number as PRIMARY KEY (new architecture from 20250203).
--     Also exposes vehicle_id as a UNIQUE surrogate so that old FK references
--     (REFERENCES canonical_vehicles(vehicle_id)) added by early migrations
--     still resolve correctly.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_vehicles (
  -- Primary key — new architecture
  plate_number            TEXT        PRIMARY KEY,

  -- Surrogate UUID kept for backward-compat FK references from early migrations
  vehicle_id              UUID        UNIQUE NOT NULL DEFAULT gen_random_uuid(),

  -- Vehicle details
  vehicle_make            TEXT,
  vehicle_model           TEXT,
  vehicle_color           TEXT,
  vehicle_year            TEXT,

  -- Self-contained certification
  self_contained          BOOLEAN     DEFAULT false,
  self_contained_expiry   DATE,
  nzscv_warrant_type      TEXT,
  nzscv_lookup_at         TIMESTAMPTZ,

  -- Homeless / exemption status (new column from 20250203 rebuild)
  homeless_status         TEXT        DEFAULT 'none'
                            CHECK (homeless_status IN ('none', 'claimed', 'confirmed', 'suspected')),
  -- Legacy boolean columns kept for backward compat with early migration functions
  is_homeless             BOOLEAN     DEFAULT false,
  homeless_confirmed      BOOLEAN     DEFAULT false,
  homeless_confirmed_by   UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  homeless_confirmed_at   TIMESTAMPTZ,
  homeless_notes          TEXT,

  -- Flagging
  is_flagged              BOOLEAN     DEFAULT false,
  flagged_priority        TEXT        CHECK (flagged_priority IN ('low', 'medium', 'high', 'critical')),
  flagged_reason          TEXT,
  flagged_notes           TEXT,
  flagged_at              TIMESTAMPTZ,
  flagged_by              UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,

  -- Owner info
  owner_first_name        TEXT,
  owner_last_name         TEXT,
  owner_company_name      TEXT,
  owner_address           TEXT,
  owner_address_verified  BOOLEAN     DEFAULT false,

  -- Profile photo
  profile_photo           TEXT,
  profile_photo_selected_at TIMESTAMPTZ,
  profile_photo_metadata  JSONB,

  -- Notes tracking
  total_notes             INTEGER     DEFAULT 0,
  last_note_at            TIMESTAMPTZ,
  last_note_preview       TEXT,

  -- Statistics
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_observations      INTEGER     DEFAULT 0,
  total_breaches          INTEGER     DEFAULT 0,
  total_incidents         INTEGER     DEFAULT 0,
  total_hs_reports        INTEGER     DEFAULT 0,

  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_flagged    ON canonical_vehicles(is_flagged) WHERE is_flagged = true;
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_homeless   ON canonical_vehicles(homeless_status) WHERE homeless_status != 'none';
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_last_seen  ON canonical_vehicles(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_plate      ON canonical_vehicles(plate_number);
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_vehicle_id ON canonical_vehicles(vehicle_id);

ALTER TABLE canonical_vehicles ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.6 vehicle_observations  (legacy v1 — renamed / dropped later by migrations)
--     Early migrations reference this table directly before it is dropped in
--     20250213_phase1_database_cleanup.sql.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_observations (
  observation_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id              UUID        REFERENCES canonical_vehicles(vehicle_id) ON DELETE CASCADE,
  organization_id         UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id                 UUID        REFERENCES zones(id) ON DELETE CASCADE,
  recorded_by             UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  recorded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_type             TEXT,
  plate_number            TEXT,
  is_self_contained       BOOLEAN     DEFAULT false,
  is_compliant            BOOLEAN     DEFAULT true,
  gps_latitude            NUMERIC(10,8),
  gps_longitude           NUMERIC(11,8),
  gps_accuracy            NUMERIC(10,2),
  original_record_id      UUID,       -- FK to vehicle_records (legacy)
  photo                   TEXT,
  notes                   TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_obs_vehicle    ON vehicle_observations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_obs_zone       ON vehicle_observations(zone_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_obs_org        ON vehicle_observations(organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_obs_recorded   ON vehicle_observations(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_obs_compliant  ON vehicle_observations(is_compliant);

-- ----------------------------------------------------------------------------
-- 2.7 vehicle_records  (legacy — renamed/deprecated by 20250131)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_records (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id                 UUID        REFERENCES zones(id) ON DELETE SET NULL,
  plate_number            TEXT,
  vehicle_make            TEXT,
  vehicle_model           TEXT,
  vehicle_color           TEXT,
  recorded_by             UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  recorded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  homeless_claimed        BOOLEAN     DEFAULT false,
  homeless_confirmed      BOOLEAN     DEFAULT false,
  homeless_confirmed_by   UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  homeless_confirmed_at   TIMESTAMPTZ,
  homeless_confirmation_notes TEXT,
  gps_latitude            NUMERIC(10,8),
  gps_longitude           NUMERIC(11,8),
  gps_accuracy            NUMERIC(10,2),
  is_compliant            BOOLEAN     DEFAULT true,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_records_plate ON vehicle_records(plate_number);
CREATE INDEX IF NOT EXISTS idx_vehicle_records_zone  ON vehicle_records(zone_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_records_org   ON vehicle_records(organization_id);

-- ----------------------------------------------------------------------------
-- 2.8 compliance_results  (dropped in 20260221_rebuild_observations_clean.sql)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance_results (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id   UUID        REFERENCES vehicle_observations(observation_id) ON DELETE CASCADE,
  vehicle_id       UUID        REFERENCES canonical_vehicles(vehicle_id) ON DELETE CASCADE,
  zone_id          UUID        REFERENCES zones(id) ON DELETE CASCADE,
  organization_id  UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  matrix_id        UUID,
  matrix_version   INTEGER,
  is_compliant     BOOLEAN     DEFAULT true,
  violation_type   TEXT,
  violation_reasons TEXT[],
  metrics_json     JSONB,
  matrix_snapshot  JSONB,
  evaluated_at     TIMESTAMPTZ DEFAULT now(),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (observation_id, matrix_id)
);

CREATE INDEX IF NOT EXISTS idx_compliance_zone      ON compliance_results(zone_id);
CREATE INDEX IF NOT EXISTS idx_compliance_org       ON compliance_results(organization_id);
CREATE INDEX IF NOT EXISTS idx_compliance_evaluated ON compliance_results(evaluated_at);

ALTER TABLE compliance_results ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.9 patrols
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patrols (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id         UUID        REFERENCES zones(id) ON DELETE SET NULL,
  patrol_date     DATE        DEFAULT CURRENT_DATE,
  shift           TEXT        DEFAULT 'day',
  assigned_to     UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  status          TEXT        DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patrols_org    ON patrols(organization_id);
CREATE INDEX IF NOT EXISTS idx_patrols_zone   ON patrols(zone_id);
CREATE INDEX IF NOT EXISTS idx_patrols_date   ON patrols(patrol_date DESC);

ALTER TABLE patrols ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.10 breach_alerts  (minimal base; rebuilt in 20260218)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS breach_alerts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id             UUID        REFERENCES zones(id) ON DELETE CASCADE,
  vehicle_record_id   UUID        REFERENCES vehicle_records(id) ON DELETE SET NULL,
  observation_id      UUID        REFERENCES vehicle_observations(observation_id) ON DELETE SET NULL,
  plate_number        TEXT,
  breach_type         TEXT,
  breach_details      JSONB       DEFAULT '{}',
  status              TEXT        DEFAULT 'pending'
                        CHECK (status IN ('pending', 'acknowledged', 'enforcement_started', 'resolved', 'dismissed')),
  resolution_notes    TEXT,
  resolved_at         TIMESTAMPTZ,
  notification_sent   BOOLEAN     DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_breach_alerts_org    ON breach_alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_breach_alerts_zone   ON breach_alerts(zone_id);
CREATE INDEX IF NOT EXISTS idx_breach_alerts_status ON breach_alerts(status);
CREATE INDEX IF NOT EXISTS idx_breach_alerts_plate  ON breach_alerts(plate_number);

ALTER TABLE breach_alerts ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.11 enforcement_actions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enforcement_actions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id         UUID        REFERENCES zones(id) ON DELETE SET NULL,
  vehicle_record_id UUID      REFERENCES vehicle_records(id) ON DELETE SET NULL,
  observation_id  UUID        REFERENCES vehicle_observations(observation_id) ON DELETE SET NULL,
  plate_number    TEXT,
  action_type     TEXT,
  status          TEXT        DEFAULT 'pending',
  notes           TEXT,
  created_by      UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enforcement_actions_org   ON enforcement_actions(organization_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_plate ON enforcement_actions(plate_number);

ALTER TABLE enforcement_actions ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.12 health_safety_reports
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_safety_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id         UUID        REFERENCES zones(id) ON DELETE SET NULL,
  reported_by     UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  incident_type   TEXT,
  description     TEXT,
  severity        TEXT,
  status          TEXT        DEFAULT 'open',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hs_reports_org  ON health_safety_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_hs_reports_zone ON health_safety_reports(zone_id);

ALTER TABLE health_safety_reports ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.13 incidents
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id         UUID        REFERENCES zones(id) ON DELETE SET NULL,
  reported_by     UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  incident_type   TEXT,
  description     TEXT,
  severity        TEXT,
  status          TEXT        DEFAULT 'open',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_org  ON incidents(organization_id);
CREATE INDEX IF NOT EXISTS idx_incidents_zone ON incidents(zone_id);

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.14 investigation_jobs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investigation_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id         UUID        REFERENCES zones(id) ON DELETE SET NULL,
  assigned_to     UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  job_type        TEXT,
  title           TEXT,
  description     TEXT,
  status          TEXT        DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  priority        TEXT        DEFAULT 'medium',
  created_by      UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_investigation_jobs_org    ON investigation_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_investigation_jobs_status ON investigation_jobs(status);

ALTER TABLE investigation_jobs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.15 person_records
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_records (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  first_name      TEXT,
  last_name       TEXT,
  date_of_birth   DATE,
  is_of_interest  BOOLEAN     DEFAULT false,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_records_org ON person_records(organization_id);

ALTER TABLE person_records ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.16 drift_events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drift_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID     REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id      UUID        REFERENCES zones(id) ON DELETE CASCADE,
  vehicle_id   UUID        REFERENCES canonical_vehicles(vehicle_id) ON DELETE CASCADE,
  plate_number TEXT,
  status       TEXT        DEFAULT 'pending',
  detected_at  TIMESTAMPTZ DEFAULT now(),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drift_events_zone   ON drift_events(zone_id);
CREATE INDEX IF NOT EXISTS idx_drift_events_status ON drift_events(status);

-- ----------------------------------------------------------------------------
-- 2.17 flagged_vehicles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flagged_vehicles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  plate_number    TEXT        NOT NULL,
  reason          TEXT,
  priority        TEXT        CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  flagged_by      UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flagged_vehicles_org   ON flagged_vehicles(organization_id);
CREATE INDEX IF NOT EXISTS idx_flagged_vehicles_plate ON flagged_vehicles(plate_number);

ALTER TABLE flagged_vehicles ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2.18 audit_log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT        NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  old_values   JSONB,
  new_values   JSONB,
  performed_by UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity    ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created   ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_performer ON audit_log(performed_by);

-- ----------------------------------------------------------------------------
-- 2.19 photo_metadata
--     Stores evidence photo metadata; referenced by later migrations for FKs.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photo_metadata (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  observation_id  UUID,       -- FK populated later by triggers
  file_name       TEXT,
  file_size       INTEGER,
  mime_type       TEXT,
  storage_path    TEXT,
  sha256_hash     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_metadata_user        ON photo_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_photo_metadata_observation ON photo_metadata(observation_id);

ALTER TABLE photo_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_manage_own_photos ON photo_metadata
  FOR ALL TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY admins_view_all_photos ON photo_metadata
  FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master'));

-- ----------------------------------------------------------------------------
-- 2.20 plate_scans  (ALPR / driving-mode scan records)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plate_scans (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id                 UUID        REFERENCES zones(id) ON DELETE SET NULL,
  scanned_by              UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  plate_number            TEXT,
  scan_mode               TEXT        DEFAULT 'alpr'
                            CHECK (scan_mode IN ('alpr', 'manual', 'driving')),
  scanned_photo           TEXT,
  confidence_score        NUMERIC(5,2),
  gps_latitude            NUMERIC(10,8),
  gps_longitude           NUMERIC(11,8),
  gps_accuracy            NUMERIC(10,2),
  ai_vehicle_make         TEXT,
  ai_vehicle_model        TEXT,
  ai_vehicle_color        TEXT,
  reviewed                BOOLEAN     DEFAULT false,
  review_action           TEXT,
  flagged_vehicle_detected BOOLEAN    DEFAULT false,
  breach_detected         BOOLEAN     DEFAULT false,
  violation_summary       TEXT,
  scanned_at              TIMESTAMPTZ DEFAULT now(),
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plate_scans_org       ON plate_scans(organization_id);
CREATE INDEX IF NOT EXISTS idx_plate_scans_zone      ON plate_scans(zone_id);
CREATE INDEX IF NOT EXISTS idx_plate_scans_plate     ON plate_scans(plate_number);
CREATE INDEX IF NOT EXISTS idx_plate_scans_scanned   ON plate_scans(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_plate_scans_reviewed  ON plate_scans(reviewed);

ALTER TABLE plate_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_view_plate_scans ON plate_scans
  FOR SELECT TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR (organization_id = ANY(get_user_organization_ids()))
  );

CREATE POLICY users_insert_plate_scans ON plate_scans
  FOR INSERT TO authenticated
  WITH CHECK (
    scanned_by = auth.uid()
    AND organization_id = get_user_organization_id(auth.uid())
  );

CREATE POLICY admins_update_scans ON plate_scans
  FOR UPDATE TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ============================================================================
-- SECTION 3: UPDATED-AT TRIGGERS on key tables
-- ============================================================================

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_zones_updated_at
  BEFORE UPDATE ON zones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_canonical_vehicles_updated_at
  BEFORE UPDATE ON canonical_vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_vehicle_observations_updated_at
  BEFORE UPDATE ON vehicle_observations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_vehicle_records_updated_at
  BEFORE UPDATE ON vehicle_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_compliance_results_updated_at
  BEFORE UPDATE ON compliance_results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_patrols_updated_at
  BEFORE UPDATE ON patrols
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_breach_alerts_updated_at
  BEFORE UPDATE ON breach_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_enforcement_actions_updated_at
  BEFORE UPDATE ON enforcement_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_investigation_jobs_updated_at
  BEFORE UPDATE ON investigation_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_person_records_updated_at
  BEFORE UPDATE ON person_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_flagged_vehicles_updated_at
  BEFORE UPDATE ON flagged_vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
