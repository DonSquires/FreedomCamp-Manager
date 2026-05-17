-- Enforce signed service agreement before activating client/operator organizations.

ALTER TABLE public.service_agreements
  ADD COLUMN IF NOT EXISTS is_signed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.service_agreements.is_signed IS
  'True when the agreement has been formally signed and is activation-eligible.';

COMMENT ON COLUMN public.service_agreements.signed_at IS
  'Timestamp when the agreement was signed.';

COMMENT ON COLUMN public.service_agreements.signed_by IS
  'User profile that recorded signature completion.';

CREATE OR REPLACE FUNCTION public.validate_client_activation_requires_signed_agreement()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_signed_agreement BOOLEAN := false;
BEGIN
  -- Only enforce on inactive -> active transitions for client-like organizations.
  IF COALESCE(OLD.is_active, false) = false
     AND COALESCE(NEW.is_active, false) = true
     AND COALESCE(NEW.organization_type, '') IN ('client', 'operator') THEN

    SELECT EXISTS (
      SELECT 1
      FROM public.service_agreements sa
      WHERE (sa.organization_id = NEW.id OR sa.client_org_id = NEW.id)
        AND COALESCE(sa.is_signed, false) = true
        AND (
          COALESCE(sa.is_active, false) = true
          OR COALESCE(sa.status, '') = 'active'
        )
        AND (sa.active_to IS NULL OR sa.active_to >= CURRENT_DATE)
    )
    INTO v_has_signed_agreement;

    IF NOT v_has_signed_agreement THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Cannot activate client/operator organization without a signed active service agreement.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_signed_agreement_on_client_activation ON public.organizations;
CREATE TRIGGER trg_require_signed_agreement_on_client_activation
  BEFORE UPDATE OF is_active ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_client_activation_requires_signed_agreement();
