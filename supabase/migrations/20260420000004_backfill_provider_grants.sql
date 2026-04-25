-- Backfill First Security provider access grants for LINZ/Nelson clients.

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_client_access_grants_conflict_key
  ON public.provider_client_access_grants(provider_org_id, client_org_id, service_type);

WITH provider_orgs AS (
  SELECT id
  FROM public.organizations
  WHERE LOWER(name) IN ('first security', 'first security nz', 'first security limited')
),
client_orgs AS (
  SELECT id
  FROM public.organizations
  WHERE LOWER(name) IN (
    'linz',
    'land information new zealand',
    'nelson',
    'nelson city council'
  )
),
service_types AS (
  SELECT unnest(ARRAY['freedom_camping', 'ptt_access']::public.provider_service_type[]) AS service_type
)
INSERT INTO public.provider_client_access_grants (
  provider_org_id,
  client_org_id,
  service_type,
  allow_without_roster,
  granted_at,
  revoked_at,
  updated_at
)
SELECT
  p.id,
  c.id,
  s.service_type,
  true,
  now(),
  NULL,
  now()
FROM provider_orgs p
CROSS JOIN client_orgs c
CROSS JOIN service_types s
ON CONFLICT (provider_org_id, client_org_id, service_type)
DO UPDATE SET
  allow_without_roster = true,
  revoked_at = NULL,
  revoked_by = NULL,
  updated_at = now();
