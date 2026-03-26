-- =============================================================================
-- Restore patrol counter RPCs
--
-- These atomic increment functions were defined in 20260313000010_patrol_counter_rpcs.sql
-- but are absent from the live database (migration drift confirmed via Schema Extract #2
-- — they do not appear in the generated TypeScript types).
--
-- They are called fire-and-forget by BulkScanSession.tsx to keep the patrols
-- counters (vehicles_checked, breaches_found) up-to-date in real time.
--
-- Using CREATE OR REPLACE so this migration is safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.increment_patrol_vehicles_checked(p_patrol_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.patrols
  SET    vehicles_checked = COALESCE(vehicles_checked, 0) + 1,
         updated_at       = NOW()
  WHERE  id = p_patrol_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_patrol_breaches_found(p_patrol_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.patrols
  SET    breaches_found = COALESCE(breaches_found, 0) + 1,
         updated_at     = NOW()
  WHERE  id = p_patrol_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_patrol_vehicles_checked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_patrol_breaches_found(UUID) TO authenticated;

COMMENT ON FUNCTION public.increment_patrol_vehicles_checked IS
  'Atomic increment for patrols.vehicles_checked. Called fire-and-forget from BulkScanSession.';
COMMENT ON FUNCTION public.increment_patrol_breaches_found IS
  'Atomic increment for patrols.breaches_found. Called fire-and-forget from BulkScanSession.';
