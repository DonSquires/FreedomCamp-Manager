-- ============================================================================
-- Contractor Organisations
-- Date: 2026-04-28
--
-- The service provider (First Security) engages sub-contracted security
-- companies to cover areas where it does not maintain a full branch.
--
-- Examples from the requirement:
--   • Auckland   – multiple contractors called in as needed
--   • Gore       – single contractor covering the entire workload for the town
--   • Wānaka     – single contractor covering the entire workload for the town
--
-- Changes:
--   1. Add 'contractor' to organizations.organization_type CHECK constraint
--   2. Create First Security – Auckland branch (was missing from initial seed)
--   3. Create Auckland contractor companies (×2) under Auckland branch
--   4. Create Gore contractor (×1) under Invercargill branch (Southland)
--   5. Create Wānaka contractor (×1) under Queenstown branch (Lakes District)
-- ============================================================================

-- ── 1. Expand organization_type to include 'contractor' ───────────────────────

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_organization_type_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_organization_type_check
    CHECK (organization_type IN (
      'owner',
      'service_provider',
      'client',
      'contractor',
      'operator',
      'security_company'
    ));

COMMENT ON COLUMN public.organizations.organization_type IS
  'owner          = platform owner (Iron Eagle Security). '
  'service_provider = nationwide security company (First Security + its branches). '
  'client         = end-customer organisation (councils, Crown entities, businesses). '
  'contractor     = sub-contracted security/patrol company engaged by the service provider. '
  'operator       = freedom-camping site operator. '
  'security_company = legacy value; use service_provider or contractor for new records.';

-- ── 2. Create First Security – Auckland branch ────────────────────────────────

DO $$
DECLARE
  v_first_security_id UUID;
BEGIN
  SELECT id INTO v_first_security_id
  FROM public.organizations
  WHERE lower(name) LIKE '%first security%'
    AND organization_type = 'service_provider'
  ORDER BY organization_level, created_at
  LIMIT 1;

  IF v_first_security_id IS NULL THEN
    RAISE NOTICE '⚠️  First Security not found – skipping Auckland branch creation.';
    RETURN;
  END IF;

  INSERT INTO public.organizations (
    name,
    organization_type,
    organization_level,
    parent_organization_id,
    is_active,
    enforcement_workflow,
    overnight_verification_mode
  )
  SELECT
    'First Security - Auckland',
    'service_provider',
    3,
    v_first_security_id,
    true,
    'officer_first',
    'two_photo_verification'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE name = 'First Security - Auckland'
  );

  RAISE NOTICE '✅ First Security – Auckland branch created/confirmed';
END $$;

-- ── 3. Create contractor organisations ────────────────────────────────────────
--
-- Contractors are level 4, type = 'contractor', parented to the relevant
-- First Security branch.  Their users will have:
--   employer_organization_id = the contractor org id
--   authorized_work_locations = the client org ids they are contracted to serve
--
-- Auckland: multiple contractors engaged on a call-in basis.
-- Gore:     Gore Security – sole contractor for the town.
-- Wānaka:   Aspiring Locksmiths – sole contractor for the town.
-- South Otago: South Otago Security – under Dunedin branch.

DO $$
DECLARE
  v_first_security_id      UUID;
  v_auckland_branch_id     UUID;
  v_invercargill_branch_id UUID;
  v_queenstown_branch_id   UUID;
  v_dunedin_branch_id      UUID;
  v_christchurch_branch_id UUID;
BEGIN
  -- Fallback parent if a specific branch is not yet present
  SELECT id INTO v_first_security_id
  FROM public.organizations
  WHERE lower(name) LIKE '%first security%'
    AND organization_type = 'service_provider'
  ORDER BY organization_level, created_at
  LIMIT 1;

  SELECT id INTO v_auckland_branch_id
  FROM public.organizations
  WHERE name = 'First Security - Auckland'
  LIMIT 1;

  SELECT id INTO v_invercargill_branch_id
  FROM public.organizations
  WHERE name = 'First Security - Invercargill'
  LIMIT 1;

  SELECT id INTO v_queenstown_branch_id
  FROM public.organizations
  WHERE name = 'First Security - Queenstown'
  LIMIT 1;

  SELECT id INTO v_dunedin_branch_id
  FROM public.organizations
  WHERE name = 'First Security - Dunedin'
  LIMIT 1;

  SELECT id INTO v_christchurch_branch_id
  FROM public.organizations
  WHERE name = 'First Security - Christchurch'
  LIMIT 1;

  -- Insert contractors (idempotent by name)
  INSERT INTO public.organizations (
    name,
    organization_type,
    organization_level,
    parent_organization_id,
    is_active,
    enforcement_workflow,
    overnight_verification_mode
  )
  SELECT
    contractor_name,
    'contractor',
    4,
    parent_id,
    true,
    'officer_first',
    'two_photo_verification'
  FROM (
    VALUES
      -- ── Auckland – multiple contractors (called in as needed) ──────────
      (
        'Auckland Metro Security Ltd',
        COALESCE(v_auckland_branch_id, v_first_security_id)
      ),
      (
        'North Shore Patrol Services',
        COALESCE(v_auckland_branch_id, v_first_security_id)
      ),
      -- ── Gore – Gore Security covers the full town workload ────────────
      (
        'Gore Security',
        COALESCE(v_invercargill_branch_id, v_first_security_id)
      ),
      -- ── Wānaka – Aspiring Locksmiths covers the full town workload ────
      (
        'Aspiring Locksmiths',
        COALESCE(v_queenstown_branch_id, v_first_security_id)
      ),
      -- ── South Otago – South Otago Security under Dunedin branch ───────
      (
        'South Otago Security',
        COALESCE(v_dunedin_branch_id, v_first_security_id)
      ),
      -- ── Christchurch – October Security (current, extra guarding staff) ─
      (
        'October Security',
        COALESCE(v_christchurch_branch_id, v_first_security_id)
      )
  ) AS contractors(contractor_name, parent_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE name = contractor_name
  );

  RAISE NOTICE '✅ Contractor organisations created/confirmed';
  RAISE NOTICE '   Auckland Metro Security Ltd → Auckland branch';
  RAISE NOTICE '   North Shore Patrol Services → Auckland branch';
  RAISE NOTICE '   Gore Security               → Invercargill branch (Gore town)';
  RAISE NOTICE '   Aspiring Locksmiths         → Queenstown branch (Wānaka town)';
  RAISE NOTICE '   South Otago Security        → Dunedin branch (South Otago)';
  RAISE NOTICE '   October Security            → Christchurch branch (extra guarding staff)';
END $$;

-- ── 4. RLS: contractors can read their own org record ────────────────────────
--
-- Users whose employer_organization_id points to a contractor org get access
-- through the existing get_user_organization_ids() RLS logic (which traverses
-- the org hierarchy).  No new policy is needed for data access.
--
-- However, contractor orgs should be visible to grand_master / master users
-- via the existing grand_master_all_orgs policy.  No action required.

-- Summary notice
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE 'Contractor organisation migration complete.';
  RAISE NOTICE 'New org type "contractor" added to organizations.organization_type.';
  RAISE NOTICE '6 contractor organisations seeded:';
  RAISE NOTICE '  Auckland Metro Security Ltd, North Shore Patrol Services,';
  RAISE NOTICE '  Gore Security, Aspiring Locksmiths,';
  RAISE NOTICE '  South Otago Security, October Security.';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
END $$;
