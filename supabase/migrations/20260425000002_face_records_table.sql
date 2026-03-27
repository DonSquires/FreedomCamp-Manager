-- ============================================================================
-- Face Records — stores face detection results and embeddings
--
-- Used by the face recognition feature for:
--   - Storing face embeddings for comparison/matching
--   - Linking face records to observations and person records
--   - Tracking face detections across encounters
--
-- The embedding column stores a 384-D MobileNetV3 vector (same model used
-- for vehicle embeddings). Comparison is done via cosine similarity through
-- the inference service /infer/compare endpoint.
-- ============================================================================

-- ── Table ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.face_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  -- Photo reference
  photo_url       text NOT NULL,
  photo_path      text,                       -- storage bucket path
  -- Detection results
  face_count      integer NOT NULL DEFAULT 0,
  faces           jsonb NOT NULL DEFAULT '[]', -- array of { bbox, confidence, age, gender, description }
  -- Primary face embedding (384-D MobileNetV3)
  embedding       real[],                      -- NULL if no face detected or model unavailable
  embedding_quality real,
  detection_method text,                       -- 'onnx_ultraface', 'openai_vision', 'none'
  -- Linked records
  observation_id  uuid REFERENCES public.observations(id),
  person_record_id uuid,                       -- links to person_records if created
  -- Officer who captured
  officer_id      uuid REFERENCES auth.users(id),
  -- Location
  latitude        double precision,
  longitude       double precision,
  zone_id         uuid,
  -- Notes
  notes           text,
  label           text,                        -- officer-assigned label (e.g. "POI", "Witness")
  -- Metadata
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_face_records_org
  ON public.face_records(organization_id);

CREATE INDEX IF NOT EXISTS idx_face_records_officer
  ON public.face_records(officer_id);

CREATE INDEX IF NOT EXISTS idx_face_records_observation
  ON public.face_records(observation_id);

CREATE INDEX IF NOT EXISTS idx_face_records_created
  ON public.face_records(created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.face_records ENABLE ROW LEVEL SECURITY;

-- Authenticated users can SELECT records belonging to their organisation
CREATE POLICY face_records_select ON public.face_records
  FOR SELECT TO authenticated
  USING (
    organization_id = (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid()
      LIMIT 1
    )
  );

-- Admin/master/admin_officer can INSERT
CREATE POLICY face_records_insert ON public.face_records
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master', 'admin_officer', 'officer')
        AND organization_id = face_records.organization_id
    )
  );

-- Admin/master can UPDATE
CREATE POLICY face_records_update ON public.face_records
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master', 'admin_officer')
        AND organization_id = face_records.organization_id
    )
  );

-- Admin/master can DELETE
CREATE POLICY face_records_delete ON public.face_records
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master')
        AND organization_id = face_records.organization_id
    )
  );

-- Service role bypasses RLS
CREATE POLICY face_records_service ON public.face_records
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Updated-at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.face_records_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_face_records_updated_at
  BEFORE UPDATE ON public.face_records
  FOR EACH ROW
  EXECUTE FUNCTION public.face_records_set_updated_at();
