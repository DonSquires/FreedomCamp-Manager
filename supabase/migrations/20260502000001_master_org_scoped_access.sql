-- =============================================================================
-- master role: org-scoped access
-- Date: 2026-05-02
--
-- grand_master has unrestricted access to all organisations (platform owner).
-- master users have full access but ONLY for organisations assigned to them
-- by grand_master via AccessControlPage -> user_profiles.extra_organization_ids.
--
-- Root Cause:
--   get_user_organization_ids() returned ALL active orgs for both
--   grand_master AND master, giving master users unrestricted data access.
--   Several "*_gm_read" RLS policies also gave master blanket SELECT.
--
-- Changes:
--   1. Rebuild get_user_organization_ids(): master gets primary org +
--      descendants + extra_organization_ids only (like admin).
--      grand_master still receives all active orgs.
--   2. *_gm_read policies narrowed to grand_master only.
--   3. *_org_rw policies updated to ANY(get_user_organization_ids()).
--   4. dashboard_org_filter() remove master blanket bypass.
-- =============================================================================

-- ----------------------------------------------------------------
-- 1. Rebuild get_user_organization_ids()
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_organization_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org_id         uuid;
  v_role           text;
  v_work_locations uuid[];
  v_extra_org_ids  uuid[];
  v_descendants    uuid[];
  v_result         uuid[];
BEGIN
  SELECT organization_id,
         role,
         COALESCE(authorized_work_locations, ARRAY[]::uuid[]),
         COALESCE(extra_organization_ids,    ARRAY[]::uuid[])
  INTO   v_org_id, v_role, v_work_locations, v_extra_org_ids
  FROM   public.user_profiles
  WHERE  id = auth.uid();

  -- grand_master: unrestricted access to all active orgs
  IF v_role = 'grand_master' THEN
    SELECT ARRAY_AGG(o.id) INTO v_result
    FROM   public.organizations o
    WHERE  o.is_active = true;
    RETURN COALESCE(v_result, ARRAY[]::uuid[]);
  END IF;

  -- All other roles (including master): use assigned orgs only
  v_result := CASE WHEN v_org_id IS NOT NULL
                   THEN ARRAY[v_org_id]::uuid[]
                   ELSE ARRAY[]::uuid[] END;

  -- admin, admin_officer, master: include child orgs
  IF v_role IN ('admin', 'admin_officer', 'master') AND v_org_id IS NOT NULL THEN
    v_descendants := get_descendant_organizations(v_org_id);
    v_result := array_cat(v_result, COALESCE(v_descendants, ARRAY[]::uuid[]));
  END IF;

  -- Include authorised work locations
  IF v_work_locations IS NOT NULL AND array_length(v_work_locations, 1) > 0 THEN
    v_result := array_cat(v_result, v_work_locations);
  END IF;

  -- Include explicitly assigned org memberships
  -- (grand_master sets these on master user profiles via AccessControlPage)
  IF v_extra_org_ids IS NOT NULL AND array_length(v_extra_org_ids, 1) > 0 THEN
    v_result := array_cat(v_result, v_extra_org_ids);
  END IF;

  SELECT ARRAY_AGG(DISTINCT org_id) INTO v_result
  FROM   unnest(COALESCE(v_result, ARRAY[]::uuid[])) AS org_id;

  RETURN COALESCE(v_result, ARRAY[]::uuid[]);

EXCEPTION WHEN invalid_text_representation OR data_exception THEN
  IF v_org_id IS NOT NULL THEN
    RETURN ARRAY[v_org_id]::uuid[];
  END IF;
  RETURN ARRAY[]::uuid[];
END;
$fn$;

COMMENT ON FUNCTION public.get_user_organization_ids() IS
  'Returns all organisation IDs accessible to the current user. '
  'grand_master: all active orgs. '
  'master/admin/admin_officer: primary + descendants + work_locations + extra_org_ids. '
  'grand_master assigns extra_organization_ids to master users to grant org-scoped access.';

-- ----------------------------------------------------------------
-- 2. Update dashboard_org_filter() - remove master blanket bypass
-- ----------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'dashboard_breaches') THEN
    EXECUTE $dyn$
      CREATE OR REPLACE FUNCTION public.dashboard_org_filter()
      RETURNS SETOF public.dashboard_breaches AS $f$
      BEGIN
        RETURN QUERY
        SELECT * FROM public.dashboard_breaches
        WHERE organization_id = ANY(get_user_organization_ids());
      END;
      $f$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
    $dyn$;
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 3. Update *_gm_read policies: grand_master only
-- ----------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='parking_zones') THEN
    DROP POLICY IF EXISTS "parking_zones_gm_read" ON public.parking_zones;
    CREATE POLICY "parking_zones_gm_read" ON public.parking_zones FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master');
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='parking_sessions') THEN
    DROP POLICY IF EXISTS "parking_sessions_gm_read" ON public.parking_sessions;
    CREATE POLICY "parking_sessions_gm_read" ON public.parking_sessions FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master');
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='parking_permits') THEN
    DROP POLICY IF EXISTS "parking_permits_gm_read" ON public.parking_permits;
    CREATE POLICY "parking_permits_gm_read" ON public.parking_permits FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master');
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='parking_infringements') THEN
    DROP POLICY IF EXISTS "parking_infringements_gm_read" ON public.parking_infringements;
    CREATE POLICY "parking_infringements_gm_read" ON public.parking_infringements FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master');
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_jobs') THEN
    DROP POLICY IF EXISTS "noise_jobs_gm_read" ON public.noise_jobs;
    CREATE POLICY "noise_jobs_gm_read" ON public.noise_jobs FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master');
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_assessments') THEN
    DROP POLICY IF EXISTS "noise_assessments_gm_read" ON public.noise_assessments;
    CREATE POLICY "noise_assessments_gm_read" ON public.noise_assessments FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master');
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_notices') THEN
    DROP POLICY IF EXISTS "noise_notices_gm_read" ON public.noise_notices;
    CREATE POLICY "noise_notices_gm_read" ON public.noise_notices FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master');
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_seizures') THEN
    DROP POLICY IF EXISTS "noise_seizures_gm_read" ON public.noise_seizures;
    CREATE POLICY "noise_seizures_gm_read" ON public.noise_seizures FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master');
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 4. Update *_org_rw policies: use ANY(get_user_organization_ids())
-- ----------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='parking_zones') THEN
    DROP POLICY IF EXISTS "parking_zones_org_rw" ON public.parking_zones;
    CREATE POLICY "parking_zones_org_rw" ON public.parking_zones FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='parking_sessions') THEN
    DROP POLICY IF EXISTS "parking_sessions_org_rw" ON public.parking_sessions;
    CREATE POLICY "parking_sessions_org_rw" ON public.parking_sessions FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='parking_permits') THEN
    DROP POLICY IF EXISTS "parking_permits_org_rw" ON public.parking_permits;
    CREATE POLICY "parking_permits_org_rw" ON public.parking_permits FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='parking_infringement_counters') THEN
    DROP POLICY IF EXISTS "parking_infringement_counters_org_rw" ON public.parking_infringement_counters;
    CREATE POLICY "parking_infringement_counters_org_rw" ON public.parking_infringement_counters FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='parking_infringements') THEN
    DROP POLICY IF EXISTS "parking_infringements_org_rw" ON public.parking_infringements;
    CREATE POLICY "parking_infringements_org_rw" ON public.parking_infringements FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_jobs') THEN
    DROP POLICY IF EXISTS "noise_jobs_org_rw" ON public.noise_jobs;
    CREATE POLICY "noise_jobs_org_rw" ON public.noise_jobs FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_job_counters') THEN
    DROP POLICY IF EXISTS "noise_job_counters_org_rw" ON public.noise_job_counters;
    CREATE POLICY "noise_job_counters_org_rw" ON public.noise_job_counters FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_assessments') THEN
    DROP POLICY IF EXISTS "noise_assessments_org_rw" ON public.noise_assessments;
    CREATE POLICY "noise_assessments_org_rw" ON public.noise_assessments FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_notices') THEN
    DROP POLICY IF EXISTS "noise_notices_org_rw" ON public.noise_notices;
    CREATE POLICY "noise_notices_org_rw" ON public.noise_notices FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_notice_counters') THEN
    DROP POLICY IF EXISTS "noise_notice_counters_org_rw" ON public.noise_notice_counters;
    CREATE POLICY "noise_notice_counters_org_rw" ON public.noise_notice_counters FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_seizures') THEN
    DROP POLICY IF EXISTS "noise_seizures_org_rw" ON public.noise_seizures;
    CREATE POLICY "noise_seizures_org_rw" ON public.noise_seizures FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='noise_seizure_counters') THEN
    DROP POLICY IF EXISTS "noise_seizure_counters_org_rw" ON public.noise_seizure_counters;
    CREATE POLICY "noise_seizure_counters_org_rw" ON public.noise_seizure_counters FOR ALL TO authenticated
      USING (organization_id = ANY(get_user_organization_ids()));
  END IF;
END $$;

-- ----------------------------------------------------------------
-- Summary
-- ----------------------------------------------------------------

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'master org-scoped access applied.';
  RAISE NOTICE '  grand_master : unrestricted - all active organisations';
  RAISE NOTICE '  master       : org-scoped - assigned orgs only';
  RAISE NOTICE '                 Set via AccessControlPage extra_organization_ids';
  RAISE NOTICE '=================================================================';
END $$;
