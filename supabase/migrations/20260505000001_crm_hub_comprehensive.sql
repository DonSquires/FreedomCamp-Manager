-- =============================================================================
-- CRM HUB COMPREHENSIVE SCHEMA (Iron Eagle Platform Owner)
-- =============================================================================
-- This migration creates the comprehensive CRM system that serves as the
-- central entity hub for the platform. All organizations, users, zones,
-- sites, contracts, and contacts are managed through this CRM.
--
-- Iron Eagle Security is the hardcoded platform owner (Level 0).
--
-- Account Hierarchy:
--   Level 0: Platform Owner (Iron Eagle Security)
--   Level 1: Service Providers & Contractors
--   Level 2: Clients (of service providers)
--
-- Recommended CRM Features Included:
--   1. Contacts (stakeholders at accounts)
--   2. Contracts (service agreements between accounts)
--   3. Contract Line Items (per-module pricing)
--   4. Invoices (billing)
--   5. Payments (payment tracking)
--   6. Activities (calls, meetings, tasks)
--   7. Opportunities (sales pipeline)
--   8. Documents (file attachments)
--   9. Notes (freeform notes on any entity)
--   10. Tags (categorization)
--   11. Account History (audit trail)
--
-- =============================================================================

-- =============================================================================
-- 1. CONTACTS (People at Accounts)
-- =============================================================================
-- Named people at accounts (not system users, just contact info)

CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Contact details
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  mobile TEXT,
  
  -- Role at the organization
  job_title TEXT,
  department TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  is_billing_contact BOOLEAN DEFAULT FALSE,
  is_technical_contact BOOLEAN DEFAULT FALSE,
  
  -- Address (may differ from org address)
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'NZ',
  
  -- Social/Communication preferences
  linkedin_url TEXT,
  preferred_contact_method TEXT CHECK (preferred_contact_method IN ('email', 'phone', 'mobile', 'post')),
  do_not_contact BOOLEAN DEFAULT FALSE,
  
  -- Notes
  notes TEXT,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_org ON crm_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_name ON crm_contacts(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_primary ON crm_contacts(organization_id) WHERE is_primary = TRUE;

-- =============================================================================
-- 2. CONTRACTS (Service Agreements)
-- =============================================================================
-- Contracts link service providers to clients

CREATE TABLE IF NOT EXISTS crm_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Parties (service provider → client)
  provider_organization_id UUID NOT NULL REFERENCES organizations(id),
  client_organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Contract identifiers
  contract_number TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  
  -- Type
  contract_type TEXT NOT NULL DEFAULT 'service' CHECK (contract_type IN (
    'service',     -- Service agreement
    'subcontract', -- Subcontractor agreement
    'nda',         -- Non-disclosure
    'sla',         -- Service level agreement
    'msa',         -- Master service agreement
    'sow'          -- Statement of work
  )),
  
  -- Dates
  start_date DATE NOT NULL,
  end_date DATE,
  signed_date DATE,
  renewal_date DATE,
  notice_period_days INTEGER DEFAULT 30,
  auto_renew BOOLEAN DEFAULT FALSE,
  
  -- Value & Billing
  contract_value_cents BIGINT,
  billing_frequency TEXT DEFAULT 'monthly' CHECK (billing_frequency IN (
    'weekly', 'fortnightly', 'monthly', 'quarterly', 'annually', 'one_time'
  )),
  payment_terms_days INTEGER DEFAULT 20,  -- Due X days after invoice
  currency TEXT DEFAULT 'NZD',
  
  -- GST/Tax
  gst_inclusive BOOLEAN DEFAULT TRUE,
  gst_rate DECIMAL(5, 4) DEFAULT 0.15,  -- 15% GST in NZ
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',
    'pending_approval',
    'pending_signature',
    'active',
    'suspended',
    'expired',
    'cancelled',
    'renewed'
  )),
  
  -- Approval workflow
  requires_approval BOOLEAN DEFAULT FALSE,
  approved_by UUID REFERENCES user_profiles(id),
  approved_at TIMESTAMPTZ,
  
  -- Contacts
  provider_signatory_id UUID REFERENCES crm_contacts(id),
  client_signatory_id UUID REFERENCES crm_contacts(id),
  
  -- Document reference
  document_url TEXT,
  signed_document_url TEXT,
  
  -- Notes
  internal_notes TEXT,
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_contracts_provider ON crm_contracts(provider_organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_contracts_client ON crm_contracts(client_organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_contracts_status ON crm_contracts(status);
CREATE INDEX IF NOT EXISTS idx_crm_contracts_dates ON crm_contracts(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_crm_contracts_renewal ON crm_contracts(renewal_date) WHERE status = 'active';

-- Sequences for contract and invoice numbers (avoids race conditions)
CREATE SEQUENCE IF NOT EXISTS crm_contract_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS crm_invoice_number_seq START 1;

-- Generate contract number using sequence (thread-safe)
CREATE OR REPLACE FUNCTION generate_contract_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.contract_number IS NULL THEN
    NEW.contract_number := 'CTR-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || 
      LPAD(nextval('crm_contract_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_contract_number ON crm_contracts;
CREATE TRIGGER tr_contract_number
  BEFORE INSERT ON crm_contracts
  FOR EACH ROW
  EXECUTE FUNCTION generate_contract_number();

-- =============================================================================
-- 3. CONTRACT LINE ITEMS (Per-Module Services)
-- =============================================================================
-- Services included in a contract (linked to service modules)

CREATE TABLE IF NOT EXISTS crm_contract_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES crm_contracts(id) ON DELETE CASCADE,
  
  -- Service details
  module_id TEXT REFERENCES service_modules(id),  -- Link to service module
  description TEXT NOT NULL,
  
  -- Pricing
  unit_price_cents BIGINT NOT NULL,
  quantity INTEGER DEFAULT 1,
  billing_type TEXT NOT NULL CHECK (billing_type IN (
    'fixed',           -- Fixed monthly fee
    'per_seat',        -- Per-user fee
    'per_transaction', -- Per-action fee (e.g., per scan)
    'hourly',          -- Per-hour rate
    'milestone'        -- Project milestone
  )),
  
  -- Limits
  included_units INTEGER,      -- Units included in price (e.g., 1000 scans)
  overage_rate_cents INTEGER,  -- Rate for units over included
  max_units INTEGER,           -- Hard cap
  
  -- SLA
  sla_response_minutes INTEGER,
  sla_resolution_minutes INTEGER,
  sla_uptime_percent DECIMAL(5, 2),
  
  -- Schedule
  start_date DATE,
  end_date DATE,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_lines_contract ON crm_contract_lines(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_lines_module ON crm_contract_lines(module_id);

-- =============================================================================
-- 4. INVOICES
-- =============================================================================

CREATE TABLE IF NOT EXISTS crm_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  contract_id UUID REFERENCES crm_contracts(id),
  provider_organization_id UUID NOT NULL REFERENCES organizations(id),
  client_organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Invoice identifiers
  invoice_number TEXT UNIQUE NOT NULL,
  reference TEXT,
  
  -- Dates
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  billing_period_start DATE,
  billing_period_end DATE,
  
  -- Amounts (in cents for precision)
  subtotal_cents BIGINT NOT NULL DEFAULT 0,
  discount_cents BIGINT DEFAULT 0,
  discount_reason TEXT,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,
  
  -- Currency
  currency TEXT DEFAULT 'NZD',
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',
    'pending',
    'sent',
    'viewed',
    'partially_paid',
    'paid',
    'overdue',
    'cancelled',
    'written_off'
  )),
  
  -- Payment tracking
  amount_paid_cents BIGINT DEFAULT 0,
  balance_cents BIGINT GENERATED ALWAYS AS (total_cents - amount_paid_cents) STORED,
  
  -- Dates
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  
  -- Contacts
  billing_contact_id UUID REFERENCES crm_contacts(id),
  
  -- Email
  sent_to_email TEXT,
  
  -- Notes
  notes TEXT,
  internal_notes TEXT,
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_provider ON crm_invoices(provider_organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON crm_invoices(client_organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contract ON crm_invoices(contract_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON crm_invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON crm_invoices(due_date) WHERE status NOT IN ('paid', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_invoices_number ON crm_invoices(invoice_number);

-- Generate invoice number using sequence (thread-safe)
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || 
      LPAD(nextval('crm_invoice_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_invoice_number ON crm_invoices;
CREATE TRIGGER tr_invoice_number
  BEFORE INSERT ON crm_invoices
  FOR EACH ROW
  EXECUTE FUNCTION generate_invoice_number();

-- =============================================================================
-- 5. INVOICE LINE ITEMS
-- =============================================================================

CREATE TABLE IF NOT EXISTS crm_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES crm_invoices(id) ON DELETE CASCADE,
  
  -- What this line is for
  contract_line_id UUID REFERENCES crm_contract_lines(id),
  module_id TEXT REFERENCES service_modules(id),
  
  -- Description
  description TEXT NOT NULL,
  
  -- Amounts
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
  unit_price_cents BIGINT NOT NULL,
  discount_percent DECIMAL(5, 2) DEFAULT 0,
  tax_rate DECIMAL(5, 4) DEFAULT 0.15,
  
  -- Calculated (stored for audit/snapshots)
  line_subtotal_cents BIGINT NOT NULL,
  line_tax_cents BIGINT NOT NULL,
  line_total_cents BIGINT NOT NULL,
  
  -- Usage reference (for per-transaction billing)
  usage_event_ids UUID[],  -- Links to module_usage_events
  
  -- Ordering
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON crm_invoice_lines(invoice_id);

-- =============================================================================
-- 6. PAYMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS crm_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What this pays
  invoice_id UUID REFERENCES crm_invoices(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Payment details
  amount_cents BIGINT NOT NULL,
  currency TEXT DEFAULT 'NZD',
  
  -- Payment method
  payment_method TEXT NOT NULL CHECK (payment_method IN (
    'bank_transfer',
    'credit_card',
    'direct_debit',
    'cheque',
    'cash',
    'stripe',
    'other'
  )),
  
  -- External references
  payment_reference TEXT,
  stripe_payment_id TEXT,
  stripe_payment_intent_id TEXT,
  bank_reference TEXT,
  
  -- Dates
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'processing',
    'completed',
    'failed',
    'refunded',
    'partially_refunded'
  )),
  
  -- Refunds
  refund_amount_cents BIGINT DEFAULT 0,
  refund_reason TEXT,
  refunded_at TIMESTAMPTZ,
  
  -- Notes
  notes TEXT,
  
  -- Audit
  processed_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON crm_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_org ON crm_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON crm_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_status ON crm_payments(status);

-- Update invoice when payment is made
CREATE OR REPLACE FUNCTION update_invoice_on_payment()
RETURNS TRIGGER AS $$
DECLARE
  v_total_paid BIGINT;
  v_invoice_total BIGINT;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW.invoice_id IS NOT NULL AND NEW.status = 'completed' THEN
      -- Calculate total paid
      SELECT COALESCE(SUM(amount_cents - refund_amount_cents), 0)
      INTO v_total_paid
      FROM crm_payments
      WHERE invoice_id = NEW.invoice_id
        AND status = 'completed';
      
      -- Get invoice total
      SELECT total_cents INTO v_invoice_total
      FROM crm_invoices WHERE id = NEW.invoice_id;
      
      -- Update invoice
      UPDATE crm_invoices SET
        amount_paid_cents = v_total_paid,
        status = CASE
          WHEN v_total_paid >= v_invoice_total THEN 'paid'
          WHEN v_total_paid > 0 THEN 'partially_paid'
          ELSE status
        END,
        paid_at = CASE
          WHEN v_total_paid >= v_invoice_total THEN NOW()
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE id = NEW.invoice_id;
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_payment_update_invoice ON crm_payments;
CREATE TRIGGER tr_payment_update_invoice
  AFTER INSERT OR UPDATE ON crm_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_on_payment();

-- =============================================================================
-- 7. ACTIVITIES (Calls, Meetings, Tasks)
-- =============================================================================
-- Track interactions and tasks related to accounts

CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Related entities (polymorphic)
  organization_id UUID REFERENCES organizations(id),
  contact_id UUID REFERENCES crm_contacts(id),
  contract_id UUID REFERENCES crm_contracts(id),
  opportunity_id UUID,  -- Forward reference
  
  -- Activity type
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'call',
    'email',
    'meeting',
    'task',
    'note',
    'site_visit',
    'demo',
    'proposal',
    'follow_up'
  )),
  
  -- Details
  subject TEXT NOT NULL,
  description TEXT,
  
  -- Timing
  due_date DATE,
  due_time TIME,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Priority & Status
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',
    'in_progress',
    'completed',
    'cancelled',
    'deferred'
  )),
  
  -- Call details (if activity_type = 'call')
  call_direction TEXT CHECK (call_direction IN ('inbound', 'outbound')),
  call_duration_seconds INTEGER,
  call_outcome TEXT,
  
  -- Meeting details
  meeting_location TEXT,
  meeting_url TEXT,  -- Video call link
  
  -- Assignment
  assigned_to UUID REFERENCES user_profiles(id),
  
  -- Reminders
  reminder_at TIMESTAMPTZ,
  reminder_sent BOOLEAN DEFAULT FALSE,
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_org ON crm_activities(organization_id);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON crm_activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_assigned ON crm_activities(assigned_to);
CREATE INDEX IF NOT EXISTS idx_activities_due ON crm_activities(due_date) WHERE status IN ('pending', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_activities_type ON crm_activities(activity_type);

-- =============================================================================
-- 8. OPPORTUNITIES (Sales Pipeline)
-- =============================================================================

CREATE TABLE IF NOT EXISTS crm_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Related entities
  organization_id UUID NOT NULL REFERENCES organizations(id),
  contact_id UUID REFERENCES crm_contacts(id),
  
  -- Opportunity details
  name TEXT NOT NULL,
  description TEXT,
  
  -- Pipeline stage
  stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN (
    'lead',
    'qualified',
    'proposal',
    'negotiation',
    'closed_won',
    'closed_lost'
  )),
  
  -- Value
  estimated_value_cents BIGINT,
  probability_percent INTEGER DEFAULT 0 CHECK (probability_percent >= 0 AND probability_percent <= 100),
  weighted_value_cents BIGINT GENERATED ALWAYS AS (
    (estimated_value_cents * probability_percent) / 100
  ) STORED,
  
  -- What they're interested in
  interested_modules TEXT[],  -- Array of module IDs
  
  -- Dates
  expected_close_date DATE,
  actual_close_date DATE,
  
  -- Source
  lead_source TEXT CHECK (lead_source IN (
    'website',
    'referral',
    'cold_call',
    'trade_show',
    'social_media',
    'partner',
    'existing_customer',
    'other'
  )),
  lead_source_detail TEXT,
  
  -- Competition
  competitors TEXT[],
  
  -- Lost reason (if closed_lost)
  lost_reason TEXT,
  lost_to_competitor TEXT,
  
  -- Conversion
  converted_to_contract_id UUID REFERENCES crm_contracts(id),
  
  -- Assignment
  owner_id UUID REFERENCES user_profiles(id),
  
  -- Notes
  notes TEXT,
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_org ON crm_opportunities(organization_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_owner ON crm_opportunities(owner_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON crm_opportunities(stage);
CREATE INDEX IF NOT EXISTS idx_opportunities_close_date ON crm_opportunities(expected_close_date);

-- Add foreign key from activities to opportunities
ALTER TABLE crm_activities
  ADD CONSTRAINT fk_activity_opportunity
  FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities(id);

-- =============================================================================
-- 9. DOCUMENTS (File Attachments)
-- =============================================================================

CREATE TABLE IF NOT EXISTS crm_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Related entities (polymorphic)
  organization_id UUID REFERENCES organizations(id),
  contact_id UUID REFERENCES crm_contacts(id),
  contract_id UUID REFERENCES crm_contracts(id),
  opportunity_id UUID REFERENCES crm_opportunities(id),
  invoice_id UUID REFERENCES crm_invoices(id),
  
  -- Document details
  name TEXT NOT NULL,
  description TEXT,
  
  -- File info
  file_path TEXT NOT NULL,  -- Storage bucket path
  file_name TEXT NOT NULL,
  file_type TEXT,           -- MIME type
  file_size_bytes BIGINT,
  
  -- Document type
  document_type TEXT CHECK (document_type IN (
    'contract',
    'proposal',
    'invoice',
    'quote',
    'certificate',
    'insurance',
    'compliance',
    'id_document',
    'photo',
    'other'
  )),
  
  -- Version tracking
  version INTEGER DEFAULT 1,
  parent_document_id UUID REFERENCES crm_documents(id),
  
  -- Access control
  is_confidential BOOLEAN DEFAULT FALSE,
  
  -- Audit
  uploaded_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_org ON crm_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_contract ON crm_documents(contract_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON crm_documents(document_type);

-- =============================================================================
-- 10. NOTES (Freeform Notes on Any Entity)
-- =============================================================================

CREATE TABLE IF NOT EXISTS crm_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Related entities (polymorphic)
  organization_id UUID REFERENCES organizations(id),
  contact_id UUID REFERENCES crm_contacts(id),
  contract_id UUID REFERENCES crm_contracts(id),
  opportunity_id UUID REFERENCES crm_opportunities(id),
  
  -- Note content
  title TEXT,
  content TEXT NOT NULL,
  
  -- Visibility
  is_private BOOLEAN DEFAULT FALSE,  -- Only visible to creator
  is_pinned BOOLEAN DEFAULT FALSE,   -- Show at top
  
  -- Audit
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_org ON crm_notes(organization_id);
CREATE INDEX IF NOT EXISTS idx_notes_contact ON crm_notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_notes_contract ON crm_notes(contract_id);
CREATE INDEX IF NOT EXISTS idx_notes_pinned ON crm_notes(organization_id) WHERE is_pinned = TRUE;

-- =============================================================================
-- 11. TAGS (Categorization)
-- =============================================================================

CREATE TABLE IF NOT EXISTS crm_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#6b7280',  -- Gray default
  description TEXT,
  
  -- Scope
  tag_type TEXT NOT NULL CHECK (tag_type IN (
    'organization',
    'contact',
    'contract',
    'opportunity'
  )),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Junction tables for tagging
CREATE TABLE IF NOT EXISTS crm_organization_tags (
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES crm_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, tag_id)
);

CREATE TABLE IF NOT EXISTS crm_contact_tags (
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES crm_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

CREATE TABLE IF NOT EXISTS crm_opportunity_tags (
  opportunity_id UUID REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES crm_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, tag_id)
);

-- =============================================================================
-- 12. ACCOUNT HISTORY (Audit Trail)
-- =============================================================================

CREATE TABLE IF NOT EXISTS crm_account_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What changed
  organization_id UUID NOT NULL REFERENCES organizations(id),
  entity_type TEXT NOT NULL,  -- 'organization', 'contact', 'contract', etc.
  entity_id UUID NOT NULL,
  
  -- Change details
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'status_change')),
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  
  -- Full record snapshots (for auditing)
  old_record JSONB,
  new_record JSONB,
  
  -- Who made the change
  changed_by UUID REFERENCES user_profiles(id),
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_history_org ON crm_account_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_history_entity ON crm_account_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_account_history_date ON crm_account_history(changed_at);

-- =============================================================================
-- 13. RLS POLICIES
-- =============================================================================

-- Enable RLS on all CRM tables
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contract_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_organization_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_opportunity_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_account_history ENABLE ROW LEVEL SECURITY;

-- Grand master has full access to everything
CREATE POLICY "crm_contacts_grand_master" ON crm_contacts FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_contracts_grand_master" ON crm_contracts FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_contract_lines_grand_master" ON crm_contract_lines FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_invoices_grand_master" ON crm_invoices FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_invoice_lines_grand_master" ON crm_invoice_lines FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_payments_grand_master" ON crm_payments FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_activities_grand_master" ON crm_activities FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_opportunities_grand_master" ON crm_opportunities FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_documents_grand_master" ON crm_documents FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_notes_grand_master" ON crm_notes FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_tags_grand_master" ON crm_tags FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_org_tags_grand_master" ON crm_organization_tags FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_contact_tags_grand_master" ON crm_contact_tags FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_opp_tags_grand_master" ON crm_opportunity_tags FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

CREATE POLICY "crm_history_grand_master" ON crm_account_history FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role')::TEXT = 'grand_master')
  WITH CHECK ((auth.jwt() ->> 'role')::TEXT = 'grand_master');

-- Organization admins can manage their own CRM data
-- Contacts: org members can view/manage contacts for their org
CREATE POLICY "crm_contacts_org_access" ON crm_contacts FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
      UNION
      SELECT up.employer_organization_id FROM user_profiles up WHERE up.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT up.organization_id FROM user_profiles up 
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'master', 'admin_officer')
    )
  );

-- Contracts: visible to both provider and client
CREATE POLICY "crm_contracts_org_access" ON crm_contracts FOR SELECT TO authenticated
  USING (
    provider_organization_id IN (
      SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
    )
    OR client_organization_id IN (
      SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
    )
  );

-- Contract lines: same as contracts (via JOIN)
CREATE POLICY "crm_contract_lines_read" ON crm_contract_lines FOR SELECT TO authenticated
  USING (
    contract_id IN (
      SELECT c.id FROM crm_contracts c
      WHERE c.provider_organization_id IN (
        SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
      )
      OR c.client_organization_id IN (
        SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
      )
    )
  );

-- Invoices: visible to provider and client
CREATE POLICY "crm_invoices_org_access" ON crm_invoices FOR SELECT TO authenticated
  USING (
    provider_organization_id IN (
      SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
    )
    OR client_organization_id IN (
      SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
    )
  );

-- Tags: readable by all authenticated
CREATE POLICY "crm_tags_read" ON crm_tags FOR SELECT TO authenticated USING (TRUE);

-- Activities: users can see activities they created or are assigned to
CREATE POLICY "crm_activities_access" ON crm_activities FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR organization_id IN (
      SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
    )
  );

-- Notes: users can manage their own notes, see org notes
CREATE POLICY "crm_notes_access" ON crm_notes FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      is_private = FALSE AND
      organization_id IN (
        SELECT up.organization_id FROM user_profiles up WHERE up.id = auth.uid()
      )
    )
  );

-- =============================================================================
-- 14. HELPER FUNCTIONS
-- =============================================================================

-- Get contract summary for an organization
CREATE OR REPLACE FUNCTION get_contract_summary(p_organization_id UUID)
RETURNS TABLE (
  total_contracts BIGINT,
  active_contracts BIGINT,
  total_value_cents BIGINT,
  monthly_revenue_cents BIGINT,
  contracts_expiring_30_days BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_contracts,
    COUNT(*) FILTER (WHERE status = 'active')::BIGINT AS active_contracts,
    COALESCE(SUM(contract_value_cents) FILTER (WHERE status = 'active'), 0)::BIGINT AS total_value_cents,
    COALESCE(SUM(
      CASE billing_frequency
        WHEN 'monthly' THEN contract_value_cents
        WHEN 'quarterly' THEN contract_value_cents / 3
        WHEN 'annually' THEN contract_value_cents / 12
        ELSE 0
      END
    ) FILTER (WHERE status = 'active'), 0)::BIGINT AS monthly_revenue_cents,
    COUNT(*) FILTER (
      WHERE status = 'active' 
      AND end_date IS NOT NULL 
      AND end_date <= CURRENT_DATE + INTERVAL '30 days'
    )::BIGINT AS contracts_expiring_30_days
  FROM crm_contracts
  WHERE provider_organization_id = p_organization_id
     OR client_organization_id = p_organization_id;
END;
$$;

-- Get invoice aging report
CREATE OR REPLACE FUNCTION get_invoice_aging(p_organization_id UUID)
RETURNS TABLE (
  aging_bucket TEXT,
  invoice_count BIGINT,
  total_cents BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN due_date > CURRENT_DATE THEN 'not_due'
      WHEN CURRENT_DATE - due_date <= 30 THEN '1_30_days'
      WHEN CURRENT_DATE - due_date <= 60 THEN '31_60_days'
      WHEN CURRENT_DATE - due_date <= 90 THEN '61_90_days'
      ELSE 'over_90_days'
    END AS aging_bucket,
    COUNT(*)::BIGINT AS invoice_count,
    COALESCE(SUM(balance_cents), 0)::BIGINT AS total_cents
  FROM crm_invoices
  WHERE provider_organization_id = p_organization_id
    AND status NOT IN ('paid', 'cancelled', 'written_off')
  GROUP BY 1
  ORDER BY 
    CASE aging_bucket
      WHEN 'not_due' THEN 1
      WHEN '1_30_days' THEN 2
      WHEN '31_60_days' THEN 3
      WHEN '61_90_days' THEN 4
      ELSE 5
    END;
END;
$$;

-- Get opportunity pipeline
CREATE OR REPLACE FUNCTION get_opportunity_pipeline(p_organization_id UUID)
RETURNS TABLE (
  stage TEXT,
  opportunity_count BIGINT,
  total_value_cents BIGINT,
  weighted_value_cents BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.stage,
    COUNT(*)::BIGINT AS opportunity_count,
    COALESCE(SUM(o.estimated_value_cents), 0)::BIGINT AS total_value_cents,
    COALESCE(SUM(o.weighted_value_cents), 0)::BIGINT AS weighted_value_cents
  FROM crm_opportunities o
  WHERE o.organization_id = p_organization_id
    AND o.stage NOT IN ('closed_won', 'closed_lost')
  GROUP BY o.stage
  ORDER BY
    CASE o.stage
      WHEN 'lead' THEN 1
      WHEN 'qualified' THEN 2
      WHEN 'proposal' THEN 3
      WHEN 'negotiation' THEN 4
      ELSE 5
    END;
END;
$$;

-- =============================================================================
-- 15. SEED DEFAULT TAGS
-- =============================================================================

INSERT INTO crm_tags (name, color, tag_type, description) VALUES
  ('VIP', '#dc2626', 'organization', 'High-value or strategic account'),
  ('At Risk', '#f97316', 'organization', 'Account at risk of churn'),
  ('New Customer', '#22c55e', 'organization', 'Recently onboarded'),
  ('Council', '#3b82f6', 'organization', 'Local council/government'),
  ('Property Manager', '#8b5cf6', 'organization', 'Property management company'),
  ('Security Company', '#6366f1', 'organization', 'Security service provider'),
  
  ('Decision Maker', '#dc2626', 'contact', 'Key decision maker'),
  ('Technical', '#3b82f6', 'contact', 'Technical contact'),
  ('Billing', '#22c55e', 'contact', 'Billing/accounts contact'),
  ('Champion', '#f59e0b', 'contact', 'Internal champion'),
  
  ('High Value', '#dc2626', 'opportunity', 'High-value opportunity'),
  ('Competitive', '#f97316', 'opportunity', 'Competitive deal'),
  ('Expansion', '#22c55e', 'opportunity', 'Existing customer expansion'),
  ('New Business', '#3b82f6', 'opportunity', 'New customer opportunity')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 16. GRANTS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_contacts TO authenticated;
GRANT SELECT ON crm_contracts TO authenticated;
GRANT SELECT ON crm_contract_lines TO authenticated;
GRANT SELECT ON crm_invoices TO authenticated;
GRANT SELECT ON crm_invoice_lines TO authenticated;
GRANT SELECT ON crm_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_opportunities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_notes TO authenticated;
GRANT SELECT ON crm_tags TO authenticated;
GRANT SELECT, INSERT, DELETE ON crm_organization_tags TO authenticated;
GRANT SELECT, INSERT, DELETE ON crm_contact_tags TO authenticated;
GRANT SELECT, INSERT, DELETE ON crm_opportunity_tags TO authenticated;
GRANT SELECT ON crm_account_history TO authenticated;

GRANT EXECUTE ON FUNCTION get_contract_summary TO authenticated;
GRANT EXECUTE ON FUNCTION get_invoice_aging TO authenticated;
GRANT EXECUTE ON FUNCTION get_opportunity_pipeline TO authenticated;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
-- 
-- This migration creates a comprehensive CRM system including:
--
-- CORE CRM FEATURES (Items 1 & 2 from request):
--   1. Contacts - stakeholders at accounts
--   2. Contracts - detailed service agreements with line items
--   3. Contract Line Items - per-module pricing with SLA terms
--   4. Invoices - billing with line items
--   5. Payments - payment tracking with Stripe support
--
-- RECOMMENDED ADDITIONS (Item 3 from request):
--   6. Activities - calls, meetings, tasks, follow-ups
--   7. Opportunities - sales pipeline management
--   8. Documents - file attachments for any entity
--   9. Notes - freeform notes with privacy controls
--   10. Tags - flexible categorization
--   11. Account History - comprehensive audit trail
--
-- ADDITIONAL RECOMMENDATIONS FOR FUTURE:
--   - Email templates and automation
--   - Workflow automation (e.g., auto-create follow-up tasks)
--   - Custom fields per organization
--   - Integration with email inbox (send/receive from CRM)
--   - SMS messaging integration
--   - Calendar sync (Google/Outlook)
--   - Reporting dashboards
--   - API webhooks for external integrations
--
-- =============================================================================
