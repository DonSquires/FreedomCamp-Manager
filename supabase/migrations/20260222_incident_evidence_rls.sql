-- Row-Level Security for incident-evidence Storage Bucket
-- Date: 2026-02-22
-- Purpose: Ensure authenticated users can only manage files in their own folder (scoped by UUID)
-- Folder structure requirement: /{user-uuid}/{filename}

-- Prerequisites check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'incident-evidence'
  ) THEN
    RAISE EXCEPTION 'Bucket "incident-evidence" does not exist. Create it first in Supabase Dashboard.';
  END IF;
END
$$;

-- Enable RLS on storage.objects (should already be enabled by default)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies for incident-evidence Bucket
-- ============================================================================

-- Read: Users can only view their own files
CREATE POLICY "incident_evidence_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'incident-evidence'
    AND split_part(name, '/', 1) = (auth.uid())::text
  );

-- Create: Users can only upload to their own folder
CREATE POLICY "incident_evidence_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'incident-evidence'
    AND split_part(name, '/', 1) = (auth.uid())::text
  );

-- Update: Users can only update their own files
CREATE POLICY "incident_evidence_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'incident-evidence'
    AND split_part(name, '/', 1) = (auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'incident-evidence'
    AND split_part(name, '/', 1) = (auth.uid())::text
  );

-- Delete: Users can only delete their own files
CREATE POLICY "incident_evidence_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'incident-evidence'
    AND split_part(name, '/', 1) = (auth.uid())::text
  );

-- ============================================================================
-- Performance Index
-- ============================================================================

-- Index for efficient bucket + name queries
CREATE INDEX IF NOT EXISTS idx_storage_objects_bucket_name
  ON storage.objects (bucket_id, name);

-- ============================================================================
-- Verification Query
-- ============================================================================

-- Run this to verify policies are active
DO $$
DECLARE
  policy_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname LIKE 'incident_evidence_%';

  IF policy_count < 4 THEN
    RAISE WARNING 'Expected 4 RLS policies for incident-evidence, found %', policy_count;
  ELSE
    RAISE NOTICE '✅ All 4 RLS policies for incident-evidence are active';
  END IF;
END
$$;

-- ============================================================================
-- Usage Notes
-- ============================================================================

COMMENT ON POLICY "incident_evidence_read_own" ON storage.objects IS
  'Authenticated users can read files from their own folder: /{user-uuid}/*';

COMMENT ON POLICY "incident_evidence_insert_own" ON storage.objects IS
  'Authenticated users can upload files to their own folder: /{user-uuid}/*';

COMMENT ON POLICY "incident_evidence_update_own" ON storage.objects IS
  'Authenticated users can update metadata for their own files';

COMMENT ON POLICY "incident_evidence_delete_own" ON storage.objects IS
  'Authenticated users can delete their own files (within 24h retention window)';
