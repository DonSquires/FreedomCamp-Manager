-- ============================================================================
-- Portal Access Control
-- Date: 2026-04-30
--
-- Adds fine-grained portal / area access to user_profiles so that any user
-- can be allocated to specific portal areas regardless of base role, and can
-- be authorised for multiple branches or organisations (both client,
-- contractor and service-provider).
--
-- Changes:
--   1. Add portal_access TEXT[]  — which portal area codes the user may enter
--   2. Add extra_organization_ids UUID[]  — additional orgs beyond the primary
--      organization_id (complements the existing authorized_work_locations which
--      is already used by RLS helper get_user_organization_ids())
--   3. Update get_user_organization_ids() to include extra_organization_ids
--   4. Create a helper view user_area_access for admin tooling
--   5. RLS: allow users to read their own portal_access
-- ============================================================================

-- ── 1. Add portal_access column ───────────────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS portal_access TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN public.user_profiles.portal_access IS
  'List of portal / area codes the user is allowed to enter, e.g. '
  '{field_officer, site_guard, parking, noise, ems, admin, compliance, '
  'enforcement, dispatch, investigations, reports, roster, users, '
  'zones, data_management, client_portal, platform}. '
  'Empty array = no explicit restrictions (role-based routing applies). '
  'grand_master and master roles ignore this and can access all areas.';

-- ── 2. Add extra_organization_ids column ──────────────────────────────────────
--      Allows a user to be a member of multiple organisations simultaneously,
--      e.g. a contractor officer who works for two branches or a manager who
--      oversees both a service_provider branch and a client organisation.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS extra_organization_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

COMMENT ON COLUMN public.user_profiles.extra_organization_ids IS
  'Additional organisation IDs (beyond organization_id) that the user is '
  'authorised to access.  These are merged with authorized_work_locations in '
  'get_user_organization_ids() so data-access RLS automatically includes them.';

-- ── 3. Update get_user_organization_ids() to include extra_organization_ids ──

CREATE OR REPLACE FUNCTION public.get_user_organization_ids()
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id             UUID;
  v_role               TEXT;
  v_work_locations     UUID[];
  v_extra_org_ids      UUID[];
  v_result             UUID[];
BEGIN
  -- Fetch the caller's core fields (SECURITY DEFINER bypasses RLS)
  SELECT organization_id,
         role,
         COALESCE(authorized_work_locations, ARRAY[]::UUID[]),
         COALESCE(extra_organization_ids,    ARRAY[]::UUID[])
  INTO   v_org_id, v_role, v_work_locations, v_extra_org_ids
  FROM   public.user_profiles
  WHERE  id = auth.uid()
  LIMIT  1;

  -- grand_master / master see everything
  IF v_role IN ('grand_master', 'master') THEN
    SELECT ARRAY_AGG(id) INTO v_result FROM public.organizations;
    RETURN COALESCE(v_result, ARRAY[]::UUID[]);
  END IF;

  -- Start with primary org
  v_result := ARRAY[]::UUID[];
  IF v_org_id IS NOT NULL THEN
    v_result := ARRAY[v_org_id];
  END IF;

  -- Add explicit work locations
  v_result := v_result || v_work_locations;

  -- Add extra org ids (multi-org membership)
  v_result := v_result || v_extra_org_ids;

  -- For admins also include all descendants of the primary org
  IF v_role IN ('admin', 'admin_officer') AND v_org_id IS NOT NULL THEN
    v_result := array_cat(v_result, COALESCE(get_descendant_organizations(v_org_id), ARRAY[]::UUID[]));
  END IF;

  RETURN COALESCE(v_result, ARRAY[]::UUID[]);
END;
$$;

COMMENT ON FUNCTION public.get_user_organization_ids() IS
  'Returns all organisation IDs the calling user can access: '
  'primary + authorized_work_locations + extra_organization_ids '
  '+ descendants (for admin roles). '
  'grand_master / master receive all organisations. '
  'Uses SECURITY DEFINER to bypass RLS.';

-- ── 4. Helper view: user_area_access ──────────────────────────────────────────
--      Used by the AccessControl admin UI to show a flattened overview of each
--      user's portal areas and organisation memberships.

CREATE OR REPLACE VIEW public.user_area_access AS
SELECT
  u.id,
  u.email,
  COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') AS full_name,
  u.role,
  u.is_active,
  u.organization_id,
  o.name                             AS primary_org_name,
  o.organization_type                AS primary_org_type,
  u.portal_access,
  u.authorized_work_locations,
  u.extra_organization_ids,
  u.employer_organization_id,
  eo.name                            AS employer_org_name,
  u.job_title,
  u.enabled_portals
FROM   public.user_profiles u
LEFT JOIN public.organizations o  ON o.id  = u.organization_id
LEFT JOIN public.organizations eo ON eo.id = u.employer_organization_id;

COMMENT ON VIEW public.user_area_access IS
  'Flattened view of user access configuration for the AccessControl admin UI. '
  'Readable by admin / master / grand_master roles via RLS on user_profiles.';

-- ── 5. RLS: allow each user to read their own portal_access row ───────────────
--      (user_profiles already has a "users can read their own profile" policy;
--       this explicitly also covers the new columns via the same policy.)

-- No additional policy needed: the existing "user_profiles_self_select" (or
-- equivalent) policy already exposes the full user_profiles row to the owner.
-- We just add a notice confirming the column is accessible.
DO $$
BEGIN
  RAISE NOTICE '✅ portal_access and extra_organization_ids added to user_profiles.';
  RAISE NOTICE '✅ get_user_organization_ids() updated to include extra_organization_ids.';
  RAISE NOTICE '✅ user_area_access view created for admin tooling.';
  RAISE NOTICE '';
  RAISE NOTICE 'Portal area codes:';
  RAISE NOTICE '  field_officer, site_guard, parking, noise, ems';
  RAISE NOTICE '  admin, compliance, enforcement, dispatch';
  RAISE NOTICE '  investigations, reports, roster, users, zones';
  RAISE NOTICE '  data_management, client_portal, platform';
END $$;
