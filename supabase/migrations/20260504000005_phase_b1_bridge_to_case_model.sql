-- B1 Lean: Link existing patrol infrastructure to case model + welfare tracking
-- This is a bridge migration that doesn't recreate existing patrol tables

CREATE TABLE IF NOT EXISTS public.patrol_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  route_name TEXT NOT NULL,
  route_code TEXT UNIQUE,
  description TEXT,

  route_type TEXT NOT NULL DEFAULT 'regular'
    CHECK (route_type IN ('regular', 'mobile', 'static', 'roving', 'response')),

  default_shift TEXT DEFAULT 'day' CHECK (default_shift IN ('day', 'swing', 'night')),
  default_start_time TIME,
  default_end_time TIME,
  expected_duration_minutes INTEGER,

  primary_zone_id UUID REFERENCES public.zones(id),
  secondary_zone_ids UUID[] DEFAULT '{}',
  client_site_ids UUID[] DEFAULT '{}',

  checkpoint_mode TEXT DEFAULT 'sequential'
    CHECK (checkpoint_mode IN ('sequential', 'any_order', 'random', 'none')),
  min_checkpoints_required INTEGER,

  active_days INTEGER[] DEFAULT '{1,2,3,4,5,6,7}',
  is_active BOOLEAN DEFAULT TRUE,

  color TEXT DEFAULT '#3B82F6',
  icon TEXT DEFAULT 'route',
  tags TEXT[] DEFAULT '{}',

  created_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patrol_routes_org
  ON public.patrol_routes(organization_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_patrol_routes_code
  ON public.patrol_routes(route_code) WHERE route_code IS NOT NULL;

COMMENT ON TABLE public.patrol_routes IS
  'Named patrol route templates with checkpoints, coverage, and default timing.';

CREATE TABLE IF NOT EXISTS public.patrol_route_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  roster_shift_id UUID REFERENCES public.roster_shifts(id) ON DELETE SET NULL,
  patrol_id UUID REFERENCES public.patrols(id) ON DELETE SET NULL,
  patrol_route_id UUID NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  officer_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  service_type TEXT CHECK (service_type IN (
    'freedom_camping', 'guarding', 'parking', 'noise',
    'patrol', 'alarm_response', 'ems', 'biosecurity_inspection', 'smoke_complaint_ooh'
  )),

  planning_mode TEXT NOT NULL DEFAULT 'baseline'
    CHECK (planning_mode IN ('baseline', 'randomized', 'dispatch_replan')),
  plan_status TEXT NOT NULL DEFAULT 'planned'
    CHECK (plan_status IN ('planned', 'in_progress', 'paused', 'completed', 'cancelled', 'superseded')),

  generation_seed BIGINT NOT NULL DEFAULT (extract(epoch from clock_timestamp()) * 1000)::BIGINT,
  generation_context JSONB NOT NULL DEFAULT '{}'::jsonb,

  planned_start_time TIMESTAMPTZ,
  planned_end_time TIMESTAMPTZ,
  predicted_duration_minutes INTEGER,

  actual_start_time TIMESTAMPTZ,
  actual_end_time TIMESTAMPTZ,
  actual_duration_minutes INTEGER,

  bob_plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  bob_confidence NUMERIC(4,3),

  dispatch_interruptions_count INTEGER NOT NULL DEFAULT 0,
  last_replanned_at TIMESTAMPTZ,

  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patrol_route_instances_org
  ON public.patrol_route_instances(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patrol_route_instances_route
  ON public.patrol_route_instances(patrol_route_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patrol_route_instances_status
  ON public.patrol_route_instances(plan_status, planned_start_time);
CREATE INDEX IF NOT EXISTS idx_patrol_route_instances_roster
  ON public.patrol_route_instances(roster_shift_id)
  WHERE roster_shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patrol_route_instances_patrol
  ON public.patrol_route_instances(patrol_id)
  WHERE patrol_id IS NOT NULL;

COMMENT ON TABLE public.patrol_route_instances IS
  'Generated patrol route plan instances linked to a roster shift or active patrol.';

-- Add case_id reference to existing patrol_route_instances
ALTER TABLE IF EXISTS public.patrol_route_instances 
ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patrol_route_instances_case_id 
  ON public.patrol_route_instances(case_id);

-- Welfare events (lightweight, per patrol session)
CREATE TABLE IF NOT EXISTS public.welfare_events_b1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  patrol_route_instance_id UUID REFERENCES public.patrol_route_instances(id) ON DELETE CASCADE,
  officer_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL DEFAULT 'scheduled_checkin'
    CHECK (event_type IN ('scheduled_checkin', 'officer_initiated', 'supervisor_alert', 'missed_checkin', 'emergency_alert')),
  severity TEXT DEFAULT 'routine' CHECK (severity IN ('routine', 'yellow_flag', 'red_flag', 'emergency')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.welfare_events_b1 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_read_own_org_welfare_b1" ON public.welfare_events_b1;
CREATE POLICY "users_read_own_org_welfare_b1" ON public.welfare_events_b1 FOR SELECT USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_welfare_events_b1_org_severity ON public.welfare_events_b1(organization_id, severity, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.welfare_events_b1 TO authenticated;

-- Patrol session events (checkpoint scans + progress)
CREATE TABLE IF NOT EXISTS public.patrol_session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  patrol_route_instance_id UUID REFERENCES public.patrol_route_instances(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'checkpoint_scan'
    CHECK (event_type IN ('patrol_started', 'checkpoint_scan', 'checkpoint_missed', 'patrol_completed')),
  officer_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  checkpoint_name TEXT,
  location GEOGRAPHY(POINT),
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.patrol_session_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_read_own_org_patrol_events_b1" ON public.patrol_session_events;
CREATE POLICY "users_read_own_org_patrol_events_b1" ON public.patrol_session_events FOR SELECT USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_patrol_session_events_instance ON public.patrol_session_events(patrol_route_instance_id, event_time DESC);
GRANT SELECT, INSERT ON public.patrol_session_events TO authenticated;

-- End of B1 bridge migration
