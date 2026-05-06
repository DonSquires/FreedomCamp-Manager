-- Migration: anon read policy on zones for public-facing pages (B-10)
--
-- The public zone map (/public/zone-map) fetches freedom-camping zones
-- without authentication.  Without an anon SELECT policy the RLS on
-- public.zones blocks all unauthenticated reads, returning zero rows.
--
-- This policy grants anon the ability to read active zones only.
-- Write operations are still fully restricted (authenticated roles only).

-- Drop the policy first so this migration is re-runnable in case of retry.
DROP POLICY IF EXISTS "zones_public_read" ON public.zones;

CREATE POLICY "zones_public_read"
  ON public.zones
  FOR SELECT
  TO anon
  USING (is_active = true);

-- Also allow the authenticated role so the existing users_view_zones
-- policy is supplemented rather than replaced.
-- (users_view_zones already covers authenticated users; this only adds anon.)

COMMENT ON POLICY "zones_public_read" ON public.zones IS
  'Allows unauthenticated visitors to read active zones for the public zone map (B-10).';
