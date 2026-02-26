// Auto-generated Supabase database types
// This file will be regenerated when running: supabase gen types typescript

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          type: 'owner' | 'service_provider' | 'client'
          parent_organization_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          type?: 'owner' | 'service_provider' | 'client'
          parent_organization_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          type?: 'owner' | 'service_provider' | 'client'
          parent_organization_id?: string | null
          created_at?: string
        }
      }
      user_profiles: {
        Row: {
          id: string
          email: string
          full_name: string
          role: 'master' | 'admin' | 'officer' | 'admin_officer'
          organization_id: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role: 'master' | 'admin' | 'officer' | 'admin_officer'
          organization_id?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: 'master' | 'admin' | 'officer' | 'admin_officer'
          organization_id?: string | null
          is_active?: boolean
          created_at?: string
        }
      }
      zones: {
        Row: {
          id: string
          name: string
          organization_id: string
          latitude: number | null
          longitude: number | null
          is_active: boolean
          is_day_visit_only: boolean
          max_nights_per_month: number
          max_consecutive_nights: number
          requires_self_contained: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          organization_id: string
          latitude?: number | null
          longitude?: number | null
          is_active?: boolean
          is_day_visit_only?: boolean
          max_nights_per_month?: number
          max_consecutive_nights?: number
          requires_self_contained?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          organization_id?: string
          latitude?: number | null
          longitude?: number | null
          is_active?: boolean
          is_day_visit_only?: boolean
          max_nights_per_month?: number
          max_consecutive_nights?: number
          requires_self_contained?: boolean
          created_at?: string
        }
      }
      canonical_vehicles: {
        Row: {
          id: string
          plate_number: string
          make: string | null
          model: string | null
          year: number | null
          colour: string | null
          is_self_contained: boolean
          organization_id: string | null
          total_observations: number
          total_breaches: number
          created_at: string
        }
        Insert: {
          id?: string
          plate_number: string
          make?: string | null
          model?: string | null
          year?: number | null
          colour?: string | null
          is_self_contained?: boolean
          organization_id?: string | null
          total_observations?: number
          total_breaches?: number
          created_at?: string
        }
        Update: {
          id?: string
          plate_number?: string
          make?: string | null
          model?: string | null
          year?: number | null
          colour?: string | null
          is_self_contained?: boolean
          organization_id?: string | null
          total_observations?: number
          total_breaches?: number
          created_at?: string
        }
      }
      observations: {
        Row: {
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
          created_at: string
        }
        Insert: {
          id?: string
          plate_number: string
          zone_id: string
          organization_id: string
          recorded_at: string
          recorded_by: string
          latitude: number
          longitude: number
          photo_url: string
          is_compliant?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          plate_number?: string
          zone_id?: string
          organization_id?: string
          recorded_at?: string
          recorded_by?: string
          latitude?: number
          longitude?: number
          photo_url?: string
          is_compliant?: boolean
          created_at?: string
        }
      }
      breach_alerts: {
        Row: {
          id: string
          plate_number: string
          zone_id: string
          organization_id: string
          breach_type: 'overstay' | 'no_self_contained' | 'consecutive_days' | 'unauthorized_zone' | 'nights_exceeded'
          status: 'pending' | 'notified' | 'resolved' | 'escalated'
          severity: 'low' | 'medium' | 'high' | 'critical'
          detected_at: string
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          id?: string
          plate_number: string
          zone_id: string
          organization_id: string
          breach_type: 'overstay' | 'no_self_contained' | 'consecutive_days' | 'unauthorized_zone' | 'nights_exceeded'
          status?: 'pending' | 'notified' | 'resolved' | 'escalated'
          severity?: 'low' | 'medium' | 'high' | 'critical'
          detected_at: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          id?: string
          plate_number?: string
          zone_id?: string
          organization_id?: string
          breach_type?: 'overstay' | 'no_self_contained' | 'consecutive_days' | 'unauthorized_zone' | 'nights_exceeded'
          status?: 'pending' | 'notified' | 'resolved' | 'escalated'
          severity?: 'low' | 'medium' | 'high' | 'critical'
          detected_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
      }
      patrols: {
        Row: {
          id: string
          officer_id: string
          zone_id: string
          organization_id: string
          status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
          started_at: string | null
          ended_at: string | null
          vehicles_checked: number
          breaches_found: number
        }
        Insert: {
          id?: string
          officer_id: string
          zone_id: string
          organization_id: string
          status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
          started_at?: string | null
          ended_at?: string | null
          vehicles_checked?: number
          breaches_found?: number
        }
        Update: {
          id?: string
          officer_id?: string
          zone_id?: string
          organization_id?: string
          status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
          started_at?: string | null
          ended_at?: string | null
          vehicles_checked?: number
          breaches_found?: number
        }
      }
    }
    Functions: {
      get_admin_dashboard_stats: {
        Args: {
          p_organization_id: string | null
          p_date_from: string | null
          p_date_to: string | null
        }
        Returns: {
          total_observations: number
          compliant_observations: number
          non_compliant_observations: number
          active_breaches: number
          total_vehicles: number
          active_patrols: number
          compliance_rate: number
          trend_direction: 'up' | 'down' | 'stable'
          trend_percentage: number
        }
      }
    }
  }
}
