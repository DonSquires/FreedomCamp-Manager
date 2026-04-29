-- =============================================================================
-- Migration: Dispatch Replan RPC
-- When a dispatch job is assigned to an officer who has an active patrol route
-- instance, this RPC pauses the current route instance, generates a fresh
-- dispatch_replan instance (reduced, priority-sorted stops), and links the
-- dispatch job to it via route_instance_id.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.replan_route_on_dispatch(
  p_dispatch_job_id UUID,
  p_replanned_by    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job              RECORD;
  v_active_instance  RECORD;
  v_route            RECORD;
  v_org_id           UUID;
  v_new_instance_id  UUID;
  v_remaining_stops  RECORD;
  v_seq              INTEGER := 1;
  v_base_time        TIMESTAMPTZ;
  v_gap_mins         INTEGER;
  v_n                INTEGER;
BEGIN
  -- ── Load dispatch job ────────────────────────────────────────────────────
  SELECT id, organization_id, assigned_to, status, job_type, title,
         client_site_id, zone_id, created_at
  INTO v_job
  FROM public.dispatch_jobs
  WHERE id = p_dispatch_job_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','dispatch_job not found');
  END IF;

  IF v_job.assigned_to IS NULL THEN
    RETURN jsonb_build_object('status','skipped','message','job has no assigned officer');
  END IF;

  v_org_id := v_job.organization_id;

  -- ── Find active patrol route instance for this officer ───────────────────
  SELECT pri.*
  INTO v_active_instance
  FROM public.patrol_route_instances pri
  JOIN public.roster_shifts rs ON rs.id = pri.roster_shift_id
  WHERE pri.officer_id   = v_job.assigned_to
    AND pri.plan_status  IN ('planned', 'in_progress')
    AND pri.organization_id = v_org_id
  ORDER BY pri.planned_start_time DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- No active route instance — link job to null, return gracefully
    UPDATE public.dispatch_jobs
    SET route_instance_id = NULL
    WHERE id = p_dispatch_job_id;

    RETURN jsonb_build_object(
      'status',  'no_active_route',
      'message', 'Officer has no active patrol route instance to replan'
    );
  END IF;

  -- ── Pause the current instance ───────────────────────────────────────────
  UPDATE public.patrol_route_instances
  SET plan_status = 'paused', updated_at = NOW()
  WHERE id = v_active_instance.id;

  -- ── Load route for metadata ───────────────────────────────────────────────
  SELECT * INTO v_route
  FROM public.patrol_routes
  WHERE id = v_active_instance.patrol_route_id;

  -- ── Count pending stops remaining in paused instance ─────────────────────
  SELECT COUNT(*)::INTEGER INTO v_n
  FROM public.patrol_route_instance_stops
  WHERE route_instance_id = v_active_instance.id
    AND visit_status = 'pending';

  -- ── Create new dispatch_replan route instance ────────────────────────────
  v_base_time := NOW();

  INSERT INTO public.patrol_route_instances (
    organization_id,
    roster_shift_id,
    patrol_route_id,
    officer_id,
    planning_mode,
    plan_status,
    planned_start_time,
    planned_end_time,
    predicted_duration_minutes,
    created_by
  ) VALUES (
    v_org_id,
    v_active_instance.roster_shift_id,
    v_active_instance.patrol_route_id,
    v_job.assigned_to,
    'dispatch_replan',
    'planned',
    v_base_time,
    -- Estimate 1h for the dispatch response, then resume
    v_base_time + INTERVAL '1 hour',
    60,
    COALESCE(p_replanned_by, v_job.assigned_to)
  )
  RETURNING id INTO v_new_instance_id;

  -- ── Copy pending stops into new replan instance (priority: mandatory first) ─
  v_gap_mins := CASE WHEN v_n > 0 THEN 60 / v_n ELSE 15 END;

  FOR v_remaining_stops IN
    SELECT s.checkpoint_id, s.zone_id, s.stop_name, s.is_mandatory, s.sequence_no
    FROM public.patrol_route_instance_stops s
    WHERE s.route_instance_id = v_active_instance.id
      AND s.visit_status = 'pending'
    ORDER BY s.is_mandatory DESC, s.sequence_no
  LOOP
    INSERT INTO public.patrol_route_instance_stops (
      organization_id,
      route_instance_id,
      checkpoint_id,
      zone_id,
      stop_name,
      is_mandatory,
      sequence_no,
      planned_arrival_window_start,
      planned_arrival_window_end,
      visit_status
    ) VALUES (
      v_org_id,
      v_new_instance_id,
      v_remaining_stops.checkpoint_id,
      v_remaining_stops.zone_id,
      v_remaining_stops.stop_name,
      v_remaining_stops.is_mandatory,
      v_seq,
      v_base_time + ((v_seq - 1) * v_gap_mins || ' minutes')::INTERVAL,
      v_base_time + (v_seq * v_gap_mins || ' minutes')::INTERVAL,
      'pending'
    );
    v_seq := v_seq + 1;
  END LOOP;

  -- ── Link dispatch job → new route instance ───────────────────────────────
  UPDATE public.dispatch_jobs
  SET route_instance_id = v_new_instance_id
  WHERE id = p_dispatch_job_id;

  RETURN jsonb_build_object(
    'status',               'replanned',
    'paused_instance_id',   v_active_instance.id,
    'new_instance_id',      v_new_instance_id,
    'stops_carried_over',   v_seq - 1,
    'planning_mode',        'dispatch_replan',
    'source',               'replan_route_on_dispatch'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','error','message',SQLERRM,'sqlstate',SQLSTATE);
END;
$$;

COMMENT ON FUNCTION public.replan_route_on_dispatch(UUID, UUID) IS
  'Pauses the officer''s active patrol route instance when a dispatch job is assigned,
   creates a dispatch_replan instance with remaining pending stops (mandatory-first),
   and links dispatch_job.route_instance_id to the new instance.';

GRANT EXECUTE ON FUNCTION public.replan_route_on_dispatch(UUID, UUID) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ replan_route_on_dispatch RPC created';
END;
$$;
