-- =============================================================================
-- Integrated Patrol + Alarm Response Foundations (Additive, Non-Breaking)
--
-- Goals:
-- 1) Link planned roster shifts to optional patrol routes.
-- 2) Introduce generated route instances and per-stop execution tracking.
-- 3) Provide an RPC to generate a route plan with controlled randomization.
--
-- This migration is additive and does not replace existing patrol/dispatch flows.
-- =============================================================================

-- 1) Roster can optionally point at a patrol route (pilot linkage)
ALTER TABLE public.roster_shifts
  ADD COLUMN IF NOT EXISTS patrol_route_id UUID
    REFERENCES public.patrol_routes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_roster_shifts_patrol_route
  ON public.roster_shifts(patrol_route_id)
  WHERE patrol_route_id IS NOT NULL;

COMMENT ON COLUMN public.roster_shifts.patrol_route_id IS
  'Optional pilot linkage to patrol_routes for route-aware roster planning.';

-- 2) Optional linkage from dispatch jobs to route instance for interruption/replan audit
ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS route_instance_id UUID;

COMMENT ON COLUMN public.dispatch_jobs.route_instance_id IS
  'Optional link to patrol_route_instances when an alarm/dispatch event interrupts or references an active route plan.';

-- 3) Route instance header (planned run for one shift/patrol)
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

-- 4) Route instance stops (ordered checkpoints/zones with windows + proof)
CREATE TABLE IF NOT EXISTS public.patrol_route_instance_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_instance_id UUID NOT NULL REFERENCES public.patrol_route_instances(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  checkpoint_id UUID REFERENCES public.patrol_route_checkpoints(id) ON DELETE SET NULL,
  zone_id UUID REFERENCES public.zones(id) ON DELETE SET NULL,

  stop_name TEXT NOT NULL,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  sequence_no INTEGER NOT NULL,

  travel_minutes_from_previous INTEGER,
  planned_arrival_window_start TIMESTAMPTZ,
  planned_arrival_window_end TIMESTAMPTZ,
  planned_dwell_minutes INTEGER,

  actual_arrival_at TIMESTAMPTZ,
  actual_departure_at TIMESTAMPTZ,

  visit_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (visit_status IN ('pending', 'arrived', 'completed', 'skipped', 'failed')),
  within_radius BOOLEAN,
  skip_reason TEXT,

  proof_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  proof_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (route_instance_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_patrol_route_instance_stops_instance
  ON public.patrol_route_instance_stops(route_instance_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_patrol_route_instance_stops_org
  ON public.patrol_route_instance_stops(organization_id, visit_status);
CREATE INDEX IF NOT EXISTS idx_patrol_route_instance_stops_checkpoint
  ON public.patrol_route_instance_stops(checkpoint_id)
  WHERE checkpoint_id IS NOT NULL;

COMMENT ON TABLE public.patrol_route_instance_stops IS
  'Stop-level execution record for each generated patrol route instance.';

-- 5) Add missing FK now that table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dispatch_jobs' AND column_name = 'route_instance_id'
  ) THEN
    BEGIN
      ALTER TABLE public.dispatch_jobs
        ADD CONSTRAINT dispatch_jobs_route_instance_id_fkey
        FOREIGN KEY (route_instance_id)
        REFERENCES public.patrol_route_instances(id)
        ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_route_instance
  ON public.dispatch_jobs(route_instance_id)
  WHERE route_instance_id IS NOT NULL;

-- 6) updated_at triggers
CREATE OR REPLACE FUNCTION public.update_patrol_route_instances_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patrol_route_instances_updated_at ON public.patrol_route_instances;
CREATE TRIGGER trg_patrol_route_instances_updated_at
  BEFORE UPDATE ON public.patrol_route_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_patrol_route_instances_updated_at();

CREATE OR REPLACE FUNCTION public.update_patrol_route_instance_stops_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patrol_route_instance_stops_updated_at ON public.patrol_route_instance_stops;
CREATE TRIGGER trg_patrol_route_instance_stops_updated_at
  BEFORE UPDATE ON public.patrol_route_instance_stops
  FOR EACH ROW EXECUTE FUNCTION public.update_patrol_route_instance_stops_updated_at();

-- 7) RLS
ALTER TABLE public.patrol_route_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrol_route_instance_stops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_read_patrol_route_instances" ON public.patrol_route_instances;
CREATE POLICY "org_members_read_patrol_route_instances"
  ON public.patrol_route_instances FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "admins_manage_patrol_route_instances" ON public.patrol_route_instances;
CREATE POLICY "admins_manage_patrol_route_instances"
  ON public.patrol_route_instances FOR ALL TO authenticated
  USING (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  )
  WITH CHECK (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  );

DROP POLICY IF EXISTS "officers_read_own_patrol_route_instances" ON public.patrol_route_instances;
CREATE POLICY "officers_read_own_patrol_route_instances"
  ON public.patrol_route_instances FOR SELECT TO authenticated
  USING (officer_id = auth.uid());

DROP POLICY IF EXISTS "officers_update_own_patrol_route_instances" ON public.patrol_route_instances;
CREATE POLICY "officers_update_own_patrol_route_instances"
  ON public.patrol_route_instances FOR UPDATE TO authenticated
  USING (officer_id = auth.uid());

DROP POLICY IF EXISTS "org_members_read_patrol_route_instance_stops" ON public.patrol_route_instance_stops;
CREATE POLICY "org_members_read_patrol_route_instance_stops"
  ON public.patrol_route_instance_stops FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "admins_manage_patrol_route_instance_stops" ON public.patrol_route_instance_stops;
CREATE POLICY "admins_manage_patrol_route_instance_stops"
  ON public.patrol_route_instance_stops FOR ALL TO authenticated
  USING (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  )
  WITH CHECK (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  );

DROP POLICY IF EXISTS "officers_update_own_patrol_route_instance_stops" ON public.patrol_route_instance_stops;
CREATE POLICY "officers_update_own_patrol_route_instance_stops"
  ON public.patrol_route_instance_stops FOR UPDATE TO authenticated
  USING (
    route_instance_id IN (
      SELECT pri.id
      FROM public.patrol_route_instances pri
      WHERE pri.officer_id = auth.uid()
    )
  );

-- 8) Plan-generation RPC (safe, explicit invocation)
CREATE OR REPLACE FUNCTION public.generate_patrol_route_instance(
  p_roster_shift_id UUID,
  p_force_regenerate BOOLEAN DEFAULT FALSE,
  p_created_by UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_shift RECORD;
  v_route RECORD;
  v_existing_id UUID;
  v_instance_id UUID;
  v_inserted_stops INTEGER := 0;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_duration_min INTEGER;
BEGIN
  SELECT rs.*
    INTO v_shift
  FROM public.roster_shifts rs
  WHERE rs.id = p_roster_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roster shift % not found', p_roster_shift_id;
  END IF;

  IF v_shift.patrol_route_id IS NULL THEN
    RAISE EXCEPTION 'Roster shift % has no patrol_route_id', p_roster_shift_id;
  END IF;

  SELECT pr.*
    INTO v_route
  FROM public.patrol_routes pr
  WHERE pr.id = v_shift.patrol_route_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patrol route % not found', v_shift.patrol_route_id;
  END IF;

  SELECT pri.id
    INTO v_existing_id
  FROM public.patrol_route_instances pri
  WHERE pri.roster_shift_id = p_roster_shift_id
    AND pri.plan_status IN ('planned', 'in_progress', 'paused')
  ORDER BY pri.created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL AND NOT p_force_regenerate THEN
    RETURN jsonb_build_object(
      'status', 'existing',
      'route_instance_id', v_existing_id
    );
  END IF;

  IF v_existing_id IS NOT NULL AND p_force_regenerate THEN
    UPDATE public.patrol_route_instances
      SET plan_status = 'superseded',
          updated_at = now()
    WHERE id = v_existing_id;
  END IF;

  v_start := COALESCE(v_shift.start_time, now());
  v_end := COALESCE(v_shift.end_time, v_start + interval '2 hours');
  v_duration_min := GREATEST(30, (extract(epoch from (v_end - v_start)) / 60)::INTEGER);

  INSERT INTO public.patrol_route_instances (
    organization_id,
    roster_shift_id,
    patrol_route_id,
    officer_id,
    service_type,
    planning_mode,
    plan_status,
    planned_start_time,
    planned_end_time,
    predicted_duration_minutes,
    generation_context,
    created_by
  )
  VALUES (
    v_shift.organization_id,
    v_shift.id,
    v_shift.patrol_route_id,
    v_shift.officer_id,
    v_shift.service_type,
    CASE WHEN v_route.checkpoint_mode IN ('any_order', 'random') THEN 'randomized' ELSE 'baseline' END,
    'planned',
    v_start,
    v_end,
    v_duration_min,
    jsonb_build_object(
      'checkpoint_mode', v_route.checkpoint_mode,
      'route_name', v_route.route_name,
      'source', 'generate_patrol_route_instance'
    ),
    p_created_by
  )
  RETURNING id INTO v_instance_id;

  -- Primary source: route checkpoints
  WITH checkpoint_source AS (
    SELECT
      prc.id AS checkpoint_id,
      prc.name AS stop_name,
      COALESCE(prc.is_mandatory, true) AS is_mandatory,
      COALESCE(prc.sequence_order, 0) AS sequence_order,
      COALESCE(prc.max_time_at_checkpoint_minutes, 10) AS dwell_minutes,
      v_route.primary_zone_id AS zone_id
    FROM public.patrol_route_checkpoints prc
    WHERE prc.patrol_route_id = v_shift.patrol_route_id
      AND COALESCE(prc.is_active, true)
  ),
  ordered AS (
    SELECT
      cs.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE
            WHEN v_route.checkpoint_mode = 'sequential' THEN cs.sequence_order::NUMERIC
            ELSE random() * 1000
          END,
          cs.sequence_order,
          random()
      ) AS seq,
      COUNT(*) OVER () AS total_count
    FROM checkpoint_source cs
  )
  INSERT INTO public.patrol_route_instance_stops (
    route_instance_id,
    organization_id,
    checkpoint_id,
    zone_id,
    stop_name,
    is_mandatory,
    sequence_no,
    planned_arrival_window_start,
    planned_arrival_window_end,
    planned_dwell_minutes,
    proof_requirements
  )
  SELECT
    v_instance_id,
    v_shift.organization_id,
    o.checkpoint_id,
    o.zone_id,
    o.stop_name,
    o.is_mandatory,
    o.seq,
    v_start + make_interval(mins => ((o.seq - 1) * v_duration_min / GREATEST(o.total_count, 1))),
    v_start + make_interval(mins => ((o.seq - 1) * v_duration_min / GREATEST(o.total_count, 1)) + 15),
    LEAST(GREATEST(o.dwell_minutes, 5), 45),
    CASE
      WHEN o.is_mandatory THEN '["gps","checkpoint_scan"]'::jsonb
      ELSE '["gps"]'::jsonb
    END
  FROM ordered o;

  GET DIAGNOSTICS v_inserted_stops = ROW_COUNT;

  -- Fallback source: route zones when no explicit checkpoints exist
  IF v_inserted_stops = 0 THEN
    WITH zone_source AS (
      SELECT
        prz.zone_id,
        z.name AS zone_name,
        ROW_NUMBER() OVER (ORDER BY COALESCE(prz.coverage_priority, 999), z.name) AS seq,
        COUNT(*) OVER () AS total_count
      FROM public.patrol_route_zones prz
      JOIN public.zones z ON z.id = prz.zone_id
      WHERE prz.patrol_route_id = v_shift.patrol_route_id
    )
    INSERT INTO public.patrol_route_instance_stops (
      route_instance_id,
      organization_id,
      checkpoint_id,
      zone_id,
      stop_name,
      is_mandatory,
      sequence_no,
      planned_arrival_window_start,
      planned_arrival_window_end,
      planned_dwell_minutes,
      proof_requirements
    )
    SELECT
      v_instance_id,
      v_shift.organization_id,
      NULL,
      zs.zone_id,
      'Zone Patrol: ' || zs.zone_name,
      true,
      zs.seq,
      v_start + make_interval(mins => ((zs.seq - 1) * v_duration_min / GREATEST(zs.total_count, 1))),
      v_start + make_interval(mins => ((zs.seq - 1) * v_duration_min / GREATEST(zs.total_count, 1)) + 20),
      20,
      '["gps"]'::jsonb
    FROM zone_source zs;

    GET DIAGNOSTICS v_inserted_stops = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'status', 'generated',
    'route_instance_id', v_instance_id,
    'stops_created', v_inserted_stops,
    'planning_mode', CASE WHEN v_route.checkpoint_mode IN ('any_order', 'random') THEN 'randomized' ELSE 'baseline' END
  );
END;
$$;

COMMENT ON FUNCTION public.generate_patrol_route_instance(UUID, BOOLEAN, UUID) IS
  'Generates a route instance from roster_shifts.patrol_route_id. Uses checkpoints first, then route zones as fallback. Additive planner RPC for pilot rollout.';

-- Ensure RPC is callable by authenticated users (policy still governs row access)
GRANT EXECUTE ON FUNCTION public.generate_patrol_route_instance(UUID, BOOLEAN, UUID) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Integrated patrol/alarm route foundations applied (additive)';
  RAISE NOTICE '✅ roster_shifts.patrol_route_id added';
  RAISE NOTICE '✅ patrol_route_instances + patrol_route_instance_stops created';
  RAISE NOTICE '✅ generate_patrol_route_instance RPC created';
END;
$$;
