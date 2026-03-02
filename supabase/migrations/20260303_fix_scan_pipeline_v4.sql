-- ============================================================================
-- FIX v4: Zone helper for scan pipeline
-- Date: 2026-03-03
--
-- When officers scan outside a geofence, the frontend needs to create an
-- "Other Location" fallback zone. But admins_create_zones only allows
-- admin/master roles — officers are blocked.
--
-- FIX: ensure_other_location_zone() SECURITY DEFINER RPC that officers
--      can call safely to get-or-create the fallback zone.
--
-- NOTE: The observation_jobs table and its trigger/functions have been
-- removed in 20260303_remove_observation_jobs.sql — the ALPR pipeline
-- uses observations.processing_status + alpr-process edge function directly.
-- ============================================================================

-- ============================================================================
-- Zone helper — officers can ensure "Other Location" zone exists
-- ============================================================================

-- Officers cannot INSERT into zones (only admin/master can). This SECURITY
-- DEFINER function safely creates the "Other Location" fallback zone if it
-- doesn't already exist, returning its ID.
CREATE OR REPLACE FUNCTION public.ensure_other_location_zone(p_organization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone_id uuid;
BEGIN
  -- Try to find existing "Other Location" zone for this org
  SELECT id INTO v_zone_id
  FROM public.zones
  WHERE organization_id = p_organization_id
    AND name = 'Other Location'
  LIMIT 1;

  -- If not found, create it
  IF v_zone_id IS NULL THEN
    INSERT INTO public.zones (
      organization_id,
      name,
      description,
      zone_type,
      parent_zone_id,
      is_active,
      self_contained_required,
      nights_per_month,
      max_consecutive_nights,
      day_visit_only
    ) VALUES (
      p_organization_id,
      'Other Location',
      'Council jurisdiction area - default zone for observations outside specific enforcement zones',
      'general',
      NULL,
      true,
      true,
      28,
      3,
      false
    )
    RETURNING id INTO v_zone_id;
  END IF;

  RETURN v_zone_id;
END;
$$;

-- Force owner to postgres so it bypasses zones RLS
ALTER FUNCTION public.ensure_other_location_zone(uuid)
  OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.ensure_other_location_zone TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_other_location_zone TO service_role;

COMMENT ON FUNCTION public.ensure_other_location_zone IS
  'Returns the "Other Location" zone ID for an org, creating it if needed. '
  'SECURITY DEFINER bypasses zones RLS so officers can call it safely.';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  v_fn_exists boolean;
BEGIN
  -- Check ensure_other_location_zone exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ensure_other_location_zone'
  ) INTO v_fn_exists;

  IF v_fn_exists THEN
    RAISE NOTICE '✅ ensure_other_location_zone() function exists';
  ELSE
    RAISE NOTICE '⚠️  ensure_other_location_zone() function MISSING';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260303_fix_scan_pipeline_v4 applied';
  RAISE NOTICE '   ensure_other_location_zone() SECURITY DEFINER RPC';
END;
$$;

