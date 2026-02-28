-- Migration: Async Scan Pipeline with Status Tracking
-- Date: 2025-02-27
-- Purpose: Enable fast photo upload with background AI processing

-- Step 1: Add processing_status column
ALTER TABLE observations ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'pending';
ALTER TABLE observations ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMPTZ;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS processing_error TEXT;

-- Step 2: Allow NULL plate_number during initial save (will be populated by AI)
ALTER TABLE observations ALTER COLUMN plate_number DROP NOT NULL;
ALTER TABLE observations ALTER COLUMN plate_number SET DEFAULT 'PROCESSING...';

-- Step 3: Create index for pending observations (for background job)
CREATE INDEX IF NOT EXISTS idx_observations_processing_status 
  ON observations(processing_status, created_at) 
  WHERE processing_status IN ('pending', 'processing');

-- Step 4: Add check constraint for valid status values
ALTER TABLE observations ADD CONSTRAINT observations_processing_status_check 
  CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed'));

-- Step 5: Create function to get pending observations for background processing
CREATE OR REPLACE FUNCTION get_pending_observations(limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
  id UUID,
  photo_url TEXT,
  photo_hash TEXT,
  recorded_by UUID,
  organization_id UUID,
  zone_id UUID,
  gps_latitude NUMERIC,
  gps_longitude NUMERIC,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    o.photo_url,
    o.photo_hash,
    o.recorded_by,
    o.organization_id,
    o.zone_id,
    o.gps_latitude,
    o.gps_longitude,
    o.created_at
  FROM observations o
  WHERE o.processing_status = 'pending'
    AND o.created_at > NOW() - INTERVAL '24 hours' -- Only process recent
  ORDER BY o.created_at ASC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 6: Grant permissions
GRANT EXECUTE ON FUNCTION get_pending_observations TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_observations TO anon;

COMMENT ON COLUMN observations.processing_status IS 'Status: pending (initial save), processing (AI running), completed (AI done), failed (AI error)';
COMMENT ON COLUMN observations.processing_started_at IS 'When background AI processing started';
COMMENT ON COLUMN observations.processing_completed_at IS 'When background AI processing completed';
COMMENT ON COLUMN observations.processing_error IS 'Error message if processing failed';
COMMENT ON FUNCTION get_pending_observations IS 'Get observations that need AI processing (for background jobs)';
