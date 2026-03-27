-- ============================================================================
-- Fix get_user_organization_ids stability and parsing resilience
-- Date: 2026-03-26
-- Purpose:
--   1) Rebuild helper with defensive EXCEPTION handling
--   2) Avoid fragile inline recursive query patterns by using helper RPC
--   3) Preserve role semantics: master sees all active orgs; admin/admin_officer
--      also receive descendants; all users include authorized work locations
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_organization_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id         uuid;
  v_role           text;
  v_work_locations uuid[];
  v_extra_org_ids  uuid[];
  v_descendants    uuid[];
  v_result         uuid[];
BEGIN
  -- SECURITY DEFINER bypasses RLS recursion when reading user_profiles.
  SELECT organization_id,
         role,
         COALESCE(authorized_work_locations, ARRAY[]::uuid[]),
         COALESCE(extra_organization_ids, ARRAY[]::uuid[])
  INTO   v_org_id, v_role, v_work_locations, v_extra_org_ids
  FROM   public.user_profiles
  WHERE  id = auth.uid();

  -- Master/grand_master users can access all active organizations.
  IF v_role IN ('grand_master', 'master') THEN
    SELECT ARRAY_AGG(o.id)
    INTO   v_result
    FROM   public.organizations o
    WHERE  o.is_active = true;

    RETURN COALESCE(v_result, ARRAY[]::uuid[]);
  END IF;

  -- Start with primary org if present.
  IF v_org_id IS NOT NULL THEN
    v_result := ARRAY[v_org_id]::uuid[];
  ELSE
    v_result := ARRAY[]::uuid[];
  END IF;

  -- Admin/admin_officer inherit visibility across descendants.
  IF v_role IN ('admin', 'admin_officer') AND v_org_id IS NOT NULL THEN
    v_descendants := get_descendant_organizations(v_org_id);
    v_result := array_cat(v_result, COALESCE(v_descendants, ARRAY[]::uuid[]));
  END IF;

  -- Include explicitly authorized work locations.
  IF v_work_locations IS NOT NULL AND array_length(v_work_locations, 1) > 0 THEN
    v_result := array_cat(v_result, v_work_locations);
  END IF;

  -- Include explicit multi-organization memberships.
  IF v_extra_org_ids IS NOT NULL AND array_length(v_extra_org_ids, 1) > 0 THEN
    v_result := array_cat(v_result, v_extra_org_ids);
  END IF;

  -- Deduplicate and normalize NULL -> empty array.
  SELECT ARRAY_AGG(DISTINCT org_id)
  INTO   v_result
  FROM   unnest(COALESCE(v_result, ARRAY[]::uuid[])) AS org_id;

  RETURN COALESCE(v_result, ARRAY[]::uuid[]);

EXCEPTION
  WHEN invalid_text_representation OR data_exception THEN
    -- Fail closed but keep user online: fallback to primary org only.
    IF v_org_id IS NOT NULL THEN
      RETURN ARRAY[v_org_id]::uuid[];
    END IF;
    RETURN ARRAY[]::uuid[];
END;
$$;

COMMENT ON FUNCTION public.get_user_organization_ids() IS
  'Returns all organization IDs user may access: primary org + descendants (admin/admin_officer) + authorized_work_locations + extra_organization_ids. grand_master/master can access all active orgs. Uses SECURITY DEFINER and defensive exception handling.';
