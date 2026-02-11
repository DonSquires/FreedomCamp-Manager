-- =====================================================
-- NZ TIMEZONE STANDARDIZATION
-- =====================================================
-- Set database timezone to Pacific/Auckland (NZST/NZDT)
-- All timestamp operations will use NZ timezone by default
-- =====================================================

-- Set database timezone
ALTER DATABASE postgres SET timezone TO 'Pacific/Auckland';

-- Create helper function for NZ current timestamp
CREATE OR REPLACE FUNCTION nz_now() RETURNS TIMESTAMPTZ AS $$
  SELECT CURRENT_TIMESTAMP AT TIME ZONE 'Pacific/Auckland';
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION nz_now() IS 'Returns current timestamp in NZ timezone (Pacific/Auckland)';

-- Create helper function for NZ date (date only, no time)
CREATE OR REPLACE FUNCTION nz_current_date() RETURNS DATE AS $$
  SELECT CURRENT_DATE AT TIME ZONE 'Pacific/Auckland';
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION nz_current_date() IS 'Returns current date in NZ timezone';

-- Migration summary
DO $$
BEGIN
  RAISE NOTICE '✅ NZ Timezone Standardization Complete';
  RAISE NOTICE '   - Database timezone set to Pacific/Auckland';
  RAISE NOTICE '   - Created nz_now() helper function';
  RAISE NOTICE '   - Created nz_current_date() helper function';
  RAISE NOTICE '   ⚠️  All existing timestamps remain unchanged';
  RAISE NOTICE '   ⚠️  Future inserts will use NZ timezone';
END $$;
