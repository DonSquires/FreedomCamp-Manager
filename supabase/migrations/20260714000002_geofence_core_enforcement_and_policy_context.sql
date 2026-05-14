-- =============================================================================
-- Geofence Core Enforcement + Policy Context RPCs
-- Date: 2026-07-14
--
-- Purpose:
-- 1) Enforce geofence-first discipline for active zones/sites/jurisdictions.
-- 2) Provide boundary verification RPCs for officer on-site / off-site evidence.
-- 3) Provide zone policy context payloads for service-specific UI decisions
--    (freedom camping, parking, alarm response, noise control, etc).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

-- -----------------------------------------------------------------------------
-- A) Schema additions (additive, idempotent)
-- -----------------------------------------------------------------------------

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS operational_rules JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS strict_boundary_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.geo_zones
  ADD COLUMN IF NOT EXISTS operational_rules JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS strict_boundary_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.client_sites
  ADD COLUMN IF NOT EXISTS loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

ALTER TABLE public.patrols
  ADD COLUMN IF NOT EXISTS check_out_location_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS check_out_location_lng NUMERIC,
  ADD COLUMN IF NOT EXISTS check_in_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS check_out_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS check_in_boundary_context JSONB,
  ADD COLUMN IF NOT EXISTS check_out_boundary_context JSONB;

ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS geo_zone_id UUID REFERENCES public.geo_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS boundary_context JSONB;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS geo_zone_id UUID REFERENCES public.geo_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS jurisdiction_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS boundary_context JSONB;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_geo_zone_id
  ON public.dispatch_jobs(geo_zone_id)
  WHERE geo_zone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_zone_id
  ON public.incidents(zone_id)
  WHERE zone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_geo_zone_id
  ON public.incidents(geo_zone_id)
  WHERE geo_zone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_loi_id
  ON public.incidents(loi_id)
  WHERE loi_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_sites_loi_id
  ON public.client_sites(loi_id)
  WHERE loi_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- B) Forward enforcement constraints (NOT VALID keeps legacy rows safe while
--    enforcing all new writes/updates)
-- -----------------------------------------------------------------------------

ALTER TABLE public.geo_zones
  DROP CONSTRAINT IF EXISTS geo_zones_active_geofence_required_chk;

ALTER TABLE public.geo_zones
  ADD CONSTRAINT geo_zones_active_geofence_required_chk
  CHECK (
    is_active IS NOT TRUE
    OR (
      strict_boundary_enabled IS FALSE
      OR geom IS NOT NULL
      OR geometry_geojson IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE public.zones
  DROP CONSTRAINT IF EXISTS zones_active_geofence_required_chk;

ALTER TABLE public.zones
  ADD CONSTRAINT zones_active_geofence_required_chk
  CHECK (
    is_active IS NOT TRUE
    OR zone_kind IN ('dispatch', 'location_group')
    OR strict_boundary_enabled IS FALSE
    OR geo_zone_id IS NOT NULL
    OR geometry IS NOT NULL
    OR (location_lat IS NOT NULL AND location_lng IS NOT NULL AND COALESCE(radius_meters, 0) > 0)
  ) NOT VALID;

ALTER TABLE public.client_sites
  DROP CONSTRAINT IF EXISTS client_sites_active_location_required_chk;

ALTER TABLE public.client_sites
  ADD CONSTRAINT client_sites_active_location_required_chk
  CHECK (
    is_active IS NOT TRUE
    OR (
      (zone_id IS NOT NULL OR loi_id IS NOT NULL)
      AND (
        (gps_lat IS NOT NULL AND gps_lng IS NOT NULL)
        OR zone_id IS NOT NULL
      )
    )
  ) NOT VALID;

-- -----------------------------------------------------------------------------
-- C) Spatial helper functions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.haversine_meters(
  p_lat1 DOUBLE PRECISION,
  p_lng1 DOUBLE PRECISION,
  p_lat2 DOUBLE PRECISION,
  p_lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 6371000.0 * 2.0 * ASIN(
    SQRT(
      POWER(SIN(RADIANS((p_lat2 - p_lat1) / 2.0)), 2)
      + COS(RADIANS(p_lat1)) * COS(RADIANS(p_lat2))
      * POWER(SIN(RADIANS((p_lng2 - p_lng1) / 2.0)), 2)
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_point_inside_geo_zone(
  p_geo_zone_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_point geometry(POINT, 4326);
  v_geom geography(POLYGON, 4326);
  v_geojson JSONB;
BEGIN
  IF p_geo_zone_id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN
    RETURN FALSE;
  END IF;

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  SELECT gz.geom, gz.geometry_geojson
  INTO v_geom, v_geojson
  FROM public.geo_zones gz
  WHERE gz.id = p_geo_zone_id
    AND COALESCE(gz.is_active, TRUE) = TRUE;

  IF v_geom IS NOT NULL THEN
    RETURN ST_Covers(v_geom::geometry, v_point);
  END IF;

  IF v_geojson IS NOT NULL THEN
    RETURN ST_Covers(
      ST_SetSRID(ST_GeomFromGeoJSON(v_geojson::TEXT), 4326),
      v_point
    );
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_point_inside_zone(
  p_zone_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_point geometry(POINT, 4326);
  v_geo_zone_id UUID;
  v_zone_geometry JSONB;
  v_zone_lat DOUBLE PRECISION;
  v_zone_lng DOUBLE PRECISION;
  v_radius_meters INTEGER;
BEGIN
  IF p_zone_id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.is_point_inside_geo_zone((SELECT geo_zone_id FROM public.zones WHERE id = p_zone_id), p_lat, p_lng) THEN
    RETURN TRUE;
  END IF;

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  SELECT
    z.geo_zone_id,
    z.geometry,
    z.location_lat::DOUBLE PRECISION,
    z.location_lng::DOUBLE PRECISION,
    COALESCE(z.radius_meters, 500)
  INTO
    v_geo_zone_id,
    v_zone_geometry,
    v_zone_lat,
    v_zone_lng,
    v_radius_meters
  FROM public.zones z
  WHERE z.id = p_zone_id
    AND COALESCE(z.is_active, TRUE) = TRUE;

  IF v_geo_zone_id IS NOT NULL AND public.is_point_inside_geo_zone(v_geo_zone_id, p_lat, p_lng) THEN
    RETURN TRUE;
  END IF;

  IF v_zone_geometry IS NOT NULL THEN
    BEGIN
      RETURN ST_Covers(
        ST_SetSRID(ST_GeomFromGeoJSON(v_zone_geometry::TEXT), 4326),
        v_point
      );
    EXCEPTION WHEN OTHERS THEN
      -- fall through to radius check
      NULL;
    END;
  END IF;

  IF v_zone_lat IS NOT NULL AND v_zone_lng IS NOT NULL THEN
    RETURN public.haversine_meters(v_zone_lat, v_zone_lng, p_lat, p_lng) <= GREATEST(v_radius_meters, 1);
  END IF;

  RETURN FALSE;
END;
$$;

-- -----------------------------------------------------------------------------
-- D) Officer boundary / policy context RPC
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_boundary_context(
  p_organization_id UUID,
  p_service_type TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_zone_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_descendant_ids UUID[];
  v_zone RECORD;
  v_geo RECORD;
  v_inside BOOLEAN := FALSE;
  v_service TEXT := COALESCE(NULLIF(TRIM(p_service_type), ''), 'general');
BEGIN
  IF p_organization_id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'inside_boundary', FALSE,
      'reason', 'organization_and_coordinates_required'
    );
  END IF;

  v_descendant_ids := COALESCE(public.get_descendant_organizations(p_organization_id), ARRAY[]::UUID[]);
  IF array_length(v_descendant_ids, 1) IS NULL THEN
    v_descendant_ids := ARRAY[p_organization_id]::UUID[];
  END IF;

  IF p_zone_id IS NOT NULL THEN
    SELECT
      z.id,
      z.organization_id,
      z.geo_zone_id,
      z.name,
      z.zone_type,
      z.zone_kind,
      z.bylaw_reference,
      z.bylaw_clause,
      z.land_manager,
      z.nights_per_month,
      z.max_consecutive_nights,
      z.self_contained_required,
      z.day_visit_only,
      z.allowed_days,
      COALESCE(z.operational_rules, '{}'::JSONB) AS operational_rules
    INTO v_zone
    FROM public.zones z
    WHERE z.id = p_zone_id
      AND z.organization_id = ANY(v_descendant_ids)
      AND COALESCE(z.is_active, TRUE) = TRUE
    LIMIT 1;

    IF v_zone.id IS NOT NULL THEN
      v_inside := public.is_point_inside_zone(v_zone.id, p_lat, p_lng);
    END IF;
  END IF;

  IF v_zone.id IS NULL THEN
    SELECT
      z.id,
      z.organization_id,
      z.geo_zone_id,
      z.name,
      z.zone_type,
      z.zone_kind,
      z.bylaw_reference,
      z.bylaw_clause,
      z.land_manager,
      z.nights_per_month,
      z.max_consecutive_nights,
      z.self_contained_required,
      z.day_visit_only,
      z.allowed_days,
      COALESCE(z.operational_rules, '{}'::JSONB) AS operational_rules
    INTO v_zone
    FROM public.zones z
    WHERE z.organization_id = ANY(v_descendant_ids)
      AND COALESCE(z.is_active, TRUE) = TRUE
      AND (
        z.zone_type IS NULL
        OR z.zone_type = v_service
        OR z.zone_type = 'general'
      )
      AND public.is_point_inside_zone(z.id, p_lat, p_lng)
    ORDER BY
      CASE WHEN z.zone_type = v_service THEN 0 ELSE 1 END,
      CASE WHEN z.zone_kind = 'both' THEN 0 WHEN z.zone_kind = 'geo' THEN 1 ELSE 2 END,
      z.id
    LIMIT 1;

    IF v_zone.id IS NOT NULL THEN
      v_inside := TRUE;
    END IF;
  END IF;

  IF v_zone.geo_zone_id IS NOT NULL THEN
    SELECT
      gz.id,
      gz.organization_id,
      gz.jurisdiction_org_id,
      gz.name,
      gz.bylaw_reference,
      gz.task_types,
      COALESCE(gz.operational_rules, '{}'::JSONB) AS operational_rules
    INTO v_geo
    FROM public.geo_zones gz
    WHERE gz.id = v_zone.geo_zone_id;
  ELSE
    SELECT
      gz.id,
      gz.organization_id,
      gz.jurisdiction_org_id,
      gz.name,
      gz.bylaw_reference,
      gz.task_types,
      COALESCE(gz.operational_rules, '{}'::JSONB) AS operational_rules
    INTO v_geo
    FROM public.geo_zones gz
    WHERE gz.organization_id = ANY(v_descendant_ids)
      AND COALESCE(gz.is_active, TRUE) = TRUE
      AND (
        array_length(gz.task_types, 1) IS NULL
        OR v_service = ANY(gz.task_types)
      )
      AND public.is_point_inside_geo_zone(gz.id, p_lat, p_lng)
    ORDER BY gz.id
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'matched', (v_zone.id IS NOT NULL OR v_geo.id IS NOT NULL),
    'inside_boundary', v_inside OR v_geo.id IS NOT NULL,
    'service_type', v_service,
    'zone', CASE WHEN v_zone.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_zone.id,
      'organization_id', v_zone.organization_id,
      'geo_zone_id', v_zone.geo_zone_id,
      'name', v_zone.name,
      'zone_type', v_zone.zone_type,
      'zone_kind', v_zone.zone_kind,
      'bylaw_reference', v_zone.bylaw_reference,
      'bylaw_clause', v_zone.bylaw_clause,
      'land_manager', v_zone.land_manager,
      'operational_rules', v_zone.operational_rules,
      'freedom_camping_rules', jsonb_build_object(
        'nights_per_month', v_zone.nights_per_month,
        'max_consecutive_nights', v_zone.max_consecutive_nights,
        'self_contained_required', v_zone.self_contained_required,
        'day_visit_only', v_zone.day_visit_only,
        'allowed_days', v_zone.allowed_days
      )
    ) END,
    'geo_zone', CASE WHEN v_geo.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_geo.id,
      'organization_id', v_geo.organization_id,
      'jurisdiction_org_id', v_geo.jurisdiction_org_id,
      'name', v_geo.name,
      'bylaw_reference', v_geo.bylaw_reference,
      'task_types', v_geo.task_types,
      'operational_rules', v_geo.operational_rules
    ) END,
    'jurisdiction', jsonb_build_object(
      'jurisdiction_org_id', COALESCE(v_geo.jurisdiction_org_id, v_zone.organization_id),
      'bylaw_reference', COALESCE(v_zone.bylaw_reference, v_geo.bylaw_reference),
      'service_endpoints', COALESCE(
        v_zone.operational_rules->'service_endpoints',
        v_geo.operational_rules->'service_endpoints',
        '{}'::JSONB
      )
    ),
    'parking_rules', COALESCE(
      v_zone.operational_rules->'parking',
      v_geo.operational_rules->'parking',
      jsonb_build_object(
        'max_stay_minutes', NULL,
        'paid_minutes', NULL,
        'loading_zone_minutes', NULL,
        'fee_schedule', NULL
      )
    ),
    'alarm_response_rules', COALESCE(
      v_zone.operational_rules->'alarm_response',
      v_geo.operational_rules->'alarm_response',
      '{}'::JSONB
    ),
    'noise_control_rules', COALESCE(
      v_zone.operational_rules->'noise_control',
      v_geo.operational_rules->'noise_control',
      '{}'::JSONB
    ),
    'resolved_at', now(),
    'point', jsonb_build_object('latitude', p_lat, 'longitude', p_lng)
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_boundary_context(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, UUID)
IS 'Returns boundary verification + zone/jurisdiction/service-rule context for officer workflows and reporting.';

GRANT EXECUTE ON FUNCTION public.resolve_boundary_context(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_boundary_context(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_zone_operational_policy(
  p_zone_id UUID,
  p_service_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone RECORD;
  v_geo RECORD;
BEGIN
  SELECT
    z.id,
    z.organization_id,
    z.geo_zone_id,
    z.name,
    z.zone_type,
    z.zone_kind,
    z.bylaw_reference,
    z.bylaw_clause,
    z.land_manager,
    z.nights_per_month,
    z.max_consecutive_nights,
    z.self_contained_required,
    z.day_visit_only,
    z.allowed_days,
    COALESCE(z.operational_rules, '{}'::JSONB) AS operational_rules
  INTO v_zone
  FROM public.zones z
  WHERE z.id = p_zone_id;

  IF v_zone.id IS NULL THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'zone_not_found');
  END IF;

  IF v_zone.geo_zone_id IS NOT NULL THEN
    SELECT
      gz.id,
      gz.jurisdiction_org_id,
      gz.bylaw_reference,
      gz.task_types,
      COALESCE(gz.operational_rules, '{}'::JSONB) AS operational_rules
    INTO v_geo
    FROM public.geo_zones gz
    WHERE gz.id = v_zone.geo_zone_id;
  END IF;

  RETURN jsonb_build_object(
    'found', TRUE,
    'zone_id', v_zone.id,
    'zone_name', v_zone.name,
    'zone_type', v_zone.zone_type,
    'effective_service_type', COALESCE(NULLIF(TRIM(p_service_type), ''), v_zone.zone_type, 'general'),
    'jurisdiction_org_id', COALESCE(v_geo.jurisdiction_org_id, v_zone.organization_id),
    'bylaw_reference', COALESCE(v_zone.bylaw_reference, v_geo.bylaw_reference),
    'freedom_camping_rules', jsonb_build_object(
      'nights_per_month', v_zone.nights_per_month,
      'max_consecutive_nights', v_zone.max_consecutive_nights,
      'self_contained_required', v_zone.self_contained_required,
      'day_visit_only', v_zone.day_visit_only,
      'allowed_days', v_zone.allowed_days
    ),
    'parking_rules', COALESCE(v_zone.operational_rules->'parking', v_geo.operational_rules->'parking', '{}'::JSONB),
    'alarm_response_rules', COALESCE(v_zone.operational_rules->'alarm_response', v_geo.operational_rules->'alarm_response', '{}'::JSONB),
    'noise_control_rules', COALESCE(v_zone.operational_rules->'noise_control', v_geo.operational_rules->'noise_control', '{}'::JSONB),
    'service_endpoints', COALESCE(v_zone.operational_rules->'service_endpoints', v_geo.operational_rules->'service_endpoints', '{}'::JSONB)
  );
END;
$$;

COMMENT ON FUNCTION public.get_zone_operational_policy(UUID, TEXT)
IS 'Returns service-aware zone policy payload for officer portal and job workflow screens.';

GRANT EXECUTE ON FUNCTION public.get_zone_operational_policy(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_zone_operational_policy(UUID, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- E) Verified on-site / off-site patrol RPCs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.patrol_auto_checkin_verified(
  p_patrol_id UUID,
  p_gps_lat NUMERIC,
  p_gps_lng NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patrol RECORD;
  v_ctx JSONB;
BEGIN
  SELECT p.id, p.organization_id, p.zone_id, p.status, p.checked_in_at, p.auto_checkin_enabled, z.zone_type
  INTO v_patrol
  FROM public.patrols p
  LEFT JOIN public.zones z ON z.id = p.zone_id
  WHERE p.id = p_patrol_id;

  IF v_patrol.id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'patrol_not_found');
  END IF;

  IF COALESCE(v_patrol.auto_checkin_enabled, TRUE) IS FALSE THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'auto_checkin_disabled');
  END IF;

  v_ctx := public.resolve_boundary_context(
    v_patrol.organization_id,
    v_patrol.zone_type,
    p_gps_lat::DOUBLE PRECISION,
    p_gps_lng::DOUBLE PRECISION,
    v_patrol.zone_id
  );

  IF COALESCE((v_ctx->>'inside_boundary')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'reason', 'outside_geofence',
      'context', v_ctx
    );
  END IF;

  UPDATE public.patrols
  SET
    checked_in_at = COALESCE(checked_in_at, nz_now()),
    check_in_location_lat = p_gps_lat,
    check_in_location_lng = p_gps_lng,
    check_in_verified = TRUE,
    check_in_boundary_context = v_ctx,
    status = CASE WHEN status = 'scheduled' THEN 'in_progress' ELSE status END,
    updated_at = now()
  WHERE id = p_patrol_id
  RETURNING id INTO v_patrol;

  RETURN jsonb_build_object(
    'success', TRUE,
    'patrol_id', p_patrol_id,
    'message', 'Auto sign-on verified inside geofence',
    'context', v_ctx
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.patrol_auto_checkin_verified(UUID, NUMERIC, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.patrol_auto_checkout_verified(
  p_patrol_id UUID,
  p_gps_lat NUMERIC,
  p_gps_lng NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patrol RECORD;
  v_ctx JSONB;
  v_inside BOOLEAN;
BEGIN
  SELECT p.id, p.organization_id, p.zone_id, p.status, p.checked_in_at, p.completed_at, z.zone_type
  INTO v_patrol
  FROM public.patrols p
  LEFT JOIN public.zones z ON z.id = p.zone_id
  WHERE p.id = p_patrol_id;

  IF v_patrol.id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'patrol_not_found');
  END IF;

  IF v_patrol.checked_in_at IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'not_checked_in');
  END IF;

  v_ctx := public.resolve_boundary_context(
    v_patrol.organization_id,
    v_patrol.zone_type,
    p_gps_lat::DOUBLE PRECISION,
    p_gps_lng::DOUBLE PRECISION,
    v_patrol.zone_id
  );

  v_inside := COALESCE((v_ctx->>'inside_boundary')::BOOLEAN, FALSE);

  IF v_inside THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'reason', 'still_inside_geofence',
      'context', v_ctx
    );
  END IF;

  UPDATE public.patrols
  SET
    completed_at = COALESCE(completed_at, nz_now()),
    ended_at = COALESCE(ended_at, nz_now()),
    check_out_location_lat = p_gps_lat,
    check_out_location_lng = p_gps_lng,
    check_out_verified = TRUE,
    check_out_boundary_context = v_ctx,
    status = CASE WHEN status <> 'completed' THEN 'completed' ELSE status END,
    updated_at = now()
  WHERE id = p_patrol_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'patrol_id', p_patrol_id,
    'message', 'Auto sign-off verified outside geofence',
    'context', v_ctx
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.patrol_auto_checkout_verified(UUID, NUMERIC, NUMERIC) TO authenticated;

-- -----------------------------------------------------------------------------
-- F) Location-context upsert RPCs for reports/incidents/jobs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_incident_location_context(
  p_incident_id UUID,
  p_location_lat NUMERIC,
  p_location_lng NUMERIC,
  p_service_type TEXT DEFAULT NULL,
  p_zone_id UUID DEFAULT NULL,
  p_location_address TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_incident_org_id UUID;
  v_ctx JSONB;
BEGIN
  SELECT organization_id INTO v_incident_org_id
  FROM public.incidents
  WHERE id = p_incident_id;

  IF v_incident_org_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'incident_not_found');
  END IF;

  v_ctx := public.resolve_boundary_context(
    v_incident_org_id,
    p_service_type,
    p_location_lat::DOUBLE PRECISION,
    p_location_lng::DOUBLE PRECISION,
    p_zone_id
  );

  UPDATE public.incidents
  SET
    location_lat = p_location_lat,
    location_lng = p_location_lng,
    location_address = COALESCE(p_location_address, location_address),
    zone_id = COALESCE((v_ctx->'zone'->>'id')::UUID, p_zone_id),
    geo_zone_id = (v_ctx->'geo_zone'->>'id')::UUID,
    jurisdiction_org_id = COALESCE(
      (v_ctx->'jurisdiction'->>'jurisdiction_org_id')::UUID,
      jurisdiction_org_id
    ),
    boundary_context = v_ctx,
    updated_at = now()
  WHERE id = p_incident_id;

  RETURN jsonb_build_object('success', TRUE, 'incident_id', p_incident_id, 'context', v_ctx);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_incident_location_context(UUID, NUMERIC, NUMERIC, TEXT, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_dispatch_job_location_context(
  p_dispatch_job_id UUID,
  p_gps_lat NUMERIC,
  p_gps_lng NUMERIC,
  p_service_type TEXT DEFAULT NULL,
  p_zone_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_ctx JSONB;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM public.dispatch_jobs
  WHERE id = p_dispatch_job_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'dispatch_job_not_found');
  END IF;

  v_ctx := public.resolve_boundary_context(
    v_org_id,
    p_service_type,
    p_gps_lat::DOUBLE PRECISION,
    p_gps_lng::DOUBLE PRECISION,
    p_zone_id
  );

  UPDATE public.dispatch_jobs
  SET
    gps_lat = p_gps_lat,
    gps_lng = p_gps_lng,
    zone_id = COALESCE((v_ctx->'zone'->>'id')::UUID, p_zone_id, zone_id),
    geo_zone_id = COALESCE((v_ctx->'geo_zone'->>'id')::UUID, geo_zone_id),
    boundary_context = v_ctx,
    updated_at = now()
  WHERE id = p_dispatch_job_id;

  RETURN jsonb_build_object('success', TRUE, 'dispatch_job_id', p_dispatch_job_id, 'context', v_ctx);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_dispatch_job_location_context(UUID, NUMERIC, NUMERIC, TEXT, UUID) TO authenticated;

COMMIT;
