-- Backfill First Security provider access grants for LINZ/Nelson clients.

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
