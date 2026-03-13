// Core domain types
export interface User {
  id: string
  email: string
  full_name: string
  role: 'master' | 'admin' | 'officer' | 'admin_officer'
  organization_id: string | null
  is_active: boolean
  created_at: string
}

export interface Organization {
  id: string
  name: string
  type: 'owner' | 'service_provider' | 'client'
  parent_organization_id: string | null
  created_at: string
}

export interface Zone {
  id: string
  name: string
  organization_id: string
  location_lat: number | null
  location_lng: number | null
  is_active: boolean
  day_visit_only: boolean
  nights_per_month: number
  max_consecutive_nights: number
  self_contained_required: boolean
  created_at: string
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
  /** TEXT in the live DB, not an integer. */
  vehicle_year: string | null
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
  /** TEXT in the live DB. */
  vehicle_year: string | null
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
  plate_number: string
  zone_id: string
  organization_id: string
  breach_type: BreachType
  status: BreachStatus
  severity: Severity
  /** `created_at` is the actual DB column; `detected_at` is a legacy alias. */
  created_at: string
  resolved_at: string | null
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
    full_name: string
  }
  zone?: {
    name: string
  }
}
