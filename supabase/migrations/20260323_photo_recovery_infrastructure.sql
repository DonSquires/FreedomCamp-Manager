-- ============================================================================
-- PHOTO RECOVERY INFRASTRUCTURE
-- Recover and relink vehicle/plate photos accidentally deleted from storage.
-- ============================================================================
-- This migration creates the schema required to:
--   1. Queue observations whose photos are missing (missing_photo_queue)
--   2. Audit every recovery action for chain-of-custody (photo_recovery_audit_log)
--   3. Report photo-integrity health against the live `observations` table
--      (photo_integrity_health + recent_observations_photo_status views)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- SECTION 1: MISSING PHOTO QUEUE (observations-based)
-- ---------------------------------------------------------------------------
-- Replaces the observations version from
-- 20260219000004_photo_first_enforcement.sql which referenced a table that
-- was subsequently dropped.
-- ---------------------------------------------------------------------------

-- Ensure observations has a stable UUID key for FK references used below.
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS photo_hash TEXT DEFAULT NULL;

UPDATE public.observations
SET id = gen_random_uuid()
WHERE id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.observations'::regclass
      AND conname = 'observations_id_key'
  ) THEN
    ALTER TABLE public.observations
      ADD CONSTRAINT observations_id_key UNIQUE (id);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS missing_photo_queue (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK to the live observations table
  observation_id     UUID        NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plate_number       TEXT,
  recorded_at        TIMESTAMPTZ NOT NULL,

  -- Diagnosis
  reason TEXT NOT NULL
    CHECK (reason IN ('null_both', 'null_hash', 'null_url', 'object_404', 'hash_mismatch', 'legacy_path', 'unknown'))
    DEFAULT 'unknown',
  original_photo_url TEXT,   -- candidate URL found (legacy bucket / ParkPow / PlateRecognizer)
  attempted_hash     TEXT,   -- SHA-256 calculated from the candidate file

  -- Recovery Status
  status TEXT
    CHECK (status IN ('pending', 'repairing', 'fixed', 'manual_required', 'abandoned'))
    DEFAULT 'pending',
  attempts          INTEGER     DEFAULT 0,
  last_attempt_at   TIMESTAMPTZ,
  repair_notes      TEXT,

  -- Assignment for manual review
  assigned_to       UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),

  UNIQUE (observation_id)
);

-- Upsert-friendly: if queue table already existed with old schema pointing at a
-- dropped table, the UNIQUE constraint on observation_id lets callers use
-- ON CONFLICT DO NOTHING safely.

CREATE INDEX IF NOT EXISTS idx_missing_photo_queue_status
  ON missing_photo_queue(status, created_at);

CREATE INDEX IF NOT EXISTS idx_missing_photo_queue_org
  ON missing_photo_queue(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_missing_photo_queue_plate
  ON missing_photo_queue(plate_number, recorded_at DESC)
  WHERE plate_number IS NOT NULL;

COMMENT ON TABLE missing_photo_queue IS
  'Reconciliation queue for observations missing verifiable original photos. '
  'Populated by the photo-recovery edge function; cleared when photos are '
  'restored or observations are abandoned. (Evidence Act integrity)';

COMMENT ON COLUMN missing_photo_queue.reason IS
  'Why photo is missing: null_hash (hash never stored), null_url (photo_url NULL), '
  'object_404 (file deleted from storage), hash_mismatch (corruption), '
  'legacy_path (old path convention), unknown.';

-- RLS
ALTER TABLE missing_photo_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_missing_photo_queue" ON missing_photo_queue;
CREATE POLICY "admins_manage_missing_photo_queue"
  ON missing_photo_queue FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master', 'admin_officer'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_missing_photo_queue_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_missing_photo_queue_updated_at ON missing_photo_queue;
CREATE TRIGGER trg_missing_photo_queue_updated_at
  BEFORE UPDATE ON missing_photo_queue
  FOR EACH ROW EXECUTE FUNCTION update_missing_photo_queue_updated_at();

-- ---------------------------------------------------------------------------
-- SECTION 2: PHOTO RECOVERY AUDIT LOG (chain-of-custody)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS photo_recovery_audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id  UUID        REFERENCES observations(id) ON DELETE SET NULL,
  organization_id UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  plate_number    TEXT,
  recorded_at     TIMESTAMPTZ,

  -- Action taken
  action TEXT NOT NULL
    CHECK (action IN (
      'detect',           -- Observation added to missing_photo_queue
      'parkpow_search',   -- ParkPow API queried for matching session
      'platerecognizer',  -- Plate Recognizer API used to verify candidate
      'legacy_search',    -- Legacy storage path searched
      'photo_restored',   -- Photo successfully downloaded & uploaded to storage
      'observation_updated', -- observations.photo_url / photo_hash written
      'queue_updated',    -- missing_photo_queue status changed
      'manual_assigned',  -- Assigned to officer for field re-capture
      'abandoned'         -- Observation marked non-evidential
    )),

  -- Source of recovered data
  source         TEXT,          -- e.g. 'parkpow', 'platerecognizer', 'legacy_bucket', 'manual'
  source_ref     TEXT,          -- e.g. ParkPow session_id, storage path, officer ID

  -- Result
  success        BOOLEAN        NOT NULL DEFAULT false,
  photo_url      TEXT,          -- New (restored) photo URL if applicable
  photo_hash     TEXT,          -- SHA-256 of restored photo
  photo_bytes    BIGINT,        -- File size of restored photo
  error_message  TEXT,          -- Error detail on failure
  meta           JSONB,         -- Additional provider-specific data

  -- Actor
  actor_id       UUID           REFERENCES user_profiles(id) ON DELETE SET NULL,
  actor_label    TEXT,          -- 'system' | 'admin:<email>' | 'officer:<id>'

  occurred_at    TIMESTAMPTZ    DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_audit_observation
  ON photo_recovery_audit_log(observation_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_audit_org
  ON photo_recovery_audit_log(organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_audit_action
  ON photo_recovery_audit_log(action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_audit_occurred
  ON photo_recovery_audit_log(occurred_at DESC);

COMMENT ON TABLE photo_recovery_audit_log IS
  'Immutable chain-of-custody log for every photo recovery action. '
  'Records detect → search → download → upload → link steps. '
  'Admissible as audit trail in evidence proceedings.';

COMMENT ON COLUMN photo_recovery_audit_log.actor_label IS
  'Human-readable actor: ''system'' for automated jobs, '
  '''admin:<email>'' for admin-initiated runs, ''officer:<id>'' for field re-capture.';

-- RLS: admins/masters can view; system (service role) can insert
ALTER TABLE photo_recovery_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_view_photo_audit_log" ON photo_recovery_audit_log;
CREATE POLICY "admins_view_photo_audit_log"
  ON photo_recovery_audit_log FOR SELECT
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master', 'admin_officer'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- SECTION 3: PHOTO INTEGRITY VIEWS (based on observations)
-- ---------------------------------------------------------------------------
-- Drop and recreate views that previously referenced observations.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS photo_integrity_health;
CREATE OR REPLACE VIEW photo_integrity_health AS
SELECT
  o.organization_id,
  org.name                                                          AS organization_name,
  COUNT(*)                                                          AS total_observations,
  COUNT(CASE WHEN o.photo_url IS NOT NULL AND o.photo_hash IS NOT NULL THEN 1 END)
                                                                    AS with_photo,
  COUNT(CASE WHEN o.photo_url IS NULL THEN 1 END)                  AS missing_url,
  COUNT(CASE WHEN o.photo_hash IS NULL THEN 1 END)                 AS missing_hash,
  COUNT(*)
    - COUNT(CASE WHEN o.photo_url IS NOT NULL AND o.photo_hash IS NOT NULL THEN 1 END)
                                                                    AS missing_any,
  ROUND(
    100.0
    * COUNT(CASE WHEN o.photo_url IS NOT NULL AND o.photo_hash IS NOT NULL THEN 1 END)
    / NULLIF(COUNT(*), 0),
    2
  )                                                                 AS photo_coverage_pct,
  MAX(o.recorded_at)                                               AS latest_observation
FROM observations o
JOIN organizations org ON org.id = o.organization_id
GROUP BY o.organization_id, org.name
ORDER BY missing_any DESC;

COMMENT ON VIEW photo_integrity_health IS
  'Photo integrity monitoring per organisation (SLO: ≥99.95% photo coverage). '
  'Both photo_url and photo_hash must be non-null to count as ''with_photo''.';

DROP VIEW IF EXISTS recent_observations_photo_status;
CREATE OR REPLACE VIEW recent_observations_photo_status AS
SELECT
  o.id                                  AS observation_id,
  o.organization_id,
  o.plate_number,
  o.recorded_at,
  o.photo_url  IS NOT NULL              AS has_url,
  o.photo_hash IS NOT NULL              AS has_hash,
  CASE
    WHEN o.photo_url  IS NULL AND o.photo_hash IS NULL THEN 'missing_both'
    WHEN o.photo_url  IS NULL THEN 'missing_url'
    WHEN o.photo_hash IS NULL THEN 'missing_hash'
    ELSE 'ok'
  END                                   AS status
FROM observations o
WHERE o.recorded_at >= now() - INTERVAL '7 days'
ORDER BY o.recorded_at DESC;

COMMENT ON VIEW recent_observations_photo_status IS
  'Photo status for observations in the last 7 days (continuous reconciler monitoring).';

-- Grants
GRANT SELECT ON photo_integrity_health         TO authenticated;
GRANT SELECT ON recent_observations_photo_status TO authenticated;
GRANT SELECT ON missing_photo_queue             TO authenticated;
GRANT SELECT ON photo_recovery_audit_log        TO authenticated;

-- ---------------------------------------------------------------------------
-- SECTION 4: DETECT FUNCTION
-- Populate missing_photo_queue for all observations currently missing photos.
-- Safe to call multiple times (uses ON CONFLICT DO NOTHING).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION detect_missing_photos(
  p_organization_id UUID DEFAULT NULL,
  p_date_from       TIMESTAMPTZ DEFAULT NULL,
  p_date_to         TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  inserted_count BIGINT,
  already_queued BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted BIGINT := 0;
  v_already  BIGINT := 0;
BEGIN
  WITH candidates AS (
    SELECT
      o.id              AS observation_id,
      o.organization_id,
      o.plate_number,
      o.recorded_at,
      CASE
        WHEN o.photo_url  IS NULL AND o.photo_hash IS NULL THEN 'null_both'
        WHEN o.photo_url  IS NULL THEN 'null_url'
        WHEN o.photo_hash IS NULL THEN 'null_hash'
        ELSE 'unknown'
      END               AS reason
    FROM observations o
    WHERE
      (o.photo_url IS NULL OR o.photo_hash IS NULL)
      AND (p_organization_id IS NULL OR o.organization_id = p_organization_id)
      AND (p_date_from       IS NULL OR o.recorded_at >= p_date_from)
      AND (p_date_to         IS NULL OR o.recorded_at <= p_date_to)
  ),
  ins AS (
    INSERT INTO missing_photo_queue (
      observation_id, organization_id, plate_number, recorded_at, reason
    )
    SELECT observation_id, organization_id, plate_number, recorded_at, reason
    FROM candidates
    ON CONFLICT (observation_id) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  -- Count already-queued items for the same scope
  SELECT COUNT(*) INTO v_already
  FROM missing_photo_queue q
  JOIN observations o ON o.id = q.observation_id
  WHERE
    (o.photo_url IS NULL OR o.photo_hash IS NULL)
    AND (p_organization_id IS NULL OR q.organization_id = p_organization_id)
    AND (p_date_from       IS NULL OR q.recorded_at >= p_date_from)
    AND (p_date_to         IS NULL OR q.recorded_at <= p_date_to)
    AND q.status NOT IN ('fixed', 'abandoned');

  RETURN QUERY SELECT v_inserted, v_already - v_inserted;
END;
$$;

COMMENT ON FUNCTION detect_missing_photos IS
  'Populate missing_photo_queue for observations with null photo_url or photo_hash. '
  'Safe to call repeatedly (ON CONFLICT DO NOTHING). '
  'Returns (inserted_count, already_queued).';

GRANT EXECUTE ON FUNCTION detect_missing_photos TO authenticated;

-- ---------------------------------------------------------------------------
-- SECTION 5: PHOTO INTEGRITY STATUS CHECK (callable from edge functions)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION photo_integrity_status_check()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total   BIGINT;
  v_with    BIGINT;
  v_missing BIGINT;
  v_pct     NUMERIC;
BEGIN
  SELECT
    COUNT(*),
    COUNT(CASE WHEN photo_url IS NOT NULL AND photo_hash IS NOT NULL THEN 1 END),
    COUNT(*) - COUNT(CASE WHEN photo_url IS NOT NULL AND photo_hash IS NOT NULL THEN 1 END)
  INTO v_total, v_with, v_missing
  FROM observations;

  IF v_total > 0 THEN
    v_pct := ROUND(100.0 * v_with / v_total, 2);
  ELSE
    v_pct := 100.0;
  END IF;

  RAISE NOTICE '=========================================';
  RAISE NOTICE 'PHOTO INTEGRITY STATUS';
  RAISE NOTICE '=========================================';
  RAISE NOTICE 'Total observations : %', v_total;
  RAISE NOTICE 'With photo+hash    : %', v_with;
  RAISE NOTICE 'Missing photo/hash : %', v_missing;
  RAISE NOTICE 'Coverage           : % (Target: >=99.95%%)', v_pct;
  RAISE NOTICE '=========================================';

  IF v_missing > 0 THEN
    RAISE NOTICE 'ACTION REQUIRED: % observations need photo recovery', v_missing;
    RETURN 'AT_RISK';
  ELSE
    RAISE NOTICE 'STATUS: All observations have verifiable photos ✓';
    RETURN 'OK';
  END IF;
END;
$$;

COMMENT ON FUNCTION photo_integrity_status_check IS
  'Print photo integrity summary to Postgres NOTICE log and return OK / AT_RISK.';
