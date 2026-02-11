-- Migration: Historical Data Import Staging
-- Purpose: Create tables and functions for importing and enriching legacy data
-- Affected tables: import_staging, import_batches

-- ============================================================================
-- IMPORT BATCHES TABLE
-- ============================================================================
-- Tracks import job metadata and status
CREATE TABLE IF NOT EXISTS public.import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES user_profiles(id),
  
  -- Batch metadata
  batch_name TEXT NOT NULL,
  file_name TEXT,
  file_size_bytes BIGINT,
  
  -- Processing status
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, enriching, completed, failed
  total_records INTEGER DEFAULT 0,
  processed_records INTEGER DEFAULT 0,
  successful_records INTEGER DEFAULT 0,
  failed_records INTEGER DEFAULT 0,
  
  -- Enrichment stats
  plates_enriched INTEGER DEFAULT 0,
  vehicles_enriched INTEGER DEFAULT 0,
  homeless_inferred INTEGER DEFAULT 0,
  hs_issues_inferred INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Error tracking
  error_summary TEXT,
  
  -- Configuration
  import_config JSONB DEFAULT '{}'::jsonb
);

-- Indices for efficient queries
CREATE INDEX IF NOT EXISTS idx_import_batches_org ON import_batches(organization_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);
CREATE INDEX IF NOT EXISTS idx_import_batches_uploaded_by ON import_batches(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_import_batches_created_at ON import_batches(created_at DESC);

-- ============================================================================
-- IMPORT STAGING TABLE
-- ============================================================================
-- Holds individual records during import and enrichment process
CREATE TABLE IF NOT EXISTS public.import_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  
  -- Original data (as-is from import)
  raw_data JSONB NOT NULL,
  
  -- Normalized/enriched data
  enriched_data JSONB,
  
  -- Processing status
  status TEXT DEFAULT 'pending', -- pending, enriching, enriched, imported, failed
  
  -- Confidence scores for enriched fields
  confidence_scores JSONB DEFAULT '{}'::jsonb,
  
  -- Field-level enrichment tracking
  enrichment_log JSONB DEFAULT '[]'::jsonb, -- [{field: 'plate_text', method: 'ocr', confidence: 0.95, timestamp: '...'}]
  
  -- Error tracking
  error_log TEXT,
  validation_errors JSONB DEFAULT '[]'::jsonb,
  
  -- Entity linkage
  vehicle_id UUID, -- Links to canonical_vehicles if successfully imported
  observation_id UUID, -- Links to vehicle_observations if created
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  enriched_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ
);

-- Indices for efficient queries
CREATE INDEX IF NOT EXISTS idx_import_staging_batch ON import_staging(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_staging_status ON import_staging(status);
CREATE INDEX IF NOT EXISTS idx_import_staging_vehicle ON import_staging(vehicle_id);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_staging ENABLE ROW LEVEL SECURITY;

-- Admins manage batches for their org
CREATE POLICY admins_manage_import_batches
  ON import_batches
  FOR ALL
  USING (
    (get_user_role(auth.uid()) = ANY(ARRAY['admin', 'master']))
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- Admins view staging records for their batches
CREATE POLICY admins_view_import_staging
  ON import_staging
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM import_batches
      WHERE import_batches.id = import_staging.batch_id
      AND (
        get_user_role(auth.uid()) = 'master'
        OR import_batches.organization_id = get_user_organization_id(auth.uid())
      )
    )
  );

-- System can insert/update staging records
CREATE POLICY system_manage_import_staging
  ON import_staging
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update batch progress (called by Edge Function)
CREATE OR REPLACE FUNCTION update_import_batch_progress(
  p_batch_id UUID,
  p_processed INTEGER,
  p_successful INTEGER,
  p_failed INTEGER,
  p_status TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE import_batches
  SET
    processed_records = p_processed,
    successful_records = p_successful,
    failed_records = p_failed,
    status = COALESCE(p_status, status),
    started_at = COALESCE(started_at, NOW()),
    completed_at = CASE
      WHEN p_status IN ('completed', 'failed') THEN NOW()
      ELSE completed_at
    END
  WHERE id = p_batch_id;
END;
$$;

-- Function to get enrichment statistics for a batch
CREATE OR REPLACE FUNCTION get_import_batch_stats(p_batch_id UUID)
RETURNS TABLE (
  batch_id UUID,
  batch_name TEXT,
  status TEXT,
  total_records INTEGER,
  processed_records INTEGER,
  successful_records INTEGER,
  failed_records INTEGER,
  enrichment_rate NUMERIC,
  completion_percentage NUMERIC,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.batch_name,
    b.status,
    b.total_records,
    b.processed_records,
    b.successful_records,
    b.failed_records,
    CASE
      WHEN b.total_records > 0 THEN ROUND((b.plates_enriched::NUMERIC / b.total_records) * 100, 2)
      ELSE 0
    END AS enrichment_rate,
    CASE
      WHEN b.total_records > 0 THEN ROUND((b.processed_records::NUMERIC / b.total_records) * 100, 2)
      ELSE 0
    END AS completion_percentage,
    b.created_at,
    b.completed_at
  FROM import_batches b
  WHERE b.id = p_batch_id;
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE import_batches IS 'Tracks historical data import jobs with metadata and progress';
COMMENT ON TABLE import_staging IS 'Staging area for import records during enrichment and validation';
COMMENT ON COLUMN import_staging.enrichment_log IS 'Audit trail of all enrichment steps applied to this record';
COMMENT ON COLUMN import_staging.confidence_scores IS 'Confidence scores for each enriched field (0-1 scale)';
COMMENT ON FUNCTION update_import_batch_progress IS 'Updates batch progress in real-time during import processing';
COMMENT ON FUNCTION get_import_batch_stats IS 'Returns comprehensive statistics for an import batch';
