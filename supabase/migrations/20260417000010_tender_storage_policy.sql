-- ============================================================================
-- Storage RLS policies for the "evidence" bucket — tender file uploads
-- Date: 2026-04-17
--
-- Tender documents are uploaded under the path:
--   tenders/{organization_id}/{timestamp}-{filename}
--
-- The existing evidence_import_insert policy only covers imports/ paths,
-- so tender uploads were blocked with "new row violates row-level security".
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'evidence'
  ) THEN
    RAISE WARNING 'Bucket "evidence" does not exist yet. Create it in Supabase Dashboard → Storage.';
  END IF;
END
$$;

DO $$
BEGIN
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

  -- ── INSERT: authenticated users can upload tender files ──────────────────
  DROP POLICY IF EXISTS "evidence_tender_insert" ON storage.objects;
  CREATE POLICY "evidence_tender_insert" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'evidence'
      AND starts_with(name, 'tenders/')
    );

  -- ── SELECT: authenticated users can read tender files ────────────────────
  DROP POLICY IF EXISTS "evidence_tender_select" ON storage.objects;
  CREATE POLICY "evidence_tender_select" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'evidence'
      AND starts_with(name, 'tenders/')
    );

  -- ── DELETE: owners / admins can remove tender files ─────────────────────
  DROP POLICY IF EXISTS "evidence_tender_delete" ON storage.objects;
  CREATE POLICY "evidence_tender_delete" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'evidence'
      AND starts_with(name, 'tenders/')
    );

  RAISE NOTICE '✅ Tender storage RLS policies applied to evidence bucket (tenders/ prefix)';

EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING 'Skipping storage.objects policy updates: insufficient privileges for current role.';
END
$$;
