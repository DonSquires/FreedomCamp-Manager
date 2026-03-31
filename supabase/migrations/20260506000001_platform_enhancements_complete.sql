-- =============================================================================
-- PLATFORM ENHANCEMENTS — COMPLETE IMPLEMENTATION
-- =============================================================================
-- This migration implements ALL recommended enhancements:
--
-- 🔴 HIGH PRIORITY (Regulatory Compliance):
--   1. NZ Privacy Act 2020 Compliance
--   2. NZ Private Security Personnel Act Compliance  
--   3. Freedom Camping Act Green Warrant Integration
--
-- 🟠 MEDIUM PRIORITY (Business Logic):
--   4. Workflow Automation Engine
--   5. Email Templates & Communication History
--   6. Custom Fields System
--   7. SLA Monitoring & Breach Alerts
--
-- 🟡 LOWER PRIORITY (Technical):
--   8. API Webhooks
--   9. Rate Limiting
--   10. Data Export System
--
-- =============================================================================

-- =============================================================================
-- 1. NZ PRIVACY ACT 2020 COMPLIANCE
-- =============================================================================
-- Implements consent tracking and Data Subject Access Request (DSAR) handling
-- as required by the NZ Privacy Act 2020.

-- Privacy consent tracking
CREATE TABLE IF NOT EXISTS privacy_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Subject (who gave consent)
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'contact',       -- CRM contact
    'officer',       -- Security officer
    'vehicle_owner', -- Vehicle owner from NZSCV/Motoweb
    'incident_party', -- Person involved in incident
    'camper',        -- Freedom camper
    'employee'       -- Employee of client
  )),
  subject_id UUID,           -- Reference to the entity (contact_id, user_id, etc.)
  subject_email TEXT,        -- Email for identification
  subject_name TEXT,         -- Name for display
  
  -- Consent details
  consent_type TEXT NOT NULL CHECK (consent_type IN (
    'data_collection',          -- Basic data collection
    'data_processing',          -- Processing personal data
    'marketing_email',          -- Email marketing
    'marketing_sms',            -- SMS marketing
    'data_sharing_third_party', -- Sharing with third parties
    'facial_recognition',       -- Face recognition processing
    'location_tracking',        -- GPS/location tracking
    'alpr_scanning',            -- ALPR/plate scanning
    'photo_capture',            -- Photo/video capture
    'background_check'          -- Police vetting/background checks
  )),
  
  -- Consent status
  consented BOOLEAN NOT NULL,
  consent_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_source TEXT CHECK (consent_source IN (
    'web_form',
    'mobile_app',
    'verbal',
    'signed_document',
    'email_confirmation',
    'implied'  -- E.g., entering a monitored area
  )),
  consent_document_url TEXT,  -- Link to signed consent form
  ip_address INET,
  user_agent TEXT,
  
  -- Withdrawal
  withdrawn_at TIMESTAMPTZ,
  withdrawal_reason TEXT,
  withdrawal_method TEXT,
  
  -- Data retention
  retention_period_days INTEGER DEFAULT 2555,  -- ~7 years default
  retention_expires_at TIMESTAMPTZ,
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_privacy_consents_org ON privacy_consents(organization_id);
CREATE INDEX IF NOT EXISTS idx_privacy_consents_subject ON privacy_consents(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_privacy_consents_email ON privacy_consents(subject_email);
CREATE INDEX IF NOT EXISTS idx_privacy_consents_type ON privacy_consents(consent_type);
CREATE INDEX IF NOT EXISTS idx_privacy_consents_expiry ON privacy_consents(retention_expires_at) 
  WHERE retention_expires_at IS NOT NULL;

-- Data Subject Access Requests (DSAR)
-- NZ Privacy Act requires response within 20 working days
CREATE TABLE IF NOT EXISTS data_subject_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),  -- NULL if platform-wide
  
  -- Request type (NZ Privacy Act rights)
  request_type TEXT NOT NULL CHECK (request_type IN (
    'access',       -- IPP 6: Right to access personal information
    'correction',   -- IPP 7: Right to request correction
    'erasure',      -- Right to be forgotten (GDPR-style, good practice)
    'portability',  -- Right to data export
    'restriction',  -- Right to restrict processing
    'objection',    -- Right to object to processing
    'complaint'     -- Privacy complaint
  )),
  
  -- Requestor details
  requestor_email TEXT NOT NULL,
  requestor_name TEXT NOT NULL,
  requestor_phone TEXT,
  requestor_address TEXT,
  
  -- Verification
  identity_verified BOOLEAN DEFAULT FALSE,
  verification_method TEXT,
  verification_date TIMESTAMPTZ,
  verified_by UUID REFERENCES user_profiles(id),
  
  -- Request details
  request_description TEXT NOT NULL,
  data_categories TEXT[],  -- What data they're asking about
  date_range_from DATE,
  date_range_to DATE,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- Awaiting review
    'verified',     -- Identity verified, processing
    'in_progress',  -- Being worked on
    'on_hold',      -- Waiting for more info
    'completed',    -- Request fulfilled
    'partially_completed', -- Partial fulfillment
    'rejected',     -- Request denied (with reason)
    'withdrawn',    -- Requestor withdrew
    'escalated'     -- Escalated to Privacy Commissioner
  )),
  
  -- Timing (20 working days in NZ)
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  due_date DATE NOT NULL,  -- Calculated from received_at
  extended_due_date DATE,  -- If extension requested
  extension_reason TEXT,
  completed_at TIMESTAMPTZ,
  
  -- Response
  response_summary TEXT,
  response_document_url TEXT,
  data_export_url TEXT,
  rejection_reason TEXT,
  
  -- Assignment
  assigned_to UUID REFERENCES user_profiles(id),
  handled_by UUID REFERENCES user_profiles(id),
  
  -- Escalation
  escalated_to_commissioner BOOLEAN DEFAULT FALSE,
  commissioner_reference TEXT,
  
  -- Audit
  internal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsar_org ON data_subject_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_dsar_status ON data_subject_requests(status);
CREATE INDEX IF NOT EXISTS idx_dsar_due_date ON data_subject_requests(due_date) WHERE status NOT IN ('completed', 'rejected', 'withdrawn');
CREATE INDEX IF NOT EXISTS idx_dsar_email ON data_subject_requests(requestor_email);

-- Function to calculate DSAR due date (20 working days in NZ)
CREATE OR REPLACE FUNCTION calculate_dsar_due_date(received TIMESTAMPTZ)
RETURNS DATE
LANGUAGE plpgsql
AS $$
DECLARE
  working_days INTEGER := 0;
  current_date DATE := received::DATE;
BEGIN
  WHILE working_days < 20 LOOP
    current_date := current_date + INTERVAL '1 day';
    -- Skip weekends (0 = Sunday, 6 = Saturday in PostgreSQL)
    IF EXTRACT(DOW FROM current_date) NOT IN (0, 6) THEN
      -- TODO: Could add NZ public holiday check here
      working_days := working_days + 1;
    END IF;
  END LOOP;
  RETURN current_date;
END;
$$;

-- Trigger to set due date on DSAR creation
CREATE OR REPLACE FUNCTION set_dsar_due_date()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := calculate_dsar_due_date(NEW.received_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_dsar_due_date
  BEFORE INSERT ON data_subject_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_dsar_due_date();

-- =============================================================================
-- 2. NZ PRIVATE SECURITY PERSONNEL ACT COMPLIANCE
-- =============================================================================
-- Track COA (Certificate of Approval) and other officer credentials

-- Add COA fields to user_profiles if not exists
DO $$
BEGIN
  -- COA Number
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'coa_number') THEN
    ALTER TABLE user_profiles ADD COLUMN coa_number TEXT;
  END IF;
  
  -- COA Class
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'coa_class') THEN
    ALTER TABLE user_profiles ADD COLUMN coa_class TEXT;
  END IF;
  
  -- COA Expiry
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'coa_expiry_date') THEN
    ALTER TABLE user_profiles ADD COLUMN coa_expiry_date DATE;
  END IF;
  
  -- COA Verification
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'coa_verified') THEN
    ALTER TABLE user_profiles ADD COLUMN coa_verified BOOLEAN DEFAULT FALSE;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'coa_verification_date') THEN
    ALTER TABLE user_profiles ADD COLUMN coa_verification_date TIMESTAMPTZ;
  END IF;
  
  -- First Aid Certificate
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'first_aid_cert_number') THEN
    ALTER TABLE user_profiles ADD COLUMN first_aid_cert_number TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'first_aid_expiry') THEN
    ALTER TABLE user_profiles ADD COLUMN first_aid_expiry DATE;
  END IF;
  
  -- Driver's License
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'driver_license_class') THEN
    ALTER TABLE user_profiles ADD COLUMN driver_license_class TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'driver_license_expiry') THEN
    ALTER TABLE user_profiles ADD COLUMN driver_license_expiry DATE;
  END IF;
  
  -- Police Vetting
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'police_vetting_date') THEN
    ALTER TABLE user_profiles ADD COLUMN police_vetting_date DATE;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'police_vetting_expires') THEN
    ALTER TABLE user_profiles ADD COLUMN police_vetting_expires DATE;
  END IF;
END $$;

-- Add constraint for COA class
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_coa_class_check') THEN
    ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_coa_class_check
      CHECK (coa_class IS NULL OR coa_class IN (
        'crowd_controller',     -- CC
        'personal_guard',       -- PG
        'property_guard',       -- PrG
        'security_consultant',  -- SC
        'security_technician',  -- ST
        'private_investigator', -- PI
        'confidential_document_destruction', -- CDD
        'repossession_agent'    -- RA
      ));
  END IF;
END $$;

-- Officer compliance alerts table
CREATE TABLE IF NOT EXISTS officer_compliance_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  officer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'coa_expiring_90_days',
    'coa_expiring_30_days',
    'coa_expiring_7_days',
    'coa_expired',
    'first_aid_expiring_30_days',
    'first_aid_expiring_7_days',
    'first_aid_expired',
    'license_expiring_30_days',
    'license_expiring_7_days',
    'license_expired',
    'police_vetting_due',
    'police_vetting_overdue',
    'training_due',
    'training_overdue'
  )),
  
  -- Alert details
  credential_type TEXT NOT NULL,
  expiry_date DATE,
  days_until_expiry INTEGER,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES user_profiles(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES user_profiles(id),
  resolution_notes TEXT,
  
  -- Notifications
  email_sent_at TIMESTAMPTZ,
  sms_sent_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_alerts_org ON officer_compliance_alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_officer ON officer_compliance_alerts(officer_id);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_active ON officer_compliance_alerts(organization_id, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_type ON officer_compliance_alerts(alert_type);

-- Officer training records
CREATE TABLE IF NOT EXISTS officer_training_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  officer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Training details
  training_type TEXT NOT NULL CHECK (training_type IN (
    'induction',
    'first_aid',
    'cpr',
    'health_safety',
    'fire_safety',
    'conflict_resolution',
    'de_escalation',
    'defensive_tactics',
    'baton_certification',
    'handcuff_certification',
    'patrol_procedures',
    'report_writing',
    'legal_powers',
    'evidence_handling',
    'data_protection',
    'customer_service',
    'site_specific',
    'refresher',
    'other'
  )),
  
  training_name TEXT NOT NULL,
  training_provider TEXT,
  certificate_number TEXT,
  
  -- Dates
  completed_date DATE NOT NULL,
  expiry_date DATE,
  next_due_date DATE,
  
  -- Documentation
  certificate_url TEXT,
  notes TEXT,
  
  -- Verification
  verified BOOLEAN DEFAULT FALSE,
  verified_by UUID REFERENCES user_profiles(id),
  verified_at TIMESTAMPTZ,
  
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_records_org ON officer_training_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_training_records_officer ON officer_training_records(officer_id);
CREATE INDEX IF NOT EXISTS idx_training_records_expiry ON officer_training_records(expiry_date) WHERE expiry_date IS NOT NULL;

-- =============================================================================
-- 3. FREEDOM CAMPING ACT — GREEN WARRANT INTEGRATION
-- =============================================================================
-- Update NZSCV integration for new green warrant system (replacing blue stickers)

-- Enhance canonical_scv table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'canonical_scv') THEN
    -- Certification type
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'canonical_scv' AND column_name = 'certification_type') THEN
      ALTER TABLE canonical_scv ADD COLUMN certification_type TEXT DEFAULT 'blue_sticker';
    END IF;
    
    -- Fixed toilet (required for green warrant)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'canonical_scv' AND column_name = 'has_fixed_toilet') THEN
      ALTER TABLE canonical_scv ADD COLUMN has_fixed_toilet BOOLEAN;
    END IF;
    
    -- Waste holding tank
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'canonical_scv' AND column_name = 'waste_holding_tank_litres') THEN
      ALTER TABLE canonical_scv ADD COLUMN waste_holding_tank_litres INTEGER;
    END IF;
    
    -- Fresh water tank
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'canonical_scv' AND column_name = 'fresh_water_tank_litres') THEN
      ALTER TABLE canonical_scv ADD COLUMN fresh_water_tank_litres INTEGER;
    END IF;
    
    -- Last inspection
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'canonical_scv' AND column_name = 'last_inspection_date') THEN
      ALTER TABLE canonical_scv ADD COLUMN last_inspection_date DATE;
    END IF;
    
    -- Certification issuer
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'canonical_scv' AND column_name = 'certification_issuer') THEN
      ALTER TABLE canonical_scv ADD COLUMN certification_issuer TEXT;
    END IF;
    
    -- Add constraint for certification type
    ALTER TABLE canonical_scv DROP CONSTRAINT IF EXISTS canonical_scv_certification_type_check;
    ALTER TABLE canonical_scv ADD CONSTRAINT canonical_scv_certification_type_check
      CHECK (certification_type IS NULL OR certification_type IN (
        'blue_sticker',   -- Legacy (valid until June 2026)
        'green_warrant',  -- New standard
        'none',           -- Not self-contained
        'expired'         -- Certification expired
      ));
  END IF;
END $$;

-- =============================================================================
-- 4. WORKFLOW AUTOMATION ENGINE
-- =============================================================================
-- Configurable automated workflows with triggers and actions

-- Workflow definitions
CREATE TABLE IF NOT EXISTS crm_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = system-wide
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- Trigger configuration
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'record_created',     -- When a record is created
    'record_updated',     -- When a record is updated
    'field_changed',      -- When specific field changes
    'stage_changed',      -- When pipeline stage changes
    'time_based',         -- Scheduled trigger
    'date_field',         -- Based on a date field (e.g., 7 days before due_date)
    'manual',             -- Manually triggered
    'webhook_received',   -- External webhook trigger
    'inactivity'          -- No activity for X days
  )),
  trigger_entity TEXT NOT NULL,  -- 'opportunity', 'contract', 'invoice', 'contact', etc.
  trigger_conditions JSONB DEFAULT '{}',
  /* Example trigger_conditions:
  {
    "field": "stage",
    "operator": "changed_to",
    "value": "qualified",
    "additional_filters": [
      {"field": "estimated_value_cents", "operator": ">=", "value": 100000}
    ]
  }
  */
  
  -- For time-based triggers
  schedule_cron TEXT,  -- Cron expression
  schedule_timezone TEXT DEFAULT 'Pacific/Auckland',
  
  -- For date field triggers
  date_field TEXT,     -- e.g., 'due_date', 'renewal_date'
  days_before INTEGER, -- Days before the date to trigger
  days_after INTEGER,  -- Days after the date to trigger
  
  -- Actions (executed in order)
  actions JSONB NOT NULL DEFAULT '[]',
  /* Example actions:
  [
    {
      "type": "create_activity",
      "params": {
        "activity_type": "task",
        "subject": "Follow up on {{opportunity.name}}",
        "due_days": 3,
        "assigned_to_field": "owner_id"
      }
    },
    {
      "type": "send_email",
      "params": {
        "template_id": "uuid",
        "to_field": "contact.email",
        "cc": ["sales@company.com"]
      }
    },
    {
      "type": "update_field",
      "params": {
        "field": "probability_percent",
        "value": 25
      }
    },
    {
      "type": "create_notification",
      "params": {
        "user_field": "owner_id",
        "title": "New qualified lead!",
        "message": "{{opportunity.name}} has been qualified"
      }
    },
    {
      "type": "webhook",
      "params": {
        "url": "https://api.example.com/hook",
        "method": "POST"
      }
    }
  ]
  */
  
  -- Execution settings
  run_once_per_record BOOLEAN DEFAULT FALSE,  -- Only run once per record
  stop_on_error BOOLEAN DEFAULT TRUE,         -- Stop if an action fails
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Stats
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_org ON crm_workflows(organization_id);
CREATE INDEX IF NOT EXISTS idx_workflows_trigger ON crm_workflows(trigger_type, trigger_entity);
CREATE INDEX IF NOT EXISTS idx_workflows_active ON crm_workflows(is_active) WHERE is_active = TRUE;

-- Workflow execution history
CREATE TABLE IF NOT EXISTS crm_workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES crm_workflows(id) ON DELETE CASCADE,
  
  -- What triggered it
  trigger_entity_type TEXT NOT NULL,
  trigger_entity_id UUID NOT NULL,
  trigger_reason TEXT,  -- Human-readable reason
  
  -- Execution status
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
    'running', 'completed', 'failed', 'skipped', 'cancelled'
  )),
  
  -- Action results
  actions_executed JSONB DEFAULT '[]',
  /* Example:
  [
    {"action": "create_activity", "status": "success", "result": {"id": "uuid"}},
    {"action": "send_email", "status": "success", "message_id": "abc123"},
    {"action": "update_field", "status": "failed", "error": "Field not found"}
  ]
  */
  
  current_action_index INTEGER DEFAULT 0,
  total_actions INTEGER,
  
  error_message TEXT,
  error_action_index INTEGER,
  
  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_exec_workflow ON crm_workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_exec_entity ON crm_workflow_executions(trigger_entity_type, trigger_entity_id);
CREATE INDEX IF NOT EXISTS idx_workflow_exec_status ON crm_workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_workflow_exec_date ON crm_workflow_executions(started_at);

-- Track which records have already triggered workflows (for run_once_per_record)
CREATE TABLE IF NOT EXISTS crm_workflow_triggers (
  workflow_id UUID NOT NULL REFERENCES crm_workflows(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (workflow_id, entity_id)
);

-- =============================================================================
-- 5. EMAIL TEMPLATES & COMMUNICATION HISTORY
-- =============================================================================

-- Email templates with merge fields
CREATE TABLE IF NOT EXISTS crm_email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = system templates
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- Template content
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,  -- Plain text fallback
  
  -- Categorization
  category TEXT NOT NULL CHECK (category IN (
    'sales',           -- Sales emails
    'onboarding',      -- New customer onboarding
    'invoice',         -- Invoice/billing
    'reminder',        -- Reminders
    'notification',    -- Notifications
    'contract',        -- Contract-related
    'compliance',      -- Compliance notifications
    'marketing',       -- Marketing campaigns
    'support',         -- Support/help
    'general'          -- General purpose
  )),
  
  -- Entity context (which entity's fields are available)
  entity_type TEXT CHECK (entity_type IN (
    'contact', 'organization', 'contract', 'invoice', 
    'opportunity', 'incident', 'activity'
  )),
  
  -- Available merge fields (for UI help)
  available_merge_fields TEXT[] DEFAULT '{}',
  /* Example:
  ['{{contact.first_name}}', '{{contact.last_name}}', '{{organization.name}}', 
   '{{invoice.number}}', '{{invoice.amount}}', '{{contract.renewal_date}}']
  */
  
  -- Default attachments
  default_attachment_urls TEXT[] DEFAULT '{}',
  
  -- Settings
  is_active BOOLEAN DEFAULT TRUE,
  is_system_template BOOLEAN DEFAULT FALSE,  -- System templates can't be deleted
  
  -- Stats
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_org ON crm_email_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON crm_email_templates(category);
CREATE INDEX IF NOT EXISTS idx_email_templates_entity ON crm_email_templates(entity_type);

-- Communication history (all outbound communications)
CREATE TABLE IF NOT EXISTS crm_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Related entities (polymorphic)
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES crm_opportunities(id) ON DELETE SET NULL,
  contract_id UUID REFERENCES crm_contracts(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES crm_invoices(id) ON DELETE SET NULL,
  
  -- Communication type
  channel TEXT NOT NULL CHECK (channel IN (
    'email', 'sms', 'phone', 'letter', 'in_person', 'chat', 'push_notification'
  )),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  
  -- For email
  from_email TEXT,
  from_name TEXT,
  to_emails TEXT[],
  cc_emails TEXT[],
  bcc_emails TEXT[],
  reply_to TEXT,
  
  -- Content
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  
  -- Template used
  template_id UUID REFERENCES crm_email_templates(id),
  merge_data JSONB,  -- The data used for merge fields
  
  -- Attachments
  attachment_urls TEXT[],
  
  -- For phone/in_person
  call_duration_seconds INTEGER,
  call_outcome TEXT,
  call_recording_url TEXT,
  
  -- Delivery status (for email/sms)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- Not yet sent
    'queued',       -- In send queue
    'sent',         -- Sent to provider
    'delivered',    -- Delivered to recipient
    'opened',       -- Email opened
    'clicked',      -- Link clicked
    'replied',      -- Got a reply
    'bounced',      -- Bounced
    'failed',       -- Send failed
    'spam',         -- Marked as spam
    'unsubscribed'  -- Recipient unsubscribed
  )),
  
  -- Tracking
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  open_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  
  -- External references
  external_message_id TEXT,  -- Provider message ID (SendGrid, etc.)
  external_provider TEXT,    -- 'sendgrid', 'resend', 'twilio', etc.
  
  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Audit
  sent_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_communications_org ON crm_communications(organization_id);
CREATE INDEX IF NOT EXISTS idx_communications_contact ON crm_communications(contact_id);
CREATE INDEX IF NOT EXISTS idx_communications_opportunity ON crm_communications(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_communications_channel ON crm_communications(channel);
CREATE INDEX IF NOT EXISTS idx_communications_status ON crm_communications(status);
CREATE INDEX IF NOT EXISTS idx_communications_date ON crm_communications(created_at);

-- =============================================================================
-- 6. CUSTOM FIELDS SYSTEM
-- =============================================================================
-- Allow organizations to add their own fields to entities

-- Custom field definitions
CREATE TABLE IF NOT EXISTS crm_custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = platform-wide
  
  -- Which entity this field belongs to
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'organization', 'contact', 'contract', 'opportunity', 
    'site', 'zone', 'incident', 'vehicle', 'officer'
  )),
  
  -- Field identification
  field_key TEXT NOT NULL,  -- Internal key (snake_case)
  field_label TEXT NOT NULL,  -- Display label
  field_description TEXT,
  field_placeholder TEXT,
  
  -- Field type
  field_type TEXT NOT NULL CHECK (field_type IN (
    'text',           -- Single line text
    'textarea',       -- Multi-line text
    'number',         -- Integer
    'decimal',        -- Decimal number
    'currency',       -- Currency amount
    'percent',        -- Percentage
    'date',           -- Date only
    'datetime',       -- Date and time
    'time',           -- Time only
    'boolean',        -- Yes/No checkbox
    'select',         -- Single select dropdown
    'multiselect',    -- Multi-select
    'radio',          -- Radio buttons
    'email',          -- Email with validation
    'phone',          -- Phone with formatting
    'url',            -- URL with validation
    'user_reference', -- Reference to user
    'record_reference', -- Reference to another record
    'file',           -- File upload
    'image',          -- Image upload
    'color',          -- Color picker
    'json'            -- JSON data
  )),
  
  -- For select/multiselect/radio
  options JSONB,  -- [{"value": "a", "label": "Option A", "color": "#ff0000"}, ...]
  
  -- For record_reference
  reference_entity_type TEXT,
  
  -- Validation
  is_required BOOLEAN DEFAULT FALSE,
  validation_regex TEXT,
  min_value NUMERIC,
  max_value NUMERIC,
  min_length INTEGER,
  max_length INTEGER,
  
  -- Default value
  default_value TEXT,
  
  -- Display settings
  display_order INTEGER DEFAULT 0,
  display_width TEXT DEFAULT 'full' CHECK (display_width IN ('quarter', 'half', 'three_quarters', 'full')),
  show_in_list BOOLEAN DEFAULT FALSE,
  show_in_form BOOLEAN DEFAULT TRUE,
  show_in_detail BOOLEAN DEFAULT TRUE,
  group_name TEXT,  -- For grouping fields in forms
  
  -- Permissions
  editable_by_roles TEXT[] DEFAULT '{}',  -- Empty = all roles
  visible_to_roles TEXT[] DEFAULT '{}',   -- Empty = all roles
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  is_system_field BOOLEAN DEFAULT FALSE,  -- System fields can't be deleted
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (organization_id, entity_type, field_key)
);

CREATE INDEX IF NOT EXISTS idx_custom_fields_org ON crm_custom_field_definitions(organization_id);
CREATE INDEX IF NOT EXISTS idx_custom_fields_entity ON crm_custom_field_definitions(entity_type);
CREATE INDEX IF NOT EXISTS idx_custom_fields_active ON crm_custom_field_definitions(organization_id, entity_type, is_active) 
  WHERE is_active = TRUE;

-- Custom field values
CREATE TABLE IF NOT EXISTS crm_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_definition_id UUID NOT NULL REFERENCES crm_custom_field_definitions(id) ON DELETE CASCADE,
  
  -- Which record this value belongs to
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  
  -- Store all types flexibly
  value_text TEXT,
  value_number NUMERIC,
  value_decimal NUMERIC(20, 6),
  value_date DATE,
  value_datetime TIMESTAMPTZ,
  value_time TIME,
  value_boolean BOOLEAN,
  value_json JSONB,  -- For multiselect, file references, etc.
  value_reference_id UUID,  -- For user/record references
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (field_definition_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_values_field ON crm_custom_field_values(field_definition_id);
CREATE INDEX IF NOT EXISTS idx_custom_values_entity ON crm_custom_field_values(entity_type, entity_id);

-- =============================================================================
-- 7. SLA MONITORING & BREACH ALERTS
-- =============================================================================

-- SLA rule definitions
CREATE TABLE IF NOT EXISTS crm_sla_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_line_id UUID NOT NULL REFERENCES crm_contract_lines(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- What we're measuring
  metric_type TEXT NOT NULL CHECK (metric_type IN (
    'response_time',        -- Time to first response (minutes)
    'resolution_time',      -- Time to resolution (minutes)
    'uptime_percent',       -- System uptime percentage
    'patrol_coverage',      -- % of scheduled patrols completed
    'checkpoint_scans',     -- % of checkpoints scanned
    'incident_report_time', -- Time to submit incident report (minutes)
    'arrival_time',         -- Time to arrive at site (minutes)
    'custom'                -- Custom metric
  )),
  
  -- For custom metrics
  custom_metric_name TEXT,
  custom_metric_unit TEXT,
  
  -- Thresholds
  target_value NUMERIC NOT NULL,          -- The SLA target (e.g., 99.9 for uptime, 30 for minutes)
  warning_threshold NUMERIC,              -- Warning level (e.g., 99.5 for uptime, 25 for minutes)
  breach_threshold NUMERIC NOT NULL,      -- Breach level
  
  -- Time-based metrics
  is_time_based BOOLEAN DEFAULT FALSE,    -- Is this measured in time?
  time_unit TEXT CHECK (time_unit IN ('minutes', 'hours', 'days')),
  
  -- Measurement period
  measurement_period TEXT NOT NULL CHECK (measurement_period IN (
    'per_incident', 'hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'annually'
  )),
  
  -- Business hours only?
  business_hours_only BOOLEAN DEFAULT FALSE,
  business_hours_start TIME DEFAULT '08:00',
  business_hours_end TIME DEFAULT '18:00',
  exclude_weekends BOOLEAN DEFAULT TRUE,
  exclude_holidays BOOLEAN DEFAULT TRUE,
  
  -- Actions on breach
  notify_provider_on_warning BOOLEAN DEFAULT TRUE,
  notify_client_on_warning BOOLEAN DEFAULT FALSE,
  notify_provider_on_breach BOOLEAN DEFAULT TRUE,
  notify_client_on_breach BOOLEAN DEFAULT TRUE,
  
  -- Auto-credit settings
  auto_credit_on_breach BOOLEAN DEFAULT FALSE,
  credit_percent DECIMAL(5, 2),  -- % of line item value to credit
  credit_cap_percent DECIMAL(5, 2),  -- Max credit as % (e.g., 50% cap)
  
  -- Escalation
  escalation_after_minutes INTEGER,
  escalation_to_role TEXT,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_rules_contract_line ON crm_sla_rules(contract_line_id);
CREATE INDEX IF NOT EXISTS idx_sla_rules_metric ON crm_sla_rules(metric_type);
CREATE INDEX IF NOT EXISTS idx_sla_rules_active ON crm_sla_rules(is_active) WHERE is_active = TRUE;

-- SLA events (warnings and breaches)
CREATE TABLE IF NOT EXISTS crm_sla_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_rule_id UUID NOT NULL REFERENCES crm_sla_rules(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES crm_contracts(id),
  
  -- Event type
  event_type TEXT NOT NULL CHECK (event_type IN (
    'measurement',  -- Regular measurement point
    'warning',      -- Warning threshold reached
    'breach',       -- SLA breached
    'recovery',     -- Recovered from breach
    'credit_issued' -- Credit was issued
  )),
  
  -- What triggered this event
  trigger_entity_type TEXT,  -- 'incident', 'patrol', 'checkpoint_scan', etc.
  trigger_entity_id UUID,
  
  -- Metrics at time of event
  metric_value NUMERIC NOT NULL,
  target_value NUMERIC NOT NULL,
  threshold_value NUMERIC NOT NULL,
  variance_percent DECIMAL(10, 2),  -- How far off from target
  
  -- For time-based metrics
  time_elapsed_minutes INTEGER,
  
  -- Period this event covers
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  
  -- Credit information
  credit_amount_cents BIGINT,
  credit_invoice_id UUID REFERENCES crm_invoices(id),
  credit_notes TEXT,
  
  -- Notifications sent
  provider_notified_at TIMESTAMPTZ,
  client_notified_at TIMESTAMPTZ,
  
  -- Resolution
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES user_profiles(id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_events_rule ON crm_sla_events(sla_rule_id);
CREATE INDEX IF NOT EXISTS idx_sla_events_contract ON crm_sla_events(contract_id);
CREATE INDEX IF NOT EXISTS idx_sla_events_type ON crm_sla_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sla_events_date ON crm_sla_events(created_at);
CREATE INDEX IF NOT EXISTS idx_sla_events_unresolved ON crm_sla_events(event_type, resolved_at) 
  WHERE event_type IN ('warning', 'breach') AND resolved_at IS NULL;

-- =============================================================================
-- 8. API WEBHOOKS
-- =============================================================================

-- Webhook subscriptions
CREATE TABLE IF NOT EXISTS api_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- Endpoint
  url TEXT NOT NULL,
  secret TEXT NOT NULL,  -- For HMAC signature verification
  
  -- Authentication
  auth_type TEXT DEFAULT 'hmac' CHECK (auth_type IN (
    'hmac',         -- HMAC signature in header
    'bearer',       -- Bearer token
    'basic',        -- Basic auth
    'api_key',      -- API key in header
    'none'          -- No auth
  )),
  auth_header TEXT,     -- Header name for API key
  auth_value TEXT,      -- Bearer token or API key (encrypted)
  
  -- Events to subscribe to
  events TEXT[] NOT NULL,
  /* Available events:
  - 'contract.created', 'contract.updated', 'contract.signed', 'contract.expired'
  - 'invoice.created', 'invoice.sent', 'invoice.paid', 'invoice.overdue'
  - 'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost'
  - 'contact.created', 'contact.updated'
  - 'incident.created', 'incident.updated', 'incident.resolved'
  - 'patrol.started', 'patrol.completed', 'patrol.checkpoint_scanned'
  - 'officer.checked_in', 'officer.checked_out', 'officer.welfare_alert'
  - 'sla.warning', 'sla.breach', 'sla.recovery'
  - 'vehicle.scanned', 'vehicle.flagged'
  */
  
  -- Filtering
  event_filters JSONB DEFAULT '{}',  -- Additional filters for events
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Configuration
  timeout_seconds INTEGER DEFAULT 30,
  max_retries INTEGER DEFAULT 3,
  retry_delay_seconds INTEGER DEFAULT 60,
  
  -- Stats
  last_triggered_at TIMESTAMPTZ,
  last_response_code INTEGER,
  last_response_time_ms INTEGER,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  consecutive_failures INTEGER DEFAULT 0,
  
  -- Auto-disable after too many failures
  auto_disabled_at TIMESTAMPTZ,
  auto_disable_reason TEXT,
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_org ON api_webhooks(organization_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON api_webhooks(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_webhooks_events ON api_webhooks USING GIN (events);

-- Webhook delivery log
CREATE TABLE IF NOT EXISTS api_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES api_webhooks(id) ON DELETE CASCADE,
  
  -- Event info
  event_type TEXT NOT NULL,
  event_id UUID,  -- Reference to the source event
  
  -- Request
  payload JSONB NOT NULL,
  request_headers JSONB,
  signature TEXT,  -- HMAC signature sent
  
  -- Response
  response_code INTEGER,
  response_body TEXT,
  response_headers JSONB,
  response_time_ms INTEGER,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- Not yet sent
    'sending',      -- In progress
    'delivered',    -- Successfully delivered (2xx response)
    'failed',       -- Failed (non-2xx or error)
    'retrying',     -- Will retry
    'exhausted'     -- Max retries exceeded
  )),
  
  -- Retries
  attempt_number INTEGER DEFAULT 1,
  next_retry_at TIMESTAMPTZ,
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON api_webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON api_webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON api_webhook_deliveries(next_retry_at) 
  WHERE status = 'retrying';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_date ON api_webhook_deliveries(created_at);

-- =============================================================================
-- 9. RATE LIMITING
-- =============================================================================

-- Rate limit configurations per organization
CREATE TABLE IF NOT EXISTS api_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = default limits
  
  -- What this limit applies to
  endpoint_pattern TEXT NOT NULL,  -- '/api/crm/*', '/api/alpr/*', '*'
  
  -- Limits
  requests_per_minute INTEGER DEFAULT 60,
  requests_per_hour INTEGER DEFAULT 1000,
  requests_per_day INTEGER DEFAULT 10000,
  
  -- Burst allowance
  burst_limit INTEGER DEFAULT 10,  -- Allow burst above limit
  
  -- Response when limited
  retry_after_seconds INTEGER DEFAULT 60,
  
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (organization_id, endpoint_pattern)
);

-- Rate limit hits (for tracking)
-- This table will be heavily written to, so use partitioning or TimescaleDB in production
CREATE TABLE IF NOT EXISTS api_rate_limit_hits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  user_id UUID REFERENCES user_profiles(id),
  
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  
  -- Was the request rate limited?
  was_limited BOOLEAN DEFAULT FALSE,
  
  hit_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partition by time (daily) for better performance
-- In production, consider using TimescaleDB hypertable instead
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_lookup 
  ON api_rate_limit_hits(organization_id, endpoint, hit_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_user 
  ON api_rate_limit_hits(user_id, hit_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_ip 
  ON api_rate_limit_hits(ip_address, hit_at);

-- Clean up old rate limit hits (keep 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limit_hits()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM api_rate_limit_hits 
  WHERE hit_at < NOW() - INTERVAL '7 days';
END;
$$;

-- =============================================================================
-- 10. DATA EXPORT SYSTEM
-- =============================================================================

-- Data export requests
CREATE TABLE IF NOT EXISTS data_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES user_profiles(id),
  
  -- Export type
  export_type TEXT NOT NULL CHECK (export_type IN (
    'full',           -- All organization data
    'module',         -- Single module data
    'entity',         -- Single entity type
    'query',          -- Custom query/filter
    'dsar',           -- Data subject request
    'backup',         -- Backup export
    'migration'       -- Migration export
  )),
  
  -- What to export
  module_id TEXT,              -- For module exports
  entity_type TEXT,            -- For entity exports
  entity_ids UUID[],           -- Specific records
  query_filters JSONB,         -- For custom queries
  
  -- Date range
  date_from DATE,
  date_to DATE,
  
  -- Options
  include_attachments BOOLEAN DEFAULT FALSE,
  include_history BOOLEAN DEFAULT FALSE,
  anonymize_data BOOLEAN DEFAULT FALSE,
  
  -- Output format
  file_format TEXT NOT NULL DEFAULT 'json' CHECK (file_format IN (
    'json', 'csv', 'xlsx', 'xml', 'sql'
  )),
  compression TEXT DEFAULT 'zip' CHECK (compression IN ('none', 'zip', 'gzip')),
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- Waiting to start
    'processing',   -- In progress
    'completed',    -- Ready for download
    'failed',       -- Export failed
    'expired',      -- Download link expired
    'cancelled'     -- Cancelled by user
  )),
  
  -- Progress
  progress_percent INTEGER DEFAULT 0,
  records_processed INTEGER DEFAULT 0,
  total_records INTEGER,
  
  -- Output
  file_path TEXT,              -- Storage path
  file_name TEXT,              -- Original filename
  file_size_bytes BIGINT,
  checksum_sha256 TEXT,
  
  -- Download
  download_url TEXT,
  download_expires_at TIMESTAMPTZ,
  download_count INTEGER DEFAULT 0,
  last_downloaded_at TIMESTAMPTZ,
  max_downloads INTEGER DEFAULT 5,
  
  -- Error handling
  error_message TEXT,
  error_details JSONB,
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ  -- When the export request itself expires
);

CREATE INDEX IF NOT EXISTS idx_data_exports_org ON data_exports(organization_id);
CREATE INDEX IF NOT EXISTS idx_data_exports_user ON data_exports(requested_by);
CREATE INDEX IF NOT EXISTS idx_data_exports_status ON data_exports(status);
CREATE INDEX IF NOT EXISTS idx_data_exports_expires ON data_exports(download_expires_at) 
  WHERE status = 'completed';

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- Enable RLS on all new tables
ALTER TABLE privacy_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer_compliance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer_training_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_workflow_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sla_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sla_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_rate_limit_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;

-- Grand master has full access
CREATE POLICY "privacy_consents_grand_master" ON privacy_consents FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "dsar_grand_master" ON data_subject_requests FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "compliance_alerts_grand_master" ON officer_compliance_alerts FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "training_records_grand_master" ON officer_training_records FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "workflows_grand_master" ON crm_workflows FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "workflow_exec_grand_master" ON crm_workflow_executions FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "workflow_triggers_grand_master" ON crm_workflow_triggers FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "email_templates_grand_master" ON crm_email_templates FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "communications_grand_master" ON crm_communications FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "custom_fields_grand_master" ON crm_custom_field_definitions FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "custom_values_grand_master" ON crm_custom_field_values FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "sla_rules_grand_master" ON crm_sla_rules FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "sla_events_grand_master" ON crm_sla_events FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "webhooks_grand_master" ON api_webhooks FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "webhook_deliveries_grand_master" ON api_webhook_deliveries FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "rate_limits_grand_master" ON api_rate_limits FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "rate_limit_hits_grand_master" ON api_rate_limit_hits FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "data_exports_grand_master" ON data_exports FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

-- Organization-scoped access for org members
CREATE POLICY "privacy_consents_org_access" ON privacy_consents FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
  ));

CREATE POLICY "dsar_org_access" ON data_subject_requests FOR ALL TO authenticated
  USING (organization_id IS NULL OR organization_id IN (
    SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
  ));

CREATE POLICY "compliance_alerts_org_access" ON officer_compliance_alerts FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
  ));

CREATE POLICY "training_records_org_access" ON officer_training_records FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
  ));

CREATE POLICY "workflows_org_access" ON crm_workflows FOR ALL TO authenticated
  USING (organization_id IS NULL OR organization_id IN (
    SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
  ));

CREATE POLICY "email_templates_org_access" ON crm_email_templates FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id IN (
    SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
  ));

CREATE POLICY "communications_org_access" ON crm_communications FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
  ));

CREATE POLICY "webhooks_org_access" ON api_webhooks FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
  ));

CREATE POLICY "data_exports_org_access" ON data_exports FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
  ));

-- =============================================================================
-- GRANTS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON privacy_consents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON data_subject_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON officer_compliance_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON officer_training_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_workflows TO authenticated;
GRANT SELECT ON crm_workflow_executions TO authenticated;
GRANT SELECT ON crm_workflow_triggers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_email_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_communications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_custom_field_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_custom_field_values TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_sla_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE ON crm_sla_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_webhooks TO authenticated;
GRANT SELECT ON api_webhook_deliveries TO authenticated;
GRANT SELECT ON api_rate_limits TO authenticated;
GRANT SELECT ON api_rate_limit_hits TO authenticated;
GRANT SELECT, INSERT ON data_exports TO authenticated;

GRANT EXECUTE ON FUNCTION calculate_dsar_due_date TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_rate_limit_hits TO authenticated;

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Default email templates
INSERT INTO crm_email_templates (
  organization_id, name, category, entity_type, subject, body_html, body_text, is_system_template
) VALUES
(NULL, 'Welcome Email', 'onboarding', 'contact', 
  'Welcome to {{organization.name}}!',
  '<h1>Welcome, {{contact.first_name}}!</h1><p>Thank you for joining us.</p>',
  'Welcome, {{contact.first_name}}! Thank you for joining us.',
  TRUE),
(NULL, 'Invoice Sent', 'invoice', 'invoice',
  'Invoice {{invoice.number}} from {{organization.name}}',
  '<p>Please find attached your invoice {{invoice.number}} for {{invoice.total}}.</p><p>Due date: {{invoice.due_date}}</p>',
  'Please find attached your invoice {{invoice.number}} for {{invoice.total}}. Due date: {{invoice.due_date}}',
  TRUE),
(NULL, 'Contract for Review', 'contract', 'contract',
  'Contract Ready for Review - {{contract.name}}',
  '<p>Your contract is ready for review.</p><p>Contract: {{contract.name}}</p><p>Value: {{contract.value}}</p>',
  'Your contract is ready for review. Contract: {{contract.name}}, Value: {{contract.value}}',
  TRUE),
(NULL, 'Payment Reminder', 'reminder', 'invoice',
  'Payment Reminder - Invoice {{invoice.number}}',
  '<p>This is a friendly reminder that invoice {{invoice.number}} is due on {{invoice.due_date}}.</p>',
  'This is a friendly reminder that invoice {{invoice.number}} is due on {{invoice.due_date}}.',
  TRUE),
(NULL, 'SLA Breach Notification', 'compliance', NULL,
  'SLA Breach Alert - {{sla.name}}',
  '<p>An SLA breach has been detected:</p><p>SLA: {{sla.name}}</p><p>Metric: {{sla.metric}}</p><p>Value: {{sla.value}}</p>',
  'SLA Breach Alert. SLA: {{sla.name}}, Metric: {{sla.metric}}, Value: {{sla.value}}',
  TRUE),
(NULL, 'Credential Expiry Warning', 'compliance', NULL,
  'Credential Expiring Soon - {{credential.type}}',
  '<p>Your {{credential.type}} credential is expiring on {{credential.expiry_date}}.</p><p>Please renew it as soon as possible.</p>',
  'Your {{credential.type}} credential is expiring on {{credential.expiry_date}}. Please renew it as soon as possible.',
  TRUE)
ON CONFLICT DO NOTHING;

-- Default rate limits
INSERT INTO api_rate_limits (organization_id, endpoint_pattern, requests_per_minute, requests_per_hour, requests_per_day) VALUES
(NULL, '*', 60, 1000, 10000),           -- Default for all endpoints
(NULL, '/api/alpr/*', 30, 500, 5000),   -- ALPR endpoints (more expensive)
(NULL, '/api/export/*', 5, 20, 50)      -- Export endpoints (very expensive)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
-- 
-- This migration implements all recommended platform enhancements:
--
-- 1. ✅ NZ Privacy Act 2020 Compliance
--    - privacy_consents table
--    - data_subject_requests table (with 20 working day calculation)
--
-- 2. ✅ NZ Private Security Personnel Act Compliance
--    - COA fields on user_profiles
--    - officer_compliance_alerts table
--    - officer_training_records table
--
-- 3. ✅ Freedom Camping Act Green Warrant Integration
--    - Enhanced canonical_scv table with green warrant fields
--
-- 4. ✅ Workflow Automation Engine
--    - crm_workflows table
--    - crm_workflow_executions table
--    - crm_workflow_triggers table
--
-- 5. ✅ Email Templates & Communication History
--    - crm_email_templates table
--    - crm_communications table
--
-- 6. ✅ Custom Fields System
--    - crm_custom_field_definitions table
--    - crm_custom_field_values table
--
-- 7. ✅ SLA Monitoring & Breach Alerts
--    - crm_sla_rules table
--    - crm_sla_events table
--
-- 8. ✅ API Webhooks
--    - api_webhooks table
--    - api_webhook_deliveries table
--
-- 9. ✅ Rate Limiting
--    - api_rate_limits table
--    - api_rate_limit_hits table
--
-- 10. ✅ Data Export System
--    - data_exports table
--
-- =============================================================================
