-- PTT clip storage hardening
-- Enforce org-scoped object paths for ptt-clips bucket.
-- Expected object key format:
--   <organization_id>/<channel_scope>/<timestamp-random>.webm

DROP POLICY IF EXISTS ptt_clips_select_authenticated ON storage.objects;
CREATE POLICY ptt_clips_select_authenticated
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'ptt-clips'
  AND split_part(name, '/', 1) <> ''
  AND (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_active = true
        AND up.role IN ('master', 'grand_master')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_active = true
        AND (
          split_part(name, '/', 1) = up.organization_id::text
          OR split_part(name, '/', 1) = up.employer_organization_id::text
          OR split_part(name, '/', 1) = ANY(COALESCE(up.authorized_work_locations::text[], ARRAY[]::text[]))
          OR split_part(name, '/', 1) = ANY(COALESCE(up.extra_organization_ids::text[], ARRAY[]::text[]))
        )
    )
  )
);

DROP POLICY IF EXISTS ptt_clips_insert_authenticated ON storage.objects;
CREATE POLICY ptt_clips_insert_authenticated
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'ptt-clips'
  AND split_part(name, '/', 1) <> ''
  AND (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_active = true
        AND up.role IN ('master', 'grand_master')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_active = true
        AND (
          split_part(name, '/', 1) = up.organization_id::text
          OR split_part(name, '/', 1) = up.employer_organization_id::text
          OR split_part(name, '/', 1) = ANY(COALESCE(up.authorized_work_locations::text[], ARRAY[]::text[]))
          OR split_part(name, '/', 1) = ANY(COALESCE(up.extra_organization_ids::text[], ARRAY[]::text[]))
        )
    )
  )
);
