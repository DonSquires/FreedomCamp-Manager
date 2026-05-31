-- Align First Security provider hierarchy and employer linkage.
--
-- Why:
-- 1) The First Security root org was incorrectly typed as client in some
--    environments, while its branch model is service-provider.
-- 2) A subset of provider staff were linked with employer_organization_id
--    pointing at the client parent org, which could force provider workflows
--    into client context.
--
-- This migration is idempotent and only applies to the precise mismatch shape.

-- Ensure First Security root is a service provider.
UPDATE public.organizations
SET
  organization_type = 'service_provider',
  updated_at = now()
WHERE name = 'First Security'
  AND organization_type <> 'service_provider';

-- Normalize employer linkage for provider staff whose employer points to
-- their direct client parent. Keep this tightly scoped.
UPDATE public.user_profiles up
SET
  employer_organization_id = up.organization_id,
  updated_at = now()
FROM public.organizations org
JOIN public.organizations emp
  ON emp.id = up.employer_organization_id
WHERE org.id = up.organization_id
  AND org.organization_type = 'service_provider'
  AND emp.organization_type = 'client'
  AND org.parent_organization_id = emp.id
  AND up.employer_organization_id <> up.organization_id;
