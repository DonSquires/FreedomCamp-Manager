-- ============================================================================
-- FIX SCHEMA FUNCTIONS – new observations architecture
-- Date: 2026-03-18
--
-- The 20260221_rebuild_observations_clean.sql migration dropped:
--   • observations   (CASCADE removed all dependent FK/triggers)
--   • compliance_results        (CASCADE removed all dependent FK/triggers)
--
-- This migration replaces every SQL function and trigger that still
-- referenced those dropped tables with equivalents that use the current
-- `observations` table, which stores compliance state directly
-- (is_compliant, breach_type, breach_reason, nights_stayed_this_month,
--  consecutive_nights).
--
-- Changes:
--   1. auto_evaluate_compliance()  – BEFORE INSERT trigger fn on observations
--   2. trg_auto_evaluate_compliance – trigger on observations
--   3. get_observation_result()    – Layer-4 RPC rewritten for observations
--   4. evaluate_observation_requirements() – rewritten for observations
--   5. cohort_overstayers()        – rewritten (was JOIN on compliance_results)
--   6. cohort_homeless_exempt()    – rewritten (was JOIN on compliance_results)
--   7. cohort_all_breaches()       – rewritten (was JOIN on compliance_results)
--   8. recompute_all_compliance_since_effective_date() – stub redirects to
--      recalculate-compliance edge function
--   9. Drop stale functions that can no longer run:
--        evaluate_compliance_v4, pipeline_layer_2_and_3
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. auto_evaluate_compliance()
--    Called by BEFORE INSERT trigger on observations.
--    Reads zone compliance rules and sets is_compliant / breach_type /
--    breach_reason on NEW before the row is written.
-- ============================================================================

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
BEGIN
  -- ── Lookup active compliance matrix for this zone at observation time ─────
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
      self_contained_required  AS requires_csc,
      nights_per_month,
      max_consecutive_nights,
      day_visit_only,
      TRUE                     AS homeless_exemption
    INTO v_matrix
    FROM zones
   WHERE id = NEW.zone_id;

    IF NOT FOUND THEN
      -- No zone rules at all – leave compliance as the caller set it
      RETURN NEW;
    END IF;
  END IF;

  -- ── Check homeless status ─────────────────────────────────────────────────
  SELECT (homeless_status = 'confirmed')
    INTO v_is_homeless
    FROM canonical_vehicles
   WHERE plate_number = NEW.plate_number;
  IF NOT FOUND THEN
    v_is_homeless := false;
  END IF;

  -- ── Rule 1: Day-visit-only zone ───────────────────────────────────────────
  IF COALESCE(v_matrix.day_visit_only, false) THEN
    v_nz_hour := EXTRACT(HOUR FROM NEW.recorded_at AT TIME ZONE 'Pacific/Auckland')::INTEGER;
    IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
      v_is_compliant := false;
      v_breach_type  := 'day_visit_violation';
      v_breach_reason := format(
        'Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour
      );
    END IF;
  END IF;

  -- ── Rule 2: Monthly nights limit ──────────────────────────────────────────
  IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL THEN
    IF COALESCE(NEW.nights_stayed_this_month, 0) > v_matrix.nights_per_month THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type  := 'monthly_limit';
        v_breach_reason := format(
          'Exceeded monthly stay limit: %s nights stayed, limit is %s',
          COALESCE(NEW.nights_stayed_this_month, 0),
          v_matrix.nights_per_month
        );
      END IF;
    END IF;
  END IF;

  -- ── Rule 3: Consecutive nights limit ─────────────────────────────────────
  IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL THEN
    IF COALESCE(NEW.consecutive_nights, 0) > v_matrix.max_consecutive_nights THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type  := 'consecutive_nights';
        v_breach_reason := format(
          'Exceeded consecutive nights limit: %s consecutive nights, limit is %s',
          COALESCE(NEW.consecutive_nights, 0),
          v_matrix.max_consecutive_nights
        );
      END IF;
    END IF;
  END IF;

  -- ── Rule 4: Self-contained / CSC requirement ──────────────────────────────
  IF v_is_compliant AND (
    COALESCE(v_matrix.self_contained_required, false) OR
    COALESCE(v_matrix.requires_csc, false)
  ) THEN
    IF NOT COALESCE(NEW.self_contained, false) THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type  := 'self_contained';
        v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
      END IF;
    END IF;
  END IF;

  -- ── Write evaluated compliance back onto the row ──────────────────────────
  NEW.is_compliant  := v_is_compliant;
  NEW.breach_type   := v_breach_type;
  NEW.breach_reason := v_breach_reason;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_evaluate_compliance() IS
  'BEFORE INSERT trigger function: evaluates compliance rules from '
  'zone_compliance_matrix and writes is_compliant/breach_type/breach_reason '
  'onto the new observations row before it is persisted.';

-- ============================================================================
-- 2. Attach trigger to observations
-- ============================================================================

DROP TRIGGER IF EXISTS trg_auto_evaluate_compliance ON public.observations;
CREATE TRIGGER trg_auto_evaluate_compliance
  BEFORE INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_evaluate_compliance();

COMMENT ON TRIGGER trg_auto_evaluate_compliance ON public.observations IS
  'Auto-evaluates compliance on every new observation row using zone rules.';

-- ============================================================================
-- 3. get_observation_result() – Layer-4 RPC
--    Previously queried observations + compliance_results.
--    Rewritten to use observations table directly.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_observation_result(p_observation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obs          observations%ROWTYPE;
  v_zone         zones%ROWTYPE;
  v_is_homeless  BOOLEAN := false;
  v_status       TEXT;
  v_summary      TEXT;
  v_action_req   BOOLEAN;
  v_rec_action   TEXT;
BEGIN
  -- Load observation
  SELECT * INTO v_obs FROM observations WHERE id = p_observation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Observation not found');
  END IF;

  -- Load zone
  SELECT * INTO v_zone FROM zones WHERE id = v_obs.zone_id;

  -- Check homeless status
  SELECT (homeless_status = 'confirmed')
    INTO v_is_homeless
    FROM canonical_vehicles
   WHERE plate_number = v_obs.plate_number;
  IF NOT FOUND THEN v_is_homeless := false; END IF;

  -- Determine status
  IF v_is_homeless THEN
    v_status     := 'BREACH_EXEMPT';
    v_summary    := 'Vehicle is under the Freedom Camping Act – homeless exemption applies';
    v_action_req := false;
    v_rec_action := 'Refer to welfare services';
  ELSIF COALESCE(v_obs.is_compliant, true) THEN
    v_status     := 'COMPLIANT';
    v_summary    := 'Vehicle is compliant with all zone requirements';
    v_action_req := false;
    v_rec_action := 'No action required';
  ELSE
    v_status     := 'BREACH';
    v_summary    := COALESCE(v_obs.breach_reason, format('Breach: %s', v_obs.breach_type));
    v_action_req := true;
    v_rec_action := 'Issue warning or notice';
  END IF;

  RETURN jsonb_build_object(
    'observation_id',     p_observation_id,
    'plate_number',       v_obs.plate_number,
    'zone_name',          v_zone.name,
    'overall_status',     v_status,
    'action_required',    v_action_req,
    'summary',            v_summary,
    'breach_type',        v_obs.breach_type,
    'breach_reason',      v_obs.breach_reason,
    'nights_stayed',      v_obs.nights_stayed_this_month,
    'consecutive_nights', v_obs.consecutive_nights,
    'recommended_action', v_rec_action
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_observation_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_observation_result(uuid) TO service_role;

COMMENT ON FUNCTION public.get_observation_result(uuid) IS
  'Layer-4 RPC: returns compliance result formatted for the Officer App. '
  'Reads directly from the observations table (compliance_results was dropped).';

-- ============================================================================
-- 4. evaluate_observation_requirements() – simplified RPC
--    Previously queried observations + compliance_results.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.evaluate_observation_requirements(p_observation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obs observations%ROWTYPE;
BEGIN
  SELECT * INTO v_obs FROM observations WHERE id = p_observation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Observation not found');
  END IF;

  RETURN jsonb_build_object(
    'is_compliant',       COALESCE(v_obs.is_compliant, true),
    'breach_type',        v_obs.breach_type,
    'breach_reason',      v_obs.breach_reason,
    'nights_stayed',      v_obs.nights_stayed_this_month,
    'consecutive_nights', v_obs.consecutive_nights,
    'self_contained',     v_obs.self_contained
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_observation_requirements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_observation_requirements(uuid) TO service_role;

COMMENT ON FUNCTION public.evaluate_observation_requirements(uuid) IS
  'Returns the compliance state stored on an observation row. '
  'Replaces the old version that read from compliance_results.';

-- ============================================================================
-- 5. cohort_overstayers() – rewritten for observations table
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cohort_overstayers(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (
  observation_id   uuid,
  plate_number     text,
  recorded_at      timestamptz,
  zone_id          uuid,
  zone_name        text,
  violation_reasons text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    obs.id                       AS observation_id,
    obs.plate_number,
    obs.recorded_at,
    obs.zone_id,
    z.name                       AS zone_name,
    ARRAY[obs.breach_type]::text[] AS violation_reasons
  FROM observations obs
  JOIN zones z ON z.id = obs.zone_id
  WHERE obs.deleted_at IS NULL
    AND obs.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id  IS NULL OR obs.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR obs.zone_id          = p_zone_id)
    AND obs.is_compliant = FALSE
    AND obs.breach_type IN ('consecutive_nights', 'monthly_limit')
  ORDER BY obs.recorded_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cohort_overstayers(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cohort_overstayers(timestamptz, timestamptz, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.cohort_overstayers IS
  'Cohort 1: Observations where consecutive or monthly night limits were exceeded. '
  'Reads from observations.is_compliant/breach_type (compliance_results was dropped).';

-- ============================================================================
-- 6. cohort_homeless_exempt() – rewritten for observations table
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cohort_homeless_exempt(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (
  observation_id   uuid,
  plate_number     text,
  recorded_at      timestamptz,
  zone_id          uuid,
  zone_name        text,
  violation_reasons text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    obs.id                       AS observation_id,
    obs.plate_number,
    obs.recorded_at,
    obs.zone_id,
    z.name                       AS zone_name,
    ARRAY[obs.breach_type]::text[] AS violation_reasons
  FROM observations obs
  JOIN zones z ON z.id = obs.zone_id
  -- Only vehicles confirmed as homeless
  JOIN canonical_vehicles cv
    ON cv.plate_number = obs.plate_number
   AND cv.homeless_status = 'confirmed'
  WHERE obs.deleted_at IS NULL
    AND obs.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id  IS NULL OR obs.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR obs.zone_id          = p_zone_id)
  ORDER BY obs.recorded_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.cohort_homeless_exempt IS
  'Cohort 2: Observations for vehicles with confirmed homeless status (eligible for welfare pathway). '
  'Reads from observations + canonical_vehicles (compliance_results was dropped).';

-- ============================================================================
-- 7. cohort_all_breaches() – rewritten for observations table
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cohort_all_breaches(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (
  observation_id    uuid,
  plate_number      text,
  recorded_at       timestamptz,
  zone_id           uuid,
  zone_name         text,
  violation_reasons  text[],
  is_homeless_exempt boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    obs.id                         AS observation_id,
    obs.plate_number,
    obs.recorded_at,
    obs.zone_id,
    z.name                         AS zone_name,
    ARRAY[obs.breach_type]::text[] AS violation_reasons,
    (cv.homeless_status = 'confirmed') AS is_homeless_exempt
  FROM observations obs
  JOIN zones z ON z.id = obs.zone_id
  LEFT JOIN canonical_vehicles cv ON cv.plate_number = obs.plate_number
  WHERE obs.deleted_at IS NULL
    AND obs.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id  IS NULL OR obs.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR obs.zone_id          = p_zone_id)
    AND obs.is_compliant = FALSE
  ORDER BY obs.recorded_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cohort_all_breaches(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cohort_all_breaches(timestamptz, timestamptz, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.cohort_all_breaches IS
  'Cohort 3: All non-compliant observations (including homeless-exempt). '
  'Reads from observations (compliance_results was dropped).';

-- ============================================================================
-- 8. recompute_all_compliance_since_effective_date()
--    Old version looped over observations rows and called
--    evaluate_compliance_v4. Now delegates to SQL-level re-evaluation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_all_compliance_since_effective_date(
  p_effective_from date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count    integer := 0;
  v_changed  integer := 0;
  v_obs      RECORD;
  v_matrix   RECORD;
  v_is_homeless boolean;
  v_is_compliant boolean;
  v_breach_type  text;
  v_breach_reason text;
  v_nz_hour  integer;
BEGIN
  -- Iterate over active observations since the given date
  FOR v_obs IN
    SELECT id, zone_id, plate_number, recorded_at,
           nights_stayed_this_month, consecutive_nights, self_contained,
           is_compliant AS old_is_compliant
    FROM observations
    WHERE deleted_at IS NULL
      AND recorded_at >= (p_effective_from::timestamp AT TIME ZONE 'Pacific/Auckland')
    ORDER BY recorded_at
  LOOP
    -- Fetch active matrix for this zone at observation time
    SELECT *
      INTO v_matrix
      FROM zone_compliance_matrix
     WHERE zone_id = v_obs.zone_id
       AND effective_from <= v_obs.recorded_at
       AND (effective_to IS NULL OR effective_to > v_obs.recorded_at)
     ORDER BY version DESC
     LIMIT 1;

    IF NOT FOUND THEN
      -- Fallback to zone table
      SELECT self_contained_required, self_contained_required AS requires_csc,
             nights_per_month, max_consecutive_nights, day_visit_only, TRUE AS homeless_exemption
        INTO v_matrix
        FROM zones WHERE id = v_obs.zone_id;
    END IF;

    IF v_matrix IS NULL THEN
      v_count := v_count + 1;
      CONTINUE;
    END IF;

    -- Check homeless
    SELECT (homeless_status = 'confirmed') INTO v_is_homeless
      FROM canonical_vehicles WHERE plate_number = v_obs.plate_number;
    IF NOT FOUND THEN v_is_homeless := false; END IF;

    v_is_compliant  := true;
    v_breach_type   := NULL;
    v_breach_reason := NULL;

    -- Day-visit-only
    IF COALESCE(v_matrix.day_visit_only, false) THEN
      v_nz_hour := EXTRACT(HOUR FROM v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland')::INTEGER;
      IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
        v_is_compliant := false;
        v_breach_type  := 'day_visit_violation';
        v_breach_reason := format('Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour);
      END IF;
    END IF;

    -- Monthly limit
    IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL THEN
      IF COALESCE(v_obs.nights_stayed_this_month, 0) > v_matrix.nights_per_month THEN
        IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
          v_is_compliant := false;
          v_breach_type  := 'monthly_limit';
          v_breach_reason := format('Exceeded monthly stay limit: %s nights stayed, limit is %s',
            COALESCE(v_obs.nights_stayed_this_month, 0), v_matrix.nights_per_month);
        END IF;
      END IF;
    END IF;

    -- Consecutive nights
    IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL THEN
      IF COALESCE(v_obs.consecutive_nights, 0) > v_matrix.max_consecutive_nights THEN
        IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
          v_is_compliant := false;
          v_breach_type  := 'consecutive_nights';
          v_breach_reason := format('Exceeded consecutive nights limit: %s consecutive nights, limit is %s',
            COALESCE(v_obs.consecutive_nights, 0), v_matrix.max_consecutive_nights);
        END IF;
      END IF;
    END IF;

    -- Self-contained
    IF v_is_compliant AND (COALESCE(v_matrix.self_contained_required, false) OR COALESCE(v_matrix.requires_csc, false)) THEN
      IF NOT COALESCE(v_obs.self_contained, false) THEN
        IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
          v_is_compliant := false;
          v_breach_type  := 'self_contained';
          v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
        END IF;
      END IF;
    END IF;

    -- Update if changed
    IF v_obs.old_is_compliant IS DISTINCT FROM v_is_compliant THEN
      UPDATE observations
         SET is_compliant  = v_is_compliant,
             breach_type   = v_breach_type,
             breach_reason = v_breach_reason
       WHERE id = v_obs.id;
      v_changed := v_changed + 1;
    END IF;

    v_count := v_count + 1;

    IF v_count % 500 = 0 THEN
      RAISE NOTICE 'Processed % observations...', v_count;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total_observations',   v_count,
    'compliance_changed',   v_changed,
    'effective_from',       p_effective_from
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_all_compliance_since_effective_date(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_all_compliance_since_effective_date(date) TO service_role;

COMMENT ON FUNCTION public.recompute_all_compliance_since_effective_date(date) IS
  'Recomputes compliance for all active observations since the given date. '
  'Replaces old version that used evaluate_compliance_v4 / observations.';

-- ============================================================================
-- 9. Drop stale functions that reference dropped tables
--    (Their triggers on observations were auto-dropped by CASCADE)
-- ============================================================================

DROP FUNCTION IF EXISTS public.evaluate_compliance_v4(uuid);
DROP FUNCTION IF EXISTS public.pipeline_layer_2_and_3();
DROP FUNCTION IF EXISTS public.auto_evaluate_compliance_and_create_breach(uuid);

-- ── Verification ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_trigger_exists  boolean;
  v_fn_auto         boolean;
  v_fn_cohorts      boolean;
  v_fn_get_result   boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'observations'
      AND t.tgname  = 'trg_auto_evaluate_compliance'
  ) INTO v_trigger_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'auto_evaluate_compliance'
  ) INTO v_fn_auto;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cohort_overstayers'
  ) INTO v_fn_cohorts;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_observation_result'
  ) INTO v_fn_get_result;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260318_fix_schema_functions complete';
  RAISE NOTICE '   trg_auto_evaluate_compliance trigger: %',
    CASE WHEN v_trigger_exists THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '   auto_evaluate_compliance():  %', CASE WHEN v_fn_auto    THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '   cohort_overstayers():        %', CASE WHEN v_fn_cohorts THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '   get_observation_result():    %', CASE WHEN v_fn_get_result THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '';
END;
$$;

COMMIT;
