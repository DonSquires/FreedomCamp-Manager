export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      alert_acknowledgements: {
        Row: {
          acknowledged_at: string | null
          acknowledgement_type: string
          action_taken: string | null
          alert_id: string
          created_at: string | null
          device_info: Json | null
          evidence_photos: string[] | null
          follow_up_date: string | null
          follow_up_required: boolean | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          notes: string | null
          report_created_id: string | null
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledgement_type: string
          action_taken?: string | null
          alert_id: string
          created_at?: string | null
          device_info?: Json | null
          evidence_photos?: string[] | null
          follow_up_date?: string | null
          follow_up_required?: boolean | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          notes?: string | null
          report_created_id?: string | null
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledgement_type?: string
          action_taken?: string | null
          alert_id?: string
          created_at?: string | null
          device_info?: Json | null
          evidence_photos?: string[] | null
          follow_up_date?: string | null
          follow_up_required?: boolean | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          notes?: string | null
          report_created_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_acknowledgements_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alert_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_acknowledgements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "alert_acknowledgements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_queue: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledgement_notes: string | null
          alert_type: string
          can_dismiss: boolean | null
          created_at: string | null
          details: Json | null
          expires_at: string | null
          id: string
          message: string
          observation_id: string | null
          organization_id: string
          person_id: string | null
          priority: string
          push_sent: boolean | null
          push_sent_at: string | null
          requires_acknowledgement: boolean | null
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
          vehicle_id: string | null
          zone_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_notes?: string | null
          alert_type: string
          can_dismiss?: boolean | null
          created_at?: string | null
          details?: Json | null
          expires_at?: string | null
          id?: string
          message: string
          observation_id?: string | null
          organization_id: string
          person_id?: string | null
          priority: string
          push_sent?: boolean | null
          push_sent_at?: string | null
          requires_acknowledgement?: boolean | null
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
          vehicle_id?: string | null
          zone_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_notes?: string | null
          alert_type?: string
          can_dismiss?: boolean | null
          created_at?: string | null
          details?: Json | null
          expires_at?: string | null
          id?: string
          message?: string
          observation_id?: string | null
          organization_id?: string
          person_id?: string | null
          priority?: string
          push_sent?: boolean | null
          push_sent_at?: string | null
          requires_acknowledgement?: boolean | null
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
          vehicle_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_queue_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "alert_queue_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_queue_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations"
            referencedColumns: ["observation_id"]
          },
          {
            foreignKeyName: "alert_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_queue_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "alert_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_queue_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "active_breaches_v2"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "alert_queue_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "alert_queue_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "alert_queue_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          new_values: Json | null
          old_values: Json | null
          performed_by: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          performed_by?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dispute_intake: {
        Row: {
          id: string
          organization_id: string | null
          zone_id: string | null
          source_type: string
          source_reference: string | null
          plate_number: string | null
          claimant_name: string | null
          claimant_email: string | null
          claimant_phone: string | null
          message: string
          request_homeless_review: boolean
          hardship_context: string | null
          evidence_statement: string | null
          submitted_via: string
          status: string
          assigned_to: string | null
          admin_notes: string | null
          submitted_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id?: string | null
          zone_id?: string | null
          source_type: string
          source_reference?: string | null
          plate_number?: string | null
          claimant_name?: string | null
          claimant_email?: string | null
          claimant_phone?: string | null
          message: string
          request_homeless_review?: boolean
          hardship_context?: string | null
          evidence_statement?: string | null
          submitted_via?: string
          status?: string
          assigned_to?: string | null
          admin_notes?: string | null
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string | null
          zone_id?: string | null
          source_type?: string
          source_reference?: string | null
          plate_number?: string | null
          claimant_name?: string | null
          claimant_email?: string | null
          claimant_phone?: string | null
          message?: string
          request_homeless_review?: boolean
          hardship_context?: string | null
          evidence_statement?: string | null
          submitted_via?: string
          status?: string
          assigned_to?: string | null
          admin_notes?: string | null
          submitted_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      breach_alerts: {
        Row: {
          admin_review_notes: string | null
          admin_reviewed_at: string | null
          admin_reviewed_by: string | null
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          breach_details: Json
          breach_type: string
          created_at: string | null
          due_date: string | null
          id: string
          notification_method: string | null
          notification_sent: boolean | null
          notified_at: string | null
          notified_by: string | null
          observation_id: string | null
          organization_id: string
          patrol_id: string | null
          plate_number: string | null
          resolution_notes: string | null
          resolved_at: string | null
          status: string | null
          updated_at: string | null
          vehicle_record_id: string | null
          zone_id: string
        }
        Insert: {
          admin_review_notes?: string | null
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          breach_details?: Json
          breach_type: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          notification_method?: string | null
          notification_sent?: boolean | null
          notified_at?: string | null
          notified_by?: string | null
          observation_id?: string | null
          organization_id: string
          patrol_id?: string | null
          plate_number?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string | null
          updated_at?: string | null
          vehicle_record_id?: string | null
          zone_id: string
        }
        Update: {
          admin_review_notes?: string | null
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          breach_details?: Json
          breach_type?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          notification_method?: string | null
          notification_sent?: boolean | null
          notified_at?: string | null
          notified_by?: string | null
          observation_id?: string | null
          organization_id?: string
          patrol_id?: string | null
          plate_number?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string | null
          updated_at?: string | null
          vehicle_record_id?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "breach_alerts_admin_reviewed_by_fkey"
            columns: ["admin_reviewed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "breach_alerts_admin_reviewed_by_fkey"
            columns: ["admin_reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breach_alerts_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "breach_alerts_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breach_alerts_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "breach_alerts_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breach_alerts_notified_by_fkey"
            columns: ["notified_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "breach_alerts_notified_by_fkey"
            columns: ["notified_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breach_alerts_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations"
            referencedColumns: ["observation_id"]
          },
          {
            foreignKeyName: "breach_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breach_alerts_patrol_id_fkey"
            columns: ["patrol_id"]
            isOneToOne: false
            referencedRelation: "patrols"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breach_alerts_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "active_breaches_v2"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "breach_alerts_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "breach_alerts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "breach_alerts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_reports: {
        Row: {
          actual_behavior: string | null
          admin_notified: boolean | null
          ai_analysis: Json | null
          ai_analyzed: boolean | null
          ai_suggested_fix: string | null
          app_version: string
          browser_info: Json | null
          console_errors: Json | null
          created_at: string | null
          current_page: string | null
          description: string
          device_info: Json | null
          expected_behavior: string | null
          id: string
          issue_type: string
          network_status: string | null
          notification_sent_at: string | null
          organization_id: string | null
          priority: string | null
          requires_human_review: boolean | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          screenshot_metadata: Json | null
          screenshots: string[] | null
          severity: string
          status: string | null
          steps_to_reproduce: string | null
          title: string
          updated_at: string | null
          user_id: string
          user_notified: boolean | null
          user_role: string
        }
        Insert: {
          actual_behavior?: string | null
          admin_notified?: boolean | null
          ai_analysis?: Json | null
          ai_analyzed?: boolean | null
          ai_suggested_fix?: string | null
          app_version: string
          browser_info?: Json | null
          console_errors?: Json | null
          created_at?: string | null
          current_page?: string | null
          description: string
          device_info?: Json | null
          expected_behavior?: string | null
          id?: string
          issue_type: string
          network_status?: string | null
          notification_sent_at?: string | null
          organization_id?: string | null
          priority?: string | null
          requires_human_review?: boolean | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          screenshot_metadata?: Json | null
          screenshots?: string[] | null
          severity?: string
          status?: string | null
          steps_to_reproduce?: string | null
          title: string
          updated_at?: string | null
          user_id: string
          user_notified?: boolean | null
          user_role: string
        }
        Update: {
          actual_behavior?: string | null
          admin_notified?: boolean | null
          ai_analysis?: Json | null
          ai_analyzed?: boolean | null
          ai_suggested_fix?: string | null
          app_version?: string
          browser_info?: Json | null
          console_errors?: Json | null
          created_at?: string | null
          current_page?: string | null
          description?: string
          device_info?: Json | null
          expected_behavior?: string | null
          id?: string
          issue_type?: string
          network_status?: string | null
          notification_sent_at?: string | null
          organization_id?: string | null
          priority?: string | null
          requires_human_review?: boolean | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          screenshot_metadata?: Json | null
          screenshots?: string[] | null
          severity?: string
          status?: string | null
          steps_to_reproduce?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
          user_notified?: boolean | null
          user_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "bug_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bug_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bug_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      canonical_homeless: {
        Row: {
          plate_number: string
          status: string
          confirmed_by: string | null
          confirmed_at: string | null
          source: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          plate_number: string
          status?: string
          confirmed_by?: string | null
          confirmed_at?: string | null
          source?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          plate_number?: string
          status?: string
          confirmed_by?: string | null
          confirmed_at?: string | null
          source?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_canonical_homeless_confirmed_by"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      canonical_scv: {
        Row: {
          plate_number: string
          is_self_contained: boolean
          certificate_expiry: string | null
          source: string | null
          verified_at: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          plate_number: string
          is_self_contained?: boolean
          certificate_expiry?: string | null
          source?: string | null
          verified_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          plate_number?: string
          is_self_contained?: boolean
          certificate_expiry?: string | null
          source?: string | null
          verified_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      canonical_vehicles: {
        Row: {
          created_at: string | null
          enforcement_count: number | null
          fc_act_exempt: boolean | null
          first_seen_at: string
          flagged_at: string | null
          flagged_by: string | null
          flagged_notes: string | null
          flagged_priority: string | null
          flagged_reason: string | null
          homeless_confirmed: boolean | null
          homeless_confirmed_at: string | null
          homeless_confirmed_by: string | null
          homeless_notes: string | null
          homeless_status: string | null
          is_exempt: boolean
          is_flagged: boolean | null
          is_homeless: boolean | null
          last_enforcement_at: string | null
          last_enforcement_type: string | null
          last_note_at: string | null
          last_note_preview: string | null
          last_seen_at: string
          nzscv_last_checked: string | null
          nzscv_lookup_at: string | null
          nzscv_source: string | null
          nzscv_warrant_type: string | null
          owner_address: string | null
          owner_address_verified: boolean | null
          owner_company_name: string | null
          owner_first_name: string | null
          owner_last_name: string | null
          parkpow_vehicle_id: number | null
          plate_number: string
          profile_photo: string | null
          profile_photo_metadata: Json | null
          profile_photo_score: number | null
          profile_photo_selected_at: string | null
          profile_photo_updated_at: string | null
          profile_photo_url: string | null
          self_contained: boolean | null
          self_contained_expiry: string | null
          total_breaches: number | null
          total_hs_reports: number | null
          total_incidents: number | null
          total_notes: number | null
          total_observations: number | null
          updated_at: string | null
          vehicle_color: string | null
          vehicle_id: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: number | null
        }
        Insert: {
          created_at?: string | null
          enforcement_count?: number | null
          fc_act_exempt?: boolean | null
          first_seen_at?: string
          flagged_at?: string | null
          flagged_by?: string | null
          flagged_notes?: string | null
          flagged_priority?: string | null
          flagged_reason?: string | null
          homeless_confirmed?: boolean | null
          homeless_confirmed_at?: string | null
          homeless_confirmed_by?: string | null
          homeless_notes?: string | null
          homeless_status?: string | null
          is_exempt?: boolean
          is_flagged?: boolean | null
          is_homeless?: boolean | null
          last_enforcement_at?: string | null
          last_enforcement_type?: string | null
          last_note_at?: string | null
          last_note_preview?: string | null
          last_seen_at?: string
          nzscv_last_checked?: string | null
          nzscv_lookup_at?: string | null
          nzscv_source?: string | null
          nzscv_warrant_type?: string | null
          owner_address?: string | null
          owner_address_verified?: boolean | null
          owner_company_name?: string | null
          owner_first_name?: string | null
          owner_last_name?: string | null
          parkpow_vehicle_id?: number | null
          plate_number: string
          profile_photo?: string | null
          profile_photo_metadata?: Json | null
          profile_photo_score?: number | null
          profile_photo_selected_at?: string | null
          profile_photo_updated_at?: string | null
          profile_photo_url?: string | null
          self_contained?: boolean | null
          self_contained_expiry?: string | null
          total_breaches?: number | null
          total_hs_reports?: number | null
          total_incidents?: number | null
          total_notes?: number | null
          total_observations?: number | null
          updated_at?: string | null
          vehicle_color?: string | null
          vehicle_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
        }
        Update: {
          created_at?: string | null
          enforcement_count?: number | null
          fc_act_exempt?: boolean | null
          first_seen_at?: string
          flagged_at?: string | null
          flagged_by?: string | null
          flagged_notes?: string | null
          flagged_priority?: string | null
          flagged_reason?: string | null
          homeless_confirmed?: boolean | null
          homeless_confirmed_at?: string | null
          homeless_confirmed_by?: string | null
          homeless_notes?: string | null
          homeless_status?: string | null
          is_exempt?: boolean
          is_flagged?: boolean | null
          is_homeless?: boolean | null
          last_enforcement_at?: string | null
          last_enforcement_type?: string | null
          last_note_at?: string | null
          last_note_preview?: string | null
          last_seen_at?: string
          nzscv_last_checked?: string | null
          nzscv_lookup_at?: string | null
          nzscv_source?: string | null
          nzscv_warrant_type?: string | null
          owner_address?: string | null
          owner_address_verified?: boolean | null
          owner_company_name?: string | null
          owner_first_name?: string | null
          owner_last_name?: string | null
          parkpow_vehicle_id?: number | null
          plate_number?: string
          profile_photo?: string | null
          profile_photo_metadata?: Json | null
          profile_photo_score?: number | null
          profile_photo_selected_at?: string | null
          profile_photo_updated_at?: string | null
          profile_photo_url?: string | null
          self_contained?: boolean | null
          self_contained_expiry?: string | null
          total_breaches?: number | null
          total_hs_reports?: number | null
          total_incidents?: number | null
          total_notes?: number | null
          total_observations?: number | null
          updated_at?: string | null
          vehicle_color?: string | null
          vehicle_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "canonical_vehicles_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "canonical_vehicles_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_vehicles_homeless_confirmed_by_fkey"
            columns: ["homeless_confirmed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "canonical_vehicles_homeless_confirmed_by_fkey"
            columns: ["homeless_confirmed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_audit_log: {
        Row: {
          blocked_reason: string | null
          can_enforce: boolean | null
          can_work: boolean | null
          check_type: string
          compliance_status: string
          id: string
          timestamp: string | null
          user_id: string | null
        }
        Insert: {
          blocked_reason?: string | null
          can_enforce?: boolean | null
          can_work?: boolean | null
          check_type: string
          compliance_status: string
          id?: string
          timestamp?: string | null
          user_id?: string | null
        }
        Update: {
          blocked_reason?: string | null
          can_enforce?: boolean | null
          can_work?: boolean | null
          check_type?: string
          compliance_status?: string
          id?: string
          timestamp?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "compliance_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_results: {
        Row: {
          after_hours_violation: boolean | null
          created_at: string | null
          evaluated_at: string | null
          exemption_reason: string | null
          fc_act_exempt: boolean | null
          gps_distance_meters: number | null
          gps_evidence_json: Json | null
          gps_verified_consecutive_nights: number | null
          id: string
          is_compliant: boolean | null
          is_exempt: boolean | null
          matrix_id: string | null
          matrix_snapshot: Json | null
          matrix_version: number | null
          metrics_json: Json | null
          observation_id: string | null
          organization_id: string | null
          stay_confirmed_by_gps: boolean | null
          updated_at: string | null
          vehicle_id: string | null
          violation_reasons: string[] | null
          violation_type: string | null
          zone_id: string | null
        }
        Insert: {
          after_hours_violation?: boolean | null
          created_at?: string | null
          evaluated_at?: string | null
          exemption_reason?: string | null
          fc_act_exempt?: boolean | null
          gps_distance_meters?: number | null
          gps_evidence_json?: Json | null
          gps_verified_consecutive_nights?: number | null
          id?: string
          is_compliant?: boolean | null
          is_exempt?: boolean | null
          matrix_id?: string | null
          matrix_snapshot?: Json | null
          matrix_version?: number | null
          metrics_json?: Json | null
          observation_id?: string | null
          organization_id?: string | null
          stay_confirmed_by_gps?: boolean | null
          updated_at?: string | null
          vehicle_id?: string | null
          violation_reasons?: string[] | null
          violation_type?: string | null
          zone_id?: string | null
        }
        Update: {
          after_hours_violation?: boolean | null
          created_at?: string | null
          evaluated_at?: string | null
          exemption_reason?: string | null
          fc_act_exempt?: boolean | null
          gps_distance_meters?: number | null
          gps_evidence_json?: Json | null
          gps_verified_consecutive_nights?: number | null
          id?: string
          is_compliant?: boolean | null
          is_exempt?: boolean | null
          matrix_id?: string | null
          matrix_snapshot?: Json | null
          matrix_version?: number | null
          metrics_json?: Json | null
          observation_id?: string | null
          organization_id?: string | null
          stay_confirmed_by_gps?: boolean | null
          updated_at?: string | null
          vehicle_id?: string | null
          violation_reasons?: string[] | null
          violation_type?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_results_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "compliance_results_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "compliance_results_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_processing_log: {
        Row: {
          ai_model: string | null
          authorized_activities: string[] | null
          confidence_score: number | null
          created_at: string | null
          document_type: string
          document_url: string
          error_message: string | null
          expiry_date: string | null
          extracted_data: Json | null
          extracted_text: string | null
          id: string
          issuing_authority: string | null
          license_number: string | null
          manually_verified: boolean | null
          processed_at: string | null
          status: string | null
          user_id: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          ai_model?: string | null
          authorized_activities?: string[] | null
          confidence_score?: number | null
          created_at?: string | null
          document_type: string
          document_url: string
          error_message?: string | null
          expiry_date?: string | null
          extracted_data?: Json | null
          extracted_text?: string | null
          id?: string
          issuing_authority?: string | null
          license_number?: string | null
          manually_verified?: boolean | null
          processed_at?: string | null
          status?: string | null
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          ai_model?: string | null
          authorized_activities?: string[] | null
          confidence_score?: number | null
          created_at?: string | null
          document_type?: string
          document_url?: string
          error_message?: string | null
          expiry_date?: string | null
          extracted_data?: Json | null
          extracted_text?: string | null
          id?: string
          issuing_authority?: string | null
          license_number?: string | null
          manually_verified?: boolean | null
          processed_at?: string | null
          status?: string | null
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_processing_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credential_processing_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_processing_log_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credential_processing_log_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      drift_events: {
        Row: {
          created_at: string | null
          detected_at: string | null
          event_type: string
          id: string
          metadata: Json
          organization_id: string | null
          plate_number: string | null
          remediation_notes: string | null
          review_month: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          vehicle_id: string | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          detected_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          plate_number?: string | null
          remediation_notes?: string | null
          review_month?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          vehicle_id?: string | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          detected_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          plate_number?: string | null
          remediation_notes?: string | null
          review_month?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          vehicle_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drift_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drift_events_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "drift_events_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drift_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "drift_events_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "drift_events_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      enforcement_actions: {
        Row: {
          action_type: string | null
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          breach_status: string | null
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          completion_outcome: string | null
          compliance_result_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          observation_id: string | null
          organization_id: string | null
          plate_number: string | null
          status: string | null
          updated_at: string | null
          vehicle_record_id: string | null
          zone_id: string | null
        }
        Insert: {
          action_type?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          breach_status?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          completion_outcome?: string | null
          compliance_result_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          observation_id?: string | null
          organization_id?: string | null
          plate_number?: string | null
          status?: string | null
          updated_at?: string | null
          vehicle_record_id?: string | null
          zone_id?: string | null
        }
        Update: {
          action_type?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          breach_status?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          completion_outcome?: string | null
          compliance_result_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          observation_id?: string | null
          organization_id?: string | null
          plate_number?: string | null
          status?: string | null
          updated_at?: string | null
          vehicle_record_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enforcement_actions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "enforcement_actions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enforcement_actions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "enforcement_actions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enforcement_actions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "enforcement_actions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enforcement_actions_compliance_result_id_fkey"
            columns: ["compliance_result_id"]
            isOneToOne: false
            referencedRelation: "compliance_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enforcement_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "enforcement_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enforcement_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enforcement_actions_vehicle_record_id_fkey"
            columns: ["vehicle_record_id"]
            isOneToOne: false
            referencedRelation: "vehicle_records_deprecated_20250131"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enforcement_actions_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "enforcement_actions_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      flagged_vehicles: {
        Row: {
          attachments: Json | null
          confirmed_homeless: boolean | null
          created_at: string | null
          created_by: string | null
          date_recorded: string | null
          flagged_by: string | null
          id: string
          is_active: boolean
          last_known_site: string | null
          name_contact: string | null
          notes: string | null
          organization_id: string | null
          plate_number: string
          priority: string | null
          reason: string | null
          updated_at: string | null
          vehicle_description: string | null
        }
        Insert: {
          attachments?: Json | null
          confirmed_homeless?: boolean | null
          created_at?: string | null
          created_by?: string | null
          date_recorded?: string | null
          flagged_by?: string | null
          id?: string
          is_active?: boolean
          last_known_site?: string | null
          name_contact?: string | null
          notes?: string | null
          organization_id?: string | null
          plate_number: string
          priority?: string | null
          reason?: string | null
          updated_at?: string | null
          vehicle_description?: string | null
        }
        Update: {
          attachments?: Json | null
          confirmed_homeless?: boolean | null
          created_at?: string | null
          created_by?: string | null
          date_recorded?: string | null
          flagged_by?: string | null
          id?: string
          is_active?: boolean
          last_known_site?: string | null
          name_contact?: string | null
          notes?: string | null
          organization_id?: string | null
          plate_number?: string
          priority?: string | null
          reason?: string | null
          updated_at?: string | null
          vehicle_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flagged_vehicles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "flagged_vehicles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flagged_vehicles_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "flagged_vehicles_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flagged_vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      health_safety_reports: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          incident_type: string | null
          organization_id: string
          reported_by: string | null
          severity: string | null
          status: string | null
          updated_at: string | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          incident_type?: string | null
          organization_id: string
          reported_by?: string | null
          severity?: string | null
          status?: string | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          incident_type?: string | null
          organization_id?: string
          reported_by?: string | null
          severity?: string | null
          status?: string | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "health_safety_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_safety_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "health_safety_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_safety_reports_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "health_safety_reports_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      homeless_records: {
        Row: {
          created_at: string
          created_by: string | null
          first_reported_at: string
          id: string
          is_active: boolean
          last_reported_at: string
          notes: string | null
          organization_id: string
          plate_number: string
          source: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          first_reported_at?: string
          id?: string
          is_active?: boolean
          last_reported_at?: string
          notes?: string | null
          organization_id: string
          plate_number: string
          source?: string
          status: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          first_reported_at?: string
          id?: string
          is_active?: boolean
          last_reported_at?: string
          notes?: string | null
          organization_id?: string
          plate_number?: string
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homeless_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "homeless_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeless_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeless_records_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "homeless_records_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          batch_name: string
          completed_at: string | null
          created_at: string | null
          error_summary: string | null
          failed_records: number | null
          file_name: string | null
          file_size_bytes: number | null
          homeless_inferred: number | null
          hs_issues_inferred: number | null
          id: string
          import_config: Json | null
          organization_id: string
          parsed_records: number
          plates_enriched: number | null
          processed_records: number | null
          started_at: string | null
          status: string
          successful_records: number | null
          total_records: number | null
          uploaded_by: string
          vehicles_enriched: number | null
          zones_created: number
        }
        Insert: {
          batch_name: string
          completed_at?: string | null
          created_at?: string | null
          error_summary?: string | null
          failed_records?: number | null
          file_name?: string | null
          file_size_bytes?: number | null
          homeless_inferred?: number | null
          hs_issues_inferred?: number | null
          id?: string
          import_config?: Json | null
          organization_id: string
          parsed_records?: number
          plates_enriched?: number | null
          processed_records?: number | null
          started_at?: string | null
          status?: string
          successful_records?: number | null
          total_records?: number | null
          uploaded_by: string
          vehicles_enriched?: number | null
          zones_created?: number
        }
        Update: {
          batch_name?: string
          completed_at?: string | null
          created_at?: string | null
          error_summary?: string | null
          failed_records?: number | null
          file_name?: string | null
          file_size_bytes?: number | null
          homeless_inferred?: number | null
          hs_issues_inferred?: number | null
          id?: string
          import_config?: Json | null
          organization_id?: string
          parsed_records?: number
          plates_enriched?: number | null
          processed_records?: number | null
          started_at?: string | null
          status?: string
          successful_records?: number | null
          total_records?: number | null
          uploaded_by?: string
          vehicles_enriched?: number | null
          zones_created?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_staging: {
        Row: {
          batch_id: string
          confidence_scores: Json | null
          created_at: string | null
          enriched_at: string | null
          enriched_data: Json | null
          enrichment_log: Json | null
          error_log: string | null
          id: string
          imported_at: string | null
          observation_id: string | null
          raw_data: Json
          status: string | null
          validation_errors: Json | null
          vehicle_id: string | null
        }
        Insert: {
          batch_id: string
          confidence_scores?: Json | null
          created_at?: string | null
          enriched_at?: string | null
          enriched_data?: Json | null
          enrichment_log?: Json | null
          error_log?: string | null
          id?: string
          imported_at?: string | null
          observation_id?: string | null
          raw_data: Json
          status?: string | null
          validation_errors?: Json | null
          vehicle_id?: string | null
        }
        Update: {
          batch_id?: string
          confidence_scores?: Json | null
          created_at?: string | null
          enriched_at?: string | null
          enriched_data?: Json | null
          enrichment_log?: Json | null
          error_log?: string | null
          id?: string
          imported_at?: string | null
          observation_id?: string | null
          raw_data?: Json
          status?: string | null
          validation_errors?: Json | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_staging_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          description: string | null
          evidence_count: number | null
          id: string
          incident_type: string | null
          location_address: string | null
          location_lat: number | null
          location_lng: number | null
          metadata: Json | null
          notes: string | null
          organization_id: string
          plate_number: string | null
          primary_evidence_url: string | null
          reported_by: string | null
          severity: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          evidence_count?: number | null
          id?: string
          incident_type?: string | null
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          metadata?: Json | null
          notes?: string | null
          organization_id: string
          plate_number?: string | null
          primary_evidence_url?: string | null
          reported_by?: string | null
          severity?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          evidence_count?: number | null
          id?: string
          incident_type?: string | null
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string
          plate_number?: string | null
          primary_evidence_url?: string | null
          reported_by?: string | null
          severity?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incidents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "incidents_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "incidents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "incidents_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      infringement_notices: {
        Row: {
          amount_cents: number | null
          breach_alert_id: string | null
          case_id: string | null
          court_referral_date: string | null
          created_at: string | null
          created_by: string | null
          delivery_evidence: Json | null
          due_date: string | null
          evidence_bundle_hash: string | null
          evidence_bundle_url: string | null
          fee_amount: number | null
          id: string
          issued_at: string | null
          issued_by: string | null
          legal_basis: string | null
          notice_html_hash: string | null
          notice_html_path: string | null
          notice_number: string
          notice_pdf_hash: string | null
          notice_pdf_url: string | null
          notice_type: string | null
          observation_id: string | null
          offence_date: string | null
          offence_description: string | null
          offence_location: string | null
          offence_location_gps: string | null
          organization_id: string | null
          payment_deadline: string | null
          payment_methods: Json | null
          payment_reference: string | null
          plate_number: string | null
          recipient_address: string | null
          recipient_email: string | null
          recipient_name: string | null
          reminder_sent_at: string | null
          served_at: string | null
          service_method: string | null
          status: string
          summary_of_rights: string | null
          updated_at: string | null
          withdrawn_reason: string | null
          zone_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          breach_alert_id?: string | null
          case_id?: string | null
          court_referral_date?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_evidence?: Json | null
          due_date?: string | null
          evidence_bundle_hash?: string | null
          evidence_bundle_url?: string | null
          fee_amount?: number | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          legal_basis?: string | null
          notice_html_hash?: string | null
          notice_html_path?: string | null
          notice_number: string
          notice_pdf_hash?: string | null
          notice_pdf_url?: string | null
          notice_type?: string | null
          observation_id?: string | null
          offence_date?: string | null
          offence_description?: string | null
          offence_location?: string | null
          offence_location_gps?: string | null
          organization_id?: string | null
          payment_deadline?: string | null
          payment_methods?: Json | null
          payment_reference?: string | null
          plate_number?: string | null
          recipient_address?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          reminder_sent_at?: string | null
          served_at?: string | null
          service_method?: string | null
          status?: string
          summary_of_rights?: string | null
          updated_at?: string | null
          withdrawn_reason?: string | null
          zone_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          breach_alert_id?: string | null
          case_id?: string | null
          court_referral_date?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_evidence?: Json | null
          due_date?: string | null
          evidence_bundle_hash?: string | null
          evidence_bundle_url?: string | null
          fee_amount?: number | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          legal_basis?: string | null
          notice_html_hash?: string | null
          notice_html_path?: string | null
          notice_number?: string
          notice_pdf_hash?: string | null
          notice_pdf_url?: string | null
          notice_type?: string | null
          observation_id?: string | null
          offence_date?: string | null
          offence_description?: string | null
          offence_location?: string | null
          offence_location_gps?: string | null
          organization_id?: string | null
          payment_deadline?: string | null
          payment_methods?: Json | null
          payment_reference?: string | null
          plate_number?: string | null
          recipient_address?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          reminder_sent_at?: string | null
          served_at?: string | null
          service_method?: string | null
          status?: string
          summary_of_rights?: string | null
          updated_at?: string | null
          withdrawn_reason?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "infringement_notices_breach_alert_id_fkey"
            columns: ["breach_alert_id"]
            isOneToOne: false
            referencedRelation: "breach_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infringement_notices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "infringement_notices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infringement_notices_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "infringement_notices_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infringement_notices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infringement_notices_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "infringement_notices_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_job_templates: {
        Row: {
          created_at: string | null
          custom_fields: Json | null
          default_briefing_notes: string | null
          default_instructions: string | null
          default_priority: string | null
          id: string
          is_active: boolean | null
          job_type: string
          organization_id: string | null
          template_key: string
          template_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          custom_fields?: Json | null
          default_briefing_notes?: string | null
          default_instructions?: string | null
          default_priority?: string | null
          id?: string
          is_active?: boolean | null
          job_type: string
          organization_id?: string | null
          template_key: string
          template_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          custom_fields?: Json | null
          default_briefing_notes?: string | null
          default_instructions?: string | null
          default_priority?: string | null
          id?: string
          is_active?: boolean | null
          job_type?: string
          organization_id?: string | null
          template_key?: string
          template_name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investigation_job_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_job_types: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_system_default: boolean | null
          name: string
          organization_id: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system_default?: boolean | null
          name: string
          organization_id?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system_default?: boolean | null
          name?: string
          organization_id?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_job_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "investigation_job_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_job_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_jobs: {
        Row: {
          assigned_to: string | null
          associated_observation_id: string | null
          associated_person_id: string | null
          associated_vehicle_id: string | null
          associated_zone_id: string | null
          completion_photos: string[] | null
          completion_summary: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          followup_days: number | null
          followup_notes: string | null
          id: string
          job_type: string | null
          organization_id: string
          priority: string | null
          quick_completion: boolean | null
          status: string | null
          template_used: string | null
          title: string | null
          updated_at: string | null
          zone_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          associated_observation_id?: string | null
          associated_person_id?: string | null
          associated_vehicle_id?: string | null
          associated_zone_id?: string | null
          completion_photos?: string[] | null
          completion_summary?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          followup_days?: number | null
          followup_notes?: string | null
          id?: string
          job_type?: string | null
          organization_id: string
          priority?: string | null
          quick_completion?: boolean | null
          status?: string | null
          template_used?: string | null
          title?: string | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          associated_observation_id?: string | null
          associated_person_id?: string | null
          associated_vehicle_id?: string | null
          associated_zone_id?: string | null
          completion_photos?: string[] | null
          completion_summary?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          followup_days?: number | null
          followup_notes?: string | null
          id?: string
          job_type?: string | null
          organization_id?: string
          priority?: string | null
          quick_completion?: boolean | null
          status?: string | null
          template_used?: string | null
          title?: string | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investigation_jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "investigation_jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_jobs_associated_person_id_fkey"
            columns: ["associated_person_id"]
            isOneToOne: false
            referencedRelation: "person_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_jobs_associated_vehicle_id_fkey"
            columns: ["associated_vehicle_id"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "investigation_jobs_associated_zone_id_fkey"
            columns: ["associated_zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "investigation_jobs_associated_zone_id_fkey"
            columns: ["associated_zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "investigation_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_jobs_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "investigation_jobs_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      missing_photo_queue: {
        Row: {
          assigned_to: string | null
          attempted_hash: string | null
          attempts: number | null
          created_at: string | null
          id: string
          last_attempt_at: string | null
          observation_id: string
          organization_id: string
          original_photo_url: string | null
          plate_number: string | null
          reason: string
          recorded_at: string
          repair_notes: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          attempted_hash?: string | null
          attempts?: number | null
          created_at?: string | null
          id?: string
          last_attempt_at?: string | null
          observation_id: string
          organization_id: string
          original_photo_url?: string | null
          plate_number?: string | null
          reason?: string
          recorded_at: string
          repair_notes?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          attempted_hash?: string | null
          attempts?: number | null
          created_at?: string | null
          id?: string
          last_attempt_at?: string | null
          observation_id?: string
          organization_id?: string
          original_photo_url?: string | null
          plate_number?: string | null
          reason?: string
          recorded_at?: string
          repair_notes?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "missing_photo_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "missing_photo_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missing_photo_queue_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: true
            referencedRelation: "observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missing_photo_queue_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: true
            referencedRelation: "recent_observations_photo_status"
            referencedColumns: ["observation_id"]
          },
          {
            foreignKeyName: "missing_photo_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notices_to_vacate: {
        Row: {
          authorized_at: string | null
          authorized_by: string | null
          breach_alert_id: string | null
          breach_date: string
          breach_details: Json | null
          breach_reason: string
          compliance_verified_by: string | null
          complied_at: string | null
          created_at: string | null
          delivered_at: string | null
          delivered_to_email: string | null
          delivered_to_officer: string | null
          delivery_method: string | null
          escalated_at: string | null
          escalation_notes: string | null
          id: string
          issued_at: string | null
          issued_by: string
          nights_stayed: number | null
          notice_document_url: string | null
          notice_html: string | null
          organization_id: string
          plate_number: string
          recipient_name: string | null
          reference_number: string
          status: string | null
          updated_at: string | null
          vacate_deadline: string | null
          vehicle_id: string | null
          zone_id: string
        }
        Insert: {
          authorized_at?: string | null
          authorized_by?: string | null
          breach_alert_id?: string | null
          breach_date: string
          breach_details?: Json | null
          breach_reason: string
          compliance_verified_by?: string | null
          complied_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivered_to_email?: string | null
          delivered_to_officer?: string | null
          delivery_method?: string | null
          escalated_at?: string | null
          escalation_notes?: string | null
          id?: string
          issued_at?: string | null
          issued_by: string
          nights_stayed?: number | null
          notice_document_url?: string | null
          notice_html?: string | null
          organization_id: string
          plate_number: string
          recipient_name?: string | null
          reference_number: string
          status?: string | null
          updated_at?: string | null
          vacate_deadline?: string | null
          vehicle_id?: string | null
          zone_id: string
        }
        Update: {
          authorized_at?: string | null
          authorized_by?: string | null
          breach_alert_id?: string | null
          breach_date?: string
          breach_details?: Json | null
          breach_reason?: string
          compliance_verified_by?: string | null
          complied_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivered_to_email?: string | null
          delivered_to_officer?: string | null
          delivery_method?: string | null
          escalated_at?: string | null
          escalation_notes?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string
          nights_stayed?: number | null
          notice_document_url?: string | null
          notice_html?: string | null
          organization_id?: string
          plate_number?: string
          recipient_name?: string | null
          reference_number?: string
          status?: string | null
          updated_at?: string | null
          vacate_deadline?: string | null
          vehicle_id?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notices_to_vacate_authorized_by_fkey"
            columns: ["authorized_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notices_to_vacate_authorized_by_fkey"
            columns: ["authorized_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_to_vacate_compliance_verified_by_fkey"
            columns: ["compliance_verified_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notices_to_vacate_compliance_verified_by_fkey"
            columns: ["compliance_verified_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_to_vacate_delivered_to_officer_fkey"
            columns: ["delivered_to_officer"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notices_to_vacate_delivered_to_officer_fkey"
            columns: ["delivered_to_officer"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_to_vacate_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notices_to_vacate_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_to_vacate_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_to_vacate_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "notices_to_vacate_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "notices_to_vacate_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json | null
          delivered: boolean
          delivered_at: string | null
          id: string
          priority: string
          read: boolean
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json | null
          delivered?: boolean
          delivered_at?: string | null
          id?: string
          priority?: string
          read?: boolean
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json | null
          delivered?: boolean
          delivered_at?: string | null
          id?: string
          priority?: string
          read?: boolean
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      observation_deletions: {
        Row: {
          deleted_at: string | null
          deleted_by: string
          deletion_reason: string | null
          id: string
          observation_id: string
          observation_snapshot: Json
          organization_id: string
          plate_number: string
          recorded_at: string
          recorded_by: string
          zone_id: string
        }
        Insert: {
          deleted_at?: string | null
          deleted_by: string
          deletion_reason?: string | null
          id?: string
          observation_id: string
          observation_snapshot: Json
          organization_id: string
          plate_number: string
          recorded_at: string
          recorded_by: string
          zone_id: string
        }
        Update: {
          deleted_at?: string | null
          deleted_by?: string
          deletion_reason?: string | null
          id?: string
          observation_id?: string
          observation_snapshot?: Json
          organization_id?: string
          plate_number?: string
          recorded_at?: string
          recorded_by?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "observation_deletions_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "observation_deletions_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      observations: {
        Row: {
          breach_details: Json | null
          breach_detected_at: string | null
          breach_reason: string | null
          breach_type: string | null
          breach_warning: boolean | null
          breach_warning_reason: string | null
          compliance_snapshot: Json | null
          consecutive_nights: number | null
          created_at: string | null
          deleted_at: string | null
          discrepancy_flags: Json | null
          embedding_created_at: string | null
          embedding_model_version: string | null
          embedding_quality: number | null
          gps_accuracy: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          has_discrepancies: boolean | null
          has_homeless_claim: boolean | null
          has_hs_incident: boolean | null
          has_incident: boolean | null
          has_notes: boolean | null
          homeless_claim_notes: string | null
          hs_incident_id: string | null
          id: string | null
          idempotency_key: string | null
          incident_id: string | null
          is_breach: boolean | null
          is_compliant: boolean | null
          is_legacy_import: boolean | null
          legacy_source_tag: string | null
          movement_background_similarity: number | null
          movement_decision: string | null
          movement_moved: boolean | null
          movement_vehicle_bbox_iou: number | null
          nights_stayed_this_month: number | null
          notes_reference_previous: boolean | null
          observation_id: string
          observation_notes: string | null
          officer_notes: string | null
          organization_id: string
          parkpow_session_id: number | null
          parkpow_violation_id: number | null
          photo: string | null
          photo_hash: string | null
          photo_url: string | null
          plate_confidence: number | null
          plate_number: string
          portal_used: string | null
          previous_observation_id: string | null
          processing_completed_at: string | null
          processing_error: string | null
          processing_started_at: string | null
          processing_status: string | null
          recorded_at: string
          recorded_by: string | null
          self_contained: boolean | null
          self_contained_expiry: string | null
          sticker_bbox: Json | null
          sticker_color: string | null
          sticker_color_confidence: number | null
          sticker_detection_confidence: number | null
          sticker_presence: boolean | null
          updated_at: string | null
          vehicle_attribute_sources: Json | null
          vehicle_color: string | null
          vehicle_color_confidence: number | null
          vehicle_embedding: Json | null
          vehicle_make: string | null
          vehicle_make_confidence: number | null
          vehicle_model: string | null
          vehicle_model_confidence: number | null
          vehicle_year: number | null
          zone_id: string
          zone_name_at_import: string | null
        }
        Insert: {
          breach_details?: Json | null
          breach_detected_at?: string | null
          breach_reason?: string | null
          breach_type?: string | null
          breach_warning?: boolean | null
          breach_warning_reason?: string | null
          compliance_snapshot?: Json | null
          consecutive_nights?: number | null
          created_at?: string | null
          deleted_at?: string | null
          discrepancy_flags?: Json | null
          embedding_created_at?: string | null
          embedding_model_version?: string | null
          embedding_quality?: number | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          has_discrepancies?: boolean | null
          has_homeless_claim?: boolean | null
          has_hs_incident?: boolean | null
          has_incident?: boolean | null
          has_notes?: boolean | null
          homeless_claim_notes?: string | null
          hs_incident_id?: string | null
          id?: string | null
          idempotency_key?: string | null
          incident_id?: string | null
          is_breach?: boolean | null
          is_compliant?: boolean | null
          is_legacy_import?: boolean | null
          legacy_source_tag?: string | null
          movement_background_similarity?: number | null
          movement_decision?: string | null
          movement_moved?: boolean | null
          movement_vehicle_bbox_iou?: number | null
          nights_stayed_this_month?: number | null
          notes_reference_previous?: boolean | null
          observation_id?: string
          observation_notes?: string | null
          officer_notes?: string | null
          organization_id: string
          parkpow_session_id?: number | null
          parkpow_violation_id?: number | null
          photo?: string | null
          photo_hash?: string | null
          photo_url?: string | null
          plate_confidence?: number | null
          plate_number: string
          portal_used?: string | null
          previous_observation_id?: string | null
          processing_completed_at?: string | null
          processing_error?: string | null
          processing_started_at?: string | null
          processing_status?: string | null
          recorded_at: string
          recorded_by?: string | null
          self_contained?: boolean | null
          self_contained_expiry?: string | null
          sticker_bbox?: Json | null
          sticker_color?: string | null
          sticker_color_confidence?: number | null
          sticker_detection_confidence?: number | null
          sticker_presence?: boolean | null
          updated_at?: string | null
          vehicle_attribute_sources?: Json | null
          vehicle_color?: string | null
          vehicle_color_confidence?: number | null
          vehicle_embedding?: Json | null
          vehicle_make?: string | null
          vehicle_make_confidence?: number | null
          vehicle_model?: string | null
          vehicle_model_confidence?: number | null
          vehicle_year?: number | null
          zone_id: string
          zone_name_at_import?: string | null
        }
        Update: {
          breach_details?: Json | null
          breach_detected_at?: string | null
          breach_reason?: string | null
          breach_type?: string | null
          breach_warning?: boolean | null
          breach_warning_reason?: string | null
          compliance_snapshot?: Json | null
          consecutive_nights?: number | null
          created_at?: string | null
          deleted_at?: string | null
          discrepancy_flags?: Json | null
          embedding_created_at?: string | null
          embedding_model_version?: string | null
          embedding_quality?: number | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          has_discrepancies?: boolean | null
          has_homeless_claim?: boolean | null
          has_hs_incident?: boolean | null
          has_incident?: boolean | null
          has_notes?: boolean | null
          homeless_claim_notes?: string | null
          hs_incident_id?: string | null
          id?: string | null
          idempotency_key?: string | null
          incident_id?: string | null
          is_breach?: boolean | null
          is_compliant?: boolean | null
          is_legacy_import?: boolean | null
          legacy_source_tag?: string | null
          movement_background_similarity?: number | null
          movement_decision?: string | null
          movement_moved?: boolean | null
          movement_vehicle_bbox_iou?: number | null
          nights_stayed_this_month?: number | null
          notes_reference_previous?: boolean | null
          observation_id?: string
          observation_notes?: string | null
          officer_notes?: string | null
          organization_id?: string
          parkpow_session_id?: number | null
          parkpow_violation_id?: number | null
          photo?: string | null
          photo_hash?: string | null
          photo_url?: string | null
          plate_confidence?: number | null
          plate_number?: string
          portal_used?: string | null
          previous_observation_id?: string | null
          processing_completed_at?: string | null
          processing_error?: string | null
          processing_started_at?: string | null
          processing_status?: string | null
          recorded_at?: string
          recorded_by?: string | null
          self_contained?: boolean | null
          self_contained_expiry?: string | null
          sticker_bbox?: Json | null
          sticker_color?: string | null
          sticker_color_confidence?: number | null
          sticker_detection_confidence?: number | null
          sticker_presence?: boolean | null
          updated_at?: string | null
          vehicle_attribute_sources?: Json | null
          vehicle_color?: string | null
          vehicle_color_confidence?: number | null
          vehicle_embedding?: Json | null
          vehicle_make?: string | null
          vehicle_make_confidence?: number | null
          vehicle_model?: string | null
          vehicle_model_confidence?: number | null
          vehicle_year?: number | null
          zone_id?: string
          zone_name_at_import?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "observations_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_previous_observation_id_fkey"
            columns: ["previous_observation_id"]
            isOneToOne: false
            referencedRelation: "observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_previous_observation_id_fkey"
            columns: ["previous_observation_id"]
            isOneToOne: false
            referencedRelation: "recent_observations_photo_status"
            referencedColumns: ["observation_id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_hs_incident_id_fkey"
            columns: ["hs_incident_id"]
            isOneToOne: false
            referencedRelation: "health_safety_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "active_breaches_v2"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_activity_log: {
        Row: {
          activity_type: string
          created_at: string | null
          gps_accuracy: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          metadata: Json | null
          organization_id: string
          recorded_at: string | null
          user_id: string
        }
        Insert: {
          activity_type: string
          created_at?: string | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          metadata?: Json | null
          organization_id: string
          recorded_at?: string | null
          user_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          recorded_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "officer_activity_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_shifts: {
        Row: {
          created_at: string
          end_reason: string | null
          ended_at: string | null
          gps_end_lat: number | null
          gps_end_lng: number | null
          gps_start_lat: number | null
          gps_start_lng: number | null
          id: string
          officer_id: string
          organization_id: string
          parent_zone_id: string | null
          started_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          gps_end_lat?: number | null
          gps_end_lng?: number | null
          gps_start_lat?: number | null
          gps_start_lng?: number | null
          id?: string
          officer_id: string
          organization_id: string
          parent_zone_id?: string | null
          started_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          gps_end_lat?: number | null
          gps_end_lng?: number | null
          gps_start_lat?: number | null
          gps_start_lng?: number | null
          id?: string
          officer_id?: string
          organization_id?: string
          parent_zone_id?: string | null
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "officer_shifts_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_shifts_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_shifts_parent_zone_id_fkey"
            columns: ["parent_zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "officer_shifts_parent_zone_id_fkey"
            columns: ["parent_zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_welfare_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledgement_notes: string | null
          alert_sent_at: string | null
          alert_type: string
          created_at: string | null
          escalated_at: string | null
          escalation_level: number | null
          gps_accuracy: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          last_activity_at: string
          officer_id: string
          officer_name: string
          officer_phone: string | null
          organization_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_notes?: string | null
          alert_sent_at?: string | null
          alert_type: string
          created_at?: string | null
          escalated_at?: string | null
          escalation_level?: number | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          last_activity_at: string
          officer_id: string
          officer_name: string
          officer_phone?: string | null
          organization_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_notes?: string | null
          alert_sent_at?: string | null
          alert_type?: string
          created_at?: string | null
          escalated_at?: string | null
          escalation_level?: number | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          last_activity_at?: string
          officer_id?: string
          officer_name?: string
          officer_phone?: string | null
          organization_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "officer_welfare_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_welfare_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_welfare_alerts_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_welfare_alerts_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_welfare_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_welfare_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_welfare_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_welfare_settings: {
        Row: {
          admin_escalation_time: number | null
          auto_logoff_enabled: boolean | null
          auto_logoff_time: number | null
          created_at: string | null
          critical_escalation_time: number | null
          gps_inactivity_threshold: number | null
          id: string
          inactivity_warning_time: number | null
          investigation_exception_enabled: boolean | null
          organization_id: string
          updated_at: string | null
          user_id: string
          welfare_check_enabled: boolean | null
        }
        Insert: {
          admin_escalation_time?: number | null
          auto_logoff_enabled?: boolean | null
          auto_logoff_time?: number | null
          created_at?: string | null
          critical_escalation_time?: number | null
          gps_inactivity_threshold?: number | null
          id?: string
          inactivity_warning_time?: number | null
          investigation_exception_enabled?: boolean | null
          organization_id: string
          updated_at?: string | null
          user_id: string
          welfare_check_enabled?: boolean | null
        }
        Update: {
          admin_escalation_time?: number | null
          auto_logoff_enabled?: boolean | null
          auto_logoff_time?: number | null
          created_at?: string | null
          critical_escalation_time?: number | null
          gps_inactivity_threshold?: number | null
          id?: string
          inactivity_warning_time?: number | null
          investigation_exception_enabled?: boolean | null
          organization_id?: string
          updated_at?: string | null
          user_id?: string
          welfare_check_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "officer_welfare_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_welfare_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_welfare_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          enforcement_workflow: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          organization_level: number | null
          organization_type: string | null
          overnight_verification_mode: string
          parent_organization_id: string | null
          requires_coa: boolean | null
          requires_warrant_for_enforcement: boolean | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          enforcement_workflow?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          organization_level?: number | null
          organization_type?: string | null
          overnight_verification_mode?: string
          parent_organization_id?: string | null
          requires_coa?: boolean | null
          requires_warrant_for_enforcement?: boolean | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          enforcement_workflow?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          organization_level?: number | null
          organization_type?: string | null
          overnight_verification_mode?: string
          parent_organization_id?: string | null
          requires_coa?: boolean | null
          requires_warrant_for_enforcement?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_parent_organization_id_fkey"
            columns: ["parent_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_schedule_zones: {
        Row: {
          actual_duration_minutes: number | null
          completed_at: string | null
          created_at: string
          estimated_duration_minutes: number | null
          id: string
          patrol_id: string
          visit_order: number
          visited_at: string | null
          zone_id: string
        }
        Insert: {
          actual_duration_minutes?: number | null
          completed_at?: string | null
          created_at?: string
          estimated_duration_minutes?: number | null
          id?: string
          patrol_id: string
          visit_order?: number
          visited_at?: string | null
          zone_id: string
        }
        Update: {
          actual_duration_minutes?: number | null
          completed_at?: string | null
          created_at?: string
          estimated_duration_minutes?: number | null
          id?: string
          patrol_id?: string
          visit_order?: number
          visited_at?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_schedule_zones_patrol_id_fkey"
            columns: ["patrol_id"]
            isOneToOne: false
            referencedRelation: "patrols"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_schedule_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "patrol_schedule_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      patrols: {
        Row: {
          actual_end_time: string | null
          actual_start_time: string | null
          assigned_to: string | null
          auto_checkin_enabled: boolean | null
          breaches_found: number | null
          created_at: string | null
          description: string | null
          duration_minutes: number | null
          ended_at: string | null
          geofence_radius: number | null
          id: string
          notes: string | null
          notification_sent: boolean | null
          notification_sent_at: string | null
          officer_accepted: boolean | null
          officer_accepted_at: string | null
          officer_decline_reason: string | null
          officer_declined: boolean | null
          organization_id: string
          patrol_date: string | null
          priority: string | null
          recurrence: string | null
          scheduled_end_time: string | null
          scheduled_start_time: string | null
          shift: string | null
          shift_id: string | null
          started_at: string | null
          status: string | null
          updated_at: string | null
          vehicles_checked: number | null
          zone_id: string | null
        }
        Insert: {
          actual_end_time?: string | null
          actual_start_time?: string | null
          assigned_to?: string | null
          auto_checkin_enabled?: boolean | null
          breaches_found?: number | null
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          geofence_radius?: number | null
          id?: string
          notes?: string | null
          notification_sent?: boolean | null
          notification_sent_at?: string | null
          officer_accepted?: boolean | null
          officer_accepted_at?: string | null
          officer_decline_reason?: string | null
          officer_declined?: boolean | null
          organization_id: string
          patrol_date?: string | null
          priority?: string | null
          recurrence?: string | null
          scheduled_end_time?: string | null
          scheduled_start_time?: string | null
          shift?: string | null
          shift_id?: string | null
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
          vehicles_checked?: number | null
          zone_id?: string | null
        }
        Update: {
          actual_end_time?: string | null
          actual_start_time?: string | null
          assigned_to?: string | null
          auto_checkin_enabled?: boolean | null
          breaches_found?: number | null
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          geofence_radius?: number | null
          id?: string
          notes?: string | null
          notification_sent?: boolean | null
          notification_sent_at?: string | null
          officer_accepted?: boolean | null
          officer_accepted_at?: string | null
          officer_decline_reason?: string | null
          officer_declined?: boolean | null
          organization_id?: string
          patrol_date?: string | null
          priority?: string | null
          recurrence?: string | null
          scheduled_end_time?: string | null
          scheduled_start_time?: string | null
          shift?: string | null
          shift_id?: string | null
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
          vehicles_checked?: number | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patrols_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "patrols_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrols_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrols_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "officer_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrols_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "patrols_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      person_interactions: {
        Row: {
          attachments: Json | null
          created_at: string | null
          follow_up_date: string | null
          gps_latitude: number | null
          gps_longitude: number | null
          hs_report_id: string | null
          id: string
          incident_id: string | null
          interaction_at: string | null
          interaction_type: string
          officer_id: string
          officer_notes: string | null
          organization_id: string
          outcome: string | null
          person_id: string
          photos: string[] | null
          requires_follow_up: boolean | null
          vehicle_id: string | null
          zone_id: string | null
        }
        Insert: {
          attachments?: Json | null
          created_at?: string | null
          follow_up_date?: string | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          hs_report_id?: string | null
          id?: string
          incident_id?: string | null
          interaction_at?: string | null
          interaction_type: string
          officer_id: string
          officer_notes?: string | null
          organization_id: string
          outcome?: string | null
          person_id: string
          photos?: string[] | null
          requires_follow_up?: boolean | null
          vehicle_id?: string | null
          zone_id?: string | null
        }
        Update: {
          attachments?: Json | null
          created_at?: string | null
          follow_up_date?: string | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          hs_report_id?: string | null
          id?: string
          incident_id?: string | null
          interaction_at?: string | null
          interaction_type?: string
          officer_id?: string
          officer_notes?: string | null
          organization_id?: string
          outcome?: string | null
          person_id?: string
          photos?: string[] | null
          requires_follow_up?: boolean | null
          vehicle_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "person_interactions_hs_report_id_fkey"
            columns: ["hs_report_id"]
            isOneToOne: false
            referencedRelation: "health_safety_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_interactions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_interactions_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "person_interactions_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_interactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_interactions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_interactions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "active_breaches_v2"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "person_interactions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "person_interactions_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "person_interactions_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      person_observations: {
        Row: {
          created_at: string | null
          evidence_photos: string[] | null
          gps_accuracy: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          metadata: Json | null
          observation_type: string
          officer_notes: string | null
          organization_id: string
          person_id: string
          plate_number: string | null
          recorded_at: string
          recorded_by: string
          updated_at: string | null
          zone_id: string
        }
        Insert: {
          created_at?: string | null
          evidence_photos?: string[] | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          metadata?: Json | null
          observation_type: string
          officer_notes?: string | null
          organization_id: string
          person_id: string
          plate_number?: string | null
          recorded_at?: string
          recorded_by: string
          updated_at?: string | null
          zone_id: string
        }
        Update: {
          created_at?: string | null
          evidence_photos?: string[] | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          metadata?: Json | null
          observation_type?: string
          officer_notes?: string | null
          organization_id?: string
          person_id?: string
          plate_number?: string | null
          recorded_at?: string
          recorded_by?: string
          updated_at?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_observations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_observations_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_observations_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "active_breaches_v2"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "person_observations_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "person_observations_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "person_observations_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_observations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "person_observations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      person_records: {
        Row: {
          created_at: string | null
          date_of_birth: string | null
          first_name: string | null
          freedom_camping_act_applies: boolean | null
          id: string
          is_of_interest: boolean | null
          last_contact_at: string | null
          last_name: string | null
          notes: string | null
          organization_id: string | null
          risk_level: string | null
          tent_location_description: string | null
          total_interactions: number | null
          trespass_notice_date: string | null
          trespass_notice_issued: boolean | null
          updated_at: string | null
          vehicle_association: string | null
        }
        Insert: {
          created_at?: string | null
          date_of_birth?: string | null
          first_name?: string | null
          freedom_camping_act_applies?: boolean | null
          id?: string
          is_of_interest?: boolean | null
          last_contact_at?: string | null
          last_name?: string | null
          notes?: string | null
          organization_id?: string | null
          risk_level?: string | null
          tent_location_description?: string | null
          total_interactions?: number | null
          trespass_notice_date?: string | null
          trespass_notice_issued?: boolean | null
          updated_at?: string | null
          vehicle_association?: string | null
        }
        Update: {
          created_at?: string | null
          date_of_birth?: string | null
          first_name?: string | null
          freedom_camping_act_applies?: boolean | null
          id?: string
          is_of_interest?: boolean | null
          last_contact_at?: string | null
          last_name?: string | null
          notes?: string | null
          organization_id?: string | null
          risk_level?: string | null
          tent_location_description?: string | null
          total_interactions?: number | null
          trespass_notice_date?: string | null
          trespass_notice_issued?: boolean | null
          updated_at?: string | null
          vehicle_association?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "person_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_records_vehicle_association_fkey"
            columns: ["vehicle_association"]
            isOneToOne: false
            referencedRelation: "active_breaches_v2"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "person_records_vehicle_association_fkey"
            columns: ["vehicle_association"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["plate_number"]
          },
        ]
      }
      photo_metadata: {
        Row: {
          created_at: string | null
          file_name: string | null
          file_size: number | null
          id: string
          mime_type: string | null
          observation_id: string | null
          sha256_hash: string | null
          storage_path: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          observation_id?: string | null
          sha256_hash?: string | null
          storage_path?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          observation_id?: string | null
          sha256_hash?: string | null
          storage_path?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "photo_metadata_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "photo_metadata_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_recovery_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_label: string | null
          error_message: string | null
          id: string
          meta: Json | null
          observation_id: string | null
          occurred_at: string | null
          organization_id: string | null
          photo_bytes: number | null
          photo_hash: string | null
          photo_url: string | null
          plate_number: string | null
          recorded_at: string | null
          source: string | null
          source_ref: string | null
          success: boolean
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_label?: string | null
          error_message?: string | null
          id?: string
          meta?: Json | null
          observation_id?: string | null
          occurred_at?: string | null
          organization_id?: string | null
          photo_bytes?: number | null
          photo_hash?: string | null
          photo_url?: string | null
          plate_number?: string | null
          recorded_at?: string | null
          source?: string | null
          source_ref?: string | null
          success?: boolean
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_label?: string | null
          error_message?: string | null
          id?: string
          meta?: Json | null
          observation_id?: string | null
          occurred_at?: string | null
          organization_id?: string | null
          photo_bytes?: number | null
          photo_hash?: string | null
          photo_url?: string | null
          plate_number?: string | null
          recorded_at?: string | null
          source?: string | null
          source_ref?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "photo_recovery_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "photo_recovery_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_recovery_audit_log_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_recovery_audit_log_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "recent_observations_photo_status"
            referencedColumns: ["observation_id"]
          },
          {
            foreignKeyName: "photo_recovery_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plate_scans: {
        Row: {
          ai_vehicle_color: string | null
          ai_vehicle_make: string | null
          ai_vehicle_model: string | null
          breach_detected: boolean | null
          confidence_score: number | null
          created_at: string | null
          flagged_vehicle_detected: boolean | null
          gps_accuracy: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          organization_id: string
          plate_number: string | null
          review_action: string | null
          reviewed: boolean | null
          scan_mode: string | null
          scanned_at: string | null
          scanned_by: string | null
          scanned_photo: string | null
          violation_summary: string | null
          zone_id: string | null
        }
        Insert: {
          ai_vehicle_color?: string | null
          ai_vehicle_make?: string | null
          ai_vehicle_model?: string | null
          breach_detected?: boolean | null
          confidence_score?: number | null
          created_at?: string | null
          flagged_vehicle_detected?: boolean | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          organization_id: string
          plate_number?: string | null
          review_action?: string | null
          reviewed?: boolean | null
          scan_mode?: string | null
          scanned_at?: string | null
          scanned_by?: string | null
          scanned_photo?: string | null
          violation_summary?: string | null
          zone_id?: string | null
        }
        Update: {
          ai_vehicle_color?: string | null
          ai_vehicle_make?: string | null
          ai_vehicle_model?: string | null
          breach_detected?: boolean | null
          confidence_score?: number | null
          created_at?: string | null
          flagged_vehicle_detected?: boolean | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          organization_id?: string
          plate_number?: string | null
          review_action?: string | null
          reviewed?: boolean | null
          scan_mode?: string | null
          scanned_at?: string | null
          scanned_by?: string | null
          scanned_photo?: string | null
          violation_summary?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plate_scans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plate_scans_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "plate_scans_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plate_scans_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "plate_scans_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      restrictions: {
        Row: {
          created_at: string
          geom: unknown
          id: string
          meta_data: Json
          name: string
          organization_id: string
          restriction_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          geom?: unknown
          id?: string
          meta_data?: Json
          name: string
          organization_id: string
          restriction_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          geom?: unknown
          id?: string
          meta_data?: Json
          name?: string
          organization_id?: string
          restriction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restrictions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      user_deactivation_queue: {
        Row: {
          action: string
          error_message: string | null
          id: string
          processed: boolean | null
          processed_at: string | null
          requested_at: string | null
          user_id: string
        }
        Insert: {
          action: string
          error_message?: string | null
          id?: string
          processed?: boolean | null
          processed_at?: string | null
          requested_at?: string | null
          user_id: string
        }
        Update: {
          action?: string
          error_message?: string | null
          id?: string
          processed?: boolean | null
          processed_at?: string | null
          requested_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_deactivation_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_deactivation_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          authorized_activities: Json | null
          authorized_work_locations: string[] | null
          bio: string | null
          coa_document_url: string | null
          coa_expiry: string | null
          coa_expiry_date: string | null
          coa_license_type: string | null
          coa_number: string | null
          coa_required: boolean | null
          coa_verified: boolean | null
          compliance_status: string | null
          created_at: string | null
          credentials_verified: boolean | null
          credentials_verified_at: string | null
          credentials_verified_by: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employer_organization_id: string | null
          first_name: string | null
          has_warrant: boolean | null
          id: string
          is_active: boolean | null
          issuing_authority: string | null
          last_gps_accuracy: number | null
          last_gps_latitude: number | null
          last_gps_longitude: number | null
          last_gps_update: string | null
          last_name: string | null
          organization_id: string | null
          permissions: Json | null
          phone: string | null
          profile_photo_url: string | null
          job_title: string | null
          requires_driver_license: boolean | null
          role: string | null
          updated_at: string | null
          warrant_acts: string[] | null
          warrant_document_url: string | null
          warrant_expiry: string | null
          warrant_expiry_date: string | null
          warrant_number: string | null
          warrant_required: boolean | null
          warrant_verified: boolean | null
        }
        Insert: {
          authorized_activities?: Json | null
          authorized_work_locations?: string[] | null
          bio?: string | null
          coa_document_url?: string | null
          coa_expiry?: string | null
          coa_expiry_date?: string | null
          coa_license_type?: string | null
          coa_number?: string | null
          coa_required?: boolean | null
          coa_verified?: boolean | null
          compliance_status?: string | null
          created_at?: string | null
          credentials_verified?: boolean | null
          credentials_verified_at?: string | null
          credentials_verified_by?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employer_organization_id?: string | null
          first_name?: string | null
          has_warrant?: boolean | null
          id: string
          is_active?: boolean | null
          issuing_authority?: string | null
          last_gps_accuracy?: number | null
          last_gps_latitude?: number | null
          last_gps_longitude?: number | null
          last_gps_update?: string | null
          last_name?: string | null
          organization_id?: string | null
          permissions?: Json | null
          phone?: string | null
          profile_photo_url?: string | null
          job_title?: string | null
          requires_driver_license?: boolean | null
          role?: string | null
          updated_at?: string | null
          warrant_acts?: string[] | null
          warrant_document_url?: string | null
          warrant_expiry?: string | null
          warrant_expiry_date?: string | null
          warrant_number?: string | null
          warrant_required?: boolean | null
          warrant_verified?: boolean | null
        }
        Update: {
          authorized_activities?: Json | null
          authorized_work_locations?: string[] | null
          bio?: string | null
          coa_document_url?: string | null
          coa_expiry?: string | null
          coa_expiry_date?: string | null
          coa_license_type?: string | null
          coa_number?: string | null
          coa_required?: boolean | null
          coa_verified?: boolean | null
          compliance_status?: string | null
          created_at?: string | null
          credentials_verified?: boolean | null
          credentials_verified_at?: string | null
          credentials_verified_by?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employer_organization_id?: string | null
          first_name?: string | null
          has_warrant?: boolean | null
          id?: string
          is_active?: boolean | null
          issuing_authority?: string | null
          last_gps_accuracy?: number | null
          last_gps_latitude?: number | null
          last_gps_longitude?: number | null
          last_gps_update?: string | null
          last_name?: string | null
          organization_id?: string | null
          permissions?: Json | null
          phone?: string | null
          profile_photo_url?: string | null
          job_title?: string | null
          requires_driver_license?: boolean | null
          role?: string | null
          updated_at?: string | null
          warrant_acts?: string[] | null
          warrant_document_url?: string | null
          warrant_expiry?: string | null
          warrant_expiry_date?: string | null
          warrant_number?: string | null
          warrant_required?: boolean | null
          warrant_verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_credentials_verified_by_fkey"
            columns: ["credentials_verified_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_credentials_verified_by_fkey"
            columns: ["credentials_verified_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_employer_organization_id_fkey"
            columns: ["employer_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string
          device_name: string | null
          device_platform: string | null
          id: string
          ip_address: string | null
          last_seen_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_name?: string | null
          device_platform?: string | null
          id?: string
          ip_address?: string | null
          last_seen_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_name?: string | null
          device_platform?: string | null
          id?: string
          ip_address?: string | null
          last_seen_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_discrepancies: {
        Row: {
          created_at: string | null
          details: Json | null
          discrepancy_type: string
          id: string
          observation_id: string
          organization_id: string | null
          plate_number: string | null
          requires_review: boolean | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sc_law_active: boolean | null
          severity: string
          source_a: string
          source_b: string
          value_a: string | null
          value_b: string | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          details?: Json | null
          discrepancy_type: string
          id?: string
          observation_id: string
          organization_id?: string | null
          plate_number?: string | null
          requires_review?: boolean | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sc_law_active?: boolean | null
          severity?: string
          source_a: string
          source_b: string
          value_a?: string | null
          value_b?: string | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          details?: Json | null
          discrepancy_type?: string
          id?: string
          observation_id?: string
          organization_id?: string | null
          plate_number?: string | null
          requires_review?: boolean | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sc_law_active?: boolean | null
          severity?: string
          source_a?: string
          source_b?: string
          value_a?: string | null
          value_b?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_discrepancies_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations"
            referencedColumns: ["observation_id"]
          },
          {
            foreignKeyName: "vehicle_discrepancies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_discrepancies_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "vehicle_discrepancies_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_migration_log: {
        Row: {
          action: string
          canonical_vehicle_id: string | null
          created_at: string | null
          details: Json | null
          id: string
          legacy_record_id: string | null
          migration_run_id: string
          plate_number: string
        }
        Insert: {
          action: string
          canonical_vehicle_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          legacy_record_id?: string | null
          migration_run_id?: string
          plate_number: string
        }
        Update: {
          action?: string
          canonical_vehicle_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          legacy_record_id?: string | null
          migration_run_id?: string
          plate_number?: string
        }
        Relationships: []
      }
      vehicle_monthly_stays: {
        Row: {
          calendar_month: string
          consecutive_nights: number | null
          created_at: string | null
          id: string
          last_observation_date: string | null
          last_reset_at: string | null
          nights_stayed: number | null
          observation_ids: string[] | null
          organization_id: string
          plate_number: string
          reset_at: string | null
          updated_at: string | null
          zone_id: string
        }
        Insert: {
          calendar_month: string
          consecutive_nights?: number | null
          created_at?: string | null
          id?: string
          last_observation_date?: string | null
          last_reset_at?: string | null
          nights_stayed?: number | null
          observation_ids?: string[] | null
          organization_id: string
          plate_number: string
          reset_at?: string | null
          updated_at?: string | null
          zone_id: string
        }
        Update: {
          calendar_month?: string
          consecutive_nights?: number | null
          created_at?: string | null
          id?: string
          last_observation_date?: string | null
          last_reset_at?: string | null
          nights_stayed?: number | null
          observation_ids?: string[] | null
          organization_id?: string
          plate_number?: string
          reset_at?: string | null
          updated_at?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_monthly_stays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_monthly_stays_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "active_breaches_v2"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "vehicle_monthly_stays_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "vehicle_monthly_stays_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "vehicle_monthly_stays_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_records_deprecated_20250131: {
        Row: {
          created_at: string | null
          gps_accuracy: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          homeless_claimed: boolean | null
          homeless_confirmation_notes: string | null
          homeless_confirmed: boolean | null
          homeless_confirmed_at: string | null
          homeless_confirmed_by: string | null
          id: string
          is_compliant: boolean | null
          organization_id: string | null
          plate_number: string | null
          recorded_at: string
          recorded_by: string | null
          updated_at: string | null
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          homeless_claimed?: boolean | null
          homeless_confirmation_notes?: string | null
          homeless_confirmed?: boolean | null
          homeless_confirmed_at?: string | null
          homeless_confirmed_by?: string | null
          id?: string
          is_compliant?: boolean | null
          organization_id?: string | null
          plate_number?: string | null
          recorded_at?: string
          recorded_by?: string | null
          updated_at?: string | null
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          homeless_claimed?: boolean | null
          homeless_confirmation_notes?: string | null
          homeless_confirmed?: boolean | null
          homeless_confirmed_at?: string | null
          homeless_confirmed_by?: string | null
          id?: string
          is_compliant?: boolean | null
          organization_id?: string | null
          plate_number?: string | null
          recorded_at?: string
          recorded_by?: string | null
          updated_at?: string | null
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          zone_id?: string | null
        }
        Relationships: []
      }
      zone_compliance_matrix: {
        Row: {
          allowed_days: string[] | null
          change_notes: string | null
          change_reason: string | null
          created_at: string | null
          day_visit_only: boolean | null
          effective_from: string | null
          effective_to: string | null
          homeless_exemption: boolean | null
          id: string
          max_consecutive_nights: number | null
          nights_per_month: number | null
          organization_id: string | null
          requires_csc: boolean | null
          self_contained_required: boolean | null
          updated_at: string | null
          version: number | null
          zone_id: string
        }
        Insert: {
          allowed_days?: string[] | null
          change_notes?: string | null
          change_reason?: string | null
          created_at?: string | null
          day_visit_only?: boolean | null
          effective_from?: string | null
          effective_to?: string | null
          homeless_exemption?: boolean | null
          id?: string
          max_consecutive_nights?: number | null
          nights_per_month?: number | null
          organization_id?: string | null
          requires_csc?: boolean | null
          self_contained_required?: boolean | null
          updated_at?: string | null
          version?: number | null
          zone_id: string
        }
        Update: {
          allowed_days?: string[] | null
          change_notes?: string | null
          change_reason?: string | null
          created_at?: string | null
          day_visit_only?: boolean | null
          effective_from?: string | null
          effective_to?: string | null
          homeless_exemption?: boolean | null
          id?: string
          max_consecutive_nights?: number | null
          nights_per_month?: number | null
          organization_id?: string | null
          requires_csc?: boolean | null
          self_contained_required?: boolean | null
          updated_at?: string | null
          version?: number | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_compliance_matrix_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_compliance_matrix_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "zone_compliance_matrix_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_geofence_monthly_snapshots: {
        Row: {
          created_at: string
          geometry_hash: string | null
          geometry_type: string | null
          id: string
          organization_id: string
          quality_metrics: Json
          quality_reason: string | null
          quality_status: string
          snapshot_month: string
          source_updated_at: string | null
          updated_at: string
          zone_id: string
          zone_name: string
          zone_type: string | null
        }
        Insert: {
          created_at?: string
          geometry_hash?: string | null
          geometry_type?: string | null
          id?: string
          organization_id: string
          quality_metrics?: Json
          quality_reason?: string | null
          quality_status?: string
          snapshot_month: string
          source_updated_at?: string | null
          updated_at?: string
          zone_id: string
          zone_name: string
          zone_type?: string | null
        }
        Update: {
          created_at?: string
          geometry_hash?: string | null
          geometry_type?: string | null
          id?: string
          organization_id?: string
          quality_metrics?: Json
          quality_reason?: string | null
          quality_status?: string
          snapshot_month?: string
          source_updated_at?: string | null
          updated_at?: string
          zone_id?: string
          zone_name?: string
          zone_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zone_geofence_monthly_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_geofence_monthly_snapshots_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "zone_geofence_monthly_snapshots_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_legal_config: {
        Row: {
          authorized_signatories: Json | null
          breach_template: string
          created_at: string | null
          enforcement_authority: string | null
          enforcement_type: string
          fine_amount: number | null
          id: string
          land_act: string
          land_owner: string
          legal_description: string
          managing_authority: string | null
          max_consecutive_nights: number | null
          max_stay_nights: number | null
          dispute_portal_url: string | null
          objections_email: string | null
          objections_postal_address: string | null
          org_building: string | null
          org_city: string
          org_country: string | null
          org_email: string | null
          org_fax: string | null
          org_office_name: string
          org_phone: string | null
          org_po_box: string | null
          org_postcode: string
          org_street_address: string
          org_website: string | null
          payment_bank_account: string | null
          payment_instructions: string | null
          payment_online_url: string | null
          organization_id: string
          self_contained_required: boolean | null
          trespass_duration_years: number | null
          updated_at: string | null
          vacate_hours: number | null
          zone_id: string
        }
        Insert: {
          authorized_signatories?: Json | null
          breach_template: string
          created_at?: string | null
          enforcement_authority?: string | null
          enforcement_type: string
          fine_amount?: number | null
          id?: string
          land_act: string
          land_owner: string
          legal_description: string
          managing_authority?: string | null
          max_consecutive_nights?: number | null
          max_stay_nights?: number | null
          dispute_portal_url?: string | null
          objections_email?: string | null
          objections_postal_address?: string | null
          org_building?: string | null
          org_city: string
          org_country?: string | null
          org_email?: string | null
          org_fax?: string | null
          org_office_name: string
          org_phone?: string | null
          org_po_box?: string | null
          org_postcode: string
          org_street_address: string
          org_website?: string | null
          payment_bank_account?: string | null
          payment_instructions?: string | null
          payment_online_url?: string | null
          organization_id: string
          self_contained_required?: boolean | null
          trespass_duration_years?: number | null
          updated_at?: string | null
          vacate_hours?: number | null
          zone_id: string
        }
        Update: {
          authorized_signatories?: Json | null
          breach_template?: string
          created_at?: string | null
          dispute_portal_url?: string | null
          enforcement_authority?: string | null
          enforcement_type?: string
          fine_amount?: number | null
          id?: string
          land_act?: string
          land_owner?: string
          legal_description?: string
          managing_authority?: string | null
          max_consecutive_nights?: number | null
          max_stay_nights?: number | null
          objections_email?: string | null
          objections_postal_address?: string | null
          org_building?: string | null
          org_city?: string
          org_country?: string | null
          org_email?: string | null
          org_fax?: string | null
          org_office_name?: string
          org_phone?: string | null
          org_po_box?: string | null
          org_postcode?: string
          org_street_address?: string
          org_website?: string | null
          payment_bank_account?: string | null
          payment_instructions?: string | null
          payment_online_url?: string | null
          organization_id?: string
          self_contained_required?: boolean | null
          trespass_duration_years?: number | null
          updated_at?: string | null
          vacate_hours?: number | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_legal_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_legal_config_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: true
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "zone_legal_config_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: true
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_signage_evidence: {
        Row: {
          captured_at: string | null
          captured_by: string | null
          created_at: string | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          is_current: boolean | null
          notes: string | null
          photo_sha256: string
          photo_url: string
          signage_type: string | null
          zone_id: string
        }
        Insert: {
          captured_at?: string | null
          captured_by?: string | null
          created_at?: string | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          is_current?: boolean | null
          notes?: string | null
          photo_sha256: string
          photo_url: string
          signage_type?: string | null
          zone_id: string
        }
        Update: {
          captured_at?: string | null
          captured_by?: string | null
          created_at?: string | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          is_current?: boolean | null
          notes?: string | null
          photo_sha256?: string
          photo_url?: string
          signage_type?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_signage_evidence_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "zone_signage_evidence_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_signage_evidence_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "zone_signage_evidence_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      zones: {
        Row: {
          allowed_days: string[] | null
          boundary_source: string | null
          created_at: string | null
          day_visit_only: boolean | null
          description: string | null
          geometry: Json | null
          id: string
          is_active: boolean | null
          location_lat: number | null
          location_lng: number | null
          max_consecutive_nights: number | null
          name: string
          needs_admin_review: boolean | null
          nights_per_month: number | null
          organization_id: string
          parent_zone_id: string | null
          parkpow_lot_id: number | null
          self_contained_required: boolean | null
          updated_at: string | null
          zone_type: string | null
          land_managing_agency: string | null
          bylaw_reference: string | null
          seasonal_open_month: number | null
          seasonal_close_month: number | null
        }
        Insert: {
          allowed_days?: string[] | null
          boundary_source?: string | null
          created_at?: string | null
          day_visit_only?: boolean | null
          description?: string | null
          geometry?: Json | null
          id?: string
          is_active?: boolean | null
          location_lat?: number | null
          location_lng?: number | null
          max_consecutive_nights?: number | null
          name: string
          needs_admin_review?: boolean | null
          nights_per_month?: number | null
          organization_id: string
          parent_zone_id?: string | null
          parkpow_lot_id?: number | null
          self_contained_required?: boolean | null
          updated_at?: string | null
          zone_type?: string | null
          land_managing_agency?: string | null
          bylaw_reference?: string | null
          seasonal_open_month?: number | null
          seasonal_close_month?: number | null
        }
        Update: {
          allowed_days?: string[] | null
          boundary_source?: string | null
          created_at?: string | null
          day_visit_only?: boolean | null
          description?: string | null
          geometry?: Json | null
          id?: string
          is_active?: boolean | null
          location_lat?: number | null
          location_lng?: number | null
          max_consecutive_nights?: number | null
          name?: string
          needs_admin_review?: boolean | null
          nights_per_month?: number | null
          organization_id?: string
          parent_zone_id?: string | null
          parkpow_lot_id?: number | null
          self_contained_required?: boolean | null
          updated_at?: string | null
          zone_type?: string | null
          land_managing_agency?: string | null
          bylaw_reference?: string | null
          seasonal_open_month?: number | null
          seasonal_close_month?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "zones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zones_parent_zone_id_fkey"
            columns: ["parent_zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "zones_parent_zone_id_fkey"
            columns: ["parent_zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      active_breaches_v2: {
        Row: {
          breach_count: number | null
          consecutive_nights: number | null
          fc_act_exempt: boolean | null
          has_enforcement_assigned: boolean | null
          homeless_status: string | null
          is_flagged: boolean | null
          last_breach_at: string | null
          last_breach_type: string | null
          max_consecutive_nights: number | null
          nights_per_month: number | null
          nights_stayed: number | null
          organization_id: string | null
          plate_number: string | null
          profile_photo: string | null
          total_observations: number | null
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          zone_id: string | null
          zone_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_observations_v2_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      mv_violation_statistics: {
        Row: {
          after_hours_count: number | null
          avg_gps_distance: number | null
          compliance_rate_percent: number | null
          compliant_count: number | null
          confirmed_stay_violations: number | null
          consecutive_violations: number | null
          evaluation_date: string | null
          gps_confirmed_stays: number | null
          max_gps_distance: number | null
          min_gps_distance: number | null
          monthly_limit_violations: number | null
          non_compliant_count: number | null
          not_self_contained_violations: number | null
          organization_id: string | null
          possible_stay_violations: number | null
          possible_zone_violations: number | null
          total_evaluations: number | null
          zone_id: string | null
          zone_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_results_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "compliance_results_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_compliance_dashboard: {
        Row: {
          can_enforce: boolean | null
          can_work: boolean | null
          coa_days_until_expiry: number | null
          coa_expiring_soon: boolean | null
          coa_expiry_date: string | null
          coa_number: string | null
          compliance_status: string | null
          email: string | null
          employer_organization: string | null
          first_name: string | null
          has_warrant: boolean | null
          last_name: string | null
          role: string | null
          user_id: string | null
          warrant_days_until_expiry: number | null
          warrant_expiring_soon: boolean | null
          warrant_expiry_date: string | null
          warrant_number: string | null
        }
        Relationships: []
      }
      photo_integrity_health: {
        Row: {
          latest_observation: string | null
          missing_any: number | null
          missing_hash: number | null
          missing_url: number | null
          organization_id: string | null
          organization_name: string | null
          photo_coverage_pct: number | null
          total_observations: number | null
          with_photo: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_observations_v2_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recent_observations_photo_status: {
        Row: {
          has_hash: boolean | null
          has_url: boolean | null
          observation_id: string | null
          organization_id: string | null
          plate_number: string | null
          recorded_at: string | null
          status: string | null
        }
        Insert: {
          has_hash?: never
          has_url?: never
          observation_id?: string | null
          organization_id?: string | null
          plate_number?: string | null
          recorded_at?: string | null
          status?: never
        }
        Update: {
          has_hash?: never
          has_url?: never
          observation_id?: string | null
          organization_id?: string | null
          plate_number?: string | null
          recorded_at?: string | null
          status?: never
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_observations_v2_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "active_breaches_v2"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["plate_number"]
          },
        ]
      }
      v_observation_zone_audit: {
        Row: {
          canonical_org_id: string | null
          canonical_org_name: string | null
          canonical_zone_id: string | null
          canonical_zone_name: string | null
          current_org_id: string | null
          current_org_name: string | null
          current_zone_id: string | null
          current_zone_name: string | null
          is_correctly_assigned: boolean | null
          is_legacy_import: boolean | null
          legacy_source_tag: string | null
          observation_id: string | null
          observed_date: string | null
          plate_number: string | null
          zone_name_at_import: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_observations_v2_organization_id_fkey"
            columns: ["current_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "active_breaches_v2"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_plate_number_fkey"
            columns: ["plate_number"]
            isOneToOne: false
            referencedRelation: "canonical_vehicles"
            referencedColumns: ["plate_number"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_zone_id_fkey"
            columns: ["current_zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "vehicle_observations_v2_zone_id_fkey"
            columns: ["current_zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zones_organization_id_fkey"
            columns: ["canonical_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      auto_evaluate_compliance_and_create_breach: {
        Args: { p_observation_id: string }
        Returns: undefined
      }
      backfill_monthly_stays_from_observations: {
        Args: never
        Returns: {
          observations_processed: number
          plates_processed: number
          records_created: number
        }[]
      }
      calculate_compliance_status: {
        Args: {
          p_coa_expiry_date: string
          p_employer_org_id: string
          p_has_warrant: boolean
          p_warrant_expiry_date: string
        }
        Returns: string
      }
      calculate_gps_distance: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      calculate_vehicle_compliance_v3: {
        Args: {
          p_check_date?: string
          p_observation_id?: string
          p_observation_time?: string
          p_plate_number: string
          p_zone_id: string
        }
        Returns: {
          at_risk: boolean
          breach_type: string
          consecutive_allowed: number
          consecutive_nights: number
          is_compliant: boolean
          is_day_visit_only_zone: boolean
          is_homeless_exempt: boolean
          is_overnight_stay: boolean
          matrix_snapshot: Json
          nights_allowed: number
          nights_stayed: number
          violation_reasons: string[]
        }[]
      }
      can_issue_enforcement: { Args: { officer_id: string }; Returns: boolean }
      can_officer_work: { Args: { officer_id: string }; Returns: boolean }
      can_user_modify_observation: {
        Args: { p_observation_id: string; p_user_id: string }
        Returns: boolean
      }
      check_duplicate_plates: {
        Args: never
        Returns: {
          count: number
          plate_number: string
          vehicle_ids: string[]
        }[]
      }
      check_location_in_org: {
        Args: { lat: number; lon: number; org_id: string }
        Returns: Json
      }
      check_organization_compliance: {
        Args: { p_employer_org_id: string; p_user_id: string }
        Returns: {
          can_work: boolean
          employer_name: string
          missing_items: string[]
        }[]
      }
      check_unmigrated_records: {
        Args: never
        Returns: {
          newest_record: string
          oldest_record: string
          unique_plates: number
          unmigrated_count: number
        }[]
      }
      check_vehicle_compliance_v3: {
        Args: {
          p_check_date?: string
          p_observation_id?: string
          p_plate_number: string
          p_zone_id: string
        }
        Returns: {
          consecutive_nights: number
          fc_act_exempt: boolean
          is_compliant: boolean
          month_nights: number
          violation_message: string
          violation_type: string
          will_breach_tonight: boolean
        }[]
      }
      cohort_all_breaches: {
        Args: {
          p_from: string
          p_org_id?: string
          p_to: string
          p_zone_id?: string
        }
        Returns: {
          is_homeless_exempt: boolean
          observation_id: string
          plate_number: string
          recorded_at: string
          violation_reasons: string[]
          zone_id: string
          zone_name: string
        }[]
      }
      cohort_homeless_exempt: {
        Args: {
          p_from: string
          p_org_id?: string
          p_to: string
          p_zone_id?: string
        }
        Returns: {
          observation_id: string
          plate_number: string
          recorded_at: string
          violation_reasons: string[]
          zone_id: string
          zone_name: string
        }[]
      }
      cohort_overstayers: {
        Args: {
          p_from: string
          p_org_id?: string
          p_to: string
          p_zone_id?: string
        }
        Returns: {
          observation_id: string
          plate_number: string
          recorded_at: string
          violation_reasons: string[]
          zone_id: string
          zone_name: string
        }[]
      }
      detect_missing_photos: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_organization_id?: string
        }
        Returns: {
          already_queued: number
          inserted_count: number
        }[]
      }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      ensure_other_location_zone: {
        Args: { p_organization_id: string }
        Returns: string
      }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      evaluate_compliance_v4: {
        Args: { p_observation_id: string }
        Returns: undefined
      }
      evaluate_observation_requirements: {
        Args: { p_observation_id: string }
        Returns: Json
      }
      find_zone_by_gps: {
        Args: {
          p_latitude: number
          p_longitude: number
          p_organization_id?: string
        }
        Returns: {
          distance_meters: number
          match_type: string
          zone_id: string
          zone_name: string
        }[]
      }
      format_violation_reasons: {
        Args: {
          after_hours?: boolean
          gps_confirmed?: boolean
          violation_reasons: string[]
        }
        Returns: string
      }
      generate_notice_reference: { Args: never; Returns: string }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_active_breaches: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_organization_id?: string
        }
        Returns: {
          breach_count: number
          consecutive_nights: number
          enforcement_status: string
          has_active_enforcement: boolean
          homeless_status: string
          is_flagged: boolean
          last_breach_date: string
          last_breach_type: string
          max_allowed_consecutive: number
          max_allowed_monthly: number
          nights_stayed: number
          organization_id: string
          plate_number: string
          total_observations: number
          zone_id: string
          zone_name: string
        }[]
      }
      get_admin_dashboard_stats: {
        Args: {
          p_end_date: string
          p_organization_id?: string
          p_start_date: string
        }
        Returns: {
          active_investigations: number
          active_officers: number
          active_patrols: number
          compliance_rate: number
          compliant_observations: number
          flagged_vehicles: number
          homeless_exempt: number
          homeless_vehicles: number
          non_compliant_observations: number
          pending_breach_alerts: number
          total_breaches: number
          total_observations: number
          total_vehicles: number
          zones_with_activity: number
        }[]
      }
      get_available_job_types: {
        Args: { user_org_id: string }
        Returns: {
          description: string
          id: string
          is_custom: boolean
          name: string
        }[]
      }
      get_breach_alert_observations: {
        Args: { p_breach_alert_id: string }
        Returns: {
          compliance_violation_reasons: string[]
          evidence_photos: Json
          gps_latitude: number
          gps_longitude: number
          is_compliant: boolean
          notes: string
          observation_id: string
          recorded_at: string
          zone_name: string
        }[]
      }
      get_bug_report_stats: { Args: { org_id?: string }; Returns: Json }
      get_compliance_analytics_summary: {
        Args: {
          p_end: string
          p_organization_id?: string
          p_start: string
          p_zone_id?: string
        }
        Returns: Json
      }
      get_compliance_stats: {
        Args: {
          p_end: string
          p_organization_id?: string
          p_start: string
          p_zone_id?: string
        }
        Returns: {
          breach_count: number
          compliance_rate: number
          compliant_count: number
          flagged_vehicles: number
          homeless_vehicles: number
          total_observations: number
        }[]
      }
      get_descendant_organizations: {
        Args: { org_id: string }
        Returns: string[]
      }
      get_effective_homeless_status: {
        Args: { p_organization_id: string; p_plate_number: string }
        Returns: string
      }
      get_gps_verified_breach_evidence: {
        Args: { p_plate_number: string; p_zone_id: string }
        Returns: Json
      }
      get_import_batch_stats: {
        Args: { p_batch_id: string }
        Returns: {
          batch_id: string
          batch_name: string
          completed_at: string
          completion_percentage: number
          created_at: string
          enrichment_rate: number
          failed_records: number
          processed_records: number
          status: string
          successful_records: number
          total_records: number
        }[]
      }
      get_live_officer_locations: {
        Args: never
        Returns: {
          first_name: string
          is_active_investigation: boolean
          last_gps_accuracy: number
          last_gps_latitude: number
          last_gps_longitude: number
          last_gps_update: string
          last_name: string
          last_scan_plate: string
          last_scan_zone: string
          organization_id: string
          phone: string
          recent_scans: number
          user_id: string
          welfare_status: string
        }[]
      }
      get_my_scans_24h: {
        Args: { p_user_id: string }
        Returns: {
          can_delete: boolean
          can_edit: boolean
          gps_accuracy: number
          has_hs_issue: boolean
          hours_remaining: number
          is_at_risk: boolean
          is_breach: boolean
          is_compliant: boolean
          is_flagged: boolean
          is_homeless: boolean
          is_self_contained: boolean
          observation_id: string
          organization_id: string
          photo: string
          plate_number: string
          prior_observations_count: number
          recorded_at: string
          vehicle_color: string
          vehicle_id: string
          vehicle_make: string
          vehicle_model: string
          zone_id: string
          zone_name: string
        }[]
      }
      get_observation_edit_status: {
        Args: { p_observation_id: string; p_user_id: string }
        Returns: {
          can_delete: boolean
          can_edit: boolean
          hours_remaining: number
          is_own_scan: boolean
        }[]
      }
      get_observation_result: {
        Args: { p_observation_id: string }
        Returns: Json
      }
      get_officer_active_patrols: {
        Args: { p_officer_id: string }
        Returns: {
          auto_checkin_enabled: boolean
          checked_in_at: string
          completed_at: string
          geofence_radius: number
          patrol_date: string
          patrol_id: string
          shift: string
          status: string
          zone_center_lat: number
          zone_center_lng: number
          zone_geometry: Json
          zone_id: string
          zone_name: string
        }[]
      }
      get_officer_investigation_jobs: {
        Args: { p_officer_id: string }
        Returns: {
          assigned_at: string
          briefing_notes: string
          created_at: string
          due_date: string
          gps_latitude: number
          gps_longitude: number
          instructions: string
          job_id: string
          job_type: string
          location_address: string
          priority: string
          property_details: string
          reference_number: string
          status: string
          template_used: string
        }[]
      }
      get_org_scans_24h: {
        Args: {
          p_filter_at_risk?: boolean
          p_filter_breaches?: boolean
          p_filter_homeless?: boolean
          p_user_id: string
        }
        Returns: {
          can_delete: boolean
          can_edit: boolean
          gps_latitude: number
          gps_longitude: number
          hours_remaining: number
          is_at_risk: boolean
          is_breach: boolean
          is_compliant: boolean
          is_flagged: boolean
          is_homeless: boolean
          is_own_scan: boolean
          observation_id: string
          officer_name: string
          photo: string
          plate_number: string
          recorded_at: string
          recorded_by: string
          vehicle_color: string
          vehicle_make: string
          vehicle_model: string
          zone_id: string
          zone_name: string
        }[]
      }
      get_patrol_kpis: {
        Args: {
          p_from?: string
          p_officer_id?: string
          p_organization_id: string
          p_to?: string
        }
        Returns: Json
      }
      get_pending_alerts: {
        Args: { p_user_id: string }
        Returns: {
          alert_id: string
          alert_type: string
          can_dismiss: boolean
          created_at: string
          message: string
          priority: string
          title: string
          vehicle_plate: string
          zone_name: string
        }[]
      }
      get_person_interaction_history: {
        Args: { p_person_id: string }
        Returns: {
          interaction_at: string
          interaction_id: string
          interaction_type: string
          officer_name: string
          officer_notes: string
          outcome: string
          zone_name: string
        }[]
      }
      get_person_observation_history: {
        Args: { p_person_id: string }
        Returns: {
          evidence_photos: string[]
          id: string
          observation_type: string
          officer_name: string
          officer_notes: string
          plate_number: string
          recorded_at: string
          vehicle_color: string
          vehicle_make: string
          vehicle_model: string
          zone_name: string
        }[]
      }
      get_shift_period: { Args: { observation_time: string }; Returns: string }
      get_user_organization_id: { Args: { p_user_id: string }; Returns: string }
      get_user_organization_ids: { Args: never; Returns: string[] }
      get_user_role: { Args: { p_user_id: string }; Returns: string }
      get_vehicle_master_data: {
        Args: { p_plate_number: string }
        Returns: {
          enforcement_count: number
          fc_act_exempt: boolean
          first_seen_at: string
          flagged_priority: string
          flagged_reason: string
          homeless_confirmed_at: string
          homeless_status: string
          is_flagged: boolean
          last_seen_at: string
          plate_number: string
          profile_photo: string
          self_contained: boolean
          self_contained_expiry: string
          total_breaches: number
          total_incidents: number
          total_observations: number
          vehicle_color: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year: number
        }[]
      }
      get_vehicle_notes_history: {
        Args: { p_limit?: number; p_plate_number: string }
        Returns: {
          observation_id: string
          officer_notes: string
          recorded_at: string
          recorded_by_name: string
          zone_name: string
        }[]
      }
      get_vehicle_overnight_status: {
        Args: { p_plate_number: string; p_zone_id: string }
        Returns: {
          already_scanned_today: boolean
          is_about_to_breach: boolean
          is_breach: boolean
          max_consecutive_nights: number
          nights_stayed_this_month: number
        }[]
      }
      get_zone_compliance_breakdown: {
        Args: { p_end: string; p_organization_id?: string; p_start: string }
        Returns: {
          breach_count: number
          compliance_pct: number
          day_visit_only: boolean
          is_active: boolean
          max_consecutive_nights: number
          nights_per_month: number
          obs_count: number
          organization_name: string
          parent_zone_id: string | null
          self_contained_required: boolean
          zone_id: string
          zone_name: string
          zone_type: string | null
        }[]
      }
        check_compliance: {
          Args: { p_plate_number: string; p_zone_id: string; p_recorded_at?: string }
          Returns: Json
        }
        check_duplicate_observations: {
          Args: Record<PropertyKey, never>
          Returns: {
            count: number
            plate_number: string
            zone_id: string
            observation_ids: string[]
          }[]
        }
        get_duplicate_observations: {
          Args: { p_organization_id?: string; p_limit?: number }
          Returns: {
            plate_number: string
            zone_id: string
            zone_name: string
            observation_ids: string[]
            count: number
          }[]
        }
        increment_patrol_breaches_found: {
          Args: { p_patrol_id: string }
          Returns: undefined
        }
        increment_patrol_vehicles_checked: {
          Args: { p_patrol_id: string }
          Returns: undefined
        }
        set_org_geometry: {
          Args: { org_id: string; geojson: Json }
          Returns: undefined
        }
      gettransactionid: { Args: never; Returns: unknown }
      is_same_calendar_day: {
        Args: {
          p_plate_number: string
          p_recorded_at: string
          p_zone_id: string
        }
        Returns: boolean
      }
      is_zone_seasonally_open: {
        Args: { p_zone_id: string }
        Returns: boolean
      }
      log_compliance_check: {
        Args: {
          p_blocked_reason?: string
          p_check_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      log_officer_activity: {
        Args: {
          p_activity_type: string
          p_gps_accuracy?: number
          p_gps_latitude?: number
          p_gps_longitude?: number
          p_metadata?: Json
          p_user_id: string
        }
        Returns: string
      }
      log_officer_gps_update: {
        Args: {
          p_accuracy: number
          p_activity_type?: string
          p_latitude: number
          p_longitude: number
          p_user_id: string
        }
        Returns: string
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      mark_deactivation_processed: {
        Args: { error_msg?: string; queue_user_id: string; success: boolean }
        Returns: undefined
      }
      migrate_legacy_vehicles: {
        Args: {
          p_dry_run?: boolean
          p_organization_id?: string
          p_zone_id?: string
        }
        Returns: {
          action: string
          message: string
          observations_created: number
          plate_number: string
          vehicle_id: string
        }[]
      }
      normalize_plate_key: { Args: { p_plate: string }; Returns: string }
      nz_current_date: { Args: never; Returns: string }
      nz_now: { Args: never; Returns: string }
      patrol_auto_checkin: {
        Args: { p_gps_lat: number; p_gps_lng: number; p_patrol_id: string }
        Returns: Json
      }
      patrol_auto_checkout: { Args: { p_patrol_id: string }; Returns: Json }
      photo_integrity_status_check: { Args: never; Returns: string }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      process_user_deactivation_queue: {
        Args: never
        Returns: {
          action: string
          email: string
          should_disable: boolean
          user_id: string
        }[]
      }
      quick_complete_investigation_job: {
        Args: {
          p_completion_summary: string
          p_follow_up_notes?: string
          p_follow_up_required?: boolean
          p_job_id: string
          p_photo_urls?: string[]
          p_structures_found?: string
          p_vehicles_found?: string
        }
        Returns: Json
      }
      recalculate_observation_compliance: {
        Args: { p_observation_id: string }
        Returns: undefined
      }
      recompute_all_compliance_since_effective_date: {
        Args: { p_effective_from: string }
        Returns: Json
      }
      refresh_violation_statistics: { Args: never; Returns: undefined }
      rollback_migration: {
        Args: { p_migration_run_id: string }
        Returns: string
      }
      safe_insert_observation: { Args: { p_data: Json }; Returns: Json }
      should_analyze_vehicle: {
        Args: { p_vehicle_id: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      take_breach_action: {
        Args: {
          p_action_status: string
          p_breach_alert_id: string
          p_closure_reason?: string
          p_marked_homeless_reason?: string
          p_monitoring_notes?: string
          p_monitoring_until?: string
          p_user_id: string
        }
        Returns: Json
      }
      trigger_zone_correction: { Args: never; Returns: Json }
      unlockrows: { Args: { "": string }; Returns: number }
      update_import_batch_progress: {
        Args: {
          p_batch_id: string
          p_failed: number
          p_processed: number
          p_status?: string
          p_successful: number
        }
        Returns: undefined
      }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      upsert_canonical_vehicle: {
        Args: {
          p_plate_number: string
          p_self_contained?: boolean
          p_self_contained_expiry?: string
          p_vehicle_color?: string
          p_vehicle_make?: string
          p_vehicle_model?: string
          p_vehicle_year?: number
        }
        Returns: string
      }
      user_created_record: {
        Args: { record_user_id: string }
        Returns: boolean
      }
      validate_vehicle_stats: {
        Args: never
        Returns: {
          actual_count: number
          mismatch: boolean
          plate_number: string
          stored_count: number
          vehicle_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
