-- Adds ParkPow source metadata fields so archived photos retain upstream context.

ALTER TABLE IF EXISTS public.evidence_index
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_record_id TEXT,
  ADD COLUMN IF NOT EXISTS source_metadata JSONB;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'evidence_index'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_evidence_index_source_system_record
      ON public.evidence_index(source_system, source_record_id)
      WHERE source_system IS NOT NULL;
  END IF;
END;
$$;
