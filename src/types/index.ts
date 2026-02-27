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
  id: string
  plate_number: string
  make: string | null
  model: string | null
  year: number | null
  colour: string | null
  self_contained: boolean
  self_contained_expiry: string | null
  homeless_status: string | null
  is_exempt: boolean
  enforcement_count: number
  last_enforcement_at: string | null
  profile_photo: string | null
  total_observations: number
  total_breaches: number
  organization_id: string | null
  created_at: string
}

export interface Observation {
  id: string
  plate_number: string
  zone_id: string
  organization_id: string
  recorded_at: string
  recorded_by: string
  gps_latitude: number
  gps_longitude: number
  photo_url: string
  is_compliant: boolean
  created_at: string
}

export type BreachType = 
  | 'overstay' 
  | 'no_self_contained' 
  | 'consecutive_days' 
  | 'unauthorized_zone' 
  | 'nights_exceeded'

export type BreachStatus = 
  | 'pending' 
  | 'notified' 
  | 'resolved' 
  | 'escalated'

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
  detected_at: string
  resolved_at: string | null
  resolved_by: string | null
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
