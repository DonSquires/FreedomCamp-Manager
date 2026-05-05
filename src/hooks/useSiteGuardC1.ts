import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Phase C1 tables may not yet appear in generated Database types.
// Use runtime queries while schema/type generation catches up.
const sb = supabase as any

// ─── Types ────────────────────────────────────────────────────────────────────

interface SiteGuardShift {
  id: string
  organization_id: string
  case_id: string
  officer_id: string
  client_site_id?: string | null
  roster_shift_id?: string | null
  shift_start: string
  shift_end?: string | null
  status: 'active' | 'completed' | 'abandoned'
  start_gps_lat?: number | null
  start_gps_lng?: number | null
  briefing_notes?: string | null
  handover_notes?: string | null
  created_at: string
  updated_at: string
}

interface EmergencyAssistEvent {
  id: string
  organization_id: string
  case_id: string
  officer_id: string
  client_site_id?: string | null
  assist_type: 'emergency' | 'medical' | 'aggressive_person' | 'supervisor_required' | 'police_required'
  severity: 'medium' | 'high' | 'critical'
  description?: string | null
  gps_lat?: number | null
  gps_lng?: number | null
  welfare_event_id?: string | null
  acknowledged_at?: string | null
  acknowledged_by?: string | null
  resolved_at?: string | null
  resolution_notes?: string | null
  status: 'active' | 'acknowledged' | 'resolved' | 'false_alarm'
  triggered_at: string
}

interface SiteIncidentOnCase {
  id: string
  case_id?: string | null
  incident_type: string
  severity: string
  description: string
  status: string
  created_at: string
}

/**
 * Phase C1 Hooks: Site Guard / Static Guard — Case Backbone Integration
 *
 * Attaches site-guard shift lifecycle and emergency-assist requests to the
 * shared operational_cases model so the command console can surface guard
 * state alongside patrol, dispatch, and enforcement events.
 *
 * New domain tables:
 *   site_guard_shifts         — shift start/end lifecycle on a case
 *   emergency_assist_events   — one-tap emergency requests (case stays open)
 *   site_incidents.case_id    — FK column added by C1 migration
 */

// ============================================================================
// useStartSiteGuardShift
// Creates an operational_case (type: 'site_guard') and a site_guard_shifts row
// in a single sequential write — shift cannot exist without a case.
// Returns the created shift so callers can store the shiftId locally.
// ============================================================================

export function useStartSiteGuardShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      organizationId: string
      officerId: string
      clientSiteId?: string | null
      rosterShiftId?: string | null
      startGpsLat?: number | null
      startGpsLng?: number | null
      briefingNotes?: string | null
    }) => {
      // 1. Create the operational case
      const { data: caseRow, error: caseError } = await sb
        .from('operational_cases')
        .insert({
          organization_id: input.organizationId,
          case_type: 'site_guard',
          created_from: 'site_guard',
          status: 'active',
          title: `Site Guard Shift — ${new Date().toISOString()}`,
          created_by: input.officerId,
        })
        .select('id')
        .single()
      if (caseError || !caseRow) throw caseError ?? new Error('Failed to create site guard case')

      // 2. Create the shift row
      const { data: shift, error: shiftError } = await sb
        .from('site_guard_shifts')
        .insert({
          organization_id: input.organizationId,
          case_id: caseRow.id,
          officer_id: input.officerId,
          client_site_id: input.clientSiteId ?? null,
          roster_shift_id: input.rosterShiftId ?? null,
          shift_start: new Date().toISOString(),
          status: 'active',
          start_gps_lat: input.startGpsLat ?? null,
          start_gps_lng: input.startGpsLng ?? null,
          briefing_notes: input.briefingNotes ?? null,
        })
        .select('*')
        .single()
      if (shiftError || !shift) throw shiftError ?? new Error('Failed to create site guard shift')

      return shift as SiteGuardShift
    },
    onSuccess: (shift) => {
      queryClient.invalidateQueries({ queryKey: ['siteGuardShifts', shift.organization_id] })
      queryClient.invalidateQueries({ queryKey: ['siteGuardCaseTimeline', shift.case_id] })
    },
  })
}

// ============================================================================
// useEndSiteGuardShift
// Closes a site_guard_shifts row and marks the linked case as 'completed'.
// Both writes are performed atomically via sequential mutations.
// ============================================================================

export function useEndSiteGuardShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      shiftId: string
      caseId: string
      handoverNotes?: string | null
    }) => {
      const now = new Date().toISOString()

      // 1. Close the shift
      const { data: shift, error: shiftError } = await sb
        .from('site_guard_shifts')
        .update({
          shift_end: now,
          status: 'completed',
          handover_notes: input.handoverNotes ?? null,
          updated_at: now,
        })
        .eq('id', input.shiftId)
        .select('*')
        .single()
      if (shiftError) throw shiftError

      // 2. Mark the case completed
      const { error: caseError } = await sb
        .from('operational_cases')
        .update({ status: 'completed', closed_at: now, updated_at: now })
        .eq('id', input.caseId)
      if (caseError) throw caseError

      return shift as SiteGuardShift
    },
    onSuccess: (shift) => {
      queryClient.invalidateQueries({ queryKey: ['siteGuardShifts', shift.organization_id] })
      queryClient.invalidateQueries({ queryKey: ['siteGuardCaseTimeline', shift.case_id] })
    },
  })
}

// ============================================================================
// useSiteGuardCaseTimeline
// Returns a unified view of everything attached to a site-guard case:
//   shifts, incidents, and emergency-assist events — ordered chronologically.
// ============================================================================

export function useSiteGuardCaseTimeline(caseId: string | undefined) {
  return useQuery({
    queryKey: ['siteGuardCaseTimeline', caseId],
    queryFn: async () => {
      if (!caseId) return { shifts: [], incidents: [], assists: [] }

      const [shiftsResult, incidentsResult, assistsResult] = await Promise.all([
        sb
          .from('site_guard_shifts')
          .select('*')
          .eq('case_id', caseId)
          .order('shift_start', { ascending: true }),
        sb
          .from('site_incidents')
          .select('id, case_id, incident_type, severity, description, status, created_at')
          .eq('case_id', caseId)
          .order('created_at', { ascending: true }),
        sb
          .from('emergency_assist_events')
          .select('*')
          .eq('case_id', caseId)
          .order('triggered_at', { ascending: true }),
      ])

      return {
        shifts:    (shiftsResult.data    ?? []) as SiteGuardShift[],
        incidents: (incidentsResult.data ?? []) as SiteIncidentOnCase[],
        assists:   (assistsResult.data   ?? []) as EmergencyAssistEvent[],
      }
    },
    enabled: !!caseId,
  })
}

// ============================================================================
// useLogSiteIncidentToCase
// Inserts a site_incident row and links it to the active guard case.
// Builds on the existing site_incidents table — adds the case_id FK.
// ============================================================================

export function useLogSiteIncidentToCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      organizationId: string
      caseId: string
      officerId: string
      clientSiteId?: string | null
      incidentType: string
      severity?: string
      description: string
      subjectName?: string | null
      gpsLat?: number | null
      gpsLng?: number | null
      policeNotified?: boolean
    }) => {
      const { data, error } = await sb
        .from('site_incidents')
        .insert({
          organization_id:  input.organizationId,
          case_id:          input.caseId,
          officer_id:       input.officerId,
          client_site_id:   input.clientSiteId ?? null,
          incident_type:    input.incidentType,
          severity:         input.severity ?? 'medium',
          description:      input.description,
          subject_name:     input.subjectName ?? null,
          gps_lat:          input.gpsLat ?? null,
          gps_lng:          input.gpsLng ?? null,
          police_notified:  input.policeNotified ?? false,
          status:           'submitted',
        })
        .select('id, case_id, incident_type, severity, description, status, created_at')
        .single()
      if (error || !data) throw error ?? new Error('Failed to log site incident')
      return data as SiteIncidentOnCase
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['siteGuardCaseTimeline', variables.caseId] })
      queryClient.invalidateQueries({ queryKey: ['siteIncidents', variables.organizationId] })
    },
  })
}

// ============================================================================
// useTriggerEmergencyAssist
// Records a one-tap emergency assist request on the case timeline.
// The case status is deliberately left unchanged so the supervisor can triage.
// Optionally records the welfare_event_id once a dispatcher creates one.
// ============================================================================

export function useTriggerEmergencyAssist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      organizationId: string
      caseId: string
      officerId: string
      clientSiteId?: string | null
      assistType?: EmergencyAssistEvent['assist_type']
      severity?: EmergencyAssistEvent['severity']
      description?: string | null
      gpsLat?: number | null
      gpsLng?: number | null
    }) => {
      const { data, error } = await sb
        .from('emergency_assist_events')
        .insert({
          organization_id: input.organizationId,
          case_id:         input.caseId,
          officer_id:      input.officerId,
          client_site_id:  input.clientSiteId ?? null,
          assist_type:     input.assistType ?? 'emergency',
          severity:        input.severity ?? 'high',
          description:     input.description ?? null,
          gps_lat:         input.gpsLat ?? null,
          gps_lng:         input.gpsLng ?? null,
          status:          'active',
          triggered_at:    new Date().toISOString(),
        })
        .select('*')
        .single()
      if (error || !data) throw error ?? new Error('Failed to trigger emergency assist')
      return data as EmergencyAssistEvent
    },
    onSuccess: (_data, variables) => {
      // Invalidate timeline — assist appears as a new timeline entry
      queryClient.invalidateQueries({ queryKey: ['siteGuardCaseTimeline', variables.caseId] })
      // Invalidate active-assists list so command console surfaces it immediately
      queryClient.invalidateQueries({ queryKey: ['emergencyAssists', variables.organizationId] })
    },
  })
}

// ============================================================================
// useActiveEmergencyAssists
// Returns all unresolved emergency-assist events for an organisation.
// Used by the command console to surface active guard emergencies.
// ============================================================================

export function useActiveEmergencyAssists(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['emergencyAssists', organizationId],
    queryFn: async () => {
      if (!organizationId) return []
      const { data, error } = await sb
        .from('emergency_assist_events')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .order('triggered_at', { ascending: false })
      if (error) return []
      return data as EmergencyAssistEvent[]
    },
    enabled: !!organizationId,
    refetchInterval: 30_000, // Poll every 30 s — emergencies need prompt visibility
  })
}
