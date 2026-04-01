-- Migration: Organization-specific SMTP/SMS Configuration and Critical Fixes
-- Date: 2026-05-14
-- Purpose: Allow organizations to use their own email and SMS systems + critical fixes

-- ============================================================================
-- PART 1: Organization-specific SMTP/SMS Configuration
-- ============================================================================

-- Add SMTP configuration columns to organizations
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS smtp_host TEXT,
ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 587,
ADD COLUMN IF NOT EXISTS smtp_username TEXT,
ADD COLUMN IF NOT EXISTS smtp_from_email TEXT,
ADD COLUMN IF NOT EXISTS smtp_from_name TEXT,
ADD COLUMN IF NOT EXISTS use_custom_smtp BOOLEAN DEFAULT false;

-- Add SMS configuration columns to organizations
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS sms_provider TEXT CHECK (sms_provider IS NULL OR sms_provider IN ('twilio', 'vonage', 'aws_sns', 'messagebird')),
ADD COLUMN IF NOT EXISTS sms_from_number TEXT,
ADD COLUMN IF NOT EXISTS use_custom_sms BOOLEAN DEFAULT false;

-- Create secure vault table for SMTP/SMS credentials (encrypted at rest)
CREATE TABLE IF NOT EXISTS organization_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('smtp_password', 'sms_auth_token', 'sms_account_sid')),
  encrypted_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES user_profiles(id),
  UNIQUE(organization_id, credential_type)
);

-- Enable RLS on credentials table
ALTER TABLE organization_credentials ENABLE ROW LEVEL SECURITY;

-- Only admins of the org can manage credentials
CREATE POLICY "org_admins_manage_credentials" ON organization_credentials
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.organization_id = organization_credentials.organization_id
        AND user_profiles.role IN ('admin', 'master')
    )
  );

-- Comment explaining the credential storage
COMMENT ON TABLE organization_credentials IS 
'Stores encrypted credentials for organization-specific SMTP/SMS. 
Passwords should be encrypted before storage using pgcrypto or external KMS.
The encrypted_value should be decrypted only in edge functions with proper auth.';

-- ============================================================================
-- PART 2: Missing Indexes for Performance
-- ============================================================================

-- Add missing indexes on frequently queried columns
CREATE INDEX IF NOT EXISTS idx_patrols_status ON patrols(status);
CREATE INDEX IF NOT EXISTS idx_patrols_officer_id ON patrols(officer_id);
CREATE INDEX IF NOT EXISTS idx_patrols_status_officer ON patrols(status, officer_id);
CREATE INDEX IF NOT EXISTS idx_breach_alerts_created_at ON breach_alerts(created_at);

-- Add index for report templates favorites
CREATE INDEX IF NOT EXISTS idx_report_templates_favorite ON report_templates(organization_id, is_favorite) 
WHERE is_favorite = true;

-- ============================================================================
-- PART 3: Biometric Consent Cascade (Privacy Act Compliance)
-- ============================================================================

-- Create trigger function to delete face records when consent is withdrawn
CREATE OR REPLACE FUNCTION cascade_biometric_consent_withdrawal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When consent is withdrawn (status changed to 'withdrawn'), delete related face records
  IF NEW.status = 'withdrawn' AND OLD.status != 'withdrawn' THEN
    -- Delete face embeddings for this person
    DELETE FROM face_records 
    WHERE person_record_id IN (
      SELECT id FROM person_records 
      WHERE id = NEW.person_record_id
    );
    
    -- Log the deletion for audit
    INSERT INTO audit_log (
      action,
      table_name,
      record_id,
      user_id,
      organization_id,
      details,
      created_at
    ) VALUES (
      'biometric_consent_cascade_delete',
      'face_records',
      NEW.person_record_id,
      auth.uid(),
      NEW.organization_id,
      jsonb_build_object(
        'reason', 'Biometric consent withdrawn',
        'consent_id', NEW.id,
        'withdrawn_at', now()
      ),
      now()
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on biometric_consents table (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'biometric_consents') THEN
    DROP TRIGGER IF EXISTS trg_biometric_consent_withdrawal ON biometric_consents;
    CREATE TRIGGER trg_biometric_consent_withdrawal
      AFTER UPDATE ON biometric_consents
      FOR EACH ROW
      EXECUTE FUNCTION cascade_biometric_consent_withdrawal();
  END IF;
END $$;

-- ============================================================================
-- PART 4: Fix report_history FK constraint
-- ============================================================================

-- Add FK constraint on report_history.data_source_code if tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'report_history') 
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'report_data_sources') THEN
    -- First ensure all existing data_source_codes are valid
    UPDATE report_history rh
    SET data_source_code = NULL
    WHERE data_source_code IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM report_data_sources rds 
        WHERE rds.code = rh.data_source_code
      );
    
    -- Add the FK constraint
    ALTER TABLE report_history
    DROP CONSTRAINT IF EXISTS fk_report_history_data_source;
    
    ALTER TABLE report_history
    ADD CONSTRAINT fk_report_history_data_source
    FOREIGN KEY (data_source_code) REFERENCES report_data_sources(code)
    ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- PART 5: Add password complexity configuration
-- ============================================================================

-- Add password policy columns to organizations for configurable requirements
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS password_min_length INTEGER DEFAULT 8,
ADD COLUMN IF NOT EXISTS password_require_uppercase BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS password_require_lowercase BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS password_require_number BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS password_require_special BOOLEAN DEFAULT false;

-- ============================================================================
-- PART 6: Rate limiting infrastructure
-- ============================================================================

-- Create rate limiting table for edge functions
CREATE TABLE IF NOT EXISTS rate_limit_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL, -- e.g., 'ip:192.168.1.1:public-case-lookup' or 'user:uuid:create-user'
  count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT now(),
  UNIQUE(key)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_rate_limit_key ON rate_limit_entries(key);
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit_entries(window_start);

-- Function to check and increment rate limit
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER DEFAULT 100,
  p_window_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_window_start TIMESTAMPTZ;
BEGIN
  v_window_start := now() - (p_window_seconds || ' seconds')::INTERVAL;
  
  -- Try to get existing entry
  SELECT * INTO v_entry
  FROM rate_limit_entries
  WHERE key = p_key
  FOR UPDATE;
  
  IF v_entry IS NULL THEN
    -- No entry, create one
    INSERT INTO rate_limit_entries (key, count, window_start)
    VALUES (p_key, 1, now());
    RETURN true;
  ELSIF v_entry.window_start < v_window_start THEN
    -- Window expired, reset
    UPDATE rate_limit_entries
    SET count = 1, window_start = now()
    WHERE key = p_key;
    RETURN true;
  ELSIF v_entry.count >= p_max_requests THEN
    -- Rate limit exceeded
    RETURN false;
  ELSE
    -- Increment counter
    UPDATE rate_limit_entries
    SET count = count + 1
    WHERE key = p_key;
    RETURN true;
  END IF;
END;
$$;

-- Cleanup old rate limit entries periodically (call via cron)
CREATE OR REPLACE FUNCTION cleanup_rate_limit_entries()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM rate_limit_entries
  WHERE window_start < now() - INTERVAL '1 hour';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Grant execute to authenticated users for rate limiting
GRANT EXECUTE ON FUNCTION check_rate_limit TO authenticated;
GRANT EXECUTE ON FUNCTION check_rate_limit TO service_role;

-- ============================================================================
-- PART 7: Add audit triggers for core tables
-- ============================================================================

-- Generic audit trigger function
CREATE OR REPLACE FUNCTION audit_table_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_old_data JSONB;
  v_new_data JSONB;
BEGIN
  -- Try to get organization_id from the record
  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD);
    v_org_id := OLD.organization_id;
  ELSE
    v_new_data := to_jsonb(NEW);
    v_org_id := NEW.organization_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_data := to_jsonb(OLD);
  END IF;

  INSERT INTO audit_log (
    action,
    table_name,
    record_id,
    user_id,
    organization_id,
    details,
    created_at
  ) VALUES (
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    auth.uid(),
    v_org_id,
    jsonb_build_object(
      'old', v_old_data,
      'new', v_new_data
    ),
    now()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Add audit triggers to core tables (only if they don't exist)
DO $$
DECLARE
  tables TEXT[] := ARRAY['zones', 'incidents'];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_%s_changes ON %I', t, t);
      EXECUTE format(
        'CREATE TRIGGER audit_%s_changes 
         AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION audit_table_changes()',
        t, t
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- PART 8: Fix USING (true) RLS policies - add organization scoping
-- ============================================================================

-- Note: This creates more restrictive policies. Existing data access patterns
-- should be verified before applying in production.

-- Example fix for nzscv_cache (if it exists and has the permissive policy)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nzscv_cache') THEN
    -- Drop overly permissive policy
    DROP POLICY IF EXISTS "users_view_nzscv_cache" ON nzscv_cache;
    
    -- Create org-scoped policy
    CREATE POLICY "org_users_view_nzscv_cache" ON nzscv_cache
      FOR SELECT USING (
        organization_id IN (
          SELECT get_user_organization_ids(auth.uid())
        )
        OR EXISTS (
          SELECT 1 FROM user_profiles
          WHERE id = auth.uid() AND role IN ('master', 'grand_master')
        )
      );
  END IF;
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN organizations.smtp_host IS 'Custom SMTP server hostname for this organization';
COMMENT ON COLUMN organizations.use_custom_smtp IS 'Whether to use org-specific SMTP instead of global';
COMMENT ON COLUMN organizations.sms_provider IS 'SMS provider: twilio, vonage, aws_sns, or messagebird';
COMMENT ON COLUMN organizations.use_custom_sms IS 'Whether to use org-specific SMS instead of global';
COMMENT ON COLUMN organizations.password_min_length IS 'Minimum password length for users in this org';
COMMENT ON FUNCTION check_rate_limit IS 'Check and increment rate limit counter. Returns true if allowed, false if rate limited.';
