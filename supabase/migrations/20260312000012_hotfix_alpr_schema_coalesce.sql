-- ============================================================================
-- Hotfix: Fix ALPR schema cache errors and COALESCE type mismatch
-- Date: 2026-03-12
--
-- Problems fixed:
--   1. "Could not find the 'plate_confidence' column of 'observations' in 
--      the schema cache" — PostgREST cache not refreshed after column add
--   2. "COALESCE types integer and text cannot be matched" — trigger function
--      auto_evaluate_compliance() expects INTEGER but column may be TEXT
--
-- This is a hotfix migration combining fixes from:
--   - 20260312000010_fix_alpr_inference_columns_schema_cache.sql
--   - 20260312000011_force_alpr_schema_cache_reload.sql
--   - 20260331000002_realign_observations_compliance_types_and_trigger.sql
--
-- All changes are idempotent and safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Ensure all ALPR/inference columns exist
-- ============================================================================

-- 1a. Async scan pipeline columns
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

-- 1b. ALPR plate confidence
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS plate_confidence real;

-- 1c. Vehicle attribute confidences
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS vehicle_make_confidence  real,
  ADD COLUMN IF NOT EXISTS vehicle_model_confidence real,
  ADD COLUMN IF NOT EXISTS vehicle_color_confidence real;

-- 1d. Sticker detection columns
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

-- 1e. Movement comparison columns
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS previous_observation_id        uuid REFERENCES public.observations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS movement_moved                 boolean,
  ADD COLUMN IF NOT EXISTS movement_background_similarity real,
  ADD COLUMN IF NOT EXISTS movement_vehicle_bbox_iou      real,
  ADD COLUMN IF NOT EXISTS movement_decision              text;

CREATE INDEX IF NOT EXISTS idx_observations_previous_observation_id
  ON public.observations (previous_observation_id)
  WHERE previous_observation_id IS NOT NULL;

-- 1f. Incident linkage
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_observations_incident_id
  ON public.observations (incident_id)
  WHERE incident_id IS NOT NULL;

-- ============================================================================
-- PART 2: Ensure compliance columns exist with correct types
-- ============================================================================

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS nights_stayed_this_month integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_nights integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breach_reason text,
  ADD COLUMN IF NOT EXISTS is_compliant boolean DEFAULT true;

-- ============================================================================
-- PART 3: Coerce column types to expected base types
-- ============================================================================

DO $$
DECLARE
  v_type text;
BEGIN
  -- nights_stayed_this_month → integer
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'observations'
    AND column_name  = 'nights_stayed_this_month';

  IF v_type IS DISTINCT FROM 'integer' THEN
    EXECUTE $sql$
      ALTER TABLE public.observations
        ALTER COLUMN nights_stayed_this_month TYPE integer
        USING (
          CASE
            WHEN nights_stayed_this_month IS NULL THEN 0
            WHEN btrim(nights_stayed_this_month::text) = '' THEN 0
            WHEN btrim(nights_stayed_this_month::text) ~ '^-?[0-9]+$'
              THEN btrim(nights_stayed_this_month::text)::integer
            ELSE 0
          END
        )
    $sql$;
    RAISE NOTICE 'Converted observations.nights_stayed_this_month to integer (was %)', v_type;
  END IF;

  -- consecutive_nights → integer
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'observations'
    AND column_name  = 'consecutive_nights';

  IF v_type IS DISTINCT FROM 'integer' THEN
    EXECUTE $sql$
      ALTER TABLE public.observations
        ALTER COLUMN consecutive_nights TYPE integer
        USING (
          CASE
            WHEN consecutive_nights IS NULL THEN 0
            WHEN btrim(consecutive_nights::text) = '' THEN 0
            WHEN btrim(consecutive_nights::text) ~ '^-?[0-9]+$'
              THEN btrim(consecutive_nights::text)::integer
            ELSE 0
          END
        )
    $sql$;
    RAISE NOTICE 'Converted observations.consecutive_nights to integer (was %)', v_type;
  END IF;

  -- is_compliant → boolean
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'observations'
    AND column_name  = 'is_compliant';

  IF v_type IS DISTINCT FROM 'boolean' THEN
    EXECUTE $sql$
      ALTER TABLE public.observations
        ALTER COLUMN is_compliant TYPE boolean
        USING (
          CASE
            WHEN is_compliant IS NULL THEN true
            WHEN lower(btrim(is_compliant::text)) IN ('true','t','1','yes','y') THEN true
            WHEN lower(btrim(is_compliant::text)) IN ('false','f','0','no','n') THEN false
            ELSE true
          END
        )
    $sql$;
    RAISE NOTICE 'Converted observations.is_compliant to boolean (was %)', v_type;
  END IF;
END;
$$;

-- Set defaults for compliance columns
ALTER TABLE public.observations
  ALTER COLUMN nights_stayed_this_month SET DEFAULT 0,
  ALTER COLUMN consecutive_nights SET DEFAULT 0,
  ALTER COLUMN is_compliant SET DEFAULT true;

-- ============================================================================
-- PART 4: Replace trigger function with defensive type-agnostic version
-- ============================================================================

-- Drop legacy trigger if still present
DROP TRIGGER IF EXISTS trigger_auto_compliance_check ON public.observations;

-- Recreate trigger function with defensive casts from NEW.*::text
-- This handles cases where the column might still be TEXT type at runtime
CREATE OR REPLACE FUNCTION public.auto_evaluate_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matrix           RECORD;
  v_is_homeless      BOOLEAN := false;
  v_nz_hour          INTEGER;
  v_is_compliant     BOOLEAN := true;
  v_breach_type      TEXT    := NULL;
  v_breach_reason    TEXT    := NULL;
  v_nights_stayed    INTEGER := 0;
  v_consecutive      INTEGER := 0;
  v_self_contained   BOOLEAN := false;
BEGIN
  -- Defensive type conversion: handle both INTEGER and TEXT column types
  -- This prevents "COALESCE types integer and text cannot be matched" errors
  v_nights_stayed := COALESCE(
    NULLIF(regexp_replace(COALESCE(NEW.nights_stayed_this_month::text, ''), '[^0-9-]', '', 'g'), '')::integer,
    0
  );

  v_consecutive := COALESCE(
    NULLIF(regexp_replace(COALESCE(NEW.consecutive_nights::text, ''), '[^0-9-]', '', 'g'), '')::integer,
    0
  );

  v_self_contained := lower(COALESCE(NEW.self_contained::text, 'false')) IN ('true','t','1','yes','y');

  -- Lookup active compliance matrix for this zone at observation time
  SELECT *
    INTO v_matrix
    FROM zone_compliance_matrix
   WHERE zone_id = NEW.zone_id
     AND effective_from <= NEW.recorded_at
     AND (effective_to IS NULL OR effective_to > NEW.recorded_at)
   ORDER BY version DESC
   LIMIT 1;

  -- Fall back to zone table when no matrix row exists
  IF NOT FOUND THEN
    SELECT
      self_contained_required,
      self_contained_required AS requires_csc,
      nights_per_month,
      max_consecutive_nights,
      day_visit_only,
      TRUE AS homeless_exemption
    INTO v_matrix
    FROM zones
    WHERE id = NEW.zone_id;

    IF NOT FOUND THEN
      -- No zone rules at all – set sanitized compliance values and return
      NEW.nights_stayed_this_month := v_nights_stayed;
      NEW.consecutive_nights := v_consecutive;
      RETURN NEW;
    END IF;
  END IF;

  -- Check homeless status
  SELECT (homeless_status = 'confirmed')
    INTO v_is_homeless
    FROM canonical_vehicles
   WHERE plate_number = NEW.plate_number;

  IF NOT FOUND THEN
    v_is_homeless := false;
  END IF;

  -- Rule 1: Day-visit-only zone
  IF COALESCE(v_matrix.day_visit_only, false) THEN
    v_nz_hour := EXTRACT(HOUR FROM NEW.recorded_at AT TIME ZONE 'Pacific/Auckland')::integer;
    IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
      v_is_compliant := false;
      v_breach_type := 'day_visit_violation';
      v_breach_reason := format('Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour);
    END IF;
  END IF;

  -- Rule 2: Monthly nights limit
  IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL THEN
    IF v_nights_stayed > v_matrix.nights_per_month THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type := 'monthly_limit';
        v_breach_reason := format(
          'Exceeded monthly stay limit: %s nights stayed, limit is %s',
          v_nights_stayed,
          v_matrix.nights_per_month
        );
      END IF;
    END IF;
  END IF;

  -- Rule 3: Consecutive nights limit
  IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL THEN
    IF v_consecutive > v_matrix.max_consecutive_nights THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type := 'consecutive_nights';
        v_breach_reason := format(
          'Exceeded consecutive nights limit: %s consecutive nights, limit is %s',
          v_consecutive,
          v_matrix.max_consecutive_nights
        );
      END IF;
    END IF;
  END IF;

  -- Rule 4: Self-contained / CSC requirement
  IF v_is_compliant AND (
    COALESCE(v_matrix.self_contained_required, false)
    OR COALESCE(v_matrix.requires_csc, false)
  ) THEN
    IF NOT v_self_contained THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type := 'self_contained';
        v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
      END IF;
    END IF;
  END IF;

  -- Write sanitized compliance values back onto the row
  NEW.nights_stayed_this_month := v_nights_stayed;
  NEW.consecutive_nights := v_consecutive;
  NEW.is_compliant := v_is_compliant;
  NEW.breach_type := v_breach_type;
  NEW.breach_reason := v_breach_reason;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_evaluate_compliance() IS
  'BEFORE INSERT trigger function: evaluates compliance rules from '
  'zone_compliance_matrix and writes is_compliant/breach_type/breach_reason '
  'onto the new observations row. Uses defensive type conversion to handle '
  'schema drift between TEXT and INTEGER column types.';

-- Recreate trigger
DROP TRIGGER IF EXISTS trg_auto_evaluate_compliance ON public.observations;
CREATE TRIGGER trg_auto_evaluate_compliance
  BEFORE INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_evaluate_compliance();

COMMENT ON TRIGGER trg_auto_evaluate_compliance ON public.observations IS
  'Runs auto_evaluate_compliance() before each INSERT to set compliance fields.';

-- ============================================================================
-- PART 5: Force PostgREST schema cache reload
-- ============================================================================

-- NOTIFY is the standard Supabase approach (PostgREST listens on 'pgrst').
-- pg_notify() is the functional form that also works on direct connections.
-- Both are issued for maximum compatibility.
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- PART 6: Verification
-- ============================================================================

DO $$
DECLARE
  v_cols text[];
  v_col  text;
  v_ok   boolean;
BEGIN
  v_cols := ARRAY[
    'processing_status', 'processing_started_at', 'processing_completed_at', 'processing_error',
    'incident_id', 'plate_confidence',
    'vehicle_make_confidence', 'vehicle_model_confidence', 'vehicle_color_confidence',
    'sticker_presence', 'sticker_color', 'sticker_bbox',
    'sticker_detection_confidence', 'sticker_color_confidence',
    'previous_observation_id',
    'movement_moved', 'movement_background_similarity',
    'movement_vehicle_bbox_iou', 'movement_decision',
    'nights_stayed_this_month', 'consecutive_nights', 'is_compliant', 'breach_reason'
  ];

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260312000012_hotfix_alpr_schema_coalesce';
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
  RAISE NOTICE '   Trigger function auto_evaluate_compliance() updated.';
  RAISE NOTICE '';
END;
$$;

COMMIT;
