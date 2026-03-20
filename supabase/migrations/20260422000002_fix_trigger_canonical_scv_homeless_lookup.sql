-- ============================================================================
-- Fix: auto_evaluate_compliance trigger — canonical_scv and canonical_homeless
-- ============================================================================
-- Problem:
--   The trigger reads self_contained directly from NEW.self_contained (the
--   inserted observation row) and homeless status only from
--   canonical_vehicles.homeless_status.  This means:
--
--   1. When an observation is inserted with self_contained = NULL (e.g. for a
--      plate not yet enriched from the SCV list), the trigger evaluates the
--      vehicle as non-self-contained and immediately marks it as a breach —
--      even when canonical_scv holds confirmed SCV certification for that plate.
--
--   2. Homeless exemptions stored in canonical_homeless (the cross-org
--      authoritative table) are ignored, causing incorrect breaches for
--      homeless vehicles whose status was not backfilled to canonical_vehicles.
--
-- Fix:
--   • SCV status exclusively from canonical_scv.  When NEW.self_contained is
--     NULL or FALSE, query canonical_scv for confirmed, non-expired certification.
--   • Homeless status exclusively from canonical_homeless.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_evaluate_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_matrix           RECORD;
  v_is_homeless      BOOLEAN := false;
  v_homeless_status  TEXT    := NULL;
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
  -- ============================================================================

  -- Convert nights_stayed_this_month
  BEGIN
    IF NEW.nights_stayed_this_month IS NULL THEN
      v_nights_stayed := 0;
    ELSIF pg_typeof(NEW.nights_stayed_this_month)::text = 'integer' THEN
      v_nights_stayed := NEW.nights_stayed_this_month;
    ELSE
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

  -- Convert self_contained from observation row
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

  -- ── SCV: if observation has no positive SCV evidence, consult canonical_scv ──
  -- canonical_scv is the authoritative SCV registry (populated by sync-scv-list).
  IF NOT v_self_contained
     AND NEW.plate_number IS NOT NULL
     AND NEW.plate_number <> 'MANUAL_REQUIRED'
  THEN
    BEGIN
      SELECT is_self_contained
        INTO v_self_contained
        FROM canonical_scv
       WHERE plate_number = NEW.plate_number
         AND is_self_contained = true
         AND (certificate_expiry IS NULL OR certificate_expiry >= CURRENT_DATE)
       LIMIT 1;

      IF NOT FOUND THEN
        v_self_contained := false;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_self_contained := false;
    END;
  END IF;

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
  -- HOMELESS STATUS exclusively from canonical_homeless
  -- ============================================================================

  IF NEW.plate_number IS NOT NULL AND NEW.plate_number <> 'MANUAL_REQUIRED' THEN
    BEGIN
      SELECT status
        INTO v_homeless_status
        FROM canonical_homeless
       WHERE plate_number = NEW.plate_number
       LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_homeless_status := NULL;
    END;
  END IF;

  v_is_homeless := v_homeless_status IN ('confirmed', 'claimed');

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
  'breach_type, breach_reason. SCV status from canonical_scv only. '
  'Homeless status from canonical_homeless only. Uses exception-wrapped type '
  'conversion to prevent COALESCE type mismatch errors from column type drift.';

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');
