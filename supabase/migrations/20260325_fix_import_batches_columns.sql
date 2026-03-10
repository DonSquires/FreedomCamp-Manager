-- ============================================================================
-- Fix import_batches table: add missing columns for historical data import
-- Date: 2026-03-25
--
-- Changes:
--   1. Add zones_created column (queried by ImportHistoricalData.tsx UI)
--   2. Add parsed_records column for progress tracking
--   3. status values 'parsing', 'zone_matching', 'importing' are valid
--      (no CHECK constraint exists, so no ALTER needed)
-- ============================================================================

ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS zones_created   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parsed_records  INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.import_batches.zones_created  IS 'Number of new zones auto-created during this import batch';
COMMENT ON COLUMN public.import_batches.parsed_records IS 'Number of rows successfully parsed from the source file';
