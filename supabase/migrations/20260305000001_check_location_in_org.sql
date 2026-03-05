-- ============================================================================
-- ADD: check_location_in_org() RPC
-- Date: 2026-03-05
--
-- PROBLEM: LocationAuthorizationStatus and useLocationCheck hook call
-- supabase.rpc('check_location_in_org', { org_id, lat, lon }) which returns
-- a 404 because the function does not exist in the database.
--
-- FIX: Create the check_location_in_org() function that checks whether a
-- GPS coordinate is inside any active zone belonging to an organisation.
-- Returns JSONB with: { inside, distance_m, nearest_point }.
-- ============================================================================

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

-- Owner → postgres ensures it can read zones regardless of RLS
ALTER FUNCTION public.check_location_in_org(uuid, float8, float8) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.check_location_in_org(uuid, float8, float8) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_location_in_org(uuid, float8, float8) TO anon;

COMMENT ON FUNCTION public.check_location_in_org IS
  'Checks whether a GPS coordinate (lat, lon) is inside any active zone '
  'belonging to org_id. Returns JSON: {inside, distance_m, nearest_point}. '
  'Used by LocationAuthorizationStatus component and useLocationCheck hook.';

-- ── Verification ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'check_location_in_org'
  ) THEN
    RAISE NOTICE '✅ check_location_in_org() function created';
  ELSE
    RAISE WARNING '⚠️  check_location_in_org() function MISSING';
  END IF;
END;
$$;
