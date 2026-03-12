-- ============================================================================
-- INFRINGEMENT NOTICES: FK FIX + COLUMN ENRICHMENT + ADMIN_OFFICER RLS
-- ============================================================================
-- The 20260220_core_pipeline_rebuild.sql created enforcement_cases with a FK
-- to observations, which was dropped by 20260221_rebuild_observations_clean.sql
-- (CASCADE propagation means the FK is already gone; this migration re-adds it
-- pointing to the current `observations` table and enriches infringement_notices).
-- ============================================================================

-- 1. Fix enforcement_cases.observation_id FK → observations
ALTER TABLE enforcement_cases
  DROP COLUMN IF EXISTS observation_id;

ALTER TABLE enforcement_cases
  ADD COLUMN IF NOT EXISTS observation_id uuid REFERENCES observations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_enforcement_cases_observation
  ON enforcement_cases(observation_id);

-- 2. Add breach alert link
ALTER TABLE enforcement_cases
  ADD COLUMN IF NOT EXISTS breach_alert_id uuid REFERENCES breach_alerts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_enforcement_cases_breach_alert
  ON enforcement_cases(breach_alert_id);

-- 3. Enrich infringement_notices with columns needed for the ADR/TicketOr2 style workflow
ALTER TABLE infringement_notices
  ADD COLUMN IF NOT EXISTS organization_id  uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS observation_id   uuid REFERENCES observations(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS breach_alert_id  uuid REFERENCES breach_alerts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plate_number     text,
  ADD COLUMN IF NOT EXISTS offence_description text,
  ADD COLUMN IF NOT EXISTS legal_basis      text,                        -- e.g. "FCA s20(1)(a); Auckland Bylaw 12.7"
  ADD COLUMN IF NOT EXISTS offence_location text,
  ADD COLUMN IF NOT EXISTS offence_date     timestamptz,
  ADD COLUMN IF NOT EXISTS service_method   text CHECK (service_method IN ('hand', 'post', 'email')),
  ADD COLUMN IF NOT EXISTS recipient_name   text,
  ADD COLUMN IF NOT EXISTS recipient_email  text,
  ADD COLUMN IF NOT EXISTS recipient_address text,
  ADD COLUMN IF NOT EXISTS summary_of_rights text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_methods  jsonb DEFAULT '["bank_transfer","online"]'::jsonb,
  ADD COLUMN IF NOT EXISTS served_at        timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS court_referral_date date,
  ADD COLUMN IF NOT EXISTS withdrawn_reason text,
  ADD COLUMN IF NOT EXISTS notice_pdf_url   text,
  ADD COLUMN IF NOT EXISTS zone_id          uuid REFERENCES zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz DEFAULT now();

-- Default status values compatible with the workflow
-- Existing CHECK: status text NOT NULL DEFAULT 'issued'
-- We widen it to support the full workflow
ALTER TABLE infringement_notices
  DROP CONSTRAINT IF EXISTS infringement_notices_status_check;

ALTER TABLE infringement_notices
  ADD CONSTRAINT infringement_notices_status_check
    CHECK (status IN ('draft', 'issued', 'paid', 'reminder_sent', 'court_referred', 'withdrawn', 'cancelled'));

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_infringement_notices_org    ON infringement_notices(organization_id);
CREATE INDEX IF NOT EXISTS idx_infringement_notices_plate  ON infringement_notices(plate_number);
CREATE INDEX IF NOT EXISTS idx_infringement_notices_status ON infringement_notices(status);
CREATE INDEX IF NOT EXISTS idx_infringement_notices_zone   ON infringement_notices(zone_id);

-- 5. RLS — extend to admin_officer role (can issue and view)
--    The 20260220 migration created org_users_view and org_admins_manage policies
--    We ensure admin_officer can also INSERT (issue) and UPDATE (workflow)

DROP POLICY IF EXISTS admin_officer_manage_infringement_notices ON infringement_notices;
CREATE POLICY admin_officer_manage_infringement_notices
  ON infringement_notices FOR ALL
  USING (
    get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- Officers can view their org's notices
DROP POLICY IF EXISTS officers_view_infringement_notices ON infringement_notices;
CREATE POLICY officers_view_infringement_notices
  ON infringement_notices FOR SELECT
  USING (
    get_user_role(auth.uid()) IN ('officer')
    AND organization_id = get_user_organization_id(auth.uid())
  );

-- 6. enforcement_cases RLS — allow admin_officer role
DROP POLICY IF EXISTS admin_officer_manage_enforcement_cases ON enforcement_cases;
CREATE POLICY admin_officer_manage_enforcement_cases
  ON enforcement_cases FOR ALL
  USING (
    get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- 7. Updated-at trigger for infringement_notices
CREATE OR REPLACE FUNCTION update_infringement_notices_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_infringement_notices_updated_at ON infringement_notices;
CREATE TRIGGER update_infringement_notices_updated_at
  BEFORE UPDATE ON infringement_notices
  FOR EACH ROW EXECUTE FUNCTION update_infringement_notices_updated_at();

-- 8. Auto-generate notice_number sequence helper
CREATE OR REPLACE FUNCTION generate_infringement_number(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prefix text;
  v_seq    integer;
  v_year   text;
BEGIN
  v_year := to_char(now(), 'YY');
  SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(notice_number, '[^0-9]', '', 'g'), '') AS integer)), 0) + 1
    INTO v_seq
    FROM infringement_notices
   WHERE organization_id = p_org_id
     AND notice_number LIKE 'INF-' || v_year || '-%';
  RETURN 'INF-' || v_year || '-' || LPAD(v_seq::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_infringement_number(uuid) TO authenticated;

COMMENT ON TABLE infringement_notices IS 'FCA s20 infringement notices — fines issued to freedom camping vehicles in breach. Mirrors ADR/TicketOr2 workflow.';
COMMENT ON COLUMN infringement_notices.legal_basis IS 'FCA section and/or bylaw clause, e.g. "FCA 2011 s20(1)(a); Auckland Council Bylaw 2024/12 cl 7.2"';
COMMENT ON COLUMN infringement_notices.summary_of_rights IS 'Statutory summary per FCA/DOC guidance: right to pay, deny, request hearing, timeframes';
COMMENT ON COLUMN infringement_notices.amount_cents IS 'Fine amount in cents (NZD). Default NZ freedom camping fine is $200 = 20000 cents';
