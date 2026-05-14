-- Geofence strict-context audit
-- Run after migration: 20260714000002_geofence_core_enforcement_and_policy_context.sql

WITH expected_columns AS (
  SELECT * FROM (VALUES
    ('zones', 'operational_rules'),
    ('zones', 'strict_boundary_enabled'),
    ('geo_zones', 'operational_rules'),
    ('geo_zones', 'strict_boundary_enabled'),
    ('client_sites', 'loi_id'),
    ('patrols', 'check_out_location_lat'),
    ('patrols', 'check_out_location_lng'),
    ('patrols', 'check_in_verified'),
    ('patrols', 'check_out_verified'),
    ('patrols', 'check_in_boundary_context'),
    ('patrols', 'check_out_boundary_context'),
    ('dispatch_jobs', 'geo_zone_id'),
    ('dispatch_jobs', 'boundary_context'),
    ('incidents', 'zone_id'),
    ('incidents', 'geo_zone_id'),
    ('incidents', 'loi_id'),
    ('incidents', 'jurisdiction_org_id'),
    ('incidents', 'boundary_context')
  ) AS t(table_name, column_name)
),
column_check AS (
  SELECT
    e.table_name,
    e.column_name,
    EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = e.table_name
        AND c.column_name = e.column_name
    ) AS exists
  FROM expected_columns e
)
SELECT
  'columns' AS section,
  COUNT(*) FILTER (WHERE exists) AS present,
  COUNT(*) FILTER (WHERE NOT exists) AS missing,
  STRING_AGG(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name)
    FILTER (WHERE NOT exists) AS missing_items
FROM column_check;

SELECT
  'constraints' AS section,
  COUNT(*) FILTER (WHERE conname = 'geo_zones_active_geofence_required_chk') AS geo_zones_check,
  COUNT(*) FILTER (WHERE conname = 'zones_active_geofence_required_chk') AS zones_check,
  COUNT(*) FILTER (WHERE conname = 'client_sites_active_location_required_chk') AS client_sites_check
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conname IN (
    'geo_zones_active_geofence_required_chk',
    'zones_active_geofence_required_chk',
    'client_sites_active_location_required_chk'
  );

SELECT
  'functions' AS section,
  proname,
  oid::regprocedure::text AS signature
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'resolve_boundary_context',
    'get_zone_operational_policy',
    'patrol_auto_checkin_verified',
    'patrol_auto_checkout_verified',
    'upsert_incident_location_context',
    'upsert_dispatch_job_location_context',
    'is_point_inside_zone',
    'is_point_inside_geo_zone'
  )
ORDER BY proname, signature;

SELECT
  'active_geo_zones_missing_geometry' AS section,
  COUNT(*) AS failures
FROM public.geo_zones
WHERE COALESCE(is_active, TRUE) = TRUE
  AND COALESCE(strict_boundary_enabled, TRUE) = TRUE
  AND geom IS NULL
  AND geometry_geojson IS NULL;

SELECT
  'active_zones_missing_geofence_path' AS section,
  COUNT(*) AS failures
FROM public.zones
WHERE COALESCE(is_active, TRUE) = TRUE
  AND zone_kind IN ('geo', 'both')
  AND COALESCE(strict_boundary_enabled, TRUE) = TRUE
  AND geo_zone_id IS NULL
  AND geometry IS NULL
  AND NOT (location_lat IS NOT NULL AND location_lng IS NOT NULL AND COALESCE(radius_meters, 0) > 0);

SELECT
  'active_client_sites_missing_location_trace' AS section,
  COUNT(*) AS failures
FROM public.client_sites
WHERE COALESCE(is_active, TRUE) = TRUE
  AND (
    (zone_id IS NULL AND loi_id IS NULL)
    OR ((gps_lat IS NULL OR gps_lng IS NULL) AND zone_id IS NULL)
  );
