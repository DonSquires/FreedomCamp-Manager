-- Migration: add dispatch target metadata to noise_jobs
-- Purpose: support complaint dispatch to patrol routes, users, or locations.

ALTER TABLE public.noise_jobs
  ADD COLUMN IF NOT EXISTS dispatch_target_type TEXT
    CHECK (dispatch_target_type IN ('patrol_route', 'user', 'location')),
  ADD COLUMN IF NOT EXISTS dispatch_target_id UUID,
  ADD COLUMN IF NOT EXISTS dispatch_target_label TEXT;

COMMENT ON COLUMN public.noise_jobs.dispatch_target_type IS
  'Dispatch destination kind: patrol_route for service providers, user/location for client teams.';

COMMENT ON COLUMN public.noise_jobs.dispatch_target_id IS
  'UUID of the selected destination record. Polymorphic across patrol_routes, user_profiles, and locations_of_interest.';

COMMENT ON COLUMN public.noise_jobs.dispatch_target_label IS
  'Snapshot label of the chosen dispatch destination at dispatch time.';

CREATE INDEX IF NOT EXISTS idx_noise_jobs_dispatch_target
  ON public.noise_jobs (organization_id, dispatch_target_type, dispatch_target_id);
