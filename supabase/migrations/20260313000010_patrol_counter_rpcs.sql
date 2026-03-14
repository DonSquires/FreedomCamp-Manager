-- ============================================================================
-- Patrol counter RPCs
-- ============================================================================
-- Atomic increment functions used by BulkScanSession after each scan.
-- Safe to call concurrently from multiple officers on the same patrol.
-- ============================================================================

-- Increment vehicles_checked on a patrol row
CREATE OR REPLACE FUNCTION increment_patrol_vehicles_checked(p_patrol_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE patrols
  SET    vehicles_checked = COALESCE(vehicles_checked, 0) + 1,
         updated_at       = NOW()
  WHERE  id = p_patrol_id;
END;
$$;

-- Increment breaches_found on a patrol row
CREATE OR REPLACE FUNCTION increment_patrol_breaches_found(p_patrol_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE patrols
  SET    breaches_found = COALESCE(breaches_found, 0) + 1,
         updated_at     = NOW()
  WHERE  id = p_patrol_id;
END;
$$;

-- Grant execute to authenticated officers
GRANT EXECUTE ON FUNCTION increment_patrol_vehicles_checked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_patrol_breaches_found(UUID) TO authenticated;
