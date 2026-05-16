-- Safe RPC wrapper for app-driven key audit logging.

CREATE OR REPLACE FUNCTION public.record_key_audit(
  p_organization_id UUID,
  p_action TEXT DEFAULT 'inventory_check',
  p_key_set_id UUID DEFAULT NULL,
  p_key_custody_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_audit_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('grand_master', 'master', 'admin', 'admin_officer', 'officer') THEN
    RAISE EXCEPTION 'Not authorized to record key audits';
  END IF;

  INSERT INTO public.key_audit_log (
    organization_id,
    key_set_id,
    key_custody_id,
    action,
    performed_by,
    details
  )
  VALUES (
    p_organization_id,
    p_key_set_id,
    p_key_custody_id,
    p_action,
    auth.uid(),
    COALESCE(p_details, '{}'::JSONB)
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_key_audit(UUID, TEXT, UUID, UUID, JSONB) TO authenticated;