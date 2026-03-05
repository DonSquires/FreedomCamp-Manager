-- =====================================================
-- INVESTIGATION JOB TEMPLATES & MOBILE COMPLETION
-- =====================================================
-- Add job templates and mobile completion workflow support
-- =====================================================

-- =====================================================
-- STEP 1: Add template support and completion fields
-- =====================================================

ALTER TABLE investigation_jobs
  ADD COLUMN IF NOT EXISTS template_used TEXT,
  ADD COLUMN IF NOT EXISTS completion_photos TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS completion_summary TEXT,
  ADD COLUMN IF NOT EXISTS quick_completion BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN investigation_jobs.template_used IS 'Job template that was used (homeless_occupation, abandoned_vehicle, etc)';
COMMENT ON COLUMN investigation_jobs.completion_photos IS 'Photos uploaded during mobile completion';
COMMENT ON COLUMN investigation_jobs.completion_summary IS 'Quick summary from mobile completion';
COMMENT ON COLUMN investigation_jobs.quick_completion IS 'Whether job was completed via mobile quick workflow';

-- =====================================================
-- STEP 2: Job templates table (for customization)
-- =====================================================

CREATE TABLE IF NOT EXISTS investigation_job_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  template_name TEXT NOT NULL,
  job_type TEXT NOT NULL,
  default_priority TEXT DEFAULT 'medium',
  default_instructions TEXT,
  default_briefing_notes TEXT,
  custom_fields JSONB DEFAULT '[]'::JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT nz_now(),
  updated_at TIMESTAMPTZ DEFAULT nz_now(),
  UNIQUE(organization_id, template_key)
);

CREATE INDEX idx_job_templates_org ON investigation_job_templates(organization_id);
CREATE INDEX idx_job_templates_key ON investigation_job_templates(template_key);

COMMENT ON TABLE investigation_job_templates IS 'Customizable job templates per organization';

-- Insert default templates
INSERT INTO investigation_job_templates (organization_id, template_key, template_name, job_type, default_priority, default_instructions, default_briefing_notes)
VALUES
  (NULL, 'homeless_occupation', 'Homeless Occupation Investigation', 'homeless_occupation', 'medium',
   'Please visit the site and obtain up-to-date photographs showing: 1) Overall site layout, 2) Any structures/tents, 3) Vehicle registration plates if present, 4) Any hazards. Document number of people if present.',
   'Standard homeless occupation investigation - verify current status and assess any health/safety risks.'),
  
  (NULL, 'abandoned_vehicle', 'Abandoned Vehicle Check', 'abandoned_vehicle', 'medium',
   'Please verify vehicle is still present, photograph from all angles including: 1) Front/rear plates, 2) Interior condition, 3) Any damage, 4) Accumulation indicators (dust, flat tires). Note: DO NOT approach if vehicle appears occupied.',
   'Verify abandoned vehicle status - look for signs of recent use, dust accumulation, flat tires, expired WOF/rego.'),
  
  (NULL, 'unauthorized_structure', 'Unauthorized Structure Assessment', 'unauthorized_structure', 'high',
   'Document structure type, dimensions, and assess public safety risks. Photograph from multiple angles. Note materials used, proximity to public areas, and any hazards.',
   'Assess unauthorized structure - check building consent requirements and public safety concerns.'),
  
  (NULL, 'noise_complaint', 'Noise Complaint Investigation', 'noise_complaint', 'medium',
   'Investigate noise complaint at specified location. Document time of visit, noise level assessment, and any sources identified. Speak with complainant if available.',
   'Noise complaint investigation - verify current status and identify sources.'),
  
  (NULL, 'welfare_check', 'Welfare Check', 'welfare_check', 'high',
   'Conduct welfare check on individual(s) at specified location. Assess safety, health concerns, and any immediate needs. Do NOT enter private property without permission.',
   'Welfare check - prioritize safety and wellbeing assessment.')
ON CONFLICT (organization_id, template_key) DO NOTHING;

-- =====================================================
-- STEP 3: Quick completion function
-- =====================================================

CREATE OR REPLACE FUNCTION quick_complete_investigation_job(
  p_job_id UUID,
  p_completion_summary TEXT,
  p_vehicles_found TEXT DEFAULT NULL,
  p_structures_found TEXT DEFAULT NULL,
  p_photo_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_follow_up_required BOOLEAN DEFAULT FALSE,
  p_follow_up_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_finding_id UUID;
  v_result JSONB;
BEGIN
  -- Get current user
  SELECT auth.uid() INTO v_user_id;
  
  -- Create investigation finding
  INSERT INTO investigation_findings (
    job_id,
    visit_date,
    arrived_at,
    departed_at,
    findings_summary,
    vehicles_found,
    structures_found,
    evidence_photos,
    follow_up_required,
    follow_up_notes,
    completed_by,
    completed_at
  ) VALUES (
    p_job_id,
    nz_now(),
    nz_now(),
    nz_now(),
    p_completion_summary,
    p_vehicles_found,
    p_structures_found,
    p_photo_urls,
    p_follow_up_required,
    p_follow_up_notes,
    v_user_id,
    nz_now()
  ) RETURNING id INTO v_finding_id;
  
  -- Update job status
  UPDATE investigation_jobs
  SET
    status = 'completed',
    completed_at = nz_now(),
    completed_by = v_user_id,
    completion_summary = p_completion_summary,
    completion_photos = p_photo_urls,
    quick_completion = TRUE,
    updated_at = nz_now()
  WHERE id = p_job_id;
  
  -- Return result
  RETURN jsonb_build_object(
    'success', TRUE,
    'job_id', p_job_id,
    'finding_id', v_finding_id,
    'message', 'Investigation completed successfully'
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', FALSE,
    'error', SQLERRM
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION quick_complete_investigation_job IS 'Quick mobile completion workflow for investigation jobs';

GRANT EXECUTE ON FUNCTION quick_complete_investigation_job TO authenticated;

-- =====================================================
-- STEP 4: Get officer's assigned jobs
-- =====================================================

CREATE OR REPLACE FUNCTION get_officer_investigation_jobs(p_officer_id UUID)
RETURNS TABLE (
  job_id UUID,
  reference_number TEXT,
  job_type TEXT,
  location_address TEXT,
  property_details TEXT,
  instructions TEXT,
  briefing_notes TEXT,
  priority TEXT,
  due_date DATE,
  status TEXT,
  template_used TEXT,
  gps_latitude NUMERIC,
  gps_longitude NUMERIC,
  assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ij.id AS job_id,
    ij.reference_number,
    ij.job_type,
    ij.location_address,
    ij.property_details,
    ij.instructions,
    ij.briefing_notes,
    ij.priority,
    ij.due_date,
    ij.status,
    ij.template_used,
    ij.gps_latitude,
    ij.gps_longitude,
    ij.assigned_at,
    ij.created_at
  FROM investigation_jobs ij
  WHERE ij.assigned_to = p_officer_id
    AND ij.status IN ('pending', 'assigned', 'in_progress')
  ORDER BY
    CASE ij.priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    ij.due_date ASC NULLS LAST,
    ij.created_at ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_officer_investigation_jobs IS 'Get all active investigation jobs for officer (mobile view)';

GRANT EXECUTE ON FUNCTION get_officer_investigation_jobs TO authenticated;

-- =====================================================
-- STEP 5: Update trigger
-- =====================================================

CREATE OR REPLACE FUNCTION update_investigation_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := nz_now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_investigation_jobs_updated_at ON investigation_jobs;
CREATE TRIGGER trigger_update_investigation_jobs_updated_at
  BEFORE UPDATE ON investigation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_investigation_jobs_updated_at();

-- Migration summary
DO $$
DECLARE
  v_template_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_template_count FROM investigation_job_templates;
  
  RAISE NOTICE '✅ Investigation Job Templates & Mobile Completion Complete';
  RAISE NOTICE '   - Added template support fields';
  RAISE NOTICE '   - Added mobile completion fields';
  RAISE NOTICE '   - Created investigation_job_templates table';
  RAISE NOTICE '   - Inserted % default templates', v_template_count;
  RAISE NOTICE '   - Created quick_complete_investigation_job() function';
  RAISE NOTICE '   - Created get_officer_investigation_jobs() function';
  RAISE NOTICE '';
  RAISE NOTICE '   📱 Mobile Features:';
  RAISE NOTICE '      - Job templates for quick creation';
  RAISE NOTICE '      - Quick completion workflow';
  RAISE NOTICE '      - Photo upload during completion';
  RAISE NOTICE '      - Automatic status updates';
END $$;
