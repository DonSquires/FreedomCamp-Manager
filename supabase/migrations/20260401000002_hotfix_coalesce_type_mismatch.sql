-- ============================================================================
-- HOTFIX: COALESCE types integer and text cannot be matched
-- Date: 2026-04-01 (sequence 2)
--
-- This migration fixes the recurring "COALESCE types integer and text cannot
-- be matched" error that occurs during observation inserts. The error occurs
-- when the trigger function auto_evaluate_compliance() uses COALESCE with
-- column values that have drifted from INTEGER to TEXT type.
--
-- Root cause:
--   COALESCE(NEW.nights_stayed_this_month, 0) fails when:
--   - nights_stayed_this_month is TEXT type
--   - 0 is INTEGER literal
--   PostgreSQL cannot implicitly coerce between integer and text in COALESCE.
--
-- Solution:
--   1. Fix column types to be consistently INTEGER/BOOLEAN
--   2. Use exception-wrapped conversions in the trigger function
--   3. Avoid COALESCE(column, literal) patterns entirely - use explicit casts
--
-- This migration is idempotent and safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Ensure compliance columns exist with correct defaults
-- ============================================================================

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS nights_stayed_this_month integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_nights integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_compliant boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS breach_type text,
  ADD COLUMN IF NOT EXISTS breach_reason text,
  ADD COLUMN IF NOT EXISTS self_contained boolean DEFAULT false;

-- ============================================================================
-- PART 2: Fix column types (safely convert TEXT -> INTEGER/BOOLEAN)
-- ============================================================================

DO $$
DECLARE
  v_type text;
BEGIN
  -- Fix nights_stayed_this_month -> integer
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'observations'
    AND column_name  = 'nights_stayed_this_month';

  IF v_type IS NOT NULL AND v_type <> 'integer' THEN
    EXECUTE $x$
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
    $x$;
    RAISE NOTICE 'Fixed nights_stayed_this_month type (was %)', v_type;
  END IF;

  -- Fix consecutive_nights -> integer
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'observations'
    AND column_name  = 'consecutive_nights';

  IF v_type IS NOT NULL AND v_type <> 'integer' THEN
    EXECUTE $x$
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
    $x$;
    RAISE NOTICE 'Fixed consecutive_nights type (was %)', v_type;
  END IF;

  -- Fix is_compliant -> boolean
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'observations'
    AND column_name  = 'is_compliant';

  IF v_type IS NOT NULL AND v_type <> 'boolean' THEN
    EXECUTE $x$
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
    $x$;
    RAISE NOTICE 'Fixed is_compliant type (was %)', v_type;
  END IF;

  -- Fix self_contained -> boolean
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'observations'
    AND column_name  = 'self_contained';

  IF v_type IS NOT NULL AND v_type <> 'boolean' THEN
    EXECUTE $x$
      ALTER TABLE public.observations
        ALTER COLUMN self_contained TYPE boolean
        USING (
          CASE
            WHEN self_contained IS NULL THEN false
            WHEN lower(btrim(self_contained::text)) IN ('true','t','1','yes','y') THEN true
            WHEN lower(btrim(self_contained::text)) IN ('false','f','0','no','n') THEN false
            ELSE false
          END
        )
    $x$;
    RAISE NOTICE 'Fixed self_contained type (was %)', v_type;
  END IF;
END;
$$;

-- Ensure defaults are set
ALTER TABLE public.observations
  ALTER COLUMN nights_stayed_this_month SET DEFAULT 0,
  ALTER COLUMN consecutive_nights SET DEFAULT 0,
  ALTER COLUMN is_compliant SET DEFAULT true,
  ALTER COLUMN self_contained SET DEFAULT false;

-- ============================================================================
-- PART 3: Replace trigger function with exception-wrapped version
-- ============================================================================
-- Key changes from previous versions:
--   1. Uses pg_typeof() check to detect column type at runtime
--   2. Uses BEGIN/EXCEPTION blocks to catch ANY conversion error
--   3. NEVER uses COALESCE(column, integer_literal) pattern
--   4. Assigns sanitized values to local variables first

-- Drop legacy triggers that may exist
DROP TRIGGER IF EXISTS trigger_auto_compliance_check ON public.observations;
DROP TRIGGER IF EXISTS trg_auto_evaluate_compliance ON public.observations;

CREATE OR REPLACE FUNCTION public.auto_evaluate_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  -- ============================================================================
  -- SAFE TYPE CONVERSION: Handle INTEGER, TEXT, or NULL column values
  -- Each block catches ALL exceptions and falls back to safe defaults.
  -- This prevents "COALESCE types integer and text cannot be matched" errors.
  -- ============================================================================
  
  -- Convert nights_stayed_this_month
  BEGIN
    IF NEW.nights_stayed_this_month IS NULL THEN
      v_nights_stayed := 0;
    ELSIF pg_typeof(NEW.nights_stayed_this_month)::text = 'integer' THEN
      v_nights_stayed := NEW.nights_stayed_this_month;
    ELSE
      -- Column is TEXT or other type - extract digits and convert
      v_nights_stayed := NULLIF(
        regexp_replace(NEW.nights_stayed_this_month::text, '[^0-9]', '', 'g'),
        ''
      )::integer;
    END IF;
    IF v_nights_stayed IS NULL OR v_nights_stayed < 0 THEN
      v_nights_stayed := 0;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_nights_stayed := 0;
  END;

  -- Convert consecutive_nights
  BEGIN
    IF NEW.consecutive_nights IS NULL THEN
      v_consecutive := 0;
    ELSIF pg_typeof(NEW.consecutive_nights)::text = 'integer' THEN
      v_consecutive := NEW.consecutive_nights;
    ELSE
      v_consecutive := NULLIF(
        regexp_replace(NEW.consecutive_nights::text, '[^0-9]', '', 'g'),
        ''
      )::integer;
    END IF;
    IF v_consecutive IS NULL OR v_consecutive < 0 THEN
      v_consecutive := 0;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_consecutive := 0;
  END;

  -- Convert self_contained
  BEGIN
    IF NEW.self_contained IS NULL THEN
      v_self_contained := false;
    ELSIF pg_typeof(NEW.self_contained)::text = 'boolean' THEN
      v_self_contained := NEW.self_contained;
    ELSE
      v_self_contained := lower(NEW.self_contained::text) IN ('true','t','1','yes','y');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_self_contained := false;
  END;

  -- ============================================================================
  -- LOOKUP COMPLIANCE RULES
  -- ============================================================================

  -- Try zone_compliance_matrix first
  SELECT *
    INTO v_matrix
    FROM zone_compliance_matrix
   WHERE zone_id = NEW.zone_id
     AND effective_from <= NEW.recorded_at
     AND (effective_to IS NULL OR effective_to > NEW.recorded_at)
   ORDER BY version DESC
   LIMIT 1;

  -- Fallback to zones table
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
      -- No zone rules - set sanitized values and return
      NEW.nights_stayed_this_month := v_nights_stayed;
      NEW.consecutive_nights := v_consecutive;
      RETURN NEW;
    END IF;
  END IF;

  -- ============================================================================
  -- CHECK HOMELESS STATUS
  -- ============================================================================

  BEGIN
    SELECT (homeless_status = 'confirmed')
      INTO v_is_homeless
      FROM canonical_vehicles
     WHERE plate_number = NEW.plate_number;

    IF NOT FOUND THEN
      v_is_homeless := false;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_is_homeless := false;
  END;

  -- ============================================================================
  -- EVALUATE COMPLIANCE RULES
  -- ============================================================================

  -- Rule 1: Day-visit-only zone
  IF v_matrix.day_visit_only IS NOT NULL AND v_matrix.day_visit_only THEN
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
      IF NOT (v_is_homeless AND (v_matrix.homeless_exemption IS NULL OR v_matrix.homeless_exemption)) THEN
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
      IF NOT (v_is_homeless AND (v_matrix.homeless_exemption IS NULL OR v_matrix.homeless_exemption)) THEN
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
    (v_matrix.self_contained_required IS NOT NULL AND v_matrix.self_contained_required) OR
    (v_matrix.requires_csc IS NOT NULL AND v_matrix.requires_csc)
  ) THEN
    IF NOT v_self_contained THEN
      IF NOT (v_is_homeless AND (v_matrix.homeless_exemption IS NULL OR v_matrix.homeless_exemption)) THEN
        v_is_compliant := false;
        v_breach_type := 'self_contained';
        v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
      END IF;
    END IF;
  END IF;

  -- ============================================================================
  -- WRITE RESULTS BACK TO ROW
  -- ============================================================================

  NEW.nights_stayed_this_month := v_nights_stayed;
  NEW.consecutive_nights := v_consecutive;
  NEW.is_compliant := v_is_compliant;
  NEW.breach_type := v_breach_type;
  NEW.breach_reason := v_breach_reason;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.auto_evaluate_compliance() IS
  'BEFORE INSERT trigger: Evaluates compliance rules and sets is_compliant, '
  'breach_type, breach_reason. Uses exception-wrapped type conversion to '
  'prevent COALESCE type mismatch errors from column type drift.';

-- Recreate trigger
CREATE TRIGGER trg_auto_evaluate_compliance
  BEFORE INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_evaluate_compliance();

COMMENT ON TRIGGER trg_auto_evaluate_compliance ON public.observations IS
  'Evaluates compliance rules before each observation insert.';

-- ============================================================================
-- PART 4: Force PostgREST schema cache reload
-- ============================================================================

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- PART 5: Verification
-- ============================================================================

DO $$
DECLARE
  v_nsm_type text;
  v_cn_type  text;
  v_ic_type  text;
  v_sc_type  text;
  v_trigger_exists boolean;
BEGIN
  SELECT data_type INTO v_nsm_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'nights_stayed_this_month';

  SELECT data_type INTO v_cn_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'consecutive_nights';

  SELECT data_type INTO v_ic_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'is_compliant';

  SELECT data_type INTO v_sc_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'self_contained';

  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'observations'
      AND t.tgname  = 'trg_auto_evaluate_compliance'
  ) INTO v_trigger_exists;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  20260401000002_hotfix_coalesce_type_mismatch - COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  Column types:';
  RAISE NOTICE '    nights_stayed_this_month: % %', v_nsm_type,
    CASE WHEN v_nsm_type = 'integer' THEN '✓' ELSE '✗ EXPECTED integer' END;
  RAISE NOTICE '    consecutive_nights:       % %', v_cn_type,
    CASE WHEN v_cn_type = 'integer' THEN '✓' ELSE '✗ EXPECTED integer' END;
  RAISE NOTICE '    is_compliant:             % %', v_ic_type,
    CASE WHEN v_ic_type = 'boolean' THEN '✓' ELSE '✗ EXPECTED boolean' END;
  RAISE NOTICE '    self_contained:           % %', v_sc_type,
    CASE WHEN v_sc_type = 'boolean' THEN '✓' ELSE '✗ EXPECTED boolean' END;
  RAISE NOTICE '';
  RAISE NOTICE '  Trigger: trg_auto_evaluate_compliance: %',
    CASE WHEN v_trigger_exists THEN 'OK ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '';
  RAISE NOTICE '  PostgREST schema cache reload: ISSUED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;

COMMIT;
