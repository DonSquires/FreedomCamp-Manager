-- Training library + automated assignment engine
-- Purpose:
--   1) Store reusable training assets/modules so Bob can recompose targeted training
--   2) Assign training to officers automatically before upcoming shifts
--   3) Close skill/site-induction gaps using roster required_skills + client_site_id

-- ---------------------------------------------------------------------------
-- 1. Reusable training material library
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.training_material_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,
  topic TEXT,
  content_type TEXT NOT NULL DEFAULT 'composite'
    CHECK (content_type IN ('video', 'image', 'interactive', 'document', 'composite')),

  media_url TEXT,
  thumbnail_url TEXT,
  source_text TEXT,
  legal_references TEXT,

  skill_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  best_practices TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  site_id UUID REFERENCES public.client_sites(id) ON DELETE SET NULL,
  is_reusable BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  generated_by_bob BOOLEAN NOT NULL DEFAULT false,

  composed_from_material_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,

  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_material_library_org_active
  ON public.training_material_library(organization_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_material_library_site
  ON public.training_material_library(site_id)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_training_material_library_skill_tags
  ON public.training_material_library USING gin(skill_tags);

ALTER TABLE public.training_material_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage training_material_library" ON public.training_material_library;
CREATE POLICY "admins manage training_material_library"
  ON public.training_material_library FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = training_material_library.organization_id
        AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = training_material_library.organization_id
        AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

DROP POLICY IF EXISTS "auth read own-org training_material_library" ON public.training_material_library;
CREATE POLICY "auth read own-org training_material_library"
  ON public.training_material_library FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = training_material_library.organization_id
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Training assignments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.training_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  officer_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  roster_shift_id UUID REFERENCES public.roster_shifts(id) ON DELETE SET NULL,
  site_id UUID REFERENCES public.client_sites(id) ON DELETE SET NULL,

  assignment_type TEXT NOT NULL DEFAULT 'skill_gap'
    CHECK (assignment_type IN ('skill_gap', 'site_induction', 'refresher', 'custom')),

  title TEXT NOT NULL,
  instructions TEXT,
  due_at TIMESTAMPTZ,

  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'completed', 'overdue', 'cancelled')),
  completed_at TIMESTAMPTZ,

  required_skill TEXT,
  assignment_reason TEXT,

  assigned_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assigned_by_bob BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_assignments_org_status_due
  ON public.training_assignments(organization_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_training_assignments_officer_status
  ON public.training_assignments(officer_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_training_assignments_shift
  ON public.training_assignments(roster_shift_id)
  WHERE roster_shift_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_training_assignments_active_skill_per_shift
  ON public.training_assignments(officer_id, roster_shift_id, assignment_type, required_skill)
  WHERE status IN ('assigned', 'in_progress', 'overdue');

ALTER TABLE public.training_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage training_assignments" ON public.training_assignments;
CREATE POLICY "admins manage training_assignments"
  ON public.training_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = training_assignments.organization_id
        AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = training_assignments.organization_id
        AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

DROP POLICY IF EXISTS "officers read own training_assignments" ON public.training_assignments;
CREATE POLICY "officers read own training_assignments"
  ON public.training_assignments FOR SELECT
  USING (officer_id = auth.uid());

DROP POLICY IF EXISTS "officers update own training_assignments" ON public.training_assignments;
CREATE POLICY "officers update own training_assignments"
  ON public.training_assignments FOR UPDATE
  USING (officer_id = auth.uid())
  WITH CHECK (officer_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Assignment-to-material mapping
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.training_assignment_materials (
  assignment_id UUID NOT NULL REFERENCES public.training_assignments(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES public.training_material_library(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL DEFAULT 1,
  is_required BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_training_assignment_materials_assignment
  ON public.training_assignment_materials(assignment_id, sequence_no);

ALTER TABLE public.training_assignment_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage training_assignment_materials" ON public.training_assignment_materials;
CREATE POLICY "admins manage training_assignment_materials"
  ON public.training_assignment_materials FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.training_assignments ta
      JOIN public.user_profiles up
        ON up.id = auth.uid()
       AND up.organization_id = ta.organization_id
       AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
      WHERE ta.id = training_assignment_materials.assignment_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.training_assignments ta
      JOIN public.user_profiles up
        ON up.id = auth.uid()
       AND up.organization_id = ta.organization_id
       AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
      WHERE ta.id = training_assignment_materials.assignment_id
    )
  );

DROP POLICY IF EXISTS "officers read own training_assignment_materials" ON public.training_assignment_materials;
CREATE POLICY "officers read own training_assignment_materials"
  ON public.training_assignment_materials FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.training_assignments ta
      WHERE ta.id = training_assignment_materials.assignment_id
        AND ta.officer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Updated-at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_training_tables_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_material_library_updated_at ON public.training_material_library;
CREATE TRIGGER trg_training_material_library_updated_at
  BEFORE UPDATE ON public.training_material_library
  FOR EACH ROW EXECUTE FUNCTION public.update_training_tables_updated_at();

DROP TRIGGER IF EXISTS trg_training_assignments_updated_at ON public.training_assignments;
CREATE TRIGGER trg_training_assignments_updated_at
  BEFORE UPDATE ON public.training_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_training_tables_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Auto-assignment RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_assign_training_for_upcoming_shifts(
  p_organization_id UUID DEFAULT NULL,
  p_hours_ahead INTEGER DEFAULT 72,
  p_actor_id UUID DEFAULT auth.uid()
)
RETURNS TABLE(
  shift_id UUID,
  officer_id UUID,
  assignments_created INTEGER,
  missing_skills TEXT[],
  site_induction_assigned BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_org UUID;
  v_actor_role TEXT;
  v_target_org UUID;
  v_hours INTEGER := GREATEST(COALESCE(p_hours_ahead, 72), 1);

  r_shift RECORD;
  r_skill TEXT;

  v_assignment_id UUID;
  v_created INTEGER;
  v_missing TEXT[];
  v_site_induction BOOLEAN;
BEGIN
  SELECT up.organization_id, up.role
  INTO v_actor_org, v_actor_role
  FROM public.user_profiles up
  WHERE up.id = p_actor_id;

  IF v_actor_org IS NULL THEN
    RAISE EXCEPTION 'Actor user profile not found';
  END IF;

  IF v_actor_role NOT IN ('admin', 'admin_officer', 'master', 'grand_master') THEN
    RAISE EXCEPTION 'Only admin/master roles can run auto training assignment';
  END IF;

  v_target_org := COALESCE(p_organization_id, v_actor_org);

  IF v_target_org <> v_actor_org AND v_actor_role NOT IN ('master', 'grand_master') THEN
    RAISE EXCEPTION 'Cross-org assignment requires master/grand_master role';
  END IF;

  FOR r_shift IN
    SELECT rs.id,
           rs.organization_id,
           rs.officer_id,
           rs.client_site_id,
           rs.start_time,
           COALESCE(rs.required_skills, ARRAY[]::TEXT[]) AS required_skills
    FROM public.roster_shifts rs
    WHERE rs.organization_id = v_target_org
      AND rs.officer_id IS NOT NULL
      AND rs.status IN ('published', 'confirmed')
      AND rs.start_time IS NOT NULL
      AND rs.start_time >= now()
      AND rs.start_time <= now() + make_interval(hours => v_hours)
    ORDER BY rs.start_time ASC
  LOOP
    v_created := 0;
    v_missing := ARRAY[]::TEXT[];
    v_site_induction := false;

    FOREACH r_skill IN ARRAY r_shift.required_skills
    LOOP
      IF COALESCE(btrim(r_skill), '') = '' THEN
        CONTINUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.officer_skills os
        WHERE os.organization_id = r_shift.organization_id
          AND os.officer_id = r_shift.officer_id
          AND lower(os.skill_name) = lower(r_skill)
          AND (os.expires_at IS NULL OR os.expires_at >= CURRENT_DATE)
      ) THEN
        v_missing := array_append(v_missing, r_skill);

        IF NOT EXISTS (
          SELECT 1
          FROM public.training_assignments ta
          WHERE ta.organization_id = r_shift.organization_id
            AND ta.officer_id = r_shift.officer_id
            AND ta.roster_shift_id = r_shift.id
            AND ta.assignment_type = 'skill_gap'
            AND lower(COALESCE(ta.required_skill, '')) = lower(r_skill)
            AND ta.status IN ('assigned', 'in_progress', 'overdue')
        ) THEN
          INSERT INTO public.training_assignments (
            organization_id,
            officer_id,
            roster_shift_id,
            site_id,
            assignment_type,
            title,
            instructions,
            due_at,
            status,
            required_skill,
            assignment_reason,
            assigned_by,
            assigned_by_bob
          )
          VALUES (
            r_shift.organization_id,
            r_shift.officer_id,
            r_shift.id,
            r_shift.client_site_id,
            'skill_gap',
            'Required shift skill training: ' || r_skill,
            'Complete this training before your upcoming shift. Assigned automatically by Bob based on required shift skills.',
            r_shift.start_time - interval '2 hours',
            'assigned',
            r_skill,
            'Missing required skill for upcoming roster shift',
            p_actor_id,
            true
          )
          RETURNING id INTO v_assignment_id;

          INSERT INTO public.training_assignment_materials (assignment_id, material_id, sequence_no, is_required)
          SELECT
            v_assignment_id,
            m.id,
            row_number() OVER (ORDER BY m.created_at DESC),
            true
          FROM public.training_material_library m
          WHERE m.organization_id = r_shift.organization_id
            AND m.is_active = true
            AND (
              lower(COALESCE(m.topic, '')) = lower(r_skill)
              OR EXISTS (
                SELECT 1
                FROM unnest(COALESCE(m.skill_tags, ARRAY[]::TEXT[])) tag
                WHERE lower(tag) = lower(r_skill)
              )
            )
          ORDER BY m.created_at DESC
          LIMIT 3
          ON CONFLICT DO NOTHING;

          v_created := v_created + 1;
        END IF;
      END IF;
    END LOOP;

    IF r_shift.client_site_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.officer_skills os
         WHERE os.organization_id = r_shift.organization_id
           AND os.officer_id = r_shift.officer_id
           AND os.skill_category = 'site_induction'
           AND os.site_id = r_shift.client_site_id
           AND (os.expires_at IS NULL OR os.expires_at >= CURRENT_DATE)
       ) THEN

      IF NOT EXISTS (
        SELECT 1
        FROM public.training_assignments ta
        WHERE ta.organization_id = r_shift.organization_id
          AND ta.officer_id = r_shift.officer_id
          AND ta.roster_shift_id = r_shift.id
          AND ta.assignment_type = 'site_induction'
          AND ta.status IN ('assigned', 'in_progress', 'overdue')
      ) THEN
        INSERT INTO public.training_assignments (
          organization_id,
          officer_id,
          roster_shift_id,
          site_id,
          assignment_type,
          title,
          instructions,
          due_at,
          status,
          required_skill,
          assignment_reason,
          assigned_by,
          assigned_by_bob
        )
        VALUES (
          r_shift.organization_id,
          r_shift.officer_id,
          r_shift.id,
          r_shift.client_site_id,
          'site_induction',
          'Site induction required before shift',
          'Complete site induction training for your assigned site before shift start.',
          r_shift.start_time - interval '2 hours',
          'assigned',
          'site_induction',
          'Missing site induction for assigned client site',
          p_actor_id,
          true
        )
        RETURNING id INTO v_assignment_id;

        INSERT INTO public.training_assignment_materials (assignment_id, material_id, sequence_no, is_required)
        SELECT
          v_assignment_id,
          m.id,
          row_number() OVER (ORDER BY m.created_at DESC),
          true
        FROM public.training_material_library m
        WHERE m.organization_id = r_shift.organization_id
          AND m.is_active = true
          AND (
            m.site_id = r_shift.client_site_id
            OR lower(COALESCE(m.topic, '')) LIKE '%site induction%'
            OR EXISTS (
              SELECT 1
              FROM unnest(COALESCE(m.skill_tags, ARRAY[]::TEXT[])) tag
              WHERE lower(tag) IN ('site_induction', 'site induction')
            )
          )
        ORDER BY m.created_at DESC
        LIMIT 3
        ON CONFLICT DO NOTHING;

        v_created := v_created + 1;
        v_site_induction := true;
      END IF;
    END IF;

    shift_id := r_shift.id;
    officer_id := r_shift.officer_id;
    assignments_created := v_created;
    missing_skills := v_missing;
    site_induction_assigned := v_site_induction;

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_assign_training_for_upcoming_shifts(UUID, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_assign_training_for_upcoming_shifts(UUID, INTEGER, UUID) TO authenticated;

COMMENT ON FUNCTION public.auto_assign_training_for_upcoming_shifts(UUID, INTEGER, UUID) IS
  'Auto-assign training for upcoming roster shifts based on required_skills and site induction gaps.';
