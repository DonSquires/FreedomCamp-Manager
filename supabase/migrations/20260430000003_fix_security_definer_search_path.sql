-- =============================================================================
-- Fix SECURITY DEFINER functions missing SET search_path TO 'public'
--
-- Without SET search_path, a SECURITY DEFINER function runs with the
-- caller's search_path, allowing a malicious caller to shadow system objects
-- (search-path injection vulnerability).
--
-- ALTER FUNCTION … SET search_path TO 'public' patches the attribute on the
-- already-deployed function without reproducing the entire body.
--
-- Functions fixed:
--   • public.migrate_legacy_vehicles  (created in 20250127000001)
--   • public.rollback_migration       (created in 20250127000001)
-- =============================================================================

ALTER FUNCTION public.migrate_legacy_vehicles(BOOLEAN, UUID, UUID)
  SET search_path TO 'public';

ALTER FUNCTION public.rollback_migration(UUID)
  SET search_path TO 'public';
