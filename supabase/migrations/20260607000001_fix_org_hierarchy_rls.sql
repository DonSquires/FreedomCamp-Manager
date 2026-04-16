-- Migration: Fix RLS policies to use recursive org-hierarchy access
--
-- Problem: client_sites, roster_shifts, and dispatch_jobs used exact
-- `up.organization_id = table.organization_id` matching which prevented
-- branch-level users from seeing client orgs that are children of their
-- branch (e.g. First Security Nelson admins couldn't see Nelson City
-- Council sites even though NCC is a direct child of FSN in the org tree).
--
-- Fix: Replace the single-org match with `organization_id = ANY(get_user_organization_ids())`
-- which already performs a recursive `get_descendant_organizations()` walk,
-- respects authorized_work_locations / extra_organization_ids, and gives
-- grand_master unrestricted access — matching the pattern used on
-- breach_alerts, observations, zones, etc.

-- ── client_sites ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "org members manage client_sites" ON public.client_sites;

-- All roles: full CRUD on sites whose org is in the user's accessible org tree
CREATE POLICY "org members manage client_sites"
  ON public.client_sites FOR ALL
  USING (
    organization_id = ANY(get_user_organization_ids())
  );

-- ── roster_shifts ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admins manage roster_shifts" ON public.roster_shifts;

-- Admins/masters can manage roster shifts across their full org hierarchy
CREATE POLICY "admins manage roster_shifts"
  ON public.roster_shifts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
    AND organization_id = ANY(get_user_organization_ids())
  );

-- ── dispatch_jobs ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admins manage dispatch_jobs" ON public.dispatch_jobs;
DROP POLICY IF EXISTS "officers read assigned dispatch_jobs" ON public.dispatch_jobs;

-- Admins/masters can manage all jobs in their accessible org tree
CREATE POLICY "admins manage dispatch_jobs"
  ON public.dispatch_jobs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
    AND organization_id = ANY(get_user_organization_ids())
  );

-- Officers can read any job in an org they have access to, plus their own assigned jobs
CREATE POLICY "officers read assigned dispatch_jobs"
  ON public.dispatch_jobs FOR SELECT
  USING (
    assigned_to = auth.uid()
    OR organization_id = ANY(get_user_organization_ids())
  );
