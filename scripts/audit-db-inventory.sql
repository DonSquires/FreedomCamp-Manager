-- =============================================================================
-- Full Database Inventory Audit
-- Purpose: inspect live DB tables, functions, triggers, views, RLS, and key
--          organizational data alignment in a single run.
-- =============================================================================

-- 1) Table inventory (public schema)
SELECT
  'table_count' AS section,
  COUNT(*)::text AS value
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE';

SELECT
  'tables' AS section,
  table_name AS value
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 2) View inventory
SELECT
  'view_count' AS section,
  COUNT(*)::text AS value
FROM information_schema.views
WHERE table_schema = 'public';

SELECT
  'views' AS section,
  table_name AS value
FROM information_schema.views
WHERE table_schema = 'public'
ORDER BY table_name;

-- 3) Function inventory (public)
SELECT
  'function_count' AS section,
  COUNT(*)::text AS value
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';

SELECT
  'functions' AS section,
  p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS value
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- 4) Trigger inventory
SELECT
  'trigger_count' AS section,
  COUNT(*)::text AS value
FROM information_schema.triggers
WHERE trigger_schema = 'public';

SELECT
  'triggers' AS section,
  event_object_table || ':' || trigger_name AS value
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 5) RLS status per table
SELECT
  'rls_status' AS section,
  c.relname || ':rls=' || c.relrowsecurity::text || ':forcerls=' || c.relforcerowsecurity::text AS value
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- 6) Policy inventory
SELECT
  'policy_count' AS section,
  COUNT(*)::text AS value
FROM pg_policies
WHERE schemaname = 'public';

SELECT
  'policies' AS section,
  tablename || ':' || policyname || ':cmd=' || cmd AS value
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 7) Duplicate hot-spot checks for frequently migrated entities
SELECT
  'dup_org_name' AS section,
  lower(name) || ':count=' || COUNT(*)::text AS value
FROM public.organizations
GROUP BY lower(name)
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, lower(name);

SELECT
  'dup_zone_org_name' AS section,
  organization_id::text || ':' || lower(name) || ':count=' || COUNT(*)::text AS value
FROM public.zones
GROUP BY organization_id, lower(name)
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

SELECT
  'dup_site_org_name' AS section,
  organization_id::text || ':' || lower(name) || ':count=' || COUNT(*)::text AS value
FROM public.client_sites
GROUP BY organization_id, lower(name)
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- 8) Canonical org chain checks (First Security/NCC)
WITH constants AS (
  SELECT
    'b8566654-4b1b-4cea-b55e-73791ec418ea'::uuid AS fs_root_id,
    '11111111-0001-0001-0001-000000000002'::uuid AS fs_nelson_id,
    '11111111-0001-0001-0001-000000000003'::uuid AS fs_queenstown_id,
    'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993'::uuid AS ncc_id,
    '57804ca8-ecc2-4b0b-91a7-3b54ad513191'::uuid AS downer_linz_id
)
SELECT
  'canonical_org_chain' AS section,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.organizations o, constants c WHERE o.id = c.fs_nelson_id AND o.parent_organization_id = c.fs_root_id)
     AND EXISTS (SELECT 1 FROM public.organizations o, constants c WHERE o.id = c.fs_queenstown_id AND o.parent_organization_id = c.fs_root_id)
     AND EXISTS (SELECT 1 FROM public.organizations o, constants c WHERE o.id = c.ncc_id AND o.parent_organization_id = c.fs_nelson_id)
     AND EXISTS (SELECT 1 FROM public.organizations o, constants c WHERE o.id = c.downer_linz_id AND o.parent_organization_id = c.fs_queenstown_id)
    THEN 'PASS'
    ELSE 'FAIL'
  END AS value;

-- 9) Zone bridge checks (legacy zones linked to geo_zones)
SELECT
  'zone_geo_bridge' AS section,
  z.id::text || ':kind=' || COALESCE(z.zone_kind, 'null') || ':geo_zone=' || COALESCE(z.geo_zone_id::text, 'null') AS value
FROM public.zones z
WHERE z.id IN (
  '22222222-0001-0001-0584-000000000001'::uuid,
  '22222222-0001-0001-0585-000000000001'::uuid,
  '22222222-0001-0001-0587-000000000001'::uuid
)
ORDER BY z.id;

-- 10) Summary counts for live pipelines
SELECT
  'pipeline_counts' AS section,
  'dispatch_jobs=' || COALESCE((SELECT COUNT(*) FROM public.dispatch_jobs), 0)::text
  || ', patrol_events=' || COALESCE((SELECT COUNT(*) FROM public.patrol_events), 0)::text
  || ', operational_cases=' || COALESCE((SELECT COUNT(*) FROM public.operational_cases), 0)::text
  || ', geo_zones=' || COALESCE((SELECT COUNT(*) FROM public.geo_zones), 0)::text
  || ', client_sites=' || COALESCE((SELECT COUNT(*) FROM public.client_sites), 0)::text AS value;
