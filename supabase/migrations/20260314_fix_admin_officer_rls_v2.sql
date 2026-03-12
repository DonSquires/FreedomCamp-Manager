-- ============================================================================
-- Fix admin_officer RLS policies (round 2)
-- ============================================================================
-- Previous migration 20260313_fix_admin_officer_rls.sql covered:
--   zones, person_observations, zone_signage_evidence, zone_legal_config,
--   notices_to_vacate, investigation_job_types
--
-- This migration covers the remaining tables that still gate on
--   ARRAY['admin', 'master'] without 'admin_officer', and also fixes two
--   policies that reference the dropped observations table.
--
-- Pattern applied:
--   BEFORE: get_user_role(auth.uid()) = ANY (ARRAY['admin', 'master'])
--   AFTER:  get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
-- ============================================================================

-- ── 1. observations ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS admins_update_observations ON observations;

CREATE POLICY admins_update_observations ON observations
  FOR UPDATE
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ── 2. enforcement_cases ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS admins_manage_enforcement_cases ON enforcement_cases;

CREATE POLICY admins_manage_enforcement_cases
  ON enforcement_cases FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ── 3. canonical_persons ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS admins_manage_persons ON canonical_persons;

CREATE POLICY admins_manage_persons
  ON canonical_persons FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
  );

-- ── 4. evidence_access_log ───────────────────────────────────────────────────
-- Also fixes reference to dropped observations → now uses observations

DROP POLICY IF EXISTS "admins_view_evidence_access_log" ON evidence_access_log;

CREATE POLICY "admins_view_evidence_access_log"
  ON evidence_access_log FOR SELECT
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR EXISTS (
        SELECT 1 FROM observations obs
        WHERE obs.id = evidence_access_log.observation_id
        AND obs.organization_id = get_user_organization_id(auth.uid())
      )
    )
  );

-- ── 5. privacy_impact_assessments ────────────────────────────────────────────

DROP POLICY IF EXISTS "admins_manage_pia" ON privacy_impact_assessments;

CREATE POLICY "admins_manage_pia"
  ON privacy_impact_assessments FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ── 6. retention_policies ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admins_manage_retention_policies" ON retention_policies;

CREATE POLICY "admins_manage_retention_policies"
  ON retention_policies FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ── 7. access_requests ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admins_manage_access_requests" ON access_requests;

CREATE POLICY "admins_manage_access_requests"
  ON access_requests FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ── 8. notice_templates ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admins_manage_notice_templates" ON notice_templates;

CREATE POLICY "admins_manage_notice_templates"
  ON notice_templates FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ── 9. infringement_notices ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "admins_manage_infringement_notices" ON infringement_notices;

CREATE POLICY "admins_manage_infringement_notices"
  ON infringement_notices FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ── 10. boundary_review_queue ────────────────────────────────────────────────
-- Also fixes reference to dropped observations → now uses observations

DROP POLICY IF EXISTS "admins_manage_boundary_review" ON boundary_review_queue;

CREATE POLICY "admins_manage_boundary_review"
  ON boundary_review_queue FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR EXISTS (
        SELECT 1 FROM observations obs
        WHERE obs.id = boundary_review_queue.observation_id
        AND obs.organization_id = get_user_organization_id(auth.uid())
      )
    )
  );

-- ── 11. import_batches ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS admins_manage_import_batches ON import_batches;

CREATE POLICY admins_manage_import_batches
  ON import_batches FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- ── 12. missing_photo_queue ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "admins_manage_missing_photo_queue" ON missing_photo_queue;

CREATE POLICY "admins_manage_missing_photo_queue"
  ON missing_photo_queue FOR ALL
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );
