-- Allow patrol key chains to be assigned to patrol routes.

ALTER TABLE public.key_sets
  ADD COLUMN IF NOT EXISTS patrol_route_id UUID REFERENCES public.patrol_routes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_key_sets_patrol_route
  ON public.key_sets(patrol_route_id) WHERE patrol_route_id IS NOT NULL;

COMMENT ON COLUMN public.key_sets.patrol_route_id IS
  'Patrol route assignment for the key chain. Patrol routes own chain custody and audits.';