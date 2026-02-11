-- Fix investigation job type handling
-- Add a 'value' column to store the snake_case identifier used in job_type field
-- This ensures consistency between job type selection and database constraints

-- Add value column to investigation_job_types
ALTER TABLE public.investigation_job_types
  ADD COLUMN IF NOT EXISTS value TEXT;

-- Generate values from names (convert to snake_case)
UPDATE public.investigation_job_types
SET value = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
WHERE value IS NULL;

-- Make value NOT NULL and add unique constraint
ALTER TABLE public.investigation_job_types
  ALTER COLUMN value SET NOT NULL;

ALTER TABLE public.investigation_job_types
  ADD CONSTRAINT investigation_job_types_value_unique UNIQUE (value);

-- Remove the old CHECK constraint if it exists (will be replaced by foreign key reference)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'investigation_jobs_job_type_check'
  ) THEN
    ALTER TABLE public.investigation_jobs DROP CONSTRAINT investigation_jobs_job_type_check;
  END IF;
END $$;

-- Update investigation_jobs to use TEXT type (if needed)
-- No constraint needed - we'll validate against job_types table in application

-- Create index on value column for faster lookups
CREATE INDEX IF NOT EXISTS idx_investigation_job_types_value ON public.investigation_job_types(value);

-- Add comment
COMMENT ON COLUMN public.investigation_job_types.value IS 'Snake-case identifier used in investigation_jobs.job_type field (e.g., "health_safety")';
