-- ============================================================================
-- Fix observation_id column priority bug
-- Date: 2026-04-02
--
-- The observations table has BOTH columns:
--   observation_id (NOT NULL PK)
--   id (nullable secondary)
--
-- Several RLS policies and SQL functions incorrectly use obs.id instead of
-- obs.observation_id, which silently fails when id is NULL.
--
-- This migration fixes:
--   1. evidence_access_log RLS policy (obs.id → obs.observation_id)
--   2. boundary_review_queue RLS policy (obs.id → obs.observation_id)
--   3. cohort_overstayers() function (obs.id → obs.observation_id)
--   4. cohort_homeless_exempt() function (obs.id → obs.observation_id)
--   5. cohort_all_breaches() function (obs.id → obs.observation_id)
--   6. recompute_all_compliance_since_effective_date() function
--      (SELECT id → observation_id, WHERE id → observation_id)
-- ============================================================================

BEGIN;

-- ── 1. Fix evidence_access_log RLS policy ───────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE tablename = 'evidence_access_log' AND schemaname = 'public'
  ) THEN
    DROP POLICY IF EXISTS "admins_view_evidence_access_log" ON evidence_access_log;

    CREATE POLICY "admins_view_evidence_access_log"
      ON evidence_access_log FOR SELECT
      USING (
        get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
        AND (
          get_user_role(auth.uid()) = 'master'
          OR EXISTS (
            SELECT 1 FROM observations obs
            WHERE obs.observation_id = evidence_access_log.observation_id
            AND obs.organization_id = get_user_organization_id(auth.uid())
          )
        )
      );
  END IF;
END $$;

-- ── 2. Fix boundary_review_queue RLS policy ─────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE tablename = 'boundary_review_queue' AND schemaname = 'public'
  ) THEN
    DROP POLICY IF EXISTS "admins_manage_boundary_review" ON boundary_review_queue;

    CREATE POLICY "admins_manage_boundary_review"
      ON boundary_review_queue FOR ALL
      USING (
        get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
        AND (
          get_user_role(auth.uid()) = 'master'
          OR EXISTS (
            SELECT 1 FROM observations obs
            WHERE obs.observation_id = boundary_review_queue.observation_id
            AND obs.organization_id = get_user_organization_id(auth.uid())
          )
        )
      );
  END IF;
END $$;

-- ── 3. Fix cohort_overstayers() ─────────────────────────────────────────────
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
    obs.observation_id           AS observation_id,
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

-- ── 4. Fix cohort_homeless_exempt() ─────────────────────────────────────────
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
    obs.observation_id           AS observation_id,
    obs.plate_number,
    obs.recorded_at,
    obs.zone_id,
    z.name                       AS zone_name,
    ARRAY[obs.breach_type]::text[] AS violation_reasons
  FROM observations obs
  JOIN zones z ON z.id = obs.zone_id
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

-- ── 5. Fix cohort_all_breaches() ────────────────────────────────────────────
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
    obs.observation_id             AS observation_id,
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

-- ── 6. Fix recompute_all_compliance_since_effective_date() ──────────────────
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
  FOR v_obs IN
    SELECT observation_id, zone_id, plate_number, recorded_at,
           nights_stayed_this_month, consecutive_nights, self_contained,
           is_compliant AS old_is_compliant
    FROM observations
    WHERE deleted_at IS NULL
      AND recorded_at >= (p_effective_from::timestamp AT TIME ZONE 'Pacific/Auckland')
    ORDER BY recorded_at
  LOOP
    SELECT *
      INTO v_matrix
      FROM zone_compliance_matrix
     WHERE zone_id = v_obs.zone_id
       AND effective_from <= v_obs.recorded_at
       AND (effective_to IS NULL OR effective_to > v_obs.recorded_at)
     ORDER BY version DESC
     LIMIT 1;

    IF NOT FOUND THEN
      SELECT self_contained_required, self_contained_required AS requires_csc,
             nights_per_month, max_consecutive_nights, day_visit_only, TRUE AS homeless_exemption
        INTO v_matrix
        FROM zones WHERE id = v_obs.zone_id;
    END IF;

    IF v_matrix IS NULL THEN
      v_count := v_count + 1;
      CONTINUE;
    END IF;

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
       WHERE observation_id = v_obs.observation_id;
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

-- ── Notify PostgREST to reload schema cache ─────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
