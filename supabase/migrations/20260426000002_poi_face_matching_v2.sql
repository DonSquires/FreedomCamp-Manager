-- ============================================================================
-- POI face matching — server-side cosine similarity for face embeddings (v2)
--
-- Rationale for reusing stem: Refactors v1 (20260426000001) RPC implementation
--   to use manual cosine similarity computation (pgvector not required) and
--   adds enhanced person_record field selection. Extends match_face() contract.
--
-- Adds:
--   1. Foreign key from face_records.person_record_id → person_records.id
--   2. match_face() RPC — top-K cosine similarity search across face_records
--      that have a linked person_record (i.e. known POI / trespass subjects)
--   3. Index on face_records for person_record_id lookups
-- ============================================================================

-- ── FK link face_records → person_records ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'face_records_person_record_id_fkey'
  ) THEN
    ALTER TABLE public.face_records
      ADD CONSTRAINT face_records_person_record_id_fkey
      FOREIGN KEY (person_record_id) REFERENCES public.person_records(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Index for person_record_id
CREATE INDEX IF NOT EXISTS idx_face_records_person_record
  ON public.face_records(person_record_id)
  WHERE person_record_id IS NOT NULL;

-- ── match_face() — top-K cosine similarity for face embeddings ────────────────
-- Searches all face_records that:
--   a) belong to the same organisation
--   b) have a non-null embedding
--   c) have a linked person_record_id (i.e. a known POI)
--   d) embedding quality >= threshold
-- Returns the best K matches with person_records details.

DROP FUNCTION IF EXISTS public.match_face(real[], uuid, int, real);

CREATE OR REPLACE FUNCTION public.match_face(
  p_embedding     real[],              -- 384-D query embedding
  p_org_id        uuid,                -- organisation scope
  p_k             int   DEFAULT 5,     -- max results
  p_min_quality   real  DEFAULT 0.3    -- minimum embedding quality
)
RETURNS TABLE (
  face_record_id    uuid,
  person_record_id  uuid,
  similarity        real,
  photo_url         text,
  face_count        integer,
  faces             jsonb,
  label             text,
  notes             text,
  face_created_at   timestamptz,
  -- Person record fields
  person_full_name          text,
  person_date_of_birth      date,
  person_notes              text,
  person_homeless_status    text,
  person_is_of_interest     boolean,
  person_trespass_issued    boolean,
  person_trespass_date      date,
  person_risk_level         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    fr.id                AS face_record_id,
    fr.person_record_id,
    -- Cosine similarity: dot(a,b) / (||a|| * ||b||)
    -- pgvector is not installed so we compute manually for real[] arrays
    (
      SELECT COALESCE(
        SUM(a * b) / NULLIF(
          SQRT(SUM(a * a)) * SQRT(SUM(b * b)),
          0
        ),
        0
      )
      FROM UNNEST(p_embedding) WITH ORDINALITY AS q(a, i)
      JOIN UNNEST(fr.embedding) WITH ORDINALITY AS d(b, j) ON q.i = d.j
    )::real                                    AS similarity,
    fr.photo_url,
    fr.face_count,
    fr.faces,
    fr.label,
    fr.notes,
    fr.created_at                              AS face_created_at,
    -- Person fields
    TRIM(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, ''))
                                               AS person_full_name,
    pr.date_of_birth                           AS person_date_of_birth,
    pr.notes                                   AS person_notes,
    NULL::text                                 AS person_homeless_status,
    pr.is_of_interest                          AS person_is_of_interest,
    pr.trespass_notice_issued                  AS person_trespass_issued,
    pr.trespass_notice_date                    AS person_trespass_date,
    pr.risk_level                              AS person_risk_level
  FROM public.face_records fr
  JOIN public.person_records pr ON pr.id = fr.person_record_id
  WHERE fr.organization_id = p_org_id
    AND fr.embedding IS NOT NULL
    AND fr.person_record_id IS NOT NULL
    AND COALESCE(fr.embedding_quality, 0) >= p_min_quality
  ORDER BY similarity DESC
  LIMIT p_k;
$$;

COMMENT ON FUNCTION public.match_face IS
  'Top-K face embedding similarity search against known POI records. '
  'Returns face + person details for matches above the quality threshold.';