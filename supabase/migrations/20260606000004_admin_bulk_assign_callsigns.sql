-- Admin utility: bulk assign/regenerate callsigns for an organisation.
-- Uses trigger-based assignment and organisation initials (e.g. FSN23, NCC10).

CREATE OR REPLACE FUNCTION public.admin_bulk_assign_callsigns(
  p_organization_id uuid,
  p_force boolean DEFAULT false
)
RETURNS TABLE(updated_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
  affected integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'p_organization_id is required';
  END IF;

  SELECT public.get_user_role(auth.uid()) INTO actor_role;

  IF actor_role NOT IN ('admin', 'admin_officer', 'master', 'grand_master') THEN
    RAISE EXCEPTION 'Insufficient privileges to assign callsigns';
  END IF;

  IF actor_role NOT IN ('master', 'grand_master')
     AND NOT EXISTS (
       SELECT 1
       FROM unnest(public.get_user_organization_ids(auth.uid())) AS org_id
       WHERE org_id = p_organization_id
     )
  THEN
    RAISE EXCEPTION 'Organization is outside your scope';
  END IF;

  UPDATE public.user_profiles up
  SET callsign = NULL
  WHERE COALESCE(up.employer_organization_id, up.organization_id) = p_organization_id
    AND (
      p_force
      OR up.callsign IS NULL
      OR btrim(up.callsign) = ''
    );

  GET DIAGNOSTICS affected = ROW_COUNT;

  RETURN QUERY SELECT affected;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_assign_callsigns(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_assign_callsigns(uuid, boolean) TO authenticated;
