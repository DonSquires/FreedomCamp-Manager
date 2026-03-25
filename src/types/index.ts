// Core domain types — aligned with actual database schema (database.ts)
export interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  role: 'master' | 'admin' | 'officer' | 'admin_officer' | 'nzscv_monitor' | 'grand_master' | 'client_viewer'
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
  organization_type: 'owner' | 'service_provider' | 'client'
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
