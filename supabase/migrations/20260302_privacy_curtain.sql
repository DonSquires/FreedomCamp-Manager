-- ===========================================
-- PRIVACY CURTAIN
-- Auto-redaction access controls for Privacy Act 2020 compliance.
-- Records when PII fields are accessed and by whom.
-- ===========================================

-- Privacy curtain settings per organization
CREATE TABLE IF NOT EXISTS privacy_curtain_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  auto_redact_enabled BOOLEAN NOT NULL DEFAULT true,
  redact_owner_name BOOLEAN NOT NULL DEFAULT true,
  redact_owner_address BOOLEAN NOT NULL DEFAULT true,
  redact_phone_number BOOLEAN NOT NULL DEFAULT true,
  redact_plate_in_exports BOOLEAN NOT NULL DEFAULT false,
  require_reason_for_unredact BOOLEAN NOT NULL DEFAULT true,
  unredact_roles TEXT[] NOT NULL DEFAULT ARRAY['admin', 'master'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unredaction request log (Privacy Act 2020 s22-s27 access principles)
CREATE TABLE IF NOT EXISTS privacy_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor UUID NOT NULL REFERENCES user_profiles(id),
  target_table TEXT NOT NULL,
  target_record_id TEXT NOT NULL,
  field_accessed TEXT NOT NULL,
  access_reason TEXT,
  ip_address INET,
  user_agent TEXT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_privacy_access_log_org ON privacy_access_log(organization_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_access_log_actor ON privacy_access_log(actor, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_access_log_record ON privacy_access_log(target_table, target_record_id, accessed_at DESC);

COMMENT ON TABLE privacy_curtain_settings IS 'Per-org Privacy Act 2020 auto-redaction configuration';
COMMENT ON TABLE privacy_access_log IS 'Immutable audit log of PII field access (Privacy Act 2020 s22-s27 compliance)';

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE privacy_curtain_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_privacy_settings"
  ON privacy_curtain_settings FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
    )
  );

CREATE POLICY "system_insert_privacy_access_log"
  ON privacy_access_log FOR INSERT
  TO authenticated
  WITH CHECK (actor = auth.uid());

CREATE POLICY "admins_read_privacy_access_log"
  ON privacy_access_log FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master')
    )
  );

-- ===========================================
-- UPDATED-AT TRIGGER
-- ===========================================

DROP TRIGGER IF EXISTS update_privacy_curtain_settings_updated_at ON privacy_curtain_settings;
CREATE TRIGGER update_privacy_curtain_settings_updated_at
  BEFORE UPDATE ON privacy_curtain_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
