-- Training lifecycle + completion attempts
-- Adds publication states for reusable training content and a completion
-- evidence ledger that can bridge successful training into officer skills.

-- ---------------------------------------------------------------------------
-- 1. Training material lifecycle fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.training_material_library
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'legal_review', 'approved', 'retired')),
  ADD COLUMN IF NOT EXISTS legal_reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legal_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retired_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_training_material_library_status
  ON public.training_material_library(organization_id, status, updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_training_material_lifecycle_timestamps()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'legal_review' THEN
      NEW.legal_reviewed_by := COALESCE(NEW.legal_reviewed_by, auth.uid())
      ;
      NEW.legal_reviewed_at := COALESCE(NEW.legal_reviewed_at, now())
      ;
    ELSIF NEW.status = 'approved' THEN
      NEW.approved_by := COALESCE(NEW.approved_by, auth.uid())
      ;
      NEW.approved_at := COALESCE(NEW.approved_at, now())
      ;
    ELSIF NEW.status = 'retired' THEN
      NEW.retired_by := COALESCE(NEW.retired_by, auth.uid())
      ;
      NEW.retired_at := COALESCE(NEW.retired_at, now())
      ;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_material_library_lifecycle ON public.training_material_library;
CREATE TRIGGER trg_training_material_library_lifecycle
  BEFORE UPDATE ON public.training_material_library
  FOR EACH ROW EXECUTE FUNCTION public.set_training_material_lifecycle_timestamps();

-- ---------------------------------------------------------------------------
-- 2. Completion attempts ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.training_completion_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES public.training_assignments(id) ON DELETE CASCADE,
  officer_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,

  attempt_no INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  passed BOOLEAN NOT NULL DEFAULT false,
  evidence_text TEXT,
  notes TEXT,

  evaluated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (assignment_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_training_completion_attempts_org_assignment
  ON public.training_completion_attempts(organization_id, assignment_id, attempt_no DESC);

CREATE INDEX IF NOT EXISTS idx_training_completion_attempts_officer
  ON public.training_completion_attempts(officer_id, completed_at DESC);

ALTER TABLE public.training_completion_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage training_completion_attempts" ON public.training_completion_attempts;
CREATE POLICY "admins manage training_completion_attempts"
  ON public.training_completion_attempts FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = training_completion_attempts.organization_id
        AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = training_completion_attempts.organization_id
        AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

DROP POLICY IF EXISTS "officers read own training_completion_attempts" ON public.training_completion_attempts;
CREATE POLICY "officers read own training_completion_attempts"
  ON public.training_completion_attempts FOR SELECT
  USING (officer_id = auth.uid());

CREATE OR REPLACE FUNCTION public.update_training_completion_attempts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_completion_attempts_updated_at ON public.training_completion_attempts;
CREATE TRIGGER trg_training_completion_attempts_updated_at
  BEFORE UPDATE ON public.training_completion_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_training_completion_attempts_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Completion RPC + competency bridge
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_training_competency_name(
  p_skill TEXT,
  p_assignment_type TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_skill, '')) IN ('site_induction', 'site induction')
      OR lower(COALESCE(p_assignment_type, '')) = 'site_induction'
      THEN 'Site Induction'
    ELSE NULLIF(btrim(COALESCE(p_skill, '')), '')
  END
$$;

CREATE OR REPLACE FUNCTION public.record_training_completion_attempt(
  p_assignment_id UUID,
  p_score INTEGER DEFAULT 100,
  p_evidence TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_passed BOOLEAN DEFAULT NULL,
  p_actor_id UUID DEFAULT auth.uid()
)
RETURNS TABLE(
  assignment_id UUID,
  officer_id UUID,
  attempt_no INTEGER,
  score INTEGER,
  passed BOOLEAN,
  competency_granted BOOLEAN,
  skill_name TEXT,
  status TEXT,
  completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_org UUID;
  v_actor_role TEXT;
  v_assignment RECORD;
  v_attempt_no INTEGER;
  v_passed BOOLEAN := COALESCE(p_passed, p_score >= 80);
  v_skill_name TEXT;
  v_skill_notes TEXT;
BEGIN
  SELECT up.organization_id, up.role
  INTO v_actor_org, v_actor_role
  FROM public.user_profiles up
  WHERE up.id = p_actor_id;

  IF v_actor_org IS NULL THEN
    RAISE EXCEPTION 'Actor user profile not found';
  END IF;

  SELECT ta.*
  INTO v_assignment
  FROM public.training_assignments ta
  WHERE ta.id = p_assignment_id
    AND ta.organization_id = v_actor_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Training assignment not found for this organization';
  END IF;

  IF v_actor_role NOT IN ('admin', 'admin_officer', 'master', 'grand_master')
     AND v_assignment.officer_id <> p_actor_id THEN
    RAISE EXCEPTION 'Not allowed to record completion for this assignment';
  END IF;

  SELECT COALESCE(MAX(tca.attempt_no), 0) + 1
  INTO v_attempt_no
  FROM public.training_completion_attempts tca
  WHERE tca.assignment_id = p_assignment_id;

  INSERT INTO public.training_completion_attempts (
    organization_id,
    assignment_id,
    officer_id,
    attempt_no,
    score,
    passed,
    evidence_text,
    notes,
    evaluated_by,
    completed_at
  ) VALUES (
    v_actor_org,
    p_assignment_id,
    v_assignment.officer_id,
    v_attempt_no,
    GREATEST(0, LEAST(COALESCE(p_score, 0), 100)),
    v_passed,
    p_evidence,
    p_notes,
    p_actor_id,
    now()
  );

  IF v_passed THEN
    UPDATE public.training_assignments
    SET status = 'completed',
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE id = p_assignment_id;

    v_skill_name := public.normalize_training_competency_name(v_assignment.required_skill, v_assignment.assignment_type);

    IF v_skill_name IS NOT NULL THEN
      v_skill_notes := CONCAT_WS(' | ',
        'Granted from training completion attempt',
        'assignment=' || p_assignment_id::text,
        'attempt=' || v_attempt_no::text,
        NULLIF(btrim(COALESCE(p_notes, '')), '')
      );

      INSERT INTO public.officer_skills (
        officer_id,
        organization_id,
        skill_name,
        skill_category,
        certification_number,
        issued_at,
        expires_at,
        document_url,
        is_verified,
        verified_by,
        verified_at,
        notes
      ) VALUES (
        v_assignment.officer_id,
        v_actor_org,
        v_skill_name,
        'training',
        NULL,
        CURRENT_DATE,
        NULL,
        NULL,
        true,
        p_actor_id,
        now(),
        v_skill_notes
      )
      ON CONFLICT (officer_id, skill_name) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          skill_category = EXCLUDED.skill_category,
          issued_at = COALESCE(public.officer_skills.issued_at, EXCLUDED.issued_at),
          expires_at = EXCLUDED.expires_at,
          is_verified = true,
          verified_by = EXCLUDED.verified_by,
          verified_at = EXCLUDED.verified_at,
          notes = EXCLUDED.notes,
          updated_at = now();
    END IF;
  ELSE
    UPDATE public.training_assignments
    SET status = CASE
          WHEN status = 'completed' THEN status
          WHEN status = 'cancelled' THEN status
          ELSE 'in_progress'
        END,
        updated_at = now()
    WHERE id = p_assignment_id;
  END IF;

  assignment_id := p_assignment_id;
  officer_id := v_assignment.officer_id;
  attempt_no := v_attempt_no;
  score := GREATEST(0, LEAST(COALESCE(p_score, 0), 100));
  passed := v_passed;
  competency_granted := v_passed AND v_skill_name IS NOT NULL;
  skill_name := v_skill_name;
  status := CASE WHEN v_passed THEN 'completed' ELSE 'in_progress' END;
  completed_at := now();

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.record_training_completion_attempt(UUID, INTEGER, TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_training_completion_attempt(UUID, INTEGER, TEXT, TEXT, BOOLEAN, UUID) TO authenticated;

COMMENT ON FUNCTION public.record_training_completion_attempt(UUID, INTEGER, TEXT, TEXT, BOOLEAN, UUID) IS
  'Record a training completion attempt, update assignment status, and grant the matching competency when the attempt passes.';

-- ---------------------------------------------------------------------------
-- 4. Refresh auto-assignment site-induction detection to match competency bridge
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
           AND (
             lower(os.skill_name) = 'site induction'
             OR lower(os.skill_name) LIKE 'site induction:%'
           )
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
          'site induction',
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
