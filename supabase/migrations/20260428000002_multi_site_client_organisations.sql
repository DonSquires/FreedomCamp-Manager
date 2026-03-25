-- ============================================================================
-- Multi-Site Client Organisations: Cawthron Institute & Plant & Food Research
-- Date: 2026-04-28
--
-- Requirement: client organisations can have multiple sites.
-- Examples:
--   • Cawthron Institute (Nelson) – 5 sites across Nelson / Tasman / Marlborough
--   • Plant & Food Research NZ   – 2 sites (Nelson Research Centre + Motueka/Tasman)
--
-- This migration:
--   1. Expands the client_sites.site_type check to include 'research'
--   2. Creates both organisations as clients of First Security (Nelson branch)
--   3. Seeds all 7 sites (5 Cawthron + 2 Plant & Food)
--   4. Adds client_viewer RLS policy on client_sites
-- ============================================================================

-- ── 1. Extend client_sites.site_type to include 'research' ───────────────────

ALTER TABLE public.client_sites
  DROP CONSTRAINT IF EXISTS client_sites_site_type_check;

ALTER TABLE public.client_sites
  ADD CONSTRAINT client_sites_site_type_check
    CHECK (site_type IN (
      'general', 'freedom_camping', 'guarding', 'parking',
      'noise_control', 'event', 'infrastructure', 'research'
    ));

-- ── 2. Create Cawthron Institute and Plant & Food Research NZ ─────────────────

DO $$
DECLARE
  v_first_security_id  UUID;
  v_nelson_branch_id   UUID;
  v_tasman_branch_id   UUID;

  v_cawthron_id        UUID;
  v_plant_food_id      UUID;
BEGIN
  -- Resolve parent organisation IDs
  SELECT id INTO v_first_security_id
  FROM public.organizations
  WHERE lower(name) LIKE '%first security%'
    AND organization_type = 'service_provider'
  ORDER BY organization_level, created_at
  LIMIT 1;

  SELECT id INTO v_nelson_branch_id
  FROM public.organizations
  WHERE name = 'First Security - Nelson'
  LIMIT 1;

  -- Fallback: if Nelson branch not yet present, use First Security root
  IF v_nelson_branch_id IS NULL THEN
    v_nelson_branch_id := v_first_security_id;
  END IF;

  -- ── Cawthron Institute ────────────────────────────────────────────────────
  -- Primary marine and freshwater science research facility.  The institute is
  -- based in Nelson with lab/field stations across the top of the South Island.

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
    'Cawthron Institute',
    'client',
    4,
    v_nelson_branch_id,
    true,
    'officer_first',
    'two_photo_verification'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE name = 'Cawthron Institute'
  );

  SELECT id INTO v_cawthron_id
  FROM public.organizations
  WHERE name = 'Cawthron Institute'
  LIMIT 1;

  -- ── Plant & Food Research NZ ──────────────────────────────────────────────
  -- Crown research institute with facilities in Nelson (HQ) and Motueka (Tasman).

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
    'Plant & Food Research NZ',
    'client',
    4,
    v_nelson_branch_id,
    true,
    'officer_first',
    'two_photo_verification'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE name = 'Plant & Food Research NZ'
  );

  SELECT id INTO v_plant_food_id
  FROM public.organizations
  WHERE name = 'Plant & Food Research NZ'
  LIMIT 1;

  RAISE NOTICE '✅ Cawthron Institute id=%', v_cawthron_id;
  RAISE NOTICE '✅ Plant & Food Research NZ id=%', v_plant_food_id;

  -- ── 3a. Cawthron Institute – 5 sites ──────────────────────────────────────
  --
  -- Site layout (real Nelson area locations):
  --   1. Main Campus          – 98 Halifax Street, Nelson (labs, admin, main gate)
  --   2. Aquaculture Research Centre – 124 Waimea Rd, Nelson (tank hall, sea-water systems)
  --   3. Marine Chemistry Lab – Princes Drive, Nelson (analytical & environmental lab)
  --   4. Freshwater Ecology Station – Maitai River, Nelson (field monitoring station)
  --   5. Marlborough Research Station – Blenheim (aquaculture, shellfish)

  IF v_cawthron_id IS NOT NULL THEN
    INSERT INTO public.client_sites (
      organization_id, name, site_code, site_type,
      address, city,
      gps_lat, gps_lng,
      notes,
      is_active
    )
    SELECT
      v_cawthron_id,
      site_name,
      site_code,
      'research',
      address,
      city,
      gps_lat,
      gps_lng,
      notes,
      true
    FROM (
      VALUES
        (
          'Main Campus',
          'CAW-NLS-01',
          '98 Halifax Street',
          'Nelson',
          -41.2706,  173.2840,
          'Primary site. Main administration, analytical laboratories and aquaculture tank hall. Security patrol and after-hours static guard.'
        ),
        (
          'Aquaculture Research Centre',
          'CAW-NLS-02',
          '124 Waimea Road',
          'Nelson',
          -41.2780,  173.2750,
          'Sea-water recirculation systems and experimental tanks. Keypad access. Patrol checks required morning and evening.'
        ),
        (
          'Marine Chemistry Laboratory',
          'CAW-NLS-03',
          'Princes Drive',
          'Nelson',
          -41.2650,  173.2900,
          'Analytical and environmental chemistry. Hazardous chemicals on site – entry procedure to be followed.'
        ),
        (
          'Freshwater Ecology Field Station',
          'CAW-NLS-04',
          'Maitai River Reserve',
          'Nelson',
          -41.2850,  173.3100,
          'Remote field monitoring station on Maitai River. Welfare check required for lone workers. Lock-up at 18:00.'
        ),
        (
          'Marlborough Research Station',
          'CAW-BLH-05',
          'State Highway 1, Blenheim',
          'Blenheim',
          -41.5200,  173.9600,
          'Shellfish and aquaculture research. Managed by Blenheim branch. Monthly patrol and quarterly security review.'
        )
    ) AS sites(site_name, site_code, address, city, gps_lat, gps_lng, notes)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.client_sites cs
      WHERE cs.organization_id = v_cawthron_id
        AND cs.name = site_name
    );

    RAISE NOTICE '✅ Cawthron Institute sites seeded';
  END IF;

  -- ── 3b. Plant & Food Research NZ – 2 sites ────────────────────────────────
  --
  --   1. Nelson Research Centre  – 55 Old Mill Road, Stoke, Nelson (main NZ HQ)
  --   2. Motueka Research Centre – Coastal Highway, Motueka (Tasman District)

  IF v_plant_food_id IS NOT NULL THEN
    INSERT INTO public.client_sites (
      organization_id, name, site_code, site_type,
      address, city,
      gps_lat, gps_lng,
      notes,
      is_active
    )
    SELECT
      v_plant_food_id,
      site_name,
      site_code,
      'research',
      address,
      city,
      gps_lat,
      gps_lng,
      notes,
      true
    FROM (
      VALUES
        (
          'Nelson Research Centre',
          'PFR-NLS-01',
          '55 Old Mill Road, Stoke',
          'Nelson',
          -41.3100,  173.2300,
          'Main Plant & Food Research NZ campus for the top of the South Island. '
          'Static guard and nightly patrol. Key safe on site. 24-hr emergency contact required.'
        ),
        (
          'Motueka Research Centre',
          'PFR-MOT-02',
          'Coastal Highway',
          'Motueka',
          -41.1220,  172.9870,
          'Tasman District research station focused on horticulture and berry crops. '
          'Patrol check – Motueka is within Nelson branch jurisdiction (Tasman coverage).'
        )
    ) AS sites(site_name, site_code, address, city, gps_lat, gps_lng, notes)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.client_sites cs
      WHERE cs.organization_id = v_plant_food_id
        AND cs.name = site_name
    );

    RAISE NOTICE '✅ Plant & Food Research NZ sites seeded';
  END IF;

END $$;

-- ── 4. client_viewer RLS on client_sites ─────────────────────────────────────
--
-- Allow client_viewer users to SELECT sites that belong to their organisation.

DO $$ BEGIN
  DROP POLICY IF EXISTS "client_viewer_view_client_sites" ON public.client_sites;
  CREATE POLICY "client_viewer_view_client_sites"
    ON public.client_sites
    FOR SELECT
    TO authenticated
    USING (
      get_user_role(auth.uid()) = 'client_viewer'
      AND organization_id = (
        SELECT organization_id
        FROM   public.user_profiles
        WHERE  id = auth.uid()
        LIMIT  1
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
