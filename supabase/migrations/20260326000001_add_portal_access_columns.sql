-- ============================================================================
-- Add portal_access and extra_organization_ids to user_profiles
-- Date: 2026-03-26
--
-- These columns are required by the auth flow (authStore.ts) at login time.
-- They are also referenced by AccessControlPage and the usePermissions hook.
--
-- The full portal-access feature (view, updated get_user_organization_ids,
-- etc.) is wired in the later migration 20260430000001_portal_access_control.
-- This migration just ensures the columns exist so that login does not fail
-- with "column user_profiles.portal_access does not exist".
-- ============================================================================

-- ── portal_access ─────────────────────────────────────────────────────────────
-- List of portal / area codes the user is explicitly allowed to enter.
-- Empty array = no explicit restrictions (role-based routing applies).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS portal_access TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN public.user_profiles.portal_access IS
  'List of portal / area codes the user is allowed to enter (e.g. field_officer, '
  'admin, compliance, enforcement, reports, …). '
  'Empty array = no explicit restrictions; role-based routing applies. '
  'grand_master and master roles ignore this and can access all areas.';

-- ── extra_organization_ids ────────────────────────────────────────────────────
-- Additional org IDs beyond the primary organization_id.  Allows a user to
-- be a member of multiple organisations (e.g. a contractor officer working
-- for two branches).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS extra_organization_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

COMMENT ON COLUMN public.user_profiles.extra_organization_ids IS
  'Additional organisation IDs (beyond organization_id) the user is authorised '
  'to access.  Merged with authorized_work_locations by get_user_organization_ids() '
  'so data-access RLS automatically includes them.';

DO $$
BEGIN
  RAISE NOTICE '✅ portal_access column added to user_profiles (or already existed).';
  RAISE NOTICE '✅ extra_organization_ids column added to user_profiles (or already existed).';
END $$;
