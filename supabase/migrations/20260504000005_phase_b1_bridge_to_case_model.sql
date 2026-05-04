-- B1 Lean: Link existing patrol infrastructure to case model + welfare tracking
-- This is a bridge migration that doesn't recreate existing patrol tables

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
