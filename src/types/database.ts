// Generated Supabase types
// Run: supabase gen types typescript > src/types/database.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string
          email: string
          role: string
          organization_id: string | null
          first_name: string
          last_name: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          id: string
          email: string
          role: string
          organization_id?: string | null
          first_name: string
          last_name: string
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          role?: string
          organization_id?: string | null
          first_name?: string
          last_name?: string
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
          geofence: Json | null
          is_active: boolean
          max_nights_per_month: number
          max_consecutive_nights: number
          requires_self_contained: boolean
          is_day_visit_only: boolean
          created_at: string
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
      }
    }
  }
}
