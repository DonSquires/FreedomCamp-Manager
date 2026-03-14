-- ============================================================================
-- Migration: Update zone functions for org-name-prefixed "Other Location" zones
--
-- Following migration 20260403000001_deduplicate_zones.sql which renamed all
-- "Other Location" zones to "<OrgName> - Other Location", this migration
-- updates the three affected SQL functions and the deletion-protection trigger
-- to use the new naming convention.
--
-- Functions updated:
--   • ensure_other_location_zone(uuid)   – create/find the per-org fallback zone
--   • find_zone_by_gps(...)              – GPS geofence lookup
--   • check_location_in_org(uuid, ...)   – officer location authorization check
--   • prevent_other_location_deletion()  – BEFORE DELETE trigger guard
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ensure_other_location_zone(p_organization_id)
--    Looks up (or creates) the org-specific fallback zone.  New zones are
--    named "<OrgName> - Other Location".  A legacy fallback for zones still
--    named exactly "Other Location" ensures smooth rollouts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_other_location_zone(p_organization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone_id  uuid;
  v_org_name text;
  v_zone_name text;
BEGIN
  -- Resolve the expected zone name for this org
  SELECT name INTO v_org_name
  FROM public.organizations
  WHERE id = p_organization_id;

  IF v_org_name IS NULL THEN
    RAISE EXCEPTION 'ensure_other_location_zone: organisation % not found', p_organization_id;
  END IF;

  v_zone_name := v_org_name || ' - Other Location';

  -- Try to find the zone with the new naming format
  SELECT id INTO v_zone_id
  FROM public.zones
  WHERE organization_id = p_organization_id
    AND name = v_zone_name
  LIMIT 1;

  -- Backward-compat: also accept the legacy "Other Location" exact name
  IF v_zone_id IS NULL THEN
    SELECT id INTO v_zone_id
    FROM public.zones
    WHERE organization_id = p_organization_id
      AND name = 'Other Location'
    LIMIT 1;
  END IF;

  -- Create if not found
  IF v_zone_id IS NULL THEN
    INSERT INTO public.zones (
      organization_id,
      name,
      description,
      zone_type,
      parent_zone_id,
      is_active,
      self_contained_required,
      nights_per_month,
      max_consecutive_nights,
      day_visit_only
    ) VALUES (
      p_organization_id,
      v_zone_name,
      'Council jurisdiction area - default zone for observations outside specific enforcement zones',
      'general',
      NULL,
      true,
      true,
      28,
      3,
      false
    )
    RETURNING id INTO v_zone_id;
  END IF;

  RETURN v_zone_id;
END;
$$;

ALTER FUNCTION public.ensure_other_location_zone(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.ensure_other_location_zone TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_other_location_zone TO service_role;

COMMENT ON FUNCTION public.ensure_other_location_zone IS
  'Returns the "<OrgName> - Other Location" zone ID for an org, creating it if '
  'needed. SECURITY DEFINER bypasses zones RLS so officers can call it safely.';

-- ---------------------------------------------------------------------------
-- 2. find_zone_by_gps(...)
--    Three exclusion clauses updated from  name != ''Other Location''
--    to  name NOT LIKE ''% - Other Location'' (also excludes legacy format).
--    The fallback lookup now joins organizations to build the expected name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_zone_by_gps(
  p_latitude       NUMERIC,
  p_longitude      NUMERIC,
  p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE (
  zone_id          UUID,
  zone_name        TEXT,
  match_type       TEXT,
  distance_meters  INTEGER
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_point GEOMETRY;
  v_zone_record RECORD;
  v_min_distance INTEGER := 999999;
  v_closest_zone UUID;
  v_closest_zone_name TEXT;
  v_other_location_id UUID;
BEGIN
  -- Create point from coordinates
  v_point := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326);

  -- First: Try exact geofence match (polygon)
  FOR v_zone_record IN
    SELECT
      z.id,
      z.name,
      z.organization_id,
      z.geometry
    FROM public.zones z
    WHERE z.is_active = true
      AND z.geometry IS NOT NULL
      AND z.geometry->>'type' = 'Polygon'
      AND (p_organization_id IS NULL OR z.organization_id = p_organization_id)
      AND z.name NOT LIKE '% - Other Location'
      AND z.name != 'Other Location'
  LOOP
    -- Parse GeoJSON polygon and check if point is inside
    DECLARE
      v_coords JSONB;
      v_polygon GEOMETRY;
    BEGIN
      v_coords := v_zone_record.geometry->'coordinates'->0;

      -- Build WKT polygon string
      DECLARE
        v_wkt TEXT := 'POLYGON((';
        v_coord JSONB;
      BEGIN
        FOR v_coord IN SELECT * FROM jsonb_array_elements(v_coords)
        LOOP
          IF v_wkt != 'POLYGON((' THEN
            v_wkt := v_wkt || ',';
          END IF;
          v_wkt := v_wkt || (v_coord->>0) || ' ' || (v_coord->>1);
        END LOOP;
        v_wkt := v_wkt || '))';

        v_polygon := ST_GeomFromText(v_wkt, 4326);

        IF ST_Contains(v_polygon, v_point) THEN
          -- Point is inside this geofence
          zone_id := v_zone_record.id;
          zone_name := v_zone_record.name;
          match_type := 'geofence';
          distance_meters := 0;
          RETURN NEXT;
          RETURN; -- Found exact match, exit
        END IF;
      END;
    END;
  END LOOP;

  -- Second: Try circle geofence match
  FOR v_zone_record IN
    SELECT
      z.id,
      z.name,
      z.organization_id,
      z.geometry
    FROM public.zones z
    WHERE z.is_active = true
      AND z.geometry IS NOT NULL
      AND z.geometry->>'type' = 'Point'
      AND (p_organization_id IS NULL OR z.organization_id = p_organization_id)
      AND z.name NOT LIKE '% - Other Location'
      AND z.name != 'Other Location'
  LOOP
    DECLARE
      v_center_lng NUMERIC := (v_zone_record.geometry->'coordinates'->>0)::NUMERIC;
      v_center_lat NUMERIC := (v_zone_record.geometry->'coordinates'->>1)::NUMERIC;
      v_radius INTEGER := (v_zone_record.geometry->>'radius')::INTEGER;
      v_center_point GEOMETRY;
      v_distance NUMERIC;
    BEGIN
      v_center_point := ST_SetSRID(ST_MakePoint(v_center_lng, v_center_lat), 4326);
      v_distance := ST_Distance(v_center_point::geography, v_point::geography);

      IF v_distance <= v_radius THEN
        -- Point is inside circle
        zone_id := v_zone_record.id;
        zone_name := v_zone_record.name;
        match_type := 'geofence';
        distance_meters := ROUND(v_distance)::INTEGER;
        RETURN NEXT;
        RETURN; -- Found exact match, exit
      END IF;
    END;
  END LOOP;

  -- Third: Try proximity to zone center (500m threshold)
  FOR v_zone_record IN
    SELECT
      z.id,
      z.name,
      z.organization_id,
      z.location_lat,
      z.location_lng
    FROM public.zones z
    WHERE z.is_active = true
      AND z.location_lat IS NOT NULL
      AND z.location_lng IS NOT NULL
      AND (p_organization_id IS NULL OR z.organization_id = p_organization_id)
      AND z.name NOT LIKE '% - Other Location'
      AND z.name != 'Other Location'
  LOOP
    DECLARE
      v_zone_point GEOMETRY;
      v_distance NUMERIC;
    BEGIN
      v_zone_point := ST_SetSRID(
        ST_MakePoint(v_zone_record.location_lng, v_zone_record.location_lat),
        4326
      );
      v_distance := ST_Distance(v_zone_point::geography, v_point::geography);

      IF v_distance < v_min_distance THEN
        v_min_distance := ROUND(v_distance)::INTEGER;
        v_closest_zone := v_zone_record.id;
        v_closest_zone_name := v_zone_record.name;
      END IF;
    END;
  END LOOP;

  -- If found within 500m, return as proximity match
  IF v_closest_zone IS NOT NULL AND v_min_distance <= 500 THEN
    zone_id := v_closest_zone;
    zone_name := v_closest_zone_name;
    match_type := 'proximity';
    distance_meters := v_min_distance;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Fourth: No match - return org-specific "Other Location" fallback zone
  IF p_organization_id IS NOT NULL THEN
    -- Try new naming format: "<OrgName> - Other Location"
    SELECT z.id, z.name
    INTO v_other_location_id, v_closest_zone_name
    FROM public.zones z
    JOIN public.organizations o ON o.id = z.organization_id
    WHERE z.organization_id = p_organization_id
      AND z.name = o.name || ' - Other Location'
      AND z.is_active = true
    LIMIT 1;

    -- Backward compat: legacy 'Other Location' exact name
    IF v_other_location_id IS NULL THEN
      SELECT z.id, z.name
      INTO v_other_location_id, v_closest_zone_name
      FROM public.zones z
      WHERE z.organization_id = p_organization_id
        AND z.name = 'Other Location'
        AND z.is_active = true
      LIMIT 1;
    END IF;

    IF v_other_location_id IS NOT NULL THEN
      zone_id := v_other_location_id;
      zone_name := v_closest_zone_name;
      match_type := 'other_location';
      distance_meters := NULL;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- No zone found at all
  RETURN;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.find_zone_by_gps(NUMERIC, NUMERIC, UUID) TO authenticated, anon;

COMMENT ON FUNCTION public.find_zone_by_gps IS
  'Find zone by GPS coordinates using geofence matching, proximity, or '
  '"<OrgName> - Other Location" fallback';

-- ---------------------------------------------------------------------------
-- 3. check_location_in_org(org_id, lat, lon)
--    Two exclusion clauses updated from  name != ''Other Location''
--    to  name NOT LIKE ''% - Other Location'' and name != ''Other Location''.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_location_in_org(
  org_id  UUID,
  lat     FLOAT8,
  lon     FLOAT8
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_point       GEOMETRY(POINT, 4326);
  v_zone_rec    RECORD;
  v_min_dist    FLOAT8 := NULL;
  v_nearest_lon FLOAT8 := NULL;
  v_nearest_lat FLOAT8 := NULL;
BEGIN
  -- Build the query point (lon, lat order for PostGIS)
  v_point := ST_SetSRID(ST_MakePoint(lon, lat), 4326);

  -- ── 1. Polygon zones ───────────────────────────────────────────────────────
  FOR v_zone_rec IN
    SELECT geometry
    FROM public.zones
    WHERE organization_id = org_id
      AND is_active = TRUE
      AND geometry IS NOT NULL
      AND geometry->>'type' = 'Polygon'
      AND name NOT LIKE '% - Other Location'
      AND name != 'Other Location'
  LOOP
    DECLARE
      v_wkt  TEXT := 'POLYGON((';
      v_c    JSONB;
      v_poly GEOMETRY(POLYGON, 4326);
      v_dist FLOAT8;
      v_cp   GEOMETRY;
    BEGIN
      -- Build WKT from GeoJSON coordinate array
      FOR v_c IN SELECT * FROM jsonb_array_elements(v_zone_rec.geometry->'coordinates'->0)
      LOOP
        IF v_wkt != 'POLYGON((' THEN
          v_wkt := v_wkt || ',';
        END IF;
        v_wkt := v_wkt || (v_c->>0) || ' ' || (v_c->>1);
      END LOOP;
      v_wkt := v_wkt || '))';

      v_poly := ST_GeomFromText(v_wkt, 4326);

      -- Inside check
      IF ST_Contains(v_poly, v_point) THEN
        RETURN jsonb_build_object(
          'inside',        TRUE,
          'distance_m',    0,
          'nearest_point', NULL
        );
      END IF;

      -- Track nearest boundary for the "outside" result
      v_dist := ST_Distance(v_poly::geography, v_point::geography);
      IF v_min_dist IS NULL OR v_dist < v_min_dist THEN
        v_min_dist    := v_dist;
        v_cp          := ST_ClosestPoint(v_poly, v_point);
        v_nearest_lon := ST_X(v_cp);
        v_nearest_lat := ST_Y(v_cp);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Skip zones with malformed geometry
      RAISE WARNING 'check_location_in_org: skipping malformed polygon zone: %', SQLERRM;
    END;
  END LOOP;

  -- ── 2. Circle zones (GeoJSON Point + radius) ───────────────────────────────
  FOR v_zone_rec IN
    SELECT geometry
    FROM public.zones
    WHERE organization_id = org_id
      AND is_active = TRUE
      AND geometry IS NOT NULL
      AND geometry->>'type' = 'Point'
      AND name NOT LIKE '% - Other Location'
      AND name != 'Other Location'
  LOOP
    DECLARE
      v_center GEOMETRY(POINT, 4326);
      v_radius FLOAT8;
      v_dist   FLOAT8;
    BEGIN
      v_center := ST_SetSRID(
        ST_MakePoint(
          (v_zone_rec.geometry->'coordinates'->>0)::FLOAT8,
          (v_zone_rec.geometry->'coordinates'->>1)::FLOAT8
        ), 4326
      );
      v_radius := COALESCE((v_zone_rec.geometry->>'radius')::FLOAT8, 100); -- default 100 m when radius not specified
      v_dist   := ST_Distance(v_center::geography, v_point::geography);

      -- Inside check
      IF v_dist <= v_radius THEN
        RETURN jsonb_build_object(
          'inside',        TRUE,
          'distance_m',    0,
          'nearest_point', NULL
        );
      END IF;

      -- Distance to edge of circle
      v_dist := v_dist - v_radius;
      IF v_min_dist IS NULL OR v_dist < v_min_dist THEN
        v_min_dist    := v_dist;
        v_nearest_lon := ST_X(v_center);
        v_nearest_lat := ST_Y(v_center);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'check_location_in_org: skipping malformed circle zone: %', SQLERRM;
    END;
  END LOOP;

  -- ── 3. Return outside result ────────────────────────────────────────────────
  IF v_min_dist IS NOT NULL THEN
    RETURN jsonb_build_object(
      'inside',     FALSE,
      'distance_m', ROUND(v_min_dist::NUMERIC, 2),
      'nearest_point', jsonb_build_object(
        'type',        'Point',
        'coordinates', jsonb_build_array(v_nearest_lon, v_nearest_lat)
      )
    );
  END IF;

  -- No geofenced zones found for this org
  RETURN jsonb_build_object(
    'inside',        FALSE,
    'distance_m',    NULL,
    'nearest_point', NULL
  );
END;
$$;

ALTER FUNCTION public.check_location_in_org(uuid, float8, float8) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.check_location_in_org(uuid, float8, float8) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_location_in_org(uuid, float8, float8) TO anon;

COMMENT ON FUNCTION public.check_location_in_org IS
  'Checks whether a GPS coordinate (lat, lon) is inside any active zone '
  'belonging to org_id. Returns JSON: {inside, distance_m, nearest_point}. '
  'Used by LocationAuthorizationStatus component and useLocationCheck hook.';

-- ---------------------------------------------------------------------------
-- 4. prevent_other_location_deletion trigger
--    Updated to protect both the new "<OrgName> - Other Location" format and
--    the legacy "Other Location" exact name (backward compat).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_other_location_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.name LIKE '% - Other Location' OR OLD.name = 'Other Location' THEN
    RAISE EXCEPTION 'Cannot delete "Other Location" system zone';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_other_location_deletion_trigger ON public.zones;
CREATE TRIGGER prevent_other_location_deletion_trigger
  BEFORE DELETE ON public.zones
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_other_location_deletion();

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '✅ ensure_other_location_zone() updated to org-name prefix format';
  RAISE NOTICE '✅ find_zone_by_gps() updated to exclude/find ''%% - Other Location'' zones';
  RAISE NOTICE '✅ check_location_in_org() updated to exclude ''%% - Other Location'' zones';
  RAISE NOTICE '✅ prevent_other_location_deletion trigger updated for new name pattern';
END;
$$;
