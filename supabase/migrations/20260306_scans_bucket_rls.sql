-- ============================================================================
-- Row-Level Security for "scans" Storage Bucket
-- Date: 2026-03-06
--
-- The "scans" bucket is PUBLIC (read-only without auth).
-- Authenticated users upload files to their own /{user-uuid}/ folder.
--
-- File path structure enforced by the frontend:
--   /{user-uuid}/{timestamp}-{hash}.jpg
--
-- Policies:
--   scans_public_select   – anyone can read (public bucket)
--   scans_user_insert     – authenticated users can upload to own folder
--   scans_user_delete     – authenticated users can delete own files
-- ============================================================================

-- Prerequisites check (bucket must exist – created via Supabase Dashboard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'scans'
  ) THEN
    RAISE WARNING 'Bucket "scans" does not exist yet. Create it in Supabase Dashboard → Storage, then the policies below will take effect automatically.';
  END IF;
END
$$;

-- Ensure RLS is enabled on storage.objects when permissions allow.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'Skipping ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY due to ownership constraints';
  END;
END
$$;

-- ============================================================================
-- SELECT – public read (bucket is public; policy keeps this explicit)
-- ============================================================================
DROP POLICY IF EXISTS "scans_public_select" ON storage.objects;
CREATE POLICY "scans_public_select" ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'scans');

-- ============================================================================
-- INSERT – authenticated users can upload to their own folder only
-- ============================================================================
DROP POLICY IF EXISTS "scans_user_insert" ON storage.objects;
CREATE POLICY "scans_user_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'scans'
    AND split_part(name, '/', 1) = (auth.uid())::text
  );

-- ============================================================================
-- DELETE – authenticated users can delete their own files
-- ============================================================================
DROP POLICY IF EXISTS "scans_user_delete" ON storage.objects;
CREATE POLICY "scans_user_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'scans'
    AND split_part(name, '/', 1) = (auth.uid())::text
  );

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'scans_public_select',
      'scans_user_insert',
      'scans_user_delete'
    );

  IF v_count < 3 THEN
    RAISE WARNING '⚠️  Expected 3 RLS policies for scans bucket, found %', v_count;
  ELSE
    RAISE NOTICE '✅ All 3 RLS policies for scans bucket are active';
  END IF;
END
$$;
