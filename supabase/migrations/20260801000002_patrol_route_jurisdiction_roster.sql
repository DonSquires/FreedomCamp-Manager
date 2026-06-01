-- ============================================================================
-- Migration: Patrol Route Jurisdiction & Roster Alignment
-- Adds cross-jurisdiction job-sharing support to patrol_routes and surfaces
-- the patrol route assignment on roster shifts so officers can see exactly
-- which route/jurisdiction they are rostered to.
-- ============================================================================

-- ── 1. Extend patrol_routes with jurisdiction & service-provider branch ─────

ALTER TABLE public.patrol_routes
  ADD COLUMN IF NOT EXISTS jurisdiction_organization_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS service_provider_branch_id    UUID   REFERENCES public.client_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS jurisdiction_label            TEXT,
  ADD COLUMN IF NOT EXISTS allow_cross_jurisdiction      BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.patrol_routes.jurisdiction_organization_ids IS
  'Array of organization IDs whose job jurisdiction this route can cover (cross-jurisdiction job sharing).
   Empty array = only the owning org''s jobs.';

COMMENT ON COLUMN public.patrol_routes.service_provider_branch_id IS
  'Optional client_site that acts as the "branch" for this route (e.g. City North depot).
   Allows a provider with multiple branches to scope routes per branch.';

COMMENT ON COLUMN public.patrol_routes.jurisdiction_label IS
  'Human-readable jurisdiction description (e.g. "Auckland City East", "Tauranga CBD").
   Shown to officers and dispatch operators.';

COMMENT ON COLUMN public.patrol_routes.allow_cross_jurisdiction IS
  'When true, this route can accept dispatch jobs from any organization listed in
   jurisdiction_organization_ids. Enables mutual-aid / job-sharing workflows.';

CREATE INDEX IF NOT EXISTS idx_patrol_routes_branch
  ON public.patrol_routes(service_provider_branch_id)
  WHERE service_provider_branch_id IS NOT NULL;

-- ── 2. Roster assignment — add jurisdiction_shared flag ──────────────────────
-- Records that a specific shift was fulfilled as a cross-jurisdiction share.

ALTER TABLE public.roster_assignments
  ADD COLUMN IF NOT EXISTS shared_from_organization_id UUID
    REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shared_job_id               UUID,
  ADD COLUMN IF NOT EXISTS is_cross_jurisdiction        BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.roster_assignments.shared_from_organization_id IS
  'When this assignment is a cross-jurisdiction job share, the originating org.';

COMMENT ON COLUMN public.roster_assignments.is_cross_jurisdiction IS
  'TRUE when this assignment was filled from another jurisdiction via job sharing.';

-- ── 3. Patrol route jurisdiction view ────────────────────────────────────────
-- Convenience view: expands jurisdiction_organization_ids to named rows so
-- the UI can display "supports [Org A, Org B] jurisdictions" without joins.

CREATE OR REPLACE VIEW public.patrol_route_jurisdiction_view AS
SELECT
  pr.id                         AS patrol_route_id,
  pr.route_name,
  pr.route_code,
  pr.organization_id            AS owner_organization_id,
  pr.jurisdiction_label,
  pr.allow_cross_jurisdiction,
  pr.service_provider_branch_id,
  cs.name                       AS branch_name,
  cs.address                    AS branch_address,
  pr.jurisdiction_organization_ids,
  -- Comma-separated org names for quick display
  (
    SELECT string_agg(o.name, ', ' ORDER BY o.name)
    FROM public.organizations o
    WHERE o.id = ANY(pr.jurisdiction_organization_ids)
  )                             AS jurisdiction_org_names
FROM public.patrol_routes pr
LEFT JOIN public.client_sites cs ON cs.id = pr.service_provider_branch_id;

-- ── 4. RLS policy — officers can read routes they are rostered to ─────────────
-- Officers (non-admin) may only see patrol routes they have a roster_assignment for,
-- OR routes owned by their own organization.

DROP POLICY IF EXISTS patrol_routes_officer_read ON public.patrol_routes;

CREATE POLICY patrol_routes_officer_read ON public.patrol_routes
  FOR SELECT
  USING (
    -- Own-org officers and admins always have access
    organization_id = get_user_organization_id(auth.uid())
    OR
    -- Cross-jurisdiction: orgs listed in jurisdiction_organization_ids can read the route
    get_user_organization_id(auth.uid()) = ANY(jurisdiction_organization_ids)
    OR
    -- Officer is rostered to this route
    EXISTS (
      SELECT 1 FROM public.roster_assignments ra
      WHERE ra.patrol_route_id = patrol_routes.id
        AND ra.officer_id = auth.uid()
        AND ra.assignment_status NOT IN ('declined', 'cancelled')
    )
  );

-- ── 5. Function: get_patrol_routes_for_dispatch ───────────────────────────────
-- Returns patrol routes and their jurisdiction details relevant to a dispatch org.
-- Used by DispatchWizard officer picker to show which routes an officer covers.

CREATE OR REPLACE FUNCTION public.get_patrol_routes_for_dispatch(
  p_requesting_org_id UUID
)
RETURNS TABLE (
  id                    UUID,
  route_name            TEXT,
  route_code            TEXT,
  owner_organization_id UUID,
  owner_org_name        TEXT,
  jurisdiction_label    TEXT,
  allow_cross_jurisdiction BOOLEAN,
  branch_name           TEXT,
  is_cross_jurisdiction_for_requester BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pr.id,
    pr.route_name,
    pr.route_code,
    pr.organization_id                                        AS owner_organization_id,
    o.name                                                    AS owner_org_name,
    pr.jurisdiction_label,
    pr.allow_cross_jurisdiction,
    cs.name                                                   AS branch_name,
    (pr.organization_id <> p_requesting_org_id)               AS is_cross_jurisdiction_for_requester
  FROM public.patrol_routes pr
  LEFT JOIN public.organizations o  ON o.id  = pr.organization_id
  LEFT JOIN public.client_sites  cs ON cs.id = pr.service_provider_branch_id
  WHERE
    pr.is_active = TRUE
    AND (
      pr.organization_id = p_requesting_org_id
      OR (
        pr.allow_cross_jurisdiction = TRUE
        AND p_requesting_org_id = ANY(pr.jurisdiction_organization_ids)
      )
    )
  ORDER BY pr.route_name;
$$;

COMMENT ON FUNCTION public.get_patrol_routes_for_dispatch IS
  'Returns patrol routes available to a dispatching organization, including cross-jurisdiction
   shared routes. Used by DispatchWizard to show route+jurisdiction context for officer selection.';
