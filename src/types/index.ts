// Core domain types — aligned with actual database schema (database.ts)

/** All possible user roles in the system. */
export type UserRole =
  | 'master'
  | 'admin'
  | 'officer'
  | 'admin_officer'
  | 'nzscv_monitor'
  | 'grand_master'
  | 'client_viewer'

export interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  role: UserRole
  organization_id: string | null
  employer_organization_id: string | null
  authorized_work_locations: string[]
  phone: string | null
  job_title: string | null
  requires_driver_license: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Organization {
  id: string
  name: string
  organization_type: 'owner' | 'service_provider' | 'client' | 'contractor' | 'operator' | 'security_company'
  organization_level: number
  parent_organization_id: string | null
  contact_email: string | null
  contact_phone: string | null
  enforcement_workflow: string
  overnight_verification_mode: 'two_photo_verification' | 'one_photo_per_day_inference'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Zone {
  id: string
  name: string
  description: string | null
  organization_id: string
  location_lat: number | null
  location_lng: number | null
  geometry: any
  is_active: boolean
  day_visit_only: boolean
  nights_per_month: number
  max_consecutive_nights: number
  self_contained_required: boolean
  allowed_days: any
  zone_type: string | null
  parent_zone_id: string | null
  needs_admin_review: boolean
  boundary_source: string | null
  parkpow_lot_id: number | null
  created_at: string | null
  updated_at: string | null
  _count?: {
    observations: number
    breaches: number
  }
}

export interface Vehicle {
  /** UUID of the canonical vehicle record. Live DB column: `vehicle_id`. */
  vehicle_id: string
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  /** INTEGER — normalized from TEXT in migration 20260411000003. */
  vehicle_year: number | null
  vehicle_color: string | null
  self_contained: boolean
  self_contained_expiry: string | null
  homeless_status: string | null
  is_homeless: boolean
  is_exempt: boolean
  fc_act_exempt: boolean
  enforcement_count: number
  last_enforcement_at: string | null
  profile_photo: string | null
  profile_photo_url: string | null
  total_observations: number
  total_breaches: number
  total_incidents: number
  total_hs_reports: number
  is_flagged: boolean
  flagged_priority: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  first_seen_at: string
  last_seen_at: string
  created_at: string
  updated_at: string
}

export interface Observation {
  /** PRIMARY KEY — live DB column: `observation_id`. */
  observation_id: string
  /** Nullable secondary UUID. */
  id: string | null
  idempotency_key: string | null
  plate_number: string
  zone_id: string
  organization_id: string
  recorded_at: string
  recorded_by: string | null
  gps_latitude: number | null
  gps_longitude: number | null
  gps_accuracy: number | null
  /** Primary photo column in the live DB. */
  photo: string | null
  /** Secondary photo URL (added later; prefer `photo` when reading). */
  photo_url: string | null
  photo_hash: string | null
  is_compliant: boolean
  is_breach: boolean
  breach_type: string | null
  breach_reason: string | null
  breach_detected_at: string | null
  nights_stayed_this_month: number
  consecutive_nights: number
  vehicle_make: string | null
  vehicle_model: string | null
  /** INTEGER in the live DB (observations.vehicle_year). */
  vehicle_year: number | null  // INTEGER in live DB
  vehicle_color: string | null
  self_contained: boolean
  officer_notes: string | null
  observation_notes: string | null
  portal_used: string | null
  has_notes: boolean
  has_incident: boolean
  incident_id: string | null
  has_hs_incident: boolean
  has_homeless_claim: boolean
  created_at: string
  updated_at: string
}

/**
 * Breach types as stored in the database (breach_alerts.breach_type).
 * These values are enforced by the compliance engine trigger and match
 * the CHECK constraint in the breach_alerts table.
 */
export type BreachType =
  | 'consecutive_nights'
  | 'monthly_limit'
  | 'self_contained'
  | 'after_hours'
  | 'day_visit_violation'
  | 'allowed_days_violation'

/**
 * Breach alert workflow statuses as stored in breach_alerts.status.
 * The lifecycle is: pending → acknowledged → enforcement_started → resolved | dismissed
 */
export type BreachStatus =
  | 'pending'
  | 'acknowledged'
  | 'enforcement_started'
  | 'resolved'
  | 'dismissed'

export type Severity = 
  | 'low' 
  | 'medium' 
  | 'high' 
  | 'critical'

export interface BreachAlert {
  id: string
  organization_id: string
  zone_id: string
  plate_number: string | null
  observation_id: string | null
  vehicle_record_id: string | null
  patrol_id: string | null
  breach_type: BreachType
  breach_details: any
  due_date: string | null
  notification_sent: boolean
  notification_method: string | null
  notified_at: string | null
  notified_by: string | null
  status: BreachStatus
  resolution_notes: string | null
  resolved_at: string | null
  assigned_to: string | null
  assigned_at: string | null
  assigned_by: string | null
  admin_reviewed_by: string | null
  admin_reviewed_at: string | null
  admin_review_notes: string | null
  created_at: string
  updated_at: string
  /** Computed severity — not a DB column, derived in UI from breach_type / details. */
  severity?: Severity
}

export type PatrolStatus = 
  | 'scheduled' 
  | 'in_progress' 
  | 'completed' 
  | 'cancelled'

export interface Patrol {
  id: string
  officer_id: string
  zone_id: string
  organization_id: string
  status: PatrolStatus
  started_at: string | null
  ended_at: string | null
  vehicles_checked: number
  breaches_found: number
  officer?: {
    first_name: string
    last_name: string
  }
  zone?: {
    name: string
  }
}

// ============================================================================
// Reporting System Types (Migration 20260513000001)
// ============================================================================

/**
 * Report data source configuration - defines available tables/views for reporting
 */
export interface ReportDataSource {
  id: string
  code: string // e.g., 'observations', 'vehicles', 'patrols'
  name: string
  description: string | null
  table_name: string
  default_columns: string[]
  available_columns: any // JSONB with column definitions
  supports_date_filter: boolean
  date_column: string | null
  supports_org_filter: boolean
  org_column: string | null
  is_active: boolean
  created_at: string
}

/**
 * Saved report template configuration
 */
export interface ReportTemplate {
  id: string
  organization_id: string
  name: string
  description: string | null
  data_source_code: string
  selected_columns: string[]
  filters: any // JSONB with filter configuration
  sort_by: string | null
  sort_direction: 'asc' | 'desc'
  group_by: string | null
  is_favorite: boolean
  shared_with: string[] // array of user UUIDs
  created_by: string
  created_at: string
  updated_at: string
}

/**
 * Scheduled report generation configuration
 */
export interface ReportSchedule {
  id: string
  template_id: string
  schedule_type: 'daily' | 'weekly' | 'monthly' | 'quarterly'
  day_of_week: number | null // 0-6 for weekly
  day_of_month: number | null // 1-31 for monthly
  time_of_day: string // HH:MM format
  timezone: string
  output_format: 'csv' | 'pdf' | 'excel'
  email_recipients: string[]
  is_active: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

/**
 * Report generation history/audit trail
 */
export interface ReportHistory {
  id: string
  template_id: string | null
  organization_id: string
  report_name: string
  data_source_code: string
  parameters: any // JSONB with generation parameters
  row_count: number
  file_url: string | null
  file_size_bytes: number | null
  generated_by: string
  generation_time_ms: number | null
  status: 'pending' | 'generating' | 'completed' | 'failed'
  error_message: string | null
  created_at: string
}

// ============================================================================
// Organization Configuration Types (Migration 20260514000001)
// ============================================================================

/**
 * Secure credential storage for organization-specific integrations
 */
export interface OrganizationCredential {
  id: string
  organization_id: string
  credential_type: 'smtp_password' | 'sms_auth_token' | 'sms_account_sid'
  encrypted_value: string
  created_at: string
  updated_at: string
  created_by: string | null
}

/**
 * Rate limit tracking entry
 */
export interface RateLimitEntry {
  id: string
  key: string // e.g., 'ip:192.168.1.1:create-user' or 'user:uuid:endpoint'
  count: number
  window_start: string
}

/**
 * Extended organization fields for SMTP/SMS configuration
 */
export interface OrganizationConfig {
  // SMTP Configuration
  smtp_host: string | null
  smtp_port: number | null
  smtp_username: string | null
  smtp_from_email: string | null
  smtp_from_name: string | null
  use_custom_smtp: boolean
  
  // SMS Configuration
  sms_provider: 'twilio' | 'vonage' | 'aws_sns' | 'messagebird' | null
  sms_from_number: string | null
  use_custom_sms: boolean
  
  // Password Policy
  password_min_length: number
  password_require_uppercase: boolean
  password_require_lowercase: boolean
  password_require_number: boolean
  password_require_special: boolean
}
