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
      bob_user_profiles: {
        Row: {
          id: string
          user_id: string
          organization_id: string | null
          bob_tier: 'captain' | 'commander' | 'officer' | 'ensign' | 'guest'
          tone: 'professional' | 'technical' | 'casual' | 'brief' | 'verbose' | 'sarcastic'
          language: string
          permissions: Json | null
          memory_seeds: Json | null
          memory_namespace: string | null
          ui_theme: 'system' | 'dark' | 'light' | 'lcars'
          computer_use_enabled: boolean
          entry_code: string | null
          system_prompt_suffix: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id?: string | null
          bob_tier?: 'captain' | 'commander' | 'officer' | 'ensign' | 'guest'
          tone?: 'professional' | 'technical' | 'casual' | 'brief' | 'verbose' | 'sarcastic'
          language?: string
          permissions?: Json | null
          memory_seeds?: Json | null
          memory_namespace?: string | null
          ui_theme?: 'system' | 'dark' | 'light' | 'lcars'
          computer_use_enabled?: boolean
          entry_code?: string | null
          system_prompt_suffix?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string | null
          bob_tier?: 'captain' | 'commander' | 'officer' | 'ensign' | 'guest'
          tone?: 'professional' | 'technical' | 'casual' | 'brief' | 'verbose' | 'sarcastic'
          language?: string
          permissions?: Json | null
          memory_seeds?: Json | null
          memory_namespace?: string | null
          ui_theme?: 'system' | 'dark' | 'light' | 'lcars'
          computer_use_enabled?: boolean
          entry_code?: string | null
          system_prompt_suffix?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'bob_user_profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      admin_recalculation_actions: {
        Row: {
          completed_at: string | null
          compliance_changed: number | null
          created_at: string
          date_range_end: string | null
          date_range_start: string | null
          drift_events_created: number | null
          duration_seconds: number | null
          error_message: string | null
          id: string
          observations_processed: number | null
          performed_by: string
          scope_type: string
          started_at: string
          status: string
          target_org_ids: string[]
          target_zone_ids: string[]
        }
        Insert: {
          completed_at?: string | null
          compliance_changed?: number | null
          created_at?: string
          date_range_end?: string | null
          date_range_start?: string | null
          drift_events_created?: number | null
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          observations_processed?: number | null
          performed_by: string
          scope_type?: string
          started_at?: string
          status?: string
          target_org_ids?: string[]
          target_zone_ids?: string[]
        }
        Update: {
          completed_at?: string | null
          compliance_changed?: number | null
          created_at?: string
          date_range_end?: string | null
          date_range_start?: string | null
          drift_events_created?: number | null
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          observations_processed?: number | null
          performed_by?: string
          scope_type?: string
          started_at?: string
          status?: string
          target_org_ids?: string[]
          target_zone_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "admin_recalculation_actions_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_recalculation_actions_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_recalculation_actions_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      alarm_events: {
        Row: {
          id: string
          organization_id: string
          source_system: string
          alarm_type: string
          severity: string
          trigger_time: string
          address: string | null
          zone_id: string | null
          site_reference: string | null
          status: string
          acknowledged_at: string | null
          acknowledged_by: string | null
          resolved_at: string | null
          linked_incident_id: string | null
          notes: string | null
          raw_payload: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          source_system: string
          alarm_type: string
          severity?: string
          trigger_time?: string
          address?: string | null
          zone_id?: string | null
          site_reference?: string | null
          status?: string
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          resolved_at?: string | null
          linked_incident_id?: string | null
          notes?: string | null
          raw_payload?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          source_system?: string
          alarm_type?: string
          severity?: string
          trigger_time?: string
          address?: string | null
          zone_id?: string | null
          site_reference?: string | null
          status?: string
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          resolved_at?: string | null
          linked_incident_id?: string | null
          notes?: string | null
          raw_payload?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          case_id: string | null
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
          case_id?: string | null
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
          case_id?: string | null
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "breach_alerts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "operational_cases"
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
          auto_reported: boolean | null
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
          auto_reported?: boolean | null
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
          auto_reported?: boolean | null
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          notes: string | null
          plate_number: string
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          notes?: string | null
          plate_number: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          notes?: string | null
          plate_number?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_canonical_homeless_confirmed_by"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "fk_canonical_homeless_confirmed_by"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
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
          certificate_issue_date: string | null
          certificate_status: string | null
          certificate_expiry: string | null
          created_at: string
          is_self_contained: boolean
          logo_url: string | null
          max_occupants: number | null
          notes: string | null
          plate_number: string
          raw_payload: Json | null
          source: string | null
          updated_at: string
          verified_at: string | null
          vin: string | null
        }
        Insert: {
          certificate_issue_date?: string | null
          certificate_status?: string | null
          certificate_expiry?: string | null
          created_at?: string
          is_self_contained?: boolean
          logo_url?: string | null
          max_occupants?: number | null
          notes?: string | null
          plate_number: string
          raw_payload?: Json | null
          source?: string | null
          updated_at?: string
          verified_at?: string | null
          vin?: string | null
        }
        Update: {
          certificate_issue_date?: string | null
          certificate_status?: string | null
          certificate_expiry?: string | null
          created_at?: string
          is_self_contained?: boolean
          logo_url?: string | null
          max_occupants?: number | null
          notes?: string | null
          plate_number?: string
          raw_payload?: Json | null
          source?: string | null
          updated_at?: string
          verified_at?: string | null
          vin?: string | null
        }
        Relationships: []
      }
      canonical_persons: {
        Row: {
          id: string
          organization_id: string | null
          first_name: string | null
          last_name: string | null
          full_name: string | null
          date_of_birth: string | null
          gender: string | null
          ethnicity: string | null
          nationality: string | null
          height_cm: number | null
          weight_kg: number | null
          distinguishing_features: string | null
          description: string | null
          identity_status: 'identified' | 'partial' | 'unknown'
          is_minor: boolean
          photo_retention_justification: string | null
          profile_photo_url: string | null
          profile_photo_embedding: number[] | null
          profile_photo_updated_at: string | null
          profile_embedding_quality: number | null
          contact_email: string | null
          contact_phone: string | null
          address: string | null
          address_verified: boolean | null
          is_poi: boolean
          is_trespassed: boolean
          is_banned: boolean
          is_flagged: boolean
          flagged_priority: 'low' | 'medium' | 'high' | 'critical' | null
          flagged_reason: string | null
          flagged_notes: string | null
          flagged_at: string | null
          flagged_by: string | null
          access_allowed: boolean | null
          access_clearance_level: 'public' | 'restricted' | 'confidential' | 'secret' | 'top_secret' | null
          access_badge_number: string | null
          access_notes: string | null
          risk_level: 'low' | 'medium' | 'high' | 'critical' | null
          risk_category: 'violence' | 'aggression' | 'weapon' | 'other_safety' | null
          zone_restricted: boolean
          zone_ids: string[] | null
          privacy_notice_given: boolean | null
          privacy_lawful_purpose: string | null
          collection_authority: string | null
          expiry_date: string | null
          user_profile_id: string | null
          total_interactions: number
          first_seen_at: string | null
          last_seen_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          notes: string | null
          homeless_status: string | null
          homeless_confirmed_at: string | null
          homeless_confirmed_by: string | null
        }
        Insert: {
          id?: string
          organization_id?: string | null
          first_name?: string | null
          last_name?: string | null
          full_name?: string | null
          date_of_birth?: string | null
          gender?: string | null
          ethnicity?: string | null
          nationality?: string | null
          height_cm?: number | null
          weight_kg?: number | null
          distinguishing_features?: string | null
          description?: string | null
          identity_status?: 'identified' | 'partial' | 'unknown'
          is_minor?: boolean
          photo_retention_justification?: string | null
          profile_photo_url?: string | null
          profile_photo_embedding?: number[] | null
          profile_photo_updated_at?: string | null
          profile_embedding_quality?: number | null
          contact_email?: string | null
          contact_phone?: string | null
          address?: string | null
          address_verified?: boolean | null
          is_poi?: boolean
          is_trespassed?: boolean
          is_banned?: boolean
          is_flagged?: boolean
          flagged_priority?: 'low' | 'medium' | 'high' | 'critical' | null
          flagged_reason?: string | null
          flagged_notes?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          access_allowed?: boolean | null
          access_clearance_level?: 'public' | 'restricted' | 'confidential' | 'secret' | 'top_secret' | null
          access_badge_number?: string | null
          access_notes?: string | null
          risk_level?: 'low' | 'medium' | 'high' | 'critical' | null
          risk_category?: 'violence' | 'aggression' | 'weapon' | 'other_safety' | null
          zone_restricted?: boolean
          zone_ids?: string[] | null
          privacy_notice_given?: boolean | null
          privacy_lawful_purpose?: string | null
          collection_authority?: string | null
          expiry_date?: string | null
          user_profile_id?: string | null
          total_interactions?: number
          first_seen_at?: string | null
          last_seen_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          notes?: string | null
          homeless_status?: string | null
          homeless_confirmed_at?: string | null
          homeless_confirmed_by?: string | null
        }
        Update: {
          id?: string
          organization_id?: string | null
          first_name?: string | null
          last_name?: string | null
          full_name?: string | null
          date_of_birth?: string | null
          gender?: string | null
          ethnicity?: string | null
          nationality?: string | null
          height_cm?: number | null
          weight_kg?: number | null
          distinguishing_features?: string | null
          description?: string | null
          identity_status?: 'identified' | 'partial' | 'unknown'
          is_minor?: boolean
          photo_retention_justification?: string | null
          profile_photo_url?: string | null
          profile_photo_embedding?: number[] | null
          profile_photo_updated_at?: string | null
          profile_embedding_quality?: number | null
          contact_email?: string | null
          contact_phone?: string | null
          address?: string | null
          address_verified?: boolean | null
          is_poi?: boolean
          is_trespassed?: boolean
          is_banned?: boolean
          is_flagged?: boolean
          flagged_priority?: 'low' | 'medium' | 'high' | 'critical' | null
          flagged_reason?: string | null
          flagged_notes?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          access_allowed?: boolean | null
          access_clearance_level?: 'public' | 'restricted' | 'confidential' | 'secret' | 'top_secret' | null
          access_badge_number?: string | null
          access_notes?: string | null
          risk_level?: 'low' | 'medium' | 'high' | 'critical' | null
          risk_category?: 'violence' | 'aggression' | 'weapon' | 'other_safety' | null
          zone_restricted?: boolean
          zone_ids?: string[] | null
          privacy_notice_given?: boolean | null
          privacy_lawful_purpose?: string | null
          collection_authority?: string | null
          expiry_date?: string | null
          user_profile_id?: string | null
          total_interactions?: number
          first_seen_at?: string | null
          last_seen_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          notes?: string | null
          homeless_status?: string | null
          homeless_confirmed_at?: string | null
          homeless_confirmed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "canonical_persons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_persons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_persons_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      canonical_person_zones: {
        Row: {
          id: string
          person_id: string
          zone_id: string
          organization_id: string
          scope_type: 'trespass' | 'banned' | 'poi' | 'access_control' | 'flagged' | 'welfare'
          is_active: boolean
          notes: string | null
          added_by: string | null
          added_at: string
          expires_at: string | null
        }
        Insert: {
          id?: string
          person_id: string
          zone_id: string
          organization_id: string
          scope_type?: 'trespass' | 'banned' | 'poi' | 'access_control' | 'flagged' | 'welfare'
          is_active?: boolean
          notes?: string | null
          added_by?: string | null
          added_at?: string
          expires_at?: string | null
        }
        Update: {
          id?: string
          person_id?: string
          zone_id?: string
          organization_id?: string
          scope_type?: 'trespass' | 'banned' | 'poi' | 'access_control' | 'flagged' | 'welfare'
          is_active?: boolean
          notes?: string | null
          added_by?: string | null
          added_at?: string
          expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "canonical_person_zones_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "canonical_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_person_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_person_zones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      checkpoint_visits: {
        Row: {
          checkpoint_id: string
          created_at: string
          gps_accuracy: number | null
          gps_distance_from_checkpoint: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          notes: string | null
          officer_id: string
          organization_id: string
          patrol_id: string | null
          scan_method: string
          visited_at: string
          within_radius: boolean | null
        }
        Insert: {
          checkpoint_id: string
          created_at?: string
          gps_accuracy?: number | null
          gps_distance_from_checkpoint?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          notes?: string | null
          officer_id: string
          organization_id: string
          patrol_id?: string | null
          scan_method: string
          visited_at?: string
          within_radius?: boolean | null
        }
        Update: {
          checkpoint_id?: string
          created_at?: string
          gps_accuracy?: number | null
          gps_distance_from_checkpoint?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          notes?: string | null
          officer_id?: string
          organization_id?: string
          patrol_id?: string | null
          scan_method?: string
          visited_at?: string
          within_radius?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "checkpoint_visits_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "patrol_checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkpoint_visits_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkpoint_visits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkpoint_visits_patrol_id_fkey"
            columns: ["patrol_id"]
            isOneToOne: false
            referencedRelation: "patrols"
            referencedColumns: ["id"]
          },
        ]
      }
      client_sites: {
        Row: {
          access_instructions: string | null
          address: string | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          default_charge_rate: number | null
          default_pay_rate: number | null
          default_response_minutes: number | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          geofence_radius_metres: number
          gps_lat: number | null
          gps_lng: number | null
          hazards: string | null
          id: string
          invoice_frequency: string | null
          is_active: boolean
          m365_contract_ref: string | null
          m365_cost_centre: string | null
          m365_customer_id: string | null
          name: string
          notes: string | null
          organization_id: string
          overtime_pay_multiplier: number | null
          priority_override: string | null
          purchase_order_number: string | null
          site_code: string | null
          site_type: string
          special_instructions: string | null
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          access_instructions?: string | null
          address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          default_charge_rate?: number | null
          default_pay_rate?: number | null
          default_response_minutes?: number | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          geofence_radius_metres?: number
          gps_lat?: number | null
          gps_lng?: number | null
          hazards?: string | null
          id?: string
          invoice_frequency?: string | null
          is_active?: boolean
          m365_contract_ref?: string | null
          m365_cost_centre?: string | null
          m365_customer_id?: string | null
          name: string
          notes?: string | null
          organization_id: string
          overtime_pay_multiplier?: number | null
          priority_override?: string | null
          purchase_order_number?: string | null
          site_code?: string | null
          site_type?: string
          special_instructions?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          access_instructions?: string | null
          address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          default_charge_rate?: number | null
          default_pay_rate?: number | null
          default_response_minutes?: number | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          geofence_radius_metres?: number
          gps_lat?: number | null
          gps_lng?: number | null
          hazards?: string | null
          id?: string
          invoice_frequency?: string | null
          is_active?: boolean
          m365_contract_ref?: string | null
          m365_cost_centre?: string | null
          m365_customer_id?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          overtime_pay_multiplier?: number | null
          priority_override?: string | null
          purchase_order_number?: string | null
          site_code?: string | null
          site_type?: string
          special_instructions?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_sites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_sites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_sites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_sites_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "client_sites_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      contractor_documents: {
        Row: {
          created_at: string
          document_name: string
          document_type: string
          document_url: string
          expiry_date: string | null
          file_size_bytes: number | null
          id: string
          is_current: boolean
          mime_type: string | null
          notes: string | null
          organization_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          document_name: string
          document_type: string
          document_url: string
          expiry_date?: string | null
          file_size_bytes?: number | null
          id?: string
          is_current?: boolean
          mime_type?: string | null
          notes?: string | null
          organization_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          document_name?: string
          document_type?: string
          document_url?: string
          expiry_date?: string | null
          file_size_bytes?: number | null
          id?: string
          is_current?: boolean
          mime_type?: string | null
          notes?: string | null
          organization_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "contractor_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_profiles: {
        Row: {
          accounts_email: string | null
          accounts_name: string | null
          accounts_phone: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contact_role: string | null
          created_at: string
          guard_rate_per_hour: number | null
          hs_policy_expiry: string | null
          hs_policy_verified: boolean
          id: string
          insurance_expiry: string | null
          insurance_verified: boolean
          long_term_definition: string | null
          long_term_min_days: number | null
          long_term_rate_per_hour: number | null
          notes: string | null
          organization_id: string
          service_agreement_expiry: string | null
          service_agreement_signed: boolean
          short_notice_rate_per_hour: number | null
          standby_rate_per_hour: number | null
          travel_rate_per_km: number | null
          updated_at: string
        }
        Insert: {
          accounts_email?: string | null
          accounts_name?: string | null
          accounts_phone?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_role?: string | null
          created_at?: string
          guard_rate_per_hour?: number | null
          hs_policy_expiry?: string | null
          hs_policy_verified?: boolean
          id?: string
          insurance_expiry?: string | null
          insurance_verified?: boolean
          long_term_definition?: string | null
          long_term_min_days?: number | null
          long_term_rate_per_hour?: number | null
          notes?: string | null
          organization_id: string
          service_agreement_expiry?: string | null
          service_agreement_signed?: boolean
          short_notice_rate_per_hour?: number | null
          standby_rate_per_hour?: number | null
          travel_rate_per_km?: number | null
          updated_at?: string
        }
        Update: {
          accounts_email?: string | null
          accounts_name?: string | null
          accounts_phone?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_role?: string | null
          created_at?: string
          guard_rate_per_hour?: number | null
          hs_policy_expiry?: string | null
          hs_policy_verified?: boolean
          id?: string
          insurance_expiry?: string | null
          insurance_verified?: boolean
          long_term_definition?: string | null
          long_term_min_days?: number | null
          long_term_rate_per_hour?: number | null
          notes?: string | null
          organization_id?: string
          service_agreement_expiry?: string | null
          service_agreement_signed?: boolean
          short_notice_rate_per_hour?: number | null
          standby_rate_per_hour?: number | null
          travel_rate_per_km?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      dispatch_resources: {
        Row: {
          id: string
          organization_id: string
          callsign: string
          name: string
          description: string | null
          resource_kind: string
          base_loi_id: string | null
          active_days: number[] | null
          default_shift: string | null
          default_start_time: string | null
          default_end_time: string | null
          scheduling_enabled: boolean
          auto_dispatch_enabled: boolean
          app_queue_id: string | null
          sms_number: string | null
          email_address: string | null
          patrol_route_id: string | null
          color: string | null
          icon: string | null
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          callsign: string
          name: string
          description?: string | null
          resource_kind?: string
          base_loi_id?: string | null
          active_days?: number[] | null
          default_shift?: string | null
          default_start_time?: string | null
          default_end_time?: string | null
          scheduling_enabled?: boolean
          auto_dispatch_enabled?: boolean
          app_queue_id?: string | null
          sms_number?: string | null
          email_address?: string | null
          patrol_route_id?: string | null
          color?: string | null
          icon?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          callsign?: string
          name?: string
          description?: string | null
          resource_kind?: string
          base_loi_id?: string | null
          active_days?: number[] | null
          default_shift?: string | null
          default_start_time?: string | null
          default_end_time?: string | null
          scheduling_enabled?: boolean
          auto_dispatch_enabled?: boolean
          app_queue_id?: string | null
          sms_number?: string | null
          email_address?: string | null
          patrol_route_id?: string | null
          color?: string | null
          icon?: string | null
          is_active?: boolean
          created_by?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "dispatch_resources_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "dispatch_resources_base_loi_id_fkey"; columns: ["base_loi_id"]; isOneToOne: false; referencedRelation: "locations_of_interest"; referencedColumns: ["id"] },
          { foreignKeyName: "dispatch_resources_patrol_route_id_fkey"; columns: ["patrol_route_id"]; isOneToOne: false; referencedRelation: "patrol_routes"; referencedColumns: ["id"] },
        ]
      }
      locations_of_interest: {
        Row: {
          id: string
          organization_id: string
          name: string | null
          description: string | null
          loi_kind: string
          address_line1: string | null
          address_line2: string | null
          suburb: string | null
          city: string | null
          region: string | null
          postcode: string | null
          country: string
          address_full: string | null
          display_address: string | null
          gps_lat: number | null
          gps_lng: number | null
          geo_zone_ids: string[] | null
          geofence_geometry: string | null
          canonical_loi_id: string | null
          is_canonical: boolean
          hazard_summary: string | null
          access_summary: string | null
          geocoded_at: string | null
          geocoder_source: string | null
          geocoder_confidence: number | null
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name?: string | null
          description?: string | null
          loi_kind?: string
          address_line1?: string | null
          address_line2?: string | null
          suburb?: string | null
          city?: string | null
          region?: string | null
          postcode?: string | null
          country?: string
          address_full?: string | null
          display_address?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          geo_zone_ids?: string[] | null
          geofence_geometry?: string | null
          canonical_loi_id?: string | null
          is_canonical?: boolean
          hazard_summary?: string | null
          access_summary?: string | null
          geocoded_at?: string | null
          geocoder_source?: string | null
          geocoder_confidence?: number | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string | null
          description?: string | null
          loi_kind?: string
          address_line1?: string | null
          address_line2?: string | null
          suburb?: string | null
          city?: string | null
          region?: string | null
          postcode?: string | null
          country?: string
          address_full?: string | null
          display_address?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          geo_zone_ids?: string[] | null
          geofence_geometry?: string | null
          canonical_loi_id?: string | null
          is_canonical?: boolean
          hazard_summary?: string | null
          access_summary?: string | null
          geocoded_at?: string | null
          geocoder_source?: string | null
          geocoder_confidence?: number | null
          is_active?: boolean
          created_by?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "locations_of_interest_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "locations_of_interest_canonical_loi_id_fkey"; columns: ["canonical_loi_id"]; isOneToOne: false; referencedRelation: "locations_of_interest"; referencedColumns: ["id"] },
        ]
      }
      zone_dispatch_resource_rules: {
        Row: {
          id: string
          organization_id: string
          zone_id: string
          dispatch_resource_id: string
          job_type_code: string | null
          day_of_week: number | null
          time_from: string | null
          time_to: string | null
          priority: number
          is_active: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          zone_id: string
          dispatch_resource_id: string
          job_type_code?: string | null
          day_of_week?: number | null
          time_from?: string | null
          time_to?: string | null
          priority?: number
          is_active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          zone_id?: string
          dispatch_resource_id?: string
          job_type_code?: string | null
          day_of_week?: number | null
          time_from?: string | null
          time_to?: string | null
          priority?: number
          is_active?: boolean
          created_by?: string | null
        }
        Relationships: [
          { foreignKeyName: "zone_dispatch_resource_rules_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "zone_dispatch_resource_rules_zone_id_fkey"; columns: ["zone_id"]; isOneToOne: false; referencedRelation: "zones"; referencedColumns: ["id"] },
          { foreignKeyName: "zone_dispatch_resource_rules_dispatch_resource_id_fkey"; columns: ["dispatch_resource_id"]; isOneToOne: false; referencedRelation: "dispatch_resources"; referencedColumns: ["id"] },
        ]
      }
      case_comments: {
        Row: {
          author_id: string
          case_id: string
          comment_text: string
          created_at: string
          edited_by: string | null
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          case_id: string
          comment_text: string
          created_at?: string
          edited_by?: string | null
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          case_id?: string
          comment_text?: string
          created_at?: string
          edited_by?: string | null
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "case_comments_author_id_fkey"; columns: ["author_id"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "case_comments_case_id_fkey"; columns: ["case_id"]; isOneToOne: false; referencedRelation: "operational_cases"; referencedColumns: ["id"] },
          { foreignKeyName: "case_comments_edited_by_fkey"; columns: ["edited_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "case_comments_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      dispatch_events: {
        Row: {
          assigned_to: string | null
          case_id: string
          created_at: string
          created_by: string | null
          dispatch_job_id: string
          escalation_level_at_event: number | null
          event_timestamp: string
          event_type: string
          id: string
          notes: string | null
          organization_id: string
          status: string
          status_at_event: string | null
          triggered_by: string | null
        }
        Insert: {
          assigned_to?: string | null
          case_id: string
          created_at?: string
          created_by?: string | null
          dispatch_job_id: string
          escalation_level_at_event?: number | null
          event_timestamp?: string
          event_type?: string
          id?: string
          notes?: string | null
          organization_id: string
          status?: string
          status_at_event?: string | null
          triggered_by?: string | null
        }
        Update: {
          assigned_to?: string | null
          case_id?: string
          created_at?: string
          created_by?: string | null
          dispatch_job_id?: string
          escalation_level_at_event?: number | null
          event_timestamp?: string
          event_type?: string
          id?: string
          notes?: string | null
          organization_id?: string
          status?: string
          status_at_event?: string | null
          triggered_by?: string | null
        }
        Relationships: [
          { foreignKeyName: "dispatch_events_assigned_to_fkey"; columns: ["assigned_to"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "dispatch_events_case_id_fkey"; columns: ["case_id"]; isOneToOne: false; referencedRelation: "operational_cases"; referencedColumns: ["id"] },
          { foreignKeyName: "dispatch_events_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "dispatch_events_dispatch_job_id_fkey"; columns: ["dispatch_job_id"]; isOneToOne: false; referencedRelation: "dispatch_jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "dispatch_events_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "dispatch_events_triggered_by_fkey"; columns: ["triggered_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
        ]
      }
      dispatch_jobs: {
        Row: {
          acknowledged_at: string | null
          address: string | null
          assigned_to: string | null
          breach_alert_id: string | null
          caller_name: string | null
          caller_phone: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          client_site_id: string | null
          completed_at: string | null
          completion_notes: string | null
          completion_photo_urls: string[] | null
          created_at: string
          created_by: string | null
          description: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          en_route_at: string | null
          escalated_at: string | null
          escalation_level: number
          gps_lat: number | null
          gps_lng: number | null
          id: string
          investigation_job_id: string | null
          job_number: string | null
          job_type: string
          on_scene_at: string | null
          organization_id: string
          priority: string
          response_sla_minutes: number | null
          sla_breached: boolean
          status: string
          title: string
          updated_at: string
          zone_id: string | null
          case_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          address?: string | null
          assigned_to?: string | null
          breach_alert_id?: string | null
          caller_name?: string | null
          caller_phone?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_site_id?: string | null
          completed_at?: string | null
          completion_notes?: string | null
          completion_photo_urls?: string[] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          en_route_at?: string | null
          escalated_at?: string | null
          escalation_level?: number
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          investigation_job_id?: string | null
          job_number?: string | null
          job_type?: string
          on_scene_at?: string | null
          organization_id: string
          priority?: string
          response_sla_minutes?: number | null
          sla_breached?: boolean
          status?: string
          title: string
          updated_at?: string
          zone_id?: string | null
          case_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          address?: string | null
          assigned_to?: string | null
          breach_alert_id?: string | null
          caller_name?: string | null
          caller_phone?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_site_id?: string | null
          completed_at?: string | null
          completion_notes?: string | null
          completion_photo_urls?: string[] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          en_route_at?: string | null
          escalated_at?: string | null
          escalation_level?: number
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          investigation_job_id?: string | null
          job_number?: string | null
          job_type?: string
          on_scene_at?: string | null
          organization_id?: string
          priority?: string
          response_sla_minutes?: number | null
          sla_breached?: boolean
          status?: string
          title?: string
          updated_at?: string
          zone_id?: string | null
          case_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "dispatch_jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_breach_alert_id_fkey"
            columns: ["breach_alert_id"]
            isOneToOne: false
            referencedRelation: "breach_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_client_site_id_fkey"
            columns: ["client_site_id"]
            isOneToOne: false
            referencedRelation: "client_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "dispatch_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "dispatch_jobs_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_investigation_job_id_fkey"
            columns: ["investigation_job_id"]
            isOneToOne: false
            referencedRelation: "investigation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "dispatch_jobs_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "operational_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_acknowledgement_log: {
        Row: {
          acknowledged_at: string
          callsign: string | null
          case_id: string
          created_at: string
          dispatch_job_id: string
          eta_seconds: number | null
          id: string
          lifecycle_stage: 'assigned' | 'acknowledged' | 'en_route' | 'on_scene' | 'completed' | 'cancelled'
          notes: string | null
          officer_id: string | null
          organization_id: string
        }
        Insert: {
          acknowledged_at?: string
          callsign?: string | null
          case_id: string
          created_at?: string
          dispatch_job_id: string
          eta_seconds?: number | null
          id?: string
          lifecycle_stage?: 'assigned' | 'acknowledged' | 'en_route' | 'on_scene' | 'completed' | 'cancelled'
          notes?: string | null
          officer_id?: string | null
          organization_id: string
        }
        Update: {
          acknowledged_at?: string
          callsign?: string | null
          case_id?: string
          created_at?: string
          dispatch_job_id?: string
          eta_seconds?: number | null
          id?: string
          lifecycle_stage?: 'assigned' | 'acknowledged' | 'en_route' | 'on_scene' | 'completed' | 'cancelled'
          notes?: string | null
          officer_id?: string | null
          organization_id?: string
        }
        Relationships: [
          { foreignKeyName: "dispatch_acknowledgement_log_case_id_fkey"; columns: ["case_id"]; isOneToOne: false; referencedRelation: "operational_cases"; referencedColumns: ["id"] },
          { foreignKeyName: "dispatch_acknowledgement_log_dispatch_job_id_fkey"; columns: ["dispatch_job_id"]; isOneToOne: false; referencedRelation: "dispatch_jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "dispatch_acknowledgement_log_officer_id_fkey"; columns: ["officer_id"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "dispatch_acknowledgement_log_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      enforcement_events: {
        Row: {
          action_taken: string | null
          case_id: string
          created_at: string
          created_by: string | null
          evidence_notes: string | null
          event_timestamp: string
          event_type: string
          id: string
          officer_id: string
          organization_id: string
          outcome: string | null
          photo_urls: string[] | null
          status: string
          subject_identifier: string | null
          subject_type: string | null
          updated_at: string
          violation_type: string | null
        }
        Insert: {
          action_taken?: string | null
          case_id: string
          created_at?: string
          created_by?: string | null
          evidence_notes?: string | null
          event_timestamp?: string
          event_type?: string
          id?: string
          officer_id: string
          organization_id: string
          outcome?: string | null
          photo_urls?: string[] | null
          status?: string
          subject_identifier?: string | null
          subject_type?: string | null
          updated_at?: string
          violation_type?: string | null
        }
        Update: {
          action_taken?: string | null
          case_id?: string
          created_at?: string
          created_by?: string | null
          evidence_notes?: string | null
          event_timestamp?: string
          event_type?: string
          id?: string
          officer_id?: string
          organization_id?: string
          outcome?: string | null
          photo_urls?: string[] | null
          status?: string
          subject_identifier?: string | null
          subject_type?: string | null
          updated_at?: string
          violation_type?: string | null
        }
        Relationships: [
          { foreignKeyName: "enforcement_events_case_id_fkey"; columns: ["case_id"]; isOneToOne: false; referencedRelation: "operational_cases"; referencedColumns: ["id"] },
          { foreignKeyName: "enforcement_events_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "enforcement_events_officer_id_fkey"; columns: ["officer_id"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "enforcement_events_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      operational_cases: {
        Row: {
          case_number: string | null
          case_type: string
          closed_at: string | null
          created_at: string
          created_by: string | null
          created_from: string
          dispatch_job_id: string | null
          id: string
          officer_notes: string | null
          organization_id: string
          status: string
          summary: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          case_number?: string | null
          case_type?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_from?: string
          dispatch_job_id?: string | null
          id?: string
          officer_notes?: string | null
          organization_id: string
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          case_number?: string | null
          case_type?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_from?: string
          dispatch_job_id?: string | null
          id?: string
          officer_notes?: string | null
          organization_id?: string
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "operational_cases_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "operational_cases_dispatch_job_id_fkey"; columns: ["dispatch_job_id"]; isOneToOne: false; referencedRelation: "dispatch_jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "operational_cases_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      patrol_events: {
        Row: {
          case_id: string
          created_at: string
          created_by: string | null
          event_timestamp: string
          event_type: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          observation_text: string | null
          officer_id: string
          organization_id: string
          patrol_type: string | null
          photo_urls: string[] | null
          status: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by?: string | null
          event_timestamp?: string
          event_type?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          observation_text?: string | null
          officer_id: string
          organization_id: string
          patrol_type?: string | null
          photo_urls?: string[] | null
          status?: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string | null
          event_timestamp?: string
          event_type?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          observation_text?: string | null
          officer_id?: string
          organization_id?: string
          patrol_type?: string | null
          photo_urls?: string[] | null
          status?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          { foreignKeyName: "patrol_events_case_id_fkey"; columns: ["case_id"]; isOneToOne: false; referencedRelation: "operational_cases"; referencedColumns: ["id"] },
          { foreignKeyName: "patrol_events_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "patrol_events_officer_id_fkey"; columns: ["officer_id"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "patrol_events_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "patrol_events_zone_id_fkey"; columns: ["zone_id"]; isOneToOne: false; referencedRelation: "zones"; referencedColumns: ["id"] },
        ]
      }
      patrol_session_events: {
        Row: {
          case_id: string
          checkpoint_name: string | null
          created_at: string
          event_time: string
          event_type: 'patrol_started' | 'checkpoint_scan' | 'checkpoint_missed' | 'patrol_completed'
          id: string
          notes: string | null
          officer_id: string
          organization_id: string
          patrol_route_instance_id: string | null
        }
        Insert: {
          case_id: string
          checkpoint_name?: string | null
          created_at?: string
          event_time?: string
          event_type?: 'patrol_started' | 'checkpoint_scan' | 'checkpoint_missed' | 'patrol_completed'
          id?: string
          notes?: string | null
          officer_id: string
          organization_id: string
          patrol_route_instance_id?: string | null
        }
        Update: {
          case_id?: string
          checkpoint_name?: string | null
          created_at?: string
          event_time?: string
          event_type?: 'patrol_started' | 'checkpoint_scan' | 'checkpoint_missed' | 'patrol_completed'
          id?: string
          notes?: string | null
          officer_id?: string
          organization_id?: string
          patrol_route_instance_id?: string | null
        }
        Relationships: [
          { foreignKeyName: "patrol_session_events_case_id_fkey"; columns: ["case_id"]; isOneToOne: false; referencedRelation: "operational_cases"; referencedColumns: ["id"] },
          { foreignKeyName: "patrol_session_events_officer_id_fkey"; columns: ["officer_id"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "patrol_session_events_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      dispute_intake: {
        Row: {
          admin_notes: string | null
          assigned_to: string | null
          claimant_email: string | null
          claimant_name: string | null
          claimant_phone: string | null
          evidence_statement: string | null
          hardship_context: string | null
          id: string
          message: string
          organization_id: string | null
          plate_number: string | null
          request_homeless_review: boolean
          source_reference: string | null
          source_type: string
          status: string
          submitted_at: string
          submitted_via: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          assigned_to?: string | null
          claimant_email?: string | null
          claimant_name?: string | null
          claimant_phone?: string | null
          evidence_statement?: string | null
          hardship_context?: string | null
          id?: string
          message: string
          organization_id?: string | null
          plate_number?: string | null
          request_homeless_review?: boolean
          source_reference?: string | null
          source_type: string
          status?: string
          submitted_at?: string
          submitted_via?: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          assigned_to?: string | null
          claimant_email?: string | null
          claimant_name?: string | null
          claimant_phone?: string | null
          evidence_statement?: string | null
          hardship_context?: string | null
          id?: string
          message?: string
          organization_id?: string | null
          plate_number?: string | null
          request_homeless_review?: boolean
          source_reference?: string | null
          source_type?: string
          status?: string
          submitted_at?: string
          submitted_via?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispute_intake_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "dispute_intake_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_intake_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_intake_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_intake_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "dispute_intake_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      ems_attendances: {
        Row: {
          action: string
          admin_notes: string | null
          approved_at: string | null
          approved_by: string | null
          attendance_address: string | null
          attendance_date: string
          billable_hours: number | null
          created_at: string
          device_serial: string | null
          device_type: string | null
          district: string | null
          end_time: string | null
          id: string
          notes: string | null
          offender_ref: string | null
          officer_id: string
          officer_seniority_level: number
          officer_shift_id: string | null
          organization_id: string
          rate_per_hour: number | null
          roster_shift_id: string | null
          start_time: string | null
          status: string
          travel_km: number | null
          travel_rate_per_km: number | null
          updated_at: string
        }
        Insert: {
          action: string
          admin_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attendance_address?: string | null
          attendance_date?: string
          billable_hours?: number | null
          created_at?: string
          device_serial?: string | null
          device_type?: string | null
          district?: string | null
          end_time?: string | null
          id?: string
          notes?: string | null
          offender_ref?: string | null
          officer_id: string
          officer_seniority_level?: number
          officer_shift_id?: string | null
          organization_id: string
          rate_per_hour?: number | null
          roster_shift_id?: string | null
          start_time?: string | null
          status?: string
          travel_km?: number | null
          travel_rate_per_km?: number | null
          updated_at?: string
        }
        Update: {
          action?: string
          admin_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attendance_address?: string | null
          attendance_date?: string
          billable_hours?: number | null
          created_at?: string
          device_serial?: string | null
          device_type?: string | null
          district?: string | null
          end_time?: string | null
          id?: string
          notes?: string | null
          offender_ref?: string | null
          officer_id?: string
          officer_seniority_level?: number
          officer_shift_id?: string | null
          organization_id?: string
          rate_per_hour?: number | null
          roster_shift_id?: string | null
          start_time?: string | null
          status?: string
          travel_km?: number | null
          travel_rate_per_km?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ems_attendances_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ems_attendances_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ems_attendances_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ems_attendances_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ems_attendances_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ems_attendances_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ems_attendances_officer_shift_id_fkey"
            columns: ["officer_shift_id"]
            isOneToOne: false
            referencedRelation: "officer_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ems_attendances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ems_attendances_roster_shift_id_fkey"
            columns: ["roster_shift_id"]
            isOneToOne: false
            referencedRelation: "roster_shifts"
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      face_records: {
        Row: {
          created_at: string
          detection_method: string | null
          embedding: number[] | null
          embedding_quality: number | null
          face_count: number
          faces: Json
          id: string
          incident_id: string | null
          label: string | null
          latitude: number | null
          longitude: number | null
          notes: string | null
          observation_id: string | null
          officer_id: string | null
          organization_id: string
          person_record_id: string | null
          photo_path: string | null
          photo_url: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          detection_method?: string | null
          embedding?: number[] | null
          embedding_quality?: number | null
          face_count?: number
          faces?: Json
          id?: string
          incident_id?: string | null
          label?: string | null
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          observation_id?: string | null
          officer_id?: string | null
          organization_id: string
          person_record_id?: string | null
          photo_path?: string | null
          photo_url: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          detection_method?: string | null
          embedding?: number[] | null
          embedding_quality?: number | null
          face_count?: number
          faces?: Json
          id?: string
          incident_id?: string | null
          label?: string | null
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          observation_id?: string | null
          officer_id?: string | null
          organization_id?: string
          person_record_id?: string | null
          photo_path?: string | null
          photo_url?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "face_records_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_records_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_records_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "recent_observations_photo_status"
            referencedColumns: ["observation_id"]
          },
          {
            foreignKeyName: "face_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_records_person_record_id_fkey"
            columns: ["person_record_id"]
            isOneToOne: false
            referencedRelation: "person_records"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          allowed_org_ids: string[] | null
          allowed_user_ids: string[] | null
          canary_error_rate_threshold: number | null
          canary_p95_latency_threshold_ms: number | null
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          id: string
          modified_by: string | null
          name: string
          phase: 'A' | 'B' | 'C' | 'D' | 'E' | null
          rollout_percentage: number
          rollout_strategy: 'percentage' | 'user_list' | 'org_list' | 'gradual'
          updated_at: string
        }
        Insert: {
          allowed_org_ids?: string[] | null
          allowed_user_ids?: string[] | null
          canary_error_rate_threshold?: number | null
          canary_p95_latency_threshold_ms?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          modified_by?: string | null
          name: string
          phase?: 'A' | 'B' | 'C' | 'D' | 'E' | null
          rollout_percentage?: number
          rollout_strategy?: 'percentage' | 'user_list' | 'org_list' | 'gradual'
          updated_at?: string
        }
        Update: {
          allowed_org_ids?: string[] | null
          allowed_user_ids?: string[] | null
          canary_error_rate_threshold?: number | null
          canary_p95_latency_threshold_ms?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          modified_by?: string | null
          name?: string
          phase?: 'A' | 'B' | 'C' | 'D' | 'E' | null
          rollout_percentage?: number
          rollout_strategy?: 'percentage' | 'user_list' | 'org_list' | 'gradual'
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "feature_flags_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "feature_flags_modified_by_fkey"; columns: ["modified_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
        ]
      }
      feature_flag_evaluations: {
        Row: {
          created_by: string | null
          enabled: boolean
          evaluation_context: Json | null
          evaluated_at: string
          flag_id: string
          id: string
          organization_id: string | null
          rollout_bucket: number | null
          user_id: string | null
        }
        Insert: {
          created_by?: string | null
          enabled?: boolean
          evaluation_context?: Json | null
          evaluated_at?: string
          flag_id: string
          id?: string
          organization_id?: string | null
          rollout_bucket?: number | null
          user_id?: string | null
        }
        Update: {
          created_by?: string | null
          enabled?: boolean
          evaluation_context?: Json | null
          evaluated_at?: string
          flag_id?: string
          id?: string
          organization_id?: string | null
          rollout_bucket?: number | null
          user_id?: string | null
        }
        Relationships: [
          { foreignKeyName: "feature_flag_evaluations_flag_id_fkey"; columns: ["flag_id"]; isOneToOne: false; referencedRelation: "feature_flags"; referencedColumns: ["id"] },
          { foreignKeyName: "feature_flag_evaluations_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "feature_flag_evaluations_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
        ]
      }
      feature_flag_rollout_history: {
        Row: {
          change_reason: string | null
          changed_at: string
          changed_by: string | null
          created_at: string
          error_rate_at_change: number | null
          flag_id: string
          from_percentage: number
          id: string
          monitoring_notes: string | null
          p95_latency_at_change_ms: number | null
          stage: string | null
          to_percentage: number
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string
          changed_by?: string | null
          created_at?: string
          error_rate_at_change?: number | null
          flag_id: string
          from_percentage?: number
          id?: string
          monitoring_notes?: string | null
          p95_latency_at_change_ms?: number | null
          stage?: string | null
          to_percentage?: number
        }
        Update: {
          change_reason?: string | null
          changed_at?: string
          changed_by?: string | null
          created_at?: string
          error_rate_at_change?: number | null
          flag_id?: string
          from_percentage?: number
          id?: string
          monitoring_notes?: string | null
          p95_latency_at_change_ms?: number | null
          stage?: string | null
          to_percentage?: number
        }
        Relationships: [
          { foreignKeyName: "feature_flag_rollout_history_flag_id_fkey"; columns: ["flag_id"]; isOneToOne: false; referencedRelation: "feature_flags"; referencedColumns: ["id"] },
          { foreignKeyName: "feature_flag_rollout_history_changed_by_fkey"; columns: ["changed_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
        ]
      }
      fixed_cameras: {
        Row: {
          id: string
          organization_id: string
          name: string
          camera_type: string
          status: string
          latitude: number | null
          longitude: number | null
          address: string | null
          zone_id: string | null
          stream_url: string | null
          snapshot_url: string | null
          last_seen_at: string | null
          notes: string | null
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          camera_type: string
          status?: string
          latitude?: number | null
          longitude?: number | null
          address?: string | null
          zone_id?: string | null
          stream_url?: string | null
          snapshot_url?: string | null
          last_seen_at?: string | null
          notes?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          camera_type?: string
          status?: string
          latitude?: number | null
          longitude?: number | null
          address?: string | null
          zone_id?: string | null
          stream_url?: string | null
          snapshot_url?: string | null
          last_seen_at?: string | null
          notes?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      parking_payments: {
        Row: {
          id: string
          organization_id: string
          plate_number: string
          zone_id: string | null
          session_id: string | null
          amount_nzd: number
          payment_provider: string
          provider_reference: string | null
          status: string
          contact_email: string | null
          contact_phone: string | null
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          plate_number: string
          zone_id?: string | null
          session_id?: string | null
          amount_nzd: number
          payment_provider?: string
          provider_reference?: string | null
          status?: string
          contact_email?: string | null
          contact_phone?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          plate_number?: string
          zone_id?: string | null
          session_id?: string | null
          amount_nzd?: number
          payment_provider?: string
          provider_reference?: string | null
          status?: string
          contact_email?: string | null
          contact_phone?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      pricing_rules: {
        Row: {
          id: string
          organization_id: string
          zone_id: string | null
          label: string
          day_of_week: number | null
          hour_from: number | null
          hour_to: number | null
          multiplier: number
          flat_override_nzd: number | null
          is_active: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          zone_id?: string | null
          label: string
          day_of_week?: number | null
          hour_from?: number | null
          hour_to?: number | null
          multiplier?: number
          flat_override_nzd?: number | null
          is_active?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          zone_id?: string | null
          label?: string
          day_of_week?: number | null
          hour_from?: number | null
          hour_to?: number | null
          multiplier?: number
          flat_override_nzd?: number | null
          is_active?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_zone_id_fkey"
            columns: ["zone_id"]
            referencedRelation: "zones"
            referencedColumns: ["id"]
          }
        ]
      }
      lmr_bridge_config: {
        Row: {
          id: string
          organization_id: string
          label: string
          gateway_url: string
          gateway_token: string | null
          radio_channel: string
          direction: string
          is_active: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          label: string
          gateway_url: string
          gateway_token?: string | null
          radio_channel?: string
          direction?: string
          is_active?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          label?: string
          gateway_url?: string
          gateway_token?: string | null
          radio_channel?: string
          direction?: string
          is_active?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lmr_bridge_sessions: {
        Row: {
          id: string
          organization_id: string
          config_id: string
          direction: string
          radio_unit_id: string | null
          radio_unit_alias: string | null
          ptt_speaker_id: string | null
          ptt_speaker_name: string | null
          channel_id: string
          started_at: string
          ended_at: string | null
          duration_ms: number | null
          audio_url: string | null
          transcript: string | null
          is_emergency: boolean
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          config_id: string
          direction: string
          radio_unit_id?: string | null
          radio_unit_alias?: string | null
          ptt_speaker_id?: string | null
          ptt_speaker_name?: string | null
          channel_id: string
          started_at?: string
          ended_at?: string | null
          audio_url?: string | null
          transcript?: string | null
          is_emergency?: boolean
          metadata?: Json
          created_at?: string
        }
        Update: {
          ended_at?: string | null
          audio_url?: string | null
          transcript?: string | null
          is_emergency?: boolean
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lmr_bridge_sessions_config_id_fkey"
            columns: ["config_id"]
            referencedRelation: "lmr_bridge_config"
            referencedColumns: ["id"]
          }
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          person_record_id: string | null
          plate_number: string | null
          primary_evidence_url: string | null
          reported_by: string | null
          retention_hold: boolean | null
          retention_until: string | null
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
          person_record_id?: string | null
          plate_number?: string | null
          primary_evidence_url?: string | null
          reported_by?: string | null
          retention_hold?: boolean | null
          retention_until?: string | null
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
          person_record_id?: string | null
          plate_number?: string | null
          primary_evidence_url?: string | null
          reported_by?: string | null
          retention_hold?: boolean | null
          retention_until?: string | null
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
            foreignKeyName: "incidents_person_record_id_fkey"
            columns: ["person_record_id"]
            isOneToOne: false
            referencedRelation: "person_records"
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      infringement_notice_counters: {
        Row: {
          created_at: string
          last_seq: number
          organization_id: string
          updated_at: string
          year_code: string
        }
        Insert: {
          created_at?: string
          last_seq?: number
          organization_id: string
          updated_at?: string
          year_code: string
        }
        Update: {
          created_at?: string
          last_seq?: number
          organization_id?: string
          updated_at?: string
          year_code?: string
        }
        Relationships: []
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
          vehicle_make: string | null
          vehicle_model: string | null
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
          vehicle_make?: string | null
          vehicle_model?: string | null
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
          vehicle_make?: string | null
          vehicle_model?: string | null
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      noise_assessments: {
        Row: {
          action_notes: string | null
          address: string
          address_photo_url: string | null
          ai_confidence_score: number | null
          ai_rationale: string | null
          assessed_at: string
          created_at: string
          district_plan_limit_db: number | null
          exceeds_district_plan: boolean | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          measurement_location: string | null
          measurement_method: string
          noise_job_id: string | null
          noise_level_db: number | null
          noise_source: string | null
          noise_source_address: string | null
          noise_type: string | null
          officer_id: string
          organization_id: string
          persons_present: number | null
          photos: string[] | null
          recommended_action: string
          responsible_person_name: string | null
          responsible_person_warned: boolean | null
          time_category: string
          matrix_total_score: number | null
          time_score: number | null
          tone_score: number | null
          verbal_warning_given: boolean | null
          volume_score: number | null
          zone_classification: string | null
        }
        Insert: {
          action_notes?: string | null
          address: string
          address_photo_url?: string | null
          ai_confidence_score?: number | null
          ai_rationale?: string | null
          assessed_at?: string
          created_at?: string
          district_plan_limit_db?: number | null
          exceeds_district_plan?: boolean | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          matrix_total_score?: number | null
          measurement_location?: string | null
          measurement_method?: string
          noise_job_id?: string | null
          noise_level_db?: number | null
          noise_source?: string | null
          noise_source_address?: string | null
          noise_type?: string | null
          officer_id: string
          organization_id: string
          persons_present?: number | null
          photos?: string[] | null
          recommended_action?: string
          responsible_person_name?: string | null
          responsible_person_warned?: boolean | null
          time_category?: string
          time_score?: number | null
          tone_score?: number | null
          verbal_warning_given?: boolean | null
          volume_score?: number | null
          zone_classification?: string | null
        }
        Update: {
          action_notes?: string | null
          address?: string
          address_photo_url?: string | null
          ai_confidence_score?: number | null
          ai_rationale?: string | null
          assessed_at?: string
          created_at?: string
          district_plan_limit_db?: number | null
          exceeds_district_plan?: boolean | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          matrix_total_score?: number | null
          measurement_location?: string | null
          measurement_method?: string
          noise_job_id?: string | null
          noise_level_db?: number | null
          noise_source?: string | null
          noise_source_address?: string | null
          noise_type?: string | null
          officer_id?: string
          organization_id?: string
          persons_present?: number | null
          photos?: string[] | null
          recommended_action?: string
          responsible_person_name?: string | null
          responsible_person_warned?: boolean | null
          time_category?: string
          time_score?: number | null
          tone_score?: number | null
          verbal_warning_given?: boolean | null
          volume_score?: number | null
          zone_classification?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "noise_assessments_noise_job_id_fkey"
            columns: ["noise_job_id"]
            isOneToOne: false
            referencedRelation: "noise_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_assessments_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "noise_assessments_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_assessments_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_assessments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      noise_job_counters: {
        Row: {
          last_number: number
          organization_id: string
        }
        Insert: {
          last_number?: number
          organization_id: string
        }
        Update: {
          last_number?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "noise_job_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      noise_jobs: {
        Row: {
          address: string
          address_history_notes: string | null
          assigned_at: string | null
          assigned_to: string | null
          city: string | null
          complainant_ref: string | null
          complaint_description: string | null
          complaint_source: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          dispatched_by: string | null
          eta_minutes: number | null
          gps_lat: number | null
          gps_lng: number | null
          has_hs_incident: boolean
          has_permanent_end: boolean
          has_prior_abatement: boolean
          has_prior_end: boolean
          id: string
          job_number: string
          noise_type: string
          organization_id: string
          outcome: string | null
          outcome_notes: string | null
          prior_notice_count: number
          prior_notice_summary: string | null
          priority: string
          safety_notes: string | null
          status: string
          suburb: string | null
          title: string
          updated_at: string
        }
        Insert: {
          address: string
          address_history_notes?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          city?: string | null
          complainant_ref?: string | null
          complaint_description?: string | null
          complaint_source?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          dispatched_by?: string | null
          eta_minutes?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          has_hs_incident?: boolean
          has_permanent_end?: boolean
          has_prior_abatement?: boolean
          has_prior_end?: boolean
          id?: string
          job_number: string
          noise_type?: string
          organization_id: string
          outcome?: string | null
          outcome_notes?: string | null
          prior_notice_count?: number
          prior_notice_summary?: string | null
          priority?: string
          safety_notes?: string | null
          status?: string
          suburb?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          address?: string
          address_history_notes?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          city?: string | null
          complainant_ref?: string | null
          complaint_description?: string | null
          complaint_source?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          dispatched_by?: string | null
          eta_minutes?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          has_hs_incident?: boolean
          has_permanent_end?: boolean
          has_prior_abatement?: boolean
          has_prior_end?: boolean
          id?: string
          job_number?: string
          noise_type?: string
          organization_id?: string
          outcome?: string | null
          outcome_notes?: string | null
          prior_notice_count?: number
          prior_notice_summary?: string | null
          priority?: string
          safety_notes?: string | null
          status?: string
          suburb?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "noise_jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "noise_jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_jobs_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "noise_jobs_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_jobs_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_jobs_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "noise_jobs_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_jobs_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      noise_notice_counters: {
        Row: {
          last_number: number
          organization_id: string
        }
        Insert: {
          last_number?: number
          organization_id: string
        }
        Update: {
          last_number?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "noise_notice_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      noise_notices: {
        Row: {
          authority: string | null
          complied_at: string | null
          comply_by: string | null
          daily_penalty_nzd: number | null
          escalated_to: string | null
          escalation_notes: string | null
          evidence_photos: string[] | null
          id: string
          is_permanent_end: boolean
          issued_at: string
          issuing_officer_id: string | null
          issuing_officer_name: string | null
          noise_assessment_id: string | null
          noise_job_id: string | null
          notes: string | null
          notice_number: string
          notice_type: string
          offence_description: string
          organization_id: string
          pdf_url: string | null
          penalty_amount_nzd: number | null
          previous_notice_count: number
          recipient_address: string
          recipient_dob: string | null
          recipient_email: string | null
          recipient_name: string
          recipient_phone: string | null
          rma_section: string | null
          status: string
          updated_at: string
        }
        Insert: {
          authority?: string | null
          complied_at?: string | null
          comply_by?: string | null
          daily_penalty_nzd?: number | null
          escalated_to?: string | null
          escalation_notes?: string | null
          evidence_photos?: string[] | null
          id?: string
          is_permanent_end?: boolean
          issued_at?: string
          issuing_officer_id?: string | null
          issuing_officer_name?: string | null
          noise_assessment_id?: string | null
          noise_job_id?: string | null
          notes?: string | null
          notice_number: string
          notice_type: string
          offence_description: string
          organization_id: string
          pdf_url?: string | null
          penalty_amount_nzd?: number | null
          previous_notice_count?: number
          recipient_address: string
          recipient_dob?: string | null
          recipient_email?: string | null
          recipient_name: string
          recipient_phone?: string | null
          rma_section?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          authority?: string | null
          complied_at?: string | null
          comply_by?: string | null
          daily_penalty_nzd?: number | null
          escalated_to?: string | null
          escalation_notes?: string | null
          evidence_photos?: string[] | null
          id?: string
          is_permanent_end?: boolean
          issued_at?: string
          issuing_officer_id?: string | null
          issuing_officer_name?: string | null
          noise_assessment_id?: string | null
          noise_job_id?: string | null
          notes?: string | null
          notice_number?: string
          notice_type?: string
          offence_description?: string
          organization_id?: string
          pdf_url?: string | null
          penalty_amount_nzd?: number | null
          previous_notice_count?: number
          recipient_address?: string
          recipient_dob?: string | null
          recipient_email?: string | null
          recipient_name?: string
          recipient_phone?: string | null
          rma_section?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "noise_notices_issuing_officer_id_fkey"
            columns: ["issuing_officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "noise_notices_issuing_officer_id_fkey"
            columns: ["issuing_officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_notices_issuing_officer_id_fkey"
            columns: ["issuing_officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_notices_noise_assessment_id_fkey"
            columns: ["noise_assessment_id"]
            isOneToOne: false
            referencedRelation: "noise_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_notices_noise_job_id_fkey"
            columns: ["noise_job_id"]
            isOneToOne: false
            referencedRelation: "noise_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_notices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      noise_seizure_counters: {
        Row: {
          last_number: number
          organization_id: string
        }
        Insert: {
          last_number?: number
          organization_id: string
        }
        Update: {
          last_number?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "noise_seizure_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      noise_seizures: {
        Row: {
          address: string
          court_order_ref: string | null
          created_at: string
          defects_noted: string | null
          disposal_method: string | null
          equipment_condition: string | null
          equipment_count: number
          equipment_description: string
          equipment_make: string | null
          equipment_type: string | null
          estimated_value_nzd: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          identification_marks: string | null
          noise_job_id: string | null
          noise_notice_id: string | null
          notes: string | null
          organization_id: string
          owner_name: string | null
          photos: string[] | null
          police_officer_name: string | null
          police_present: boolean
          return_conditions: string | null
          return_date: string | null
          returned_to: string | null
          rma_authority: string | null
          seized_at: string
          seizing_officer_id: string | null
          seizing_officer_name: string | null
          seizure_number: string
          serial_numbers: string[] | null
          status: string
          storage_location: string | null
          storage_reference: string | null
          updated_at: string
          witness_name: string | null
        }
        Insert: {
          address: string
          court_order_ref?: string | null
          created_at?: string
          defects_noted?: string | null
          disposal_method?: string | null
          equipment_condition?: string | null
          equipment_count?: number
          equipment_description: string
          equipment_make?: string | null
          equipment_type?: string | null
          estimated_value_nzd?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          identification_marks?: string | null
          noise_job_id?: string | null
          noise_notice_id?: string | null
          notes?: string | null
          organization_id: string
          owner_name?: string | null
          photos?: string[] | null
          police_officer_name?: string | null
          police_present?: boolean
          return_conditions?: string | null
          return_date?: string | null
          returned_to?: string | null
          rma_authority?: string | null
          seized_at?: string
          seizing_officer_id?: string | null
          seizing_officer_name?: string | null
          seizure_number: string
          serial_numbers?: string[] | null
          status?: string
          storage_location?: string | null
          storage_reference?: string | null
          updated_at?: string
          witness_name?: string | null
        }
        Update: {
          address?: string
          court_order_ref?: string | null
          created_at?: string
          defects_noted?: string | null
          disposal_method?: string | null
          equipment_condition?: string | null
          equipment_count?: number
          equipment_description?: string
          equipment_make?: string | null
          equipment_type?: string | null
          estimated_value_nzd?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          identification_marks?: string | null
          noise_job_id?: string | null
          noise_notice_id?: string | null
          notes?: string | null
          organization_id?: string
          owner_name?: string | null
          photos?: string[] | null
          police_officer_name?: string | null
          police_present?: boolean
          return_conditions?: string | null
          return_date?: string | null
          returned_to?: string | null
          rma_authority?: string | null
          seized_at?: string
          seizing_officer_id?: string | null
          seizing_officer_name?: string | null
          seizure_number?: string
          serial_numbers?: string[] | null
          status?: string
          storage_location?: string | null
          storage_reference?: string | null
          updated_at?: string
          witness_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "noise_seizures_noise_job_id_fkey"
            columns: ["noise_job_id"]
            isOneToOne: false
            referencedRelation: "noise_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_seizures_noise_notice_id_fkey"
            columns: ["noise_notice_id"]
            isOneToOne: false
            referencedRelation: "noise_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_seizures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_seizures_seizing_officer_id_fkey"
            columns: ["seizing_officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "noise_seizures_seizing_officer_id_fkey"
            columns: ["seizing_officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "noise_seizures_seizing_officer_id_fkey"
            columns: ["seizing_officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          nzscv_certificate_issue_date: string | null
          nzscv_certificate_status: string | null
          nzscv_checked_at: string | null
          nzscv_logo_url: string | null
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
          vehicle_embedding: string | null
          vehicle_make: string | null
          vehicle_make_confidence: number | null
          vehicle_model: string | null
          vehicle_model_confidence: number | null
          vehicle_max_occupants: number | null
          vehicle_vin: string | null
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
          nzscv_certificate_issue_date?: string | null
          nzscv_certificate_status?: string | null
          nzscv_checked_at?: string | null
          nzscv_logo_url?: string | null
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
          vehicle_embedding?: string | null
          vehicle_make?: string | null
          vehicle_make_confidence?: number | null
          vehicle_model?: string | null
          vehicle_model_confidence?: number | null
          vehicle_max_occupants?: number | null
          vehicle_vin?: string | null
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
          nzscv_certificate_issue_date?: string | null
          nzscv_certificate_status?: string | null
          nzscv_checked_at?: string | null
          nzscv_logo_url?: string | null
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
          vehicle_embedding?: string | null
          vehicle_make?: string | null
          vehicle_make_confidence?: number | null
          vehicle_model?: string | null
          vehicle_model_confidence?: number | null
          vehicle_max_occupants?: number | null
          vehicle_vin?: string | null
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      officer_activity_rates: {
        Row: {
          activity_type: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          notes: string | null
          officer_id: string
          organization_id: string
          rate_per_hour: number
        }
        Insert: {
          activity_type: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          officer_id: string
          organization_id: string
          rate_per_hour: number
        }
        Update: {
          activity_type?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          officer_id?: string
          organization_id?: string
          rate_per_hour?: number
        }
        Relationships: [
          {
            foreignKeyName: "officer_activity_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_activity_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_activity_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_activity_rates_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_activity_rates_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_activity_rates_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_activity_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_availability: {
        Row: {
          available_from: string | null
          available_to: string | null
          created_at: string
          day_of_week: number | null
          id: string
          is_available: boolean
          notes: string | null
          officer_id: string
          organization_id: string
          specific_date: string | null
          unavailability_reason: string | null
          updated_at: string
        }
        Insert: {
          available_from?: string | null
          available_to?: string | null
          created_at?: string
          day_of_week?: number | null
          id?: string
          is_available?: boolean
          notes?: string | null
          officer_id: string
          organization_id: string
          specific_date?: string | null
          unavailability_reason?: string | null
          updated_at?: string
        }
        Update: {
          available_from?: string | null
          available_to?: string | null
          created_at?: string
          day_of_week?: number | null
          id?: string
          is_available?: boolean
          notes?: string | null
          officer_id?: string
          organization_id?: string
          specific_date?: string | null
          unavailability_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "officer_availability_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_availability_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_availability_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_availability_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_shifts: {
        Row: {
          admin_notes: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          client_org_id: string | null
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
          roster_shift_id: string | null
          service_type: string | null
          shift_feedback: string | null
          shift_rating: number | null
          started_at: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          client_org_id?: string | null
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
          roster_shift_id?: string | null
          service_type?: string | null
          shift_feedback?: string | null
          shift_rating?: number | null
          started_at?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          client_org_id?: string | null
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
          roster_shift_id?: string | null
          service_type?: string | null
          shift_feedback?: string | null
          shift_rating?: number | null
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "officer_shifts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_shifts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_shifts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_shifts_client_org_id_fkey"
            columns: ["client_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "officer_shifts_roster_shift_id_fkey"
            columns: ["roster_shift_id"]
            isOneToOne: false
            referencedRelation: "roster_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_skills: {
        Row: {
          certification_number: string | null
          created_at: string
          document_url: string | null
          expires_at: string | null
          id: string
          is_verified: boolean
          issued_at: string | null
          notes: string | null
          officer_id: string
          organization_id: string
          skill_category: string
          skill_name: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          certification_number?: string | null
          created_at?: string
          document_url?: string | null
          expires_at?: string | null
          id?: string
          is_verified?: boolean
          issued_at?: string | null
          notes?: string | null
          officer_id: string
          organization_id: string
          skill_category?: string
          skill_name: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          certification_number?: string | null
          created_at?: string
          document_url?: string | null
          expires_at?: string | null
          id?: string
          is_verified?: boolean
          issued_at?: string | null
          notes?: string | null
          officer_id?: string
          organization_id?: string
          skill_category?: string
          skill_name?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "officer_skills_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_skills_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_skills_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_skills_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_skills_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "officer_skills_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_skills_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          check_in_interval_minutes: number
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
          check_in_interval_minutes?: number
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
          check_in_interval_minutes?: number
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      open_shifts: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          created_by: string
          description: string | null
          end_time: string | null
          id: string
          officer_shift_id: string | null
          organization_id: string
          priority: string
          requirements: string | null
          shift_date: string
          shift_type: string
          start_time: string | null
          status: string
          title: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          end_time?: string | null
          id?: string
          officer_shift_id?: string | null
          organization_id: string
          priority?: string
          requirements?: string | null
          shift_date: string
          shift_type?: string
          start_time?: string | null
          status?: string
          title: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          end_time?: string | null
          id?: string
          officer_shift_id?: string | null
          organization_id?: string
          priority?: string
          requirements?: string | null
          shift_date?: string
          shift_type?: string
          start_time?: string | null
          status?: string
          title?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "open_shifts_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "open_shifts_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shifts_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "open_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shifts_officer_shift_id_fkey"
            columns: ["officer_shift_id"]
            isOneToOne: false
            referencedRelation: "officer_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shifts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "open_shifts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          bob_voiceprint_enrollment_allowed: boolean
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
          bob_voiceprint_enrollment_allowed?: boolean
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
          bob_voiceprint_enrollment_allowed?: boolean
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
      parking_infringement_counters: {
        Row: {
          last_number: number
          organization_id: string
        }
        Insert: {
          last_number?: number
          organization_id: string
        }
        Update: {
          last_number?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parking_infringement_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_infringements: {
        Row: {
          cancelled_reason: string | null
          court_reference: string | null
          dispute_notes: string | null
          due_date: string | null
          early_payment_amount: number | null
          early_payment_days: number | null
          evidence_photos: string[] | null
          fine_amount_nzd: number | null
          id: string
          infringement_number: string
          issued_at: string
          location_address: string
          location_lat: number | null
          location_lng: number | null
          offence_code: string | null
          offence_description: string
          offence_time: string
          officer_id: string | null
          officer_name: string | null
          organization_id: string
          parking_session_id: string | null
          parking_zone_id: string | null
          parkpow_violation_id: number | null
          payment_method: string | null
          payment_received_at: string | null
          payment_reference: string | null
          pdf_url: string | null
          plate_number: string
          status: string
          updated_at: string
          vehicle_colour: string | null
          vehicle_make: string | null
          vehicle_model: string | null
        }
        Insert: {
          cancelled_reason?: string | null
          court_reference?: string | null
          dispute_notes?: string | null
          due_date?: string | null
          early_payment_amount?: number | null
          early_payment_days?: number | null
          evidence_photos?: string[] | null
          fine_amount_nzd?: number | null
          id?: string
          infringement_number: string
          issued_at?: string
          location_address: string
          location_lat?: number | null
          location_lng?: number | null
          offence_code?: string | null
          offence_description: string
          offence_time: string
          officer_id?: string | null
          officer_name?: string | null
          organization_id: string
          parking_session_id?: string | null
          parking_zone_id?: string | null
          parkpow_violation_id?: number | null
          payment_method?: string | null
          payment_received_at?: string | null
          payment_reference?: string | null
          pdf_url?: string | null
          plate_number: string
          status?: string
          updated_at?: string
          vehicle_colour?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
        }
        Update: {
          cancelled_reason?: string | null
          court_reference?: string | null
          dispute_notes?: string | null
          due_date?: string | null
          early_payment_amount?: number | null
          early_payment_days?: number | null
          evidence_photos?: string[] | null
          fine_amount_nzd?: number | null
          id?: string
          infringement_number?: string
          issued_at?: string
          location_address?: string
          location_lat?: number | null
          location_lng?: number | null
          offence_code?: string | null
          offence_description?: string
          offence_time?: string
          officer_id?: string | null
          officer_name?: string | null
          organization_id?: string
          parking_session_id?: string | null
          parking_zone_id?: string | null
          parkpow_violation_id?: number | null
          payment_method?: string | null
          payment_received_at?: string | null
          payment_reference?: string | null
          pdf_url?: string | null
          plate_number?: string
          status?: string
          updated_at?: string
          vehicle_colour?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parking_infringements_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "parking_infringements_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_infringements_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_infringements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_infringements_parking_session_id_fkey"
            columns: ["parking_session_id"]
            isOneToOne: false
            referencedRelation: "parking_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_infringements_parking_zone_id_fkey"
            columns: ["parking_zone_id"]
            isOneToOne: false
            referencedRelation: "parking_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_permits: {
        Row: {
          created_at: string
          holder_address: string | null
          holder_email: string | null
          holder_name: string | null
          holder_phone: string | null
          id: string
          is_active: boolean
          issued_by: string | null
          notes: string | null
          organization_id: string
          parking_zone_id: string | null
          parkpow_vehicle_id: number | null
          permit_type: string
          plate_number: string
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          holder_address?: string | null
          holder_email?: string | null
          holder_name?: string | null
          holder_phone?: string | null
          id?: string
          is_active?: boolean
          issued_by?: string | null
          notes?: string | null
          organization_id: string
          parking_zone_id?: string | null
          parkpow_vehicle_id?: number | null
          permit_type?: string
          plate_number: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          holder_address?: string | null
          holder_email?: string | null
          holder_name?: string | null
          holder_phone?: string | null
          id?: string
          is_active?: boolean
          issued_by?: string | null
          notes?: string | null
          organization_id?: string
          parking_zone_id?: string | null
          parkpow_vehicle_id?: number | null
          permit_type?: string
          plate_number?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parking_permits_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "parking_permits_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_permits_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_permits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_permits_parking_zone_id_fkey"
            columns: ["parking_zone_id"]
            isOneToOne: false
            referencedRelation: "parking_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_sessions: {
        Row: {
          camera_id: string | null
          created_at: string
          dwell_minutes: number | null
          entry_photo_url: string | null
          entry_time: string
          entry_tyre_valve_pos: string | null
          exit_photo_url: string | null
          exit_time: string | null
          exit_tyre_valve_pos: string | null
          first_pass_id: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          is_violation: boolean
          notes: string | null
          officer_id: string | null
          organization_id: string
          parking_zone_id: string | null
          parkpow_session_id: number | null
          pass_number: number
          plate_number: string
          sign_photo_url: string | null
          tyre_valve_photo_url: string | null
          updated_at: string
          vehicle_colour: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          violation_reason: string | null
        }
        Insert: {
          camera_id?: string | null
          created_at?: string
          dwell_minutes?: number | null
          entry_photo_url?: string | null
          entry_time?: string
          entry_tyre_valve_pos?: string | null
          exit_photo_url?: string | null
          exit_time?: string | null
          exit_tyre_valve_pos?: string | null
          first_pass_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_violation?: boolean
          notes?: string | null
          officer_id?: string | null
          organization_id: string
          parking_zone_id?: string | null
          parkpow_session_id?: number | null
          pass_number?: number
          plate_number: string
          sign_photo_url?: string | null
          tyre_valve_photo_url?: string | null
          updated_at?: string
          vehicle_colour?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          violation_reason?: string | null
        }
        Update: {
          camera_id?: string | null
          created_at?: string
          dwell_minutes?: number | null
          entry_photo_url?: string | null
          entry_time?: string
          entry_tyre_valve_pos?: string | null
          exit_photo_url?: string | null
          exit_time?: string | null
          exit_tyre_valve_pos?: string | null
          first_pass_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_violation?: boolean
          notes?: string | null
          officer_id?: string | null
          organization_id?: string
          parking_zone_id?: string | null
          parkpow_session_id?: number | null
          pass_number?: number
          plate_number?: string
          sign_photo_url?: string | null
          tyre_valve_photo_url?: string | null
          updated_at?: string
          vehicle_colour?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          violation_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parking_sessions_first_pass_id_fkey"
            columns: ["first_pass_id"]
            isOneToOne: false
            referencedRelation: "parking_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_sessions_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "parking_sessions_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_sessions_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_sessions_parking_zone_id_fkey"
            columns: ["parking_zone_id"]
            isOneToOne: false
            referencedRelation: "parking_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_zones: {
        Row: {
          address: string | null
          camera_ids: string[] | null
          created_at: string
          enforcement_hours: Json | null
          fine_amount_nzd: number | null
          geometry: Json | null
          grace_period_minutes: number | null
          id: string
          is_active: boolean
          max_stay_minutes: number | null
          name: string
          notes: string | null
          organization_id: string
          parkpow_lot_id: number | null
          permit_types_accepted: string[] | null
          updated_at: string
          zone_id: string | null
          zone_type: string
        }
        Insert: {
          address?: string | null
          camera_ids?: string[] | null
          created_at?: string
          enforcement_hours?: Json | null
          fine_amount_nzd?: number | null
          geometry?: Json | null
          grace_period_minutes?: number | null
          id?: string
          is_active?: boolean
          max_stay_minutes?: number | null
          name: string
          notes?: string | null
          organization_id: string
          parkpow_lot_id?: number | null
          permit_types_accepted?: string[] | null
          updated_at?: string
          zone_id?: string | null
          zone_type?: string
        }
        Update: {
          address?: string | null
          camera_ids?: string[] | null
          created_at?: string
          enforcement_hours?: Json | null
          fine_amount_nzd?: number | null
          geometry?: Json | null
          grace_period_minutes?: number | null
          id?: string
          is_active?: boolean
          max_stay_minutes?: number | null
          name?: string
          notes?: string | null
          organization_id?: string
          parkpow_lot_id?: number | null
          permit_types_accepted?: string[] | null
          updated_at?: string
          zone_id?: string | null
          zone_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "parking_zones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "parking_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_checkpoints: {
        Row: {
          check_in_radius_metres: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          location_lat: number | null
          location_lng: number | null
          name: string
          nfc_tag_id: string | null
          organization_id: string
          qr_code: string
          required_on_patrol: boolean
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          check_in_radius_metres?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          location_lat?: number | null
          location_lng?: number | null
          name: string
          nfc_tag_id?: string | null
          organization_id: string
          qr_code: string
          required_on_patrol?: boolean
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          check_in_radius_metres?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          location_lat?: number | null
          location_lng?: number | null
          name?: string
          nfc_tag_id?: string | null
          organization_id?: string
          qr_code?: string
          required_on_patrol?: boolean
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patrol_checkpoints_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_checkpoints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_checkpoints_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
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
          patrol_route_id: string | null
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
          patrol_route_id?: string | null
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
          patrol_route_id?: string | null
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "patrols_patrol_route_id_fkey"
            columns: ["patrol_route_id"]
            isOneToOne: false
            referencedRelation: "patrol_routes"
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          alert_generated: boolean | null
          alert_types: string[] | null
          canonical_person_id: string | null
          created_at: string | null
          evidence_photos: string[] | null
          geofence_validated: boolean | null
          gps_accuracy: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          identification_method: string | null
          is_minor_record: boolean | null
          match_confidence: number | null
          metadata: Json | null
          observation_id: string | null
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
          alert_generated?: boolean | null
          alert_types?: string[] | null
          canonical_person_id?: string | null
          created_at?: string | null
          evidence_photos?: string[] | null
          geofence_validated?: boolean | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          identification_method?: string | null
          is_minor_record?: boolean | null
          match_confidence?: number | null
          metadata?: Json | null
          observation_id?: string | null
          observation_type: string
          officer_notes?: string | null
          organization_id: string
          person_id?: string | null
          plate_number?: string | null
          recorded_at?: string
          recorded_by: string
          updated_at?: string | null
          zone_id: string
        }
        Update: {
          alert_generated?: boolean | null
          alert_types?: string[] | null
          canonical_person_id?: string | null
          created_at?: string | null
          evidence_photos?: string[] | null
          geofence_validated?: boolean | null
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          identification_method?: string | null
          is_minor_record?: boolean | null
          match_confidence?: number | null
          metadata?: Json | null
          observation_id?: string | null
          observation_type?: string
          officer_notes?: string | null
          organization_id?: string
          person_id?: string | null
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      persons_of_interest: {
        Row: {
          active: boolean | null
          address: string | null
          client_site_id: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          created_by: string | null
          date_of_birth: string | null
          description: string | null
          distinguishing_features: string | null
          ethnicity: string | null
          expires_at: string | null
          full_name: string
          gender: string | null
          height_cm: number | null
          id: string
          notes: string | null
          organization_id: string
          photos: string[] | null
          privacy_lawful_purpose: string | null
          privacy_notice_given: boolean | null
          reason: string | null
          site_specific: boolean
          status: string
          updated_at: string | null
          weight_kg: number | null
        }
        Insert: {
          active?: boolean | null
          address?: string | null
          client_site_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_birth?: string | null
          description?: string | null
          distinguishing_features?: string | null
          ethnicity?: string | null
          expires_at?: string | null
          full_name: string
          gender?: string | null
          height_cm?: number | null
          id?: string
          notes?: string | null
          organization_id: string
          photos?: string[] | null
          privacy_lawful_purpose?: string | null
          privacy_notice_given?: boolean | null
          reason?: string | null
          site_specific?: boolean
          status?: string
          updated_at?: string | null
          weight_kg?: number | null
        }
        Update: {
          active?: boolean | null
          address?: string | null
          client_site_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_birth?: string | null
          description?: string | null
          distinguishing_features?: string | null
          ethnicity?: string | null
          expires_at?: string | null
          full_name?: string
          gender?: string | null
          height_cm?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          photos?: string[] | null
          privacy_lawful_purpose?: string | null
          privacy_notice_given?: boolean | null
          reason?: string | null
          site_specific?: boolean
          status?: string
          updated_at?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "persons_of_interest_client_site_id_fkey"
            columns: ["client_site_id"]
            isOneToOne: false
            referencedRelation: "client_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persons_of_interest_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "persons_of_interest_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persons_of_interest_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persons_of_interest_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      roster_shifts: {
        Row: {
          break_minutes: number
          cancel_reason: string | null
          cancelled_at: string | null
          client_charge_rate: number | null
          client_site_id: string | null
          confirmed_at: string | null
          conflict_reason: string | null
          contractor_org_id: string | null
          created_at: string
          created_by: string | null
          end_time: string | null
          guard_cost_rate: number | null
          has_conflict: boolean
          id: string
          internal_notes: string | null
          is_template: boolean
          notes: string | null
          officer_id: string | null
          officer_notes: string | null
          officer_response: string | null
          officer_response_at: string | null
          officer_shift_id: string | null
          organization_id: string
          parent_template_id: string | null
          position_title: string | null
          published_at: string | null
          rate_type: string | null
          recurrence_rule: string | null
          required_skills: string[] | null
          service_type: string | null
          shift_date: string
          shift_type: string
          start_time: string | null
          status: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          break_minutes?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_charge_rate?: number | null
          client_site_id?: string | null
          confirmed_at?: string | null
          conflict_reason?: string | null
          contractor_org_id?: string | null
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          guard_cost_rate?: number | null
          has_conflict?: boolean
          id?: string
          internal_notes?: string | null
          is_template?: boolean
          notes?: string | null
          officer_id?: string | null
          officer_notes?: string | null
          officer_response?: string | null
          officer_response_at?: string | null
          officer_shift_id?: string | null
          organization_id: string
          parent_template_id?: string | null
          position_title?: string | null
          published_at?: string | null
          rate_type?: string | null
          recurrence_rule?: string | null
          required_skills?: string[] | null
          service_type?: string | null
          shift_date: string
          shift_type?: string
          start_time?: string | null
          status?: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          break_minutes?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_charge_rate?: number | null
          client_site_id?: string | null
          confirmed_at?: string | null
          conflict_reason?: string | null
          contractor_org_id?: string | null
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          guard_cost_rate?: number | null
          has_conflict?: boolean
          id?: string
          internal_notes?: string | null
          is_template?: boolean
          notes?: string | null
          officer_id?: string | null
          officer_notes?: string | null
          officer_response?: string | null
          officer_response_at?: string | null
          officer_shift_id?: string | null
          organization_id?: string
          parent_template_id?: string | null
          position_title?: string | null
          published_at?: string | null
          rate_type?: string | null
          recurrence_rule?: string | null
          required_skills?: string[] | null
          service_type?: string | null
          shift_date?: string
          shift_type?: string
          start_time?: string | null
          status?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_shifts_client_site_id_fkey"
            columns: ["client_site_id"]
            isOneToOne: false
            referencedRelation: "client_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_contractor_org_id_fkey"
            columns: ["contractor_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "roster_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "roster_shifts_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_officer_shift_id_fkey"
            columns: ["officer_shift_id"]
            isOneToOne: false
            referencedRelation: "officer_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_parent_template_id_fkey"
            columns: ["parent_template_id"]
            isOneToOne: false
            referencedRelation: "roster_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "roster_shifts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      site_role_permissions: {
        Row: {
          can_edit: boolean
          can_view: boolean
          field_group: string
          id: string
          role: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          can_edit?: boolean
          can_view?: boolean
          field_group: string
          id?: string
          role: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          can_edit?: boolean
          can_view?: boolean
          field_group?: string
          id?: string
          role?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_role_permissions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_user_permissions: {
        Row: {
          can_edit: boolean | null
          can_view: boolean | null
          field_group: string
          id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          can_edit?: boolean | null
          can_view?: boolean | null
          field_group: string
          id?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          can_edit?: boolean | null
          can_view?: boolean | null
          field_group?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_user_permissions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_incidents: {
        Row: {
          action_taken: string | null
          admin_notes: string | null
          camera_review_notes: string | null
          camera_review_requested: boolean
          camera_review_status: string | null
          client_site_id: string | null
          created_at: string
          description: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          incident_type: string
          location_description: string | null
          officer_id: string
          officer_shift_id: string | null
          organization_id: string
          outcome: string | null
          poi_id: string | null
          police_event_number: string | null
          police_notes: string | null
          police_notified: boolean
          police_notified_at: string | null
          police_officer_name: string | null
          police_station: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          roster_shift_id: string | null
          severity: string
          status: string
          subject_description: string | null
          subject_dob: string | null
          subject_name: string | null
          subject_photos: string[] | null
          updated_at: string
        }
        Insert: {
          action_taken?: string | null
          admin_notes?: string | null
          camera_review_notes?: string | null
          camera_review_requested?: boolean
          camera_review_status?: string | null
          client_site_id?: string | null
          created_at?: string
          description: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          incident_type: string
          location_description?: string | null
          officer_id: string
          officer_shift_id?: string | null
          organization_id: string
          outcome?: string | null
          poi_id?: string | null
          police_event_number?: string | null
          police_notes?: string | null
          police_notified?: boolean
          police_notified_at?: string | null
          police_officer_name?: string | null
          police_station?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          roster_shift_id?: string | null
          severity?: string
          status?: string
          subject_description?: string | null
          subject_dob?: string | null
          subject_name?: string | null
          subject_photos?: string[] | null
          updated_at?: string
        }
        Update: {
          action_taken?: string | null
          admin_notes?: string | null
          camera_review_notes?: string | null
          camera_review_requested?: boolean
          camera_review_status?: string | null
          client_site_id?: string | null
          created_at?: string
          description?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          incident_type?: string
          location_description?: string | null
          officer_id?: string
          officer_shift_id?: string | null
          organization_id?: string
          outcome?: string | null
          poi_id?: string | null
          police_event_number?: string | null
          police_notes?: string | null
          police_notified?: boolean
          police_notified_at?: string | null
          police_officer_name?: string | null
          police_station?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          roster_shift_id?: string | null
          severity?: string
          status?: string
          subject_description?: string | null
          subject_dob?: string | null
          subject_name?: string | null
          subject_photos?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_incidents_client_site_id_fkey"
            columns: ["client_site_id"]
            isOneToOne: false
            referencedRelation: "client_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_incidents_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "site_incidents_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_incidents_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_incidents_officer_shift_id_fkey"
            columns: ["officer_shift_id"]
            isOneToOne: false
            referencedRelation: "officer_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_incidents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_incidents_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "persons_of_interest"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_incidents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "site_incidents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_incidents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_incidents_roster_shift_id_fkey"
            columns: ["roster_shift_id"]
            isOneToOne: false
            referencedRelation: "roster_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      site_risk_assessments: {
        Row: {
          additional_controls: string | null
          assessed_by: string | null
          assessment_date: string | null
          assessor_signature: string | null
          communication_coverage: boolean | null
          controls_in_place: string | null
          created_at: string | null
          emergency_plan_sighted: boolean | null
          first_aid_available: boolean | null
          gps_latitude: number | null
          gps_longitude: number | null
          hazard_aggressive_persons: boolean | null
          hazard_animals: boolean | null
          hazard_biological: boolean | null
          hazard_confined_spaces: boolean | null
          hazard_electrical: boolean | null
          hazard_fire: boolean | null
          hazard_hazardous_substances: boolean | null
          hazard_lone_working: boolean | null
          hazard_manual_handling: boolean | null
          hazard_noise: boolean | null
          hazard_other: boolean | null
          hazard_other_description: string | null
          hazard_poor_lighting: boolean | null
          hazard_slips_trips_falls: boolean | null
          hazard_uneven_terrain: boolean | null
          hazard_vehicles_traffic: boolean | null
          hazard_water_drowning: boolean | null
          hazard_weather_exposure: boolean | null
          hazard_working_at_height: boolean | null
          id: string
          job_reference: string | null
          notes: string | null
          organization_id: string
          overall_risk_level: string
          photos: string[] | null
          ppe_required: string[] | null
          request_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          safe_parking_available: boolean | null
          signage_adequate: boolean | null
          site_access_clear: boolean | null
          site_address: string | null
          site_name: string
          status: string
          updated_at: string | null
          zone_id: string | null
        }
        Insert: {
          additional_controls?: string | null
          assessed_by?: string | null
          assessment_date?: string | null
          assessor_signature?: string | null
          communication_coverage?: boolean | null
          controls_in_place?: string | null
          created_at?: string | null
          emergency_plan_sighted?: boolean | null
          first_aid_available?: boolean | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          hazard_aggressive_persons?: boolean | null
          hazard_animals?: boolean | null
          hazard_biological?: boolean | null
          hazard_confined_spaces?: boolean | null
          hazard_electrical?: boolean | null
          hazard_fire?: boolean | null
          hazard_hazardous_substances?: boolean | null
          hazard_lone_working?: boolean | null
          hazard_manual_handling?: boolean | null
          hazard_noise?: boolean | null
          hazard_other?: boolean | null
          hazard_other_description?: string | null
          hazard_poor_lighting?: boolean | null
          hazard_slips_trips_falls?: boolean | null
          hazard_uneven_terrain?: boolean | null
          hazard_vehicles_traffic?: boolean | null
          hazard_water_drowning?: boolean | null
          hazard_weather_exposure?: boolean | null
          hazard_working_at_height?: boolean | null
          id?: string
          job_reference?: string | null
          notes?: string | null
          organization_id: string
          overall_risk_level?: string
          photos?: string[] | null
          ppe_required?: string[] | null
          request_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          safe_parking_available?: boolean | null
          signage_adequate?: boolean | null
          site_access_clear?: boolean | null
          site_address?: string | null
          site_name: string
          status?: string
          updated_at?: string | null
          zone_id?: string | null
        }
        Update: {
          additional_controls?: string | null
          assessed_by?: string | null
          assessment_date?: string | null
          assessor_signature?: string | null
          communication_coverage?: boolean | null
          controls_in_place?: string | null
          created_at?: string | null
          emergency_plan_sighted?: boolean | null
          first_aid_available?: boolean | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          hazard_aggressive_persons?: boolean | null
          hazard_animals?: boolean | null
          hazard_biological?: boolean | null
          hazard_confined_spaces?: boolean | null
          hazard_electrical?: boolean | null
          hazard_fire?: boolean | null
          hazard_hazardous_substances?: boolean | null
          hazard_lone_working?: boolean | null
          hazard_manual_handling?: boolean | null
          hazard_noise?: boolean | null
          hazard_other?: boolean | null
          hazard_other_description?: string | null
          hazard_poor_lighting?: boolean | null
          hazard_slips_trips_falls?: boolean | null
          hazard_uneven_terrain?: boolean | null
          hazard_vehicles_traffic?: boolean | null
          hazard_water_drowning?: boolean | null
          hazard_weather_exposure?: boolean | null
          hazard_working_at_height?: boolean | null
          id?: string
          job_reference?: string | null
          notes?: string | null
          organization_id?: string
          overall_risk_level?: string
          photos?: string[] | null
          ppe_required?: string[] | null
          request_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          safe_parking_available?: boolean | null
          signage_adequate?: boolean | null
          site_access_clear?: boolean | null
          site_address?: string | null
          site_name?: string
          status?: string
          updated_at?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_risk_assessments_assessed_by_fkey"
            columns: ["assessed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "site_risk_assessments_assessed_by_fkey"
            columns: ["assessed_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_risk_assessments_assessed_by_fkey"
            columns: ["assessed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_risk_assessments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_risk_assessments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "site_risk_assessments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_risk_assessments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_risk_assessments_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "site_risk_assessments_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
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
      trespass_notices: {
        Row: {
          created_at: string | null
          duration_days: number | null
          expires_at: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          legal_basis: string | null
          notes: string | null
          notice_html: string | null
          notice_type: string
          organization_id: string
          person_id: string | null
          photos: string[] | null
          privacy_notice_given: boolean | null
          reference_number: string | null
          served_method: string | null
          status: string
          trespass_from: string | null
          trespass_reason: string
          updated_at: string | null
          vehicle_id: string | null
          witness_name: string | null
          witness_present: boolean | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          duration_days?: number | null
          expires_at?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          legal_basis?: string | null
          notes?: string | null
          notice_html?: string | null
          notice_type?: string
          organization_id: string
          person_id?: string | null
          photos?: string[] | null
          privacy_notice_given?: boolean | null
          reference_number?: string | null
          served_method?: string | null
          status?: string
          trespass_from?: string | null
          trespass_reason: string
          updated_at?: string | null
          vehicle_id?: string | null
          witness_name?: string | null
          witness_present?: boolean | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          duration_days?: number | null
          expires_at?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          legal_basis?: string | null
          notes?: string | null
          notice_html?: string | null
          notice_type?: string
          organization_id?: string
          person_id?: string | null
          photos?: string[] | null
          privacy_notice_given?: boolean | null
          reference_number?: string | null
          served_method?: string | null
          status?: string
          trespass_from?: string | null
          trespass_reason?: string
          updated_at?: string | null
          vehicle_id?: string | null
          witness_name?: string | null
          witness_present?: boolean | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trespass_notices_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "trespass_notices_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trespass_notices_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trespass_notices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trespass_notices_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons_of_interest"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trespass_notices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_of_interest"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trespass_notices_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "v_observation_zone_audit"
            referencedColumns: ["canonical_zone_id"]
          },
          {
            foreignKeyName: "trespass_notices_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
          enabled_portals: string[]
          extra_organization_ids: string[]
          first_name: string | null
          has_warrant: boolean | null
          id: string
          is_active: boolean | null
          issuing_authority: string | null
          job_title: string | null
          last_gps_accuracy: number | null
          last_gps_latitude: number | null
          last_gps_longitude: number | null
          last_gps_update: string | null
          last_name: string | null
          notification_preferences: Json | null
          organization_id: string | null
          permissions: Json | null
          phone: string | null
          portal_access: string[]
          profile_photo_url: string | null
          push_token: string | null
          push_token_updated_at: string | null
          push_subscription: Json | null
          requires_driver_license: boolean
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
          enabled_portals?: string[]
          extra_organization_ids?: string[]
          first_name?: string | null
          has_warrant?: boolean | null
          id: string
          is_active?: boolean | null
          issuing_authority?: string | null
          job_title?: string | null
          last_gps_accuracy?: number | null
          last_gps_latitude?: number | null
          last_gps_longitude?: number | null
          last_gps_update?: string | null
          last_name?: string | null
          notification_preferences?: Json | null
          organization_id?: string | null
          permissions?: Json | null
          phone?: string | null
          portal_access?: string[]
          profile_photo_url?: string | null
          push_token?: string | null
          push_token_updated_at?: string | null
          push_subscription?: Json | null
          requires_driver_license?: boolean
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
          enabled_portals?: string[]
          extra_organization_ids?: string[]
          first_name?: string | null
          has_warrant?: boolean | null
          id?: string
          is_active?: boolean | null
          issuing_authority?: string | null
          job_title?: string | null
          last_gps_accuracy?: number | null
          last_gps_latitude?: number | null
          last_gps_longitude?: number | null
          last_gps_update?: string | null
          last_name?: string | null
          notification_preferences?: Json | null
          organization_id?: string | null
          permissions?: Json | null
          phone?: string | null
          portal_access?: string[]
          profile_photo_url?: string | null
          push_token?: string | null
          push_token_updated_at?: string | null
          push_subscription?: Json | null
          requires_driver_license?: boolean
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      vehicles_of_interest: {
        Row: {
          active: boolean | null
          created_at: string | null
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          linked_person_id: string | null
          notes: string | null
          organization_id: string
          photos: string[] | null
          plate_number: string
          primary_zone_id: string | null
          reason: string | null
          status: string
          updated_at: string | null
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: number | null
          zone_last_observed_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          linked_person_id?: string | null
          notes?: string | null
          organization_id: string
          photos?: string[] | null
          plate_number: string
          primary_zone_id?: string | null
          reason?: string | null
          status?: string
          updated_at?: string | null
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          zone_last_observed_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          linked_person_id?: string | null
          notes?: string | null
          organization_id?: string
          photos?: string[] | null
          plate_number?: string
          primary_zone_id?: string | null
          reason?: string | null
          status?: string
          updated_at?: string | null
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          zone_last_observed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_of_interest_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "vehicles_of_interest_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_of_interest_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_of_interest_linked_person_id_fkey"
            columns: ["linked_person_id"]
            isOneToOne: false
            referencedRelation: "persons_of_interest"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_of_interest_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_of_interest_primary_zone_id_fkey"
            columns: ["primary_zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      welfare_checkins: {
        Row: {
          checked_in_at: string
          created_at: string
          gps_accuracy: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          is_overdue: boolean
          officer_id: string
          officer_shift_id: string | null
          organization_id: string
          overdue_minutes: number | null
        }
        Insert: {
          checked_in_at?: string
          created_at?: string
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          is_overdue?: boolean
          officer_id: string
          officer_shift_id?: string | null
          organization_id: string
          overdue_minutes?: number | null
        }
        Update: {
          checked_in_at?: string
          created_at?: string
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          is_overdue?: boolean
          officer_id?: string
          officer_shift_id?: string | null
          organization_id?: string
          overdue_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "welfare_checkins_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officer_compliance_dashboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "welfare_checkins_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_checkins_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_checkins_officer_shift_id_fkey"
            columns: ["officer_shift_id"]
            isOneToOne: false
            referencedRelation: "officer_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_checkins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      welfare_events_b1: {
        Row: {
          case_id: string
          created_at: string
          created_by: string | null
          event_type: 'scheduled_checkin' | 'officer_initiated' | 'supervisor_alert' | 'missed_checkin' | 'emergency_alert'
          id: string
          notes: string | null
          officer_id: string
          organization_id: string
          patrol_route_instance_id: string | null
          reported_at: string
          resolved_at: string | null
          severity: 'routine' | 'yellow_flag' | 'red_flag' | 'emergency'
          status: 'open' | 'acknowledged' | 'resolved'
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by?: string | null
          event_type?: 'scheduled_checkin' | 'officer_initiated' | 'supervisor_alert' | 'missed_checkin' | 'emergency_alert'
          id?: string
          notes?: string | null
          officer_id: string
          organization_id: string
          patrol_route_instance_id?: string | null
          reported_at?: string
          resolved_at?: string | null
          severity?: 'routine' | 'yellow_flag' | 'red_flag' | 'emergency'
          status?: 'open' | 'acknowledged' | 'resolved'
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string | null
          event_type?: 'scheduled_checkin' | 'officer_initiated' | 'supervisor_alert' | 'missed_checkin' | 'emergency_alert'
          id?: string
          notes?: string | null
          officer_id?: string
          organization_id?: string
          patrol_route_instance_id?: string | null
          reported_at?: string
          resolved_at?: string | null
          severity?: 'routine' | 'yellow_flag' | 'red_flag' | 'emergency'
          status?: 'open' | 'acknowledged' | 'resolved'
        }
        Relationships: [
          { foreignKeyName: "welfare_events_b1_case_id_fkey"; columns: ["case_id"]; isOneToOne: false; referencedRelation: "operational_cases"; referencedColumns: ["id"] },
          { foreignKeyName: "welfare_events_b1_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "welfare_events_b1_officer_id_fkey"; columns: ["officer_id"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "welfare_events_b1_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
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
          dispute_portal_url: string | null
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
          organization_id: string
          payment_bank_account: string | null
          payment_instructions: string | null
          payment_online_url: string | null
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
          dispute_portal_url?: string | null
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
          organization_id: string
          payment_bank_account?: string | null
          payment_instructions?: string | null
          payment_online_url?: string | null
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
          organization_id?: string
          payment_bank_account?: string | null
          payment_instructions?: string | null
          payment_online_url?: string | null
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
            referencedRelation: "user_area_access"
            referencedColumns: ["id"]
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
      public_noise_complaints: {
        Row: {
          id: string
          reference: string
          organization_id: string | null
          address: string
          suburb: string | null
          complaint_description: string
          noise_type: 'music' | 'party' | 'machinery' | 'animals' | 'construction' | 'vehicle' | 'other' | null
          complainant_name: string | null
          complainant_email: string | null
          complainant_phone: string | null
          status: 'received' | 'acknowledged' | 'assigned' | 'on_scene' | 'resolved' | 'no_action_taken'
          status_message: string | null
          linked_noise_assessment_id: string | null
          linked_dispatch_job_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          reference?: string
          organization_id?: string | null
          address: string
          suburb?: string | null
          complaint_description: string
          noise_type?: 'music' | 'party' | 'machinery' | 'animals' | 'construction' | 'vehicle' | 'other' | null
          complainant_name?: string | null
          complainant_email?: string | null
          complainant_phone?: string | null
          status?: 'received' | 'acknowledged' | 'assigned' | 'on_scene' | 'resolved' | 'no_action_taken'
          status_message?: string | null
          linked_noise_assessment_id?: string | null
          linked_dispatch_job_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          reference?: string
          organization_id?: string | null
          address?: string
          suburb?: string | null
          complaint_description?: string
          noise_type?: 'music' | 'party' | 'machinery' | 'animals' | 'construction' | 'vehicle' | 'other' | null
          complainant_name?: string | null
          complainant_email?: string | null
          complainant_phone?: string | null
          status?: 'received' | 'acknowledged' | 'assigned' | 'on_scene' | 'resolved' | 'no_action_taken'
          status_message?: string | null
          linked_noise_assessment_id?: string | null
          linked_dispatch_job_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_noise_complaints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      zones: {
        Row: {
          allowed_days: string[] | null
          boundary_source: string | null
          bylaw_clause: string | null
          bylaw_reference: string | null
          bylaw_source_url: string | null
          created_at: string | null
          day_visit_only: boolean | null
          description: string | null
          enforcement_authority: string | null
          fee_nzd: number | null
          geometry: Json | null
          has_dump_station: boolean | null
          has_rubbish: boolean | null
          has_shower: boolean | null
          has_toilets: boolean | null
          has_water: boolean | null
          id: string
          is_active: boolean | null
          land_manager: string | null
          land_managing_agency: string | null
          location_lat: number | null
          location_lng: number | null
          max_consecutive_nights: number | null
          max_vehicles: number | null
          name: string
          needs_admin_review: boolean | null
          nights_per_month: number | null
          organization_id: string
          parent_zone_id: string | null
          parkpow_lot_id: number | null
          seasonal_close_month: number | null
          seasonal_open_month: number | null
          self_contained_required: boolean | null
          updated_at: string | null
          zone_features: string[] | null
          zone_type: string | null
        }
        Insert: {
          allowed_days?: string[] | null
          boundary_source?: string | null
          bylaw_clause?: string | null
          bylaw_reference?: string | null
          bylaw_source_url?: string | null
          created_at?: string | null
          day_visit_only?: boolean | null
          description?: string | null
          enforcement_authority?: string | null
          fee_nzd?: number | null
          geometry?: Json | null
          has_dump_station?: boolean | null
          has_rubbish?: boolean | null
          has_shower?: boolean | null
          has_toilets?: boolean | null
          has_water?: boolean | null
          id?: string
          is_active?: boolean | null
          land_manager?: string | null
          land_managing_agency?: string | null
          location_lat?: number | null
          location_lng?: number | null
          max_consecutive_nights?: number | null
          max_vehicles?: number | null
          name: string
          needs_admin_review?: boolean | null
          nights_per_month?: number | null
          organization_id: string
          parent_zone_id?: string | null
          parkpow_lot_id?: number | null
          seasonal_close_month?: number | null
          seasonal_open_month?: number | null
          self_contained_required?: boolean | null
          updated_at?: string | null
          zone_features?: string[] | null
          zone_type?: string | null
        }
        Update: {
          allowed_days?: string[] | null
          boundary_source?: string | null
          bylaw_clause?: string | null
          bylaw_reference?: string | null
          bylaw_source_url?: string | null
          created_at?: string | null
          day_visit_only?: boolean | null
          description?: string | null
          enforcement_authority?: string | null
          fee_nzd?: number | null
          geometry?: Json | null
          has_dump_station?: boolean | null
          has_rubbish?: boolean | null
          has_shower?: boolean | null
          has_toilets?: boolean | null
          has_water?: boolean | null
          id?: string
          is_active?: boolean | null
          land_manager?: string | null
          land_managing_agency?: string | null
          location_lat?: number | null
          location_lng?: number | null
          max_consecutive_nights?: number | null
          max_vehicles?: number | null
          name?: string
          needs_admin_review?: boolean | null
          nights_per_month?: number | null
          organization_id?: string
          parent_zone_id?: string | null
          parkpow_lot_id?: number | null
          seasonal_close_month?: number | null
          seasonal_open_month?: number | null
          self_contained_required?: boolean | null
          updated_at?: string | null
          zone_features?: string[] | null
          zone_type?: string | null
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
      v_canonical_person_obs_summary: {
        Row: {
          canonical_person_id: string | null
          distinct_vehicles: number | null
          distinct_zones: number | null
          first_name: string | null
          first_observed_at: string | null
          identification_methods_used: string[] | null
          is_banned: boolean | null
          is_flagged: boolean | null
          is_minor: boolean | null
          is_poi: boolean | null
          is_trespassed: boolean | null
          last_name: string | null
          last_observed_at: string | null
          last_zone_name: string | null
          risk_level: string | null
          total_alerts: number | null
          total_observations: number | null
        }
        Relationships: []
      }
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
      user_area_access: {
        Row: {
          authorized_work_locations: string[] | null
          email: string | null
          employer_org_name: string | null
          employer_organization_id: string | null
          enabled_portals: string[] | null
          extra_organization_ids: string[] | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          job_title: string | null
          organization_id: string | null
          portal_access: string[] | null
          primary_org_name: string | null
          primary_org_type: string | null
          role: string | null
        }
        Relationships: [
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
      radio_comms_events: {
        Row: {
          callsign: string | null
          case_id: string
          channel_scope: string | null
          created_at: string
          created_by: string | null
          degraded_mode: boolean
          event_timestamp: string
          event_type: 'radio_callsign_bound' | 'dispatch_escalated_to_radio' | 'radio_degraded_mode' | 'radio_channel_left'
          id: string
          notes: string | null
          officer_id: string | null
          organization_id: string
          ptt_session_id: string | null
        }
        Insert: {
          callsign?: string | null
          case_id: string
          channel_scope?: string | null
          created_at?: string
          created_by?: string | null
          degraded_mode?: boolean
          event_timestamp?: string
          event_type: 'radio_callsign_bound' | 'dispatch_escalated_to_radio' | 'radio_degraded_mode' | 'radio_channel_left'
          id?: string
          notes?: string | null
          officer_id?: string | null
          organization_id: string
          ptt_session_id?: string | null
        }
        Update: {
          callsign?: string | null
          case_id?: string
          channel_scope?: string | null
          created_at?: string
          created_by?: string | null
          degraded_mode?: boolean
          event_timestamp?: string
          event_type?: 'radio_callsign_bound' | 'dispatch_escalated_to_radio' | 'radio_degraded_mode' | 'radio_channel_left'
          id?: string
          notes?: string | null
          officer_id?: string | null
          organization_id?: string
          ptt_session_id?: string | null
        }
        Relationships: [
          { foreignKeyName: "radio_comms_events_case_id_fkey"; columns: ["case_id"]; isOneToOne: false; referencedRelation: "operational_cases"; referencedColumns: ["id"] },
          { foreignKeyName: "radio_comms_events_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "radio_comms_events_officer_id_fkey"; columns: ["officer_id"]; isOneToOne: false; referencedRelation: "user_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "radio_comms_events_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      radio_transmissions: {
        Row: {
          id: string
          org_id: string
          channel_id: string
          channel_type: string
          speaker_id: string
          speaker_name: string
          started_at: string
          ended_at: string | null
          duration_ms: number | null
          recording_enabled: boolean
          is_emergency: boolean
          floor_granted_at: string | null
          floor_released_at: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          channel_id: string
          channel_type: string
          speaker_id: string
          speaker_name: string
          started_at?: string
          ended_at?: string | null
          recording_enabled?: boolean
          is_emergency?: boolean
          floor_granted_at?: string | null
          floor_released_at?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          ended_at?: string | null
          recording_enabled?: boolean
          is_emergency?: boolean
          floor_granted_at?: string | null
          floor_released_at?: string | null
          metadata?: Json
        }
        Relationships: [
          { foreignKeyName: "radio_transmissions_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "radio_transmissions_speaker_id_fkey"; columns: ["speaker_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      radio_transcript_segments: {
        Row: {
          id: string
          org_id: string
          transmission_id: string
          sequence_num: number
          segment_start_ms: number
          segment_end_ms: number
          text: string
          language: string
          confidence: number | null
          is_final: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          transmission_id: string
          sequence_num: number
          segment_start_ms: number
          segment_end_ms: number
          text: string
          language?: string
          confidence?: number | null
          is_final?: boolean
          created_at?: string
        }
        Update: {
          text?: string
          confidence?: number | null
          is_final?: boolean
        }
        Relationships: [
          { foreignKeyName: "radio_transcript_segments_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "radio_transcript_segments_transmission_id_fkey"; columns: ["transmission_id"]; isOneToOne: false; referencedRelation: "radio_transmissions"; referencedColumns: ["id"] },
        ]
      }
      radio_translation_segments: {
        Row: {
          id: string
          org_id: string
          transcript_segment_id: string
          target_language: string
          text: string
          confidence: number | null
          is_low_confidence: boolean
          provider: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          transcript_segment_id: string
          target_language: string
          text: string
          confidence?: number | null
          provider?: string | null
          created_at?: string
        }
        Update: {
          text?: string
          confidence?: number | null
          provider?: string | null
        }
        Relationships: [
          { foreignKeyName: "radio_translation_segments_transcript_segment_id_fkey"; columns: ["transcript_segment_id"]; isOneToOne: false; referencedRelation: "radio_transcript_segments"; referencedColumns: ["id"] },
        ]
      }
      radio_tts_renders: {
        Row: {
          id: string
          org_id: string
          translation_segment_id: string
          target_language: string
          voice_profile_id: string | null
          provider: string
          is_synthetic: boolean
          storage_path: string | null
          duration_ms: number | null
          render_latency_ms: number | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          translation_segment_id: string
          target_language: string
          voice_profile_id?: string | null
          provider: string
          is_synthetic?: boolean
          storage_path?: string | null
          duration_ms?: number | null
          render_latency_ms?: number | null
          created_at?: string
        }
        Update: {
          storage_path?: string | null
          duration_ms?: number | null
          render_latency_ms?: number | null
        }
        Relationships: [
          { foreignKeyName: "radio_tts_renders_translation_segment_id_fkey"; columns: ["translation_segment_id"]; isOneToOne: false; referencedRelation: "radio_translation_segments"; referencedColumns: ["id"] },
        ]
      }
      radio_voice_profiles: {
        Row: {
          id: string
          org_id: string
          officer_id: string
          provider: string
          model_ref: string
          enrolled_at: string
          revoked_at: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          officer_id: string
          provider: string
          model_ref: string
          enrolled_at?: string
          revoked_at?: string | null
          created_at?: string
        }
        Update: {
          revoked_at?: string | null
          model_ref?: string
        }
        Relationships: [
          { foreignKeyName: "radio_voice_profiles_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "radio_voice_profiles_officer_id_fkey"; columns: ["officer_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      radio_voice_consents: {
        Row: {
          id: string
          org_id: string
          officer_id: string
          voice_profile_id: string | null
          purpose: string
          retention_days: number
          provider: string
          consented_at: string
          revoked_at: string | null
          revocation_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          officer_id: string
          voice_profile_id?: string | null
          purpose: string
          retention_days?: number
          provider: string
          consented_at?: string
          revoked_at?: string | null
          revocation_reason?: string | null
          created_at?: string
        }
        Update: {
          revoked_at?: string | null
          revocation_reason?: string | null
        }
        Relationships: [
          { foreignKeyName: "radio_voice_consents_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "radio_voice_consents_officer_id_fkey"; columns: ["officer_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "radio_voice_consents_voice_profile_id_fkey"; columns: ["voice_profile_id"]; isOneToOne: false; referencedRelation: "radio_voice_profiles"; referencedColumns: ["id"] },
        ]
      }
    }
    Functions: {
      _next_noise_seq: {
        Args: { p_org_id: string; p_prefix: string; p_table: string }
        Returns: string
      }
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
      check_compliance: {
        Args: {
          p_plate_number: string
          p_recorded_at?: string
          p_zone_id: string
        }
        Returns: Json
      }
      check_duplicate_observations: {
        Args: never
        Returns: {
          count: number
          observation_ids: string[]
          plate_number: string
          zone_id: string
        }[]
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
      generate_infringement_number: {
        Args: { p_org_id: string }
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
      create_case_from_dispatch_job: {
        Args: { dispatch_job_id: string }
        Returns: string
      }
      get_descendant_organizations: {
        Args: { org_id: string }
        Returns: string[]
      }
      get_duplicate_observations: {
        Args: { p_limit?: number; p_organization_id?: string }
        Returns: {
          count: number
          observation_ids: string[]
          plate_number: string
          zone_id: string
          zone_name: string
        }[]
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
      get_org_usage_summary: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          breach_count: number
          infringement_count: number
          is_active: boolean
          notice_count: number
          officer_count: number
          organization_id: string
          organization_name: string
          scan_count: number
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
      get_canonical_person_obs_history: {
        Args: {
          p_canonical_person_id: string
          p_caller_lat?: number
          p_caller_lon?: number
        }
        Returns: {
          alert_generated: boolean
          alert_types: string[]
          canonical_person_id: string
          evidence_photos: string[]
          geofence_validated: boolean
          id: string
          identification_method: string
          is_minor_record: boolean
          match_confidence: number
          observation_type: string
          officer_name: string
          officer_notes: string
          person_id: string
          plate_number: string
          recorded_at: string
          vehicle_color: string
          vehicle_make: string
          vehicle_model: string
          zone_id: string
          zone_name: string
        }[]
      }
      get_person_observation_history: {
        Args: { p_person_id: string }
        Returns: {
          alert_generated: boolean
          alert_types: string[]
          canonical_person_id: string
          evidence_photos: string[]
          geofence_validated: boolean
          id: string
          identification_method: string
          is_minor_record: boolean
          match_confidence: number
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
      get_platform_stats: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
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
          parent_zone_id: string
          self_contained_required: boolean
          zone_id: string
          zone_name: string
          zone_type: string
        }[]
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
      is_zone_seasonally_open: { Args: { p_zone_id: string }; Returns: boolean }
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
      match_face: {
        Args: {
          p_embedding: number[]
          p_k?: number
          p_min_quality?: number
          p_org_id: string
        }
        Returns: {
          face_count: number
          face_created_at: string
          face_record_id: string
          faces: Json
          label: string
          notes: string
          person_date_of_birth: string
          person_full_name: string
          person_homeless_status: string
          person_is_of_interest: boolean
          person_notes: string
          person_record_id: string
          person_risk_level: string
          person_trespass_date: string
          person_trespass_issued: boolean
          photo_url: string
          similarity: number
        }[]
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
      next_noise_job_number: { Args: { p_org_id: string }; Returns: string }
      next_noise_notice_number: { Args: { p_org_id: string }; Returns: string }
      next_noise_seizure_number: { Args: { p_org_id: string }; Returns: string }
      next_parking_infringement_number: {
        Args: { p_org_id: string }
        Returns: string
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
      reassign_observations_to_current_zones: {
        Args: {
          p_apply?: boolean
          p_legacy_only?: boolean
          p_limit?: number
          p_recorded_by?: string
          p_update_recorded_by?: boolean
        }
        Returns: {
          candidates: number
          cross_org_moves: number
          recorded_by_updates: number
          scanned: number
          unresolved: number
          updatable: number
          updated: number
        }[]
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
      set_org_geometry: {
        Args: { geojson: Json; org_id: string }
        Returns: undefined
      }
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
