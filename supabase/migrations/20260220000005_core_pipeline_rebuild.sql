-- ============================================================================
-- CORE PIPELINE REBUILD - PHASE 0 DATABASE FOUNDATION
-- ============================================================================
-- Purpose: Establish stable 4-layer architecture for Officer App workflow
-- Layers:
--   1. Observation Ingest (photo-first Edge Function)
--   2. Canonical Context Enrichment (trigger-driven)
--   3. Compliance Engine (evaluate_compliance_v4)
--   4. Result Delivery (get_observation_result RPC)
--
-- Frozen APIs: cohort_overstayers, cohort_homeless_exempt, cohort_all_breaches,
--              evaluate_observation_requirements, get_observation_result
--
-- Date: 2026-02-20
-- Author: Core Pipeline Rebuild Team
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: COMPLIANCE RESULTS ENHANCEMENTS
-- ============================================================================
-- Add requirement_details for per-rule breakdown (Layer 3 output)
-- Add analytics_only flag to prevent enforcement on historical backfill

ALTER TABLE compliance_results 
ADD COLUMN IF NOT EXISTS requirement_details jsonb DEFAULT '{}'::jsonb;

ALTER TABLE compliance_results 
ADD COLUMN IF NOT EXISTS analytics_only boolean DEFAULT false;

COMMENT ON COLUMN compliance_results.requirement_details IS 
'Per-requirement compliance status breakdown (YES/NO/BREACH/BREACH_EXEMPT) with detailed reasons for Zone Requirements checklist';

COMMENT ON COLUMN compliance_results.analytics_only IS 
'TRUE for historical backfill records; prevents enforcement actions while preserving KPI analytics';


-- ============================================================================
-- SECTION 2: LAYER 3 - COMPLIANCE ENGINE (evaluate_compliance_v4)
-- ============================================================================
-- Core evaluation logic: runs all compliance checks and produces single result

CREATE OR REPLACE FUNCTION evaluate_compliance_v4(p_observation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_obs observations%ROWTYPE;
  v_zone zones%ROWTYPE;
  v_matrix zone_compliance_matrix%ROWTYPE;
  v_canonical canonical_vehicles%ROWTYPE;
  v_monthly vehicle_monthly_stays%ROWTYPE;
  
  v_is_compliant boolean := true;
  v_is_homeless_exempt boolean := false;
  v_violation_reasons text[] := '{}';
  v_requirement_details jsonb := '{}'::jsonb;
  
  v_csc_status text;
  v_csc_reason text;
  v_consecutive_status text;
  v_consecutive_reason text;
  v_monthly_status text;
  v_monthly_reason text;
  v_time_status text;
  v_time_reason text;
  v_exempt_status text;
  v_exempt_reason text;
BEGIN
  -- Load observation with all enriched data
  SELECT * INTO v_obs FROM observations WHERE observation_id = p_observation_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Observation % not found', p_observation_id;
  END IF;
  
  -- Load zone and active compliance matrix
  SELECT * INTO v_zone FROM zones WHERE id = v_obs.zone_id;
  
  SELECT * INTO v_matrix 
  FROM zone_compliance_matrix 
  WHERE zone_id = v_obs.zone_id 
    AND effective_from <= v_obs.recorded_at
    AND (effective_to IS NULL OR effective_to > v_obs.recorded_at)
  ORDER BY version DESC 
  LIMIT 1;
  
  -- Load canonical vehicle data
  SELECT * INTO v_canonical FROM canonical_vehicles WHERE plate_number = v_obs.plate_number;
  
  -- Load monthly stays context
  SELECT * INTO v_monthly 
  FROM vehicle_monthly_stays 
  WHERE plate_number = v_obs.plate_number
    AND zone_id = v_obs.zone_id
    AND organization_id = v_obs.organization_id
    AND calendar_month = date_trunc('month', v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland')::date;
  
  -- -------------------------------------------------------------------------
  -- REQUIREMENT 1: Self-Contained Certification (CSC)
  -- -------------------------------------------------------------------------
  IF v_matrix.requires_csc = true THEN
    IF v_canonical.self_contained = true AND 
       (v_canonical.self_contained_expiry IS NULL OR v_canonical.self_contained_expiry >= (v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland')::date) THEN
      v_csc_status := 'YES';
      v_csc_reason := format('Vehicle has valid %s CSC warrant (expires %s)', 
                             COALESCE(v_canonical.nzscv_warrant_type, 'Green'),
                             COALESCE(v_canonical.self_contained_expiry::text, 'never'));
    ELSE
      v_csc_status := 'BREACH';
      v_csc_reason := 'Vehicle does not have a valid self-contained certificate';
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'no_valid_csc');
    END IF;
  ELSE
    v_csc_status := 'YES';
    v_csc_reason := 'Self-contained certification not required in this zone';
  END IF;
  
  -- -------------------------------------------------------------------------
  -- REQUIREMENT 2: Consecutive Nights Limit
  -- -------------------------------------------------------------------------
  IF v_matrix.max_consecutive_nights IS NOT NULL THEN
    IF COALESCE(v_monthly.consecutive_nights, 0) > v_matrix.max_consecutive_nights THEN
      v_consecutive_status := 'BREACH';
      v_consecutive_reason := format('%s/%s consecutive nights (limit exceeded)', 
                                    COALESCE(v_monthly.consecutive_nights, 0),
                                    v_matrix.max_consecutive_nights);
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'consecutive_nights_exceeded');
    ELSE
      v_consecutive_status := 'YES';
      v_consecutive_reason := format('%s/%s consecutive nights', 
                                    COALESCE(v_monthly.consecutive_nights, 0),
                                    v_matrix.max_consecutive_nights);
    END IF;
  ELSE
    v_consecutive_status := 'YES';
    v_consecutive_reason := 'No consecutive night limit in this zone';
  END IF;
  
  -- -------------------------------------------------------------------------
  -- REQUIREMENT 3: Monthly Stays Limit
  -- -------------------------------------------------------------------------
  IF v_matrix.nights_per_month IS NOT NULL THEN
    IF COALESCE(v_monthly.nights_stayed, 0) > v_matrix.nights_per_month THEN
      v_monthly_status := 'BREACH';
      v_monthly_reason := format('%s/%s nights used this month (limit exceeded)', 
                                COALESCE(v_monthly.nights_stayed, 0),
                                v_matrix.nights_per_month);
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'monthly_stays_exceeded');
    ELSE
      v_monthly_status := 'YES';
      v_monthly_reason := format('%s/%s nights used this month', 
                                COALESCE(v_monthly.nights_stayed, 0),
                                v_matrix.nights_per_month);
    END IF;
  ELSE
    v_monthly_status := 'YES';
    v_monthly_reason := 'No monthly stay limit in this zone';
  END IF;
  
  -- -------------------------------------------------------------------------
  -- REQUIREMENT 4: Time Restrictions (day-visit-only)
  -- -------------------------------------------------------------------------
  IF v_matrix.day_visit_only = true THEN
    -- Check if observation was recorded during overnight hours (typically 8pm-8am)
    IF EXTRACT(HOUR FROM v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland') >= 20 
       OR EXTRACT(HOUR FROM v_obs.recorded_at AT TIME ZONE 'Pacific/Auckland') < 8 THEN
      v_time_status := 'BREACH';
      v_time_reason := 'Overnight parking prohibited (day-visit only zone)';
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'overnight_parking_prohibited');
    ELSE
      v_time_status := 'YES';
      v_time_reason := 'Observed during permitted day-visit hours';
    END IF;
  ELSE
    v_time_status := 'YES';
    v_time_reason := 'Overnight parking permitted in this zone';
  END IF;
  
  -- -------------------------------------------------------------------------
  -- REQUIREMENT 5: Homeless Exemption
  -- -------------------------------------------------------------------------
  IF v_matrix.homeless_exemption = true AND v_canonical.homeless_status IN ('confirmed', 'suspected') THEN
    v_exempt_status := 'EXEMPT';
    v_exempt_reason := format('Admin confirmed homeless status on %s', 
                              COALESCE(v_canonical.homeless_confirmed_at::date::text, 'unknown date'));
    v_is_homeless_exempt := true;
  ELSE
    v_exempt_status := 'NO';
    v_exempt_reason := 'Not eligible for homeless exemption';
  END IF;
  
  -- -------------------------------------------------------------------------
  -- BUILD requirement_details JSON
  -- -------------------------------------------------------------------------
  v_requirement_details := jsonb_build_object(
    'self_contained', jsonb_build_object(
      'status', v_csc_status,
      'reason', v_csc_reason
    ),
    'consecutive_nights', jsonb_build_object(
      'status', v_consecutive_status,
      'reason', v_consecutive_reason
    ),
    'monthly_stays', jsonb_build_object(
      'status', v_monthly_status,
      'reason', v_monthly_reason
    ),
    'time_restrictions', jsonb_build_object(
      'status', v_time_status,
      'reason', v_time_reason
    ),
    'homeless_exemption', jsonb_build_object(
      'status', v_exempt_status,
      'reason', v_exempt_reason
    )
  );
  
  -- -------------------------------------------------------------------------
  -- INSERT/UPDATE compliance_results
  -- -------------------------------------------------------------------------
  INSERT INTO compliance_results (
    observation_id,
    zone_id,
    organization_id,
    matrix_id,
    matrix_version,
    is_compliant,
    is_homeless_exempt,
    violation_reasons,
    requirement_details,
    matrix_snapshot,
    evaluated_at
  ) VALUES (
    p_observation_id,
    v_obs.zone_id,
    v_obs.organization_id,
    v_matrix.id,
    v_matrix.version,
    v_is_compliant,
    v_is_homeless_exempt,
    v_violation_reasons,
    v_requirement_details,
    to_jsonb(v_matrix),
    now()
  )
  ON CONFLICT (observation_id, matrix_id) 
  DO UPDATE SET
    is_compliant = EXCLUDED.is_compliant,
    is_homeless_exempt = EXCLUDED.is_homeless_exempt,
    violation_reasons = EXCLUDED.violation_reasons,
    requirement_details = EXCLUDED.requirement_details,
    evaluated_at = EXCLUDED.evaluated_at;
  
END;
$$;

GRANT EXECUTE ON FUNCTION evaluate_compliance_v4(uuid) TO authenticated;

COMMENT ON FUNCTION evaluate_compliance_v4(uuid) IS 
'Layer 3: Compliance Engine - Evaluates all zone requirements and produces single compliance_results row with per-requirement breakdown';


-- ============================================================================
-- SECTION 3: LAYER 2/3 TRIGGER - AUTO-EVALUATE ON OBSERVATION INSERT
-- ============================================================================

CREATE OR REPLACE FUNCTION pipeline_layer_2_and_3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Layer 2: Enrichment happens via existing triggers (populate_observation_from_canonical)
  -- Layer 3: Evaluate compliance
  PERFORM evaluate_compliance_v4(NEW.observation_id);
  
  RETURN NEW;
END;
$$;

-- Attach trigger to observations
DROP TRIGGER IF EXISTS trigger_pipeline_layer_2_and_3 ON observations;
CREATE TRIGGER trigger_pipeline_layer_2_and_3
AFTER INSERT ON observations
FOR EACH ROW
EXECUTE FUNCTION pipeline_layer_2_and_3();

COMMENT ON FUNCTION pipeline_layer_2_and_3() IS 
'Layer 2/3 Trigger: Auto-enriches observation from canonical data and evaluates compliance on every new observation';


-- ============================================================================
-- SECTION 4: LAYER 4 - RESULT DELIVERY RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION get_observation_result(p_observation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_obs observations%ROWTYPE;
  v_zone zones%ROWTYPE;
  v_compliance compliance_results%ROWTYPE;
  v_result jsonb;
  v_requirements jsonb := '[]'::jsonb;
  v_overall_status text;
  v_summary text;
  v_action_required boolean;
  v_recommended_action text;
BEGIN
  -- Load observation
  SELECT * INTO v_obs FROM observations WHERE observation_id = p_observation_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Observation not found');
  END IF;
  
  -- Load zone
  SELECT * INTO v_zone FROM zones WHERE id = v_obs.zone_id;
  
  -- Load compliance result
  SELECT * INTO v_compliance 
  FROM compliance_results 
  WHERE observation_id = p_observation_id 
  ORDER BY evaluated_at DESC 
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Compliance result not yet available - evaluation in progress');
  END IF;
  
  -- Determine overall status
  IF v_compliance.is_homeless_exempt THEN
    v_overall_status := 'BREACH_EXEMPT';
    v_summary := 'Breach detected but eligible for homeless exemption';
    v_action_required := false;
    v_recommended_action := 'Refer to welfare services';
  ELSIF v_compliance.is_compliant THEN
    v_overall_status := 'COMPLIANT';
    v_summary := 'Vehicle is compliant with all zone requirements';
    v_action_required := false;
    v_recommended_action := 'No action required';
  ELSE
    v_overall_status := 'BREACH';
    v_summary := format('Breach: %s', array_to_string(v_compliance.violation_reasons, ', '));
    v_action_required := true;
    v_recommended_action := 'Issue warning or notice';
  END IF;
  
  -- Build requirements array from requirement_details JSON
  SELECT jsonb_agg(
    jsonb_build_object(
      'code', r.key,
      'label', CASE r.key
        WHEN 'self_contained' THEN 'Self-Contained Certified'
        WHEN 'consecutive_nights' THEN 'Consecutive Night Limit'
        WHEN 'monthly_stays' THEN 'Monthly Stay Limit'
        WHEN 'time_restrictions' THEN 'Time of Day'
        WHEN 'homeless_exemption' THEN 'Homeless Exemption'
      END,
      'status', r.value->>'status',
      'reason', r.value->>'reason',
      'color', CASE r.value->>'status'
        WHEN 'YES' THEN 'green'
        WHEN 'NO' THEN 'amber'
        WHEN 'BREACH' THEN 'red'
        WHEN 'EXEMPT' THEN 'purple'
      END
    )
  ) INTO v_requirements
  FROM jsonb_each(v_compliance.requirement_details) r;
  
  -- Build final result
  v_result := jsonb_build_object(
    'observation_id', p_observation_id,
    'plate_number', v_obs.plate_number,
    'zone_name', v_zone.name,
    'overall_status', v_overall_status,
    'action_required', v_action_required,
    'summary', v_summary,
    'requirements', COALESCE(v_requirements, '[]'::jsonb),
    'recommended_action', v_recommended_action
  );
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_observation_result(uuid) TO authenticated;

COMMENT ON FUNCTION get_observation_result(uuid) IS 
'Layer 4: Result Delivery - Returns compliance evaluation result formatted for Officer App display';


-- ============================================================================
-- SECTION 5: ZONE REQUIREMENTS BREAKDOWN RPC
-- ============================================================================

-- Reset prior signature before introducing a new row shape for this RPC.
DROP FUNCTION IF EXISTS public.evaluate_observation_requirements(uuid) CASCADE;

CREATE OR REPLACE FUNCTION evaluate_observation_requirements(p_observation_id uuid)
RETURNS TABLE (
  requirement_code text,
  requirement_label text,
  status text,
  reason text,
  color text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.key AS requirement_code,
    CASE r.key
      WHEN 'self_contained' THEN 'Self-Contained Certified'
      WHEN 'consecutive_nights' THEN 'Consecutive Night Limit'
      WHEN 'monthly_stays' THEN 'Monthly Stay Limit'
      WHEN 'time_restrictions' THEN 'Time of Day'
      WHEN 'homeless_exemption' THEN 'Homeless Exemption'
    END AS requirement_label,
    r.value->>'status' AS status,
    COALESCE(r.value->>'reason', '—') AS reason,
    CASE r.value->>'status'
      WHEN 'YES' THEN 'green'
      WHEN 'NO' THEN 'amber'
      WHEN 'BREACH' THEN 'red'
      WHEN 'EXEMPT' THEN 'purple'
      ELSE 'gray'
    END AS color
  FROM compliance_results cr,
       jsonb_each(cr.requirement_details) r
  WHERE cr.observation_id = p_observation_id
  ORDER BY 
    CASE r.key
      WHEN 'self_contained' THEN 1
      WHEN 'consecutive_nights' THEN 2
      WHEN 'monthly_stays' THEN 3
      WHEN 'time_restrictions' THEN 4
      WHEN 'homeless_exemption' THEN 5
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION evaluate_observation_requirements(uuid) TO authenticated;

COMMENT ON FUNCTION evaluate_observation_requirements(uuid) IS 
'Zone Requirements Breakdown - Returns per-requirement compliance status for observation detail views';


-- ============================================================================
-- SECTION 6: FROZEN KPI COHORT RPCS
-- ============================================================================

-- Cohort 1: Overstayers (consecutive nights OR monthly stays exceeded)
CREATE OR REPLACE FUNCTION cohort_overstayers(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (
  observation_id uuid,
  plate_number text,
  recorded_at timestamptz,
  zone_id uuid,
  zone_name text,
  violation_reasons text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT 
    obs.observation_id,
    obs.plate_number,
    obs.recorded_at,
    obs.zone_id,
    z.name AS zone_name,
    cr.violation_reasons
  FROM observations obs
  JOIN compliance_results cr ON cr.observation_id = obs.observation_id
  JOIN zones z ON z.id = obs.zone_id
  WHERE obs.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id IS NULL OR obs.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR obs.zone_id = p_zone_id)
    AND cr.is_compliant = FALSE
    AND (
      'consecutive_nights_exceeded' = ANY(cr.violation_reasons)
      OR 'monthly_stays_exceeded' = ANY(cr.violation_reasons)
    )
  ORDER BY obs.recorded_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION cohort_overstayers(timestamptz, timestamptz, uuid, uuid) TO authenticated;

-- Cohort 2: Homeless Exempt (breaches eligible for welfare pathway)
CREATE OR REPLACE FUNCTION cohort_homeless_exempt(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (
  observation_id uuid,
  plate_number text,
  recorded_at timestamptz,
  zone_id uuid,
  zone_name text,
  violation_reasons text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT 
    obs.observation_id,
    obs.plate_number,
    obs.recorded_at,
    obs.zone_id,
    z.name AS zone_name,
    cr.violation_reasons
  FROM observations obs
  JOIN compliance_results cr ON cr.observation_id = obs.observation_id
  JOIN zones z ON z.id = obs.zone_id
  WHERE obs.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id IS NULL OR obs.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR obs.zone_id = p_zone_id)
    AND cr.is_homeless_exempt = TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) TO authenticated;

-- Cohort 3: All Breaches (including homeless-exempt)
CREATE OR REPLACE FUNCTION cohort_all_breaches(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (
  observation_id uuid,
  plate_number text,
  recorded_at timestamptz,
  zone_id uuid,
  zone_name text,
  violation_reasons text[],
  is_homeless_exempt boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT 
    obs.observation_id,
    obs.plate_number,
    obs.recorded_at,
    obs.zone_id,
    z.name AS zone_name,
    cr.violation_reasons,
    cr.is_homeless_exempt
  FROM observations obs
  JOIN compliance_results cr ON cr.observation_id = obs.observation_id
  JOIN zones z ON z.id = obs.zone_id
  WHERE obs.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id IS NULL OR obs.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR obs.zone_id = p_zone_id)
    AND cr.is_compliant = FALSE
  ORDER BY obs.recorded_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION cohort_all_breaches(timestamptz, timestamptz, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION cohort_overstayers IS 'FROZEN API - Cohort 1: Vehicles exceeding consecutive or monthly stay limits';
COMMENT ON FUNCTION cohort_homeless_exempt IS 'FROZEN API - Cohort 2: Breaches eligible for homeless exemption';
COMMENT ON FUNCTION cohort_all_breaches IS 'FROZEN API - Cohort 3: All compliance breaches (including exempt)';


-- ============================================================================
-- SECTION 7: HISTORICAL RECOMPUTE RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION recompute_all_compliance_since_effective_date(p_effective_from date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_obs_count integer := 0;
  v_processed integer := 0;
  v_errors integer := 0;
  v_obs_record record;
BEGIN
  -- Count total observations to process
  SELECT COUNT(*) INTO v_obs_count
  FROM observations
  WHERE recorded_at >= (p_effective_from::timestamp AT TIME ZONE 'Pacific/Auckland');
  
  RAISE NOTICE 'Starting recomputation for % observations since %', v_obs_count, p_effective_from;
  
  -- Process in batches
  FOR v_obs_record IN 
    SELECT observation_id
    FROM observations
    WHERE recorded_at >= (p_effective_from::timestamp AT TIME ZONE 'Pacific/Auckland')
    ORDER BY recorded_at
  LOOP
    BEGIN
      -- Run compliance evaluation
      PERFORM evaluate_compliance_v4(v_obs_record.observation_id);
      
      -- Mark as analytics-only (historical backfill)
      UPDATE compliance_results 
      SET analytics_only = true 
      WHERE observation_id = v_obs_record.observation_id;
      
      v_processed := v_processed + 1;
      
      -- Progress logging every 100 records
      IF v_processed % 100 = 0 THEN
        RAISE NOTICE 'Processed % / % observations', v_processed, v_obs_count;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error processing observation %: %', v_obs_record.observation_id, SQLERRM;
      v_errors := v_errors + 1;
    END;
  END LOOP;
  
  RETURN jsonb_build_object(
    'total_observations', v_obs_count,
    'successfully_processed', v_processed,
    'errors', v_errors,
    'effective_from', p_effective_from
  );
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_all_compliance_since_effective_date(date) TO authenticated;

COMMENT ON FUNCTION recompute_all_compliance_since_effective_date(date) IS 
'Historical Recompute - Evaluates compliance for all observations since effective date; marks results as analytics_only';


-- ============================================================================
-- SECTION 8: ENFORCEMENT TABLES (Phase 4)
-- ============================================================================

CREATE TABLE IF NOT EXISTS enforcement_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid REFERENCES observations(observation_id) ON DELETE SET NULL,
  plate_number text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES zones(id) ON DELETE CASCADE,
  case_number text NOT NULL UNIQUE,
  case_status text NOT NULL DEFAULT 'open',
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  violation_summary text,
  evidence_snapshot jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enforcement_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES enforcement_cases(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_data jsonb,
  performed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  occurred_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS infringement_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES enforcement_cases(id) ON DELETE CASCADE,
  notice_number text NOT NULL UNIQUE,
  notice_type text NOT NULL,
  issued_to text,
  issue_date date NOT NULL,
  due_date date,
  amount_cents integer,
  pdf_url text,
  pdf_hash text,
  status text NOT NULL DEFAULT 'issued',
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_enforcement_cases_org ON enforcement_cases(organization_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_cases_plate ON enforcement_cases(plate_number);
CREATE INDEX IF NOT EXISTS idx_enforcement_case_events_case ON enforcement_case_events(case_id);
CREATE INDEX IF NOT EXISTS idx_infringement_notices_case ON infringement_notices(case_id);

-- RLS Policies
ALTER TABLE enforcement_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE enforcement_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE infringement_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_users_view_enforcement_cases
ON enforcement_cases FOR SELECT
USING (
  get_user_role(auth.uid()) = 'master' 
  OR organization_id = ANY(get_user_organization_ids())
);

CREATE POLICY admins_manage_enforcement_cases
ON enforcement_cases FOR ALL
USING (
  get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master'])
  AND (get_user_role(auth.uid()) = 'master' OR organization_id = get_user_organization_id(auth.uid()))
);

CREATE POLICY users_view_case_events
ON enforcement_case_events FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM enforcement_cases ec
    WHERE ec.id = enforcement_case_events.case_id
    AND (get_user_role(auth.uid()) = 'master' OR ec.organization_id = ANY(get_user_organization_ids()))
  )
);

CREATE POLICY users_view_infringement_notices
ON infringement_notices FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM enforcement_cases ec
    WHERE ec.id = infringement_notices.case_id
    AND (get_user_role(auth.uid()) = 'master' OR ec.organization_id = ANY(get_user_organization_ids()))
  )
);


-- ============================================================================
-- SECTION 9: PERSON CANONICAL TABLES (Phase 5)
-- ============================================================================

CREATE TABLE IF NOT EXISTS canonical_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  date_of_birth date,
  contact_email text,
  contact_phone text,
  address text,
  homeless_status text,
  homeless_confirmed_at timestamptz,
  homeless_confirmed_by uuid REFERENCES user_profiles(id),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS person_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES canonical_persons(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES zones(id) ON DELETE CASCADE,
  observed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL,
  gps_latitude numeric(10,8),
  gps_longitude numeric(11,8),
  notes text,
  attachments jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS person_vehicle_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES canonical_persons(id) ON DELETE CASCADE,
  plate_number text REFERENCES canonical_vehicles(plate_number) ON DELETE CASCADE,
  relationship_type text,
  confidence text,
  linked_at timestamptz DEFAULT now(),
  linked_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  UNIQUE(person_id, plate_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_canonical_persons_name ON canonical_persons(full_name);
CREATE INDEX IF NOT EXISTS idx_person_observations_person ON person_observations(person_id);
CREATE INDEX IF NOT EXISTS idx_person_vehicle_links_person ON person_vehicle_links(person_id);
CREATE INDEX IF NOT EXISTS idx_person_vehicle_links_plate ON person_vehicle_links(plate_number);

-- RLS Policies
ALTER TABLE canonical_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_vehicle_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY admins_manage_persons
ON canonical_persons FOR ALL
USING (get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master']));

CREATE POLICY users_view_person_observations
ON person_observations FOR SELECT
USING (
  get_user_role(auth.uid()) = 'master' 
  OR organization_id = ANY(get_user_organization_ids())
);

CREATE POLICY users_view_person_vehicle_links
ON person_vehicle_links FOR SELECT
USING (true);


-- ============================================================================
-- SECTION 10: INCIDENTS TABLES (Phase 5)
-- ============================================================================

-- Note: incidents table already exists from previous migrations
-- Adding incident_attachments if not exists

CREATE TABLE IF NOT EXISTS incident_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid REFERENCES incidents(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_hash text,
  uploaded_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_attachments_incident ON incident_attachments(incident_id);

ALTER TABLE incident_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_view_incident_attachments
ON incident_attachments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM incidents i
    WHERE i.id = incident_attachments.incident_id
    AND (get_user_role(auth.uid()) = 'master' OR i.organization_id = ANY(get_user_organization_ids()))
  )
);


-- ============================================================================
-- SECTION 11: SESSION MODE SWITCH AUDIT (Phase 3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS session_mode_switch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  from_mode text NOT NULL,
  to_mode text NOT NULL,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mode_switch_user ON session_mode_switch_log(user_id);
CREATE INDEX IF NOT EXISTS idx_mode_switch_occurred ON session_mode_switch_log(occurred_at DESC);

ALTER TABLE session_mode_switch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_view_own_mode_switches
ON session_mode_switch_log FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY users_log_own_mode_switches
ON session_mode_switch_log FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Mode switch logging function
CREATE OR REPLACE FUNCTION log_mode_switch(p_from_mode text, p_to_mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO session_mode_switch_log (user_id, from_mode, to_mode)
  VALUES (auth.uid(), p_from_mode, p_to_mode);
END;
$$;

GRANT EXECUTE ON FUNCTION log_mode_switch(text, text) TO authenticated;


-- ============================================================================
-- SECTION 12: UPDATE TRIGGERS
-- ============================================================================

-- Auto-update updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_enforcement_cases_updated_at ON enforcement_cases;
CREATE TRIGGER update_enforcement_cases_updated_at
BEFORE UPDATE ON enforcement_cases
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_canonical_persons_updated_at ON canonical_persons;
CREATE TRIGGER update_canonical_persons_updated_at
BEFORE UPDATE ON canonical_persons
FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- FINAL GRANTS AND COMMENTS
-- ============================================================================

-- Ensure all authenticated users can execute core RPCs
GRANT EXECUTE ON FUNCTION cohort_overstayers(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cohort_all_breaches(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION evaluate_observation_requirements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_observation_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION log_mode_switch(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION recompute_all_compliance_since_effective_date(date) TO authenticated;

COMMENT ON TABLE enforcement_cases IS 'Enforcement case management - Phase 4';
COMMENT ON TABLE enforcement_case_events IS 'Append-only audit trail for enforcement case lifecycle';
COMMENT ON TABLE infringement_notices IS 'Formal notices issued to vehicle owners - immutable evidence';
COMMENT ON TABLE canonical_persons IS 'Canonical person records - Phase 5';
COMMENT ON TABLE person_observations IS 'Field observations of persons (separate from vehicles)';
COMMENT ON TABLE person_vehicle_links IS 'Many-to-many relationships between persons and vehicles';
COMMENT ON TABLE session_mode_switch_log IS 'Audit trail for Admin↔Officer mode switches - Phase 3';

COMMIT;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Next steps:
-- 1. Verify all 5 core RPCs are callable: SELECT * FROM pg_proc WHERE proname LIKE 'cohort_%';
-- 2. Deploy plate-scanner-photo-first Edge Function (Layer 1)
-- 3. Enable feature flags for phased rollout
-- 4. Run acceptance tests (see supabase/acceptance-tests/phase-gates.sql)
-- ============================================================================
