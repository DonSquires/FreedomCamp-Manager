/**
 * Supabase Database Types - Aligned with actual schema
 * Generated from migrations and actual database structure
 * 
 * CRITICAL: This file has been corrected to match the ACTUAL database schema
 * Previous version had major mismatches (latitude vs gps_latitude, full_name vs first_name/last_name, etc.)
 */

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          organization_type: 'owner' | 'service_provider' | 'client'
          organization_level: number
          parent_organization_id: string | null
          contact_email: string | null
          contact_phone: string | null
          enforcement_workflow: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          organization_type?: 'owner' | 'service_provider' | 'client'
          organization_level?: number
          parent_organization_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          enforcement_workflow?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          organization_type?: 'owner' | 'service_provider' | 'client'
          organization_level?: number
          parent_organization_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          enforcement_workflow?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      user_profiles: {
        Row: {
          id: string
          email: string
          first_name: string
          last_name: string
          role: 'master' | 'admin' | 'officer' | 'admin_officer'
          organization_id: string | null
          employer_organization_id: string | null
          authorized_work_locations: string[]
          phone: string | null
          is_active: boolean
          permissions: any
          coa_number: string | null
          coa_expiry: string | null
          coa_document_url: string | null
          coa_required: boolean
          coa_verified: boolean
          warrant_number: string | null
          warrant_expiry: string | null
          warrant_document_url: string | null
          warrant_required: boolean
          warrant_verified: boolean
          authorized_activities: string[]
          warrant_acts: string[]
          last_location: any
          portal_used: string | null
          push_token: string | null
          push_token_updated_at: string | null
          notification_preferences: any
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          first_name: string
          last_name: string
          role: 'master' | 'admin' | 'officer' | 'admin_officer'
          organization_id?: string | null
          employer_organization_id?: string | null
          authorized_work_locations?: string[]
          phone?: string | null
          is_active?: boolean
          permissions?: any
          coa_number?: string | null
          coa_expiry?: string | null
          coa_document_url?: string | null
          coa_required?: boolean
          coa_verified?: boolean
          warrant_number?: string | null
          warrant_expiry?: string | null
          warrant_document_url?: string | null
          warrant_required?: boolean
          warrant_verified?: boolean
          authorized_activities?: string[]
          warrant_acts?: string[]
          last_location?: any
          portal_used?: string | null
          push_token?: string | null
          push_token_updated_at?: string | null
          notification_preferences?: any
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          first_name?: string
          last_name?: string
          role?: 'master' | 'admin' | 'officer' | 'admin_officer'
          organization_id?: string | null
          employer_organization_id?: string | null
          authorized_work_locations?: string[]
          phone?: string | null
          is_active?: boolean
          permissions?: any
          coa_number?: string | null
          coa_expiry?: string | null
          coa_document_url?: string | null
          coa_required?: boolean
          coa_verified?: boolean
          warrant_number?: string | null
          warrant_expiry?: string | null
          warrant_document_url?: string | null
          warrant_required?: boolean
          warrant_verified?: boolean
          authorized_activities?: string[]
          warrant_acts?: string[]
          last_location?: any
          portal_used?: string | null
          push_token?: string | null
          push_token_updated_at?: string | null
          notification_preferences?: any
          created_at?: string
          updated_at?: string
        }
      }
      zones: {
        Row: {
          id: string
          name: string
          description: string | null
          organization_id: string
          location_lat: number | null
          location_lng: number | null
          geometry: any
          geom: any
          is_active: boolean
          day_visit_only: boolean
          nights_per_month: number
          max_consecutive_nights: number
          self_contained_required: boolean
          allowed_days: any
          zone_type: string
          parent_zone_id: string | null
          needs_admin_review: boolean
          boundary_source: string
          bylaw_source_url: string | null
          bylaw_pdf_hash: string | null
          bylaw_clause: string | null
          bylaw_effective_date: string | null
          land_manager: string | null
          enforcement_authority: string | null
          parkpow_lot_id: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          organization_id: string
          location_lat?: number | null
          location_lng?: number | null
          geometry?: any
          geom?: any
          is_active?: boolean
          day_visit_only?: boolean
          nights_per_month?: number
          max_consecutive_nights?: number
          self_contained_required?: boolean
          allowed_days?: any
          zone_type?: string
          parent_zone_id?: string | null
          needs_admin_review?: boolean
          boundary_source?: string
          bylaw_source_url?: string | null
          bylaw_pdf_hash?: string | null
          bylaw_clause?: string | null
          bylaw_effective_date?: string | null
          land_manager?: string | null
          enforcement_authority?: string | null
          parkpow_lot_id?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          organization_id?: string
          location_lat?: number | null
          location_lng?: number | null
          geometry?: any
          geom?: any
          is_active?: boolean
          day_visit_only?: boolean
          nights_per_month?: number
          max_consecutive_nights?: number
          self_contained_required?: boolean
          allowed_days?: any
          zone_type?: string
          parent_zone_id?: string | null
          needs_admin_review?: boolean
          boundary_source?: string
          bylaw_source_url?: string | null
          bylaw_pdf_hash?: string | null
          bylaw_clause?: string | null
          bylaw_effective_date?: string | null
          land_manager?: string | null
          enforcement_authority?: string | null
          parkpow_lot_id?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      canonical_vehicles: {
        Row: {
          plate_number: string
          id: string
          make: string | null
          model: string | null
          year: number | null
          colour: string | null
          body_style: string | null
          self_contained: boolean
          self_contained_expiry: string | null
          homeless_status: string
          homeless_confirmed_at: string | null
          homeless_confirmed_by: string | null
          homeless_notes: string | null
          is_flagged: boolean
          flagged_priority: string | null
          flagged_reason: string | null
          flagged_notes: string | null
          flagged_at: string | null
          flagged_by: string | null
          is_exempt: boolean
          owner_first_name: string | null
          owner_last_name: string | null
          owner_company_name: string | null
          owner_address: string | null
          owner_address_verified: boolean
          profile_photo: string | null
          profile_photo_selected_at: string | null
          profile_photo_metadata: any
          total_notes: number
          last_note_at: string | null
          last_note_preview: string | null
          first_seen_at: string
          last_seen_at: string
          total_observations: number
          total_breaches: number
          total_incidents: number
          total_hs_reports: number
          enforcement_count: number
          last_enforcement_at: string | null
          last_enforcement_type: string | null
          nzscv_last_checked: string | null
          nzscv_source: string | null
          nzscv_warrant_type: string | null
          nzscv_warrant_number: string | null
          nzscv_warrant_expires_on: string | null
          parkpow_vehicle_id: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          plate_number: string
          id?: string
          make?: string | null
          model?: string | null
          year?: number | null
          colour?: string | null
          body_style?: string | null
          self_contained?: boolean
          self_contained_expiry?: string | null
          homeless_status?: string
          homeless_confirmed_at?: string | null
          homeless_confirmed_by?: string | null
          homeless_notes?: string | null
          is_flagged?: boolean
          flagged_priority?: string | null
          flagged_reason?: string | null
          flagged_notes?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          is_exempt?: boolean
          owner_first_name?: string | null
          owner_last_name?: string | null
          owner_company_name?: string | null
          owner_address?: string | null
          owner_address_verified?: boolean
          profile_photo?: string | null
          profile_photo_selected_at?: string | null
          profile_photo_metadata?: any
          total_notes?: number
          last_note_at?: string | null
          last_note_preview?: string | null
          first_seen_at?: string
          last_seen_at?: string
          total_observations?: number
          total_breaches?: number
          total_incidents?: number
          total_hs_reports?: number
          enforcement_count?: number
          last_enforcement_at?: string | null
          last_enforcement_type?: string | null
          nzscv_last_checked?: string | null
          nzscv_source?: string | null
          nzscv_warrant_type?: string | null
          nzscv_warrant_number?: string | null
          nzscv_warrant_expires_on?: string | null
          parkpow_vehicle_id?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          plate_number?: string
          id?: string
          make?: string | null
          model?: string | null
          year?: number | null
          colour?: string | null
          body_style?: string | null
          self_contained?: boolean
          self_contained_expiry?: string | null
          homeless_status?: string
          homeless_confirmed_at?: string | null
          homeless_confirmed_by?: string | null
          homeless_notes?: string | null
          is_flagged?: boolean
          flagged_priority?: string | null
          flagged_reason?: string | null
          flagged_notes?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          is_exempt?: boolean
          owner_first_name?: string | null
          owner_last_name?: string | null
          owner_company_name?: string | null
          owner_address?: string | null
          owner_address_verified?: boolean
          profile_photo?: string | null
          profile_photo_selected_at?: string | null
          profile_photo_metadata?: any
          total_notes?: number
          last_note_at?: string | null
          last_note_preview?: string | null
          first_seen_at?: string
          last_seen_at?: string
          total_observations?: number
          total_breaches?: number
          total_incidents?: number
          total_hs_reports?: number
          enforcement_count?: number
          last_enforcement_at?: string | null
          last_enforcement_type?: string | null
          nzscv_last_checked?: string | null
          nzscv_source?: string | null
          nzscv_warrant_type?: string | null
          nzscv_warrant_number?: string | null
          nzscv_warrant_expires_on?: string | null
          parkpow_vehicle_id?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      observations: {
        Row: {
          id: string
          idempotency_key: string
          plate_number: string
          photo_url: string
          photo_hash: string
          recorded_at: string
          zone_id: string
          organization_id: string
          gps_latitude: number
          gps_longitude: number
          gps_accuracy: number | null
          recorded_by: string
          officer_notes: string | null
          weather_conditions: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: number | null
          vehicle_color: string | null
          self_contained: boolean
          self_contained_expiry: string | null
          is_compliant: boolean
          breach_type: string | null
          breach_reason: string | null
          nights_stayed_this_month: number
          consecutive_nights: number
          vehicle_embedding: any
          embedding_quality: number | null
          embedding_model_version: string | null
          embedding_created_at: string | null
          parkpow_session_id: number | null
          parkpow_violation_id: number | null
          retention_pending: boolean
          retention_reason: string | null
          retention_marked_at: string | null
          deleted_at: string | null
          processing_status: string | null
          processing_started_at: string | null
          processing_completed_at: string | null
          processing_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          idempotency_key: string
          plate_number: string
          photo_url: string
          photo_hash: string
          recorded_at: string
          zone_id: string
          organization_id: string
          gps_latitude: number
          gps_longitude: number
          gps_accuracy?: number | null
          recorded_by: string
          officer_notes?: string | null
          weather_conditions?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          vehicle_color?: string | null
          self_contained?: boolean
          self_contained_expiry?: string | null
          is_compliant?: boolean
          breach_type?: string | null
          breach_reason?: string | null
          nights_stayed_this_month?: number
          consecutive_nights?: number
          vehicle_embedding?: any
          embedding_quality?: number | null
          embedding_model_version?: string | null
          embedding_created_at?: string | null
          parkpow_session_id?: number | null
          parkpow_violation_id?: number | null
          retention_pending?: boolean
          retention_reason?: string | null
          retention_marked_at?: string | null
          deleted_at?: string | null
          processing_status?: string | null
          processing_started_at?: string | null
          processing_completed_at?: string | null
          processing_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          idempotency_key?: string
          plate_number?: string
          photo_url?: string
          photo_hash?: string
          recorded_at?: string
          zone_id?: string
          organization_id?: string
          gps_latitude?: number
          gps_longitude?: number
          gps_accuracy?: number | null
          recorded_by?: string
          officer_notes?: string | null
          weather_conditions?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          vehicle_color?: string | null
          self_contained?: boolean
          self_contained_expiry?: string | null
          is_compliant?: boolean
          breach_type?: string | null
          breach_reason?: string | null
          nights_stayed_this_month?: number
          consecutive_nights?: number
          vehicle_embedding?: any
          embedding_quality?: number | null
          embedding_model_version?: string | null
          embedding_created_at?: string | null
          parkpow_session_id?: number | null
          parkpow_violation_id?: number | null
          retention_pending?: boolean
          retention_reason?: string | null
          retention_marked_at?: string | null
          deleted_at?: string | null
          processing_status?: string | null
          processing_started_at?: string | null
          processing_completed_at?: string | null
          processing_error?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      observation_jobs: {
        Row: {
          id: string
          observation_id: string
          job_type: string
          status: 'pending' | 'processing' | 'completed' | 'failed'
          recorded_by: string
          organization_id: string
          input_data: any
          output_data: any
          error_message: string | null
          attempts: number
          max_attempts: number
          created_at: string
          updated_at: string
          started_at: string | null
          completed_at: string | null
        }
        Insert: {
          id?: string
          observation_id: string
          job_type?: string
          status?: 'pending' | 'processing' | 'completed' | 'failed'
          recorded_by: string
          organization_id: string
          input_data?: any
          output_data?: any
          error_message?: string | null
          attempts?: number
          max_attempts?: number
          created_at?: string
          updated_at?: string
          started_at?: string | null
          completed_at?: string | null
        }
        Update: {
          id?: string
          observation_id?: string
          job_type?: string
          status?: 'pending' | 'processing' | 'completed' | 'failed'
          recorded_by?: string
          organization_id?: string
          input_data?: any
          output_data?: any
          error_message?: string | null
          attempts?: number
          max_attempts?: number
          created_at?: string
          updated_at?: string
          started_at?: string | null
          completed_at?: string | null
        }
      }
      breach_alerts: {
        Row: {
          id: string
          organization_id: string
          patrol_id: string | null
          vehicle_record_id: string | null
          zone_id: string
          breach_type: string
          breach_details: any
          due_date: string | null
          notification_sent: boolean
          notification_method: string | null
          notified_at: string | null
          notified_by: string | null
          status: string
          resolution_notes: string | null
          resolved_at: string | null
          observation_id: string | null
          assigned_to: string | null
          assigned_at: string | null
          assigned_by: string | null
          admin_reviewed_by: string | null
          admin_reviewed_at: string | null
          admin_review_notes: string | null
          plate_number: string | null
          vehicle_id: string | null
          compliance_result_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          patrol_id?: string | null
          vehicle_record_id?: string | null
          zone_id: string
          breach_type: string
          breach_details: any
          due_date?: string | null
          notification_sent?: boolean
          notification_method?: string | null
          notified_at?: string | null
          notified_by?: string | null
          status?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          observation_id?: string | null
          assigned_to?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          admin_reviewed_by?: string | null
          admin_reviewed_at?: string | null
          admin_review_notes?: string | null
          plate_number?: string | null
          vehicle_id?: string | null
          compliance_result_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          patrol_id?: string | null
          vehicle_record_id?: string | null
          zone_id?: string
          breach_type?: string
          breach_details?: any
          due_date?: string | null
          notification_sent?: boolean
          notification_method?: string | null
          notified_at?: string | null
          notified_by?: string | null
          status?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          observation_id?: string | null
          assigned_to?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          admin_reviewed_by?: string | null
          admin_reviewed_at?: string | null
          admin_review_notes?: string | null
          plate_number?: string | null
          vehicle_id?: string | null
          compliance_result_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      patrols: {
        Row: {
          id: string
          organization_id: string
          zone_id: string
          patrol_date: string
          shift: string
          assigned_to: string | null
          checked_in_at: string | null
          check_in_location_lat: number | null
          check_in_location_lng: number | null
          completed_at: string | null
          status: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          zone_id: string
          patrol_date: string
          shift: string
          assigned_to?: string | null
          checked_in_at?: string | null
          check_in_location_lat?: number | null
          check_in_location_lng?: number | null
          completed_at?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          zone_id?: string
          patrol_date?: string
          shift?: string
          assigned_to?: string | null
          checked_in_at?: string | null
          check_in_location_lat?: number | null
          check_in_location_lng?: number | null
          completed_at?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      // Add other tables as needed
    }
    Functions: {
      get_user_role: {
        Args: { uid: string }
        Returns: string
      }
      get_user_organization_id: {
        Args: { uid: string }
        Returns: string
      }
      get_user_organization_ids: {
        Args: { uid: string }
        Returns: string[]
      }
      get_admin_dashboard_stats: {
        Args: {
          p_organization_id?: string | null
          p_date_from?: string | null
          p_date_to?: string | null
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
      ensure_other_location_zone: {
        Args: { p_organization_id: string }
        Returns: string
      }
    }
  }
}
