-- ============================================
-- ADD is_homeless_exempt COLUMN TO COMPLIANCE_RESULTS
-- Fix for historical import failure
-- ============================================

-- Add the missing column that triggers are expecting
ALTER TABLE compliance_results
  ADD COLUMN IF NOT EXISTS is_homeless_exempt BOOLEAN DEFAULT false;

COMMENT ON COLUMN compliance_results.is_homeless_exempt IS 'Whether vehicle has confirmed homeless status exemption (FCA homeless exemption rules)';

-- Create index for filtering/reporting
CREATE INDEX IF NOT EXISTS idx_compliance_results_homeless_exempt 
  ON compliance_results(is_homeless_exempt) 
  WHERE is_homeless_exempt = true;

-- Verification
DO $$
DECLARE
  column_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'compliance_results' 
    AND column_name = 'is_homeless_exempt'
  ) INTO column_exists;
  
  IF column_exists THEN
    RAISE NOTICE '✅ Column is_homeless_exempt added to compliance_results';
    RAISE NOTICE '✅ Default: false (not homeless exempt)';
    RAISE NOTICE '✅ Ready for historical data import';
  ELSE
    RAISE EXCEPTION '❌ Failed to add is_homeless_exempt column';
  END IF;
END $$;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
