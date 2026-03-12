-- ============================================================================
-- Fix observations table: add legacy-import columns + idempotency_key nullable
-- Date: 2026-03-20
--
-- Problem:
--   The 20260221_rebuild_observations_clean.sql migration created a new
--   `observations` table but did NOT include the legacy-import tracking
--   columns that had been added to `observations` in
--   20260219000003_legacy_import_support.sql.  Those columns were referenced
--   by the import-historical-data Edge Function, causing every historical
--   import to fail with "column does not exist" or NOT NULL violations.
--
-- Additionally, `idempotency_key` is defined as UNIQUE NOT NULL but the
--   import function did not supply a value.  We make it nullable so that
--   legacy/imported observations (which have no device idempotency key) can
--   be inserted, while keeping the UNIQUE constraint to prevent accidental
--   duplicates when the field IS provided.
--
-- Changes:
--   1. Add legacy-import tracking columns (all safe with IF NOT EXISTS).
--   2. Make idempotency_key nullable (DROP NOT NULL only; UNIQUE kept).
--   3. Add partial index so UNIQUE still prevents duplicates on non-NULL keys.
--   4. Add `source_observation_id` to record the old UUID if one is ever
--      preserved from an external system (audit trail).
--   5. Verification block.
-- ============================================================================

-- ── 1. Legacy-import tracking columns ────────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS is_legacy_import     BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_state       TEXT
    CHECK (evidence_state IS NULL OR evidence_state IN (
      'original_present', 'legacy_no_photo', 'reconstructed', 'external_reference'
    )),
  ADD COLUMN IF NOT EXISTS legacy_source_tag    TEXT,
  ADD COLUMN IF NOT EXISTS legacy_note          TEXT,
  ADD COLUMN IF NOT EXISTS has_notes            BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_homeless_claim   BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS homeless_claim_notes TEXT,
  ADD COLUMN IF NOT EXISTS review_blocked       BOOLEAN   DEFAULT false;

COMMENT ON COLUMN public.observations.is_legacy_import     IS 'TRUE when row was imported from historical/Excel data (not a live officer scan)';
COMMENT ON COLUMN public.observations.evidence_state       IS 'Evidence quality: original_present (photo in bucket), legacy_no_photo (import – no photo), reconstructed (derived), external_reference (3rd-party doc)';
COMMENT ON COLUMN public.observations.legacy_source_tag    IS 'Import batch identifier, e.g. "excel_import" or "v1_export_2024Q4"';
COMMENT ON COLUMN public.observations.legacy_note          IS 'Free-text explanation of the import (file name, date, reason for missing evidence)';
COMMENT ON COLUMN public.observations.has_notes            IS 'TRUE when officer_notes is non-empty';
COMMENT ON COLUMN public.observations.has_homeless_claim   IS 'TRUE when occupant has claimed FC Act homeless exemption at time of scan';
COMMENT ON COLUMN public.observations.homeless_claim_notes IS 'Officer notes about the homeless claim';
COMMENT ON COLUMN public.observations.review_blocked       IS 'When TRUE the observation is blocked from enforcement actions pending admin review';

-- ── 2. Make idempotency_key nullable ─────────────────────────────────────────
--
-- Live scans (vehicle-ingest Edge Function) always supply an idempotency_key
-- in the format "deviceId:localCaptureId".  Legacy imports do not have a
-- device-level key, so we allow NULL here.
--
-- The UNIQUE constraint is kept; we add a partial index that enforces
-- uniqueness only on non-NULL values so that multiple legacy rows without
-- a key are permitted, while any two rows that DO have a key must differ.

ALTER TABLE public.observations
  ALTER COLUMN idempotency_key DROP NOT NULL;

-- Drop the old full-table UNIQUE constraint and replace with a partial one
-- (IF EXISTS guards make this re-runnable).
DO $$
BEGIN
  -- Drop old unique constraint if it exists as a named constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'observations'
      AND constraint_name = 'observations_idempotency_key_key'
      AND constraint_type = 'UNIQUE'
  ) THEN
    ALTER TABLE public.observations
      DROP CONSTRAINT observations_idempotency_key_key;
    RAISE NOTICE 'observations_idempotency_key_key unique constraint dropped';
  ELSE
    RAISE NOTICE 'observations_idempotency_key_key not found (may already be a partial index)';
  END IF;
END;
$$;

-- Partial unique index: only enforce uniqueness when idempotency_key is supplied
DROP INDEX IF EXISTS public.idx_obs_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_idempotency_notnull
  ON public.observations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON INDEX public.idx_obs_idempotency_notnull IS
  'Prevents duplicate live-scan observations by device idempotency key. '
  'NULL keys (legacy imports) are excluded from the uniqueness check.';

-- ── 3. source_observation_id – audit trail for old UUIDs ─────────────────────
--
-- When importing from an external system that has its own UUID for a record,
-- store that old UUID here for reference.  The observations.id column always
-- holds a freshly generated UUID (gen_random_uuid()); source_observation_id
-- is purely an audit/traceability column.

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS source_observation_id UUID DEFAULT NULL;

COMMENT ON COLUMN public.observations.source_observation_id IS
  'Optional: UUID of the corresponding record in the source system (e.g. observations.observation_id). '
  'observations.id is always a fresh UUID generated at import time. '
  'This column is for audit/traceability only and carries no FK constraint.';

-- ── 4. Partial index for legacy imports ──────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_obs_legacy_import
  ON public.observations (is_legacy_import, evidence_state)
  WHERE is_legacy_import = true;

CREATE INDEX IF NOT EXISTS idx_obs_review_blocked
  ON public.observations (review_blocked)
  WHERE review_blocked = true;

-- ── 5. Verification ──────────────────────────────────────────────────────────

DO $$
DECLARE
  v_col_count     INTEGER;
  v_idx_exists    BOOLEAN;
  v_null_idempkey INTEGER;
BEGIN
  -- Count newly added columns that are now present
  SELECT COUNT(*)
  INTO   v_col_count
  FROM   information_schema.columns
  WHERE  table_schema = 'public'
    AND  table_name   = 'observations'
    AND  column_name  IN (
           'is_legacy_import', 'evidence_state', 'legacy_source_tag',
           'legacy_note', 'has_notes', 'has_homeless_claim',
           'homeless_claim_notes', 'review_blocked', 'source_observation_id'
         );

  -- Check partial unique index exists
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'observations'
      AND indexname  = 'idx_obs_idempotency_notnull'
  ) INTO v_idx_exists;

  -- Count observations with NULL idempotency_key (should be 0 initially for
  -- new installs; may be > 0 on instances where imports already ran)
  SELECT COUNT(*) INTO v_null_idempkey
  FROM   public.observations
  WHERE  idempotency_key IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260320_fix_observations_import_schema complete';
  RAISE NOTICE '   Legacy-import columns present: % / 9', v_col_count;
  RAISE NOTICE '   Partial unique index exists:   %', v_idx_exists;
  RAISE NOTICE '   Observations with NULL idempotency_key: %', v_null_idempkey;
  RAISE NOTICE '';
  RAISE NOTICE 'NOTE: observations.id is always gen_random_uuid().';
  RAISE NOTICE '      Old UUIDs from observations are NEVER copied to id.';
  RAISE NOTICE '      If needed, store old UUIDs in source_observation_id (audit only).';
  RAISE NOTICE '';
END;
$$;
