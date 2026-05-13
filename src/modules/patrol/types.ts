/**
 * Patrol module types
 */

export interface Patrol {
  id: string
  organization_id: string
  assigned_to: string | null
  officer_name: string
  zone_id: string | null
  zone_name: string
  status: string | null
  scheduled_start_time: string | null
  scheduled_end_time: string | null
  started_at: string | null
  ended_at: string | null
  planned_duration_minutes?: number | null
  actual_end_time?: string | null
  actual_start_time?: string | null
  duration_minutes?: number | null
  breaches_found?: number | null
  notes?: string
  created_at?: string
  updated_at?: string
}

export interface PatrolFilter {
  status?: string
  assigned_to?: string
  zone_id?: string
  date_from?: string
  date_to?: string
}

export interface PatrolStats {
  total: number
  active: number
  completed: number
  cancelled: number
  average_duration: number
}
