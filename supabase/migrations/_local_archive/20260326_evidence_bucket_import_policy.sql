-- ============================================================================
-- Add RLS policies for "evidence" storage bucket — import file uploads
-- Date: 2026-03-26
--
-- The import-historical-data edge function (and import-data edge function) use
-- the "evidence" bucket to store uploaded CSV/Excel files before processing:
--
--   Frontend upload path:  imports/{user-uuid}/{timestamp}_{filename}
--
-- Without an explicit INSERT policy the authenticated user receives a 403 and
-- the "Start Import" button appears to do nothing.
--
-- Policies added:
--   evidence_import_insert  – authenticated users upload to their own imports/ folder
--   evidence_import_select  – authenticated users can re-read their own uploads
--   evidence_import_delete  – authenticated users can delete their own uploads
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'evidence'
  ) THEN
    RAISE WARNING 'Bucket "evidence" does not exist yet. Create it in Supabase Dashboard → Storage, then the policies below will take effect automatically.';
  END IF;
END
$$;

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Ensure RLS is enabled on storage.objects
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

  -- ========================================================================
  -- INSERT – authenticated users upload import files to their own folder
  -- ========================================================================
  DROP POLICY IF EXISTS "evidence_import_insert" ON storage.objects;
  CREATE POLICY "evidence_import_insert" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'evidence'
      AND starts_with(name, 'imports/')
      AND split_part(name, '/', 2) = (auth.uid())::text
    );

  -- ========================================================================
  -- SELECT – authenticated users can read files they uploaded
  -- ========================================================================
  DROP POLICY IF EXISTS "evidence_import_select" ON storage.objects;
  CREATE POLICY "evidence_import_select" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'evidence'
      AND starts_with(name, 'imports/')
      AND split_part(name, '/', 2) = (auth.uid())::text
    );

  -- ========================================================================
  -- DELETE – authenticated users can clean up their own import files
  -- ========================================================================
  DROP POLICY IF EXISTS "evidence_import_delete" ON storage.objects;
  CREATE POLICY "evidence_import_delete" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'evidence'
      AND starts_with(name, 'imports/')
      AND split_part(name, '/', 2) = (auth.uid())::text
    );

  -- ========================================================================
  -- Verification (inside the same block so it is skipped when an
  -- insufficient_privilege exception aborts the creation steps above)
  -- ========================================================================
  SELECT COUNT(*)
  INTO v_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'evidence_import_insert',
      'evidence_import_select',
      'evidence_import_delete'
    );

  IF v_count < 3 THEN
    RAISE WARNING '⚠️  Expected 3 RLS policies for evidence bucket imports, found %', v_count;
  ELSE
    RAISE NOTICE '✅ All 3 RLS policies for evidence bucket (imports) are active';
  END IF;

EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING 'Skipping storage.objects policy updates: insufficient privileges for current role.';
END
$$;
