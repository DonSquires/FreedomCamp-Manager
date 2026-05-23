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

-- Update check_organization_compliance while preserving the established
-- JSONB return contract used by earlier dashboard migrations.
DROP FUNCTION IF EXISTS public.check_organization_compliance(UUID, UUID);

CREATE OR REPLACE FUNCTION public.check_organization_compliance(
  p_user_id UUID,
  p_employer_org_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_org record;
  v_coa_required BOOLEAN;
  v_coa_verified BOOLEAN;
  v_has_warrant BOOLEAN;
  v_warrant_required BOOLEAN;
  v_warrant_verified BOOLEAN;
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_warnings TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Get organization-level requirements.
  SELECT requires_coa, requires_warrant_for_enforcement, name
  INTO v_org
  FROM organizations
  WHERE id = p_employer_org_id;

  -- Get user compliance settings (including compatibility fields).
  SELECT 
    COALESCE(coa_required, COALESCE(v_org.requires_coa, false)),
    COALESCE(coa_verified, false),
    COALESCE(has_warrant, false),
    COALESCE(warrant_required, COALESCE(v_org.requires_warrant_for_enforcement, false)),
    COALESCE(warrant_verified, false)
  INTO
    v_coa_required,
    v_coa_verified,
    v_has_warrant,
    v_warrant_required,
    v_warrant_verified
  FROM user_profiles
  WHERE id = p_user_id;

  -- Check if COA is required but not verified.
  IF v_coa_required AND NOT v_coa_verified THEN
    v_missing := array_append(v_missing, 'Certificate of Approval');
  END IF;

  -- Check if warrant is required but not verified.
  IF v_warrant_required AND NOT v_warrant_verified THEN
    v_missing := array_append(v_missing, 'Freedom Camping Warrant');
  END IF;

  -- Compatibility warning: officer can patrol but cannot enforce without warrant.
  IF NOT v_has_warrant THEN
    v_warnings := array_append(v_warnings, 'No warrant - cannot issue enforcement actions');
  END IF;

  RETURN jsonb_build_object(
    'can_login', true,
    'can_work', cardinality(v_missing) = 0,
    'can_enforce', v_has_warrant AND v_warrant_verified,
    'missing_items', v_missing,
    'warnings', v_warnings,
    'requires_coa', COALESCE(v_org.requires_coa, false),
    'requires_warrant', COALESCE(v_org.requires_warrant_for_enforcement, false),
    'compliance_status', CASE WHEN cardinality(v_missing) = 0 THEN 'valid' ELSE 'pending' END,
    'employer_name', v_org.name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.check_organization_compliance(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.check_organization_compliance(UUID, UUID) IS 'Checks organization compliance and returns JSONB capability/status payload used by officer dashboards';
