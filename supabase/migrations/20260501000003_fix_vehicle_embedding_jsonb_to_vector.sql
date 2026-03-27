-- Fix jsonb->vector cast failure for observations.vehicle_embedding.
--
-- Some environments ended up with vehicle_embedding as jsonb from
-- 20260309000002_add_observation_embedding_columns.sql.
-- A plain ALTER TYPE can fail with:
--   column "vehicle_embedding" cannot be cast automatically to type vector
-- This migration normalizes the column safely and idempotently.

DO $$
BEGIN
  -- If column exists as jsonb, null values first and force explicit conversion.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND column_name = 'vehicle_embedding'
      AND data_type = 'jsonb'
  ) THEN
    UPDATE public.observations
    SET vehicle_embedding = NULL
    WHERE vehicle_embedding IS NOT NULL;

    ALTER TABLE public.observations
      ALTER COLUMN vehicle_embedding TYPE vector(384)
      USING NULL::vector(384);

    RAISE NOTICE 'Normalized observations.vehicle_embedding from jsonb to vector(384)';
  END IF;

  -- Ensure the column exists with the expected type if it was missing.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND column_name = 'vehicle_embedding'
  ) THEN
    ALTER TABLE public.observations
      ADD COLUMN vehicle_embedding vector(384);

    RAISE NOTICE 'Added observations.vehicle_embedding as vector(384)';
  END IF;
END
$$;
