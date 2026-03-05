-- Migration: Add COA and Warrant compliance fields to user_profiles
-- Date: 2026-02-17
-- Purpose: Support compliance credential tracking for officers

-- Add COA and Warrant fields to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS coa_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS coa_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS coa_expiry DATE,
  ADD COLUMN IF NOT EXISTS warrant_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS warrant_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS warrant_expiry DATE;

-- Add index for compliance queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_compliance 
  ON public.user_profiles(coa_required, warrant_required, coa_verified, warrant_verified);

-- Update check_organization_compliance function to include COA/Warrant checks
CREATE OR REPLACE FUNCTION public.check_organization_compliance(
  p_user_id UUID,
  p_employer_org_id UUID
)
RETURNS TABLE (
  can_work BOOLEAN,
  missing_items TEXT[],
  employer_name TEXT
) AS $$
DECLARE
  v_coa_required BOOLEAN;
  v_coa_verified BOOLEAN;
  v_warrant_required BOOLEAN;
  v_warrant_verified BOOLEAN;
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Get user compliance settings
  SELECT 
    COALESCE(coa_required, false),
    COALESCE(coa_verified, false),
    COALESCE(warrant_required, false),
    COALESCE(warrant_verified, false)
  INTO
    v_coa_required,
    v_coa_verified,
    v_warrant_required,
    v_warrant_verified
  FROM user_profiles
  WHERE id = p_user_id;

  -- Check if COA is required but not verified
  IF v_coa_required AND NOT v_coa_verified THEN
    v_missing := array_append(v_missing, 'Certificate of Approval');
  END IF;

  -- Check if Warrant is required but not verified
  IF v_warrant_required AND NOT v_warrant_verified THEN
    v_missing := array_append(v_missing, 'Freedom Camping Warrant');
  END IF;

  -- Return results
  RETURN QUERY
  SELECT 
    (array_length(v_missing, 1) IS NULL OR array_length(v_missing, 1) = 0) AS can_work,
    v_missing AS missing_items,
    org.name AS employer_name
  FROM organizations org
  WHERE org.id = p_employer_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.check_organization_compliance TO authenticated;

COMMENT ON FUNCTION public.check_organization_compliance IS 'Checks if user has required compliance credentials (COA, Warrant) before allowing work';
