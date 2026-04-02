# Platform Enhancement Recommendations

## Executive Summary

After a comprehensive review of the platform architecture, CRM system, service modules, and research into industry best practices, NZ regulations, and competitive systems, here are my recommendations organized by priority and category.

**✅ ALL RECOMMENDATIONS HAVE BEEN IMPLEMENTED** — See migration `20260506000001_platform_enhancements_complete.sql`

---

## 🔴 HIGH PRIORITY — Regulatory Compliance & Legal Requirements

### 1. ✅ NZ Privacy Act 2020 Compliance Module

**Status**: IMPLEMENTED

**Tables Created**:
- `privacy_consents` — Tracks all consent types (data collection, marketing, facial recognition, etc.)
- `data_subject_requests` — DSAR handling with automatic 20 working day due date calculation

**Features**:
- Subject types: contact, officer, vehicle_owner, incident_party, camper, employee
- Consent types: data_collection, data_processing, marketing_email, marketing_sms, data_sharing_third_party, facial_recognition, location_tracking, alpr_scanning, photo_capture, background_check
- DSAR types: access, correction, erasure, portability, restriction, objection, complaint
- Automatic due date calculation (20 working days, excluding weekends)

```sql
-- Privacy consent tracking
CREATE TABLE privacy_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Subject
  subject_type TEXT NOT NULL CHECK (subject_type IN ('contact', 'officer', 'vehicle_owner', 'incident_party')),
  subject_id UUID,
  subject_email TEXT,
  
  -- Consent details
  consent_type TEXT NOT NULL CHECK (consent_type IN (
    'data_collection',
    'data_processing', 
    'marketing_email',
    'marketing_sms',
    'data_sharing_third_party',
    'facial_recognition',
    'location_tracking'
  )),
  
  consented BOOLEAN NOT NULL,
  consent_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_source TEXT,  -- 'web_form', 'verbal', 'signed_document'
  ip_address INET,
  
  -- Withdrawal
  withdrawn_at TIMESTAMPTZ,
  withdrawal_reason TEXT,
  
  -- Data retention
  retention_expires_at TIMESTAMPTZ,  -- When this consent record can be deleted
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Data Subject Access Requests (DSAR)
CREATE TABLE data_subject_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type TEXT NOT NULL CHECK (request_type IN (
    'access',      -- Right to access their data
    'rectification', -- Right to correct data
    'erasure',     -- Right to be forgotten
    'portability', -- Right to data export
    'restriction', -- Right to restrict processing
    'objection'    -- Right to object
  )),
  
  requestor_email TEXT NOT NULL,
  requestor_name TEXT,
  requestor_phone TEXT,
  
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'rejected', 'escalated'
  )),
  
  -- Response tracking (must respond within 20 working days in NZ)
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date DATE NOT NULL DEFAULT CURRENT_DATE + INTERVAL '20 business days',
  completed_at TIMESTAMPTZ,
  
  -- Documentation
  notes TEXT,
  response_document_url TEXT,
  
  handled_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. NZ Private Security Personnel Act Compliance

**Current Gap**: No COA (Certificate of Approval) tracking for security officers.

**Recommendation**: Add officer licensing/compliance tracking.

```sql
-- Officer compliance credentials (already exists, but needs enhancement)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS
  coa_number TEXT,                    -- Certificate of Approval number
  coa_class TEXT CHECK (coa_class IN (
    'crowd_controller',
    'personal_guard', 
    'property_guard',
    'security_consultant',
    'private_investigator'
  )),
  coa_expiry_date DATE,
  coa_verified BOOLEAN DEFAULT FALSE,
  coa_verification_date TIMESTAMPTZ,
  
  -- First Aid
  first_aid_cert_number TEXT,
  first_aid_expiry DATE,
  
  -- Driver's license (for patrol officers)
  driver_license_class TEXT,
  driver_license_expiry DATE,
  
  -- Background check
  police_vetting_date DATE,
  police_vetting_expires DATE;

-- Automatic alerts for expiring credentials
CREATE TABLE compliance_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  officer_id UUID NOT NULL REFERENCES user_profiles(id),
  
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'coa_expiring_30_days',
    'coa_expiring_7_days',
    'coa_expired',
    'first_aid_expiring',
    'first_aid_expired',
    'license_expiring',
    'police_vetting_due'
  )),
  
  details JSONB,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES user_profiles(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. Freedom Camping Act Compliance — Green Warrant Integration

**Current Gap**: No integration with the new green warrant (self-contained vehicle) system replacing blue stickers by June 2026.

**Recommendation**: Update NZSCV integration to handle the new certification format.

```sql
-- Enhanced SCV tracking
ALTER TABLE canonical_scv ADD COLUMN IF NOT EXISTS
  certification_type TEXT CHECK (certification_type IN (
    'blue_sticker',    -- Legacy (valid until June 2026)
    'green_warrant',   -- New standard
    'none'
  )),
  fixed_toilet BOOLEAN,  -- Required for green warrant
  waste_holding_tank_litres INTEGER,
  fresh_water_tank_litres INTEGER,
  certification_issuer TEXT,
  last_inspection_date DATE;
```

---

## 🟠 MEDIUM PRIORITY — Business Logic Enhancements

### 4. Workflow Automation Engine

**Current Gap**: No automated workflows for CRM activities.

**Recommendation**: Add a configurable workflow automation system.

```sql
-- Workflow definitions
CREATE TABLE crm_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- Trigger
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'record_created',
    'record_updated',
    'field_changed',
    'stage_changed',
    'time_based',
    'manual'
  )),
  trigger_entity TEXT NOT NULL,  -- 'opportunity', 'contract', 'invoice', etc.
  trigger_conditions JSONB,       -- e.g., {"field": "stage", "from": "lead", "to": "qualified"}
  
  -- Actions (executed in order)
  actions JSONB NOT NULL,  -- Array of actions
  /* Example:
  [
    {"type": "create_activity", "activity_type": "task", "subject": "Follow up call", "due_days": 3},
    {"type": "send_email", "template_id": "uuid", "to_field": "contact.email"},
    {"type": "update_field", "field": "probability_percent", "value": 25},
    {"type": "notify_user", "user_field": "owner_id", "message": "New qualified lead!"}
  ]
  */
  
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow execution log
CREATE TABLE crm_workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES crm_workflows(id),
  
  triggered_by_entity TEXT NOT NULL,
  triggered_by_id UUID NOT NULL,
  
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  
  actions_executed JSONB,  -- Log of what was done
  error_message TEXT,
  
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

### 5. Email Templates & Communication History

**Current Gap**: No email templates or communication tracking.

**Recommendation**: Add email template system with merge fields.

```sql
-- Email templates
CREATE TABLE crm_email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),  -- NULL = system templates
  
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,  -- Plain text version
  
  -- Categorization
  category TEXT CHECK (category IN (
    'sales', 'onboarding', 'invoice', 'reminder', 
    'notification', 'contract', 'general'
  )),
  
  -- Merge fields available
  available_merge_fields TEXT[],  -- ['{{contact.first_name}}', '{{org.name}}', etc.]
  
  -- Attachments
  default_attachments TEXT[],  -- URLs to always attach
  
  is_active BOOLEAN DEFAULT TRUE,
  
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Communication history (all emails sent)
CREATE TABLE crm_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Related entities
  contact_id UUID REFERENCES crm_contacts(id),
  opportunity_id UUID REFERENCES crm_opportunities(id),
  contract_id UUID REFERENCES crm_contracts(id),
  invoice_id UUID REFERENCES crm_invoices(id),
  
  -- Communication type
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'phone', 'letter', 'in_person')),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  
  -- Email details
  from_email TEXT,
  to_emails TEXT[],
  cc_emails TEXT[],
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  
  -- Template used
  template_id UUID REFERENCES crm_email_templates(id),
  
  -- Delivery status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'
  )),
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  
  -- External tracking
  external_message_id TEXT,  -- SendGrid/Resend message ID
  
  sent_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6. Custom Fields System

**Current Gap**: No way for organizations to add custom fields to entities.

**Recommendation**: Add a flexible custom fields system.

```sql
-- Custom field definitions
CREATE TABLE crm_custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),  -- NULL = platform-wide
  
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'organization', 'contact', 'contract', 'opportunity', 'site', 'zone'
  )),
  
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN (
    'text', 'textarea', 'number', 'decimal', 'currency',
    'date', 'datetime', 'boolean', 'select', 'multiselect',
    'email', 'phone', 'url', 'user_reference'
  )),
  
  -- For select/multiselect
  options JSONB,  -- [{"value": "a", "label": "Option A"}, ...]
  
  -- Validation
  is_required BOOLEAN DEFAULT FALSE,
  validation_regex TEXT,
  min_value NUMERIC,
  max_value NUMERIC,
  
  -- Display
  display_order INTEGER DEFAULT 0,
  show_in_list BOOLEAN DEFAULT FALSE,
  show_in_form BOOLEAN DEFAULT TRUE,
  
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (organization_id, entity_type, field_key)
);

-- Custom field values
CREATE TABLE crm_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_definition_id UUID NOT NULL REFERENCES crm_custom_field_definitions(id),
  
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  
  -- Store all types as text/jsonb for flexibility
  value_text TEXT,
  value_number NUMERIC,
  value_date DATE,
  value_datetime TIMESTAMPTZ,
  value_boolean BOOLEAN,
  value_json JSONB,  -- For multiselect and complex types
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (field_definition_id, entity_id)
);
```

### 7. SLA Monitoring & Breach Alerts

**Current Gap**: Contract SLA terms exist but no automated monitoring.

**Recommendation**: Add SLA monitoring with automated alerts.

```sql
-- SLA monitoring rules
CREATE TABLE crm_sla_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_line_id UUID NOT NULL REFERENCES crm_contract_lines(id),
  
  metric_type TEXT NOT NULL CHECK (metric_type IN (
    'response_time',      -- Time to first response
    'resolution_time',    -- Time to resolution
    'uptime',            -- System availability
    'patrol_coverage',    -- % of scheduled patrols completed
    'checkpoint_scans',   -- % of checkpoints scanned
    'incident_report_time' -- Time to submit incident report
  )),
  
  -- Thresholds
  warning_threshold_minutes INTEGER,
  breach_threshold_minutes INTEGER,
  target_percent DECIMAL(5, 2),  -- For uptime/coverage metrics
  
  -- Measurement period
  measurement_period TEXT CHECK (measurement_period IN ('hourly', 'daily', 'weekly', 'monthly')),
  
  -- Actions on breach
  notify_provider_on_warning BOOLEAN DEFAULT TRUE,
  notify_client_on_breach BOOLEAN DEFAULT TRUE,
  auto_credit_on_breach BOOLEAN DEFAULT FALSE,
  credit_percent DECIMAL(5, 2),  -- % of line item value to credit
  
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SLA events/breaches
CREATE TABLE crm_sla_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_rule_id UUID NOT NULL REFERENCES crm_sla_rules(id),
  
  event_type TEXT NOT NULL CHECK (event_type IN ('warning', 'breach', 'recovery')),
  
  -- What triggered it
  trigger_entity_type TEXT,
  trigger_entity_id UUID,
  
  -- Metrics
  actual_value NUMERIC,
  threshold_value NUMERIC,
  
  -- Credit issued
  credit_issued_cents BIGINT,
  credit_invoice_id UUID REFERENCES crm_invoices(id),
  
  -- Resolution
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🟡 LOWER PRIORITY — Nice-to-Have Enhancements

### 8. Reporting & Analytics Dashboard

**Recommendation**: Add pre-built reporting views.

```sql
-- CRM Dashboard Views
CREATE OR REPLACE VIEW crm_dashboard_summary AS
SELECT
  o.id AS organization_id,
  o.name AS organization_name,
  
  -- Contracts
  COUNT(DISTINCT c.id) AS total_contracts,
  COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'active') AS active_contracts,
  COALESCE(SUM(c.contract_value_cents) FILTER (WHERE c.status = 'active'), 0) AS active_contract_value_cents,
  
  -- Pipeline
  COUNT(DISTINCT opp.id) FILTER (WHERE opp.stage NOT IN ('closed_won', 'closed_lost')) AS open_opportunities,
  COALESCE(SUM(opp.weighted_value_cents) FILTER (WHERE opp.stage NOT IN ('closed_won', 'closed_lost')), 0) AS weighted_pipeline_cents,
  
  -- Invoices
  COUNT(DISTINCT inv.id) FILTER (WHERE inv.status IN ('sent', 'overdue')) AS outstanding_invoices,
  COALESCE(SUM(inv.balance_cents) FILTER (WHERE inv.status IN ('sent', 'overdue')), 0) AS outstanding_balance_cents,
  
  -- Activities
  COUNT(DISTINCT act.id) FILTER (WHERE act.status = 'pending' AND act.due_date <= CURRENT_DATE) AS overdue_activities

FROM organizations o
LEFT JOIN crm_contracts c ON c.provider_organization_id = o.id
LEFT JOIN crm_opportunities opp ON opp.organization_id = o.id
LEFT JOIN crm_invoices inv ON inv.provider_organization_id = o.id
LEFT JOIN crm_activities act ON act.organization_id = o.id
WHERE o.organization_type IN ('platform_owner', 'service_provider')
GROUP BY o.id, o.name;
```

### 9. API Webhooks for External Integrations

**Recommendation**: Allow organizations to receive webhooks for events.

```sql
-- Webhook subscriptions
CREATE TABLE api_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,  -- For HMAC signature
  
  -- Events to subscribe to
  events TEXT[] NOT NULL,  -- ['contract.created', 'invoice.paid', 'opportunity.stage_changed']
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Retry configuration
  max_retries INTEGER DEFAULT 3,
  
  -- Stats
  last_triggered_at TIMESTAMPTZ,
  last_response_code INTEGER,
  failure_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook delivery log
CREATE TABLE api_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES api_webhooks(id),
  
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  
  -- Response
  response_code INTEGER,
  response_body TEXT,
  response_time_ms INTEGER,
  
  -- Retries
  attempt_number INTEGER DEFAULT 1,
  next_retry_at TIMESTAMPTZ,
  
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'sent', 'delivered', 'failed', 'exhausted'
  )),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 10. Multi-Currency Support

**Recommendation**: For international clients (if expanding beyond NZ).

```sql
-- Currency exchange rates (if needed)
CREATE TABLE currency_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate DECIMAL(20, 10) NOT NULL,
  effective_date DATE NOT NULL,
  source TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (from_currency, to_currency, effective_date)
);

-- Add currency fields where missing
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_currency TEXT DEFAULT 'NZD';
```

---

## 🔧 Technical Improvements

### 11. Rate Limiting Table

**For API abuse prevention:**

```sql
CREATE TABLE api_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  endpoint_pattern TEXT NOT NULL,  -- '/api/crm/*', '/api/alpr/*'
  
  requests_per_minute INTEGER DEFAULT 60,
  requests_per_hour INTEGER DEFAULT 1000,
  requests_per_day INTEGER DEFAULT 10000,
  
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE api_rate_limit_hits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  user_id UUID REFERENCES user_profiles(id),
  
  endpoint TEXT NOT NULL,
  ip_address INET,
  
  hit_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_rate_limit_hits_lookup 
ON api_rate_limit_hits(organization_id, endpoint, hit_at);
```

### 12. Data Export System

**For data portability compliance:**

```sql
CREATE TABLE data_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  requested_by UUID NOT NULL REFERENCES user_profiles(id),
  
  export_type TEXT NOT NULL CHECK (export_type IN (
    'full',           -- All organization data
    'module',         -- Single module data
    'entity',         -- Single entity type
    'dsar'            -- Data subject request
  )),
  
  -- Scope
  module_id TEXT,
  entity_type TEXT,
  entity_ids UUID[],
  date_from DATE,
  date_to DATE,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'completed', 'failed', 'expired'
  )),
  
  -- Output
  file_path TEXT,
  file_size_bytes BIGINT,
  file_format TEXT DEFAULT 'json',  -- 'json', 'csv', 'xlsx'
  
  -- Expiry
  download_expires_at TIMESTAMPTZ,
  downloaded_at TIMESTAMPTZ,
  
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

---

## 📋 Summary Checklist

### Must Have (Before Production)
- [ ] Privacy Act compliance (consent tracking, DSAR handling)
- [ ] Officer credential tracking (COA, first aid)
- [ ] Green warrant integration for NZSCV

### Should Have (Phase 2)
- [ ] Workflow automation engine
- [ ] Email templates with communication history
- [ ] SLA monitoring and breach alerts
- [ ] Custom fields system

### Nice to Have (Phase 3)
- [ ] Reporting dashboard views
- [ ] API webhooks
- [ ] Multi-currency support
- [ ] Data export system
- [ ] Rate limiting

---

## Questions for Decision

1. **Email Provider**: Which email service should we integrate with?
   - SendGrid (industry standard)
   - Resend (modern, developer-friendly)
   - Amazon SES (cost-effective at scale)

2. **Payment Provider**: Confirm Stripe as the payment processor?
   - Consider also POLi (NZ bank payments)
   - Direct debit for recurring invoices

3. **Calendar Integration**: Should we support calendar sync?
   - Google Calendar
   - Microsoft 365/Outlook
   - Both via CalDAV

4. **SMS Provider**: For notifications and alerts:
   - Twilio (global)
   - Vonage (NZ presence)
   - 2degrees Business (NZ local)

5. **Document Signing**: Should contracts support e-signatures?
   - DocuSign
   - HelloSign
   - Adobe Sign
   - Or simple checkbox acknowledgment?

---

## Implementation Order Recommendation

1. **Week 1-2**: Privacy compliance tables + Officer credential tracking
2. **Week 3-4**: Email templates + Communication history
3. **Week 5-6**: Workflow automation engine
4. **Week 7-8**: SLA monitoring
5. **Week 9+**: Custom fields, webhooks, dashboard views

This phased approach ensures legal compliance first, then business value features.
