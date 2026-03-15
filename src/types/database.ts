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
          address: string | null
          enforcement_workflow: string
          overnight_verification_mode: 'two_photo_verification' | 'one_photo_per_day_inference'
          is_active: boolean
          logo_url: string | null
          requires_coa: boolean
          requires_warrant_for_enforcement: boolean
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
          address?: string | null
          enforcement_workflow?: string
          overnight_verification_mode?: 'two_photo_verification' | 'one_photo_per_day_inference'
          is_active?: boolean
          logo_url?: string | null
          requires_coa?: boolean
          requires_warrant_for_enforcement?: boolean
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
          address?: string | null
          enforcement_workflow?: string
          overnight_verification_mode?: 'two_photo_verification' | 'one_photo_per_day_inference'
          is_active?: boolean
          logo_url?: string | null
          requires_coa?: boolean
          requires_warrant_for_enforcement?: boolean
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
          last_gps_latitude: number | null
          last_gps_longitude: number | null
          last_gps_accuracy: number | null
          last_gps_update: string | null
          authorized_activities: any
          issuing_authority: string | null
          coa_license_type: string | null
          warrant_acts: string[]
          credentials_verified: boolean
          credentials_verified_at: string | null
          credentials_verified_by: string | null
          coa_number: string | null
          coa_expiry_date: string | null
          coa_document_url: string | null
          coa_required: boolean
          coa_verified: boolean
          coa_expiry: string | null
          has_warrant: boolean
          warrant_number: string | null
          warrant_expiry_date: string | null
          warrant_document_url: string | null
          warrant_required: boolean
          warrant_verified: boolean
          warrant_expiry: string | null
          compliance_status: string
          last_location: any
          portal_used: string | null
          push_token: string | null
          push_token_updated_at: string | null
          notification_preferences: any
          bio: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          profile_photo_url: string | null
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
          last_gps_latitude?: number | null
          last_gps_longitude?: number | null
          last_gps_accuracy?: number | null
          last_gps_update?: string | null
          authorized_activities?: any
          issuing_authority?: string | null
          coa_license_type?: string | null
          warrant_acts?: string[]
          credentials_verified?: boolean
          credentials_verified_at?: string | null
          credentials_verified_by?: string | null
          coa_number?: string | null
          coa_expiry_date?: string | null
          coa_document_url?: string | null
          coa_required?: boolean
          coa_verified?: boolean
          coa_expiry?: string | null
          has_warrant?: boolean
          warrant_number?: string | null
          warrant_expiry_date?: string | null
          warrant_document_url?: string | null
          warrant_required?: boolean
          warrant_verified?: boolean
          warrant_expiry?: string | null
          compliance_status?: string
          last_location?: any
          portal_used?: string | null
          push_token?: string | null
          push_token_updated_at?: string | null
          notification_preferences?: any
          bio?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          profile_photo_url?: string | null
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
          last_gps_latitude?: number | null
          last_gps_longitude?: number | null
          last_gps_accuracy?: number | null
          last_gps_update?: string | null
          authorized_activities?: any
          issuing_authority?: string | null
          coa_license_type?: string | null
          warrant_acts?: string[]
          credentials_verified?: boolean
          credentials_verified_at?: string | null
          credentials_verified_by?: string | null
          coa_number?: string | null
          coa_expiry_date?: string | null
          coa_document_url?: string | null
          coa_required?: boolean
          coa_verified?: boolean
          coa_expiry?: string | null
          has_warrant?: boolean
          warrant_number?: string | null
          warrant_expiry_date?: string | null
          warrant_document_url?: string | null
          warrant_required?: boolean
          warrant_verified?: boolean
          warrant_expiry?: string | null
          compliance_status?: string
          last_location?: any
          portal_used?: string | null
          push_token?: string | null
          push_token_updated_at?: string | null
          notification_preferences?: any
          bio?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          profile_photo_url?: string | null
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
        // Live schema verified 2026-03-13 — PK is plate_number, UUID is vehicle_id
        Row: {
          plate_number: string
          vehicle_id: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_color: string | null
          vehicle_year: number | null        // INTEGER (normalized in 20260411000003)
          self_contained: boolean
          self_contained_expiry: string | null
          nzscv_warrant_type: string | null
          nzscv_lookup_at: string | null
          homeless_status: string
          is_homeless: boolean
          homeless_confirmed: boolean
          homeless_confirmed_by: string | null
          homeless_confirmed_at: string | null
          homeless_notes: string | null
          is_flagged: boolean
          flagged_priority: string | null
          flagged_reason: string | null
          flagged_notes: string | null
          flagged_at: string | null
          flagged_by: string | null
          owner_first_name: string | null
          owner_last_name: string | null
          owner_company_name: string | null
          owner_address: string | null
          owner_address_verified: boolean
          profile_photo: string | null
          profile_photo_url: string | null
          profile_photo_score: number | null
          profile_photo_updated_at: string | null
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
          fc_act_exempt: boolean
          is_exempt: boolean
          parkpow_vehicle_id: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          plate_number: string
          vehicle_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_color?: string | null
          vehicle_year?: number | null
          self_contained?: boolean
          self_contained_expiry?: string | null
          nzscv_warrant_type?: string | null
          nzscv_lookup_at?: string | null
          homeless_status?: string
          is_homeless?: boolean
          homeless_confirmed?: boolean
          homeless_confirmed_by?: string | null
          homeless_confirmed_at?: string | null
          homeless_notes?: string | null
          is_flagged?: boolean
          flagged_priority?: string | null
          flagged_reason?: string | null
          flagged_notes?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          owner_first_name?: string | null
          owner_last_name?: string | null
          owner_company_name?: string | null
          owner_address?: string | null
          owner_address_verified?: boolean
          profile_photo?: string | null
          profile_photo_url?: string | null
          profile_photo_score?: number | null
          profile_photo_updated_at?: string | null
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
          fc_act_exempt?: boolean
          is_exempt?: boolean
          parkpow_vehicle_id?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          plate_number?: string
          vehicle_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_color?: string | null
          vehicle_year?: number | null
          self_contained?: boolean
          self_contained_expiry?: string | null
          nzscv_warrant_type?: string | null
          nzscv_lookup_at?: string | null
          homeless_status?: string
          is_homeless?: boolean
          homeless_confirmed?: boolean
          homeless_confirmed_by?: string | null
          homeless_confirmed_at?: string | null
          homeless_notes?: string | null
          is_flagged?: boolean
          flagged_priority?: string | null
          flagged_reason?: string | null
          flagged_notes?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          owner_first_name?: string | null
          owner_last_name?: string | null
          owner_company_name?: string | null
          owner_address?: string | null
          owner_address_verified?: boolean
          profile_photo?: string | null
          profile_photo_url?: string | null
          profile_photo_score?: number | null
          profile_photo_updated_at?: string | null
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
          fc_act_exempt?: boolean
          is_exempt?: boolean
          parkpow_vehicle_id?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      observations: {
        // Live schema verified 2026-03-13 — PK is observation_id, id is nullable secondary
        Row: {
          observation_id: string              // PRIMARY KEY (NOT NULL)
          id: string | null                   // nullable secondary UUID
          idempotency_key: string | null      // nullable; partial unique index (WHERE NOT NULL)
          plate_number: string
          photo: string | null               // primary photo column (legacy)
          photo_url: string | null           // secondary photo column (added later)
          photo_hash: string | null
          recorded_at: string
          zone_id: string
          organization_id: string
          gps_latitude: number | null
          gps_longitude: number | null
          gps_accuracy: number | null
          recorded_by: string | null
          officer_notes: string | null
          observation_notes: string | null
          portal_used: string | null
          has_notes: boolean
          notes_reference_previous: boolean
          has_hs_incident: boolean
          hs_incident_id: string | null
          has_incident: boolean
          incident_id: string | null
          has_homeless_claim: boolean
          homeless_claim_notes: string | null
          breach_warning: boolean
          breach_warning_reason: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: number | null          // INTEGER in live DB
          vehicle_color: string | null
          self_contained: boolean
          self_contained_expiry: string | null
          is_breach: boolean
          is_compliant: boolean
          breach_type: string | null
          breach_reason: string | null
          breach_details: any | null
          breach_detected_at: string | null
          compliance_snapshot: any | null
          nights_stayed_this_month: number
          consecutive_nights: number
          vehicle_embedding: any | null
          embedding_quality: number | null
          embedding_model_version: string | null
          embedding_created_at: string | null
          parkpow_session_id: number | null
          parkpow_violation_id: number | null
          // AI / inference columns (added by 20260312000010_fix_alpr_inference_columns_schema_cache.sql)
          processing_status: 'pending' | 'processing' | 'completed' | 'failed'
          processing_started_at: string | null
          processing_completed_at: string | null
          processing_error: string | null
          plate_confidence: number | null
          vehicle_make_confidence: number | null
          vehicle_model_confidence: number | null
          vehicle_color_confidence: number | null
          sticker_presence: boolean | null
          sticker_color: 'blue' | 'green' | 'unknown' | null
          sticker_bbox: any | null
          sticker_detection_confidence: number | null
          sticker_color_confidence: number | null
          previous_observation_id: string | null
          movement_moved: boolean | null
          movement_background_similarity: number | null
          movement_vehicle_bbox_iou: number | null
          movement_decision: string | null
          // Discrepancy columns (added by 20260406000001_vehicle_discrepancies.sql)
          has_discrepancies: boolean
          discrepancy_flags: any | null
          zone_name_at_import: string | null
          is_legacy_import: boolean
          legacy_source_tag: string | null
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          observation_id?: string
          id?: string | null
          idempotency_key?: string | null
          plate_number: string
          photo?: string | null
          photo_url?: string | null
          photo_hash?: string | null
          recorded_at: string
          zone_id: string
          organization_id: string
          gps_latitude?: number | null
          gps_longitude?: number | null
          gps_accuracy?: number | null
          recorded_by?: string | null
          officer_notes?: string | null
          observation_notes?: string | null
          portal_used?: string | null
          has_notes?: boolean
          notes_reference_previous?: boolean
          has_hs_incident?: boolean
          hs_incident_id?: string | null
          has_incident?: boolean
          incident_id?: string | null
          has_homeless_claim?: boolean
          homeless_claim_notes?: string | null
          breach_warning?: boolean
          breach_warning_reason?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          vehicle_color?: string | null
          self_contained?: boolean
          self_contained_expiry?: string | null
          is_breach?: boolean
          is_compliant?: boolean
          breach_type?: string | null
          breach_reason?: string | null
          breach_details?: any | null
          breach_detected_at?: string | null
          compliance_snapshot?: any | null
          nights_stayed_this_month?: number
          consecutive_nights?: number
          vehicle_embedding?: any | null
          embedding_quality?: number | null
          embedding_model_version?: string | null
          embedding_created_at?: string | null
          parkpow_session_id?: number | null
          parkpow_violation_id?: number | null
          processing_status?: 'pending' | 'processing' | 'completed' | 'failed'
          processing_started_at?: string | null
          processing_completed_at?: string | null
          processing_error?: string | null
          plate_confidence?: number | null
          vehicle_make_confidence?: number | null
          vehicle_model_confidence?: number | null
          vehicle_color_confidence?: number | null
          sticker_presence?: boolean | null
          sticker_color?: 'blue' | 'green' | 'unknown' | null
          sticker_bbox?: any | null
          sticker_detection_confidence?: number | null
          sticker_color_confidence?: number | null
          previous_observation_id?: string | null
          movement_moved?: boolean | null
          movement_background_similarity?: number | null
          movement_vehicle_bbox_iou?: number | null
          movement_decision?: string | null
          has_discrepancies?: boolean
          discrepancy_flags?: any | null
          zone_name_at_import?: string | null
          is_legacy_import?: boolean
          legacy_source_tag?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          observation_id?: string
          id?: string | null
          idempotency_key?: string | null
          plate_number?: string
          photo?: string | null
          photo_url?: string | null
          photo_hash?: string | null
          recorded_at?: string
          zone_id?: string
          organization_id?: string
          gps_latitude?: number | null
          gps_longitude?: number | null
          gps_accuracy?: number | null
          recorded_by?: string | null
          officer_notes?: string | null
          observation_notes?: string | null
          portal_used?: string | null
          has_notes?: boolean
          notes_reference_previous?: boolean
          has_hs_incident?: boolean
          hs_incident_id?: string | null
          has_incident?: boolean
          incident_id?: string | null
          has_homeless_claim?: boolean
          homeless_claim_notes?: string | null
          breach_warning?: boolean
          breach_warning_reason?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          vehicle_color?: string | null
          self_contained?: boolean
          self_contained_expiry?: string | null
          is_breach?: boolean
          is_compliant?: boolean
          breach_type?: string | null
          breach_reason?: string | null
          breach_details?: any | null
          breach_detected_at?: string | null
          compliance_snapshot?: any | null
          nights_stayed_this_month?: number
          consecutive_nights?: number
          vehicle_embedding?: any | null
          embedding_quality?: number | null
          embedding_model_version?: string | null
          embedding_created_at?: string | null
          parkpow_session_id?: number | null
          parkpow_violation_id?: number | null
          processing_status?: 'pending' | 'processing' | 'completed' | 'failed'
          processing_started_at?: string | null
          processing_completed_at?: string | null
          processing_error?: string | null
          plate_confidence?: number | null
          vehicle_make_confidence?: number | null
          vehicle_model_confidence?: number | null
          vehicle_color_confidence?: number | null
          sticker_presence?: boolean | null
          sticker_color?: 'blue' | 'green' | 'unknown' | null
          sticker_bbox?: any | null
          sticker_detection_confidence?: number | null
          sticker_color_confidence?: number | null
          previous_observation_id?: string | null
          movement_moved?: boolean | null
          movement_background_similarity?: number | null
          movement_vehicle_bbox_iou?: number | null
          movement_decision?: string | null
          has_discrepancies?: boolean
          discrepancy_flags?: any | null
          zone_name_at_import?: string | null
          is_legacy_import?: boolean
          legacy_source_tag?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      // NOTE: observation_jobs table removed. ALPR writes directly to observations.plate_number via UPDATE.
      vehicle_discrepancies: {
        // Added by 20260406000001_vehicle_discrepancies.sql
        Row: {
          id: string
          observation_id: string
          plate_number: string | null
          organization_id: string | null
          zone_id: string | null
          discrepancy_type: 'make_mismatch' | 'model_mismatch' | 'colour_mismatch' | 'plate_mismatch_same_vehicle' | 'sc_sticker_not_in_register' | 'sc_in_register_no_sticker' | 'sc_sticker_inconclusive'
          source_a: 'canonical' | 'nzscv' | 'inference' | 'motorweb' | 'alpr' | 'observation'
          source_b: 'canonical' | 'nzscv' | 'inference' | 'motorweb' | 'alpr' | 'observation'
          value_a: string | null
          value_b: string | null
          severity: 'warning' | 'critical'
          sc_law_active: boolean
          details: any | null
          requires_review: boolean
          reviewed_at: string | null
          reviewed_by: string | null
          review_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          observation_id: string
          plate_number?: string | null
          organization_id?: string | null
          zone_id?: string | null
          discrepancy_type: 'make_mismatch' | 'model_mismatch' | 'colour_mismatch' | 'plate_mismatch_same_vehicle' | 'sc_sticker_not_in_register' | 'sc_in_register_no_sticker' | 'sc_sticker_inconclusive'
          source_a: 'canonical' | 'nzscv' | 'inference' | 'motorweb' | 'alpr' | 'observation'
          source_b: 'canonical' | 'nzscv' | 'inference' | 'motorweb' | 'alpr' | 'observation'
          value_a?: string | null
          value_b?: string | null
          severity?: 'warning' | 'critical'
          sc_law_active?: boolean
          details?: any | null
          requires_review?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          review_notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          observation_id?: string
          plate_number?: string | null
          organization_id?: string | null
          zone_id?: string | null
          discrepancy_type?: 'make_mismatch' | 'model_mismatch' | 'colour_mismatch' | 'plate_mismatch_same_vehicle' | 'sc_sticker_not_in_register' | 'sc_in_register_no_sticker' | 'sc_sticker_inconclusive'
          source_a?: 'canonical' | 'nzscv' | 'inference' | 'motorweb' | 'alpr' | 'observation'
          source_b?: 'canonical' | 'nzscv' | 'inference' | 'motorweb' | 'alpr' | 'observation'
          value_a?: string | null
          value_b?: string | null
          severity?: 'warning' | 'critical'
          sc_law_active?: boolean
          details?: any | null
          requires_review?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          review_notes?: string | null
          created_at?: string
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
          status: string
          notes: string | null
          description: string | null
          priority: 'low' | 'normal' | 'high' | 'urgent'
          recurrence: 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly'
          scheduled_start_time: string | null
          scheduled_end_time: string | null
          actual_start_time: string | null
          actual_end_time: string | null
          started_at: string | null
          ended_at: string | null
          vehicles_checked: number
          breaches_found: number
          duration_minutes: number | null
          shift_id: string | null
          notification_sent: boolean
          notification_sent_at: string | null
          officer_accepted: boolean | null
          officer_accepted_at: string | null
          officer_declined: boolean
          officer_decline_reason: string | null
          auto_checkin_enabled: boolean
          geofence_radius: number
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
          status?: string
          notes?: string | null
          description?: string | null
          priority?: 'low' | 'normal' | 'high' | 'urgent'
          recurrence?: 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly'
          scheduled_start_time?: string | null
          scheduled_end_time?: string | null
          actual_start_time?: string | null
          actual_end_time?: string | null
          started_at?: string | null
          ended_at?: string | null
          vehicles_checked?: number
          breaches_found?: number
          duration_minutes?: number | null
          shift_id?: string | null
          notification_sent?: boolean
          notification_sent_at?: string | null
          officer_accepted?: boolean | null
          officer_accepted_at?: string | null
          officer_declined?: boolean
          officer_decline_reason?: string | null
          auto_checkin_enabled?: boolean
          geofence_radius?: number
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
          status?: string
          notes?: string | null
          description?: string | null
          priority?: 'low' | 'normal' | 'high' | 'urgent'
          recurrence?: 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly'
          scheduled_start_time?: string | null
          scheduled_end_time?: string | null
          actual_start_time?: string | null
          actual_end_time?: string | null
          started_at?: string | null
          ended_at?: string | null
          vehicles_checked?: number
          breaches_found?: number
          duration_minutes?: number | null
          shift_id?: string | null
          notification_sent?: boolean
          notification_sent_at?: string | null
          officer_accepted?: boolean | null
          officer_accepted_at?: string | null
          officer_declined?: boolean
          officer_decline_reason?: string | null
          auto_checkin_enabled?: boolean
          geofence_radius?: number
          created_at?: string
          updated_at?: string
        }
      }
      patrol_schedule_zones: {
        Row: {
          id: string
          patrol_id: string
          zone_id: string
          visit_order: number
          estimated_duration_minutes: number | null
          actual_duration_minutes: number | null
          visited_at: string | null
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          patrol_id: string
          zone_id: string
          visit_order?: number
          estimated_duration_minutes?: number | null
          actual_duration_minutes?: number | null
          visited_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          patrol_id?: string
          zone_id?: string
          visit_order?: number
          estimated_duration_minutes?: number | null
          actual_duration_minutes?: number | null
          visited_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
      }
      patrol_checkpoints: {
        Row: {
          id: string
          organization_id: string
          zone_id: string | null
          name: string
          description: string | null
          location_lat: number | null
          location_lng: number | null
          qr_code: string
          nfc_tag_id: string | null
          is_active: boolean
          required_on_patrol: boolean
          check_in_radius_metres: number
          created_by: string | null
          checkpoint_type: 'manual' | 'geofence_zone'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          zone_id?: string | null
          name: string
          description?: string | null
          location_lat?: number | null
          location_lng?: number | null
          qr_code: string
          nfc_tag_id?: string | null
          is_active?: boolean
          required_on_patrol?: boolean
          check_in_radius_metres?: number
          created_by?: string | null
          checkpoint_type?: 'manual' | 'geofence_zone'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          zone_id?: string | null
          name?: string
          description?: string | null
          location_lat?: number | null
          location_lng?: number | null
          qr_code?: string
          nfc_tag_id?: string | null
          is_active?: boolean
          required_on_patrol?: boolean
          check_in_radius_metres?: number
          created_by?: string | null
          checkpoint_type?: 'manual' | 'geofence_zone'
          created_at?: string
          updated_at?: string
        }
      }
      checkpoint_visits: {
        Row: {
          id: string
          checkpoint_id: string
          officer_id: string
          patrol_id: string | null
          organization_id: string
          scan_method: 'qr_camera' | 'nfc' | 'manual_code' | 'url_deep_link'
          gps_latitude: number | null
          gps_longitude: number | null
          gps_accuracy: number | null
          gps_distance_from_checkpoint: number | null
          within_radius: boolean | null
          visited_at: string
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          checkpoint_id: string
          officer_id: string
          patrol_id?: string | null
          organization_id: string
          scan_method: 'qr_camera' | 'nfc' | 'manual_code' | 'url_deep_link'
          gps_latitude?: number | null
          gps_longitude?: number | null
          gps_accuracy?: number | null
          gps_distance_from_checkpoint?: number | null
          visited_at?: string
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          checkpoint_id?: string
          officer_id?: string
          patrol_id?: string | null
          organization_id?: string
          scan_method?: 'qr_camera' | 'nfc' | 'manual_code' | 'url_deep_link'
          gps_latitude?: number | null
          gps_longitude?: number | null
          gps_accuracy?: number | null
          gps_distance_from_checkpoint?: number | null
          visited_at?: string
          notes?: string | null
          created_at?: string
        }
      }
      officer_shifts: {
        Row: {
          id: string
          officer_id: string
          organization_id: string
          parent_zone_id: string | null
          started_at: string
          ended_at: string | null
          end_reason: 'logout' | 'app_timeout' | 'manual' | 'zone_exit' | null
          gps_start_lat: number | null
          gps_start_lng: number | null
          gps_end_lat: number | null
          gps_end_lng: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          officer_id: string
          organization_id: string
          parent_zone_id?: string | null
          started_at?: string
          ended_at?: string | null
          end_reason?: 'logout' | 'app_timeout' | 'manual' | 'zone_exit' | null
          gps_start_lat?: number | null
          gps_start_lng?: number | null
          gps_end_lat?: number | null
          gps_end_lng?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          officer_id?: string
          organization_id?: string
          parent_zone_id?: string | null
          started_at?: string
          ended_at?: string | null
          end_reason?: 'logout' | 'app_timeout' | 'manual' | 'zone_exit' | null
          gps_start_lat?: number | null
          gps_start_lng?: number | null
          gps_end_lat?: number | null
          gps_end_lng?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      patrol_site_visits: {
        Row: {
          id: string
          officer_id: string
          organization_id: string
          shift_id: string | null
          zone_id: string
          entered_at: string
          exited_at: string | null
          gps_entry_lat: number | null
          gps_entry_lng: number | null
          gps_exit_lat: number | null
          gps_exit_lng: number | null
          created_at: string
        }
        Insert: {
          id?: string
          officer_id: string
          organization_id: string
          shift_id?: string | null
          zone_id: string
          entered_at?: string
          exited_at?: string | null
          gps_entry_lat?: number | null
          gps_entry_lng?: number | null
          gps_exit_lat?: number | null
          gps_exit_lng?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          officer_id?: string
          organization_id?: string
          shift_id?: string | null
          zone_id?: string
          entered_at?: string
          exited_at?: string | null
          gps_entry_lat?: number | null
          gps_entry_lng?: number | null
          gps_exit_lat?: number | null
          gps_exit_lng?: number | null
          created_at?: string
        }
      }
      privacy_curtain_settings: {
        Row: {
          id: string
          organization_id: string
          auto_redact_enabled: boolean
          redact_owner_name: boolean
          redact_owner_address: boolean
          redact_phone_number: boolean
          redact_plate_in_exports: boolean
          require_reason_for_unredact: boolean
          unredact_roles: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          auto_redact_enabled?: boolean
          redact_owner_name?: boolean
          redact_owner_address?: boolean
          redact_phone_number?: boolean
          redact_plate_in_exports?: boolean
          require_reason_for_unredact?: boolean
          unredact_roles?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          auto_redact_enabled?: boolean
          redact_owner_name?: boolean
          redact_owner_address?: boolean
          redact_phone_number?: boolean
          redact_plate_in_exports?: boolean
          require_reason_for_unredact?: boolean
          unredact_roles?: string[]
          created_at?: string
          updated_at?: string
        }
      }
      privacy_access_log: {
        Row: {
          id: string
          organization_id: string
          actor: string
          target_table: string
          target_record_id: string
          field_accessed: string
          access_reason: string | null
          ip_address: string | null
          user_agent: string | null
          accessed_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          actor: string
          target_table: string
          target_record_id: string
          field_accessed: string
          access_reason?: string | null
          ip_address?: string | null
          user_agent?: string | null
          accessed_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          actor?: string
          target_table?: string
          target_record_id?: string
          field_accessed?: string
          access_reason?: string | null
          ip_address?: string | null
          user_agent?: string | null
          accessed_at?: string
        }
      }
      enforcement_actions: {
        Row: {
          id: string
          organization_id: string
          zone_id: string
          vehicle_record_id: string | null
          observation_id: string | null
          plate_number: string | null
          action_type: string
          status: string
          notes: string | null
          created_by: string | null
          compliance_result_id: string | null
          assigned_to: string | null
          assigned_at: string | null
          assigned_by: string | null
          completed_by: string | null
          completed_at: string | null
          completion_outcome: string | null
          completion_notes: string | null
          breach_status: string
          attachments: any
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          zone_id: string
          vehicle_record_id?: string | null
          observation_id?: string | null
          plate_number?: string | null
          action_type: string
          status?: string
          notes?: string | null
          created_by?: string | null
          compliance_result_id?: string | null
          assigned_to?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          completed_by?: string | null
          completed_at?: string | null
          completion_outcome?: string | null
          completion_notes?: string | null
          breach_status?: string
          attachments?: any
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          zone_id?: string
          vehicle_record_id?: string | null
          observation_id?: string | null
          plate_number?: string | null
          action_type?: string
          status?: string
          notes?: string | null
          created_by?: string | null
          compliance_result_id?: string | null
          assigned_to?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          completed_by?: string | null
          completed_at?: string | null
          completion_outcome?: string | null
          completion_notes?: string | null
          breach_status?: string
          attachments?: any
          created_at?: string
          updated_at?: string
        }
      }
      health_safety_reports: {
        Row: {
          id: string
          organization_id: string
          zone_id: string | null
          reported_by: string | null
          incident_type: string | null
          description: string | null
          severity: string | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          zone_id?: string | null
          reported_by?: string | null
          incident_type?: string | null
          description?: string | null
          severity?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          zone_id?: string | null
          reported_by?: string | null
          incident_type?: string | null
          description?: string | null
          severity?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
      }
      officer_welfare_alerts: {
        Row: {
          id: string
          officer_id: string
          organization_id: string
          alert_type: string
          status: string
          officer_name: string | null
          officer_phone: string | null
          gps_latitude: number | null
          gps_longitude: number | null
          gps_accuracy: number | null
          last_activity_at: string | null
          alert_sent_at: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          escalation_level: number
          escalated_at: string | null
          acknowledgement_notes: string | null
          resolution_notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          officer_id: string
          organization_id: string
          alert_type: string
          status?: string
          officer_name?: string | null
          officer_phone?: string | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          gps_accuracy?: number | null
          last_activity_at?: string | null
          alert_sent_at?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          escalation_level?: number
          escalated_at?: string | null
          acknowledgement_notes?: string | null
          resolution_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          officer_id?: string
          organization_id?: string
          alert_type?: string
          status?: string
          officer_name?: string | null
          officer_phone?: string | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          gps_accuracy?: number | null
          last_activity_at?: string | null
          alert_sent_at?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          escalation_level?: number
          escalated_at?: string | null
          acknowledgement_notes?: string | null
          resolution_notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      compliance_results: {
        Row: {
          id: string
          observation_id: string | null
          vehicle_id: string | null
          zone_id: string | null
          organization_id: string | null
          matrix_id: string | null
          matrix_version: number | null
          is_compliant: boolean
          violation_type: string | null
          violation_reasons: string[] | null
          metrics_json: any | null
          matrix_snapshot: any | null
          evaluated_at: string
          after_hours_violation: boolean
          stay_confirmed_by_gps: boolean
          gps_distance_meters: number | null
          gps_verified_consecutive_nights: number
          gps_evidence_json: any
          fc_act_exempt: boolean
          exemption_reason: string | null
          is_exempt: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          observation_id?: string | null
          vehicle_id?: string | null
          zone_id?: string | null
          organization_id?: string | null
          matrix_id?: string | null
          matrix_version?: number | null
          is_compliant?: boolean
          violation_type?: string | null
          violation_reasons?: string[] | null
          metrics_json?: any | null
          matrix_snapshot?: any | null
          evaluated_at?: string
          after_hours_violation?: boolean
          stay_confirmed_by_gps?: boolean
          gps_distance_meters?: number | null
          gps_verified_consecutive_nights?: number
          gps_evidence_json?: any
          fc_act_exempt?: boolean
          exemption_reason?: string | null
          is_exempt?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          observation_id?: string | null
          vehicle_id?: string | null
          zone_id?: string | null
          organization_id?: string | null
          matrix_id?: string | null
          matrix_version?: number | null
          is_compliant?: boolean
          violation_type?: string | null
          violation_reasons?: string[] | null
          metrics_json?: any | null
          matrix_snapshot?: any | null
          evaluated_at?: string
          after_hours_violation?: boolean
          stay_confirmed_by_gps?: boolean
          gps_distance_meters?: number | null
          gps_verified_consecutive_nights?: number
          gps_evidence_json?: any
          fc_act_exempt?: boolean
          exemption_reason?: string | null
          is_exempt?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      incidents: {
        Row: {
          id: string
          organization_id: string
          zone_id: string | null
          reported_by: string | null
          incident_type: string | null
          description: string | null
          severity: string | null
          status: string
          plate_number: string | null
          evidence_count: number
          primary_evidence_url: string | null
          location_lat: number | null
          location_lng: number | null
          location_address: string | null
          notes: string | null
          metadata: any
          user_id: string | null
          retention_hold: boolean
          retention_until: string | null
          retention_notes: string | null
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          zone_id?: string | null
          reported_by?: string | null
          incident_type?: string | null
          description?: string | null
          severity?: string | null
          status?: string
          plate_number?: string | null
          evidence_count?: number
          primary_evidence_url?: string | null
          location_lat?: number | null
          location_lng?: number | null
          location_address?: string | null
          notes?: string | null
          metadata?: any
          user_id?: string | null
          retention_hold?: boolean
          retention_until?: string | null
          retention_notes?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          zone_id?: string | null
          reported_by?: string | null
          incident_type?: string | null
          description?: string | null
          severity?: string | null
          status?: string
          plate_number?: string | null
          evidence_count?: number
          primary_evidence_url?: string | null
          location_lat?: number | null
          location_lng?: number | null
          location_address?: string | null
          notes?: string | null
          metadata?: any
          user_id?: string | null
          retention_hold?: boolean
          retention_until?: string | null
          retention_notes?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      audit_log: {
        Row: {
          id: string
          action: string
          entity_type: string | null
          entity_id: string | null
          old_values: any
          new_values: any
          performed_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          action: string
          entity_type?: string | null
          entity_id?: string | null
          old_values?: any
          new_values?: any
          performed_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          action?: string
          entity_type?: string | null
          entity_id?: string | null
          old_values?: any
          new_values?: any
          performed_by?: string | null
          created_at?: string
        }
      }
      flagged_vehicles: {
        Row: {
          id: string
          organization_id: string | null
          plate_number: string
          reason: string | null
          priority: 'low' | 'medium' | 'high' | 'critical' | null
          flagged_by: string | null
          // Columns added by 20260415000001_flagged_vehicles_missing_columns.sql
          notes: string | null
          is_active: boolean
          last_known_site: string | null
          date_recorded: string | null
          vehicle_description: string | null
          name_contact: string | null
          confirmed_homeless: boolean | null
          created_by: string | null
          attachments: any
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id?: string | null
          plate_number: string
          reason?: string | null
          priority?: 'low' | 'medium' | 'high' | 'critical' | null
          flagged_by?: string | null
          notes?: string | null
          is_active?: boolean
          last_known_site?: string | null
          date_recorded?: string | null
          vehicle_description?: string | null
          name_contact?: string | null
          confirmed_homeless?: boolean | null
          created_by?: string | null
          attachments?: any
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string | null
          plate_number?: string
          reason?: string | null
          priority?: 'low' | 'medium' | 'high' | 'critical' | null
          flagged_by?: string | null
          notes?: string | null
          is_active?: boolean
          last_known_site?: string | null
          date_recorded?: string | null
          vehicle_description?: string | null
          name_contact?: string | null
          confirmed_homeless?: boolean | null
          created_by?: string | null
          attachments?: any
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flagged_vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flagged_vehicles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      plate_scans: {
        Row: {
          id: string
          organization_id: string
          zone_id: string | null
          scanned_by: string | null
          plate_number: string | null
          scan_mode: string
          scanned_photo: string | null
          confidence_score: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          gps_accuracy: number | null
          ai_vehicle_make: string | null
          ai_vehicle_model: string | null
          ai_vehicle_color: string | null
          reviewed: boolean
          review_action: string | null
          flagged_vehicle_detected: boolean
          breach_detected: boolean
          violation_summary: string | null
          scanned_at: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          zone_id?: string | null
          scanned_by?: string | null
          plate_number?: string | null
          scan_mode?: string
          scanned_photo?: string | null
          confidence_score?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          gps_accuracy?: number | null
          ai_vehicle_make?: string | null
          ai_vehicle_model?: string | null
          ai_vehicle_color?: string | null
          reviewed?: boolean
          review_action?: string | null
          flagged_vehicle_detected?: boolean
          breach_detected?: boolean
          violation_summary?: string | null
          scanned_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          zone_id?: string | null
          scanned_by?: string | null
          plate_number?: string | null
          scan_mode?: string
          scanned_photo?: string | null
          confidence_score?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          gps_accuracy?: number | null
          ai_vehicle_make?: string | null
          ai_vehicle_model?: string | null
          ai_vehicle_color?: string | null
          reviewed?: boolean
          review_action?: string | null
          flagged_vehicle_detected?: boolean
          breach_detected?: boolean
          violation_summary?: string | null
          scanned_at?: string
          created_at?: string
        }
      }
      canonical_persons: {
        Row: {
          id: string
          full_name: string
          date_of_birth: string | null
          contact_email: string | null
          contact_phone: string | null
          address: string | null
          homeless_status: string | null
          homeless_confirmed_at: string | null
          homeless_confirmed_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          full_name: string
          date_of_birth?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          address?: string | null
          homeless_status?: string | null
          homeless_confirmed_at?: string | null
          homeless_confirmed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          date_of_birth?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          address?: string | null
          homeless_status?: string | null
          homeless_confirmed_at?: string | null
          homeless_confirmed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      person_observations: {
        Row: {
          id: string
          person_id: string | null
          organization_id: string | null
          zone_id: string | null
          observed_by: string | null
          observed_at: string
          gps_latitude: number | null
          gps_longitude: number | null
          notes: string | null
          attachments: any
          created_at: string
        }
        Insert: {
          id?: string
          person_id?: string | null
          organization_id?: string | null
          zone_id?: string | null
          observed_by?: string | null
          observed_at: string
          gps_latitude?: number | null
          gps_longitude?: number | null
          notes?: string | null
          attachments?: any
          created_at?: string
        }
        Update: {
          id?: string
          person_id?: string | null
          organization_id?: string | null
          zone_id?: string | null
          observed_by?: string | null
          observed_at?: string
          gps_latitude?: number | null
          gps_longitude?: number | null
          notes?: string | null
          attachments?: any
          created_at?: string
        }
      }
      officer_welfare_settings: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          auto_logoff_enabled: boolean
          welfare_check_enabled: boolean
          inactivity_warning_time: number
          auto_logoff_time: number
          gps_inactivity_threshold: number
          admin_escalation_time: number
          critical_escalation_time: number
          investigation_exception_enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          auto_logoff_enabled?: boolean
          welfare_check_enabled?: boolean
          inactivity_warning_time?: number
          auto_logoff_time?: number
          gps_inactivity_threshold?: number
          admin_escalation_time?: number
          critical_escalation_time?: number
          investigation_exception_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          auto_logoff_enabled?: boolean
          welfare_check_enabled?: boolean
          inactivity_warning_time?: number
          auto_logoff_time?: number
          gps_inactivity_threshold?: number
          admin_escalation_time?: number
          critical_escalation_time?: number
          investigation_exception_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      investigation_jobs: {
        Row: {
          id: string
          organization_id: string
          zone_id: string | null
          assigned_to: string | null
          job_type: string | null
          title: string | null
          description: string | null
          status: string
          priority: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          zone_id?: string | null
          assigned_to?: string | null
          job_type?: string | null
          title?: string | null
          description?: string | null
          status?: string
          priority?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          zone_id?: string | null
          assigned_to?: string | null
          job_type?: string | null
          title?: string | null
          description?: string | null
          status?: string
          priority?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      incident_attachments: {
        Row: {
          id: string
          incident_id: string | null
          file_url: string
          file_name: string
          file_type: string
          file_hash: string | null
          uploaded_by: string | null
          uploaded_at: string
        }
        Insert: {
          id?: string
          incident_id?: string | null
          file_url: string
          file_name: string
          file_type: string
          file_hash?: string | null
          uploaded_by?: string | null
          uploaded_at?: string
        }
        Update: {
          id?: string
          incident_id?: string | null
          file_url?: string
          file_name?: string
          file_type?: string
          file_hash?: string | null
          uploaded_by?: string | null
          uploaded_at?: string
        }
      }
      import_batches: {
        Row: {
          id: string
          organization_id: string
          uploaded_by: string
          batch_name: string
          file_name: string | null
          file_size_bytes: number | null
          status: string
          total_records: number
          processed_records: number
          successful_records: number
          failed_records: number
          zones_created: number
          parsed_records: number
          plates_enriched: number
          vehicles_enriched: number
          homeless_inferred: number
          hs_issues_inferred: number
          created_at: string
          started_at: string | null
          completed_at: string | null
          error_summary: string | null
          import_config: any
        }
        Insert: {
          id?: string
          organization_id: string
          uploaded_by: string
          batch_name: string
          file_name?: string | null
          file_size_bytes?: number | null
          status?: string
          total_records?: number
          processed_records?: number
          successful_records?: number
          failed_records?: number
          zones_created?: number
          parsed_records?: number
          plates_enriched?: number
          vehicles_enriched?: number
          homeless_inferred?: number
          hs_issues_inferred?: number
          created_at?: string
          started_at?: string | null
          completed_at?: string | null
          error_summary?: string | null
          import_config?: any
        }
        Update: {
          id?: string
          organization_id?: string
          uploaded_by?: string
          batch_name?: string
          file_name?: string | null
          file_size_bytes?: number | null
          status?: string
          total_records?: number
          processed_records?: number
          successful_records?: number
          failed_records?: number
          zones_created?: number
          parsed_records?: number
          plates_enriched?: number
          vehicles_enriched?: number
          homeless_inferred?: number
          hs_issues_inferred?: number
          created_at?: string
          started_at?: string | null
          completed_at?: string | null
          error_summary?: string | null
          import_config?: any
        }
      }
      // ── Missing tables added to match actual database schema ──────────────

      notifications: {
        Row: {
          id: string
          user_id: string
          type: 'breach_alert' | 'investigation_assigned' | 'flagged_vehicle' | 'welfare_alert' | 'system_alert'
          title: string
          body: string
          data: any | null
          priority: 'low' | 'normal' | 'high' | 'urgent'
          read: boolean
          read_at: string | null
          delivered: boolean
          delivered_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: 'breach_alert' | 'investigation_assigned' | 'flagged_vehicle' | 'welfare_alert' | 'system_alert'
          title: string
          body: string
          data?: any | null
          priority?: 'low' | 'normal' | 'high' | 'urgent'
          read?: boolean
          read_at?: string | null
          delivered?: boolean
          delivered_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: 'breach_alert' | 'investigation_assigned' | 'flagged_vehicle' | 'welfare_alert' | 'system_alert'
          title?: string
          body?: string
          data?: any | null
          priority?: 'low' | 'normal' | 'high' | 'urgent'
          read?: boolean
          read_at?: string | null
          delivered?: boolean
          delivered_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          id: string
          user_id: string
          device_name: string | null
          device_platform: string | null
          ip_address: string | null
          last_seen_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          device_name?: string | null
          device_platform?: string | null
          ip_address?: string | null
          last_seen_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          device_name?: string | null
          device_platform?: string | null
          ip_address?: string | null
          last_seen_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      homeless_records: {
        Row: {
          id: string
          organization_id: string
          plate_number: string
          status: 'claimed' | 'confirmed' | 'suspected' | 'declined'
          source: string
          notes: string | null
          first_reported_at: string
          last_reported_at: string
          is_active: boolean
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          plate_number: string
          status: 'claimed' | 'confirmed' | 'suspected' | 'declined'
          source?: string
          notes?: string | null
          first_reported_at?: string
          last_reported_at?: string
          is_active?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          plate_number?: string
          status?: 'claimed' | 'confirmed' | 'suspected' | 'declined'
          source?: string
          notes?: string | null
          first_reported_at?: string
          last_reported_at?: string
          is_active?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      officer_activity_log: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          activity_type: string
          gps_latitude: number | null
          gps_longitude: number | null
          gps_accuracy: number | null
          metadata: any | null
          recorded_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          activity_type: string
          gps_latitude?: number | null
          gps_longitude?: number | null
          gps_accuracy?: number | null
          metadata?: any | null
          recorded_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string
          activity_type?: string
          gps_latitude?: number | null
          gps_longitude?: number | null
          gps_accuracy?: number | null
          metadata?: any | null
          recorded_at?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      person_vehicle_links: {
        Row: {
          id: string
          person_id: string | null
          plate_number: string | null
          relationship_type: string | null
          confidence: string | null
          linked_at: string | null
          linked_by: string | null
        }
        Insert: {
          id?: string
          person_id?: string | null
          plate_number?: string | null
          relationship_type?: string | null
          confidence?: string | null
          linked_at?: string | null
          linked_by?: string | null
        }
        Update: {
          id?: string
          person_id?: string | null
          plate_number?: string | null
          relationship_type?: string | null
          confidence?: string | null
          linked_at?: string | null
          linked_by?: string | null
        }
        Relationships: []
      }
      infringement_notices: {
        Row: {
          id: string
          organization_id: string | null
          case_id: string | null
          notice_number: string
          notice_type: string | null
          plate_number: string | null
          offence_description: string | null
          legal_basis: string | null
          offence_date: string | null
          offence_location: string | null
          offence_location_gps: string | null
          zone_id: string | null
          observation_id: string | null
          breach_alert_id: string | null
          amount_cents: number | null
          fee_amount: number | null
          due_date: string | null
          payment_deadline: string | null
          payment_methods: any | null
          payment_reference: string | null
          service_method: 'hand' | 'post' | 'email' | null
          summary_of_rights: string | null
          delivery_evidence: any | null
          recipient_name: string | null
          recipient_address: string | null
          recipient_email: string | null
          served_at: string | null
          status: 'draft' | 'issued' | 'paid' | 'reminder_sent' | 'court_referred' | 'withdrawn' | 'cancelled'
          issued_by: string | null
          issued_at: string | null
          created_by: string | null
          reminder_sent_at: string | null
          court_referral_date: string | null
          withdrawn_reason: string | null
          notice_pdf_url: string | null
          notice_pdf_hash: string | null
          evidence_bundle_url: string | null
          evidence_bundle_hash: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          organization_id?: string | null
          case_id?: string | null
          notice_number: string
          notice_type?: string | null
          plate_number?: string | null
          offence_description?: string | null
          legal_basis?: string | null
          offence_date?: string | null
          offence_location?: string | null
          offence_location_gps?: string | null
          zone_id?: string | null
          observation_id?: string | null
          breach_alert_id?: string | null
          amount_cents?: number | null
          fee_amount?: number | null
          due_date?: string | null
          payment_deadline?: string | null
          payment_methods?: any | null
          payment_reference?: string | null
          service_method?: 'hand' | 'post' | 'email' | null
          summary_of_rights?: string | null
          delivery_evidence?: any | null
          recipient_name?: string | null
          recipient_address?: string | null
          recipient_email?: string | null
          served_at?: string | null
          status?: 'draft' | 'issued' | 'paid' | 'reminder_sent' | 'court_referred' | 'withdrawn' | 'cancelled'
          issued_by?: string | null
          issued_at?: string | null
          created_by?: string | null
          reminder_sent_at?: string | null
          court_referral_date?: string | null
          withdrawn_reason?: string | null
          notice_pdf_url?: string | null
          notice_pdf_hash?: string | null
          evidence_bundle_url?: string | null
          evidence_bundle_hash?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          organization_id?: string | null
          case_id?: string | null
          notice_number?: string
          notice_type?: string | null
          plate_number?: string | null
          offence_description?: string | null
          legal_basis?: string | null
          offence_date?: string | null
          offence_location?: string | null
          offence_location_gps?: string | null
          zone_id?: string | null
          observation_id?: string | null
          breach_alert_id?: string | null
          amount_cents?: number | null
          fee_amount?: number | null
          due_date?: string | null
          payment_deadline?: string | null
          payment_methods?: any | null
          payment_reference?: string | null
          service_method?: 'hand' | 'post' | 'email' | null
          summary_of_rights?: string | null
          delivery_evidence?: any | null
          recipient_name?: string | null
          recipient_address?: string | null
          recipient_email?: string | null
          served_at?: string | null
          status?: 'draft' | 'issued' | 'paid' | 'reminder_sent' | 'court_referred' | 'withdrawn' | 'cancelled'
          issued_by?: string | null
          issued_at?: string | null
          created_by?: string | null
          reminder_sent_at?: string | null
          court_referral_date?: string | null
          withdrawn_reason?: string | null
          notice_pdf_url?: string | null
          notice_pdf_hash?: string | null
          evidence_bundle_url?: string | null
          evidence_bundle_hash?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      notices_to_vacate: {
        Row: {
          id: string
          reference_number: string
          organization_id: string
          zone_id: string
          vehicle_id: string | null
          plate_number: string
          recipient_name: string | null
          breach_reason: string
          nights_stayed: number | null
          breach_date: string
          breach_details: any | null
          breach_alert_id: string | null
          notice_document_url: string | null
          notice_html: string | null
          delivery_method: string | null
          delivered_to_email: string | null
          delivered_to_officer: string | null
          delivered_at: string | null
          status: string
          issued_by: string
          issued_at: string | null
          authorized_by: string | null
          authorized_at: string | null
          vacate_deadline: string | null
          complied_at: string | null
          compliance_verified_by: string | null
          escalated_at: string | null
          escalation_notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          reference_number: string
          organization_id: string
          zone_id: string
          vehicle_id?: string | null
          plate_number: string
          recipient_name?: string | null
          breach_reason: string
          nights_stayed?: number | null
          breach_date: string
          breach_details?: any | null
          breach_alert_id?: string | null
          notice_document_url?: string | null
          notice_html?: string | null
          delivery_method?: string | null
          delivered_to_email?: string | null
          delivered_to_officer?: string | null
          delivered_at?: string | null
          status?: string
          issued_by: string
          issued_at?: string | null
          authorized_by?: string | null
          authorized_at?: string | null
          vacate_deadline?: string | null
          complied_at?: string | null
          compliance_verified_by?: string | null
          escalated_at?: string | null
          escalation_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          reference_number?: string
          organization_id?: string
          zone_id?: string
          vehicle_id?: string | null
          plate_number?: string
          recipient_name?: string | null
          breach_reason?: string
          nights_stayed?: number | null
          breach_date?: string
          breach_details?: any | null
          breach_alert_id?: string | null
          notice_document_url?: string | null
          notice_html?: string | null
          delivery_method?: string | null
          delivered_to_email?: string | null
          delivered_to_officer?: string | null
          delivered_at?: string | null
          status?: string
          issued_by?: string
          issued_at?: string | null
          authorized_by?: string | null
          authorized_at?: string | null
          vacate_deadline?: string | null
          complied_at?: string | null
          compliance_verified_by?: string | null
          escalated_at?: string | null
          escalation_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_recalculation_actions: {
        Row: {
          id: string
          scope_type: 'ZONE' | 'ORG' | 'BUILD'
          target_zone_ids: string[]
          target_org_ids: string[]
          date_range_start: string | null
          date_range_end: string | null
          performed_by: string
          status: 'running' | 'completed' | 'failed'
          observations_processed: number | null
          compliance_changed: number | null
          drift_events_created: number | null
          error_message: string | null
          started_at: string
          completed_at: string | null
          duration_seconds: number | null
          created_at: string
        }
        Insert: {
          id?: string
          scope_type?: 'ZONE' | 'ORG' | 'BUILD'
          target_zone_ids?: string[]
          target_org_ids?: string[]
          date_range_start?: string | null
          date_range_end?: string | null
          performed_by: string
          status?: 'running' | 'completed' | 'failed'
          observations_processed?: number | null
          compliance_changed?: number | null
          drift_events_created?: number | null
          error_message?: string | null
          started_at?: string
          completed_at?: string | null
          duration_seconds?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          scope_type?: 'ZONE' | 'ORG' | 'BUILD'
          target_zone_ids?: string[]
          target_org_ids?: string[]
          date_range_start?: string | null
          date_range_end?: string | null
          performed_by?: string
          status?: 'running' | 'completed' | 'failed'
          observations_processed?: number | null
          compliance_changed?: number | null
          drift_events_created?: number | null
          error_message?: string | null
          started_at?: string
          completed_at?: string | null
          duration_seconds?: number | null
          created_at?: string
        }
        Relationships: []
      }
      restrictions: {
        Row: {
          id: string
          organization_id: string
          name: string
          restriction_type: 'prohibited' | 'self_contained' | 'day_use' | 'permit_required'
          geom: any | null
          meta_data: any
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          restriction_type?: 'prohibited' | 'self_contained' | 'day_use' | 'permit_required'
          geom?: any | null
          meta_data?: any
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          restriction_type?: 'prohibited' | 'self_contained' | 'day_use' | 'permit_required'
          geom?: any | null
          meta_data?: any
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      zone_compliance_matrix: {
        Row: {
          id: string
          zone_id: string
          organization_id: string | null
          version: number | null
          effective_from: string | null
          effective_to: string | null
          self_contained_required: boolean | null
          requires_csc: boolean | null
          nights_per_month: number | null
          max_consecutive_nights: number | null
          day_visit_only: boolean | null
          allowed_days: string[] | null
          homeless_exemption: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          zone_id: string
          organization_id?: string | null
          version?: number | null
          effective_from?: string | null
          effective_to?: string | null
          self_contained_required?: boolean | null
          requires_csc?: boolean | null
          nights_per_month?: number | null
          max_consecutive_nights?: number | null
          day_visit_only?: boolean | null
          allowed_days?: string[] | null
          homeless_exemption?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          zone_id?: string
          organization_id?: string | null
          version?: number | null
          effective_from?: string | null
          effective_to?: string | null
          self_contained_required?: boolean | null
          requires_csc?: boolean | null
          nights_per_month?: number | null
          max_consecutive_nights?: number | null
          day_visit_only?: boolean | null
          allowed_days?: string[] | null
          homeless_exemption?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      photo_metadata: {
        Row: {
          id: string
          user_id: string | null
          observation_id: string | null
          file_name: string | null
          file_size: number | null
          mime_type: string | null
          storage_path: string | null
          sha256_hash: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          observation_id?: string | null
          file_name?: string | null
          file_size?: number | null
          mime_type?: string | null
          storage_path?: string | null
          sha256_hash?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          observation_id?: string | null
          file_name?: string | null
          file_size?: number | null
          mime_type?: string | null
          storage_path?: string | null
          sha256_hash?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
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
      ensure_other_location_zone: {
        Args: { p_organization_id: string }
        Returns: string
      }
      safe_insert_observation: {
        Args: { p_data: Record<string, unknown> }
        Returns: { observation_id: string; id: string | null }
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
      get_observation_summary: {
        Args: {
          p_start_date: string
          p_end_date: string
          p_organization_id?: string | null
          p_zone_id?: string | null
        }
        Returns: {
          total_observations: number
          compliant_count: number
          breach_count: number
          unique_vehicles: number
          unique_zones: number
        }[]
      }
    }
  }
}
