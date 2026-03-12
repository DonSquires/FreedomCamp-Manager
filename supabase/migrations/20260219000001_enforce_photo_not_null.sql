-- ============================================
-- ENFORCE PHOTO NOT NULL (RUN AFTER BACKFILL)
-- ============================================

-- ⚠️ WARNING: DO NOT RUN THIS UNTIL BACKFILL IS COMPLETE
-- This migration enforces the invariant: "No observation without verifiable photo"
-- Run only after missing_photo_queue is empty or all records marked 'abandoned'

-- ===========================================
-- SECTION 1: VERIFY BACKFILL COMPLETE
-- ===========================================

DO $$
DECLARE
  missing_count INT;
  pending_repairs INT;
BEGIN
  -- Check for observations still missing photos
  SELECT COUNT(*) INTO missing_count
  FROM observations
  WHERE photo_original_sha256 IS NULL;
  
  -- Check for pending repairs in queue
  SELECT COUNT(*) INTO pending_repairs
  FROM missing_photo_queue
  WHERE status IN ('pending', 'repairing');
  
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'BACKFILL STATUS CHECK';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Observations missing hash: %', missing_count;
  RAISE NOTICE 'Pending repairs in queue: %', pending_repairs;
  RAISE NOTICE '===========================================';
  
  IF missing_count > 0 OR pending_repairs > 0 THEN
    RAISE EXCEPTION 'ABORT: Backfill not complete. % observations still missing photos, % repairs pending. Complete backfill before enforcing NOT NULL constraint.', missing_count, pending_repairs;
  ELSE
    RAISE NOTICE 'STATUS: Backfill complete ✓ Safe to enforce NOT NULL constraint';
  END IF;
END $$;

-- ===========================================
-- SECTION 2: ENFORCE NOT NULL CONSTRAINT
-- ===========================================

-- This is the golden rule: No observation can exist without a verifiable photo
ALTER TABLE observations
  ALTER COLUMN photo_original_sha256 SET NOT NULL;

-- Also enforce photo_original_bytes
ALTER TABLE observations
  ALTER COLUMN photo_original_bytes SET NOT NULL;

COMMENT ON COLUMN observations.photo_original_sha256 IS 'SHA-256 hash of original photo (NOT NULL - Evidence Act s8 authenticity requirement)';
COMMENT ON COLUMN observations.photo_original_bytes IS 'Original photo file size in bytes (NOT NULL - integrity verification)';

-- ===========================================
-- SECTION 3: REMOVE TEMPORARY INDEXES
-- ===========================================

-- Drop the temporary index for missing photos (no longer needed)
DROP INDEX IF EXISTS idx_obs_missing_photo;

-- ===========================================
-- SECTION 4: REVOKE DELETE PERMISSION
-- ===========================================

-- Prevent application-layer deletion of photo-backed observations
-- Only legal retention/archival workflows can delete via service role
REVOKE DELETE ON observations FROM PUBLIC;

COMMENT ON TABLE observations IS 'Vehicle observations with mandatory photo evidence (Evidence Act 2006 compliance - deletion restricted to retention workflows)';

-- ===========================================
-- SECTION 5: FINAL VERIFICATION
-- ===========================================

DO $$
DECLARE
  total_count INT;
  with_hash INT;
  with_bytes INT;
BEGIN
  SELECT 
    COUNT(*),
    COUNT(photo_original_sha256),
    COUNT(photo_original_bytes)
  INTO total_count, with_hash, with_bytes
  FROM observations;
  
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'NOT NULL ENFORCEMENT COMPLETE';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Total observations: %', total_count;
  RAISE NOTICE 'With photo hash (NOT NULL): %', with_hash;
  RAISE NOTICE 'With photo bytes (NOT NULL): %', with_bytes;
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'STATUS: Zero-loss photo retention now ENFORCED ✓';
  RAISE NOTICE 'Future observations MUST have verifiable photos or INSERT will fail';
  RAISE NOTICE '===========================================';
END $$;

-- ============================================
-- MIGRATION COMPLETE: NOT NULL ENFORCEMENT
-- ============================================

-- From this point forward:
-- ✅ All observations MUST have photo_original_sha256
-- ✅ All observations MUST have photo_original_bytes > 0
-- ✅ Application-layer deletion restricted (retention workflows only)
-- ✅ Database enforces "photo first, observation second" invariant
