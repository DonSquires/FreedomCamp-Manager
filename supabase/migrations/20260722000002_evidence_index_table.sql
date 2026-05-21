-- =============================================================================
-- Migration: Evidence Index Table for Photo Reingest Pipeline
-- 
-- Creates a normalized evidence-index table to track photos from storage
-- bucket through branch-specific ingestion queues. Supports multi-branch
-- evidence routing and priority-based reingest scheduling.
-- =============================================================================

-- ── 1. Evidence Index Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evidence_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Storage reference
  storage_path TEXT NOT NULL,           -- Full path in Supabase Storage bucket
  storage_bucket TEXT NOT NULL DEFAULT 'evidence',
  file_hash TEXT,                       -- SHA256 or MD5 of file content
  file_size INTEGER,                    -- Bytes
  
  -- EXIF metadata (captured from image)
  exif_capture_timestamp TIMESTAMPTZ,   -- Photo capture time (from EXIF DateTimeOriginal)
  exif_device_make TEXT,                -- Camera make (e.g., 'OPPO')
  exif_device_model TEXT,               -- Camera model (e.g., 'Find N2 Flip')
  gps_latitude DOUBLE PRECISION,        -- EXIF GPS latitude
  gps_longitude DOUBLE PRECISION,       -- EXIF GPS longitude
  gps_accuracy DOUBLE PRECISION,        -- GPS accuracy in meters
  
  -- Geo-attribution (derived via bounding box matching)
  inferred_region TEXT,                 -- Region inferred from GPS: 'Nelson', 'Otago', 'Canterbury', etc.
  inferred_branch_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  inferred_loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL,
  -- Note: Zones are LOI records with loi_kind='freedom_camp', 'patrol_zone', etc., not separate entities
  
  -- Ingest workflow state
  priority_band TEXT CHECK (priority_band IN ('P0', 'P1', 'P2', 'P3')),  -- P0 = ready, P3 = needs triage
  ingest_action TEXT CHECK (ingest_action IN 
    ('ingest_to_branch_pipeline', 'run_secondary_geocoder', 'run_ocr_and_filename_enrichment', 
     'manual_review', 'rejected_bad_image', 'rejected_duplicate', 'archived')),
  ingest_status TEXT CHECK (ingest_status IN ('queued', 'processing', 'linked_to_observation', 'completed', 'failed')),
  
  -- Observation linkage
  linked_observation_id UUID REFERENCES public.observations(observation_id) ON DELETE SET NULL,
  
  -- Audit trail
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  indexed_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ,
  ingestion_error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_evidence_index_org_status
  ON public.evidence_index(organization_id, ingest_status);

CREATE INDEX IF NOT EXISTS idx_evidence_index_priority_branch
  ON public.evidence_index(priority_band, inferred_branch_id)
  WHERE ingest_status = 'queued';

CREATE INDEX IF NOT EXISTS idx_evidence_index_file_hash
  ON public.evidence_index(file_hash) WHERE file_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_index_capture_timestamp
  ON public.evidence_index(exif_capture_timestamp);

CREATE INDEX IF NOT EXISTS idx_evidence_index_gps_coords
  ON public.evidence_index(gps_latitude, gps_longitude);

-- ── 2. Evidence Index Audit Log ──────────────────────────────────────────
-- Track state changes for debugging and compliance.

CREATE TABLE IF NOT EXISTS public.evidence_index_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES public.evidence_index(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  old_action TEXT,
  new_action TEXT,
  reason_for_change TEXT,
  changed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Evidence Index RLS Policies ───────────────────────────────────────
-- Restrict evidence index access by organization.

ALTER TABLE public.evidence_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_index_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidence_index_read_own_org
  ON public.evidence_index FOR SELECT
  USING (
    CASE
      WHEN auth.uid() IS NULL THEN FALSE
      WHEN (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('master', 'grand_master') THEN TRUE
      ELSE organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
    END
  );

CREATE POLICY evidence_index_write_own_org
  ON public.evidence_index FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY evidence_index_update_own_org
  ON public.evidence_index FOR UPDATE
  USING (
    organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY evidence_index_audit_read_own_org
  ON public.evidence_index_audit FOR SELECT
  USING (
    evidence_id IN (
      SELECT id FROM public.evidence_index
      WHERE organization_id IN (
        SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
      )
    )
  );

-- ── 4. Evidence Index Update Trigger ─────────────────────────────────────
-- Auto-populate audit trail on status changes.

CREATE OR REPLACE FUNCTION public.trigger_evidence_index_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.ingest_status IS DISTINCT FROM OLD.ingest_status) OR
     (NEW.ingest_action IS DISTINCT FROM OLD.ingest_action) THEN
    INSERT INTO public.evidence_index_audit
      (evidence_id, old_status, new_status, old_action, new_action, reason_for_change, changed_by)
    VALUES
      (NEW.id, OLD.ingest_status, NEW.ingest_status,
       OLD.ingest_action, NEW.ingest_action,
       COALESCE(current_setting('app.trigger_reason', true), 'Automatic update'),
       auth.uid());
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS evidence_index_audit_trigger ON public.evidence_index;
CREATE TRIGGER evidence_index_audit_trigger
  AFTER UPDATE ON public.evidence_index
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_evidence_index_audit();

COMMENT ON TABLE public.evidence_index IS
  'Normalized evidence photo index from storage bucket. Tracks EXIF metadata, geo-attribution, '
  'branch assignment, and ingest workflow state for multi-branch photo reingest pipeline.';

COMMENT ON TABLE public.evidence_index_audit IS
  'Audit log for evidence_index status and action changes (compliance and debugging).';
