-- Per-organization toggle for patrol chain audit logging.

CREATE TABLE IF NOT EXISTS public.key_audit_settings (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.update_key_audit_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_key_audit_settings_updated_at ON public.key_audit_settings;
CREATE TRIGGER trg_key_audit_settings_updated_at
  BEFORE UPDATE ON public.key_audit_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_key_audit_settings_updated_at();

ALTER TABLE public.key_audit_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_key_audit_settings" ON public.key_audit_settings;
CREATE POLICY "admins_manage_key_audit_settings" ON public.key_audit_settings FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

COMMENT ON TABLE public.key_audit_settings IS
  'Per-organization enable/disable toggle for patrol chain audit logging.';

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
  v_enabled BOOLEAN := true;
BEGIN
  SELECT is_enabled
    INTO v_enabled
  FROM public.key_audit_settings
  WHERE organization_id = p_organization_id;

  IF v_enabled IS FALSE THEN
    RETURN NULL;
  END IF;

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
