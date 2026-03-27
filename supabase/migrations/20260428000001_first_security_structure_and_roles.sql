-- ============================================================================
-- First Security Organisational Structure, Job Titles & Client Viewer Role
-- Date: 2026-04-28
--
-- Changes:
--   1. Add job_title and requires_driver_license columns to user_profiles
--   2. Add client_viewer role (read-only portal for client organisation contacts)
--   3. Create First Security regional branch organisations
--   4. Create additional non-council client organisations
--      (Nelson Electricity, IRD Nelson, Marlborough District Council)
--   5. Update squires.don@live.com to grand_master role
--   6. RLS policies for client_viewer role
-- ============================================================================

-- ── 1. Extend user_profiles with job title fields ────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS job_title              TEXT,
  ADD COLUMN IF NOT EXISTS requires_driver_license BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.job_title IS
  'Position/job title within the organisation. '
  'E.g., Patrol Officer, Branch Manager, Static Guard - Permanent.';

COMMENT ON COLUMN public.user_profiles.requires_driver_license IS
  'True if the position requires a valid full NZ driver licence '
  '(e.g., Patrol Officer, Field Services Officer).';

-- ── 2. Add client_viewer role ─────────────────────────────────────────────────

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
    CHECK (role IN (
      'officer',
      'admin',
      'admin_officer',
      'master',
      'grand_master',
      'nzscv_monitor',
      'client_viewer'
    ));

COMMENT ON CONSTRAINT user_profiles_role_check ON public.user_profiles IS
  'Valid roles: officer, admin, admin_officer, master, grand_master, nzscv_monitor, client_viewer. '
  'grand_master = platform owner (all orgs, billing, onboarding). '
  'client_viewer = read-only portal access for client organisation contacts. '
  'nzscv_monitor = legacy read-only SCV monitoring role (superseded by grand_master).';

-- ── 3. Create First Security regional branches ───────────────────────────────
--
-- Branch jurisdictions:
--   Nelson      → Nelson District, Tasman District
--   Blenheim    → Marlborough District (Blenheim is seat of Marlborough DC)
--   Greymouth   → Westland District, Grey District, Buller District
--   Christchurch→ Christchurch City, Waimakariri District, Hurunui District
--                 (mid and north Canterbury)
--   Ashburton   → Ashburton District, Selwyn District (Methven)
--   Timaru      → Timaru District, Mackenzie District (south Canterbury)
--   Oamaru      → Waitaki District (north Otago)
--   Dunedin     → Dunedin City, Clutha District, Central Otago (Otago)
--   Invercargill→ Invercargill City, Southland District, Gore District
--   Queenstown  → Queenstown-Lakes District, Central Otago (lakes + Westland Otago)

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
    RAISE NOTICE '⚠️  First Security organisation not found – skipping branch creation.';
    RETURN;
  END IF;

  -- Insert branches idempotently (by name check)
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
    branch_name,
    'service_provider',
    3,
    v_first_security_id,
    true,
    'officer_first',
    'two_photo_verification'
  FROM (
    VALUES
      ('First Security - Nelson'),
      ('First Security - Blenheim'),
      ('First Security - Greymouth'),
      ('First Security - Christchurch'),
      ('First Security - Ashburton'),
      ('First Security - Timaru'),
      ('First Security - Oamaru'),
      ('First Security - Dunedin'),
      ('First Security - Invercargill'),
      ('First Security - Queenstown')
  ) AS branches(branch_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE name = branch_name
  );

  RAISE NOTICE '✅ First Security regional branches created/confirmed (parent = %)', v_first_security_id;
END $$;

-- ── 4. Create additional non-council client organisations ─────────────────────
--
-- These are businesses/government agencies that First Security provides
-- services to (patrol checks, static guarding, parking enforcement, etc.)

DO $$
DECLARE
  v_first_security_id  UUID;
  v_nelson_branch_id   UUID;
  v_blenheim_branch_id UUID;
BEGIN
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

  SELECT id INTO v_blenheim_branch_id
  FROM public.organizations
  WHERE name = 'First Security - Blenheim'
  LIMIT 1;

  -- Non-council clients
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
    client_name,
    'client',
    4,
    parent_id,
    true,
    'officer_first',
    'two_photo_verification'
  FROM (
    VALUES
      -- Nelson district clients
      ('Nelson Electricity',     COALESCE(v_nelson_branch_id, v_first_security_id)),
      ('IRD Nelson',             COALESCE(v_nelson_branch_id, v_first_security_id)),
      -- Marlborough / Blenheim district clients
      ('Marlborough District Council',
                                 COALESCE(v_blenheim_branch_id, v_first_security_id))
  ) AS clients(client_name, parent_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE name = client_name
  );

  RAISE NOTICE '✅ Additional client organisations created/confirmed';
END $$;

-- ── 5. Promote squires.don@live.com to grand_master ──────────────────────────

UPDATE public.user_profiles
SET    role       = 'grand_master',
       updated_at = now()
WHERE  email = 'squires.don@live.com'
  AND  role  != 'grand_master';

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.user_profiles
  WHERE email = 'squires.don@live.com'
    AND role  = 'grand_master';

  IF v_count > 0 THEN
    RAISE NOTICE '✅ squires.don@live.com is now grand_master';
  ELSE
    RAISE NOTICE '⚠️  squires.don@live.com not found in user_profiles '
                 '(user may not have registered yet – will be set when they sign up)';
  END IF;
END $$;

-- ── 6. RLS policies for client_viewer role ────────────────────────────────────
--
-- client_viewer users can only SELECT data scoped to their own organisation.
-- They cannot INSERT, UPDATE, or DELETE anything.

-- Helper: reusable inline expression for "caller's org_id"
-- (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())

-- user_profiles: client_viewer can read profiles in their own org
DO $$ BEGIN
  DROP POLICY IF EXISTS "client_viewer_view_user_profiles" ON public.user_profiles;
  CREATE POLICY "client_viewer_view_user_profiles"
    ON public.user_profiles
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

-- zones: client_viewer can view zones belonging to their organisation
DO $$ BEGIN
  DROP POLICY IF EXISTS "client_viewer_view_zones" ON public.zones;
  CREATE POLICY "client_viewer_view_zones"
    ON public.zones
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

-- observations: client_viewer can view scans in their organisation
DO $$ BEGIN
  DROP POLICY IF EXISTS "client_viewer_view_observations" ON public.observations;
  CREATE POLICY "client_viewer_view_observations"
    ON public.observations
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

-- patrols: client_viewer can view patrols in their organisation
DO $$ BEGIN
  DROP POLICY IF EXISTS "client_viewer_view_patrols" ON public.patrols;
  CREATE POLICY "client_viewer_view_patrols"
    ON public.patrols
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

-- enforcement_actions: client_viewer can view enforcement in their org
DO $$ BEGIN
  DROP POLICY IF EXISTS "client_viewer_view_enforcement_actions" ON public.enforcement_actions;
  CREATE POLICY "client_viewer_view_enforcement_actions"
    ON public.enforcement_actions
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

-- breach_alerts: client_viewer can view breach alerts in their org
DO $$ BEGIN
  DROP POLICY IF EXISTS "client_viewer_view_breach_alerts" ON public.breach_alerts;
  CREATE POLICY "client_viewer_view_breach_alerts"
    ON public.breach_alerts
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

-- site_risk_assessments: client_viewer can view risk assessments
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_risk_assessments'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_site_risk_assessments"
      ON public.site_risk_assessments;
    CREATE POLICY "client_viewer_view_site_risk_assessments"
      ON public.site_risk_assessments
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
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- infringement_notices: client_viewer can view infringement notices in their org
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'infringement_notices'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_infringement_notices"
      ON public.infringement_notices;
    CREATE POLICY "client_viewer_view_infringement_notices"
      ON public.infringement_notices
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
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- organisations: client_viewer can see their own organisation record
DO $$ BEGIN
  DROP POLICY IF EXISTS "client_viewer_view_own_organization" ON public.organizations;
  CREATE POLICY "client_viewer_view_own_organization"
    ON public.organizations
    FOR SELECT
    TO authenticated
    USING (
      get_user_role(auth.uid()) = 'client_viewer'
      AND id = (
        SELECT organization_id
        FROM   public.user_profiles
        WHERE  id = auth.uid()
        LIMIT  1
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
