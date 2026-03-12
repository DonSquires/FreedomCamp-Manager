-- ============================================================================
-- Fix officer role: compliance page access + observation SELECT RLS
-- Date: 2026-03-20
--
-- Changes:
--   1. Ensure officers can SELECT their org's observations (explicit policy).
--   2. Add `officers_select_observations` as a named, auditable policy.
--   3. Add a diagnostic helper function officers_observation_debug() so admins
--      can verify what an officer user actually sees without impersonating them.
-- ============================================================================

-- ── 1. Explicit SELECT policy for officers ───────────────────────────────────
-- The existing `users_view_observations` policy already covers officers via
-- get_user_organization_ids().  We add an explicit named policy for clarity
-- and so admins can see it in pg_policies without needing to read the code.

DROP POLICY IF EXISTS officers_select_observations ON public.observations;

CREATE POLICY officers_select_observations
  ON public.observations
  FOR SELECT
  TO authenticated
  USING (
    -- Officers see their own organisation's observations (primary org + work locations)
    organization_id = ANY (get_user_organization_ids())
  );

COMMENT ON POLICY officers_select_observations ON public.observations IS
  'Officers and all authenticated users can SELECT observations in their accessible '
  'organisations (primary org + authorized_work_locations). '
  'Mirrors users_view_observations but is named for clarity.';

-- ── 2. Diagnostic RPC: what does this officer actually see? ──────────────────
--
-- Usage: SELECT * FROM officers_observation_debug('<user-uuid>');
-- Returns the org IDs the given user can access and a sample observation count.

CREATE OR REPLACE FUNCTION public.officers_observation_debug(p_user_id uuid)
RETURNS TABLE (
  user_id             uuid,
  user_role           text,
  primary_org_id      uuid,
  accessible_org_ids  uuid[],
  observation_count   bigint,
  legacy_import_count bigint,
  notes               text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role         text;
  v_primary_org  uuid;
  v_org_ids      uuid[];
  v_obs_count    bigint;
  v_legacy_count bigint;
BEGIN
  -- Look up the user's profile
  SELECT up.role, up.organization_id
  INTO   v_role, v_primary_org
  FROM   public.user_profiles up
  WHERE  up.id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      p_user_id, 'NOT_FOUND'::text, NULL::uuid, ARRAY[]::uuid[], 0::bigint, 0::bigint,
      'No user_profiles row found for this user_id'::text;
    RETURN;
  END IF;

  -- Simulate get_user_organization_ids() for this user
  -- (We can't call it directly for another user; replicate the logic here)
  IF v_role = 'master' THEN
    SELECT array_agg(id) INTO v_org_ids
    FROM   public.organizations
    WHERE  is_active = true;
  ELSE
    SELECT
      array_agg(DISTINCT org_id)
    INTO v_org_ids
    FROM (
      -- primary org
      SELECT v_primary_org AS org_id
      WHERE  v_primary_org IS NOT NULL
      UNION ALL
      -- authorized work locations
      SELECT unnest(authorized_work_locations)
      FROM   public.user_profiles
      WHERE  id = p_user_id
    ) sub;
  END IF;

  v_org_ids := COALESCE(v_org_ids, ARRAY[]::uuid[]);

  -- Count how many observations the user would see
  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_legacy_import = true)
  INTO   v_obs_count, v_legacy_count
  FROM   public.observations
  WHERE  organization_id = ANY (v_org_ids)
    AND  deleted_at IS NULL;

  RETURN QUERY SELECT
    p_user_id,
    v_role,
    v_primary_org,
    v_org_ids,
    v_obs_count,
    v_legacy_count,
    CASE
      WHEN array_length(v_org_ids, 1) IS NULL OR array_length(v_org_ids, 1) = 0
        THEN 'WARNING: user has no accessible organisations – RLS will return 0 rows'
      WHEN v_obs_count = 0
        THEN 'User has org access but sees 0 observations – check data was imported'
      ELSE 'OK – user can see ' || v_obs_count || ' observations across ' ||
           array_length(v_org_ids, 1) || ' org(s)'
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.officers_observation_debug(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.officers_observation_debug(uuid) TO service_role;

COMMENT ON FUNCTION public.officers_observation_debug(uuid) IS
  'Admin diagnostic: shows what organisations a given user can access and '
  'how many observations they would see. Run as admin/master to debug "zero data" issues.';

-- ── 3. Verification ──────────────────────────────────────────────────────────

DO $$
DECLARE
  v_policy_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO   v_policy_count
  FROM   pg_policies
  WHERE  schemaname = 'public'
    AND  tablename  = 'observations'
    AND  policyname IN ('users_view_observations', 'officers_select_observations');

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260320_fix_officer_compliance_access complete';
  RAISE NOTICE '   observations SELECT policies in place: %', v_policy_count;
  RAISE NOTICE '   Diagnostic function officers_observation_debug() created';
  RAISE NOTICE '';
  RAISE NOTICE 'To diagnose a specific officer run:';
  RAISE NOTICE '  SELECT * FROM officers_observation_debug(''<user-uuid>'');';
  RAISE NOTICE '';
END;
$$;
