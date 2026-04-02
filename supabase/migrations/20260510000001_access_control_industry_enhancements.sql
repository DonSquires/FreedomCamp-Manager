-- ============================================================================
-- Access Control Industry Standard Enhancements
--
-- Based on comprehensive research of access control best practices, standards,
-- and legal requirements including:
--
-- INDUSTRY STANDARDS:
--   - PACS (Physical Access Control Systems) best practices 2024-2025
--   - FIPS 201-3 / FICAM federal identity management standards
--   - OSDP (Open Supervised Device Protocol) IEC 60839-11-5
--   - Multi-factor authentication (MFA) best practices
--
-- LEGAL COMPLIANCE:
--   - NZ Privacy Act 2020 + Biometric Processing Privacy Code 2025
--   - GDPR (EU General Data Protection Regulation)
--   - NZ Privacy Commissioner guidelines for biometric data
--
-- SECURITY FEATURES:
--   - Anti-passback enforcement
--   - Tailgating/piggybacking detection
--   - Watchlist screening
--   - Emergency evacuation support
--   - Occupancy limits
-- ============================================================================

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 1: ZONE ENHANCEMENTS - Occupancy & Security Settings
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS max_occupancy integer,
  ADD COLUMN IF NOT EXISTS current_occupancy integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS anti_passback_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS anti_passback_timeout_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tailgate_detection_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS emergency_mode boolean DEFAULT false;

COMMENT ON COLUMN public.zones.max_occupancy IS 'Maximum allowed occupants in zone (fire safety/capacity)';
COMMENT ON COLUMN public.zones.current_occupancy IS 'Real-time count of people inside zone';
COMMENT ON COLUMN public.zones.anti_passback_enabled IS 'Prevent re-entry without valid exit (stops credential sharing)';
COMMENT ON COLUMN public.zones.anti_passback_timeout_minutes IS 'Anti-passback timeout (0=strict, >0=timed reset)';
COMMENT ON COLUMN public.zones.tailgate_detection_enabled IS 'Enable AI/sensor-based tailgating detection';
COMMENT ON COLUMN public.zones.mfa_required IS 'Require multi-factor authentication (face+badge, etc)';
COMMENT ON COLUMN public.zones.emergency_mode IS 'Emergency evacuation mode - disable entry, log exits only';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 2: PRIVACY & CONSENT TRACKING (NZ Biometric Code 2025 / GDPR Compliance)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Biometric consent tracking
CREATE TABLE IF NOT EXISTS public.biometric_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  person_record_id uuid NOT NULL REFERENCES public.person_records(id) ON DELETE CASCADE,
  
  -- Consent details (NZ Biometric Code 2025 requirements)
  consent_type text NOT NULL CHECK (consent_type IN ('face_recognition', 'fingerprint', 'iris', 'voice', 'palm', 'other')),
  consent_given boolean NOT NULL,
  consent_timestamp timestamptz NOT NULL DEFAULT now(),
  
  -- What they were told (transparency requirement)
  data_purpose text NOT NULL,                    -- Why data is being collected
  data_retention_period text NOT NULL,           -- How long it will be kept
  data_sharing_info text,                        -- Who it may be shared with
  alternative_offered boolean DEFAULT false,     -- Were non-biometric alternatives offered?
  alternative_description text,                  -- What alternatives were available
  
  -- Privacy Impact Assessment reference (mandatory for NZ)
  pia_reference text,                           -- Link to PIA document
  
  -- Withdrawal
  consent_withdrawn boolean DEFAULT false,
  withdrawal_timestamp timestamptz,
  withdrawal_reason text,
  
  -- IP for consent audit
  consent_ip_address text,
  consent_user_agent text,
  
  -- Audit
  collected_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Prevent duplicate consent records for same type
  UNIQUE(person_record_id, consent_type)
);

CREATE INDEX IF NOT EXISTS idx_biometric_consents_person ON public.biometric_consents(person_record_id);
CREATE INDEX IF NOT EXISTS idx_biometric_consents_org ON public.biometric_consents(organization_id);

COMMENT ON TABLE public.biometric_consents IS 'Tracks explicit consent for biometric data processing (NZ Biometric Code 2025 / GDPR Article 9 compliance)';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 3: WATCHLIST SYSTEM (Industry Standard)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Watchlist entries for flagged/blocked individuals
CREATE TABLE IF NOT EXISTS public.access_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  
  -- Person identification (may not have a person_record)
  person_record_id uuid REFERENCES public.person_records(id) ON DELETE SET NULL,
  
  -- Alternative identification when no person record exists
  first_name text,
  last_name text,
  alias text,
  description text,
  photo_url text,
  face_embedding real[],                        -- For face-based watchlist matching
  
  -- Watchlist classification
  list_type text NOT NULL CHECK (list_type IN (
    'blocked',           -- No access under any circumstances
    'restricted',        -- Limited access / escort required
    'alert',             -- Allow access but notify security
    'vip',               -- Fast-track / priority access
    'terminated',        -- Former employee/contractor - access revoked
    'court_order',       -- Legal restriction (trespass notice, etc)
    'temp_suspension',   -- Temporarily suspended
    'custom'             -- Custom list type
  )),
  
  -- Alert settings
  alert_on_match boolean DEFAULT true,
  alert_recipients jsonb,                       -- Array of user IDs to notify
  alert_message text,                           -- Custom alert message
  
  -- Validity
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,                  -- NULL = indefinite
  
  -- Reason/documentation
  reason text NOT NULL,
  supporting_documents jsonb,                   -- Array of document URLs
  legal_reference text,                         -- Court order number, etc
  
  -- Audit
  added_by uuid REFERENCES auth.users(id),
  reviewed_by uuid REFERENCES auth.users(id),
  review_date timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_watchlist_org ON public.access_watchlist(organization_id);
CREATE INDEX IF NOT EXISTS idx_access_watchlist_person ON public.access_watchlist(person_record_id);
CREATE INDEX IF NOT EXISTS idx_access_watchlist_type ON public.access_watchlist(list_type);
CREATE INDEX IF NOT EXISTS idx_access_watchlist_active ON public.access_watchlist(organization_id) 
  WHERE effective_until IS NULL;

COMMENT ON TABLE public.access_watchlist IS 'Blocked/restricted/VIP/alert list for access control screening';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 4: CREDENTIALS & BADGES (Multi-Factor Authentication Support)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Access credentials (badges, cards, fobs, mobile credentials)
CREATE TABLE IF NOT EXISTS public.access_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  person_record_id uuid NOT NULL REFERENCES public.person_records(id) ON DELETE CASCADE,
  
  -- Credential details
  credential_type text NOT NULL CHECK (credential_type IN (
    'proximity_card',    -- 125kHz RFID
    'smart_card',        -- 13.56MHz (MIFARE, DESFire, iCLASS)
    'nfc_mobile',        -- NFC mobile credential
    'ble_mobile',        -- Bluetooth mobile credential
    'key_fob',           -- Key fob
    'wristband',         -- Wristband/bracelet
    'pin_code',          -- PIN only
    'qr_code',           -- QR code badge
    'biometric_template' -- Stored biometric template
  )),
  
  credential_number text NOT NULL,              -- Card number / credential ID
  facility_code text,                           -- Facility code (for Wiegand systems)
  pin_code_hash text,                           -- Hashed PIN (if applicable)
  
  -- Status
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'lost', 'stolen', 'expired', 'revoked')),
  
  -- Validity
  issued_at timestamptz NOT NULL DEFAULT now(),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  
  -- Physical card details
  card_printed boolean DEFAULT false,
  card_printed_at timestamptz,
  card_serial_number text,
  
  -- Audit
  issued_by uuid REFERENCES auth.users(id),
  last_used_at timestamptz,
  last_used_zone_id uuid REFERENCES public.zones(id),
  use_count integer DEFAULT 0,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(organization_id, credential_number)
);

CREATE INDEX IF NOT EXISTS idx_access_credentials_person ON public.access_credentials(person_record_id);
CREATE INDEX IF NOT EXISTS idx_access_credentials_number ON public.access_credentials(credential_number);
CREATE INDEX IF NOT EXISTS idx_access_credentials_active ON public.access_credentials(organization_id) 
  WHERE status = 'active';

COMMENT ON TABLE public.access_credentials IS 'Physical and mobile credentials for access control (RFID, NFC, mobile, PIN)';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 5: ANTI-PASSBACK TRACKING
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Track current location state for anti-passback enforcement
CREATE TABLE IF NOT EXISTS public.access_location_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  person_record_id uuid NOT NULL REFERENCES public.person_records(id) ON DELETE CASCADE,
  
  -- Current location state
  current_zone_id uuid REFERENCES public.zones(id),
  is_inside boolean NOT NULL DEFAULT false,
  
  -- Last entry/exit
  last_entry_at timestamptz,
  last_exit_at timestamptz,
  last_entry_id uuid REFERENCES public.access_entries(id),
  last_exit_id uuid REFERENCES public.access_entries(id),
  
  -- Anti-passback violation tracking
  passback_violation_count integer DEFAULT 0,
  last_violation_at timestamptz,
  
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(organization_id, person_record_id, current_zone_id)
);

CREATE INDEX IF NOT EXISTS idx_access_location_state_person ON public.access_location_state(person_record_id);
CREATE INDEX IF NOT EXISTS idx_access_location_state_zone ON public.access_location_state(current_zone_id);

COMMENT ON TABLE public.access_location_state IS 'Tracks entry/exit state for anti-passback enforcement';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 6: MULTI-FACTOR AUTHENTICATION LOG
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Log multi-factor authentication attempts for audit trail
CREATE TABLE IF NOT EXISTS public.access_mfa_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  access_entry_id uuid REFERENCES public.access_entries(id),
  person_record_id uuid REFERENCES public.person_records(id),
  zone_id uuid NOT NULL REFERENCES public.zones(id),
  
  -- Authentication factors used
  factors_required integer NOT NULL DEFAULT 1,
  factors_provided integer NOT NULL DEFAULT 0,
  
  -- Factor 1: Something you have (badge/card)
  factor_badge_used boolean DEFAULT false,
  factor_badge_credential_id uuid REFERENCES public.access_credentials(id),
  factor_badge_result boolean,
  
  -- Factor 2: Something you are (biometric)
  factor_biometric_used boolean DEFAULT false,
  factor_biometric_type text CHECK (factor_biometric_type IN ('face', 'fingerprint', 'iris', 'palm', 'voice')),
  factor_biometric_confidence real,
  factor_biometric_result boolean,
  
  -- Factor 3: Something you know (PIN)
  factor_pin_used boolean DEFAULT false,
  factor_pin_result boolean,
  factor_pin_attempts integer DEFAULT 0,
  
  -- Overall result
  all_factors_passed boolean NOT NULL,
  failure_reason text,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_mfa_log_entry ON public.access_mfa_log(access_entry_id);
CREATE INDEX IF NOT EXISTS idx_access_mfa_log_person ON public.access_mfa_log(person_record_id);

COMMENT ON TABLE public.access_mfa_log IS 'Audit log for multi-factor authentication attempts';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 7: EMERGENCY EVACUATION SUPPORT
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Emergency evacuation events
CREATE TABLE IF NOT EXISTS public.emergency_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  
  -- Event details
  event_type text NOT NULL CHECK (event_type IN ('fire', 'earthquake', 'bomb_threat', 'intruder', 'hazmat', 'drill', 'other')),
  event_name text NOT NULL,
  description text,
  
  -- Status
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'all_clear', 'cancelled')),
  
  -- Timing
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  
  -- Affected zones
  affected_zone_ids uuid[] NOT NULL,
  
  -- Initiated by
  initiated_by uuid REFERENCES auth.users(id),
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Evacuation roll call - tracks who has checked out during emergency
CREATE TABLE IF NOT EXISTS public.evacuation_roll_call (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_event_id uuid NOT NULL REFERENCES public.emergency_events(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  
  -- Person being tracked
  person_record_id uuid NOT NULL REFERENCES public.person_records(id),
  
  -- Last known location
  last_known_zone_id uuid REFERENCES public.zones(id),
  was_inside boolean NOT NULL,
  
  -- Evacuation status
  evacuation_status text NOT NULL DEFAULT 'unaccounted' CHECK (evacuation_status IN (
    'unaccounted',       -- Not yet confirmed
    'evacuated',         -- Confirmed evacuated
    'sheltering',        -- Sheltering in place
    'absent',            -- Was not on site
    'missing',           -- Known to be on site but not accounted for
    'requires_assistance' -- Needs help to evacuate
  )),
  
  -- Confirmation
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES auth.users(id),
  assembly_point text,
  notes text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evacuation_roll_call_event ON public.evacuation_roll_call(emergency_event_id);
CREATE INDEX IF NOT EXISTS idx_evacuation_roll_call_person ON public.evacuation_roll_call(person_record_id);

COMMENT ON TABLE public.emergency_events IS 'Emergency evacuation events for headcount/roll call';
COMMENT ON TABLE public.evacuation_roll_call IS 'Roll call status during emergency evacuation';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 8: ACCESS ENTRIES ENHANCEMENT
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Add new columns to access_entries for enhanced tracking
ALTER TABLE public.access_entries
  ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES public.access_credentials(id),
  ADD COLUMN IF NOT EXISTS mfa_log_id uuid,  -- Will reference access_mfa_log after creation
  ADD COLUMN IF NOT EXISTS watchlist_match_id uuid,
  ADD COLUMN IF NOT EXISTS anti_passback_violation boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tailgate_detected boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS reader_id text,                  -- Physical reader identifier
  ADD COLUMN IF NOT EXISTS door_id text,                    -- Door/portal identifier
  ADD COLUMN IF NOT EXISTS decision_reason text;            -- Why access was granted/denied

-- Add foreign key for mfa_log_id (table created above in this migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_access_entries_mfa'
  ) THEN
    ALTER TABLE public.access_entries 
    ADD CONSTRAINT fk_access_entries_mfa 
    FOREIGN KEY (mfa_log_id) REFERENCES public.access_mfa_log(id);
  END IF;
END $$;

COMMENT ON COLUMN public.access_entries.credential_id IS 'Badge/credential used for access';
COMMENT ON COLUMN public.access_entries.anti_passback_violation IS 'True if entry violated anti-passback rules';
COMMENT ON COLUMN public.access_entries.tailgate_detected IS 'True if tailgating/piggybacking was detected';
COMMENT ON COLUMN public.access_entries.reader_id IS 'Physical reader device identifier (for hardware integration)';
COMMENT ON COLUMN public.access_entries.door_id IS 'Door/portal identifier (for hardware integration)';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 9: RLS POLICIES FOR NEW TABLES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- biometric_consents
ALTER TABLE public.biometric_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "biometric_consents_select" ON public.biometric_consents;
CREATE POLICY "biometric_consents_select" ON public.biometric_consents
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "biometric_consents_insert" ON public.biometric_consents;
CREATE POLICY "biometric_consents_insert" ON public.biometric_consents
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer', 'officer')
      AND organization_id = biometric_consents.organization_id
  ));

DROP POLICY IF EXISTS "biometric_consents_update" ON public.biometric_consents;
CREATE POLICY "biometric_consents_update" ON public.biometric_consents
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer')
      AND organization_id = biometric_consents.organization_id
  ));

DROP POLICY IF EXISTS "biometric_consents_service" ON public.biometric_consents;
CREATE POLICY "biometric_consents_service" ON public.biometric_consents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- access_watchlist
ALTER TABLE public.access_watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "access_watchlist_select" ON public.access_watchlist;
CREATE POLICY "access_watchlist_select" ON public.access_watchlist
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "access_watchlist_insert" ON public.access_watchlist;
CREATE POLICY "access_watchlist_insert" ON public.access_watchlist
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master')
      AND organization_id = access_watchlist.organization_id
  ));

DROP POLICY IF EXISTS "access_watchlist_update" ON public.access_watchlist;
CREATE POLICY "access_watchlist_update" ON public.access_watchlist
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master')
      AND organization_id = access_watchlist.organization_id
  ));

DROP POLICY IF EXISTS "access_watchlist_delete" ON public.access_watchlist;
CREATE POLICY "access_watchlist_delete" ON public.access_watchlist
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master')
      AND organization_id = access_watchlist.organization_id
  ));

DROP POLICY IF EXISTS "access_watchlist_service" ON public.access_watchlist;
CREATE POLICY "access_watchlist_service" ON public.access_watchlist
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- access_credentials
ALTER TABLE public.access_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "access_credentials_select" ON public.access_credentials;
CREATE POLICY "access_credentials_select" ON public.access_credentials
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "access_credentials_insert" ON public.access_credentials;
CREATE POLICY "access_credentials_insert" ON public.access_credentials
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer')
      AND organization_id = access_credentials.organization_id
  ));

DROP POLICY IF EXISTS "access_credentials_update" ON public.access_credentials;
CREATE POLICY "access_credentials_update" ON public.access_credentials
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer')
      AND organization_id = access_credentials.organization_id
  ));

DROP POLICY IF EXISTS "access_credentials_delete" ON public.access_credentials;
CREATE POLICY "access_credentials_delete" ON public.access_credentials
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master')
      AND organization_id = access_credentials.organization_id
  ));

DROP POLICY IF EXISTS "access_credentials_service" ON public.access_credentials;
CREATE POLICY "access_credentials_service" ON public.access_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- access_location_state
ALTER TABLE public.access_location_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "access_location_state_select" ON public.access_location_state;
CREATE POLICY "access_location_state_select" ON public.access_location_state
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "access_location_state_all" ON public.access_location_state;
CREATE POLICY "access_location_state_all" ON public.access_location_state
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer', 'officer')
      AND organization_id = access_location_state.organization_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer', 'officer')
      AND organization_id = access_location_state.organization_id
  ));

DROP POLICY IF EXISTS "access_location_state_service" ON public.access_location_state;
CREATE POLICY "access_location_state_service" ON public.access_location_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- access_mfa_log
ALTER TABLE public.access_mfa_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "access_mfa_log_select" ON public.access_mfa_log;
CREATE POLICY "access_mfa_log_select" ON public.access_mfa_log
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "access_mfa_log_insert" ON public.access_mfa_log;
CREATE POLICY "access_mfa_log_insert" ON public.access_mfa_log
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer', 'officer')
      AND organization_id = access_mfa_log.organization_id
  ));

DROP POLICY IF EXISTS "access_mfa_log_service" ON public.access_mfa_log;
CREATE POLICY "access_mfa_log_service" ON public.access_mfa_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- emergency_events
ALTER TABLE public.emergency_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emergency_events_select" ON public.emergency_events;
CREATE POLICY "emergency_events_select" ON public.emergency_events
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "emergency_events_insert" ON public.emergency_events;
CREATE POLICY "emergency_events_insert" ON public.emergency_events
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer')
      AND organization_id = emergency_events.organization_id
  ));

DROP POLICY IF EXISTS "emergency_events_update" ON public.emergency_events;
CREATE POLICY "emergency_events_update" ON public.emergency_events
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer')
      AND organization_id = emergency_events.organization_id
  ));

DROP POLICY IF EXISTS "emergency_events_service" ON public.emergency_events;
CREATE POLICY "emergency_events_service" ON public.emergency_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- evacuation_roll_call
ALTER TABLE public.evacuation_roll_call ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evacuation_roll_call_select" ON public.evacuation_roll_call;
CREATE POLICY "evacuation_roll_call_select" ON public.evacuation_roll_call
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "evacuation_roll_call_all" ON public.evacuation_roll_call;
CREATE POLICY "evacuation_roll_call_all" ON public.evacuation_roll_call
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer', 'officer')
      AND organization_id = evacuation_roll_call.organization_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer', 'officer')
      AND organization_id = evacuation_roll_call.organization_id
  ));

DROP POLICY IF EXISTS "evacuation_roll_call_service" ON public.evacuation_roll_call;
CREATE POLICY "evacuation_roll_call_service" ON public.evacuation_roll_call
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 10: RPC FUNCTIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Check if person has valid biometric consent
CREATE OR REPLACE FUNCTION public.has_valid_biometric_consent(
  p_person_record_id uuid,
  p_consent_type text DEFAULT 'face_recognition'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.biometric_consents
    WHERE person_record_id = p_person_record_id
      AND consent_type = p_consent_type
      AND consent_given = true
      AND consent_withdrawn = false
  );
$$;

COMMENT ON FUNCTION public.has_valid_biometric_consent IS 'Check if person has given valid (non-withdrawn) consent for biometric processing';

-- Check watchlist for person
CREATE OR REPLACE FUNCTION public.check_access_watchlist(
  p_organization_id uuid,
  p_person_record_id uuid DEFAULT NULL,
  p_face_embedding real[] DEFAULT NULL
)
RETURNS TABLE (
  watchlist_id uuid,
  list_type text,
  reason text,
  alert_message text,
  match_type text  -- 'person_record' or 'face_match'
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check by person_record_id
  IF p_person_record_id IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      w.id,
      w.list_type,
      w.reason,
      w.alert_message,
      'person_record'::text AS match_type
    FROM public.access_watchlist w
    WHERE w.organization_id = p_organization_id
      AND w.person_record_id = p_person_record_id
      AND (w.effective_until IS NULL OR w.effective_until > now())
      AND w.effective_from <= now();
  END IF;
  
  -- Face embedding match would be implemented here if p_face_embedding provided
  -- This would use cosine similarity against stored face_embedding values
END;
$$;

COMMENT ON FUNCTION public.check_access_watchlist IS 'Check if person is on any watchlist (blocked, restricted, alert, etc)';

-- Check anti-passback
CREATE OR REPLACE FUNCTION public.check_anti_passback(
  p_organization_id uuid,
  p_person_record_id uuid,
  p_zone_id uuid,
  p_entry_type text  -- 'entry' or 'exit'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone record;
  v_state record;
  v_is_violation boolean := false;
  v_timeout_expired boolean := false;
BEGIN
  -- Get zone settings
  SELECT * INTO v_zone FROM public.zones WHERE id = p_zone_id;
  
  -- If anti-passback not enabled, always allow
  IF NOT COALESCE(v_zone.anti_passback_enabled, false) THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'anti_passback_disabled');
  END IF;
  
  -- Get current location state
  SELECT * INTO v_state 
  FROM public.access_location_state
  WHERE organization_id = p_organization_id
    AND person_record_id = p_person_record_id
    AND current_zone_id = p_zone_id;
  
  -- If no state exists, allow entry
  IF v_state IS NULL THEN
    IF p_entry_type = 'entry' THEN
      RETURN jsonb_build_object('allowed', true, 'reason', 'no_prior_state');
    ELSE
      -- Can't exit if never entered
      RETURN jsonb_build_object('allowed', false, 'reason', 'no_entry_record', 'violation', false);
    END IF;
  END IF;
  
  -- Check for timeout reset
  IF v_zone.anti_passback_timeout_minutes > 0 AND v_state.last_entry_at IS NOT NULL THEN
    v_timeout_expired := v_state.last_entry_at < (now() - (v_zone.anti_passback_timeout_minutes || ' minutes')::interval);
  END IF;
  
  -- Check for violation
  IF p_entry_type = 'entry' AND v_state.is_inside AND NOT v_timeout_expired THEN
    -- Trying to enter when already inside = violation
    v_is_violation := true;
    
    -- Update violation count
    UPDATE public.access_location_state
    SET passback_violation_count = COALESCE(passback_violation_count, 0) + 1,
        last_violation_at = now(),
        updated_at = now()
    WHERE id = v_state.id;
    
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'already_inside',
      'violation', true,
      'violation_count', COALESCE(v_state.passback_violation_count, 0) + 1
    );
  ELSIF p_entry_type = 'exit' AND NOT v_state.is_inside THEN
    -- Trying to exit when not inside = violation
    v_is_violation := true;
    
    -- Update violation count
    UPDATE public.access_location_state
    SET passback_violation_count = COALESCE(passback_violation_count, 0) + 1,
        last_violation_at = now(),
        updated_at = now()
    WHERE id = v_state.id;
    
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'not_inside',
      'violation', true,
      'violation_count', COALESCE(v_state.passback_violation_count, 0) + 1
    );
  END IF;
  
  RETURN jsonb_build_object('allowed', true, 'reason', 'valid_sequence');
END;
$$;

COMMENT ON FUNCTION public.check_anti_passback IS 'Check if entry/exit complies with anti-passback rules';

-- Update location state after access event
CREATE OR REPLACE FUNCTION public.update_access_location_state(
  p_organization_id uuid,
  p_person_record_id uuid,
  p_zone_id uuid,
  p_entry_type text,
  p_access_entry_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.access_location_state (
    organization_id, person_record_id, current_zone_id, is_inside,
    last_entry_at, last_exit_at, last_entry_id, last_exit_id
  )
  VALUES (
    p_organization_id, p_person_record_id, p_zone_id,
    p_entry_type = 'entry',
    CASE WHEN p_entry_type = 'entry' THEN now() END,
    CASE WHEN p_entry_type = 'exit' THEN now() END,
    CASE WHEN p_entry_type = 'entry' THEN p_access_entry_id END,
    CASE WHEN p_entry_type = 'exit' THEN p_access_entry_id END
  )
  ON CONFLICT (organization_id, person_record_id, current_zone_id)
  DO UPDATE SET
    is_inside = (p_entry_type = 'entry'),
    last_entry_at = CASE WHEN p_entry_type = 'entry' THEN now() ELSE access_location_state.last_entry_at END,
    last_exit_at = CASE WHEN p_entry_type = 'exit' THEN now() ELSE access_location_state.last_exit_at END,
    last_entry_id = CASE WHEN p_entry_type = 'entry' THEN p_access_entry_id ELSE access_location_state.last_entry_id END,
    last_exit_id = CASE WHEN p_entry_type = 'exit' THEN p_access_entry_id ELSE access_location_state.last_exit_id END,
    updated_at = now();
    
  -- Update zone occupancy
  IF p_entry_type = 'entry' THEN
    UPDATE public.zones SET current_occupancy = COALESCE(current_occupancy, 0) + 1 WHERE id = p_zone_id;
  ELSIF p_entry_type = 'exit' THEN
    UPDATE public.zones SET current_occupancy = GREATEST(0, COALESCE(current_occupancy, 0) - 1) WHERE id = p_zone_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.update_access_location_state IS 'Update location tracking after access entry/exit event';

-- Get zone occupancy report
CREATE OR REPLACE FUNCTION public.get_zone_occupancy(
  p_zone_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'zone_id', z.id,
    'zone_name', z.name,
    'current_occupancy', COALESCE(z.current_occupancy, 0),
    'max_occupancy', z.max_occupancy,
    'at_capacity', z.max_occupancy IS NOT NULL AND z.current_occupancy >= z.max_occupancy,
    'occupancy_percentage', CASE 
      WHEN z.max_occupancy > 0 THEN ROUND((COALESCE(z.current_occupancy, 0)::numeric / z.max_occupancy) * 100, 1)
      ELSE NULL 
    END,
    'persons_inside', (
      SELECT jsonb_agg(jsonb_build_object(
        'person_id', ls.person_record_id,
        'first_name', pr.first_name,
        'last_name', pr.last_name,
        'entered_at', ls.last_entry_at
      ))
      FROM public.access_location_state ls
      JOIN public.person_records pr ON pr.id = ls.person_record_id
      WHERE ls.current_zone_id = p_zone_id AND ls.is_inside = true
    )
  )
  FROM public.zones z
  WHERE z.id = p_zone_id;
$$;

COMMENT ON FUNCTION public.get_zone_occupancy IS 'Get current zone occupancy with list of persons inside';

-- Initiate emergency evacuation
CREATE OR REPLACE FUNCTION public.initiate_emergency_evacuation(
  p_organization_id uuid,
  p_event_type text,
  p_event_name text,
  p_affected_zone_ids uuid[],
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_persons_to_track integer := 0;
BEGIN
  -- Create emergency event
  INSERT INTO public.emergency_events (
    organization_id, event_type, event_name, description, affected_zone_ids, initiated_by
  )
  VALUES (
    p_organization_id, p_event_type, p_event_name, p_description, p_affected_zone_ids, auth.uid()
  )
  RETURNING id INTO v_event_id;
  
  -- Set emergency mode on affected zones
  UPDATE public.zones SET emergency_mode = true WHERE id = ANY(p_affected_zone_ids);
  
  -- Create roll call entries for everyone currently inside affected zones
  INSERT INTO public.evacuation_roll_call (
    emergency_event_id, organization_id, person_record_id, 
    last_known_zone_id, was_inside, evacuation_status
  )
  SELECT 
    v_event_id,
    p_organization_id,
    ls.person_record_id,
    ls.current_zone_id,
    ls.is_inside,
    CASE WHEN ls.is_inside THEN 'unaccounted' ELSE 'absent' END
  FROM public.access_location_state ls
  WHERE ls.current_zone_id = ANY(p_affected_zone_ids)
    AND ls.organization_id = p_organization_id;
  
  GET DIAGNOSTICS v_persons_to_track = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'event_type', p_event_type,
    'affected_zones', p_affected_zone_ids,
    'persons_to_track', v_persons_to_track,
    'started_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.initiate_emergency_evacuation IS 'Initiate emergency evacuation and create roll call list';

-- Get evacuation status
CREATE OR REPLACE FUNCTION public.get_evacuation_status(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'event_id', e.id,
    'event_type', e.event_type,
    'event_name', e.event_name,
    'status', e.status,
    'started_at', e.started_at,
    'ended_at', e.ended_at,
    'summary', jsonb_build_object(
      'total', COUNT(rc.id),
      'evacuated', COUNT(*) FILTER (WHERE rc.evacuation_status = 'evacuated'),
      'sheltering', COUNT(*) FILTER (WHERE rc.evacuation_status = 'sheltering'),
      'unaccounted', COUNT(*) FILTER (WHERE rc.evacuation_status = 'unaccounted'),
      'missing', COUNT(*) FILTER (WHERE rc.evacuation_status = 'missing'),
      'requires_assistance', COUNT(*) FILTER (WHERE rc.evacuation_status = 'requires_assistance'),
      'absent', COUNT(*) FILTER (WHERE rc.evacuation_status = 'absent')
    ),
    'unaccounted_persons', (
      SELECT jsonb_agg(jsonb_build_object(
        'person_id', rc2.person_record_id,
        'first_name', pr.first_name,
        'last_name', pr.last_name,
        'last_known_zone', z.name,
        'status', rc2.evacuation_status
      ))
      FROM public.evacuation_roll_call rc2
      JOIN public.person_records pr ON pr.id = rc2.person_record_id
      LEFT JOIN public.zones z ON z.id = rc2.last_known_zone_id
      WHERE rc2.emergency_event_id = e.id
        AND rc2.evacuation_status IN ('unaccounted', 'missing', 'requires_assistance')
    )
  )
  FROM public.emergency_events e
  LEFT JOIN public.evacuation_roll_call rc ON rc.emergency_event_id = e.id
  WHERE e.id = p_event_id
  GROUP BY e.id;
$$;

COMMENT ON FUNCTION public.get_evacuation_status IS 'Get current evacuation status with headcount summary';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 11: TRIGGERS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Update credential last_used on access entry
CREATE OR REPLACE FUNCTION public.fn_update_credential_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.credential_id IS NOT NULL THEN
    UPDATE public.access_credentials
    SET last_used_at = now(),
        last_used_zone_id = NEW.zone_id,
        use_count = COALESCE(use_count, 0) + 1,
        updated_at = now()
    WHERE id = NEW.credential_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_access_entries_credential_usage
  AFTER INSERT ON public.access_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_credential_usage();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 12: GRAND MASTER RLS OVERRIDES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Allow grand_master to view all records across organizations
DROP POLICY IF EXISTS "biometric_consents_grand_master" ON public.biometric_consents;
CREATE POLICY "biometric_consents_grand_master" ON public.biometric_consents
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'));

DROP POLICY IF EXISTS "access_watchlist_grand_master" ON public.access_watchlist;
CREATE POLICY "access_watchlist_grand_master" ON public.access_watchlist
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'));

DROP POLICY IF EXISTS "access_credentials_grand_master" ON public.access_credentials;
CREATE POLICY "access_credentials_grand_master" ON public.access_credentials
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'));

DROP POLICY IF EXISTS "access_location_state_grand_master" ON public.access_location_state;
CREATE POLICY "access_location_state_grand_master" ON public.access_location_state
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'));

DROP POLICY IF EXISTS "access_mfa_log_grand_master" ON public.access_mfa_log;
CREATE POLICY "access_mfa_log_grand_master" ON public.access_mfa_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'));

DROP POLICY IF EXISTS "emergency_events_grand_master" ON public.emergency_events;
CREATE POLICY "emergency_events_grand_master" ON public.emergency_events
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'));

DROP POLICY IF EXISTS "evacuation_roll_call_grand_master" ON public.evacuation_roll_call;
CREATE POLICY "evacuation_roll_call_grand_master" ON public.evacuation_roll_call
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'grand_master'));
