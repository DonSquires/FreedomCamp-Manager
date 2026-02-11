-- Investigation Job Enhancements
-- Add job types management, associations, and flexible follow-up schedules

-- Create job types table for admin-configurable investigation categories
CREATE TABLE IF NOT EXISTS public.investigation_job_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES public.user_profiles(id),
  UNIQUE (organization_id, name)
);

-- Insert system default job types (null organization_id = global)
INSERT INTO public.investigation_job_types (name, description, is_system_default, is_active, organization_id) VALUES
  ('Aggressive Behaviour', 'Incidents involving threatening or abusive conduct', true, true, null),
  ('Homeless Occupation', 'Homeless individuals or groups occupying public or private land', true, true, null),
  ('Unlawful Occupation', 'Unauthorized occupation of property or land', true, true, null),
  ('Health & Safety', 'Health and safety concerns requiring investigation', true, true, null),
  ('Maintenance', 'Property maintenance or infrastructure issues', true, true, null),
  ('Abandoned Vehicle', 'Abandoned or derelict vehicles requiring removal', true, true, null),
  ('Unauthorized Structure', 'Illegal structures or encampments', true, true, null),
  ('Other', 'Miscellaneous investigations not covered by other categories', true, true, null)
ON CONFLICT (organization_id, name) DO NOTHING;

-- Add associations and follow-up schedule to investigation_jobs table
ALTER TABLE public.investigation_jobs
  ADD COLUMN IF NOT EXISTS associated_vehicle_id UUID REFERENCES public.canonical_vehicles(vehicle_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS associated_person_id UUID REFERENCES public.person_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS associated_zone_id UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS associated_observation_id UUID REFERENCES public.vehicle_observations(observation_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS followup_days INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS followup_notes TEXT;

-- Add comment explaining followup_days
COMMENT ON COLUMN public.investigation_jobs.followup_days IS 'Number of days between required follow-up reports (1 = daily, 7 = weekly, etc.)';

-- Index for job type lookups
CREATE INDEX IF NOT EXISTS idx_investigation_job_types_org ON public.investigation_job_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_investigation_job_types_active ON public.investigation_job_types(is_active);

-- Index for association lookups
CREATE INDEX IF NOT EXISTS idx_investigation_jobs_vehicle ON public.investigation_jobs(associated_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_investigation_jobs_person ON public.investigation_jobs(associated_person_id);
CREATE INDEX IF NOT EXISTS idx_investigation_jobs_zone ON public.investigation_jobs(associated_zone_id);
CREATE INDEX IF NOT EXISTS idx_investigation_jobs_observation ON public.investigation_jobs(associated_observation_id);

-- RLS Policies for job types
ALTER TABLE public.investigation_job_types ENABLE ROW LEVEL SECURITY;

-- Admins can view all job types (system defaults + their org's custom types)
CREATE POLICY admins_view_job_types ON public.investigation_job_types
  FOR SELECT
  USING (
    (is_system_default = true) OR
    (organization_id = get_user_organization_id(auth.uid())) OR
    (get_user_role(auth.uid()) = 'master')
  );

-- Admins can create custom job types for their organization
CREATE POLICY admins_create_job_types ON public.investigation_job_types
  FOR INSERT
  WITH CHECK (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'master'])) AND
    ((get_user_role(auth.uid()) = 'master') OR (organization_id = get_user_organization_id(auth.uid())))
  );

-- Admins can update their own org's custom job types (not system defaults)
CREATE POLICY admins_update_job_types ON public.investigation_job_types
  FOR UPDATE
  USING (
    (is_system_default = false) AND
    (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'master'])) AND
    ((get_user_role(auth.uid()) = 'master') OR (organization_id = get_user_organization_id(auth.uid())))
  );

-- Function to get available job types for user
CREATE OR REPLACE FUNCTION get_available_job_types(user_org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  is_custom BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT 
    jt.id,
    jt.name,
    jt.description,
    NOT jt.is_system_default AS is_custom
  FROM investigation_job_types jt
  WHERE 
    jt.is_active = true AND
    (jt.is_system_default = true OR jt.organization_id = user_org_id)
  ORDER BY jt.is_system_default DESC, jt.name;
END;
$$;
