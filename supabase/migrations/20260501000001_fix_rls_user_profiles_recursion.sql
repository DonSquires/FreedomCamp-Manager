-- =============================================================================
-- Fix RLS infinite recursion in user_profiles and dependent tables
-- Date: 2026-05-01
--
-- Root Cause:
--   The "client_viewer_view_user_profiles" policy (added in
--   20260428000001_first_security_structure_and_roles.sql) contains a direct
--   subquery on public.user_profiles inside its USING clause:
--
--       USING (
--         get_user_role(auth.uid()) = 'client_viewer'
--         AND organization_id = (
--           SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
--         )
--       )
--
--   Because the policy is ON public.user_profiles, evaluating it triggers RLS
--   on user_profiles again, which triggers the same policy, causing:
--
--       "infinite recursion detected in policy for relation user_profiles"
--
--   This error fires for ALL authenticated users on every login / profile
--   fetch — not just client_viewer users — making the application completely
--   unusable.
--
-- Fix strategy:
--   Replace ALL direct SELECT ... FROM [public.]user_profiles subqueries inside
--   RLS policies with SECURITY DEFINER helper functions:
--     • get_user_role(auth.uid())            — returns the caller's TEXT role
--     • get_user_organization_id(auth.uid()) — returns the caller's primary org UUID
--
--   These helpers bypass RLS when they query user_profiles, breaking the
--   recursion loop.
--
--   Additionally, harden the two helper functions themselves with
--   SET search_path = public to prevent search-path injection.
--
-- Tables affected:
--   1. user_profiles               (CRITICAL — root of recursion)
--   2. parking_zones, parking_sessions, parking_permits,
--      parking_infringement_counters, parking_infringements
--   3. noise_jobs, noise_job_counters, noise_assessments, noise_notices,
--      noise_notice_counters, noise_seizures, noise_seizure_counters
--   4. persons_of_interest, vehicles_of_interest, trespass_notices,
--      site_risk_assessments
--   5. face_records
--   6. site_incidents
--   7. patrol_checkpoints, checkpoint_visits
--   8. officer_shifts  (schedule + timesheet-approval policies)
--   9. open_shifts
--  10. roster_shifts
--  11. privacy_curtain_settings, privacy_access_log
--  12. observations  (insert WITH CHECK)
-- =============================================================================

-- ─── 0. Harden helper functions with SET search_path = public ────────────────
--      Without this a SECURITY DEFINER function inherits the caller's
--      search_path, opening a search-path-injection vector.

CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM public.user_profiles
  WHERE id = p_user_id;
  RETURN COALESCE(v_role, 'officer');
END;
$$;

COMMENT ON FUNCTION public.get_user_role(UUID) IS
  'Returns the role of the given user. Defaults to ''officer'' when not found. '
  'SECURITY DEFINER with fixed search_path — safe to call inside RLS policies.';

CREATE OR REPLACE FUNCTION public.get_user_organization_id(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM public.user_profiles
  WHERE id = p_user_id;
  RETURN v_org_id;
END;
$$;

COMMENT ON FUNCTION public.get_user_organization_id(UUID) IS
  'Returns the primary organization_id of the given user. '
  'SECURITY DEFINER with fixed search_path — safe to call inside RLS policies.';

-- ─── 1. user_profiles — CRITICAL fix ─────────────────────────────────────────
--      The broken policy on user_profiles itself is the root of all recursion.

DO $$ BEGIN
  DROP POLICY IF EXISTS "client_viewer_view_user_profiles" ON public.user_profiles;
  CREATE POLICY "client_viewer_view_user_profiles"
    ON public.user_profiles
    FOR SELECT
    TO authenticated
    USING (
      get_user_role(auth.uid()) = 'client_viewer'
      AND organization_id = get_user_organization_id(auth.uid())
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── 2. parking tables ────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parking_zones'
  ) THEN
    DROP POLICY IF EXISTS "parking_zones_org_rw" ON public.parking_zones;
    CREATE POLICY "parking_zones_org_rw"
      ON public.parking_zones FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));

    DROP POLICY IF EXISTS "parking_zones_gm_read" ON public.parking_zones;
    CREATE POLICY "parking_zones_gm_read"
      ON public.parking_zones FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) IN ('grand_master', 'master'));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parking_sessions'
  ) THEN
    DROP POLICY IF EXISTS "parking_sessions_org_rw" ON public.parking_sessions;
    CREATE POLICY "parking_sessions_org_rw"
      ON public.parking_sessions FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));

    DROP POLICY IF EXISTS "parking_sessions_gm_read" ON public.parking_sessions;
    CREATE POLICY "parking_sessions_gm_read"
      ON public.parking_sessions FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) IN ('grand_master', 'master'));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parking_permits'
  ) THEN
    DROP POLICY IF EXISTS "parking_permits_org_rw" ON public.parking_permits;
    CREATE POLICY "parking_permits_org_rw"
      ON public.parking_permits FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));

    DROP POLICY IF EXISTS "parking_permits_gm_read" ON public.parking_permits;
    CREATE POLICY "parking_permits_gm_read"
      ON public.parking_permits FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) IN ('grand_master', 'master'));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parking_infringement_counters'
  ) THEN
    DROP POLICY IF EXISTS "parking_infringement_counters_org_rw" ON public.parking_infringement_counters;
    CREATE POLICY "parking_infringement_counters_org_rw"
      ON public.parking_infringement_counters FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parking_infringements'
  ) THEN
    DROP POLICY IF EXISTS "parking_infringements_org_rw" ON public.parking_infringements;
    CREATE POLICY "parking_infringements_org_rw"
      ON public.parking_infringements FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));

    DROP POLICY IF EXISTS "parking_infringements_gm_read" ON public.parking_infringements;
    CREATE POLICY "parking_infringements_gm_read"
      ON public.parking_infringements FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) IN ('grand_master', 'master'));
  END IF;
END $$;

-- ─── 3. noise tables ──────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'noise_jobs'
  ) THEN
    DROP POLICY IF EXISTS "noise_jobs_org_rw" ON public.noise_jobs;
    CREATE POLICY "noise_jobs_org_rw"
      ON public.noise_jobs FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));

    DROP POLICY IF EXISTS "noise_jobs_gm_read" ON public.noise_jobs;
    CREATE POLICY "noise_jobs_gm_read"
      ON public.noise_jobs FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) IN ('grand_master', 'master'));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'noise_job_counters'
  ) THEN
    DROP POLICY IF EXISTS "noise_job_counters_org_rw" ON public.noise_job_counters;
    CREATE POLICY "noise_job_counters_org_rw"
      ON public.noise_job_counters FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'noise_assessments'
  ) THEN
    DROP POLICY IF EXISTS "noise_assessments_org_rw" ON public.noise_assessments;
    CREATE POLICY "noise_assessments_org_rw"
      ON public.noise_assessments FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));

    DROP POLICY IF EXISTS "noise_assessments_gm_read" ON public.noise_assessments;
    CREATE POLICY "noise_assessments_gm_read"
      ON public.noise_assessments FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) IN ('grand_master', 'master'));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'noise_notices'
  ) THEN
    DROP POLICY IF EXISTS "noise_notices_org_rw" ON public.noise_notices;
    CREATE POLICY "noise_notices_org_rw"
      ON public.noise_notices FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));

    DROP POLICY IF EXISTS "noise_notices_gm_read" ON public.noise_notices;
    CREATE POLICY "noise_notices_gm_read"
      ON public.noise_notices FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) IN ('grand_master', 'master'));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'noise_notice_counters'
  ) THEN
    DROP POLICY IF EXISTS "noise_notice_counters_org_rw" ON public.noise_notice_counters;
    CREATE POLICY "noise_notice_counters_org_rw"
      ON public.noise_notice_counters FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'noise_seizures'
  ) THEN
    DROP POLICY IF EXISTS "noise_seizures_org_rw" ON public.noise_seizures;
    CREATE POLICY "noise_seizures_org_rw"
      ON public.noise_seizures FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));

    DROP POLICY IF EXISTS "noise_seizures_gm_read" ON public.noise_seizures;
    CREATE POLICY "noise_seizures_gm_read"
      ON public.noise_seizures FOR SELECT TO authenticated
      USING (get_user_role(auth.uid()) IN ('grand_master', 'master'));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'noise_seizure_counters'
  ) THEN
    DROP POLICY IF EXISTS "noise_seizure_counters_org_rw" ON public.noise_seizure_counters;
    CREATE POLICY "noise_seizure_counters_org_rw"
      ON public.noise_seizure_counters FOR ALL TO authenticated
      USING (organization_id = get_user_organization_id(auth.uid()));
  END IF;
END $$;

-- ─── 4. POI / VOI / trespass_notices / site_risk_assessments ─────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'persons_of_interest'
  ) THEN
    DROP POLICY IF EXISTS "poi_org_read" ON public.persons_of_interest;
    CREATE POLICY "poi_org_read"
      ON public.persons_of_interest FOR SELECT
      TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
      );

    DROP POLICY IF EXISTS "poi_org_write" ON public.persons_of_interest;
    CREATE POLICY "poi_org_write"
      ON public.persons_of_interest FOR ALL
      TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'officer')
      )
      WITH CHECK (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'officer')
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vehicles_of_interest'
  ) THEN
    DROP POLICY IF EXISTS "voi_org_read" ON public.vehicles_of_interest;
    CREATE POLICY "voi_org_read"
      ON public.vehicles_of_interest FOR SELECT
      TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
      );

    DROP POLICY IF EXISTS "voi_org_write" ON public.vehicles_of_interest;
    CREATE POLICY "voi_org_write"
      ON public.vehicles_of_interest FOR ALL
      TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'officer')
      )
      WITH CHECK (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'officer')
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'trespass_notices'
  ) THEN
    DROP POLICY IF EXISTS "tn_org_read" ON public.trespass_notices;
    CREATE POLICY "tn_org_read"
      ON public.trespass_notices FOR SELECT
      TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
      );

    DROP POLICY IF EXISTS "tn_org_write" ON public.trespass_notices;
    CREATE POLICY "tn_org_write"
      ON public.trespass_notices FOR ALL
      TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'officer')
      )
      WITH CHECK (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'officer')
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_risk_assessments'
  ) THEN
    DROP POLICY IF EXISTS "sra_org_read" ON public.site_risk_assessments;
    CREATE POLICY "sra_org_read"
      ON public.site_risk_assessments FOR SELECT
      TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
      );

    DROP POLICY IF EXISTS "sra_org_write" ON public.site_risk_assessments;
    CREATE POLICY "sra_org_write"
      ON public.site_risk_assessments FOR ALL
      TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'officer')
      )
      WITH CHECK (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'officer')
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── 5. face_records ──────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'face_records'
  ) THEN
    DROP POLICY IF EXISTS "face_records_select" ON public.face_records;
    CREATE POLICY "face_records_select"
      ON public.face_records FOR SELECT TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
      );

    DROP POLICY IF EXISTS "face_records_insert" ON public.face_records;
    CREATE POLICY "face_records_insert"
      ON public.face_records FOR INSERT TO authenticated
      WITH CHECK (
        get_user_role(auth.uid()) IN ('admin', 'master', 'admin_officer', 'officer')
        AND get_user_organization_id(auth.uid()) = organization_id
      );

    DROP POLICY IF EXISTS "face_records_update" ON public.face_records;
    CREATE POLICY "face_records_update"
      ON public.face_records FOR UPDATE TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('admin', 'master', 'admin_officer')
        AND get_user_organization_id(auth.uid()) = organization_id
      );

    DROP POLICY IF EXISTS "face_records_delete" ON public.face_records;
    CREATE POLICY "face_records_delete"
      ON public.face_records FOR DELETE TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('admin', 'master')
        AND get_user_organization_id(auth.uid()) = organization_id
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── 6. site_incidents ────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_incidents'
  ) THEN
    DROP POLICY IF EXISTS "admins_manage_site_incidents" ON public.site_incidents;
    CREATE POLICY "admins_manage_site_incidents"
      ON public.site_incidents FOR ALL TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
      )
      WITH CHECK (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
      );

    DROP POLICY IF EXISTS "client_viewer_read_site_incidents" ON public.site_incidents;
    CREATE POLICY "client_viewer_read_site_incidents"
      ON public.site_incidents FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) = 'client_viewer'
        AND organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── 7. patrol_checkpoints / checkpoint_visits ────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'patrol_checkpoints'
  ) THEN
    DROP POLICY IF EXISTS "org_members_read_checkpoints" ON public.patrol_checkpoints;
    CREATE POLICY "org_members_read_checkpoints"
      ON public.patrol_checkpoints FOR SELECT TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
      );

    DROP POLICY IF EXISTS "admins_manage_checkpoints" ON public.patrol_checkpoints;
    CREATE POLICY "admins_manage_checkpoints"
      ON public.patrol_checkpoints FOR ALL TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
      )
      WITH CHECK (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'checkpoint_visits'
  ) THEN
    DROP POLICY IF EXISTS "admins_read_org_visits" ON public.checkpoint_visits;
    CREATE POLICY "admins_read_org_visits"
      ON public.checkpoint_visits FOR SELECT TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── 8. officer_shifts ────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'officer_shifts'
  ) THEN
    -- Recreate the admin read policy from the patrol_schedule migration
    DROP POLICY IF EXISTS "admins_read_org_shifts" ON public.officer_shifts;
    CREATE POLICY "admins_read_org_shifts"
      ON public.officer_shifts FOR SELECT TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
      );

    -- Recreate the timesheet-approval update policy
    DROP POLICY IF EXISTS "admins can update shift approval" ON public.officer_shifts;
    CREATE POLICY "admins can update shift approval"
      ON public.officer_shifts FOR UPDATE TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
        AND get_user_organization_id(auth.uid()) = organization_id
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── 9. open_shifts ───────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'open_shifts'
  ) THEN
    DROP POLICY IF EXISTS "admins manage open_shifts" ON public.open_shifts;
    CREATE POLICY "admins manage open_shifts"
      ON public.open_shifts FOR ALL TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
        AND get_user_organization_id(auth.uid()) = organization_id
      );

    DROP POLICY IF EXISTS "officers read open_shifts" ON public.open_shifts;
    CREATE POLICY "officers read open_shifts"
      ON public.open_shifts FOR SELECT TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('officer', 'admin_officer')
        AND get_user_organization_id(auth.uid()) = organization_id
      );

    DROP POLICY IF EXISTS "officers claim open_shifts" ON public.open_shifts;
    CREATE POLICY "officers claim open_shifts"
      ON public.open_shifts FOR UPDATE TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('officer', 'admin_officer')
        AND get_user_organization_id(auth.uid()) = organization_id
      )
      WITH CHECK (
        status IN ('open', 'filled')
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── 10. roster_shifts ────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'roster_shifts'
  ) THEN
    DROP POLICY IF EXISTS "admins manage roster_shifts" ON public.roster_shifts;
    CREATE POLICY "admins manage roster_shifts"
      ON public.roster_shifts FOR ALL TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
        AND get_user_organization_id(auth.uid()) = organization_id
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── 11. privacy_curtain_settings / privacy_access_log ───────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'privacy_curtain_settings'
  ) THEN
    DROP POLICY IF EXISTS "admins_manage_privacy_settings" ON public.privacy_curtain_settings;
    CREATE POLICY "admins_manage_privacy_settings"
      ON public.privacy_curtain_settings FOR ALL TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
      )
      WITH CHECK (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'privacy_access_log'
  ) THEN
    DROP POLICY IF EXISTS "admins_read_privacy_access_log" ON public.privacy_access_log;
    CREATE POLICY "admins_read_privacy_access_log"
      ON public.privacy_access_log FOR SELECT TO authenticated
      USING (
        organization_id = get_user_organization_id(auth.uid())
        AND get_user_role(auth.uid()) IN ('admin', 'master')
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── 12. observations — users_insert_own_observations ────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'observations'
  ) THEN
    DROP POLICY IF EXISTS "users_insert_own_observations" ON public.observations;
    CREATE POLICY "users_insert_own_observations"
      ON public.observations FOR INSERT TO authenticated
      WITH CHECK (
        recorded_by = auth.uid()
        AND organization_id = COALESCE(get_user_organization_id(auth.uid()), organization_id)
      );
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── Summary ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'RLS recursion fix applied successfully.';
  RAISE NOTICE '-----------------------------------------------------------------';
  RAISE NOTICE '  Root cause: client_viewer_view_user_profiles policy on';
  RAISE NOTICE '  user_profiles was subquerying user_profiles directly,';
  RAISE NOTICE '  causing infinite recursion for ALL authenticated users.';
  RAISE NOTICE '';
  RAISE NOTICE '  Fix: All direct SELECT … FROM user_profiles subqueries inside';
  RAISE NOTICE '  RLS policies replaced with SECURITY DEFINER helper calls:';
  RAISE NOTICE '    get_user_role(auth.uid())';
  RAISE NOTICE '    get_user_organization_id(auth.uid())';
  RAISE NOTICE '';
  RAISE NOTICE '  Helper functions hardened with SET search_path = public.';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
END $$;
