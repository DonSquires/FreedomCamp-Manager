-- =============================================================================
-- WILSAR-STYLE CRM & DISPATCH ENHANCEMENTS
-- =============================================================================
-- Phase 0: WILSAR bureau fields on organizations (Bureau Maintenance)
-- Phase 1: Call signs + branch/vehicle on patrol_routes
-- Phase 2: WILSAR client fields on client_sites
-- Phase 3: Full WILSAR job type library + alarm_type on dispatch_jobs
-- =============================================================================

-- ── 0. ORGANIZATIONS — WILSAR bureau identity fields ─────────────────────────
-- The organizations table is the "Bureau" in WILSAR. Add all fields shown in
-- the Bureau Maintenance screen so OrganizationProfile can display them.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS bureau_id            TEXT,
  ADD COLUMN IF NOT EXISTS bureau_debtor_no     TEXT,
  ADD COLUMN IF NOT EXISTS original_source      TEXT,
  ADD COLUMN IF NOT EXISTS original_debtor_code TEXT,
  ADD COLUMN IF NOT EXISTS original_cost_centre TEXT,
  ADD COLUMN IF NOT EXISTS region               TEXT,
  ADD COLUMN IF NOT EXISTS abn                  TEXT,
  ADD COLUMN IF NOT EXISTS override_validation  BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_bureau_id
  ON public.organizations(bureau_id) WHERE bureau_id IS NOT NULL;

COMMENT ON COLUMN public.organizations.bureau_id IS
  'WILSAR Bureau ID (e.g. FSG-NCC). Short code used across dispatch, invoicing, and client records.';
COMMENT ON COLUMN public.organizations.bureau_debtor_no IS
  'Debtor number in the billing/accounting system (e.g. X421205)';
COMMENT ON COLUMN public.organizations.original_source IS
  'Source system name when migrated from a legacy system (e.g. First Security)';
COMMENT ON COLUMN public.organizations.override_validation IS
  'Allow bypassing standard data validation rules for this bureau entry';

-- ── 1. PATROL ROUTES — call sign, branch, vehicle ────────────────────────────

ALTER TABLE public.patrol_routes
  ADD COLUMN IF NOT EXISTS call_sign TEXT,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_id UUID;

-- Unique index on call_sign (sparse — NULLs are excluded)
CREATE UNIQUE INDEX IF NOT EXISTS idx_patrol_routes_call_sign
  ON public.patrol_routes(call_sign) WHERE call_sign IS NOT NULL;

COMMENT ON COLUMN public.patrol_routes.call_sign IS
  'Short operational call sign for this patrol run (e.g. 585, 586, 587)';
COMMENT ON COLUMN public.patrol_routes.branch_id IS
  'The First Security / Iron Eagle branch this patrol route belongs to';
COMMENT ON COLUMN public.patrol_routes.vehicle_id IS
  'Vehicle assigned to this patrol run (references canonical_vehicles.id or fleet vehicles)';

-- ── 2. CLIENT SITES — WILSAR client identity fields ──────────────────────────

ALTER TABLE public.client_sites
  ADD COLUMN IF NOT EXISTS client_code TEXT,
  ADD COLUMN IF NOT EXISTS bureau_id   TEXT,
  ADD COLUMN IF NOT EXISTS has_keys    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contact_at  TIMESTAMPTZ;

-- Unique sparse index on client_code
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_sites_client_code
  ON public.client_sites(client_code) WHERE client_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_sites_bureau_id
  ON public.client_sites(bureau_id) WHERE bureau_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_sites_has_keys
  ON public.client_sites(organization_id, has_keys) WHERE has_keys = TRUE;

COMMENT ON COLUMN public.client_sites.client_code IS
  'Short WILSAR-style alphanumeric client ID (e.g. NA394, CHAWB8160)';
COMMENT ON COLUMN public.client_sites.bureau_id IS
  'Monitoring bureau code (e.g. NZ-STD, ADTAR)';
COMMENT ON COLUMN public.client_sites.has_keys IS
  'Whether the patrol officer holds keys for this site';
COMMENT ON COLUMN public.client_sites.last_response_at IS
  'Timestamp of the last completed dispatch job response to this site';
COMMENT ON COLUMN public.client_sites.last_contact_at IS
  'Timestamp of the last operator contact with this site''s keyholder';

-- ── 3. DISPATCH JOBS — full WILSAR job type library + alarm_type ─────────────

-- Drop the old narrow check constraint and replace with the full WILSAR list.
ALTER TABLE public.dispatch_jobs
  DROP CONSTRAINT IF EXISTS dispatch_jobs_job_type_check;

ALTER TABLE public.dispatch_jobs
  ADD CONSTRAINT dispatch_jobs_job_type_check CHECK (job_type IN (
    -- Core WILSAR types
    'alarm_response',
    'permanent_patrol',
    'casual_patrol',
    'escort',
    'key_collection',
    'key_return',
    'let_in',
    'let_out',
    'lockup',
    'open',
    'alarm_reset',
    'first_line_one_guard',
    'first_line_two_guard',
    'second_line_response',
    'cash_in_transit',
    -- FieldOps-native types (retained for continuity)
    'patrol',
    'welfare_check',
    'noise_complaint',
    'freedom_camping',
    'parking',
    'medical',
    'fire',
    'suspicious_activity',
    'lock_unlock',
    'property_check',
    'vandalism',
    'general',
    'other'
  ));

-- Add alarm_type column (nullable — only relevant for alarm_response jobs)
ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS alarm_type TEXT;

ALTER TABLE public.dispatch_jobs
  ADD CONSTRAINT dispatch_jobs_alarm_type_check CHECK (
    alarm_type IS NULL OR alarm_type IN (
      'intruder_alarm',
      'duress_hold_up',
      'animal_control',
      'cardreader_fault',
      'late_to_close',
      'lock_broken',
      'noise',
      'parking',
      'traffic',
      'vandalism',
      'alarm_reset',
      'other'
    )
  );

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_alarm_type
  ON public.dispatch_jobs(organization_id, alarm_type) WHERE alarm_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_job_type
  ON public.dispatch_jobs(organization_id, job_type);

COMMENT ON COLUMN public.dispatch_jobs.alarm_type IS
  'Alarm sub-classification (used when job_type = alarm_response)';
