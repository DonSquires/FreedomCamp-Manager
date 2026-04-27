-- =============================================================================
-- Migration: Dispatch Completion + Route Resume RPC
-- Completes a dispatch job and closes the dispatch_replan route instance,
-- then resumes a paused baseline route instance for the same officer when found.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.complete_dispatch_job_and_resume_route(
  p_dispatch_job_id UUID,
  p_completed_by    UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_id            UUID := COALESCE(p_completed_by, auth.uid());
  v_job                 RECORD;
  v_dispatch_instance   RECORD;
  v_resume_instance_id  UUID;
  v_open_stops          INTEGER := 0;
  v_resumed_status      TEXT;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Authentication required');
  END IF;

  SELECT id, organization_id, assigned_to, route_instance_id, status
    INTO v_job
  FROM public.dispatch_jobs
  WHERE id = p_dispatch_job_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'dispatch_job not found');
  END IF;

  IF v_job.assigned_to IS NOT NULL AND v_job.assigned_to <> v_actor_id THEN
    RETURN jsonb_build_object('status', 'forbidden', 'message', 'Only the assigned officer can complete this job');
  END IF;

  UPDATE public.dispatch_jobs
  SET status = 'completed',
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW()
  WHERE id = p_dispatch_job_id;

  IF v_job.route_instance_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'completed_no_route',
      'dispatch_job_id', p_dispatch_job_id,
      'message', 'Dispatch job completed (no linked route instance)'
    );
  END IF;

  SELECT id, organization_id, officer_id, roster_shift_id, planning_mode
    INTO v_dispatch_instance
  FROM public.patrol_route_instances
  WHERE id = v_job.route_instance_id;

  IF FOUND THEN
    UPDATE public.patrol_route_instances
    SET plan_status = 'completed',
        actual_end_time = COALESCE(actual_end_time, NOW()),
        updated_at = NOW()
    WHERE id = v_dispatch_instance.id
      AND plan_status IN ('planned', 'in_progress', 'paused');

    SELECT pri.id
      INTO v_resume_instance_id
    FROM public.patrol_route_instances pri
    WHERE pri.organization_id = v_job.organization_id
      AND pri.officer_id = COALESCE(v_job.assigned_to, v_dispatch_instance.officer_id)
      AND pri.id <> v_dispatch_instance.id
      AND pri.plan_status = 'paused'
      AND (
        v_dispatch_instance.roster_shift_id IS NULL
        OR pri.roster_shift_id = v_dispatch_instance.roster_shift_id
      )
    ORDER BY pri.updated_at DESC, pri.planned_start_time DESC NULLS LAST
    LIMIT 1;

    IF v_resume_instance_id IS NOT NULL THEN
      SELECT COUNT(*)::INTEGER
        INTO v_open_stops
      FROM public.patrol_route_instance_stops s
      WHERE s.route_instance_id = v_resume_instance_id
        AND s.visit_status IN ('pending', 'arrived');

      v_resumed_status := CASE WHEN v_open_stops > 0 THEN 'in_progress' ELSE 'completed' END;

      UPDATE public.patrol_route_instances
      SET plan_status = v_resumed_status,
          actual_end_time = CASE
            WHEN v_open_stops > 0 THEN actual_end_time
            ELSE COALESCE(actual_end_time, NOW())
          END,
          last_replanned_at = NOW(),
          updated_at = NOW()
      WHERE id = v_resume_instance_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'completed',
    'dispatch_job_id', p_dispatch_job_id,
    'completed_route_instance_id', v_job.route_instance_id,
    'resumed_instance_id', v_resume_instance_id,
    'resumed_status', v_resumed_status,
    'message', CASE
      WHEN v_resume_instance_id IS NOT NULL THEN 'Dispatch completed and paused route resumed'
      ELSE 'Dispatch completed'
    END
  );
END;
$$;

COMMENT ON FUNCTION public.complete_dispatch_job_and_resume_route(UUID, UUID) IS
  'Completes a dispatch job, marks linked dispatch_replan route instance completed, and resumes a paused route instance for the same officer when available.';

GRANT EXECUTE ON FUNCTION public.complete_dispatch_job_and_resume_route(UUID, UUID) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ complete_dispatch_job_and_resume_route RPC created';
END $$;
