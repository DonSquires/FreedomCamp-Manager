-- ============================================================
-- Auto-Context Spatial Brain (GPS -> Zone -> Contract -> PTT)
-- ============================================================
-- Purpose:
--   Resolve an officer's operational context from coordinates by joining:
--   1) active zone polygon containment,
--   2) active provider<->client contract,
--   3) optional PTT contract authorization metadata.
--
-- Result:
--   A single JSON payload suitable for frontend "context swap" behavior.
--
-- Notes:
--   - Uses PostGIS geography/geometry operators.
--   - Uses SECURITY DEFINER with fixed search_path.
--   - If overlapping zones are detected and no preferred client org is passed,
--     returns conflict=true with options for officer selection.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS geom geography(POLYGON, 4326);

CREATE OR REPLACE FUNCTION public.resolve_geofence_operational_context(
  p_provider_org_id UUID,
  p_longitude DOUBLE PRECISION,
  p_latitude DOUBLE PRECISION,
  p_preferred_client_org_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT auth.uid(),
  p_default_translation_lang TEXT DEFAULT 'hi-IN'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_point geometry(POINT, 4326);
  v_user_role TEXT := NULL;
  v_overlap_count INTEGER := 0;
  v_selected RECORD;
  v_ptt RECORD;
  v_now DATE := CURRENT_DATE;
BEGIN
  IF p_provider_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'provider_org_required'
    );
  END IF;

  IF p_longitude IS NULL OR p_latitude IS NULL THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'coordinates_required'
    );
  END IF;

  -- Optional caller enforcement when a user context exists.
  IF p_user_id IS NOT NULL THEN
    SELECT up.role INTO v_user_role
    FROM public.user_profiles up
    WHERE up.id = p_user_id;

    IF v_user_role IS NULL THEN
      RETURN jsonb_build_object(
        'matched', false,
        'reason', 'user_not_found'
      );
    END IF;

    IF v_user_role NOT IN ('master', 'grand_master') THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = p_user_id
          AND (
            up.organization_id = p_provider_org_id
            OR p_provider_org_id = ANY(COALESCE(up.extra_organization_ids, ARRAY[]::UUID[]))
            OR p_provider_org_id = ANY(COALESCE(up.authorized_work_locations, ARRAY[]::UUID[]))
            OR up.employer_organization_id = p_provider_org_id
          )
      ) THEN
        RETURN jsonb_build_object(
          'matched', false,
          'reason', 'provider_org_not_authorized'
        );
      END IF;
    END IF;
  END IF;

  v_point := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326);

  WITH candidate_contexts AS (
    SELECT
      z.id AS zone_id,
      z.name AS zone_name,
      z.zone_type,
      z.organization_id AS client_org_id,
      z.bylaw_reference,
      z.bylaw_clause,
      z.land_manager,
      c.id AS contract_id,
      c.status AS contract_status,
      c.start_date,
      c.end_date
    FROM public.zones z
    JOIN public.crm_contracts c
      ON c.client_organization_id = z.organization_id
     AND c.provider_organization_id = p_provider_org_id
    WHERE COALESCE(z.is_active, TRUE) = TRUE
      AND c.status = 'active'
      AND c.start_date <= v_now
      AND (c.end_date IS NULL OR c.end_date >= v_now)
      AND z.geom IS NOT NULL
      AND ST_Covers(z.geom::geometry, v_point)
  )
  SELECT COUNT(*) INTO v_overlap_count
  FROM candidate_contexts;

  IF v_overlap_count = 0 THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'no_matching_zone_or_active_contract',
      'provider_org_id', p_provider_org_id,
      'point', jsonb_build_object('longitude', p_longitude, 'latitude', p_latitude)
    );
  END IF;

  IF v_overlap_count > 1 AND p_preferred_client_org_id IS NULL THEN
    RETURN (
      WITH candidate_contexts AS (
        SELECT
          z.id AS zone_id,
          z.name AS zone_name,
          z.zone_type,
          z.organization_id AS client_org_id,
          z.bylaw_reference,
          z.bylaw_clause,
          z.land_manager,
          c.id AS contract_id
        FROM public.zones z
        JOIN public.crm_contracts c
          ON c.client_organization_id = z.organization_id
         AND c.provider_organization_id = p_provider_org_id
        WHERE COALESCE(z.is_active, TRUE) = TRUE
          AND c.status = 'active'
          AND c.start_date <= v_now
          AND (c.end_date IS NULL OR c.end_date >= v_now)
          AND z.geom IS NOT NULL
          AND ST_Covers(z.geom::geometry, v_point)
      )
      SELECT jsonb_build_object(
        'matched', true,
        'conflict', true,
        'reason', 'overlapping_jurisdictions',
        'overlap_count', v_overlap_count,
        'options', jsonb_agg(
          jsonb_build_object(
            'zone_id', cc.zone_id,
            'zone_name', cc.zone_name,
            'zone_type', cc.zone_type,
            'client_org_id', cc.client_org_id,
            'contract_id', cc.contract_id,
            'land_manager', cc.land_manager,
            'bylaw_reference', cc.bylaw_reference,
            'bylaw_clause', cc.bylaw_clause
          )
        )
      )
      FROM candidate_contexts cc
    );
  END IF;

  SELECT * INTO v_selected
  FROM (
    SELECT
      z.id AS zone_id,
      z.name AS zone_name,
      z.zone_type,
      z.organization_id AS client_org_id,
      z.bylaw_reference,
      z.bylaw_clause,
      z.land_manager,
      c.id AS contract_id,
      c.provider_organization_id,
      c.client_organization_id
    FROM public.zones z
    JOIN public.crm_contracts c
      ON c.client_organization_id = z.organization_id
     AND c.provider_organization_id = p_provider_org_id
    WHERE COALESCE(z.is_active, TRUE) = TRUE
      AND c.status = 'active'
      AND c.start_date <= v_now
      AND (c.end_date IS NULL OR c.end_date >= v_now)
      AND z.geom IS NOT NULL
      AND ST_Covers(z.geom::geometry, v_point)
    ORDER BY
      CASE WHEN p_preferred_client_org_id IS NOT NULL AND z.organization_id = p_preferred_client_org_id THEN 0 ELSE 1 END,
      z.id
    LIMIT 1
  ) chosen;

  IF v_selected IS NULL THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'selection_failed'
    );
  END IF;

  SELECT pca.* INTO v_ptt
  FROM public.ptt_contract_authorizations pca
  WHERE pca.contract_id = v_selected.contract_id
    AND pca.provider_org_id = v_selected.provider_organization_id
    AND pca.client_org_id = v_selected.client_organization_id
    AND COALESCE(pca.is_active, TRUE) = TRUE
  LIMIT 1;

  RETURN jsonb_build_object(
    'matched', true,
    'conflict', false,
    'provider_org_id', p_provider_org_id,
    'client_org_id', v_selected.client_org_id,
    'zone_id', v_selected.zone_id,
    'zone_name', v_selected.zone_name,
    'zone_type', v_selected.zone_type,
    'land_manager', v_selected.land_manager,
    'contract_id', v_selected.contract_id,
    'ptt_channel', CASE
      WHEN v_ptt.channel_name IS NOT NULL THEN v_ptt.channel_name
      ELSE 'contract:' || v_selected.contract_id::TEXT
    END,
    'ptt_channel_scope', CASE
      WHEN v_ptt.channel_key IS NOT NULL THEN v_ptt.channel_key
      ELSE 'contract:' || v_selected.contract_id::TEXT
    END,
    'ai_persona', CASE
      WHEN COALESCE(v_selected.zone_type, '') ILIKE '%parking%' THEN 'Tactical_Enforcer'
      WHEN COALESCE(v_selected.zone_type, '') ILIKE '%freedom%' OR COALESCE(v_selected.zone_type, '') ILIKE '%camp%' THEN 'Diplomatic_Enforcer'
      ELSE 'Standard_Enforcer'
    END,
    'translation_active', CASE
      WHEN COALESCE(v_selected.zone_type, '') ILIKE '%freedom%' OR COALESCE(v_selected.zone_type, '') ILIKE '%camp%' THEN true
      ELSE false
    END,
    'translation_target', p_default_translation_lang,
    'bylaw_reference', v_selected.bylaw_reference,
    'bylaw_clause', v_selected.bylaw_clause,
    'resolved_at', now(),
    'point', jsonb_build_object('longitude', p_longitude, 'latitude', p_latitude)
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_geofence_operational_context(UUID, DOUBLE PRECISION, DOUBLE PRECISION, UUID, UUID, TEXT)
IS 'Resolves active operational context from GPS coordinate by matching active zone polygon + active provider/client contract + optional PTT contract authorization.';

GRANT EXECUTE ON FUNCTION public.resolve_geofence_operational_context(UUID, DOUBLE PRECISION, DOUBLE PRECISION, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_geofence_operational_context(UUID, DOUBLE PRECISION, DOUBLE PRECISION, UUID, UUID, TEXT) TO service_role;
