-- PTT-specific access checker used by ptt-signaling-token edge function.

CREATE OR REPLACE FUNCTION public.can_access_ptt_channel(p_channel_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_service(p_channel_org_id, 'ptt_access');
$$;

GRANT EXECUTE ON FUNCTION public.can_access_ptt_channel(uuid) TO authenticated, service_role;
