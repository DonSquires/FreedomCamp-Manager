-- =============================================================================
-- Migration: Patrol Route Randomization Policy
-- Adds fine-grained anti-predictability controls to patrol_routes and
-- updates the generate_patrol_route_instance RPC to use them.
-- =============================================================================

-- ── 1. Add randomization policy columns to patrol_routes ──────────────────────

ALTER TABLE public.patrol_routes
  ADD COLUMN IF NOT EXISTS randomization_enabled   BOOLEAN    DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS jitter_window_minutes   SMALLINT   DEFAULT 15
    CHECK (jitter_window_minutes >= 0 AND jitter_window_minutes <= 120),
  ADD COLUMN IF NOT EXISTS min_dwell_seconds       SMALLINT   DEFAULT 30
    CHECK (min_dwell_seconds >= 0 AND min_dwell_seconds <= 600),
  ADD COLUMN IF NOT EXISTS max_dwell_seconds       SMALLINT   DEFAULT 120
    CHECK (max_dwell_seconds >= 0 AND max_dwell_seconds <= 1800),
  ADD COLUMN IF NOT EXISTS revisit_min_gap_minutes SMALLINT   DEFAULT 45
    CHECK (revisit_min_gap_minutes >= 0 AND revisit_min_gap_minutes <= 480),
  ADD COLUMN IF NOT EXISTS mandatory_first_stop    BOOLEAN    DEFAULT TRUE;

COMMENT ON COLUMN public.patrol_routes.randomization_enabled IS
  'When TRUE, generate_patrol_route_instance uses jitter and shuffled order.';
COMMENT ON COLUMN public.patrol_routes.jitter_window_minutes IS
  'Max ± minutes to shift each stop arrival window randomly.';
COMMENT ON COLUMN public.patrol_routes.min_dwell_seconds IS
  'Minimum seconds an officer must spend at each stop.';
COMMENT ON COLUMN public.patrol_routes.max_dwell_seconds IS
  'Maximum seconds allowed at each stop before an anomaly flag is triggered.';
COMMENT ON COLUMN public.patrol_routes.revisit_min_gap_minutes IS
  'Minimum gap before the same checkpoint can appear in consecutive route instances.';
COMMENT ON COLUMN public.patrol_routes.mandatory_first_stop IS
  'When TRUE, the base first checkpoint is fixed even when order is randomized.';

-- ── 2. Update generate_patrol_route_instance to use policy fields ─────────────

CREATE OR REPLACE FUNCTION public.generate_patrol_route_instance(
  p_roster_shift_id UUID,
  p_force_regenerate BOOLEAN DEFAULT FALSE,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift          RECORD;
  v_route          RECORD;
  v_org_id         UUID;
  v_instance_id    UUID;
  v_existing_id    UUID;
  v_stops          RECORD;
  v_seq            INTEGER := 1;
  v_base_time      TIMESTAMPTZ;
  v_window_start   TIMESTAMPTZ;
  v_window_end     TIMESTAMPTZ;
  v_jitter_secs    INTEGER;
  v_do_randomize   BOOLEAN;
  v_checkpoint_ids UUID[];
  v_zone_ids       UUID[];
  v_stop_names     TEXT[];
  v_mandatory_arr  BOOLEAN[];
  v_n              INTEGER;
  v_idx            INTEGER[];
  i                INTEGER;
BEGIN
  -- ── Load shift ────────────────────────────────────────────────────────────
  SELECT rs.*, r.patrol_route_id AS effective_route_id
  INTO v_shift
  FROM public.roster_shifts rs
  LEFT JOIN public.roster_shifts r ON r.id = rs.id
  WHERE rs.id = p_roster_shift_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'roster_shift not found');
  END IF;

  IF v_shift.patrol_route_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'roster_shift has no patrol_route_id');
  END IF;

  v_org_id := v_shift.organization_id;

  -- ── Load route + policy ───────────────────────────────────────────────────
  SELECT pr.*,
         COALESCE(pr.randomization_enabled, FALSE)   AS rand_enabled,
         COALESCE(pr.jitter_window_minutes, 15)       AS jitter_min,
         COALESCE(pr.mandatory_first_stop, TRUE)      AS fix_first
  INTO v_route
  FROM public.patrol_routes pr
  WHERE pr.id = v_shift.patrol_route_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'patrol_route not found');
  END IF;

  -- ── Check existing ────────────────────────────────────────────────────────
  SELECT id INTO v_existing_id
  FROM public.patrol_route_instances
  WHERE roster_shift_id = p_roster_shift_id
    AND plan_status NOT IN ('cancelled', 'superseded')
  LIMIT 1;

  IF v_existing_id IS NOT NULL AND NOT p_force_regenerate THEN
    RETURN jsonb_build_object(
      'status', 'existing',
      'route_instance_id', v_existing_id
    );
  END IF;

  IF v_existing_id IS NOT NULL AND p_force_regenerate THEN
    UPDATE public.patrol_route_instances
    SET plan_status = 'superseded', updated_at = NOW()
    WHERE id = v_existing_id;
  END IF;

  -- ── Determine randomization mode ──────────────────────────────────────────
  v_do_randomize := v_route.rand_enabled
    OR v_route.checkpoint_mode IN ('any_order', 'random');

  -- ── Collect checkpoints for this route ───────────────────────────────────
  SELECT
    ARRAY_AGG(prc.checkpoint_id ORDER BY prc.sequence_no)  AS cp_ids,
    ARRAY_AGG(NULL::UUID        ORDER BY prc.sequence_no)  AS z_ids,
    ARRAY_AGG(COALESCE(pc.name, 'Checkpoint') ORDER BY prc.sequence_no) AS names,
    ARRAY_AGG(COALESCE(prc.is_mandatory, FALSE) ORDER BY prc.sequence_no) AS mand,
    COUNT(*)::INTEGER AS n
  INTO v_checkpoint_ids, v_zone_ids, v_stop_names, v_mandatory_arr, v_n
  FROM public.patrol_route_checkpoints prc
  JOIN public.patrol_checkpoints pc ON pc.id = prc.checkpoint_id
  WHERE prc.patrol_route_id = v_route.id
    AND pc.is_active = TRUE;

  -- Fall back to zones when no checkpoints configured
  IF v_n = 0 THEN
    SELECT
      ARRAY_AGG(NULL::UUID  ORDER BY z.name),
      ARRAY_AGG(z.id        ORDER BY z.name),
      ARRAY_AGG(z.name      ORDER BY z.name),
      ARRAY_AGG(FALSE       ORDER BY z.name),
      COUNT(*)::INTEGER
    INTO v_checkpoint_ids, v_zone_ids, v_stop_names, v_mandatory_arr, v_n
    FROM public.zones z
    WHERE z.id = ANY(v_route.secondary_zone_ids)
      AND z.is_active = TRUE;

    IF v_n = 0 AND v_route.primary_zone_id IS NOT NULL THEN
      SELECT
        ARRAY[NULL::UUID], ARRAY[z.id], ARRAY[z.name], ARRAY[FALSE], 1
      INTO v_checkpoint_ids, v_zone_ids, v_stop_names, v_mandatory_arr, v_n
      FROM public.zones z WHERE z.id = v_route.primary_zone_id;
    END IF;
  END IF;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'no checkpoints or zones on route');
  END IF;

  -- ── Build shuffled index array when randomizing ───────────────────────────
  v_idx := ARRAY(SELECT generate_series(1, v_n));

  IF v_do_randomize THEN
    -- Fisher-Yates shuffle via setseed + random()
    PERFORM setseed(EXTRACT(EPOCH FROM NOW())::FLOAT / 1e10);
    FOR i IN REVERSE v_n..2 LOOP
      DECLARE
        j INTEGER := FLOOR(random() * i + 1)::INTEGER;
        tmp INTEGER;
      BEGIN
        tmp      := v_idx[i];
        v_idx[i] := v_idx[j];
        v_idx[j] := tmp;
      END;
    END LOOP;

    -- Lock first stop when mandatory_first_stop is TRUE
    IF v_route.fix_first AND v_n > 1 THEN
      -- Find position of index 1 in shuffled array and swap to front
      FOR i IN 2..v_n LOOP
        IF v_idx[i] = 1 THEN
          v_idx[i] := v_idx[1];
          v_idx[1] := 1;
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- ── Determine base start time ─────────────────────────────────────────────
  v_base_time := COALESCE(v_shift.start_time::TIMESTAMPTZ, NOW());

  -- ── Create route instance ─────────────────────────────────────────────────
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
    p_roster_shift_id,
    v_route.id,
    v_shift.officer_id,
    CASE WHEN v_do_randomize THEN 'randomized' ELSE 'baseline' END,
    'planned',
    v_base_time,
    COALESCE(v_shift.end_time::TIMESTAMPTZ, v_base_time + INTERVAL '1 hour'),
    v_route.expected_duration_minutes,
    COALESCE(p_created_by, v_shift.created_by)
  )
  RETURNING id INTO v_instance_id;

  -- ── Insert stops with jitter ──────────────────────────────────────────────
  v_jitter_secs := COALESCE(v_route.jitter_min, 15) * 60;

  FOR i IN 1..v_n LOOP
    DECLARE
      raw_idx   INTEGER := v_idx[i];
      jitter    INTEGER := 0;
      gap_mins  INTEGER := COALESCE(v_route.expected_duration_minutes / NULLIF(v_n, 0), 15);
    BEGIN
      IF v_do_randomize AND v_jitter_secs > 0 THEN
        -- Random jitter ± jitter_window_minutes
        jitter := (random() * v_jitter_secs * 2 - v_jitter_secs)::INTEGER;
      END IF;

      v_window_start := v_base_time
        + ((i - 1) * gap_mins || ' minutes')::INTERVAL
        + (jitter || ' seconds')::INTERVAL;
      v_window_end   := v_window_start
        + (gap_mins || ' minutes')::INTERVAL;

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
        v_instance_id,
        v_checkpoint_ids[raw_idx],
        v_zone_ids[raw_idx],
        v_stop_names[raw_idx],
        v_mandatory_arr[raw_idx],
        i,
        v_window_start,
        v_window_end,
        'pending'
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'status',            'created',
    'route_instance_id', v_instance_id,
    'stops_created',     v_n,
    'planning_mode',     CASE WHEN v_do_randomize THEN 'randomized' ELSE 'baseline' END,
    'jitter_window_min', v_route.jitter_min,
    'source',            'generate_patrol_route_instance_v2'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status',  'error',
    'message', SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$;

COMMENT ON FUNCTION public.generate_patrol_route_instance(UUID, BOOLEAN, UUID) IS
  'v2: Generates a patrol route instance with Fisher-Yates randomization, jitter windows,
   and mandatory-first-stop lock. Reads randomization_enabled and jitter_window_minutes
   from patrol_routes.';

GRANT EXECUTE ON FUNCTION public.generate_patrol_route_instance(UUID, BOOLEAN, UUID) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ patrol_routes randomization policy columns added';
  RAISE NOTICE '✅ generate_patrol_route_instance updated to v2 with jitter + shuffle';
END;
$$;
