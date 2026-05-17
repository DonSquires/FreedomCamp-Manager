-- Enforce signed service agreement before activating client/operator organizations.

ALTER TABLE public.service_agreements
  ADD COLUMN IF NOT EXISTS is_signed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_temporary_migration_agreement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS migration_agreement_notice TEXT;

COMMENT ON COLUMN public.service_agreements.is_signed IS
  'True when the agreement has been formally signed and is activation-eligible.';

COMMENT ON COLUMN public.service_agreements.signed_at IS
  'Timestamp when the agreement was signed.';

COMMENT ON COLUMN public.service_agreements.signed_by IS
  'User profile that recorded signature completion.';

COMMENT ON COLUMN public.service_agreements.is_temporary_migration_agreement IS
  'Temporary activation bridge used only during migration when a formal signed agreement is not yet loaded.';

COMMENT ON COLUMN public.service_agreements.migration_agreement_notice IS
  'Required explicit notice for migration bridge agreements: "REAL SERVICE AGREEMENT REQUIRED".';

UPDATE public.service_agreements
SET migration_agreement_notice = 'REAL SERVICE AGREEMENT REQUIRED - Temporary migration agreement only. Must be replaced with a formally signed service agreement.'
WHERE is_temporary_migration_agreement = true
  AND COALESCE(NULLIF(TRIM(migration_agreement_notice), ''), '') = '';

CREATE OR REPLACE FUNCTION public.validate_client_activation_requires_signed_agreement()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_signed_agreement BOOLEAN := false;
  v_has_temporary_migration_agreement BOOLEAN := false;
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

    SELECT EXISTS (
      SELECT 1
      FROM public.service_agreements sa
      WHERE (sa.organization_id = NEW.id OR sa.client_org_id = NEW.id)
        AND COALESCE(sa.is_temporary_migration_agreement, false) = true
        AND (
          COALESCE(sa.is_active, false) = true
          OR COALESCE(sa.status, '') = 'active'
        )
        AND (sa.active_to IS NULL OR sa.active_to >= CURRENT_DATE)
        AND UPPER(COALESCE(sa.migration_agreement_notice, '')) LIKE '%REAL SERVICE AGREEMENT REQUIRED%'
    )
    INTO v_has_temporary_migration_agreement;

    IF NOT v_has_signed_agreement AND NOT v_has_temporary_migration_agreement THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Cannot activate client/operator organization without either a signed active service agreement or a temporary migration agreement explicitly stating REAL SERVICE AGREEMENT REQUIRED.';
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
