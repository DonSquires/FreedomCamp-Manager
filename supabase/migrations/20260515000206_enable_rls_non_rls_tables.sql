-- ============================================================
-- Enable RLS on 9 non-system, non-deprecated non-RLS tables
-- Excludes: spatial_ref_sys (PostGIS system table), 
--           vehicle_records_deprecated_20250131 (deprecated)
-- Note: provider_client_access_grants uses client_org_id (not organization_id)
-- ============================================================

-- ============================================================
-- Audit/Log tables: admin-only access
-- ============================================================

ALTER TABLE public.compliance_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compliance_audit_log_admin_only" ON public.compliance_audit_log
  FOR SELECT USING (
    auth.jwt() ->> 'app_role' IN ('admin', 'master')
  );
COMMENT ON POLICY "compliance_audit_log_admin_only" ON public.compliance_audit_log 
  IS 'Admin-only read access to audit logs';

ALTER TABLE public.credential_processing_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credential_processing_log_admin_only" ON public.credential_processing_log
  FOR SELECT USING (
    auth.jwt() ->> 'app_role' IN ('admin', 'master')
  );
COMMENT ON POLICY "credential_processing_log_admin_only" ON public.credential_processing_log
  IS 'Admin-only read access to credential processing logs';

-- ============================================================
-- System tables: service-role only (internal, never client-readable)
-- ============================================================

ALTER TABLE public.public_noise_complaint_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_noise_complaint_counters_deny_public" ON public.public_noise_complaint_counters
  FOR ALL USING (false);
COMMENT ON POLICY "public_noise_complaint_counters_deny_public" ON public.public_noise_complaint_counters
  IS 'Counter table: service-role only, no authenticated user access';

ALTER TABLE public.rate_limit_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_limit_entries_deny_public" ON public.rate_limit_entries
  FOR ALL USING (false);
COMMENT ON POLICY "rate_limit_entries_deny_public" ON public.rate_limit_entries
  IS 'System table: service-role only rate limiting, no user access';

ALTER TABLE public.vehicle_migration_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicle_migration_log_admin_only" ON public.vehicle_migration_log
  FOR SELECT USING (
    auth.jwt() ->> 'app_role' IN ('admin', 'master')
  );
COMMENT ON POLICY "vehicle_migration_log_admin_only" ON public.vehicle_migration_log
  IS 'Migration log: admin-only access';

-- ============================================================
-- Organization-scoped tables (have organization_id column)
-- ============================================================

ALTER TABLE public.investigation_job_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "investigation_job_templates_org_read" ON public.investigation_job_templates
  FOR SELECT USING (
    organization_id::text = auth.jwt() ->> 'org_id'
  );
COMMENT ON POLICY "investigation_job_templates_org_read" ON public.investigation_job_templates
  IS 'Job templates: org-scoped read access';

ALTER TABLE public.infringement_notice_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infringement_notice_counters_org" ON public.infringement_notice_counters
  FOR SELECT USING (
    organization_id::text = auth.jwt() ->> 'org_id'
  );
COMMENT ON POLICY "infringement_notice_counters_org" ON public.infringement_notice_counters
  IS 'Counter table: org-scoped access';

ALTER TABLE public.user_callsign_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_callsign_counters_org" ON public.user_callsign_counters
  FOR SELECT USING (
    organization_id::text = auth.jwt() ->> 'org_id'
  );
COMMENT ON POLICY "user_callsign_counters_org" ON public.user_callsign_counters
  IS 'Counter table: org-scoped access';

ALTER TABLE public.zone_geofence_monthly_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zone_geofence_monthly_snapshots_org_read" ON public.zone_geofence_monthly_snapshots
  FOR SELECT USING (
    organization_id::text = auth.jwt() ->> 'org_id'
  );
COMMENT ON POLICY "zone_geofence_monthly_snapshots_org_read" ON public.zone_geofence_monthly_snapshots
  IS 'Monthly snapshots: read scoped to user organization';

-- ============================================================
-- provider_client_access_grants: uses client_org_id (not organization_id)
-- ============================================================

ALTER TABLE public.provider_client_access_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "provider_client_access_grants_client_org_read" ON public.provider_client_access_grants
  FOR SELECT USING (
    client_org_id::text = auth.jwt() ->> 'org_id'
  );
COMMENT ON POLICY "provider_client_access_grants_client_org_read" ON public.provider_client_access_grants
  IS 'Access grants: read scoped to client organization';
