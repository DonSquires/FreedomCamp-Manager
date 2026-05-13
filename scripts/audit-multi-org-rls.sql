-- Multi-org RLS verification script
--
-- Purpose:
--   Validate that SELECT access includes organizations listed in
--   JWT claim user_authorised_organisations for observations and patrol_logs.
--
-- How to use:
--   1) Edit the UUID values in the INSERT below.
--   2) Run in Supabase SQL Editor (or psql as a privileged role).
--   3) Review result sets and notices.

BEGIN;

CREATE TEMP TABLE _rls_cfg (
  test_user_id uuid NOT NULL,
  primary_org_id uuid NOT NULL,
  authorised_secondary_org_id uuid NOT NULL,
  unauthorized_org_id uuid NOT NULL
) ON COMMIT DROP;

-- Replace these with real IDs from your environment.
INSERT INTO _rls_cfg (
  test_user_id,
  primary_org_id,
  authorised_secondary_org_id,
  unauthorized_org_id
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
);

DO $$
DECLARE
  v_cfg _rls_cfg%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM _rls_cfg LIMIT 1;

  IF v_cfg.test_user_id = '00000000-0000-0000-0000-000000000001'::uuid
     OR v_cfg.primary_org_id = '00000000-0000-0000-0000-000000000002'::uuid
     OR v_cfg.authorised_secondary_org_id = '00000000-0000-0000-0000-000000000003'::uuid
     OR v_cfg.unauthorized_org_id = '00000000-0000-0000-0000-000000000004'::uuid THEN
    RAISE EXCEPTION 'Update _rls_cfg UUID placeholders before running this audit.';
  END IF;
END;
$$;

-- Simulate authenticated JWT for test user with explicit multi-org authorization.
SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', c.test_user_id::text,
    'role', 'authenticated',
    'user_authorised_organisations', jsonb_build_array(c.authorised_secondary_org_id::text)
  )::text,
  true
)
FROM _rls_cfg c;

-- 1) Policy presence checks
SELECT
  'policy_exists_observations' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'observations'
      AND p.policyname = 'org_scope_select_observations_v2'
  ) AS passed;

SELECT
  'policy_exists_patrol_logs_when_table_present' AS check_name,
  CASE
    WHEN to_regclass('public.patrol_logs') IS NULL THEN NULL
    ELSE EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'patrol_logs'
        AND p.policyname = 'org_scope_select_patrol_logs_v2'
    )
  END AS passed;

-- 2) Helper evaluation checks (deterministic policy logic)
SELECT
  'helper_primary_org_access' AS check_name,
  public.user_can_read_organization(c.primary_org_id) AS actual,
  true AS expected
FROM _rls_cfg c;

SELECT
  'helper_authorised_secondary_org_access' AS check_name,
  public.user_can_read_organization(c.authorised_secondary_org_id) AS actual,
  true AS expected
FROM _rls_cfg c;

SELECT
  'helper_unauthorized_org_access' AS check_name,
  public.user_can_read_organization(c.unauthorized_org_id) AS actual,
  false AS expected
FROM _rls_cfg c;

-- 3) Table-level SELECT smoke checks (row-count based)
-- Note: zero rows can mean either no data or no access. Use with seeded data.
SELECT
  'observations_rows_primary_org' AS check_name,
  count(*)::bigint AS row_count
FROM public.observations o
JOIN _rls_cfg c ON c.primary_org_id = o.organization_id;

SELECT
  'observations_rows_authorised_secondary_org' AS check_name,
  count(*)::bigint AS row_count
FROM public.observations o
JOIN _rls_cfg c ON c.authorised_secondary_org_id = o.organization_id;

SELECT
  'observations_rows_unauthorized_org' AS check_name,
  count(*)::bigint AS row_count
FROM public.observations o
JOIN _rls_cfg c ON c.unauthorized_org_id = o.organization_id;

DO $$
BEGIN
  IF to_regclass('public.patrol_logs') IS NOT NULL THEN
    RAISE NOTICE 'patrol_logs table detected. Run these three checks manually with your org IDs:';
    RAISE NOTICE 'SELECT count(*) FROM public.patrol_logs WHERE organization_id = <primary_org_id>;';
    RAISE NOTICE 'SELECT count(*) FROM public.patrol_logs WHERE organization_id = <authorised_secondary_org_id>;';
    RAISE NOTICE 'SELECT count(*) FROM public.patrol_logs WHERE organization_id = <unauthorized_org_id>;';
  ELSE
    RAISE NOTICE 'patrol_logs table not present in this database. Skipping table-level patrol_logs checks.';
  END IF;
END;
$$;

ROLLBACK;
