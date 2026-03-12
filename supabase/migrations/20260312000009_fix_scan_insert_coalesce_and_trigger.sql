-- ============================================================================
-- Fix scan insert failure: COALESCE types integer and text cannot be matched
-- Date: 2026-03-12
--
-- Symptoms fixed:
--   • Direct insert fallback (and vehicle-ingest) fails on observations INSERT
--     with: "COALESCE types integer and text cannot be matched"
--
-- Root cause:
--   A BEFORE INSERT trigger on public.observations (auto_evaluate_compliance)
--   executes COALESCE(NEW.nights_stayed_this_month, 0) and
--   COALESCE(NEW.consecutive_nights, 0), but in some DB states these columns
--   carry a TEXT type instead of INTEGER (drift from schema-cache misses or
--   partial migration application).  PostgreSQL cannot implicitly coerce between
--   integer and text inside COALESCE, causing every INSERT to fail.
--
-- This migration:
--   1. Ensures nights_stayed_this_month and consecutive_nights are INTEGER,
--      converting TEXT → INTEGER safely when needed.
--   2. Ensures is_compliant is BOOLEAN (defensive guard).
--   3. Sets/restores DEFAULT values for these columns.
--   4. Drops any legacy compliance trigger that may have been applied manually.
--   5. Recreates auto_evaluate_compliance() with explicit integer casts so it
--      is safe regardless of the column's current storage type.
--   6. Attaches trg_auto_evaluate_compliance BEFORE INSERT on observations.
--   7. Issues NOTIFY pgrst, 'reload schema' to refresh PostgREST cache.
-- ============================================================================

BEGIN;

-- ── 1. Add columns IF NOT EXISTS (safe no-op when already present) ─────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS nights_stayed_this_month integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_nights        integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_compliant              boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS breach_type               text,
  ADD COLUMN IF NOT EXISTS breach_reason             text;

-- ── 2. Coerce column types to the expected base types ──────────────────────
--      Uses information_schema to detect drift; ALTER TYPE is only executed
--      when the stored type does not match.  Each USING clause safely converts
--      NULL / empty / non-numeric text to 0.

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

-- ── 3. Restore / confirm correct DEFAULT values ────────────────────────────

ALTER TABLE public.observations
  ALTER COLUMN nights_stayed_this_month SET DEFAULT 0,
  ALTER COLUMN consecutive_nights        SET DEFAULT 0,
  ALTER COLUMN is_compliant              SET DEFAULT true;

-- ── 4. Drop legacy compliance triggers (any name, BEFORE INSERT) ───────────
--      The old trigger_auto_compliance_check called auto_evaluate_compliance_
--      and_create_breach which references the dropped compliance_results table
--      and causes "COALESCE integer/text" or "relation does not exist" errors.

DROP TRIGGER IF EXISTS trigger_auto_compliance_check ON public.observations;
DROP TRIGGER IF EXISTS trg_auto_evaluate_compliance  ON public.observations;

-- ── 5. Recreate auto_evaluate_compliance() with defensive integer casts ─────
--      Explicit ::integer casts on nights_stayed_this_month and
--      consecutive_nights ensure the function compiles and runs correctly
--      regardless of the column's physical storage type.

CREATE OR REPLACE FUNCTION public.auto_evaluate_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matrix         RECORD;
  v_is_homeless    BOOLEAN := false;
  v_nz_hour        INTEGER;
  v_is_compliant   BOOLEAN := true;
  v_breach_type    TEXT    := NULL;
  v_breach_reason  TEXT    := NULL;
  v_nights_stayed  INTEGER := 0;
  v_consecutive    INTEGER := 0;
  v_self_contained BOOLEAN := false;
BEGIN
  -- Safely cast NEW columns to integer regardless of physical storage type.
  v_nights_stayed := COALESCE(
    NULLIF(regexp_replace(COALESCE(NEW.nights_stayed_this_month::text, ''), '[^0-9-]', '', 'g'), '')::integer,
    0
  );
  v_consecutive := COALESCE(
    NULLIF(regexp_replace(COALESCE(NEW.consecutive_nights::text, ''), '[^0-9-]', '', 'g'), '')::integer,
    0
  );
  v_self_contained := lower(COALESCE(NEW.self_contained::text, 'false')) IN ('true', 't', '1', 'yes', 'y');

  -- Lookup active compliance matrix for this zone at observation time.
  SELECT *
    INTO v_matrix
    FROM zone_compliance_matrix
   WHERE zone_id = NEW.zone_id
     AND effective_from <= NEW.recorded_at
     AND (effective_to IS NULL OR effective_to > NEW.recorded_at)
   ORDER BY version DESC
   LIMIT 1;

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
      -- No zone rules — leave compliance as caller set it.
      NEW.nights_stayed_this_month := v_nights_stayed;
      NEW.consecutive_nights       := v_consecutive;
      RETURN NEW;
    END IF;
  END IF;

  -- Check homeless status.
  SELECT (homeless_status = 'confirmed')
    INTO v_is_homeless
    FROM canonical_vehicles
   WHERE plate_number = NEW.plate_number;

  IF NOT FOUND THEN
    v_is_homeless := false;
  END IF;

  -- Rule 1: Day-visit-only zone.
  IF COALESCE(v_matrix.day_visit_only, false) THEN
    v_nz_hour := EXTRACT(HOUR FROM NEW.recorded_at AT TIME ZONE 'Pacific/Auckland')::integer;
    IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
      v_is_compliant  := false;
      v_breach_type   := 'day_visit_violation';
      v_breach_reason := format('Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour);
    END IF;
  END IF;

  -- Rule 2: Monthly nights limit.
  IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL THEN
    IF v_nights_stayed > v_matrix.nights_per_month THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant  := false;
        v_breach_type   := 'monthly_limit';
        v_breach_reason := format(
          'Exceeded monthly stay limit: %s nights stayed, limit is %s',
          v_nights_stayed, v_matrix.nights_per_month
        );
      END IF;
    END IF;
  END IF;

  -- Rule 3: Consecutive nights limit.
  IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL THEN
    IF v_consecutive > v_matrix.max_consecutive_nights THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant  := false;
        v_breach_type   := 'consecutive_nights';
        v_breach_reason := format(
          'Exceeded consecutive nights limit: %s consecutive nights, limit is %s',
          v_consecutive, v_matrix.max_consecutive_nights
        );
      END IF;
    END IF;
  END IF;

  -- Rule 4: Self-contained / CSC requirement.
  IF v_is_compliant AND (
    COALESCE(v_matrix.self_contained_required, false) OR
    COALESCE(v_matrix.requires_csc, false)
  ) THEN
    IF NOT v_self_contained THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant  := false;
        v_breach_type   := 'self_contained';
        v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
      END IF;
    END IF;
  END IF;

  -- Write evaluated values back to the new row.
  NEW.nights_stayed_this_month := v_nights_stayed;
  NEW.consecutive_nights       := v_consecutive;
  NEW.is_compliant             := v_is_compliant;
  NEW.breach_type              := v_breach_type;
  NEW.breach_reason            := v_breach_reason;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_evaluate_compliance() IS
  'BEFORE INSERT trigger: evaluates zone compliance rules and stamps '
  'is_compliant / breach_type / breach_reason / nights_stayed_this_month / '
  'consecutive_nights onto each new observation row.  Uses explicit casts so '
  'it is safe regardless of the physical column storage type.';

-- ── 6. Attach trigger ──────────────────────────────────────────────────────

CREATE TRIGGER trg_auto_evaluate_compliance
  BEFORE INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_evaluate_compliance();

COMMENT ON TRIGGER trg_auto_evaluate_compliance ON public.observations IS
  'Stamps compliance result onto every new observation before it is written.';

-- ── 7. Force PostgREST schema cache reload ────────────────────────────────

NOTIFY pgrst, 'reload schema';

-- ── 8. Verification ───────────────────────────────────────────────────────

DO $$
DECLARE
  v_nsm_type  text;
  v_cn_type   text;
  v_trig_ok   boolean;
BEGIN
  SELECT data_type INTO v_nsm_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'nights_stayed_this_month';

  SELECT data_type INTO v_cn_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'consecutive_nights';

  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c  ON t.tgrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'observations'
      AND t.tgname  = 'trg_auto_evaluate_compliance'
  ) INTO v_trig_ok;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260312000009_fix_scan_insert_coalesce_and_trigger complete';
  RAISE NOTICE '   nights_stayed_this_month type : %', COALESCE(v_nsm_type, 'MISSING');
  RAISE NOTICE '   consecutive_nights type       : %', COALESCE(v_cn_type,  'MISSING');
  RAISE NOTICE '   trg_auto_evaluate_compliance  : %', CASE WHEN v_trig_ok THEN 'present' ELSE 'MISSING' END;
  RAISE NOTICE '';
END;
$$;

COMMIT;
