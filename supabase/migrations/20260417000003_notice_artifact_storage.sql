-- ============================================================================
-- Dedicated Storage + Columns for Infringement Notice HTML Artifacts
-- Date: 2026-04-17
--
-- Purpose:
-- - move printable infringement HTML artifacts off the public scans bucket
-- - store artifact metadata under accurately named columns
-- - provide org-scoped authenticated read access to private notice artifacts
-- ============================================================================

ALTER TABLE public.infringement_notices
  ADD COLUMN IF NOT EXISTS notice_html_path TEXT,
  ADD COLUMN IF NOT EXISTS notice_html_hash TEXT;

COMMENT ON COLUMN public.infringement_notices.notice_html_path IS
  'Private Supabase Storage object path for the rendered printable HTML artifact';
COMMENT ON COLUMN public.infringement_notices.notice_html_hash IS
  'SHA-256 hash of the stored printable HTML artifact';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'notice-artifacts'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'notice-artifacts',
      'notice-artifacts',
      false,
      5242880,
      ARRAY['text/html']
    );
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING 'Could not create notice-artifacts bucket automatically; create it in the dashboard if missing.';
END
$$;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notice_artifacts_org_select" ON storage.objects;
CREATE POLICY "notice_artifacts_org_select" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'notice-artifacts'
    AND split_part(name, '/', 1) = 'infringements'
    AND EXISTS (
      SELECT 1
      FROM unnest(get_user_organization_ids()) AS org_id
      WHERE org_id::text = split_part(name, '/', 2)
    )
  );

DROP POLICY IF EXISTS "notice_artifacts_admin_delete" ON storage.objects;
CREATE POLICY "notice_artifacts_admin_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'notice-artifacts'
    AND split_part(name, '/', 1) = 'infringements'
    AND EXISTS (
      SELECT 1
      FROM unnest(get_user_organization_ids()) AS org_id
      WHERE org_id::text = split_part(name, '/', 2)
    )
    AND get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text])
  );

CREATE INDEX IF NOT EXISTS idx_infringement_notices_notice_html_path
  ON public.infringement_notices (notice_html_path)
  WHERE notice_html_path IS NOT NULL;
