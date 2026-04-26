-- ============================================================================
-- Phase 1 Backend Alignment for Client Roles
-- Date: 2026-06-14
--
-- Purpose:
--   1) Extend user_profiles role constraint to support client_officer/client_admin.
--   2) Expand existing client_viewer read policies to include new client roles.
--   3) Seed site field-group defaults for new client roles.
-- ============================================================================

-- ── 1. user_profiles role constraint ─────────────────────────────────────────

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
      'client_viewer',
      'client_officer',
      'client_admin'
    ));

COMMENT ON CONSTRAINT user_profiles_role_check ON public.user_profiles IS
  'Valid roles: officer, admin, admin_officer, master, grand_master, nzscv_monitor, client_viewer, client_officer, client_admin.';

-- ── 2. client-portal read policies (org-scoped, read-only) ─────────────────
-- Preserve existing policy names for compatibility while broadening role checks.

-- user_profiles
DROP POLICY IF EXISTS "client_viewer_view_user_profiles" ON public.user_profiles;
CREATE POLICY "client_viewer_view_user_profiles" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
    AND organization_id = get_user_organization_id(auth.uid())
  );

-- zones
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'zones'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_zones" ON public.zones;
    CREATE POLICY "client_viewer_view_zones" ON public.zones
      FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
END $$;

-- observations
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'observations'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_observations" ON public.observations;
    CREATE POLICY "client_viewer_view_observations" ON public.observations
      FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
END $$;

-- patrols
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'patrols'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_patrols" ON public.patrols;
    CREATE POLICY "client_viewer_view_patrols" ON public.patrols
      FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
END $$;

-- enforcement_actions
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'enforcement_actions'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_enforcement_actions" ON public.enforcement_actions;
    CREATE POLICY "client_viewer_view_enforcement_actions" ON public.enforcement_actions
      FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
END $$;

-- breach_alerts
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'breach_alerts'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_breach_alerts" ON public.breach_alerts;
    CREATE POLICY "client_viewer_view_breach_alerts" ON public.breach_alerts
      FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
END $$;

-- site_risk_assessments
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_risk_assessments'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_site_risk_assessments" ON public.site_risk_assessments;
    CREATE POLICY "client_viewer_view_site_risk_assessments" ON public.site_risk_assessments
      FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
END $$;

-- infringement_notices
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'infringement_notices'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_infringement_notices" ON public.infringement_notices;
    CREATE POLICY "client_viewer_view_infringement_notices" ON public.infringement_notices
      FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
END $$;

-- organizations (own org record)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'organizations'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_own_organization" ON public.organizations;
    CREATE POLICY "client_viewer_view_own_organization" ON public.organizations
      FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND id = get_user_organization_id(auth.uid())
      );
  END IF;
END $$;

-- client_sites
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_sites'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_view_client_sites" ON public.client_sites;
    CREATE POLICY "client_viewer_view_client_sites" ON public.client_sites
      FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
END $$;

-- site_incidents
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_incidents'
  ) THEN
    DROP POLICY IF EXISTS "client_viewer_read_site_incidents" ON public.site_incidents;
    CREATE POLICY "client_viewer_read_site_incidents" ON public.site_incidents
      FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
END $$;

-- ── 3. Default site field permissions for new client roles ───────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_role_permissions'
  ) THEN
    INSERT INTO public.site_role_permissions (role, field_group, can_view, can_edit)
    VALUES
      -- client_officer: operational visibility; notes editable
      ('client_officer', 'identity',    true,  false),
      ('client_officer', 'location',    true,  false),
      ('client_officer', 'operational', true,  false),
      ('client_officer', 'contacts',    true,  false),
      ('client_officer', 'sla',         true,  false),
      ('client_officer', 'notes',       true,  true),
      ('client_officer', 'financial',   false, false),
      ('client_officer', 'accounting',  false, false),

      -- client_admin: broader read visibility, no financial/accounting
      ('client_admin', 'identity',    true,  false),
      ('client_admin', 'location',    true,  false),
      ('client_admin', 'operational', true,  false),
      ('client_admin', 'contacts',    true,  false),
      ('client_admin', 'sla',         true,  false),
      ('client_admin', 'notes',       true,  false),
      ('client_admin', 'financial',   false, false),
      ('client_admin', 'accounting',  false, false)
    ON CONFLICT (role, field_group) DO UPDATE
      SET can_view = EXCLUDED.can_view,
          can_edit = EXCLUDED.can_edit;
  END IF;
END $$;
