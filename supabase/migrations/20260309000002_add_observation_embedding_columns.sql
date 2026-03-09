-- Ensure observations has inference embedding persistence columns.
-- Safe for already-upgraded environments.

ALTER TABLE public.observations
ADD COLUMN IF NOT EXISTS vehicle_embedding jsonb,
ADD COLUMN IF NOT EXISTS embedding_quality double precision,
ADD COLUMN IF NOT EXISTS embedding_model_version text,
ADD COLUMN IF NOT EXISTS embedding_created_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_observations_embedding_created_at
  ON public.observations (embedding_created_at)
  WHERE embedding_created_at IS NOT NULL;
