-- ============================================
-- EVIDENCE INTEGRITY & LEGAL COMPLIANCE
-- Court-defensible architecture per Evidence Act 2006, Privacy Act 2020, Freedom Camping Act 2011
-- ============================================

-- ===========================================
-- SECTION 1: ENABLE POSTGIS FOR GEODESIC CALCULATIONS
-- ===========================================

CREATE EXTENSION IF NOT EXISTS postgis;

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';

-- ===========================================
-- SECTION 2: VEHICLE OBSERVATIONS - EVIDENCE INTEGRITY
-- ===========================================

-- Add evidence integrity columns
ALTER TABLE vehicle_observations_v2
  ADD COLUMN IF NOT EXISTS photo_original_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS photo_original_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS photo_exif JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS device_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS server_received_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS trusted_time_signature TEXT,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS distance_to_zone_m NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS location_confidence TEXT CHECK(location_confidence IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS geom geography(POINT, 4326); -- PostGIS point for real distance calculations

-- Comments explaining Evidence Act 2006 compliance
COMMENT ON COLUMN vehicle_observations_v2.photo_original_sha256 IS 'SHA-256 hash of original photo bytes for authenticity verification (Evidence Act s8)';
COMMENT ON COLUMN vehicle_observations_v2.photo_exif IS 'EXIF metadata from original photo (GPS, device time, camera settings) for reliability assessment';
COMMENT ON COLUMN vehicle_observations_v2.device_time IS 'Device-reported timestamp (may differ from server time due to clock skew)';
COMMENT ON COLUMN vehicle_observations_v2.server_received_at IS 'Trusted server timestamp when evidence was received';
COMMENT ON COLUMN vehicle_observations_v2.trusted_time_signature IS 'HMAC signature of (hash + server_received_at) for Evidence Act machine-generated evidence';
COMMENT ON COLUMN vehicle_observations_v2.gps_accuracy_m IS 'GPS horizontal accuracy in meters (HDOP) for boundary challenge defense';
COMMENT ON COLUMN vehicle_observations_v2.distance_to_zone_m IS 'Calculated distance from GPS point to nearest zone boundary (PostGIS geodesic)';
COMMENT ON COLUMN vehicle_observations_v2.location_confidence IS 'GPS confidence: high (<5m), medium (5-15m), low (>15m) for s30 risk assessment';
COMMENT ON COLUMN vehicle_observations_v2.geom IS 'PostGIS geography point (SRID 4326) for accurate geodesic distance calculations';

-- Performance index for BI/reports
CREATE INDEX IF NOT EXISTS idx_observations_plate_date 
  ON vehicle_observations_v2(plate_number, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_observations_geom
  ON vehicle_observations_v2 USING GIST(geom);

-- ===========================================
-- SECTION 3: COMPLIANCE RESULTS - LEGAL BASIS & PROVENANCE
-- ===========================================

ALTER TABLE compliance_results
  ADD COLUMN IF NOT EXISTS legal_basis TEXT,
  ADD COLUMN IF NOT EXISTS source_docs JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN compliance_results.legal_basis IS 'Legal authority for compliance decision, e.g., "FCA s20(1)(a); Auckland Council Bylaw 2024/12 cl 7.2"';
COMMENT ON COLUMN compliance_results.source_docs IS 'Array of {url, hash, type, effective_date} for bylaw PDFs, notices, signage photos (LGNZ evidentiary requirements)';

-- ===========================================
-- SECTION 4: CHAIN-OF-CUSTODY AUDIT LOG (IMMUTABLE)
-- ===========================================

CREATE TABLE IF NOT EXISTS evidence_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id UUID REFERENCES vehicle_observations_v2(observation_id) ON DELETE CASCADE,
  actor UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('VIEW', 'EXPORT', 'REDACT', 'DELETE_REQUEST', 'PRINT', 'DOWNLOAD', 'SHARE', 'MODIFY')),
  action_details JSONB DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  occurred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_access_log_observation 
  ON evidence_access_log(observation_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_access_log_actor 
  ON evidence_access_log(actor, occurred_at DESC);

COMMENT ON TABLE evidence_access_log IS 'Immutable append-only audit trail for Evidence Act 2006 chain-of-custody requirements (s8 authenticity)';

-- Enable RLS
ALTER TABLE evidence_access_log ENABLE ROW LEVEL SECURITY;

-- System can insert (from application layer)
CREATE POLICY "system_insert_evidence_access_log"
  ON evidence_access_log FOR INSERT
  WITH CHECK (true);

-- Admins can view org evidence access logs
CREATE POLICY "admins_view_evidence_access_log"
  ON evidence_access_log FOR SELECT
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR EXISTS (
        SELECT 1 FROM vehicle_observations_v2 obs
        WHERE obs.observation_id = evidence_access_log.observation_id
        AND obs.organization_id = get_user_organization_id(auth.uid())
      )
    )
  );

-- CRITICAL: Make audit log append-only (prevent tampering)
REVOKE UPDATE, DELETE ON evidence_access_log FROM PUBLIC;

CREATE POLICY "deny_updates_evidence_log"
  ON evidence_access_log FOR UPDATE
  USING (false);

CREATE POLICY "deny_deletes_evidence_log"
  ON evidence_access_log FOR DELETE
  USING (false);

-- ===========================================
-- SECTION 5: ZONES - LEGAL BASIS & EVIDENCE BUNDLE
-- ===========================================

ALTER TABLE zones
  ADD COLUMN IF NOT EXISTS geom geography(POLYGON, 4326), -- PostGIS polygon for real boundary calculations
  ADD COLUMN IF NOT EXISTS bylaw_source_url TEXT,
  ADD COLUMN IF NOT EXISTS bylaw_pdf_hash TEXT,
  ADD COLUMN IF NOT EXISTS bylaw_clause TEXT,
  ADD COLUMN IF NOT EXISTS bylaw_effective_date DATE,
  ADD COLUMN IF NOT EXISTS land_manager TEXT CHECK(land_manager IN ('Council', 'DOC', 'LINZ', 'NZTA', 'Private')),
  ADD COLUMN IF NOT EXISTS enforcement_authority TEXT;

COMMENT ON COLUMN zones.geom IS 'PostGIS geography polygon (SRID 4326) for accurate geodesic boundary distance calculations';
COMMENT ON COLUMN zones.bylaw_source_url IS 'URL to bylaw PDF/regulation source (for LGNZ evidentiary bundle)';
COMMENT ON COLUMN zones.bylaw_pdf_hash IS 'SHA-256 hash of bylaw document for provenance and integrity verification';
COMMENT ON COLUMN zones.bylaw_clause IS 'Specific clause/section (e.g., "Auckland Council Bylaw 2024/12 cl 7.2")';
COMMENT ON COLUMN zones.bylaw_effective_date IS 'Date bylaw restriction became effective (for temporal validity challenges)';
COMMENT ON COLUMN zones.land_manager IS 'Land ownership for jurisdiction: Council/DOC/LINZ (FCA s10-11), NZTA (FCA s10A-10E), Private';
COMMENT ON COLUMN zones.enforcement_authority IS 'Organization/agency authorized to enforce in this zone';

CREATE INDEX IF NOT EXISTS idx_zones_geom
  ON zones USING GIST(geom);

-- ===========================================
-- SECTION 6: ZONE SIGNAGE EVIDENCE (FIRST-CLASS RECORDS)
-- ===========================================

CREATE TABLE IF NOT EXISTS zone_signage_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  photo_sha256 TEXT NOT NULL,
  signage_type TEXT CHECK(signage_type IN ('restriction_notice', 'bylaw_reference', 'prohibitory', 'regulatory', 'warning')),
  captured_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  captured_at TIMESTAMPTZ DEFAULT now(),
  gps_latitude NUMERIC(10,8),
  gps_longitude NUMERIC(11,8),
  notes TEXT,
  is_current BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zone_signage_zone 
  ON zone_signage_evidence(zone_id, is_current);

COMMENT ON TABLE zone_signage_evidence IS 'Signage evidence for bylaw validity challenges (LGNZ guidance requires proof of adequate signposting)';
COMMENT ON COLUMN zone_signage_evidence.photo_sha256 IS 'SHA-256 hash of signage photo for evidence integrity';
COMMENT ON COLUMN zone_signage_evidence.is_current IS 'Whether signage is still in place (track replacement/removal)';

-- Enable RLS
ALTER TABLE zone_signage_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_zone_signage"
  ON zone_signage_evidence FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR EXISTS (
        SELECT 1 FROM zones z
        WHERE z.id = zone_signage_evidence.zone_id
        AND z.organization_id = get_user_organization_id(auth.uid())
      )
    )
  );

CREATE POLICY "users_view_zone_signage"
  ON zone_signage_evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM zones z
      WHERE z.id = zone_signage_evidence.zone_id
      AND (
        get_user_role(auth.uid()) = 'master'
        OR z.organization_id = ANY(get_user_organization_ids())
      )
    )
  );

-- ===========================================
-- SECTION 7: ZONE COMPLIANCE MATRIX - MBIE CSC & FCA
-- ===========================================

ALTER TABLE zone_compliance_matrix
  ADD COLUMN IF NOT EXISTS requires_csc BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS accepted_warrant TEXT CHECK(accepted_warrant IN ('green', 'blue', 'both')) DEFAULT 'green',
  ADD COLUMN IF NOT EXISTS accepted_warrant_effective_from DATE,
  ADD COLUMN IF NOT EXISTS accepted_warrant_effective_to DATE,
  ADD COLUMN IF NOT EXISTS within_town_buffer_m INTEGER,
  ADD COLUMN IF NOT EXISTS enforcement_basis TEXT,
  ADD COLUMN IF NOT EXISTS csc_register_uri TEXT;

COMMENT ON COLUMN zone_compliance_matrix.requires_csc IS 'Self-contained certificate required (MBIE post-2022 changes to FCA)';
COMMENT ON COLUMN zone_compliance_matrix.accepted_warrant IS 'Green (fixed toilet), Blue (portable), or Both (phasing by MBIE timeline)';
COMMENT ON COLUMN zone_compliance_matrix.accepted_warrant_effective_from IS 'Date warrant requirement became effective (blue phase-out tracking)';
COMMENT ON COLUMN zone_compliance_matrix.accepted_warrant_effective_to IS 'Date warrant requirement expires (for policy transitions)';
COMMENT ON COLUMN zone_compliance_matrix.within_town_buffer_m IS 'Distance from town center for buffer zone rules (MBIE guidance)';
COMMENT ON COLUMN zone_compliance_matrix.enforcement_basis IS 'FCA section authorizing enforcement (e.g., "FCA s20(1)(a)")';
COMMENT ON COLUMN zone_compliance_matrix.csc_register_uri IS 'URI to CSC register used to verify certificate status (audit trail)';

-- ===========================================
-- SECTION 8: PHOTO METADATA - EXIF + EVIDENCE INTEGRITY
-- ===========================================

ALTER TABLE photo_metadata
  ADD COLUMN IF NOT EXISTS original_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS exif_data JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS device_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS server_timestamp TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS trusted_signature TEXT,
  ADD COLUMN IF NOT EXISTS is_original BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS parent_photo_id UUID REFERENCES photo_metadata(id) ON DELETE SET NULL;

COMMENT ON COLUMN photo_metadata.original_sha256 IS 'SHA-256 hash of original file bytes (before any processing/watermarking)';
COMMENT ON COLUMN photo_metadata.exif_data IS 'Full EXIF metadata (GPS, device time, camera settings) for Evidence Act reliability';
COMMENT ON COLUMN photo_metadata.device_timestamp IS 'EXIF DateTime extracted from photo (may differ from server time)';
COMMENT ON COLUMN photo_metadata.server_timestamp IS 'Trusted server timestamp when photo was received';
COMMENT ON COLUMN photo_metadata.trusted_signature IS 'HMAC-SHA256 of (original_sha256 || server_timestamp) for Evidence Act authenticity';
COMMENT ON COLUMN photo_metadata.is_original IS 'True if original; false if derived (watermarked/redacted/cropped)';
COMMENT ON COLUMN photo_metadata.parent_photo_id IS 'Links derived photos to original for chain-of-custody';

CREATE INDEX IF NOT EXISTS idx_photo_metadata_parent
  ON photo_metadata(parent_photo_id) WHERE parent_photo_id IS NOT NULL;

-- ===========================================
-- SECTION 9: PRIVACY ACT 2020 COMPLIANCE
-- ===========================================

-- 9.1 Privacy Impact Assessments (PIAs)
CREATE TABLE IF NOT EXISTS privacy_impact_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES zones(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  lawful_basis TEXT NOT NULL,
  signage_deployed BOOLEAN DEFAULT false,
  signage_location TEXT,
  signage_wording_version TEXT,
  retention_period_days INTEGER NOT NULL,
  access_rights_contact TEXT,
  conducted_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  conducted_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  status TEXT CHECK(status IN ('draft', 'approved', 'expired')) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE privacy_impact_assessments IS 'Privacy Act 2020 IPP compliance: purpose limitation, notice, retention (OPC guidance)';
COMMENT ON COLUMN privacy_impact_assessments.signage_location IS 'Physical location where ALPR notice signage is deployed';
COMMENT ON COLUMN privacy_impact_assessments.signage_wording_version IS 'Version of signage text (to prove adequate notice was given)';

CREATE INDEX IF NOT EXISTS idx_pia_org ON privacy_impact_assessments(organization_id);
CREATE INDEX IF NOT EXISTS idx_pia_zone ON privacy_impact_assessments(zone_id);

-- 9.2 Retention Policies (per record type)
CREATE TABLE IF NOT EXISTS retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL CHECK(record_type IN ('observations', 'incidents', 'infringement_notices', 'audit_logs', 'investigation_jobs', 'enforcement_actions')),
  retention_days INTEGER NOT NULL,
  litigation_hold BOOLEAN DEFAULT false,
  auto_purge BOOLEAN DEFAULT true,
  public_records_act_schedule TEXT,
  notes TEXT,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, record_type)
);

COMMENT ON TABLE retention_policies IS 'Privacy Act IPP9 & Public Records Act: configurable retention per record type with litigation hold';
COMMENT ON COLUMN retention_policies.public_records_act_schedule IS 'Reference to approved disposal authority/schedule (for councils)';

CREATE INDEX IF NOT EXISTS idx_retention_policies_org ON retention_policies(organization_id);

-- 9.3 Access Requests (IPP9 - Right to Access)
CREATE TABLE IF NOT EXISTS access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_email TEXT NOT NULL,
  requester_phone TEXT,
  request_type TEXT CHECK(request_type IN ('access', 'correction', 'deletion')) NOT NULL,
  plate_number TEXT,
  date_range_start DATE,
  date_range_end DATE,
  status TEXT CHECK(status IN ('pending', 'approved', 'denied', 'completed', 'withdrawn')) DEFAULT 'pending',
  assigned_to UUID REFERENCES user_profiles(id),
  notes TEXT,
  response_notes TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE access_requests IS 'Privacy Act 2020 IPP9: individuals right to access and correct personal information';

CREATE INDEX IF NOT EXISTS idx_access_requests_org ON access_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);

-- Enable RLS for Privacy tables
ALTER TABLE privacy_impact_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_pia"
  ON privacy_impact_assessments FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
    AND (get_user_role(auth.uid()) = 'master' OR organization_id = get_user_organization_id(auth.uid()))
  );

CREATE POLICY "admins_manage_retention_policies"
  ON retention_policies FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
    AND (get_user_role(auth.uid()) = 'master' OR organization_id = get_user_organization_id(auth.uid()))
  );

CREATE POLICY "admins_manage_access_requests"
  ON access_requests FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
    AND (get_user_role(auth.uid()) = 'master' OR organization_id = get_user_organization_id(auth.uid()))
  );

-- ===========================================
-- SECTION 10: INFRINGEMENT NOTICE GENERATION (FCA-ALIGNED)
-- ===========================================

-- 10.1 Notice Templates (versioned)
CREATE TABLE IF NOT EXISTS notice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  template_type TEXT CHECK(template_type IN ('infringement_notice', 'reminder', 'warning', 'notice_to_vacate')) NOT NULL,
  jurisdiction TEXT, -- 'FCA', 'Council Bylaw', etc.
  
  -- Template Content (FCA s20 + DOC guidance on rights)
  front_content TEXT NOT NULL,
  back_content TEXT NOT NULL, -- Summary of Rights (pay, deny, hearing, timeframes)
  footer TEXT,
  
  -- Versioning
  version INTEGER DEFAULT 1,
  effective_from DATE NOT NULL,
  effective_to DATE,
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  created_by UUID REFERENCES user_profiles(id),
  approved_by UUID REFERENCES user_profiles(id),
  legal_review_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(organization_id, template_name, version)
);

COMMENT ON TABLE notice_templates IS 'FCA-aligned infringement notice templates with statutory summary of rights (s20 form requirements)';
COMMENT ON COLUMN notice_templates.back_content IS 'Summary of rights per FCA/DOC guidance: pay, written submissions, request hearing, timeframes, court costs warning';

CREATE INDEX IF NOT EXISTS idx_notice_templates_org ON notice_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_notice_templates_active ON notice_templates(is_active, effective_from, effective_to);

-- 10.2 Infringement Notices (issued)
CREATE TABLE IF NOT EXISTS infringement_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  observation_id UUID REFERENCES vehicle_observations_v2(observation_id) ON DELETE SET NULL,
  breach_alert_id UUID REFERENCES breach_alerts(id) ON DELETE SET NULL,
  template_id UUID REFERENCES notice_templates(id) ON DELETE SET NULL,
  notice_number TEXT UNIQUE NOT NULL,
  
  -- Offence Details (FCA s20 requirements)
  plate_number TEXT NOT NULL,
  offence_description TEXT NOT NULL,
  legal_basis TEXT NOT NULL, -- e.g., "FCA s20(1)(a); Auckland Council Bylaw 2024/12 cl 7.2"
  offence_date TIMESTAMPTZ NOT NULL,
  offence_location TEXT NOT NULL,
  offence_location_gps TEXT,
  
  -- Fee & Payment
  fee_amount NUMERIC(10,2) NOT NULL,
  payment_methods JSONB DEFAULT '[]'::jsonb, -- ['bank_transfer', 'online', 'in_person']
  payment_deadline DATE NOT NULL,
  payment_reference TEXT,
  
  -- Rights & Service (FCA service methods)
  summary_of_rights TEXT NOT NULL,
  service_method TEXT CHECK(service_method IN ('hand', 'post', 'email')) NOT NULL,
  served_at TIMESTAMPTZ,
  delivery_evidence JSONB DEFAULT '{}'::jsonb, -- {postal_tracking, email_headers, signature}
  recipient_name TEXT,
  recipient_address TEXT,
  recipient_email TEXT,
  
  -- Workflow (mirror Land Transport infringement flow)
  status TEXT CHECK(status IN ('draft', 'issued', 'paid', 'reminder_sent', 'court_referred', 'withdrawn', 'cancelled')) DEFAULT 'draft',
  issued_by UUID REFERENCES user_profiles(id),
  issued_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  court_referral_date DATE,
  withdrawn_reason TEXT,
  
  -- Attachments (evidence bundle)
  notice_pdf_url TEXT,
  notice_pdf_hash TEXT,
  evidence_bundle_url TEXT,
  evidence_bundle_hash TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE infringement_notices IS 'FCA s20 infringement notices with statutory service methods and summary of rights';
COMMENT ON COLUMN infringement_notices.legal_basis IS 'Specific FCA section and/or bylaw clause authorizing the offence';
COMMENT ON COLUMN infringement_notices.summary_of_rights IS 'Statutory summary: right to pay, deny, request hearing, timeframes (DOC template language)';
COMMENT ON COLUMN infringement_notices.delivery_evidence IS 'Service proof: postal tracking, email delivery receipt, hand-delivery signature';
COMMENT ON COLUMN infringement_notices.evidence_bundle_hash IS 'SHA-256 hash of complete evidence PDF (photos, GPS, bylaw, chain-of-custody)';

CREATE INDEX IF NOT EXISTS idx_infringement_notices_plate ON infringement_notices(plate_number);
CREATE INDEX IF NOT EXISTS idx_infringement_notices_status ON infringement_notices(status);
CREATE INDEX IF NOT EXISTS idx_infringement_notices_org ON infringement_notices(organization_id);
CREATE INDEX IF NOT EXISTS idx_infringement_notices_issued_date ON infringement_notices(issued_at DESC);

-- Enable RLS
ALTER TABLE notice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE infringement_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_notice_templates"
  ON notice_templates FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
    AND (get_user_role(auth.uid()) = 'master' OR organization_id = get_user_organization_id(auth.uid()))
  );

CREATE POLICY "admins_manage_infringement_notices"
  ON infringement_notices FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
    AND (get_user_role(auth.uid()) = 'master' OR organization_id = get_user_organization_id(auth.uid()))
  );

CREATE POLICY "officers_view_infringement_notices"
  ON infringement_notices FOR SELECT
  USING (
    organization_id = ANY(get_user_organization_ids())
  );

-- ===========================================
-- SECTION 11: BOUNDARY REVIEW QUEUE (s30 SAFEGUARDS)
-- ===========================================

CREATE TABLE IF NOT EXISTS boundary_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id UUID NOT NULL REFERENCES vehicle_observations_v2(observation_id) ON DELETE CASCADE,
  distance_to_boundary_m NUMERIC(10,2) NOT NULL,
  gps_accuracy_m NUMERIC(10,2),
  confidence TEXT CHECK(confidence IN ('high', 'medium', 'low')),
  flag_reason TEXT NOT NULL CHECK(flag_reason IN ('near_boundary', 'low_gps_accuracy', 'ambiguous_jurisdiction', 'no_signage_evidence')),
  status TEXT CHECK(status IN ('pending', 'approved', 'rejected', 'escalated')) DEFAULT 'pending',
  reviewed_by UUID REFERENCES user_profiles(id),
  reviewed_at TIMESTAMPTZ,
  decision_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE boundary_review_queue IS 'Evidence Act s30 safeguard: review marginal captures to prevent improperly-obtained evidence exclusion';
COMMENT ON COLUMN boundary_review_queue.flag_reason IS 'Why this observation requires human review before enforcement';

CREATE INDEX IF NOT EXISTS idx_boundary_review_queue_status ON boundary_review_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_boundary_review_queue_observation ON boundary_review_queue(observation_id);

-- Enable RLS
ALTER TABLE boundary_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_boundary_review"
  ON boundary_review_queue FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR EXISTS (
        SELECT 1 FROM vehicle_observations_v2 obs
        WHERE obs.observation_id = boundary_review_queue.observation_id
        AND obs.organization_id = get_user_organization_id(auth.uid())
      )
    )
  );

-- ===========================================
-- SECTION 12: TRIGGERS & FUNCTIONS
-- ===========================================

-- 12.1 Calculate Boundary Distance & Confidence (CORRECTED)
CREATE OR REPLACE FUNCTION calculate_boundary_distance()
RETURNS TRIGGER AS $$
DECLARE
  zone_geom geography;
  distance numeric;
BEGIN
  -- Skip if no zone_id or GPS coordinates
  IF NEW.zone_id IS NULL OR NEW.gps_latitude IS NULL OR NEW.gps_longitude IS NULL THEN
    RETURN NEW;
  END IF;

  -- Create PostGIS point from GPS coordinates
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW.gps_longitude, NEW.gps_latitude), 4326)::geography;

  -- Get zone geometry
  SELECT geom INTO zone_geom
  FROM zones
  WHERE id = NEW.zone_id;

  -- Calculate geodesic distance to zone boundary (if zone has geometry)
  IF zone_geom IS NOT NULL THEN
    NEW.distance_to_zone_m := ST_Distance(NEW.geom, ST_Boundary(zone_geom));
  END IF;

  -- Set confidence based on GPS accuracy (CORRECTED COLUMN NAME)
  IF NEW.gps_accuracy_m IS NOT NULL AND NEW.gps_accuracy_m <= 5 THEN
    NEW.location_confidence := 'high';
  ELSIF NEW.gps_accuracy_m > 5 AND NEW.gps_accuracy_m <= 15 THEN
    NEW.location_confidence := 'medium';
  ELSE
    NEW.location_confidence := 'low';
  END IF;

  -- Auto-flag for review if near boundary or low accuracy
  IF (NEW.distance_to_zone_m IS NOT NULL AND NEW.distance_to_zone_m <= 10)
     OR NEW.location_confidence = 'low' THEN
    
    INSERT INTO boundary_review_queue (
      observation_id,
      distance_to_boundary_m,
      gps_accuracy_m,
      confidence,
      flag_reason
    ) VALUES (
      NEW.observation_id,
      NEW.distance_to_zone_m,
      NEW.gps_accuracy_m,
      NEW.location_confidence,
      CASE 
        WHEN NEW.distance_to_zone_m <= 10 THEN 'near_boundary'
        WHEN NEW.location_confidence = 'low' THEN 'low_gps_accuracy'
        ELSE 'ambiguous_jurisdiction'
      END
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_calculate_boundary_distance ON vehicle_observations_v2;
CREATE TRIGGER trigger_calculate_boundary_distance
  BEFORE INSERT OR UPDATE ON vehicle_observations_v2
  FOR EACH ROW
  EXECUTE FUNCTION calculate_boundary_distance();

-- 12.2 Auto-log Evidence Access (placeholder for application layer)
CREATE OR REPLACE FUNCTION log_evidence_view()
RETURNS void AS $$
BEGIN
  -- This will be called from Edge Functions when photos/observations are accessed
  -- Placeholder for now; full implementation in application layer
  RAISE NOTICE 'Evidence access logging should be implemented in Edge Functions';
END;
$$ LANGUAGE plpgsql;

-- 12.3 Update timestamps
DROP TRIGGER IF EXISTS update_infringement_notices_updated_at ON infringement_notices;
CREATE TRIGGER update_infringement_notices_updated_at
  BEFORE UPDATE ON infringement_notices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- SECTION 13: GRANT APPROPRIATE PERMISSIONS
-- ===========================================

-- Evidence access log is append-only (already revoked UPDATE/DELETE above)

-- Templates and notices are admin-managed
GRANT SELECT ON notice_templates TO authenticated;
GRANT SELECT ON infringement_notices TO authenticated;

-- Privacy tables
GRANT SELECT ON privacy_impact_assessments TO authenticated;
GRANT SELECT ON retention_policies TO authenticated;
GRANT SELECT ON access_requests TO authenticated;

-- Boundary review queue
GRANT SELECT ON boundary_review_queue TO authenticated;

-- ===========================================
-- SECTION 14: SUMMARY & VERIFICATION QUERIES
-- ===========================================

COMMENT ON DATABASE postgres IS 'Freedom Camping Manager - Court-defensible evidence architecture per Evidence Act 2006, Privacy Act 2020, Freedom Camping Act 2011';

-- Verification query: Check observations have evidence integrity fields
DO $$
DECLARE
  obs_count INT;
  evidence_count INT;
BEGIN
  SELECT COUNT(*) INTO obs_count FROM vehicle_observations_v2;
  SELECT COUNT(*) INTO evidence_count 
  FROM vehicle_observations_v2 
  WHERE photo_original_sha256 IS NOT NULL;
  
  RAISE NOTICE 'Total observations: %, With evidence integrity: %', obs_count, evidence_count;
END $$;

-- Verification query: Check zones have legal basis
DO $$
DECLARE
  zone_count INT;
  legal_count INT;
BEGIN
  SELECT COUNT(*) INTO zone_count FROM zones WHERE is_active = true;
  SELECT COUNT(*) INTO legal_count 
  FROM zones 
  WHERE is_active = true 
  AND (bylaw_clause IS NOT NULL OR land_manager IS NOT NULL);
  
  RAISE NOTICE 'Active zones: %, With legal basis: %', zone_count, legal_count;
END $$;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

-- This migration establishes:
-- ✅ Evidence Act 2006 compliance (hashing, timestamps, chain-of-custody)
-- ✅ Privacy Act 2020 compliance (PIAs, retention, access requests)
-- ✅ Freedom Camping Act 2011 alignment (CSC, legal basis, infringement notices)
-- ✅ PostGIS geodesic calculations (accurate boundary distances)
-- ✅ Immutable audit trail (Evidence Act authenticity)
-- ✅ s30 safeguards (boundary review queue for marginal captures)
-- ✅ FCA-aligned infringement workflow (service methods, summary of rights)
-- ✅ LGNZ evidentiary requirements (signage, bylaws, source documents)
