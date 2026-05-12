-- Resolve Supabase Advisor warning: RLS enabled but no policy
-- Adds org-scoped SELECT policies for patrol route link tables.

DROP POLICY IF EXISTS "patrol_route_zones_select_org_jwt" ON public.patrol_route_zones;
CREATE POLICY "patrol_route_zones_select_org_jwt"
ON public.patrol_route_zones
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.patrol_routes pr
    WHERE pr.id = patrol_route_zones.patrol_route_id
      AND pr.organization_id::text = COALESCE(NULLIF(auth.jwt() ->> 'organization_id', ''), '__no_org__')
  )
);

DROP POLICY IF EXISTS "patrol_route_sites_select_org_jwt" ON public.patrol_route_sites;
CREATE POLICY "patrol_route_sites_select_org_jwt"
ON public.patrol_route_sites
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.patrol_routes pr
    WHERE pr.id = patrol_route_sites.patrol_route_id
      AND pr.organization_id::text = COALESCE(NULLIF(auth.jwt() ->> 'organization_id', ''), '__no_org__')
  )
);
