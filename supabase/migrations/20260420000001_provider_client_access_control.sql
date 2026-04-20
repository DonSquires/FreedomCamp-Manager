-- Provider ⇄ Client access grants with client-controlled allow_without_roster toggle.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'provider_service_type'
  ) THEN
    CREATE TYPE public.provider_service_type AS ENUM (
      'freedom_camping',
      'ptt_access',
      'site_guarding',
      'parking_enforcement',
      'noise_control',
      'biosecurity_inspection',
      'smoke_complaint_ooh',
      'welfare_checks'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.provider_client_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_type public.provider_service_type NOT NULL,
  allow_without_roster boolean NOT NULL DEFAULT false,
  limited_to_sites uuid[] NULL,
  limited_to_zones uuid[] NULL,
  granted_by uuid NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  revoked_at timestamptz NULL,
  is_active boolean GENERATED ALWAYS AS (revoked_at IS NULL) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_client_access_grants_provider_client_service_key UNIQUE (provider_org_id, client_org_id, service_type),
  CONSTRAINT provider_client_access_grants_org_pair_check CHECK (provider_org_id <> client_org_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_client_access_grants_provider_org
  ON public.provider_client_access_grants(provider_org_id);

CREATE INDEX IF NOT EXISTS idx_provider_client_access_grants_client_org
  ON public.provider_client_access_grants(client_org_id);

CREATE INDEX IF NOT EXISTS idx_provider_client_access_grants_active
  ON public.provider_client_access_grants(client_org_id, service_type)
  WHERE revoked_at IS NULL;

ALTER TABLE public.provider_client_access_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_admins_view_provider_grants" ON public.provider_client_access_grants;
CREATE POLICY "client_admins_view_provider_grants"
  ON public.provider_client_access_grants
  FOR SELECT
  TO authenticated
  USING (
    client_org_id = ANY(public.get_user_organization_ids())
      AND public.get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  );

DROP POLICY IF EXISTS "client_admins_manage_provider_grants" ON public.provider_client_access_grants;
CREATE POLICY "client_admins_manage_provider_grants"
  ON public.provider_client_access_grants
  FOR ALL
  TO authenticated
  USING (
    client_org_id = ANY(public.get_user_organization_ids())
      AND public.get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  )
  WITH CHECK (
    client_org_id = ANY(public.get_user_organization_ids())
      AND public.get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  );
