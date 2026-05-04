-- Migration: Unified Case Model for Operational Timeline
-- Date: 2026-05-04
-- Purpose: Create central operational_cases table linking patrol, dispatch, and enforcement events
--          Enable single unified timeline view across all operational activities per organization

-- ============================================================================
-- PART 1: Operational Cases Table (Central Hub)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.operational_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Case identity
  case_type TEXT NOT NULL DEFAULT 'dispatch'
    CHECK (case_type IN ('dispatch', 'patrol', 'enforcement', 'investigation', 'audit')),
  case_number TEXT UNIQUE,
  
  -- Primary dispatch job (if dispatch-originated)
  dispatch_job_id UUID REFERENCES public.dispatch_jobs(id) ON DELETE SET NULL,
  
  -- Primary source of case creation
  created_from TEXT NOT NULL DEFAULT 'dispatch'
    CHECK (created_from IN ('dispatch', 'patrol', 'breach', 'observation', 'manual')),
  
  -- Timeline tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  
  -- Current state
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending_review', 'completed', 'archived', 'cancelled')),
  
  -- Metadata
  title TEXT,
  summary TEXT,
  officer_notes TEXT,
  
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

-- RLS: Enable row level security
ALTER TABLE public.operational_cases ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only read cases from their organization
DROP POLICY IF EXISTS "users_read_own_org_cases" ON public.operational_cases;
CREATE POLICY "users_read_own_org_cases" ON public.operational_cases
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- RLS Policy: Users can insert/update cases for their organization (with role check handled by app)
DROP POLICY IF EXISTS "users_manage_own_org_cases" ON public.operational_cases;
CREATE POLICY "users_manage_own_org_cases" ON public.operational_cases
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_operational_cases_org_status
  ON public.operational_cases(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_cases_dispatch_job
  ON public.operational_cases(dispatch_job_id);

CREATE INDEX IF NOT EXISTS idx_operational_cases_created_by
  ON public.operational_cases(created_by);

COMMENT ON TABLE public.operational_cases IS
  'Central hub linking patrol events, dispatch jobs, and enforcement activities into unified timeline per org';

-- ============================================================================
-- PART 2: Patrol Events Table (Event Family 1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patrol_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  
  -- Patrol context
  officer_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  zone_id UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  patrol_type TEXT DEFAULT 'routine'
    CHECK (patrol_type IN ('routine', 'response', 'follow_up', 'surveillance', 'escort')),
  
  -- Event lifecycle
  event_type TEXT NOT NULL DEFAULT 'patrol_start'
    CHECK (event_type IN ('patrol_start', 'patrol_location_update', 'patrol_observation', 'patrol_complete', 'patrol_cancelled')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled')),
  
  -- Event data
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  gps_lat DOUBLE PRECISION,
  gps_lng DOUBLE PRECISION,
  observation_text TEXT,
  photo_urls TEXT[],
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.patrol_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_org_patrol_events" ON public.patrol_events;
CREATE POLICY "users_read_own_org_patrol_events" ON public.patrol_events
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "users_manage_own_org_patrol_events" ON public.patrol_events;
CREATE POLICY "users_manage_own_org_patrol_events" ON public.patrol_events
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_patrol_events_case_id
  ON public.patrol_events(case_id);

CREATE INDEX IF NOT EXISTS idx_patrol_events_officer_org
  ON public.patrol_events(officer_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_patrol_events_org_timestamp
  ON public.patrol_events(organization_id, event_timestamp DESC);

COMMENT ON TABLE public.patrol_events IS 'Patrol activity events linked to operational cases';

-- ============================================================================
-- PART 3: Dispatch Events Table (Event Family 2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dispatch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  dispatch_job_id UUID NOT NULL REFERENCES public.dispatch_jobs(id) ON DELETE CASCADE,
  
  -- Dispatch event type
  event_type TEXT NOT NULL DEFAULT 'dispatch_created'
    CHECK (event_type IN (
      'dispatch_created', 'dispatch_assigned', 'dispatch_awaiting_ack',
      'dispatch_acknowledged', 'dispatch_en_route', 'dispatch_on_scene',
      'dispatch_completed', 'dispatch_cancelled', 'dispatch_escalated'
    )),
  
  -- Event lifecycle
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'acknowledged', 'processed')),
  
  -- Dispatch state at this event
  assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  status_at_event TEXT,
  escalation_level_at_event INTEGER DEFAULT 0,
  
  -- Metadata
  notes TEXT,
  triggered_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.dispatch_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_org_dispatch_events" ON public.dispatch_events;
CREATE POLICY "users_read_own_org_dispatch_events" ON public.dispatch_events
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "users_manage_own_org_dispatch_events" ON public.dispatch_events;
CREATE POLICY "users_manage_own_org_dispatch_events" ON public.dispatch_events
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_dispatch_events_case_id
  ON public.dispatch_events(case_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_events_dispatch_job
  ON public.dispatch_events(dispatch_job_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_events_org_timestamp
  ON public.dispatch_events(organization_id, event_timestamp DESC);

COMMENT ON TABLE public.dispatch_events IS 'Dispatch lifecycle state change events linked to operational cases';

-- ============================================================================
-- PART 4: Enforcement Events Table (Event Family 3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.enforcement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  
  -- Enforcement action type
  event_type TEXT NOT NULL DEFAULT 'enforcement_initiated'
    CHECK (event_type IN (
      'enforcement_initiated', 'enforcement_warning_issued',
      'enforcement_ticket_issued', 'enforcement_apprehension',
      'enforcement_completed', 'enforcement_cancelled'
    )),
  
  -- Event lifecycle
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled')),
  
  -- Enforcement context
  officer_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  subject_type TEXT, -- 'person', 'vehicle', 'site', 'activity'
  subject_identifier TEXT,
  
  -- Enforcement details
  violation_type TEXT,
  action_taken TEXT,
  outcome TEXT,
  
  -- Photos and evidence
  photo_urls TEXT[],
  evidence_notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.enforcement_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_org_enforcement_events" ON public.enforcement_events;
CREATE POLICY "users_read_own_org_enforcement_events" ON public.enforcement_events
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "users_manage_own_org_enforcement_events" ON public.enforcement_events;
CREATE POLICY "users_manage_own_org_enforcement_events" ON public.enforcement_events
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_enforcement_events_case_id
  ON public.enforcement_events(case_id);

CREATE INDEX IF NOT EXISTS idx_enforcement_events_officer_org
  ON public.enforcement_events(officer_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_enforcement_events_org_timestamp
  ON public.enforcement_events(organization_id, event_timestamp DESC);

COMMENT ON TABLE public.enforcement_events IS 'Enforcement action events linked to operational cases';

-- ============================================================================
-- PART 5: Audit Trail & Comments
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.case_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  
  -- Comment content
  comment_text TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.case_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_org_case_comments" ON public.case_comments;
CREATE POLICY "users_read_own_org_case_comments" ON public.case_comments
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "users_manage_own_org_case_comments" ON public.case_comments;
CREATE POLICY "users_manage_own_org_case_comments" ON public.case_comments
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_case_comments_case
  ON public.case_comments(case_id, created_at DESC);

-- ============================================================================
-- PART 6: Helper Function: Create Case from Dispatch Job
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_case_from_dispatch_job(
  dispatch_job_id UUID
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  case_id UUID;
  job_org_id UUID;
  job_number TEXT;
BEGIN
  -- Get dispatch job org and number
  SELECT organization_id, dispatch_jobs.job_number INTO job_org_id, job_number
  FROM public.dispatch_jobs
  WHERE id = dispatch_job_id;
  
  IF job_org_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch job % not found', dispatch_job_id;
  END IF;
  
  -- Create case
  INSERT INTO public.operational_cases (
    organization_id,
    case_type,
    case_number,
    dispatch_job_id,
    created_from,
    title,
    created_by
  )
  SELECT
    job_org_id,
    'dispatch',
    'CASE-' || job_number,
    dispatch_job_id,
    'dispatch',
    'Case for dispatch job ' || job_number,
    auth.uid()
  RETURNING operational_cases.id INTO case_id;
  
  -- Create initial dispatch event
  INSERT INTO public.dispatch_events (
    organization_id,
    case_id,
    dispatch_job_id,
    event_type,
    assigned_to,
    status_at_event,
    created_by
  )
  SELECT
    job_org_id,
    case_id,
    dispatch_job_id,
    'dispatch_created',
    assigned_to,
    status,
    auth.uid()
  FROM public.dispatch_jobs
  WHERE id = dispatch_job_id;
  
  RETURN case_id;
END; $$;

COMMENT ON FUNCTION public.create_case_from_dispatch_job(UUID) IS
  'Automatically create operational case and initial dispatch event from a dispatch job';

-- ============================================================================
-- PART 7: Grant permissions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operational_cases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patrol_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_comments TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_case_from_dispatch_job(UUID) TO authenticated;

-- ============================================================================
-- PART 8: Schema Documentation
-- ============================================================================

COMMENT ON SCHEMA public IS 'FieldOps Manager - Freedom Camping Enforcement & Field Operations Platform';

-- End of case model schema migration
-- Status: Phase A Week 1 Foundation
-- Approved by: Architecture Team
-- Date: 2026-05-04
