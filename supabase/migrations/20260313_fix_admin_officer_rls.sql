-- Fix RLS policies to include admin_officer role
-- admin_officer is a hybrid role that has both admin and officer capabilities
-- and should have the same table management rights as admin.

-- ===========================================
-- ZONES TABLE
-- ===========================================

DROP POLICY IF EXISTS admins_create_zones ON public.zones;
DROP POLICY IF EXISTS admins_update_zones ON public.zones;

CREATE POLICY admins_create_zones ON public.zones
  FOR INSERT
  WITH CHECK (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])) AND
    ((get_user_role(auth.uid()) = 'master') OR (organization_id = get_user_organization_id(auth.uid())))
  );

CREATE POLICY admins_update_zones ON public.zones
  FOR UPDATE
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])) AND
    ((get_user_role(auth.uid()) = 'master') OR (organization_id = get_user_organization_id(auth.uid())))
  );

-- ===========================================
-- PERSON_OBSERVATIONS TABLE
-- ===========================================

DROP POLICY IF EXISTS admins_update_person_observations ON public.person_observations;

CREATE POLICY admins_update_person_observations ON public.person_observations
  FOR UPDATE
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])) AND
    (get_user_role(auth.uid()) = 'master' OR organization_id = get_user_organization_id(auth.uid()))
  );

-- ===========================================
-- ZONE_SIGNAGE_EVIDENCE TABLE
-- ===========================================

DROP POLICY IF EXISTS "admins_manage_zone_signage" ON zone_signage_evidence;

CREATE POLICY "admins_manage_zone_signage"
  ON zone_signage_evidence FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY(ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR EXISTS (
        SELECT 1 FROM zones z
        WHERE z.id = zone_signage_evidence.zone_id
        AND z.organization_id = get_user_organization_id(auth.uid())
      )
    )
  );

-- ===========================================
-- ZONE_LEGAL_CONFIG TABLE
-- ===========================================

DROP POLICY IF EXISTS "admins_manage_zone_legal_config" ON public.zone_legal_config;

CREATE POLICY "admins_manage_zone_legal_config"
  ON public.zone_legal_config FOR ALL
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  )
  WITH CHECK (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  );

-- ===========================================
-- NOTICES_TO_VACATE TABLE
-- ===========================================

DROP POLICY IF EXISTS "admins_manage_notices" ON public.notices_to_vacate;

CREATE POLICY "admins_manage_notices"
  ON public.notices_to_vacate FOR ALL
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  )
  WITH CHECK (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  );

-- ===========================================
-- INVESTIGATION_JOB_TYPES TABLE
-- ===========================================

DROP POLICY IF EXISTS admins_create_job_types ON public.investigation_job_types;
DROP POLICY IF EXISTS admins_update_job_types ON public.investigation_job_types;

CREATE POLICY admins_create_job_types ON public.investigation_job_types
  FOR INSERT
  WITH CHECK (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])) AND
    ((get_user_role(auth.uid()) = 'master') OR (organization_id = get_user_organization_id(auth.uid())))
  );

CREATE POLICY admins_update_job_types ON public.investigation_job_types
  FOR UPDATE
  USING (
    (is_system_default = false) AND
    (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])) AND
    ((get_user_role(auth.uid()) = 'master') OR (organization_id = get_user_organization_id(auth.uid())))
  );
