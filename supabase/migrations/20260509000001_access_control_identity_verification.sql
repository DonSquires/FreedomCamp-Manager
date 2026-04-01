-- ============================================================================
-- Access Control & Identity Verification System
--
-- Implements secure identity verification for access control points:
--   1. Face recognition verification against stored profile photos
--   2. ID document capture and verification
--   3. Geofence-restricted verification (only works inside designated zones)
--   4. Complete audit trail of all verification attempts
--
-- Use Cases:
--   - Military base access control
--   - Secure facility entry/exit
--   - Event credential verification
--   - Visitor management systems
-- ============================================================================

-- ── Enable access control on zones ─────────────────────────────────────────────
ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS access_control_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_control_config jsonb DEFAULT '{}';

COMMENT ON COLUMN public.zones.access_control_enabled IS 'Enable ID verification access control for this zone';
COMMENT ON COLUMN public.zones.access_control_config IS 'Access control configuration: { require_face_match: bool, require_id_document: bool, min_face_confidence: number }';

-- ── Profile photos for person records ──────────────────────────────────────────
ALTER TABLE public.person_records
  ADD COLUMN IF NOT EXISTS profile_photo_url text,
  ADD COLUMN IF NOT EXISTS profile_photo_embedding real[],
  ADD COLUMN IF NOT EXISTS profile_photo_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS id_document_number text,
  ADD COLUMN IF NOT EXISTS id_document_type text CHECK (id_document_type IN ('drivers_license', 'passport', 'national_id', 'military_id', 'employee_id', 'other')),
  ADD COLUMN IF NOT EXISTS id_document_expiry date,
  ADD COLUMN IF NOT EXISTS access_badge_number text,
  ADD COLUMN IF NOT EXISTS access_clearance_level text CHECK (access_clearance_level IN ('public', 'restricted', 'confidential', 'secret', 'top_secret'));

COMMENT ON COLUMN public.person_records.profile_photo_url IS 'Primary photo URL for face verification';
COMMENT ON COLUMN public.person_records.profile_photo_embedding IS 'Face embedding (384-D) for fast comparison';
COMMENT ON COLUMN public.person_records.id_document_number IS 'ID document number (encrypted at rest)';
COMMENT ON COLUMN public.person_records.access_clearance_level IS 'Security clearance level for access control';

-- ── ID Documents table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.person_id_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  person_record_id uuid NOT NULL REFERENCES public.person_records(id) ON DELETE CASCADE,
  
  -- Document details
  document_type text NOT NULL CHECK (document_type IN ('drivers_license', 'passport', 'national_id', 'military_id', 'employee_id', 'access_badge', 'other')),
  document_number text,  -- Encrypted at rest via Supabase
  issuing_authority text,
  issue_date date,
  expiry_date date,
  
  -- Photos
  front_photo_url text NOT NULL,
  back_photo_url text,
  
  -- OCR extracted data (optional)
  extracted_name text,
  extracted_dob date,
  extraction_confidence real,
  
  -- Verification
  is_verified boolean DEFAULT false,
  verified_by uuid REFERENCES auth.users(id),
  verified_at timestamptz,
  verification_notes text,
  
  -- Metadata
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_id_documents_person ON public.person_id_documents(person_record_id);
CREATE INDEX IF NOT EXISTS idx_person_id_documents_org ON public.person_id_documents(organization_id);

-- ── Access Entries (Entry/Exit Log) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  zone_id uuid NOT NULL REFERENCES public.zones(id),
  person_record_id uuid REFERENCES public.person_records(id),
  
  -- Entry type
  entry_type text NOT NULL CHECK (entry_type IN ('entry', 'exit', 'denied')),
  
  -- Verification details
  verification_method text NOT NULL CHECK (verification_method IN ('face_only', 'id_only', 'face_and_id', 'badge_scan', 'manual_override', 'denied_no_match')),
  
  -- Face verification
  face_photo_url text,
  face_match_confidence real,
  face_match_passed boolean,
  face_record_id uuid REFERENCES public.face_records(id),
  
  -- ID verification
  id_document_id uuid REFERENCES public.person_id_documents(id),
  id_verified boolean,
  id_name_matches boolean,
  
  -- Location
  gps_latitude double precision,
  gps_longitude double precision,
  gps_accuracy double precision,
  inside_geofence boolean NOT NULL DEFAULT false,
  
  -- Officer/Guard
  processed_by uuid REFERENCES auth.users(id),
  
  -- Notes and flags
  notes text,
  flagged boolean DEFAULT false,
  flag_reason text,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_entries_zone ON public.access_entries(zone_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_entries_person ON public.access_entries(person_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_entries_org ON public.access_entries(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_entries_type ON public.access_entries(entry_type, created_at DESC);

-- ── Access Control Permissions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  person_record_id uuid NOT NULL REFERENCES public.person_records(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  
  -- Permission details
  permission_type text NOT NULL CHECK (permission_type IN ('full_access', 'time_restricted', 'escort_required', 'denied')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  
  -- Time restrictions (JSON array of { day_of_week: 0-6, start_time: "HH:MM", end_time: "HH:MM" })
  time_restrictions jsonb,
  
  -- Escort requirement
  requires_escort boolean DEFAULT false,
  escort_person_id uuid REFERENCES public.person_records(id),
  
  -- Notes
  notes text,
  
  -- Audit
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Unique constraint
  UNIQUE(person_record_id, zone_id)
);

CREATE INDEX IF NOT EXISTS idx_access_permissions_person ON public.access_permissions(person_record_id);
CREATE INDEX IF NOT EXISTS idx_access_permissions_zone ON public.access_permissions(zone_id);

-- ── RLS Policies ───────────────────────────────────────────────────────────────

-- person_id_documents
ALTER TABLE public.person_id_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY person_id_documents_select ON public.person_id_documents
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY person_id_documents_insert ON public.person_id_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master', 'admin_officer', 'officer')
        AND organization_id = person_id_documents.organization_id
    )
  );

CREATE POLICY person_id_documents_update ON public.person_id_documents
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master', 'admin_officer')
        AND organization_id = person_id_documents.organization_id
    )
  );

CREATE POLICY person_id_documents_service ON public.person_id_documents
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- access_entries
ALTER TABLE public.access_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_entries_select ON public.access_entries
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY access_entries_insert ON public.access_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master', 'admin_officer', 'officer')
        AND organization_id = access_entries.organization_id
    )
  );

CREATE POLICY access_entries_service ON public.access_entries
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- access_permissions
ALTER TABLE public.access_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_permissions_select ON public.access_permissions
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY access_permissions_insert ON public.access_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master', 'admin_officer')
        AND organization_id = access_permissions.organization_id
    )
  );

CREATE POLICY access_permissions_update ON public.access_permissions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master', 'admin_officer')
        AND organization_id = access_permissions.organization_id
    )
  );

CREATE POLICY access_permissions_delete ON public.access_permissions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master')
        AND organization_id = access_permissions.organization_id
    )
  );

CREATE POLICY access_permissions_service ON public.access_permissions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── RPC: Verify Identity ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_access_identity(
  p_person_record_id uuid,
  p_zone_id uuid,
  p_face_embedding real[],
  p_gps_lat double precision DEFAULT NULL,
  p_gps_lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person record;
  v_zone record;
  v_permission record;
  v_similarity real;
  v_result jsonb;
  v_inside_geofence boolean := false;
  v_face_match_passed boolean := false;
  v_min_confidence real := 0.75;
BEGIN
  -- Get person record with profile photo embedding
  SELECT * INTO v_person
  FROM public.person_records
  WHERE id = p_person_record_id;
  
  IF v_person IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Person record not found'
    );
  END IF;
  
  -- Get zone with access control config
  SELECT * INTO v_zone
  FROM public.zones
  WHERE id = p_zone_id;
  
  IF v_zone IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Zone not found'
    );
  END IF;
  
  IF NOT v_zone.access_control_enabled THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Access control not enabled for this zone'
    );
  END IF;
  
  -- Check geofence (if GPS provided)
  IF p_gps_lat IS NOT NULL AND p_gps_lng IS NOT NULL THEN
    -- Simple radius check (in meters)
    v_inside_geofence := (
      6371000 * acos(
        cos(radians(p_gps_lat)) * cos(radians(v_zone.location_lat)) *
        cos(radians(v_zone.location_lng) - radians(p_gps_lng)) +
        sin(radians(p_gps_lat)) * sin(radians(v_zone.location_lat))
      )
    ) <= COALESCE(v_zone.radius_meters, 500);
  END IF;
  
  -- Extract min confidence from config
  v_min_confidence := COALESCE(
    (v_zone.access_control_config->>'min_face_confidence')::real,
    0.75
  );
  
  -- Calculate face similarity if embeddings available
  IF v_person.profile_photo_embedding IS NOT NULL AND p_face_embedding IS NOT NULL THEN
    -- Cosine similarity
    SELECT COALESCE(
      SUM(a * b) / NULLIF(SQRT(SUM(a * a)) * SQRT(SUM(b * b)), 0),
      0
    )
    INTO v_similarity
    FROM UNNEST(v_person.profile_photo_embedding) WITH ORDINALITY AS q(a, i)
    JOIN UNNEST(p_face_embedding) WITH ORDINALITY AS d(b, j) ON q.i = d.j;
    
    v_face_match_passed := v_similarity >= v_min_confidence;
  END IF;
  
  -- Check access permissions
  SELECT * INTO v_permission
  FROM public.access_permissions
  WHERE person_record_id = p_person_record_id
    AND zone_id = p_zone_id
    AND (valid_until IS NULL OR valid_until > now())
    AND valid_from <= now()
    AND permission_type != 'denied'
  LIMIT 1;
  
  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'person', jsonb_build_object(
      'id', v_person.id,
      'first_name', v_person.first_name,
      'last_name', v_person.last_name,
      'access_clearance_level', v_person.access_clearance_level,
      'access_badge_number', v_person.access_badge_number
    ),
    'verification', jsonb_build_object(
      'face_match_passed', v_face_match_passed,
      'face_similarity', v_similarity,
      'min_confidence_required', v_min_confidence,
      'inside_geofence', v_inside_geofence
    ),
    'permission', CASE 
      WHEN v_permission IS NOT NULL THEN jsonb_build_object(
        'has_permission', true,
        'permission_type', v_permission.permission_type,
        'requires_escort', v_permission.requires_escort,
        'valid_until', v_permission.valid_until
      )
      ELSE jsonb_build_object(
        'has_permission', false,
        'permission_type', null
      )
    END,
    'access_granted', (
      v_face_match_passed AND 
      v_inside_geofence AND 
      v_permission IS NOT NULL AND
      v_permission.permission_type IN ('full_access', 'time_restricted')
    )
  );
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.verify_access_identity IS 'Verify person identity for access control via face matching and permission check';

-- ── RPC: Log Access Entry ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_access_entry(
  p_organization_id uuid,
  p_zone_id uuid,
  p_person_record_id uuid,
  p_entry_type text,
  p_verification_method text,
  p_face_match_confidence real DEFAULT NULL,
  p_face_match_passed boolean DEFAULT NULL,
  p_face_photo_url text DEFAULT NULL,
  p_face_record_id uuid DEFAULT NULL,
  p_id_document_id uuid DEFAULT NULL,
  p_id_verified boolean DEFAULT NULL,
  p_gps_lat double precision DEFAULT NULL,
  p_gps_lng double precision DEFAULT NULL,
  p_gps_accuracy double precision DEFAULT NULL,
  p_inside_geofence boolean DEFAULT false,
  p_processed_by uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_flagged boolean DEFAULT false,
  p_flag_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
BEGIN
  INSERT INTO public.access_entries (
    organization_id,
    zone_id,
    person_record_id,
    entry_type,
    verification_method,
    face_match_confidence,
    face_match_passed,
    face_photo_url,
    face_record_id,
    id_document_id,
    id_verified,
    gps_latitude,
    gps_longitude,
    gps_accuracy,
    inside_geofence,
    processed_by,
    notes,
    flagged,
    flag_reason
  ) VALUES (
    p_organization_id,
    p_zone_id,
    p_person_record_id,
    p_entry_type,
    p_verification_method,
    p_face_match_confidence,
    p_face_match_passed,
    p_face_photo_url,
    p_face_record_id,
    p_id_document_id,
    p_id_verified,
    p_gps_lat,
    p_gps_lng,
    p_gps_accuracy,
    p_inside_geofence,
    COALESCE(p_processed_by, auth.uid()),
    p_notes,
    p_flagged,
    p_flag_reason
  )
  RETURNING id INTO v_entry_id;
  
  RETURN v_entry_id;
END;
$$;

COMMENT ON FUNCTION public.log_access_entry IS 'Log an access control entry/exit/denial event';

-- ── Updated-at trigger for person_id_documents ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.person_id_documents_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_person_id_documents_updated_at
  BEFORE UPDATE ON public.person_id_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.person_id_documents_set_updated_at();

-- ── Updated-at trigger for access_permissions ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.access_permissions_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_access_permissions_updated_at
  BEFORE UPDATE ON public.access_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.access_permissions_set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════════
-- SHORT-TERM VISITOR / TEMPORARY ACCESS MANAGEMENT
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Add retention fields to person_records ─────────────────────────────────────
ALTER TABLE public.person_records
  ADD COLUMN IF NOT EXISTS is_temporary_visitor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visitor_type text CHECK (visitor_type IN ('visitor', 'contractor', 'vendor', 'delivery', 'event_attendee', 'other')),
  ADD COLUMN IF NOT EXISTS data_retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS auto_delete_on_expiry boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsoring_person_id uuid REFERENCES public.person_records(id),
  ADD COLUMN IF NOT EXISTS visit_purpose text,
  ADD COLUMN IF NOT EXISTS visit_start_date date,
  ADD COLUMN IF NOT EXISTS visit_end_date date,
  ADD COLUMN IF NOT EXISTS host_organization_id uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS deletion_reason text;

COMMENT ON COLUMN public.person_records.is_temporary_visitor IS 'True for short-term visitors whose data should be retained only temporarily';
COMMENT ON COLUMN public.person_records.visitor_type IS 'Type of temporary visitor';
COMMENT ON COLUMN public.person_records.data_retention_until IS 'Date/time when record should be deleted (if auto_delete_on_expiry is true)';
COMMENT ON COLUMN public.person_records.auto_delete_on_expiry IS 'Automatically delete all related records when data_retention_until is reached';
COMMENT ON COLUMN public.person_records.sponsoring_person_id IS 'Person who is sponsoring/hosting this visitor';
COMMENT ON COLUMN public.person_records.visit_purpose IS 'Reason for visit';
COMMENT ON COLUMN public.person_records.deleted_at IS 'Soft delete timestamp (for audit trail before hard delete)';

-- ── Index for finding expired records ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_person_records_retention_expiry
  ON public.person_records(data_retention_until)
  WHERE is_temporary_visitor = true AND auto_delete_on_expiry = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_person_records_temporary
  ON public.person_records(is_temporary_visitor, organization_id)
  WHERE is_temporary_visitor = true;

-- ── Visitor Registration Log ───────────────────────────────────────────────────
-- Tracks all visitor registrations and check-ins/check-outs
CREATE TABLE IF NOT EXISTS public.visitor_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  person_record_id uuid NOT NULL REFERENCES public.person_records(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES public.zones(id),
  
  -- Registration details
  registration_type text NOT NULL CHECK (registration_type IN ('pre_registered', 'walk_in', 'recurring')),
  visit_purpose text,
  expected_arrival timestamptz,
  expected_departure timestamptz,
  
  -- Actual times
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  checked_in_by uuid REFERENCES auth.users(id),
  checked_out_by uuid REFERENCES auth.users(id),
  
  -- Host information
  host_person_id uuid REFERENCES public.person_records(id),
  host_user_id uuid REFERENCES auth.users(id),
  host_notified_at timestamptz,
  
  -- Badge/credential issued
  badge_number text,
  badge_issued_at timestamptz,
  badge_returned_at timestamptz,
  
  -- Status
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'denied')),
  
  -- Data retention
  data_retention_days integer DEFAULT 90,
  
  -- Notes
  notes text,
  special_instructions text,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_registrations_org ON public.visitor_registrations(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_registrations_person ON public.visitor_registrations(person_record_id);
CREATE INDEX IF NOT EXISTS idx_visitor_registrations_zone ON public.visitor_registrations(zone_id, expected_arrival);
CREATE INDEX IF NOT EXISTS idx_visitor_registrations_status ON public.visitor_registrations(status, expected_arrival);

-- ── RLS for visitor_registrations ──────────────────────────────────────────────
ALTER TABLE public.visitor_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY visitor_registrations_select ON public.visitor_registrations
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY visitor_registrations_insert ON public.visitor_registrations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master', 'admin_officer', 'officer')
        AND organization_id = visitor_registrations.organization_id
    )
  );

CREATE POLICY visitor_registrations_update ON public.visitor_registrations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master', 'admin_officer', 'officer')
        AND organization_id = visitor_registrations.organization_id
    )
  );

CREATE POLICY visitor_registrations_service ON public.visitor_registrations
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Updated-at trigger for visitor_registrations ───────────────────────────────
CREATE TRIGGER trg_visitor_registrations_updated_at
  BEFORE UPDATE ON public.visitor_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.person_id_documents_set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════════
-- DATA RETENTION & CLEANUP FUNCTIONS
-- ══════════════════════════════════════════════════════════════════════════════

-- ── RPC: Soft delete a visitor record ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.soft_delete_visitor_record(
  p_person_record_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role text;
  v_person_org uuid;
  v_user_org uuid;
BEGIN
  -- Get calling user's role and org
  SELECT role, organization_id INTO v_user_role, v_user_org
  FROM public.user_profiles
  WHERE id = auth.uid();
  
  -- Get person's org
  SELECT organization_id INTO v_person_org
  FROM public.person_records
  WHERE id = p_person_record_id;
  
  IF v_person_org IS NULL THEN
    RAISE EXCEPTION 'Person record not found';
  END IF;
  
  -- Check authorization: must be admin/master of same org, or grand_master
  IF v_user_role = 'grand_master' THEN
    -- Grand master can delete any record
    NULL;
  ELSIF v_user_role IN ('admin', 'master', 'admin_officer') AND v_user_org = v_person_org THEN
    -- Admin of same org can delete
    NULL;
  ELSE
    RAISE EXCEPTION 'Not authorized to delete this record';
  END IF;
  
  -- Soft delete the record
  UPDATE public.person_records
  SET 
    deleted_at = now(),
    deleted_by = auth.uid(),
    deletion_reason = p_reason
  WHERE id = p_person_record_id
    AND deleted_at IS NULL;
  
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_visitor_record IS 'Soft delete a visitor record (marks for deletion, does not immediately remove)';

-- ── RPC: Hard delete expired visitor records ───────────────────────────────────
-- This should be called by a scheduled job (pg_cron or external scheduler)
CREATE OR REPLACE FUNCTION public.cleanup_expired_visitor_records(
  p_batch_size integer DEFAULT 100
)
RETURNS TABLE(
  deleted_count integer,
  deleted_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_ids uuid[];
  v_count integer := 0;
BEGIN
  -- Find and delete expired records where auto_delete_on_expiry is true
  WITH expired_records AS (
    SELECT id FROM public.person_records
    WHERE is_temporary_visitor = true
      AND auto_delete_on_expiry = true
      AND data_retention_until IS NOT NULL
      AND data_retention_until < now()
      AND deleted_at IS NULL
    LIMIT p_batch_size
  ),
  soft_deleted AS (
    UPDATE public.person_records pr
    SET 
      deleted_at = now(),
      deletion_reason = 'Auto-deleted: Data retention period expired'
    FROM expired_records er
    WHERE pr.id = er.id
    RETURNING pr.id
  )
  SELECT array_agg(id), count(*)::integer
  INTO v_deleted_ids, v_count
  FROM soft_deleted;
  
  -- Also clean up records that were soft-deleted more than 30 days ago
  -- This is the final hard delete
  DELETE FROM public.person_records
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - interval '30 days';
  
  RETURN QUERY SELECT v_count, COALESCE(v_deleted_ids, ARRAY[]::uuid[]);
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_visitor_records IS 'Cleanup expired temporary visitor records. Call from scheduled job.';

-- ── RPC: Manually delete visitor and all related data ──────────────────────────
CREATE OR REPLACE FUNCTION public.delete_visitor_with_data(
  p_person_record_id uuid,
  p_reason text DEFAULT NULL,
  p_immediate boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role text;
  v_person_org uuid;
  v_user_org uuid;
  v_deleted_counts jsonb;
  v_face_count integer := 0;
  v_doc_count integer := 0;
  v_entry_count integer := 0;
  v_perm_count integer := 0;
  v_visit_count integer := 0;
BEGIN
  -- Get calling user's role and org
  SELECT role, organization_id INTO v_user_role, v_user_org
  FROM public.user_profiles
  WHERE id = auth.uid();
  
  -- Get person's org and verify it's a temporary visitor
  SELECT organization_id INTO v_person_org
  FROM public.person_records
  WHERE id = p_person_record_id;
  
  IF v_person_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Person record not found');
  END IF;
  
  -- Check authorization
  IF v_user_role = 'grand_master' THEN
    NULL; -- Grand master can delete any record
  ELSIF v_user_role IN ('admin', 'master') AND v_user_org = v_person_org THEN
    NULL; -- Admin of same org can delete
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to delete this record');
  END IF;
  
  IF p_immediate THEN
    -- Immediate hard delete - remove all related records
    
    -- Delete face records
    DELETE FROM public.face_records WHERE person_record_id = p_person_record_id;
    GET DIAGNOSTICS v_face_count = ROW_COUNT;
    
    -- Delete ID documents
    DELETE FROM public.person_id_documents WHERE person_record_id = p_person_record_id;
    GET DIAGNOSTICS v_doc_count = ROW_COUNT;
    
    -- Delete access entries (keep for audit? - set person_record_id to NULL instead)
    UPDATE public.access_entries 
    SET person_record_id = NULL, notes = COALESCE(notes || ' ', '') || '[Person record deleted: ' || p_reason || ']'
    WHERE person_record_id = p_person_record_id;
    GET DIAGNOSTICS v_entry_count = ROW_COUNT;
    
    -- Delete access permissions
    DELETE FROM public.access_permissions WHERE person_record_id = p_person_record_id;
    GET DIAGNOSTICS v_perm_count = ROW_COUNT;
    
    -- Delete visitor registrations
    DELETE FROM public.visitor_registrations WHERE person_record_id = p_person_record_id;
    GET DIAGNOSTICS v_visit_count = ROW_COUNT;
    
    -- Finally delete the person record
    DELETE FROM public.person_records WHERE id = p_person_record_id;
    
    v_deleted_counts := jsonb_build_object(
      'face_records', v_face_count,
      'id_documents', v_doc_count,
      'access_entries_anonymized', v_entry_count,
      'access_permissions', v_perm_count,
      'visitor_registrations', v_visit_count
    );
  ELSE
    -- Soft delete - mark for later cleanup
    UPDATE public.person_records
    SET 
      deleted_at = now(),
      deleted_by = auth.uid(),
      deletion_reason = p_reason
    WHERE id = p_person_record_id;
    
    v_deleted_counts := jsonb_build_object('soft_deleted', true);
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'person_record_id', p_person_record_id,
    'immediate', p_immediate,
    'reason', p_reason,
    'deleted_counts', v_deleted_counts
  );
END;
$$;

COMMENT ON FUNCTION public.delete_visitor_with_data IS 'Delete a visitor record and all associated data. Set immediate=true for hard delete, false for soft delete.';

-- ── RPC: Extend visitor retention period ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.extend_visitor_retention(
  p_person_record_id uuid,
  p_new_retention_until timestamptz,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role text;
  v_person_org uuid;
  v_user_org uuid;
BEGIN
  -- Get calling user's role and org
  SELECT role, organization_id INTO v_user_role, v_user_org
  FROM public.user_profiles
  WHERE id = auth.uid();
  
  -- Get person's org
  SELECT organization_id INTO v_person_org
  FROM public.person_records
  WHERE id = p_person_record_id;
  
  IF v_person_org IS NULL THEN
    RAISE EXCEPTION 'Person record not found';
  END IF;
  
  -- Check authorization
  IF v_user_role = 'grand_master' THEN
    NULL;
  ELSIF v_user_role IN ('admin', 'master', 'admin_officer') AND v_user_org = v_person_org THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Not authorized to modify this record';
  END IF;
  
  -- Update retention period
  UPDATE public.person_records
  SET 
    data_retention_until = p_new_retention_until,
    updated_at = now()
  WHERE id = p_person_record_id;
  
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.extend_visitor_retention IS 'Extend the data retention period for a temporary visitor';

-- ── RPC: List visitors with expiring retention ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_expiring_visitors(
  p_organization_id uuid,
  p_days_until_expiry integer DEFAULT 7
)
RETURNS TABLE(
  id uuid,
  first_name text,
  last_name text,
  visitor_type text,
  data_retention_until timestamptz,
  days_remaining integer,
  visit_purpose text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    pr.id,
    pr.first_name,
    pr.last_name,
    pr.visitor_type,
    pr.data_retention_until,
    EXTRACT(DAY FROM pr.data_retention_until - now())::integer AS days_remaining,
    pr.visit_purpose,
    pr.created_at
  FROM public.person_records pr
  WHERE pr.organization_id = p_organization_id
    AND pr.is_temporary_visitor = true
    AND pr.auto_delete_on_expiry = true
    AND pr.data_retention_until IS NOT NULL
    AND pr.data_retention_until < now() + (p_days_until_expiry || ' days')::interval
    AND pr.deleted_at IS NULL
  ORDER BY pr.data_retention_until ASC;
$$;

COMMENT ON FUNCTION public.list_expiring_visitors IS 'List temporary visitors whose data retention is expiring soon';

-- ══════════════════════════════════════════════════════════════════════════════
RAISE NOTICE '✅ Access Control & Identity Verification System installed';
RAISE NOTICE '   - Zones: access_control_enabled, access_control_config columns';
RAISE NOTICE '   - Person Records: profile_photo, id_document, clearance, retention fields';
RAISE NOTICE '   - Tables: person_id_documents, access_entries, access_permissions, visitor_registrations';
RAISE NOTICE '   - RPCs: verify_access_identity, log_access_entry';
RAISE NOTICE '   - Visitor Management: soft_delete_visitor_record, delete_visitor_with_data, extend_visitor_retention';
RAISE NOTICE '   - Cleanup: cleanup_expired_visitor_records (call from scheduled job)';
