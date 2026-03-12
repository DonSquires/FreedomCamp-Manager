-- ============================================
-- LEGACY IMPORT SUPPORT & EVIDENCE STATE TRACKING
-- Preserve historical records while preventing non-evidential enforcement
-- ============================================

-- ===========================================
-- SECTION 1: LEGACY IMPORT CLASSIFICATION
-- ===========================================

-- Add legacy import flags to observations
ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS is_legacy_import BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_state TEXT 
    CHECK(evidence_state IN ('original_present', 'legacy_no_photo', 'reconstructed', 'external_reference'))
    DEFAULT 'original_present',
  ADD COLUMN IF NOT EXISTS legacy_source_tag TEXT,
  ADD COLUMN IF NOT EXISTS legacy_note TEXT,
  ADD COLUMN IF NOT EXISTS external_evidence_uri TEXT,
  ADD COLUMN IF NOT EXISTS external_evidence_hash TEXT;

COMMENT ON COLUMN observations.is_legacy_import IS 'True if imported from pre-photo-first system (v1 export, historical data)';
COMMENT ON COLUMN observations.evidence_state IS 'Evidence quality: original_present (court-ready), legacy_no_photo (non-enforceable), reconstructed (derived only), external_reference (3rd-party proof)';
COMMENT ON COLUMN observations.legacy_source_tag IS 'Source identifier for legacy import (e.g., "v1_export_2024Q4", "manual_migration_2025")';
COMMENT ON COLUMN observations.legacy_note IS 'Free text explanation: where photo went missing, why no original, recovery attempts made';
COMMENT ON COLUMN observations.external_evidence_uri IS 'URI to external evidence when original photo unavailable (scanned paper notice, 3rd-party docket)';
COMMENT ON COLUMN observations.external_evidence_hash IS 'SHA-256 hash of external evidence document (for integrity)';

-- Create indexes for filtering/reporting
CREATE INDEX IF NOT EXISTS idx_obs_legacy_import 
  ON observations(is_legacy_import, evidence_state) 
  WHERE is_legacy_import = true;

CREATE INDEX IF NOT EXISTS idx_obs_evidence_state 
  ON observations(evidence_state, organization_id);

-- ===========================================
-- SECTION 2: AUTO-SET EVIDENCE STATE ON INSERT
-- ===========================================

-- Function to set evidence_state based on photo presence
CREATE OR REPLACE FUNCTION set_evidence_state()
RETURNS TRIGGER AS $$
BEGIN
  -- If explicitly set, don't override
  IF NEW.evidence_state IS NOT NULL AND NEW.evidence_state != 'original_present' THEN
    RETURN NEW;
  END IF;

  -- Set based on photo availability
  IF NEW.photo_original_sha256 IS NOT NULL AND NEW.photo_original_bytes > 0 THEN
    NEW.evidence_state := 'original_present';
    -- Clear review_blocked if evidence present (unless manually set)
    IF NEW.review_blocked IS NULL THEN
      NEW.review_blocked := false;
    END IF;
  ELSIF NEW.is_legacy_import = true THEN
    -- Legacy import without photo
    IF NEW.external_evidence_uri IS NOT NULL THEN
      NEW.evidence_state := 'external_reference';
    ELSE
      NEW.evidence_state := 'legacy_no_photo';
    END IF;
    -- Block review for non-evidential legacy records
    NEW.review_blocked := true;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_evidence_state ON observations;
CREATE TRIGGER trigger_set_evidence_state
  BEFORE INSERT OR UPDATE ON observations
  FOR EACH ROW
  EXECUTE FUNCTION set_evidence_state();

-- ===========================================
-- SECTION 3: LEGACY EVIDENCE REVIEW REGISTRY
-- ===========================================

CREATE TABLE IF NOT EXISTS legacy_evidence_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id UUID NOT NULL REFERENCES observations(observation_id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  
  -- Review Decision
  decision TEXT CHECK(decision IN ('insufficient', 'acceptable_for_context', 'acceptable_for_enforcement')) NOT NULL,
  rationale TEXT NOT NULL,
  
  -- What was reviewed
  evidence_type TEXT CHECK(evidence_type IN ('external_document', 'reconstructed_photo', 'witness_statement', 'officer_report')),
  evidence_uri TEXT,
  evidence_hash TEXT,
  
  -- Approval chain
  legal_approval_required BOOLEAN DEFAULT false,
  legal_approved_by UUID REFERENCES user_profiles(id),
  legal_approved_at TIMESTAMPTZ,
  
  decided_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE legacy_evidence_reviews IS 'Legal review register for legacy observations with non-standard evidence (Evidence Act s30 safeguard)';
COMMENT ON COLUMN legacy_evidence_reviews.decision IS 'insufficient: remains non-enforceable; acceptable_for_context: reporting only; acceptable_for_enforcement: legal approved for limited use';
COMMENT ON COLUMN legacy_evidence_reviews.legal_approval_required IS 'True if decision = acceptable_for_enforcement (requires legal sign-off)';

CREATE INDEX IF NOT EXISTS idx_legacy_evidence_reviews_observation 
  ON legacy_evidence_reviews(observation_id);

CREATE INDEX IF NOT EXISTS idx_legacy_evidence_reviews_decision 
  ON legacy_evidence_reviews(decision, decided_at DESC);

-- Enable RLS
ALTER TABLE legacy_evidence_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_legacy_reviews"
  ON legacy_evidence_reviews FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR EXISTS (
        SELECT 1 FROM observations obs
        WHERE obs.observation_id = legacy_evidence_reviews.observation_id
        AND obs.organization_id = get_user_organization_id(auth.uid())
      )
    )
  );

-- ===========================================
-- SECTION 4: REPORTING VIEWS
-- ===========================================

-- 4.1 Legacy Import Summary
CREATE OR REPLACE VIEW legacy_import_summary AS
SELECT 
  o.organization_id,
  org.name AS organization_name,
  COUNT(*) AS total_legacy_observations,
  COUNT(CASE WHEN o.evidence_state = 'original_present' THEN 1 END) AS recovered_originals,
  COUNT(CASE WHEN o.evidence_state = 'legacy_no_photo' THEN 1 END) AS missing_photos,
  COUNT(CASE WHEN o.evidence_state = 'reconstructed' THEN 1 END) AS reconstructed_only,
  COUNT(CASE WHEN o.evidence_state = 'external_reference' THEN 1 END) AS external_evidence,
  COUNT(CASE WHEN o.review_blocked = true THEN 1 END) AS review_blocked,
  ROUND(100.0 * COUNT(CASE WHEN o.evidence_state = 'original_present' THEN 1 END) / NULLIF(COUNT(*), 0), 2) AS recovery_rate_pct,
  MIN(o.recorded_at) AS oldest_legacy_observation,
  MAX(o.recorded_at) AS newest_legacy_observation
FROM observations o
JOIN organizations org ON org.id = o.organization_id
WHERE o.is_legacy_import = true
GROUP BY o.organization_id, org.name
ORDER BY total_legacy_observations DESC;

COMMENT ON VIEW legacy_import_summary IS 'Legacy import health per organization: recovery rates, evidence states, backlog tracking';

-- 4.2 Evidence State Distribution
CREATE OR REPLACE VIEW evidence_state_distribution AS
SELECT 
  evidence_state,
  is_legacy_import,
  COUNT(*) AS observation_count,
  COUNT(CASE WHEN review_blocked = true THEN 1 END) AS blocked_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) AS percentage_of_total
FROM observations
GROUP BY evidence_state, is_legacy_import
ORDER BY observation_count DESC;

COMMENT ON VIEW evidence_state_distribution IS 'Overall evidence quality distribution: live vs legacy, enforceable vs blocked';

-- 4.3 Legacy Recovery Opportunities
CREATE OR REPLACE VIEW legacy_recovery_opportunities AS
SELECT 
  o.observation_id,
  o.organization_id,
  o.plate_number,
  o.recorded_at,
  o.evidence_state,
  o.legacy_source_tag,
  o.legacy_note,
  cv.last_seen_at AS vehicle_last_seen,
  CASE 
    WHEN cv.last_seen_at >= now() - INTERVAL '30 days' THEN 'active_vehicle'
    WHEN cv.total_breaches > 5 THEN 'frequent_offender'
    WHEN o.recorded_at >= now() - INTERVAL '90 days' THEN 'recent_legacy'
    ELSE 'low_priority'
  END AS recovery_priority
FROM observations o
LEFT JOIN canonical_vehicles cv ON cv.plate_number = o.plate_number
WHERE 
  o.is_legacy_import = true
  AND o.evidence_state = 'legacy_no_photo'
  AND o.review_blocked = true
ORDER BY 
  CASE 
    WHEN cv.last_seen_at >= now() - INTERVAL '30 days' THEN 1
    WHEN cv.total_breaches > 5 THEN 2
    WHEN o.recorded_at >= now() - INTERVAL '90 days' THEN 3
    ELSE 4
  END,
  o.recorded_at DESC;

COMMENT ON VIEW legacy_recovery_opportunities IS 'Priority queue for legacy photo recovery: active vehicles, frequent offenders, recent imports';

-- ===========================================
-- SECTION 5: ENFORCEMENT GUARDS (FUNCTION)
-- ===========================================

-- Function to check if observation is enforceable
CREATE OR REPLACE FUNCTION is_observation_enforceable(obs_id UUID)
RETURNS JSONB AS $$
DECLARE
  obs_record RECORD;
  review_record RECORD;
  result JSONB;
BEGIN
  -- Get observation
  SELECT 
    observation_id,
    is_legacy_import,
    evidence_state,
    review_blocked,
    photo_original_sha256,
    plate_number
  INTO obs_record
  FROM observations
  WHERE observation_id = obs_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'enforceable', false,
      'reason', 'observation_not_found'
    );
  END IF;

  -- Primary check: evidence state must be original_present
  IF obs_record.evidence_state != 'original_present' THEN
    RETURN jsonb_build_object(
      'enforceable', false,
      'reason', 'insufficient_evidence',
      'evidence_state', obs_record.evidence_state,
      'is_legacy', obs_record.is_legacy_import,
      'message', 'Observation lacks original photo evidence. Cannot proceed with enforcement action.'
    );
  END IF;

  -- Check for review block
  IF obs_record.review_blocked = true THEN
    RETURN jsonb_build_object(
      'enforceable', false,
      'reason', 'review_blocked',
      'message', 'Observation flagged for admin review (boundary/accuracy concern). Cannot proceed until reviewed.'
    );
  END IF;

  -- Check for legal review on legacy evidence (if applicable)
  IF obs_record.is_legacy_import = true AND obs_record.evidence_state = 'external_reference' THEN
    SELECT * INTO review_record
    FROM legacy_evidence_reviews
    WHERE observation_id = obs_id
    AND decision = 'acceptable_for_enforcement'
    AND legal_approved_at IS NOT NULL
    ORDER BY decided_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'enforceable', false,
        'reason', 'external_evidence_not_approved',
        'message', 'External evidence requires legal approval before enforcement.'
      );
    END IF;
  END IF;

  -- All checks passed
  RETURN jsonb_build_object(
    'enforceable', true,
    'observation_id', obs_record.observation_id,
    'plate_number', obs_record.plate_number,
    'evidence_state', obs_record.evidence_state
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION is_observation_enforceable IS 'Check if observation meets enforcement requirements (original photo + not blocked + legal review if legacy)';

-- ===========================================
-- SECTION 6: LEGACY BREACH ALERT FILTERING
-- ===========================================

-- Update breach alert creation trigger to skip legacy non-evidential observations
CREATE OR REPLACE FUNCTION prevent_legacy_breach_alerts()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip breach alert creation for legacy observations without original photos
  IF EXISTS (
    SELECT 1 FROM observations
    WHERE observation_id = NEW.observation_id
    AND is_legacy_import = true
    AND evidence_state != 'original_present'
  ) THEN
    RAISE NOTICE 'Skipping breach alert for legacy non-evidential observation: %', NEW.observation_id;
    RETURN NULL; -- Don't create breach alert
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_legacy_breach_alerts ON breach_alerts;
CREATE TRIGGER trigger_prevent_legacy_breach_alerts
  BEFORE INSERT ON breach_alerts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_legacy_breach_alerts();

-- ===========================================
-- SECTION 7: GRANT PERMISSIONS
-- ===========================================

GRANT SELECT ON legacy_import_summary TO authenticated;
GRANT SELECT ON evidence_state_distribution TO authenticated;
GRANT SELECT ON legacy_recovery_opportunities TO authenticated;

-- ===========================================
-- SECTION 8: MIGRATION VERIFICATION
-- ===========================================

DO $$
DECLARE
  total_obs INT;
  legacy_obs INT;
  enforceable_obs INT;
BEGIN
  SELECT COUNT(*) INTO total_obs FROM observations;
  SELECT COUNT(*) INTO legacy_obs FROM observations WHERE is_legacy_import = true;
  SELECT COUNT(*) INTO enforceable_obs FROM observations WHERE evidence_state = 'original_present' AND review_blocked = false;
  
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'LEGACY IMPORT SUPPORT ENABLED';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Total observations: %', total_obs;
  RAISE NOTICE 'Legacy imports: %', legacy_obs;
  RAISE NOTICE 'Enforceable (original photo present): %', enforceable_obs;
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'STATUS: Ready for legacy data import ✓';
  RAISE NOTICE 'Next: Run ETL Pass A (import core records)';
  RAISE NOTICE 'Then: Run ETL Pass B (recover evidence)';
END $$;

-- ============================================
-- MIGRATION COMPLETE: LEGACY IMPORT SUPPORT
-- ============================================

-- This migration establishes:
-- ✅ Legacy import classification (is_legacy_import flag)
-- ✅ Evidence state tracking (original_present, legacy_no_photo, reconstructed, external_reference)
-- ✅ Review blocking (prevent enforcement on non-evidential records)
-- ✅ Legal review registry (for exceptional external evidence approval)
-- ✅ Reporting views (recovery rates, opportunities, evidence distribution)
-- ✅ Enforcement guards (is_observation_enforceable function)
-- ✅ Breach alert filtering (skip legacy non-evidential observations)

-- NEXT STEPS:
-- 1. Deploy this migration
-- 2. Run ETL Pass A: Import legacy observations (set is_legacy_import=true, evidence_state='legacy_no_photo')
-- 3. Run ETL Pass B: Attempt photo recovery from old storage
-- 4. Enable UI badges and export warnings for legacy records
-- 5. Configure enforcement API to use is_observation_enforceable() guard
