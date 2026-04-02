-- Candidate inventory for legacy cleanup after clean cutover.
-- Do not execute drops from this file; this is a reporting tool.

-- Legacy pages and internal tools still referenced by route bundles should be removed only
-- when clean routes are fully enabled and validated.

-- Table candidates from clean design (validate dependencies before removal):
select unnest(array[
  'vehicle_monthly_stays',
  'compliance_results',
  'investigation_jobs',
  'investigation_job_templates',
  'privacy_impact_assessments',
  'canonical_persons'
]) as legacy_table_candidate;

-- Function candidates from consolidation plan:
select unnest(array[
  'recalculate-compliance',
  'recalculate-compliance-v2',
  'recalculate-compliance-v3',
  'alpr-retry',
  'scan-breaches',
  'check-data-integrity',
  'check-zone-corrections',
  'test-compliance-matrix',
  'suggest-new-zone',
  'get-weather'
]) as legacy_function_candidate;
