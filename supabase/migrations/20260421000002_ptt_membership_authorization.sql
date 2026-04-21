-- =============================================================================
-- PTT membership-based authorization
-- Date: 2026-04-21
--
-- Purpose:
--   Decouple PTT from provider/service access grants.
--
-- Rule:
--   A user may access a PTT org channel only when the target organization is in
--   that user's explicit organization membership set:
--     - primary organization_id
--     - employer_organization_id
--     - authorized_work_locations[]
--     - extra_organization_ids[]
--
-- Notes:
--   - This keeps PTT mostly stand-alone communication.
--   - It prevents radio access from being implicitly granted by provider-client
--     service resale or workflow access tables.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_access_ptt_channel(p_channel_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_allowed_orgs uuid[];
BEGIN
  IF auth.uid() IS NULL OR p_channel_org_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT
    organization_id,
    employer_organization_id,
    COALESCE(authorized_work_locations, ARRAY[]::uuid[]) AS authorized_work_locations,
    COALESCE(extra_organization_ids, ARRAY[]::uuid[]) AS extra_organization_ids
  INTO v_profile
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT org_id
    FROM unnest(
      array_cat(
        array_cat(
          ARRAY[v_profile.organization_id, v_profile.employer_organization_id]::uuid[],
          v_profile.authorized_work_locations
        ),
        v_profile.extra_organization_ids
      )
    ) AS org_id
    WHERE org_id IS NOT NULL
  ) INTO v_allowed_orgs;

  RETURN p_channel_org_id = ANY(COALESCE(v_allowed_orgs, ARRAY[]::uuid[]));
END;
$$;

COMMENT ON FUNCTION public.can_access_ptt_channel(uuid) IS
  'Returns true when auth.uid() is explicitly affiliated with the target org via primary org, employer org, authorized_work_locations, or extra_organization_ids. PTT is intentionally decoupled from provider/service grants.';

GRANT EXECUTE ON FUNCTION public.can_access_ptt_channel(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_ptt_cross_org_auth(
  p_user_id uuid,
  p_target_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_allowed_orgs uuid[];
BEGIN
  IF p_user_id IS NULL OR p_target_org_id IS NULL THEN
    RETURN jsonb_build_object('authorized', FALSE, 'reason', 'Missing user or organization');
  END IF;

  SELECT
    id,
    organization_id,
    employer_organization_id,
    COALESCE(authorized_work_locations, ARRAY[]::uuid[]) AS authorized_work_locations,
    COALESCE(extra_organization_ids, ARRAY[]::uuid[]) AS extra_organization_ids
  INTO v_profile
  FROM public.user_profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('authorized', FALSE, 'reason', 'User profile not found');
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT org_id
    FROM unnest(
      array_cat(
        array_cat(
          ARRAY[v_profile.organization_id, v_profile.employer_organization_id]::uuid[],
          v_profile.authorized_work_locations
        ),
        v_profile.extra_organization_ids
      )
    ) AS org_id
    WHERE org_id IS NOT NULL
  ) INTO v_allowed_orgs;

  IF p_target_org_id = ANY(COALESCE(v_allowed_orgs, ARRAY[]::uuid[])) THEN
    RETURN jsonb_build_object(
      'authorized', TRUE,
      'reason', 'Explicit organization membership',
      'channel', 'org:' || p_target_org_id
    );
  END IF;

  RETURN jsonb_build_object('authorized', FALSE, 'reason', 'Target organization is not in employer/authorized org memberships');
END;
$$;

COMMENT ON FUNCTION public.check_ptt_cross_org_auth(uuid, uuid) IS
  'PTT cross-org authorization based only on explicit org membership: primary org, employer org, authorized_work_locations, and extra_organization_ids.';

GRANT EXECUTE ON FUNCTION public.check_ptt_cross_org_auth(uuid, uuid) TO authenticated, service_role;
