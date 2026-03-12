-- ============================================================================
-- FIX: Zone setup failures after PR #46 (supabase config push --include-all)
-- Date: 2026-03-10
--
-- PROBLEM:
--   PR #46 added `supabase config push --include-all` to the deployment
--   workflow. This pushed the [api] section from config.toml to the remote
--   Supabase project, potentially changing PostgREST's configuration (schemas,
--   extra_search_path) and causing it to reload. During or after this reload,
--   ensure_other_location_zone() RPC calls began failing, surfacing as
--   "Zone setup failed - contact support" in the Field Officer Portal.
--
--   The underlying database issue: the sync_zone_to_matrix trigger (which fires
--   when a new zone is INSERTed) can fail if zone_compliance_matrix has schema
--   differences (e.g., a missing column from an unapplied migration such as
--   requires_csc). When the trigger fails, the entire zones INSERT is rolled
--   back, ensure_other_location_zone() returns an error, and zone setup fails.
--
-- FIX:
--   1. Update sync_zone_to_matrix() to catch trigger errors and log a warning
--      instead of aborting the zones INSERT.  Zone creation is more important
--      than the automatic compliance-matrix sync — admins can reconcile the
--      matrix via the backfill logic.
--
--   2. Re-create ensure_other_location_zone() via CREATE OR REPLACE.  This is
--      a no-op for functionality but forces PostgREST to reload its schema
--      cache entry for the function, fixing any stale-cache failures.
--
--   3. Re-grant EXECUTE permissions to ensure they are in place.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Update sync_zone_to_matrix() to be resilient
--    Wraps the zone_compliance_matrix INSERT in an exception block so that
--    trigger failures (e.g., missing column, FK violation) never abort the
--    zones INSERT that triggered them.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_zone_to_matrix()
RETURNS trigger AS $$
DECLARE
  v_current_matrix record;
  v_new_version    integer;
BEGIN
  -- Only sync when zone compliance requirements have changed (or new zone)
  IF TG_OP = 'INSERT' OR (
    TG_OP = 'UPDATE' AND (
      OLD.self_contained_required IS DISTINCT FROM NEW.self_contained_required OR
      OLD.nights_per_month        IS DISTINCT FROM NEW.nights_per_month        OR
      OLD.max_consecutive_nights  IS DISTINCT FROM NEW.max_consecutive_nights  OR
      OLD.day_visit_only          IS DISTINCT FROM NEW.day_visit_only          OR
      OLD.allowed_days::jsonb     IS DISTINCT FROM NEW.allowed_days::jsonb
    )
  ) THEN
    -- Find current active matrix version for this zone
    SELECT *
    INTO v_current_matrix
    FROM zone_compliance_matrix
    WHERE zone_id      = NEW.id
      AND effective_to IS NULL
    ORDER BY version DESC
    LIMIT 1;

    -- Determine the next version number
    IF v_current_matrix IS NULL THEN
      v_new_version := 1;
    ELSE
      -- Skip if nothing actually changed
      IF v_current_matrix.self_contained_required = NEW.self_contained_required
         AND v_current_matrix.nights_per_month       = NEW.nights_per_month
         AND v_current_matrix.max_consecutive_nights = NEW.max_consecutive_nights
         AND v_current_matrix.day_visit_only         = NEW.day_visit_only
         AND v_current_matrix.allowed_days::jsonb    = NEW.allowed_days::jsonb
      THEN
        RETURN NEW;
      END IF;

      -- Close the previous version
      UPDATE zone_compliance_matrix
      SET effective_to = now()
      WHERE id = v_current_matrix.id;

      v_new_version := v_current_matrix.version + 1;
    END IF;

    -- Insert new matrix version — wrapped in an exception block so that
    -- column-mismatch / FK / constraint errors do NOT abort the parent
    -- zones INSERT.  A warning is raised so the issue is visible in logs.
    BEGIN
      INSERT INTO zone_compliance_matrix (
        zone_id,
        organization_id,
        version,
        effective_from,
        effective_to,
        self_contained_required,
        requires_csc,
        nights_per_month,
        max_consecutive_nights,
        day_visit_only,
        allowed_days,
        created_by,
        change_reason,
        change_notes
      ) VALUES (
        NEW.id,
        NEW.organization_id,
        v_new_version,
        now(),
        NULL,
        NEW.self_contained_required,
        NEW.self_contained_required,   -- keep requires_csc in sync
        NEW.nights_per_month,
        NEW.max_consecutive_nights,
        NEW.day_visit_only,
        NEW.allowed_days,
        auth.uid(),
        CASE WHEN TG_OP = 'INSERT' THEN 'auto_created_with_zone'
             ELSE 'auto_updated_from_zone' END,
        'Automatically synced from zones table'
      );

      RAISE NOTICE 'Zone % synced to compliance matrix v%', NEW.name, v_new_version;

    EXCEPTION WHEN OTHERS THEN
      -- Log the error but allow the zones INSERT to succeed.
      -- Admins can reconcile the compliance matrix later.
      RAISE WARNING
        'sync_zone_to_matrix: could not sync zone "%" (id=%) to compliance matrix: % — '
        'zone was created successfully; compliance matrix entry may need manual creation.',
        NEW.name, NEW.id, SQLERRM;
    END;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach the trigger (unchanged — just the function body changed above)
DROP TRIGGER IF EXISTS trigger_sync_zone_to_matrix ON zones;
CREATE TRIGGER trigger_sync_zone_to_matrix
  AFTER INSERT OR UPDATE ON zones
  FOR EACH ROW
  EXECUTE FUNCTION sync_zone_to_matrix();


-- ============================================================================
-- 2. Re-create ensure_other_location_zone() via CREATE OR REPLACE
--    Functionally identical to the existing function; the re-creation forces
--    PostgREST to update its schema-cache entry for this RPC so stale-cache
--    failures no longer occur.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_other_location_zone(p_organization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone_id uuid;
BEGIN
  -- Try to find an existing "Other Location" zone for this org
  SELECT id INTO v_zone_id
  FROM public.zones
  WHERE organization_id = p_organization_id
    AND name = 'Other Location'
  LIMIT 1;

  -- Create it if it doesn't exist yet
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

-- Ensure ownership and grants are correct
ALTER FUNCTION public.ensure_other_location_zone(uuid) OWNER TO postgres;

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
  v_trigger_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ensure_other_location_zone'
  ) INTO v_fn_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'zones'
      AND t.tgname = 'trigger_sync_zone_to_matrix'
  ) INTO v_trigger_exists;

  IF v_fn_exists THEN
    RAISE NOTICE '✅ ensure_other_location_zone() function present and refreshed';
  ELSE
    RAISE NOTICE '⚠️  ensure_other_location_zone() function MISSING';
  END IF;

  IF v_trigger_exists THEN
    RAISE NOTICE '✅ trigger_sync_zone_to_matrix is attached to zones table';
  ELSE
    RAISE NOTICE '⚠️  trigger_sync_zone_to_matrix MISSING from zones table';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260310_fix_ensure_other_location_zone applied';
  RAISE NOTICE '   sync_zone_to_matrix now handles trigger errors gracefully';
  RAISE NOTICE '   ensure_other_location_zone re-created (PostgREST cache refreshed)';
END;
$$;

COMMIT;
