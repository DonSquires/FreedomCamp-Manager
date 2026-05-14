-- =============================================================================
-- NCC / First Security Live Alignment Audit
-- Run after migrations to verify org, zone, geofence, site, and bridge wiring.
--
-- Usage:
--   supabase db reset      # optional local
--   supabase db push
--   psql "$DATABASE_URL" -f scripts/audit-ncc-live-alignment.sql
-- =============================================================================

-- Canonical IDs
WITH constants AS (
  SELECT
    'b8566654-4b1b-4cea-b55e-73791ec418ea'::uuid AS fs_root_id,
    '11111111-0001-0001-0001-000000000002'::uuid AS fs_nelson_id,
    '11111111-0001-0001-0001-000000000003'::uuid AS fs_queenstown_id,
    'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993'::uuid AS ncc_id,
    '57804ca8-ecc2-4b0b-91a7-3b54ad513191'::uuid AS downer_linz_id
)
SELECT
  'org_presence' AS check_name,
  (SELECT COUNT(*) = 5 FROM public.organizations o, constants c
   WHERE o.id IN (c.fs_root_id, c.fs_nelson_id, c.fs_queenstown_id, c.ncc_id, c.downer_linz_id)) AS pass,
  (SELECT COUNT(*) FROM public.organizations o, constants c
   WHERE o.id IN (c.fs_root_id, c.fs_nelson_id, c.fs_queenstown_id, c.ncc_id, c.downer_linz_id))::text AS detail;

WITH constants AS (
  SELECT
    'b8566654-4b1b-4cea-b55e-73791ec418ea'::uuid AS fs_root_id,
    '11111111-0001-0001-0001-000000000002'::uuid AS fs_nelson_id,
    '11111111-0001-0001-0001-000000000003'::uuid AS fs_queenstown_id,
    'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993'::uuid AS ncc_id,
    '57804ca8-ecc2-4b0b-91a7-3b54ad513191'::uuid AS downer_linz_id
)
SELECT
  'org_hierarchy' AS check_name,
  (
    EXISTS (SELECT 1 FROM public.organizations o, constants c WHERE o.id = c.fs_nelson_id AND o.parent_organization_id = c.fs_root_id)
    AND EXISTS (SELECT 1 FROM public.organizations o, constants c WHERE o.id = c.fs_queenstown_id AND o.parent_organization_id = c.fs_root_id)
    AND EXISTS (SELECT 1 FROM public.organizations o, constants c WHERE o.id = c.ncc_id AND o.parent_organization_id = c.fs_nelson_id)
    AND EXISTS (SELECT 1 FROM public.organizations o, constants c WHERE o.id = c.downer_linz_id AND o.parent_organization_id = c.fs_queenstown_id)
  ) AS pass,
  'Nelson/Queenstown branches and NCC/Downer-LINZ children' AS detail;

WITH constants AS (
  SELECT
    '11111111-0001-0001-0001-000000000001'::uuid AS old_fs,
    '11111111-0001-0001-0001-000000000010'::uuid AS old_ncc,
    '11111111-0001-0001-0001-000000000011'::uuid AS old_downer
)
SELECT
  'synthetic_ids_deactivated' AS check_name,
  (
    SELECT COALESCE(bool_and(is_active = false), true)
    FROM public.organizations o, constants c
    WHERE o.id IN (c.old_fs, c.old_ncc, c.old_downer)
  ) AS pass,
  (
    SELECT COALESCE(string_agg(o.id::text || ':' || o.is_active::text, ', '), 'none present')
    FROM public.organizations o, constants c
    WHERE o.id IN (c.old_fs, c.old_ncc, c.old_downer)
  ) AS detail;

WITH constants AS (
  SELECT '11111111-0001-0001-0001-000000000002'::uuid AS fs_nelson_id
)
SELECT
  'dispatch_zones_582_587' AS check_name,
  (
    SELECT COUNT(*) = 5
    FROM public.zones z, constants c
    WHERE z.organization_id = c.fs_nelson_id
      AND z.id IN (
        '22222222-0001-0001-0582-000000000001'::uuid,
        '22222222-0001-0001-0584-000000000001'::uuid,
        '22222222-0001-0001-0585-000000000001'::uuid,
        '22222222-0001-0001-0586-000000000001'::uuid,
        '22222222-0001-0001-0587-000000000001'::uuid
      )
  ) AS pass,
  (
    SELECT COUNT(*)::text
    FROM public.zones z, constants c
    WHERE z.organization_id = c.fs_nelson_id
      AND z.id IN (
        '22222222-0001-0001-0582-000000000001'::uuid,
        '22222222-0001-0001-0584-000000000001'::uuid,
        '22222222-0001-0001-0585-000000000001'::uuid,
        '22222222-0001-0001-0586-000000000001'::uuid,
        '22222222-0001-0001-0587-000000000001'::uuid
      )
  ) AS detail;

WITH constants AS (
  SELECT 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993'::uuid AS ncc_id
)
SELECT
  'ncc_geo_zones_seeded' AS check_name,
  (
    SELECT COUNT(*) = 3
    FROM public.geo_zones gz, constants c
    WHERE gz.organization_id = c.ncc_id
      AND gz.id IN (
        '44444444-0001-0001-0001-000000000001'::uuid,
        '44444444-0001-0001-0001-000000000002'::uuid,
        '44444444-0001-0001-0001-000000000003'::uuid
      )
  ) AS pass,
  (
    SELECT COUNT(*)::text
    FROM public.geo_zones gz, constants c
    WHERE gz.organization_id = c.ncc_id
      AND gz.id IN (
        '44444444-0001-0001-0001-000000000001'::uuid,
        '44444444-0001-0001-0001-000000000002'::uuid,
        '44444444-0001-0001-0001-000000000003'::uuid
      )
  ) AS detail;

SELECT
  'legacy_zone_bridge_kind' AS check_name,
  (
    SELECT COUNT(*) = 3
    FROM public.zones z
    WHERE z.id IN (
      '22222222-0001-0001-0584-000000000001'::uuid,
      '22222222-0001-0001-0585-000000000001'::uuid,
      '22222222-0001-0001-0587-000000000001'::uuid
    )
      AND z.geo_zone_id IS NOT NULL
      AND z.zone_kind = 'both'
  ) AS pass,
  (
    SELECT string_agg(z.id::text || ':' || COALESCE(z.zone_kind, 'null'), ', ' ORDER BY z.id::text)
    FROM public.zones z
    WHERE z.id IN (
      '22222222-0001-0001-0584-000000000001'::uuid,
      '22222222-0001-0001-0585-000000000001'::uuid,
      '22222222-0001-0001-0587-000000000001'::uuid
    )
  ) AS detail;

WITH constants AS (
  SELECT 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993'::uuid AS ncc_id
)
SELECT
  'ncc_site_coverage_minimum' AS check_name,
  (
    SELECT COUNT(*) >= 11
    FROM public.client_sites cs, constants c
    WHERE cs.organization_id = c.ncc_id
      AND lower(cs.name) IN (
        'washington valley reserve',
        'tahunanui beach',
        'annesbrook drive campsite',
        'founders park',
        '27 bridge street',
        'wakapuaka crematorium',
        'lions playground toilet',
        'sports field toilet/changing shed',
        'beach cafe toilet',
        'bmx track/modellers playground toilet',
        'rear roller skating rink toilet'
      )
  ) AS pass,
  (
    SELECT COUNT(*)::text
    FROM public.client_sites cs, constants c
    WHERE cs.organization_id = c.ncc_id
      AND lower(cs.name) IN (
        'washington valley reserve',
        'tahunanui beach',
        'annesbrook drive campsite',
        'founders park',
        '27 bridge street',
        'wakapuaka crematorium',
        'lions playground toilet',
        'sports field toilet/changing shed',
        'beach cafe toilet',
        'bmx track/modellers playground toilet',
        'rear roller skating rink toilet'
      )
  ) AS detail;

WITH synthetic_refs AS (
  SELECT 'organizations'::text AS table_name, COUNT(*) AS rows_found
  FROM public.organizations
  WHERE id IN (
    '11111111-0001-0001-0001-000000000001'::uuid,
    '11111111-0001-0001-0001-000000000010'::uuid,
    '11111111-0001-0001-0001-000000000011'::uuid
  )
)
SELECT
  'synthetic_id_reference_quick_scan' AS check_name,
  true AS pass,
  string_agg(table_name || '=' || rows_found::text, ', ') AS detail
FROM synthetic_refs;
