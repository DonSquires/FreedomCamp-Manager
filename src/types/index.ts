// Core type definitions

export type UserRole = 'master' | 'admin' | 'officer' | 'admin_officer'

export type BreachType = 
  | 'overstay'
  | 'no_self_contained'
  | 'consecutive_days'
  | 'unauthorized_zone'
  | 'nights_exceeded'

export type BreachStatus = 'pending' | 'notified' | 'resolved' | 'escalated'

export type PatrolStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export type Severity = 'low' | 'medium' | 'high' | 'critical'

export interface Zone {
  id: string
  name: string
  organization_id: string
  latitude: number | null
  longitude: number | null
  geofence: any | null
  is_active: boolean
  max_nights_per_month: number
  max_consecutive_nights: number
  requires_self_contained: boolean
  is_day_visit_only: boolean
  created_at: string
}

export interface BreachAlert {
  id: string
  plate_number: string
  zone_id: string
  organization_id: string
  breach_type: BreachType
  status: BreachStatus
  severity: Severity
  detected_at: string
  resolved_at: string | null
  resolved_by: string | null
}

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
}

export interface VehicleObservation {
  id: string
  plate_number: string
  zone_id: string
  organization_id: string
  recorded_at: string
  recorded_by: string
  latitude: number
  longitude: number
  photo_url: string
  is_compliant: boolean
}

export interface UserProfile {
  id: string
  email: string
  role: UserRole
  organization_id: string | null
  first_name: string
  last_name: string
  is_active: boolean
  created_at: string
}
