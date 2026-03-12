-- ============================================================================
-- V1 Inference Outputs — Extend observations for new AI pipeline fields
-- Migration: 20260308_v1_inference_outputs.sql
-- ============================================================================
-- Adds columns to support:
--
--   1. ALPR plate confidence + vehicle attribute confidences (make/model/color)
--   2. Self-contained sticker detection (presence can be null = unknown)
--   3. Movement comparison within the same incident/case
--   4. Link to parent incident and previous observation in the same case
--
-- All new columns are nullable with no default (zero-downtime deploy).
-- Existing rows are unaffected.
-- ============================================================================

-- ── 1. Incident linkage ───────────────────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.observations.incident_id IS
  'Optional link to the incidents record this observation belongs to.';

CREATE INDEX IF NOT EXISTS idx_observations_incident_id
  ON public.observations (incident_id)
  WHERE incident_id IS NOT NULL;

-- ── 2. ALPR plate confidence ──────────────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS plate_confidence real;

COMMENT ON COLUMN public.observations.plate_confidence IS
  'Confidence score (0–1) for the recognised plate number, as returned by the ALPR provider.';

-- ── 3. Vehicle attribute confidences ─────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS vehicle_make_confidence  real,
  ADD COLUMN IF NOT EXISTS vehicle_model_confidence real,
  ADD COLUMN IF NOT EXISTS vehicle_color_confidence real;

COMMENT ON COLUMN public.observations.vehicle_make_confidence  IS 'Confidence score (0–1) for vehicle_make inference.';
COMMENT ON COLUMN public.observations.vehicle_model_confidence IS 'Confidence score (0–1) for vehicle_model inference.';
COMMENT ON COLUMN public.observations.vehicle_color_confidence IS 'Confidence score (0–1) for vehicle_color inference.';

-- ── 4. Sticker detection (v1 self-contained sticker) ─────────────────────
--
-- sticker_presence is a nullable boolean (tri-state):
--   true  = sticker detected as present
--   false = sticker detected as absent
--   null  = inference could not determine (force review)
--
-- sticker_color is a text field constrained to known values.
-- 'unknown' is used when presence is null or color cannot be determined.

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS sticker_presence            boolean,
  ADD COLUMN IF NOT EXISTS sticker_color               text,
  ADD COLUMN IF NOT EXISTS sticker_bbox                jsonb,
  ADD COLUMN IF NOT EXISTS sticker_detection_confidence real,
  ADD COLUMN IF NOT EXISTS sticker_color_confidence    real;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.observations'::regclass
      AND conname  = 'observations_sticker_color_check'
  ) THEN
    ALTER TABLE public.observations
      ADD CONSTRAINT observations_sticker_color_check
        CHECK (sticker_color IS NULL OR sticker_color IN ('blue', 'green', 'unknown'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.observations.sticker_presence IS
  'Tri-state: true = sticker present, false = absent, null = inference inconclusive (requires manual review).';
COMMENT ON COLUMN public.observations.sticker_color IS
  'Detected sticker colour: blue | green | unknown. Set to unknown when presence is null.';
COMMENT ON COLUMN public.observations.sticker_bbox IS
  'Bounding box of detected sticker: {"x":0,"y":0,"width":100,"height":50} in pixel coordinates.';
COMMENT ON COLUMN public.observations.sticker_detection_confidence IS
  'Confidence score (0–1) that a sticker is (or is not) present in the photo.';
COMMENT ON COLUMN public.observations.sticker_color_confidence IS
  'Confidence score (0–1) for the identified sticker colour.';

-- ── 5. Movement comparison ────────────────────────────────────────────────
--
-- Used by the inference service to compare two observations from the same
-- incident and decide whether the vehicle has moved between photos.

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS previous_observation_id       uuid REFERENCES public.observations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS movement_moved                boolean,
  ADD COLUMN IF NOT EXISTS movement_background_similarity real,
  ADD COLUMN IF NOT EXISTS movement_vehicle_bbox_iou     real,
  ADD COLUMN IF NOT EXISTS movement_decision             text;

COMMENT ON COLUMN public.observations.previous_observation_id IS
  'ID of the earlier observation in the same incident used as the reference frame for movement comparison.';
COMMENT ON COLUMN public.observations.movement_moved IS
  'true = vehicle moved, false = stationary, null = comparison not yet run.';
COMMENT ON COLUMN public.observations.movement_background_similarity IS
  'Cosine / SSIM similarity score (0–1) between background regions of this and previous photo.';
COMMENT ON COLUMN public.observations.movement_vehicle_bbox_iou IS
  'Intersection-over-union (0–1) of vehicle bounding boxes between this and previous photo.';
COMMENT ON COLUMN public.observations.movement_decision IS
  'Human-readable outcome label from the movement classifier, e.g. moved | stationary | inconclusive.';

CREATE INDEX IF NOT EXISTS idx_observations_previous_observation_id
  ON public.observations (previous_observation_id)
  WHERE previous_observation_id IS NOT NULL;

-- ── Force PostgREST schema cache reload ──────────────────────────────────
-- Without this, newly-added columns are invisible to PostgREST until it
-- reloads its cache, causing "Could not find the 'plate_confidence' column
-- of 'observations' in the schema cache" errors at scan time.

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- ── Verification notice ───────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✅ v1 inference outputs migration complete';
  RAISE NOTICE '   + observations.incident_id                  uuid FK → incidents';
  RAISE NOTICE '   + observations.plate_confidence             real';
  RAISE NOTICE '   + observations.vehicle_make_confidence      real';
  RAISE NOTICE '   + observations.vehicle_model_confidence     real';
  RAISE NOTICE '   + observations.vehicle_color_confidence     real';
  RAISE NOTICE '   + observations.sticker_presence             boolean (nullable tri-state)';
  RAISE NOTICE '   + observations.sticker_color               text (blue|green|unknown)';
  RAISE NOTICE '   + observations.sticker_bbox                jsonb';
  RAISE NOTICE '   + observations.sticker_detection_confidence real';
  RAISE NOTICE '   + observations.sticker_color_confidence    real';
  RAISE NOTICE '   + observations.previous_observation_id     uuid FK → observations';
  RAISE NOTICE '   + observations.movement_moved              boolean (nullable)';
  RAISE NOTICE '   + observations.movement_background_similarity real';
  RAISE NOTICE '   + observations.movement_vehicle_bbox_iou   real';
  RAISE NOTICE '   + observations.movement_decision           text';
END;
$$;
