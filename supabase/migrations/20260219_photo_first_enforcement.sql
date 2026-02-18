-- ============================================
-- PHOTO-FIRST ENFORCEMENT & RECONCILIATION
-- Zero-loss photo retention: No observation without verifiable original photo
-- ============================================

-- ===========================================
-- SECTION 1: PHOTO HASH INDEXING (PERFORMANCE)
-- ===========================================

-- Fast lookup for photo hash verification
CREATE INDEX IF NOT EXISTS idx_obs_photo_hash 
  ON vehicle_observations_v2(photo_original_sha256) 
  WHERE photo_original_sha256 IS NOT NULL;

-- Fast lookup for review UI (org + date)
CREATE INDEX IF NOT EXISTS idx_obs_org_date 
  ON vehicle_observations_v2(organization_id, recorded_at DESC);

-- Fast lookup for photo-less observations (temporary, for backfill)
CREATE INDEX IF NOT EXISTS idx_obs_missing_photo 
  ON vehicle_observations_v2(organization_id, recorded_at DESC) 
  WHERE photo_original_sha256 IS NULL;

-- ===========================================
-- SECTION 2: MISSING PHOTO RECONCILIATION QUEUE
-- ===========================================

CREATE TABLE IF NOT EXISTS missing_photo_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id UUID NOT NULL REFERENCES vehicle_observations_v2(observation_id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plate_number TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,
  
  -- Diagnosis
  reason TEXT NOT NULL CHECK(reason IN ('null_hash', 'object_404', 'hash_mismatch', 'legacy_path', 'unknown')),
  original_photo_url TEXT, -- If found in legacy bucket/path
  attempted_hash TEXT, -- Hash calculated from found file
  
  -- Recovery Status
  status TEXT CHECK(status IN ('pending', 'repairing', 'fixed', 'manual_required', 'abandoned')) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  repair_notes TEXT,
  
  -- Assignment
  assigned_to UUID REFERENCES user_profiles(id),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_missing_photo_queue_status 
  ON missing_photo_queue(status, created_at);

CREATE INDEX IF NOT EXISTS idx_missing_photo_queue_org 
  ON missing_photo_queue(organization_id, status);

COMMENT ON TABLE missing_photo_queue IS 'Reconciliation queue for observations missing verifiable original photos (Evidence Act integrity)';
COMMENT ON COLUMN missing_photo_queue.reason IS 'Why photo is missing: null_hash (never uploaded), object_404 (storage lost), hash_mismatch (corruption), legacy_path (old build), unknown';

-- Enable RLS
ALTER TABLE missing_photo_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_missing_photo_queue"
  ON missing_photo_queue FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
    AND (get_user_role(auth.uid()) = 'master' OR organization_id = get_user_organization_id(auth.uid()))
  );

-- ===========================================
-- SECTION 3: REVIEW BLOCKING (SOFT GUARDRAIL)
-- ===========================================

-- Flag observations that cannot proceed to enforcement until photo verified
ALTER TABLE vehicle_observations_v2
  ADD COLUMN IF NOT EXISTS review_blocked BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_obs_review_blocked 
  ON vehicle_observations_v2(review_blocked, organization_id) 
  WHERE review_blocked = true;

COMMENT ON COLUMN vehicle_observations_v2.review_blocked IS 'Soft block: observation exists but cannot proceed to enforcement until photo verified (UI guardrail)';

-- ===========================================
-- SECTION 4: NZSCV WARRANT CACHE (LIVE VALIDATION)
-- ===========================================

CREATE TABLE IF NOT EXISTS nzscv_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number TEXT NOT NULL,
  
  -- Warrant Details
  warrant_type TEXT CHECK(warrant_type IN ('green', 'blue', 'none', 'expired', 'invalid')) NOT NULL,
  warrant_number TEXT,
  warrant_issuer TEXT,
  issued_date DATE,
  expires_on DATE,
  
  -- Source & Verification
  source_uri TEXT, -- NZSCV API endpoint/register used
  verified_at TIMESTAMPTZ NOT NULL,
  verification_method TEXT CHECK(verification_method IN ('api', 'manual', 'document_upload', 'cached')) DEFAULT 'api',
  
  -- Raw Response (for audit)
  raw_response JSONB,
  
  -- Cache Management
  is_current BOOLEAN DEFAULT true,
  cache_expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(plate_number, warrant_number)
);

CREATE INDEX IF NOT EXISTS idx_nzscv_cache_plate 
  ON nzscv_cache(plate_number, is_current, cache_expires_at);

CREATE INDEX IF NOT EXISTS idx_nzscv_cache_expires 
  ON nzscv_cache(cache_expires_at) 
  WHERE is_current = true;

COMMENT ON TABLE nzscv_cache IS 'NZSCV (Self-Contained Vehicle) warrant cache for compliance checks with source documentation (MBIE FCA requirements)';
COMMENT ON COLUMN nzscv_cache.source_uri IS 'URI to NZSCV register/API used at time of verification (Evidence Act provenance)';
COMMENT ON COLUMN nzscv_cache.cache_expires_at IS 'Cache validity period (default 7 days); refresh before expiry for active cases';

-- Enable RLS
ALTER TABLE nzscv_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_manage_nzscv_cache"
  ON nzscv_cache FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "users_view_nzscv_cache"
  ON nzscv_cache FOR SELECT
  USING (true);

-- ===========================================
-- SECTION 5: PHOTO BYTES VALIDATION
-- ===========================================

-- Ensure photo_original_bytes is positive if set
ALTER TABLE vehicle_observations_v2
  ADD CONSTRAINT IF NOT EXISTS chk_photo_bytes_positive
  CHECK (photo_original_bytes IS NULL OR photo_original_bytes > 0);

-- ===========================================
-- SECTION 6: IDEMPOTENCY TRACKING (PREVENT DUPLICATES)
-- ===========================================

CREATE TABLE IF NOT EXISTS scan_idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  observation_id UUID REFERENCES vehicle_observations_v2(observation_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  local_capture_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_scan_idempotency_expires 
  ON scan_idempotency_keys(expires_at);

COMMENT ON TABLE scan_idempotency_keys IS 'Prevent duplicate observations from retry/offline queue (keyed by deviceId:localCaptureId)';

-- Cleanup expired keys daily
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS void AS $$
BEGIN
  DELETE FROM scan_idempotency_keys
  WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- SECTION 7: BACKFILL DETECTION FUNCTION
-- ===========================================

-- Function to detect orphaned observations (missing photos)
CREATE OR REPLACE FUNCTION detect_missing_photos()
RETURNS TABLE(
  observation_id UUID,
  organization_id UUID,
  plate_number TEXT,
  recorded_at TIMESTAMPTZ,
  reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    obs.observation_id,
    obs.organization_id,
    obs.plate_number,
    obs.recorded_at,
    CASE 
      WHEN obs.photo_original_sha256 IS NULL THEN 'null_hash'
      WHEN obs.photo_original_bytes IS NULL THEN 'null_hash'
      WHEN obs.photo_original_bytes <= 0 THEN 'null_hash'
      ELSE 'unknown'
    END AS reason
  FROM vehicle_observations_v2 obs
  WHERE 
    obs.photo_original_sha256 IS NULL
    OR obs.photo_original_bytes IS NULL
    OR obs.photo_original_bytes <= 0
  ORDER BY obs.recorded_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION detect_missing_photos IS 'Detect observations missing verifiable original photos (for backfill job)';

-- ===========================================
-- SECTION 8: PHOTO VERIFICATION FUNCTION
-- ===========================================

-- Function to verify photo exists and matches hash
CREATE OR REPLACE FUNCTION verify_observation_photo(obs_id UUID)
RETURNS JSONB AS $$
DECLARE
  obs_record RECORD;
  result JSONB;
BEGIN
  -- Get observation details
  SELECT 
    observation_id,
    photo_original_sha256,
    photo_original_bytes,
    photo_url,
    review_blocked
  INTO obs_record
  FROM vehicle_observations_v2
  WHERE observation_id = obs_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'observation_not_found'
    );
  END IF;

  -- Check hash exists
  IF obs_record.photo_original_sha256 IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'null_hash',
      'observation_id', obs_id,
      'review_blocked', obs_record.review_blocked
    );
  END IF;

  -- Check bytes positive
  IF obs_record.photo_original_bytes IS NULL OR obs_record.photo_original_bytes <= 0 THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'invalid_bytes',
      'observation_id', obs_id,
      'review_blocked', obs_record.review_blocked
    );
  END IF;

  -- Note: Storage HEAD check must be done in Edge Function
  RETURN jsonb_build_object(
    'valid', true,
    'observation_id', obs_id,
    'hash', obs_record.photo_original_sha256,
    'bytes', obs_record.photo_original_bytes,
    'photo_url', obs_record.photo_url,
    'review_blocked', obs_record.review_blocked
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION verify_observation_photo IS 'Verify observation has valid photo hash and bytes (application layer must verify storage HEAD)';

-- ===========================================
-- SECTION 9: NZSCV CACHE LOOKUP FUNCTION
-- ===========================================

CREATE OR REPLACE FUNCTION get_nzscv_warrant(p_plate_number TEXT)
RETURNS TABLE(
  warrant_type TEXT,
  warrant_number TEXT,
  expires_on DATE,
  is_valid BOOLEAN,
  source_uri TEXT,
  verified_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    nc.warrant_type,
    nc.warrant_number,
    nc.expires_on,
    CASE 
      WHEN nc.warrant_type = 'none' THEN false
      WHEN nc.warrant_type = 'expired' THEN false
      WHEN nc.warrant_type = 'invalid' THEN false
      WHEN nc.expires_on < CURRENT_DATE THEN false
      ELSE true
    END AS is_valid,
    nc.source_uri,
    nc.verified_at
  FROM nzscv_cache nc
  WHERE 
    nc.plate_number = p_plate_number
    AND nc.is_current = true
    AND nc.cache_expires_at > now()
  ORDER BY nc.verified_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_nzscv_warrant IS 'Get current NZSCV warrant for plate (checks cache expiry and warrant validity)';

-- ===========================================
-- SECTION 10: MONITORING VIEWS
-- ===========================================

-- Photo integrity health view
CREATE OR REPLACE VIEW photo_integrity_health AS
SELECT 
  o.organization_id,
  org.name AS organization_name,
  COUNT(*) AS total_observations,
  COUNT(o.photo_original_sha256) AS with_hash,
  COUNT(*) - COUNT(o.photo_original_sha256) AS missing_hash,
  COUNT(CASE WHEN o.review_blocked = true THEN 1 END) AS review_blocked,
  ROUND(100.0 * COUNT(o.photo_original_sha256) / NULLIF(COUNT(*), 0), 2) AS hash_coverage_pct,
  MAX(o.recorded_at) AS latest_observation
FROM vehicle_observations_v2 o
JOIN organizations org ON org.id = o.organization_id
GROUP BY o.organization_id, org.name
ORDER BY missing_hash DESC;

COMMENT ON VIEW photo_integrity_health IS 'Photo integrity monitoring per organization (SLO: ≥99.95% hash coverage)';

-- Recent observations photo status
CREATE OR REPLACE VIEW recent_observations_photo_status AS
SELECT 
  o.observation_id,
  o.organization_id,
  o.plate_number,
  o.recorded_at,
  o.photo_original_sha256 IS NOT NULL AS has_hash,
  o.photo_original_bytes > 0 AS has_valid_bytes,
  o.review_blocked,
  CASE 
    WHEN o.photo_original_sha256 IS NULL THEN 'missing_hash'
    WHEN o.photo_original_bytes IS NULL OR o.photo_original_bytes <= 0 THEN 'invalid_bytes'
    WHEN o.review_blocked = true THEN 'blocked'
    ELSE 'ok'
  END AS status
FROM vehicle_observations_v2 o
WHERE o.recorded_at >= now() - INTERVAL '7 days'
ORDER BY o.recorded_at DESC;

COMMENT ON VIEW recent_observations_photo_status IS 'Photo status for last 7 days (for continuous reconciler monitoring)';

-- ===========================================
-- SECTION 11: TRIGGERS
-- ===========================================

-- Update timestamps
DROP TRIGGER IF EXISTS update_missing_photo_queue_updated_at ON missing_photo_queue;
CREATE TRIGGER update_missing_photo_queue_updated_at
  BEFORE UPDATE ON missing_photo_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_nzscv_cache_updated_at ON nzscv_cache;
CREATE TRIGGER update_nzscv_cache_updated_at
  BEFORE UPDATE ON nzscv_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- SECTION 12: GRANT PERMISSIONS
-- ===========================================

GRANT SELECT ON photo_integrity_health TO authenticated;
GRANT SELECT ON recent_observations_photo_status TO authenticated;

-- ===========================================
-- SECTION 13: MIGRATION VERIFICATION
-- ===========================================

-- Check current photo coverage
DO $$
DECLARE
  total_count INT;
  with_hash INT;
  missing_hash INT;
  coverage_pct NUMERIC;
BEGIN
  SELECT 
    COUNT(*),
    COUNT(photo_original_sha256),
    COUNT(*) - COUNT(photo_original_sha256)
  INTO total_count, with_hash, missing_hash
  FROM vehicle_observations_v2;
  
  IF total_count > 0 THEN
    coverage_pct := ROUND(100.0 * with_hash / total_count, 2);
  ELSE
    coverage_pct := 100.0;
  END IF;
  
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'PHOTO INTEGRITY STATUS';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Total observations: %', total_count;
  RAISE NOTICE 'With photo hash: %', with_hash;
  RAISE NOTICE 'Missing hash: %', missing_hash;
  RAISE NOTICE 'Coverage: %% (Target: ≥99.95%%)', coverage_pct;
  RAISE NOTICE '===========================================';
  
  IF missing_hash > 0 THEN
    RAISE NOTICE 'ACTION REQUIRED: Run backfill script to reconcile % orphaned observations', missing_hash;
  ELSE
    RAISE NOTICE 'STATUS: All observations have verifiable photos ✓';
  END IF;
END $$;

-- ============================================
-- MIGRATION COMPLETE: PHOTO-FIRST ENFORCEMENT
-- ============================================

-- This migration establishes:
-- ✅ Photo hash indexing for fast verification
-- ✅ Missing photo reconciliation queue
-- ✅ Review blocking soft guardrail
-- ✅ NZSCV warrant cache with source documentation
-- ✅ Photo bytes validation constraint
-- ✅ Idempotency key tracking (prevent duplicates)
-- ✅ Backfill detection function
-- ✅ Photo verification function
-- ✅ NZSCV warrant lookup function
-- ✅ Monitoring views (photo_integrity_health, recent_observations_photo_status)

-- NEXT STEPS:
-- 1. Deploy this migration
-- 2. Run backfill script to populate missing_photo_queue
-- 3. Reconcile orphaned observations (manual or automated)
-- 4. AFTER backfill complete: Run 20260219_enforce_photo_not_null.sql
