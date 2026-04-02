/**
 * Clean-rebuild TypeScript types derived from supabase/rebuild/0001_clean_baseline.sql
 * These types are scoped to the clean rebuild track only.
 * Do NOT import from the legacy src/types/database.ts in rebuilt pages.
 */

// ---------------------------------------------------------------------------
// Shared enums / string unions
// ---------------------------------------------------------------------------

export type UserRole = 'officer' | 'admin' | 'master' | 'grand_master'

export type ObservationBreachType =
  | 'consecutive_nights'
  | 'monthly_limit'
  | 'self_contained'
  | 'after_hours'

export type BreachAlertStatus =
  | 'pending'
  | 'acknowledged'
  | 'enforcement_started'
  | 'resolved'
  | 'dismissed'

export type EnforcementCaseStatus = 'open' | 'in_progress' | 'closed'

export type InfringementNoticeStatus = 'issued' | 'paid' | 'withdrawn' | 'void'

export type NoticesToVacateStatus = 'active' | 'expired' | 'cancelled'

export type PatrolStatus = 'scheduled' | 'active' | 'completed' | 'cancelled'

export type ShiftStatus = 'active' | 'completed' | 'cancelled'

export type WelfareAlertStatus = 'open' | 'acknowledged' | 'resolved'

export type IncidentStatus = 'open' | 'in_progress' | 'closed'

export type HomelessStatus = 'none' | 'flagged' | 'confirmed'

export type DisputeIntakeStatus = 'submitted' | 'under_review' | 'resolved' | 'rejected'

// ---------------------------------------------------------------------------
// Row types — one per table
// ---------------------------------------------------------------------------

export interface Organization {
  id: string
  name: string
  legal_name: string | null
  timezone: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface UserProfile {
  id: string
  organization_id: string
  email: string
  full_name: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Zone {
  id: string
  organization_id: string
  name: string
  zone_type: string | null
  is_active: boolean
  geometry_geojson: GeoJSON.Geometry | GeoJSON.FeatureCollection | null
  created_at: string
  updated_at: string
}

export interface ZoneComplianceMatrix {
  id: string
  zone_id: string
  effective_from: string         // date (ISO)
  effective_to: string | null    // date (ISO)
  max_nights_per_month: number
  max_consecutive_nights: number
  requires_self_contained: boolean
  after_hours_prohibited: boolean
  created_at: string
  updated_at: string
}

export interface ZoneLegalConfig {
  id: string
  zone_id: string
  issuing_authority: string | null
  payment_url: string | null
  objection_url: string | null
  dispute_url: string | null
  notice_contact_email: string | null
  notice_contact_phone: string | null
  created_at: string
  updated_at: string
}

export interface ZoneSignageEvidence {
  id: string
  zone_id: string
  image_url: string
  captured_at: string | null
  captured_by: string | null      // user_profiles.id
  notes: string | null
  created_at: string
}

export interface CanonicalVehicle {
  vehicle_id: string
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_color: string | null
  vehicle_year: number | null
  first_seen_at: string
  last_seen_at: string
  total_observations: number
  created_at: string
  updated_at: string
}

export interface CanonicalScv {
  id: string
  plate_number: string
  is_self_contained: boolean
  certificate_number: string | null
  certificate_expiry: string | null  // date (ISO)
  source: string | null
  checked_at: string | null
  created_at: string
  updated_at: string
}

export interface CanonicalHomeless {
  id: string
  plate_number: string
  status: HomelessStatus
  notes: string | null
  confirmed_by: string | null   // user_profiles.id
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

export interface ComplianceSnapshot {
  is_compliant: boolean
  breach_type: ObservationBreachType | null
  breach_reason: string | null
  nights_stayed: number
  consecutive_nights: number
  matrix_snapshot: ZoneComplianceMatrix | null
}

export interface Observation {
  observation_id: string
  organization_id: string
  zone_id: string
  recorded_by: string | null     // user_profiles.id
  plate_number: string
  recorded_at: string
  gps_latitude: number | null
  gps_longitude: number | null
  photo_url: string | null
  officer_notes: string | null
  is_compliant: boolean
  breach_type: ObservationBreachType | null
  breach_reason: string | null
  nights_stayed_this_month: number
  consecutive_nights: number
  compliance_snapshot: ComplianceSnapshot | null
  idempotency_key: string | null
  created_at: string
  updated_at: string
}

export interface BreachAlert {
  id: string
  organization_id: string
  zone_id: string
  observation_id: string | null
  plate_number: string | null
  breach_type: ObservationBreachType | string
  breach_details: Record<string, unknown>
  status: BreachAlertStatus
  assigned_to: string | null     // user_profiles.id
  admin_review_notes: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface EnforcementCase {
  id: string
  organization_id: string
  plate_number: string
  status: EnforcementCaseStatus
  opened_by: string | null       // user_profiles.id
  opened_at: string
  closed_at: string | null
  close_reason: string | null
  created_at: string
  updated_at: string
}

export interface EnforcementCaseEvent {
  id: string
  case_id: string
  event_type: string
  event_payload: Record<string, unknown>
  created_by: string | null      // user_profiles.id
  created_at: string
}

export interface InfringementNoticeCounter {
  organization_id: string
  next_number: number
  updated_at: string
}

export interface InfringementNotice {
  id: string
  organization_id: string
  observation_id: string | null
  case_id: string | null
  notice_number: string
  plate_number: string
  issued_at: string
  status: InfringementNoticeStatus
  amount_cents: number | null
  document_url: string | null
  created_by: string | null      // user_profiles.id
  created_at: string
  updated_at: string
}

export interface NoticeToVacate {
  id: string
  organization_id: string
  observation_id: string | null
  plate_number: string
  issued_at: string
  expiry_at: string | null
  status: NoticesToVacateStatus
  document_url: string | null
  created_by: string | null      // user_profiles.id
  created_at: string
  updated_at: string
}

export interface Patrol {
  id: string
  organization_id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  status: PatrolStatus
  created_by: string | null      // user_profiles.id
  created_at: string
  updated_at: string
}

export interface PatrolScheduleZone {
  id: string
  patrol_id: string
  zone_id: string
  created_at: string
}

export interface PatrolCheckpoint {
  id: string
  organization_id: string
  zone_id: string | null
  name: string
  qr_code: string | null
  latitude: number | null
  longitude: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CheckpointVisit {
  id: string
  checkpoint_id: string
  officer_id: string
  patrol_id: string | null
  visited_at: string
  latitude: number | null
  longitude: number | null
  created_at: string
}

export interface OfficerShift {
  id: string
  organization_id: string
  officer_id: string
  started_at: string
  ended_at: string | null
  status: ShiftStatus
  created_at: string
  updated_at: string
}

export interface OfficerWelfareSettings {
  organization_id: string
  check_interval_minutes: number
  grace_minutes: number
  escalation_email: string | null
  created_at: string
  updated_at: string
}

export interface OfficerActivityLog {
  id: string
  officer_id: string
  shift_id: string | null
  activity_type: string
  latitude: number | null
  longitude: number | null
  recorded_at: string
  payload: Record<string, unknown>
}

export interface OfficerWelfareAlert {
  id: string
  organization_id: string
  officer_id: string
  shift_id: string | null
  alert_type: string
  status: WelfareAlertStatus
  triggered_at: string
  resolved_at: string | null
  resolved_by: string | null     // user_profiles.id
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Incident {
  id: string
  organization_id: string
  observation_id: string | null
  incident_type: string
  severity: string | null
  summary: string | null
  details: string | null
  status: IncidentStatus
  reported_by: string | null     // user_profiles.id
  reported_at: string
  created_at: string
  updated_at: string
}

export interface IncidentAttachment {
  id: string
  incident_id: string
  file_url: string
  file_type: string | null
  uploaded_by: string | null     // user_profiles.id
  uploaded_at: string
}

export interface HealthSafetyReport {
  id: string
  organization_id: string
  incident_id: string | null
  report_number: string | null
  status: string
  details: string | null
  created_by: string | null      // user_profiles.id
  created_at: string
  updated_at: string
}

export interface PersonRecord {
  id: string
  organization_id: string
  first_name: string | null
  last_name: string | null
  aliases: string[] | null
  risk_level: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PersonVehicleLink {
  id: string
  person_id: string
  plate_number: string
  relationship_type: string | null
  created_at: string
}

export interface PersonObservation {
  id: string
  person_id: string
  observation_id: string
  created_at: string
}

export interface PersonInteraction {
  id: string
  person_id: string
  officer_id: string | null
  interaction_type: string | null
  notes: string | null
  occurred_at: string
  created_at: string
}

export interface AuditLog {
  id: string
  organization_id: string | null
  actor_id: string | null        // user_profiles.id
  action: string
  entity_type: string | null
  entity_id: string | null
  metadata: Record<string, unknown>
  occurred_at: string
}

export interface DisputeIntake {
  id: string
  organization_id: string | null
  notice_number: string | null
  plate_number: string | null
  claimant_name: string | null
  claimant_email: string | null
  claim_text: string | null
  status: DisputeIntakeStatus
  created_at: string
  updated_at: string
}

export interface PrivacyCurtainSettings {
  organization_id: string
  blur_plate_images: boolean
  blur_person_images: boolean
  redact_export_pii: boolean
  created_at: string
  updated_at: string
}

export interface PrivacyAccessLog {
  id: string
  organization_id: string
  actor_id: string | null        // user_profiles.id
  purpose: string | null
  entity_type: string | null
  entity_id: string | null
  accessed_at: string
}

export interface RetentionPolicy {
  id: string
  organization_id: string
  data_class: string
  retention_days: number
  hard_delete: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Insert types (required fields only, omitting server-generated defaults)
// ---------------------------------------------------------------------------

export type InsertOrganization = Pick<Organization, 'name'> &
  Partial<Pick<Organization, 'legal_name' | 'timezone' | 'is_active'>>

export type InsertUserProfile = Pick<UserProfile, 'id' | 'organization_id' | 'email' | 'role'> &
  Partial<Pick<UserProfile, 'full_name' | 'is_active'>>

export type InsertZone = Pick<Zone, 'organization_id' | 'name'> &
  Partial<Pick<Zone, 'zone_type' | 'is_active' | 'geometry_geojson'>>

export type InsertZoneComplianceMatrix = Pick<ZoneComplianceMatrix, 'zone_id' | 'effective_from'> &
  Partial<Omit<ZoneComplianceMatrix, 'id' | 'zone_id' | 'effective_from' | 'created_at' | 'updated_at'>>

export type InsertObservation = Pick<
  Observation,
  'organization_id' | 'zone_id' | 'plate_number' | 'recorded_at'
> & Partial<Omit<Observation, 'observation_id' | 'organization_id' | 'zone_id' | 'plate_number' | 'recorded_at' | 'created_at' | 'updated_at'>>

export type InsertBreachAlert = Pick<
  BreachAlert,
  'organization_id' | 'zone_id' | 'breach_type'
> & Partial<Omit<BreachAlert, 'id' | 'organization_id' | 'zone_id' | 'breach_type' | 'created_at' | 'updated_at'>>

export type InsertDisputeIntake = Partial<Omit<DisputeIntake, 'id' | 'created_at' | 'updated_at'>>

// ---------------------------------------------------------------------------
// RPC result types (from 0003_clean_rpcs.sql)
// ---------------------------------------------------------------------------

export interface ComplianceResult {
  is_compliant: boolean
  breach_type: ObservationBreachType | null
  breach_reason: string | null
  nights_stayed: number
  consecutive_nights: number
  matrix_snapshot: ZoneComplianceMatrix | null
}

// ---------------------------------------------------------------------------
// Joined / enriched helper types used in rebuilt pages
// ---------------------------------------------------------------------------

export interface ObservationWithJoins extends Observation {
  zone?: Pick<Zone, 'id' | 'name' | 'zone_type'>
  recorder?: Pick<UserProfile, 'id' | 'full_name' | 'email'>
}

export interface BreachAlertWithJoins extends BreachAlert {
  zone?: Pick<Zone, 'id' | 'name'>
  observation?: Pick<Observation, 'observation_id' | 'plate_number' | 'recorded_at' | 'photo_url'>
  assignee?: Pick<UserProfile, 'id' | 'full_name'>
}

export interface EnforcementCaseWithJoins extends EnforcementCase {
  events?: EnforcementCaseEvent[]
  notices?: InfringementNotice[]
  vacate_notices?: NoticeToVacate[]
}

export interface PatrolWithZones extends Patrol {
  zones?: Zone[]
  checkpoint_visits?: CheckpointVisit[]
}
