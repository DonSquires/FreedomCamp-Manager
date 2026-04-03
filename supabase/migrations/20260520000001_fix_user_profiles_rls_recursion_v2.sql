-- =============================================================================
-- Fix RLS infinite recursion in user_profiles — v2
-- Date: 2026-05-20
--
-- Root cause identified:
--   Migration 20260515000001_fix_rls_org_scoped_policies.sql introduced new
--   policies that directly query user_profiles inside an ON user_profiles
--   policy USING clause, recreating the infinite recursion:
--
--     "users_view_org_profiles" ON user_profiles FOR SELECT
--       USING (
--         public.user_belongs_to_org(organization_id)
--         OR EXISTS (
--           SELECT 1 FROM user_profiles          -- ← RECURSIVE!
--           WHERE id = auth.uid() AND role IN ('grand_master', 'master')
--         )
--       );
--
--   The helper function user_belongs_to_org() also queries user_profiles
--   without SECURITY DEFINER, so its internal queries are still subject to RLS
--   on user_profiles — creating another recursion path.
--
-- Fix strategy:
--   1. Drop all user_profiles SELECT policies that contain direct subqueries
--      on user_profiles.
--   2. Replace them with safe versions using get_user_role(auth.uid()) and
--      get_user_organization_id(auth.uid()) (SECURITY DEFINER — bypasses RLS).
--   3. Fix user_belongs_to_org() to also use SECURITY DEFINER.
--   4. Fix other policies in 20260515 that reference user_profiles recursively.
-- =============================================================================

-- ─── Step 1: Ensure helper functions are SECURITY DEFINER with fixed path ────

CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM public.user_profiles
  WHERE id = p_user_id;
  RETURN COALESCE(v_role, 'officer');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_organization_id(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM public.user_profiles
  WHERE id = p_user_id;
  RETURN v_org_id;
END;
$$;

-- Fix user_belongs_to_org to be SECURITY DEFINER so its internal user_profiles
-- query bypasses RLS and does not recurse.
CREATE OR REPLACE FUNCTION public.user_belongs_to_org(target_org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND (
      organization_id = target_org_id
      OR target_org_id = ANY(extra_organization_ids)
    )
  ) THEN
    RETURN TRUE;
  END IF;

  IF get_user_role(auth.uid()) IN ('grand_master', 'master') THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- ─── Step 2: Replace recursive user_profiles SELECT policies ─────────────────

-- Drop all policies that contain recursive subqueries on user_profiles
DROP POLICY IF EXISTS "users_view_org_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "users_view_own_profile" ON public.user_profiles;
DROP POLICY IF EXISTS "authenticated_view_all_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "users_view_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "users_select_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "client_viewer_view_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "grand_master_all_user_profiles" ON public.user_profiles;

-- Safe: own profile (no recursion — only auth.uid() comparison)
CREATE POLICY "users_view_own_profile" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Safe: org-scoped profiles using SECURITY DEFINER helpers
CREATE POLICY "users_view_org_profiles" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    get_user_organization_id(auth.uid()) = organization_id
    OR get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Safe: client_viewer policy using SECURITY DEFINER helpers
CREATE POLICY "client_viewer_view_user_profiles" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    get_user_role(auth.uid()) = 'client_viewer'
    AND organization_id = get_user_organization_id(auth.uid())
  );

-- ─── Step 3: Fix UPDATE policy on user_profiles ───────────────────────────────

DROP POLICY IF EXISTS "users_update_own_profile" ON public.user_profiles;
CREATE POLICY "users_update_own_profile" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ─── Step 4: Fix recursive patterns in breach_alerts from 20260515 ───────────

DROP POLICY IF EXISTS "authenticated_view_breach_alerts" ON public.breach_alerts;
DO $breach_select$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='breach_alerts') THEN
    EXECUTE '
      CREATE POLICY "authenticated_view_breach_alerts" ON public.breach_alerts FOR SELECT
        TO authenticated
        USING (
          organization_id IS NULL
          OR public.user_belongs_to_org(organization_id)
          OR get_user_role(auth.uid()) IN (''grand_master'', ''master'')
        )
    ';
  END IF;
END $breach_select$;

DROP POLICY IF EXISTS "authenticated_update_breach_alerts" ON public.breach_alerts;
DO $breach_update$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='breach_alerts') THEN
    EXECUTE '
      CREATE POLICY "authenticated_update_breach_alerts" ON public.breach_alerts FOR UPDATE
        TO authenticated
        USING (
          organization_id IS NULL
          OR public.user_belongs_to_org(organization_id)
          OR get_user_role(auth.uid()) IN (''grand_master'', ''master'')
        )
        WITH CHECK (
          organization_id IS NULL
          OR public.user_belongs_to_org(organization_id)
          OR get_user_role(auth.uid()) IN (''grand_master'', ''master'')
        )
    ';
  END IF;
END $breach_update$;

-- ─── Step 5: Fix recursive patterns in incidents from 20260515 ───────────────

DO $incidents_policy$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='incidents') THEN
    EXECUTE 'DROP POLICY IF EXISTS "users_view_org_incidents" ON public.incidents';
    EXECUTE '
      CREATE POLICY "users_view_org_incidents" ON public.incidents FOR SELECT
        TO authenticated
        USING (
          organization_id IS NULL
          OR public.user_belongs_to_org(organization_id)
          OR get_user_role(auth.uid()) IN (''grand_master'', ''master'')
        )
    ';
  END IF;
END $incidents_policy$;

-- ─── Step 6: Fix recursive patterns in patrols from 20260515 ─────────────────

DO $patrols_policy$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='patrols') THEN
    EXECUTE 'DROP POLICY IF EXISTS "users_view_org_patrols" ON public.patrols';
    EXECUTE '
      CREATE POLICY "users_view_org_patrols" ON public.patrols FOR SELECT
        TO authenticated
        USING (
          organization_id IS NULL
          OR public.user_belongs_to_org(organization_id)
          OR get_user_role(auth.uid()) IN (''grand_master'', ''master'')
        )
    ';
  END IF;
END $patrols_policy$;
