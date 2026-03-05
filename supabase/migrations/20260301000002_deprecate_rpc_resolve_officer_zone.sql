-- ========================================
-- MIGRATION: Deprecate SQL RPC Function
-- Move zone resolution logic to Edge Function
-- ========================================

-- Rename existing function if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'resolve_officer_zone'
  ) THEN
    -- Rename to legacy version
    ALTER FUNCTION resolve_officer_zone RENAME TO legacy_resolve_officer_zone;
    
    -- Add deprecation comment
    COMMENT ON FUNCTION legacy_resolve_officer_zone IS 
      'DEPRECATED: This function has been moved to Edge Function "process-field-scan" to prevent database timeouts. Use the Edge Function instead.';
    
    RAISE NOTICE 'Function "resolve_officer_zone" renamed to "legacy_resolve_officer_zone"';
  ELSE
    RAISE NOTICE 'Function "resolve_officer_zone" does not exist - no action needed';
  END IF;
END $$;


-- ========================================
-- VERIFICATION QUERY
-- ========================================

-- Check that the legacy function exists
SELECT 
  proname as function_name,
  pg_get_functiondef(oid) as definition
FROM pg_proc 
WHERE proname = 'legacy_resolve_officer_zone';
