-- ============================================================================
-- Force PostgREST schema cache reload for ALPR inference columns
-- Date: 2026-03-12
--
-- Problem:
--   After PR #165 (migration 20260312000010), scans continue to fail with:
--     "Database error: Could not find the 'plate_confidence' column of
--     'observations' in the schema cache"
--
--   This can happen if:
--     1. Migration 20260312000010 was applied but PostgREST did not receive
--        the NOTIFY (e.g. connection through PgBouncer in transaction mode).
--     2. Migration 20260312000010 was not yet applied to the live database.
--
-- Fix:
--   Re-declare every optional AI inference column with ADD COLUMN IF NOT EXISTS
--   (safe no-op when the column already exists), then issue two forms of the
--   schema-cache reload notification for maximum compatibility.
--
-- All changes are idempotent.
-- ============================================================================

BEGIN;

-- ── 1. Async scan pipeline columns ───────────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS processing_status       text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS processing_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_error        text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.observations'::regclass
      AND conname  = 'observations_processing_status_check'
  ) THEN
    ALTER TABLE public.observations
      ADD CONSTRAINT observations_processing_status_check
        CHECK (processing_status IN ('pending','processing','completed','failed'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_observations_processing_status
  ON public.observations (processing_status, created_at)
  WHERE processing_status IN ('pending','processing');

-- ── 2. Incident linkage ───────────────────────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_observations_incident_id
  ON public.observations (incident_id)
  WHERE incident_id IS NOT NULL;

-- ── 3. ALPR plate confidence ──────────────────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS plate_confidence real;

-- ── 4. Vehicle attribute confidences ─────────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS vehicle_make_confidence  real,
  ADD COLUMN IF NOT EXISTS vehicle_model_confidence real,
  ADD COLUMN IF NOT EXISTS vehicle_color_confidence real;

-- ── 5. Sticker detection columns ─────────────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS sticker_presence             boolean,
  ADD COLUMN IF NOT EXISTS sticker_color                text,
  ADD COLUMN IF NOT EXISTS sticker_bbox                 jsonb,
  ADD COLUMN IF NOT EXISTS sticker_detection_confidence real,
  ADD COLUMN IF NOT EXISTS sticker_color_confidence     real;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.observations'::regclass
      AND conname  = 'observations_sticker_color_check'
  ) THEN
    ALTER TABLE public.observations
      ADD CONSTRAINT observations_sticker_color_check
        CHECK (sticker_color IS NULL OR sticker_color IN ('blue','green','unknown'));
  END IF;
END;
$$;

-- ── 6. Movement comparison columns ───────────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS previous_observation_id        uuid REFERENCES public.observations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS movement_moved                 boolean,
  ADD COLUMN IF NOT EXISTS movement_background_similarity real,
  ADD COLUMN IF NOT EXISTS movement_vehicle_bbox_iou      real,
  ADD COLUMN IF NOT EXISTS movement_decision              text;

CREATE INDEX IF NOT EXISTS idx_observations_previous_observation_id
  ON public.observations (previous_observation_id)
  WHERE previous_observation_id IS NOT NULL;

-- ── 7. Force PostgREST schema cache reload ────────────────────────────────────
--
-- NOTIFY is the standard Supabase approach (PostgREST listens on 'pgrst').
-- pg_notify() is the functional form that also works on direct connections
-- and can be called inside a transaction.
-- Both are issued for maximum compatibility.

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- ── 8. Verification ───────────────────────────────────────────────────────────

DO $$
DECLARE
  v_cols text[];
  v_col  text;
  v_ok   boolean;
BEGIN
  v_cols := ARRAY[
    'processing_status', 'processing_started_at', 'processing_completed_at', 'processing_error',
    'incident_id',
    'plate_confidence',
    'vehicle_make_confidence', 'vehicle_model_confidence', 'vehicle_color_confidence',
    'sticker_presence', 'sticker_color', 'sticker_bbox',
    'sticker_detection_confidence', 'sticker_color_confidence',
    'previous_observation_id',
    'movement_moved', 'movement_background_similarity',
    'movement_vehicle_bbox_iou', 'movement_decision'
  ];

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260312000011_force_alpr_schema_cache_reload';
  FOREACH v_col IN ARRAY v_cols LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'observations'
        AND column_name  = v_col
    ) INTO v_ok;
    RAISE NOTICE '   observations.%-45s %s', v_col,
      CASE WHEN v_ok THEN 'OK' ELSE 'MISSING ❌' END;
  END LOOP;
  RAISE NOTICE '   PostgREST schema cache reload issued.';
  RAISE NOTICE '';
END;
$$;

COMMIT;
