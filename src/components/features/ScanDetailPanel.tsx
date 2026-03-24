/**
 * ScanDetailPanel
 *
 * Bottom Sheet shown after a DETAIL SCAN capture.
 *
 * Features:
 *  - Polls observation until plate / vehicle details are enriched
 *  - Three tabs: Details | Notes & H&S | Actions
 *  - Editable: plate, make, model, year, colour (for ALPR/AI corrections)
 *  - Officer notes field (saved to observations.officer_notes)
 *  - H&S incident inline quick-form (pre-filled with zone + plate + GPS address)
 *  - Homeless claim inline form (updates canonical_vehicles.homeless_status)
 *  - Enforcement actions: Warning, Notice to Vacate (workflow-gated)
 *  - Shows admin-assigned follow-up instructions if admin has responded
 *  - "Escalate to Admin" button when admin review is needed (admin_first / hybrid)
 *  - Welfare: every save/action resets the man-down timer via onActivity()
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { reverseGeocode } from '@/lib/geocoding'
import {
  Camera, Car, CheckCircle, XCircle, Clock, Save, AlertTriangle,
  ShieldAlert, MapPin, FileWarning, Megaphone, Shield, ExternalLink,
  Loader2, Edit3, Bell, ClipboardList, Home, Printer, Heart, Users,
  Wrench, Flag,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of enriched scan data polled from observations */
export interface DetailScanData {
  observationId: string
  photoUrl: string | null
  plateNumber: string | null
  isCompliant: boolean | null
  isHomelessExempt: boolean
  homelessStatus: string | null
  breachType: string | null
  processingPending: boolean
  zoneName: string | null
  observationZoneId: string
  recordedAt: string
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleYear: string | null
  vehicleColor: string | null
  vehicleAttributeSources: {
    make_source: string | null
    model_source: string | null
    color_source: string | null
    year_source: string | null
  } | null
  isSelfContained: boolean
  selfContainedExpiry: string | null
  cscStatus: string | null
  vehicleMoved: boolean | null
  isNewVehicle: boolean
  officerNotes: string | null
  /** GPS coordinates captured at scan time */
  gpsLatitude: number | null
  gpsLongitude: number | null
  /** true when process-officer-scan detected at least one cross-source data discrepancy */
  hasDiscrepancies: boolean
  /** Summary of detected discrepancies — null/empty when none */
  discrepancyFlags: Array<{
    type: string
    severity: 'warning' | 'critical'
    source_a: string
    source_b: string
    value_a: string | null
    value_b: string | null
  }> | null
  // ── TicketOr2-style stay duration fields (from observations) ──────────────
  /** Number of consecutive nights this vehicle has been in this zone */
  consecutiveNights: number | null
  /** Total nights stayed in this zone this calendar month */
  nightsStayedThisMonth: number | null
}

// ── TicketOr2-style enforcement history for a plate ──────────────────────────
// Fetched client-side once the plate is known; gives the officer full prior
// enforcement context before deciding on an action.
interface PlateHistory {
  warningCount: number
  lastWarningAt: string | null
  ntVCount: number
  lastNtVAt: string | null
  lastNtVZone: string | null
  infringementCount: number
  lastInfringementAt: string | null
  returnDetected: boolean      // plate served NtV and is back in the same/nearby zone
  returnDaysAgo: number | null
  /** Recommended action based on prior history */
  recommendation: 'warning' | 'notice_to_vacate' | 'infringement' | 'none'
  recommendationReason: string
}

interface IssueActionParams {
  observationId: string
  zoneId: string
  plateNumber: string
  actionType: 'warning' | 'notice_to_vacate'
}

interface ScanDetailPanelProps {
  open: boolean
  onClose: () => void
  initialData: DetailScanData | null
  orgWorkflow: string
  onIssueAction: (params: IssueActionParams) => void
  isIssuingAction?: boolean
  /** Called on any officer activity so man-down timer resets */
  onActivity?: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS  = 2_000
const MAX_POLL_ATTEMPTS = 45            // 45 × 2 s = 90 s max

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBreach(v: string | null | undefined) {
  if (!v) return 'Breach'
  return v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString('en-NZ', { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return iso }
}

/** Format attribute source name for display */
function fmtSource(source: string | null): string {
  if (!source) return 'Unknown'
  const sourceMap: Record<string, string> = {
    nzscv: 'NZSCV',
    canonical: 'Database',
    inference: 'AI Detection',
    alpr: 'Plate Recognizer',
  }
  return sourceMap[source] || source
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScanDetailPanel({
  open,
  onClose,
  initialData,
  orgWorkflow,
  onIssueAction,
  isIssuingAction = false,
  onActivity,
}: ScanDetailPanelProps) {
  const navigate  = useNavigate()
  const { user }  = useAuthStore()
  const qc        = useQueryClient()

  // Local enriched copy of the observation (starts with initialData, updated by poll)
  const [obs, setObs] = useState<DetailScanData | null>(initialData)

  // Edit form state (officer corrections + notes)
  const [editPlate,   setEditPlate]   = useState('')
  const [editMake,    setEditMake]    = useState('')
  const [editModel,   setEditModel]   = useState('')
  const [editYear,    setEditYear]    = useState('')
  const [editColour,  setEditColour]  = useState('')
  const [editNotes,   setEditNotes]   = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [isSaving,    setIsSaving]    = useState(false)
  const [editMode,    setEditMode]    = useState(false)

  // Reverse-geocoded address derived from GPS coordinates
  const [locationAddress, setLocationAddress] = useState<string | null>(null)

  // ── Inline H&S quick-report form state ─────────────────────────────────────
  const [showHSForm,       setShowHSForm]       = useState(false)
  const [hsIncidentType,   setHSIncidentType]   = useState('threatening_behaviour')
  const [hsSeverity,       setHSSeverity]       = useState<'low'|'medium'|'high'|'critical'>('medium')
  const [hsDescription,    setHSDescription]    = useState('')
  const [hsActionTaken,    setHSActionTaken]    = useState('')
  const [isSavingHS,       setIsSavingHS]       = useState(false)

  // ── Inline homeless claim form state ────────────────────────────────────────
  const [showHomelessForm,    setShowHomelessForm]    = useState(false)
  const [homelessClaimType,   setHomelessClaimType]   = useState<'claimed'|'confirmed'>('claimed')
  const [homelessClaimNotes,  setHomelessClaimNotes]  = useState('')
  const [isSavingHomeless,    setIsSavingHomeless]    = useState(false)

  // Keep local state in sync when initialData changes (new scan opened)
  useEffect(() => {
    setObs(initialData)
    setEditPlate(initialData?.plateNumber  ?? '')
    setEditMake(initialData?.vehicleMake   ?? '')
    setEditModel(initialData?.vehicleModel ?? '')
    setEditYear(initialData?.vehicleYear   ?? '')
    setEditColour(initialData?.vehicleColor ?? '')
    setEditNotes(initialData?.officerNotes  ?? '')
    setEditAddress('')
    setEditMode(false)
    setLocationAddress(null)
    setShowHSForm(false)
    setHSDescription('')
    setHSActionTaken('')
    setShowHomelessForm(false)
    setHomelessClaimNotes('')
  }, [initialData?.observationId]) // eslint-disable-line react-hooks/exhaustive-deps -- intentional: reset only when a new observation is opened

  // Auto-resolve reverse geocoded address when GPS coords become available
  useEffect(() => {
    if (!obs?.gpsLatitude || !obs?.gpsLongitude) return
    let cancelled = false
    reverseGeocode(obs.gpsLatitude, obs.gpsLongitude).then(result => {
      if (cancelled || !result) return
      const parts = [
        result.street_number && result.street_name
          ? `${result.street_number} ${result.street_name}`
          : result.street_name,
        result.suburb,
        result.city,
      ].filter(Boolean)
      if (parts.length > 0) setLocationAddress(parts.join(', '))
    }).catch(() => { /* non-critical */ })
    return () => { cancelled = true }
  }, [obs?.gpsLatitude, obs?.gpsLongitude])

  // ── Fetch breach_alert for this observation (admin response) ─────────────
  const { data: breachAlert } = useQuery({
    queryKey: ['scan-breach-alert', obs?.observationId],
    queryFn: async () => {
      if (!obs?.observationId) return null
      const { data } = await (supabase.from('breach_alerts') as any)
        .select('id, status, admin_review_notes, assigned_to, due_date, assigned_at')
        .eq('observation_id', obs.observationId)
        .maybeSingle()
      return data || null
    },
    enabled: !!obs?.observationId && !obs?.processingPending,
    refetchInterval: 15_000,
  })

  // Whether admin has responded and the instruction is for this officer
  const adminHasResponded =
    breachAlert?.admin_review_notes &&
    (breachAlert.assigned_to === user?.id || !breachAlert.assigned_to)

  // ── Escalate to admin mutation ────────────────────────────────────────────
  const escalateMutation = useMutation({
    mutationFn: async () => {
      if (!obs?.observationId || !user) throw new Error('No observation')
      if (breachAlert?.id) {
        // Update existing breach_alert to signal it needs admin attention
        const { error } = await (supabase.from('breach_alerts') as any)
          .update({ status: 'pending' })
          .eq('id', breachAlert.id)
        if (error) throw error
      } else {
        // No breach_alert yet — create one to flag for admin
        const { error } = await (supabase.from('breach_alerts') as any)
          .insert({
            organization_id: user.organization_id,
            zone_id:         obs.observationZoneId,
            plate_number:    obs.plateNumber,
            breach_type:     obs.breachType || 'manual_review_requested',
            breach_details:  { source: 'officer_escalation', observation_id: obs.observationId },
            observation_id:  obs.observationId,
            status:          'pending',
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('Flagged for admin review — admin will be notified')
      qc.invalidateQueries({ queryKey: ['scan-breach-alert', obs?.observationId] })
      onActivity?.()
    },
    onError: (err: any) => toast.error(err.message || 'Failed to escalate'),
  })

  // ── TicketOr2-style: fetch plate enforcement history ─────────────────────
  // Fires once the plate is resolved (non-null, non-MANUAL_REQUIRED).
  // Queries prior warnings, NtVs, infringements, and return detection.
  const plate_known = obs?.plateNumber && obs.plateNumber !== 'MANUAL_REQUIRED' && obs.plateNumber !== 'PROCESSING...'
  const { data: plateHistory } = useQuery<PlateHistory | null>({
    queryKey: ['plate-enforcement-history', obs?.plateNumber, user?.organization_id],
    queryFn: async (): Promise<PlateHistory | null> => {
      const plate = obs!.plateNumber!
      const orgId = user!.organization_id

      // Run all three history lookups in parallel
      const [warningRes, ntVRes, infRes] = await Promise.all([
        // Prior warnings (enforcement_actions table)
        (supabase.from('enforcement_actions') as any)
          .select('id, created_at, action_type, zone_id')
          .eq('organization_id', orgId)
          .eq('plate_number', plate)
          .eq('action_type', 'warning')
          .order('created_at', { ascending: false })
          .limit(20),

        // Prior Notices to Vacate
        (supabase.from('notices_to_vacate') as any)
          .select('id, issued_at, zone_id, zones!zone_id(name)')
          .eq('organization_id', orgId)
          .eq('plate_number', plate)
          .order('issued_at', { ascending: false })
          .limit(20),

        // Prior infringement notices
        (supabase.from('infringement_notices') as any)
          .select('id, issued_at')
          .eq('organization_id', orgId)
          .eq('plate_number', plate)
          .order('issued_at', { ascending: false })
          .limit(10),
      ])

      const warnings  = warningRes.data  ?? []
      const ntVs      = ntVRes.data      ?? []
      const infs      = infRes.data      ?? []

      const lastNtV = ntVs[0] ?? null
      const lastNtVAt: string | null = lastNtV?.issued_at ?? null
      const lastNtVZone: string | null = (lastNtV as any)?.zones?.name ?? null

      // Return detection: plate received NtV in the past 30 days
      let returnDetected = false
      let returnDaysAgo: number | null = null
      if (lastNtVAt) {
        const daysSince = Math.floor((Date.now() - new Date(lastNtVAt).getTime()) / 86_400_000)
        if (daysSince <= 30) {
          returnDetected = true
          returnDaysAgo  = daysSince
        }
      }

      // Smart recommendation (TicketOr2 escalation ladder)
      let recommendation: PlateHistory['recommendation'] = 'none'
      let recommendationReason = ''

      if (infs.length > 0) {
        recommendation = 'infringement'
        recommendationReason = `Infringement previously issued — repeat offender`
      } else if (returnDetected) {
        recommendation = 'infringement'
        recommendationReason = `Notice to Vacate served ${returnDaysAgo} day${returnDaysAgo === 1 ? '' : 's'} ago — vehicle returned`
      } else if (ntVs.length > 0) {
        recommendation = 'infringement'
        recommendationReason = `${ntVs.length} prior Notice${ntVs.length > 1 ? 's' : ''} to Vacate on record`
      } else if (warnings.length > 0) {
        recommendation = 'notice_to_vacate'
        recommendationReason = `${warnings.length} prior warning${warnings.length > 1 ? 's' : ''} issued — escalate to NtV`
      } else {
        recommendation = 'warning'
        recommendationReason = 'No prior enforcement history — issue warning first'
      }

      return {
        warningCount:      warnings.length,
        lastWarningAt:     warnings[0]?.created_at ?? null,
        ntVCount:          ntVs.length,
        lastNtVAt,
        lastNtVZone,
        infringementCount: infs.length,
        lastInfringementAt: infs[0]?.issued_at ?? null,
        returnDetected,
        returnDaysAgo,
        recommendation,
        recommendationReason,
      }
    },
    enabled: !!plate_known && !!user?.organization_id && !obs?.processingPending,
    staleTime: 60_000,
  })

  // ── Poll until plate + compliance are resolved ───────────────────────────
  useEffect(() => {
    if (!obs?.observationId || !obs.processingPending) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0

    const poll = async () => {
      if (cancelled) return
      attempts++

      const { data } = await (supabase.from('observations') as any)
        .select(
          'observation_id, plate_number, is_compliant, breach_type, officer_notes,' +
          'vehicle_make, vehicle_model, vehicle_year, vehicle_color, vehicle_attribute_sources,' +
          'self_contained, self_contained_expiry, zone_id,' +
          'gps_latitude, gps_longitude,' +
          'has_discrepancies, discrepancy_flags,' +
          'consecutive_nights, nights_stayed_this_month,' +
          'zone:zones!zone_id(name)'
        )
        .eq('observation_id', obs.observationId)
        .maybeSingle()

      if (!data) {
        if (attempts < MAX_POLL_ATTEMPTS) timer = setTimeout(poll, POLL_INTERVAL_MS)
        return
      }

      const isManualRequired = data.plate_number === 'MANUAL_REQUIRED'
      const resolved =
        data.plate_number &&
        data.plate_number !== 'PROCESSING...' &&
        !isManualRequired

      // When plate requires manual entry, stop polling immediately and open edit mode
      if (isManualRequired) {
        setObs(prev => prev ? {
          ...prev,
          plateNumber:       data.plate_number,
          processingPending: false,
          zoneName:          data.zone?.name           ?? prev.zoneName,
          observationZoneId: data.zone_id              ?? prev.observationZoneId,
          gpsLatitude:       data.gps_latitude         ?? prev.gpsLatitude,
          gpsLongitude:      data.gps_longitude        ?? prev.gpsLongitude,
        } : prev)
        if (!editMode) {
          setEditPlate('')
          setEditMake(data.vehicle_make ?? '')
          setEditModel(data.vehicle_model ?? '')
          setEditYear(data.vehicle_year != null ? String(data.vehicle_year) : '')
          setEditColour(data.vehicle_color ?? '')
          setEditNotes(data.officer_notes ?? '')
          setEditMode(true)
        }
        toast.info('📝 Enter plate number manually — tap Edit / Correct below')
        return
      }

      let homelessStatus: string | null = null
      if (resolved && data.plate_number) {
        const { data: canonical } = await (supabase.from('canonical_vehicles') as any)
          .select('homeless_status')
          .eq('plate_number', data.plate_number)
          .maybeSingle()
        homelessStatus = canonical?.homeless_status ?? null
      }

      const isHomelessExempt = homelessStatus === 'confirmed' || homelessStatus === 'claimed'

      setObs(prev => prev ? {
        ...prev,
        plateNumber:       data.plate_number         ?? prev.plateNumber,
        isCompliant:       typeof data.is_compliant === 'boolean' ? data.is_compliant : prev.isCompliant,
        isHomelessExempt:  isHomelessExempt,
        homelessStatus:    homelessStatus,
        breachType:        data.breach_type          ?? prev.breachType,
        processingPending: resolved ? false : prev.processingPending,
        zoneName:          data.zone?.name           ?? prev.zoneName,
        observationZoneId: data.zone_id              ?? prev.observationZoneId,
        vehicleMake:       data.vehicle_make         ?? prev.vehicleMake,
        vehicleModel:      data.vehicle_model        ?? prev.vehicleModel,
        vehicleYear:       data.vehicle_year != null ? String(data.vehicle_year) : prev.vehicleYear,
        vehicleColor:      data.vehicle_color        ?? prev.vehicleColor,
        vehicleAttributeSources: data.vehicle_attribute_sources ?? prev.vehicleAttributeSources,
        isSelfContained:   !!data.self_contained,
        selfContainedExpiry: data.self_contained_expiry ?? prev.selfContainedExpiry,
        officerNotes:      data.officer_notes        ?? prev.officerNotes,
        gpsLatitude:       data.gps_latitude         ?? prev.gpsLatitude,
        gpsLongitude:      data.gps_longitude        ?? prev.gpsLongitude,
        hasDiscrepancies:  !!(data.has_discrepancies),
        discrepancyFlags:  Array.isArray(data.discrepancy_flags) ? data.discrepancy_flags : prev.discrepancyFlags,
        consecutiveNights:     data.consecutive_nights         ?? prev.consecutiveNights,
        nightsStayedThisMonth: data.nights_stayed_this_month   ?? prev.nightsStayedThisMonth,
      } : prev)

      // Update edit fields if not currently editing
      if (!editMode && resolved) {
        setEditPlate(data.plate_number ?? '')
        setEditMake(data.vehicle_make ?? '')
        setEditModel(data.vehicle_model ?? '')
        setEditYear(data.vehicle_year != null ? String(data.vehicle_year) : '')
        setEditColour(data.vehicle_color ?? '')
        setEditNotes(data.officer_notes ?? '')
      }

      if (resolved) {
        const compliant = typeof data.is_compliant === 'boolean' ? data.is_compliant : null
        if (compliant === true)  toast.success(`✅ Compliant — ${data.plate_number}`)
        if (compliant === false) toast.warning(`⚠️ Breach: ${fmtBreach(data.breach_type)} — ${data.plate_number}`)
      } else if (attempts < MAX_POLL_ATTEMPTS) {
        timer = setTimeout(poll, POLL_INTERVAL_MS)
      } else {
        setObs(prev => prev ? { ...prev, processingPending: false } : null)
        toast.info('Scan saved. Plate detection taking longer than expected — check again shortly.')
      }
    }

    poll()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [obs?.observationId, obs?.processingPending, editMode])

  // ── Save officer corrections ─────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!obs?.observationId) return
    setIsSaving(true)
    try {
      const updates: Record<string, unknown> = {}

      // Only send changed fields
      const plateNorm = editPlate.trim().toUpperCase().replace(/\s/g, '')
      // Allow setting plate even when current value is MANUAL_REQUIRED / null
      const currentPlate = obs.plateNumber === 'MANUAL_REQUIRED' ? '' : (obs.plateNumber ?? '')
      if (plateNorm && plateNorm !== currentPlate)         updates.plate_number  = plateNorm
      if (editMake.trim()   !== (obs.vehicleMake   ?? '')) updates.vehicle_make  = editMake.trim() || null
      if (editModel.trim()  !== (obs.vehicleModel  ?? '')) updates.vehicle_model = editModel.trim() || null
      if (editYear.trim()   !== (obs.vehicleYear   ?? '')) updates.vehicle_year  = editYear.trim() ? Number(editYear) : null
      if (editColour.trim() !== (obs.vehicleColor  ?? '')) updates.vehicle_color = editColour.trim() || null

      // Build combined officer notes (address prefix + free-form notes)
      const addressPrefix = editAddress.trim() ? `Address: ${editAddress.trim()}\n` : ''
      const newNotes = addressPrefix + editNotes
      if (newNotes !== (obs.officerNotes ?? '')) updates.officer_notes = newNotes || null

      if (Object.keys(updates).length === 0) {
        toast.info('No changes to save')
        setEditMode(false)
        return
      }

      // For manual-required plates where officer just entered the real plate,
      // require a non-empty plate number before saving
      if (obs.plateNumber === 'MANUAL_REQUIRED' && !plateNorm) {
        toast.warning('Please enter a plate number before saving')
        return
      }

      const { error } = await (supabase.from('observations') as any)
        .update(updates)
        .eq('observation_id', obs.observationId)

      if (error) throw error

      setObs(prev => prev ? {
        ...prev,
        plateNumber:  (updates.plate_number  as string)  ?? prev.plateNumber,
        vehicleMake:  (updates.vehicle_make  as string)  ?? prev.vehicleMake,
        vehicleModel: (updates.vehicle_model as string)  ?? prev.vehicleModel,
        vehicleYear:  updates.vehicle_year != null ? String(updates.vehicle_year) : prev.vehicleYear,
        vehicleColor: (updates.vehicle_color as string)  ?? prev.vehicleColor,
        officerNotes: (updates.officer_notes as string)  ?? prev.officerNotes,
        processingPending: updates.plate_number ? true : prev.processingPending,
      } : null)

      // If plate was updated from MANUAL_REQUIRED, re-trigger enrichment
      if (updates.plate_number) {
        toast.success('Plate saved — re-running compliance check…')
        // Trigger background enrichment to re-evaluate compliance with real plate
        try {
          const { edgeFunctions } = await import('@/lib/edgeFunctions')
          const photoUrl = obs.photoUrl ?? ''
          if (photoUrl) {
            void edgeFunctions.processOfficerScan({
              observation_id: obs.observationId,
              photo_url: photoUrl,
            }).then(({ error: enrichErr }) => {
              if (enrichErr) console.warn('Re-enrichment failed:', enrichErr)
            })
          }
        } catch { /* best-effort */ }
      } else {
        toast.success('Observation updated')
      }
      setEditMode(false)
      onActivity?.()
    } catch (err: any) {
      toast.error(err.message || 'Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }, [obs, editPlate, editMake, editModel, editYear, editColour, editNotes, editAddress, onActivity])

  // ── Inline H&S quick-report submit ──────────────────────────────────────────
  const handleSubmitHS = useCallback(async () => {
    if (!user || !obs) return
    if (!hsDescription.trim()) { toast.warning('Please describe the incident'); return }
    setIsSavingHS(true)
    try {
      const { error } = await (supabase.from('health_safety_reports') as any)
        .insert({
          organization_id: user.organization_id,
          reported_by:     user.id,
          zone_id:         obs.observationZoneId || null,
          incident_type:   hsIncidentType,
          severity:        hsSeverity,
          description:     hsDescription.trim() +
            (hsActionTaken.trim() ? `\n\nAction taken: ${hsActionTaken.trim()}` : '') +
            (obs.plateNumber && obs.plateNumber !== 'MANUAL_REQUIRED'
              ? `\n\nLinked vehicle: ${obs.plateNumber}` : '') +
            (locationAddress ? `\n\nLocation: ${locationAddress}` : ''),
          status:          'pending',
        })
      if (error) throw error
      toast.success('H&S report submitted — admin has been notified')
      setShowHSForm(false)
      setHSDescription('')
      setHSActionTaken('')
      onActivity?.()
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit H&S report')
    } finally {
      setIsSavingHS(false)
    }
  }, [user, obs, hsIncidentType, hsSeverity, hsDescription, hsActionTaken, locationAddress, onActivity])

  // ── Homeless claim submit ─────────────────────────────────────────────────
  const handleSubmitHomelessClaim = useCallback(async () => {
    const plate = obs?.plateNumber
    if (!plate || plate === 'MANUAL_REQUIRED') {
      toast.warning('Please enter a valid plate number before recording homeless status')
      return
    }
    if (!user) return
    setIsSavingHomeless(true)
    try {
      // Upsert the canonical vehicle homeless_status
      const { error: cvErr } = await (supabase.from('canonical_vehicles') as any)
        .upsert({
          plate_number:     plate,
          organization_id:  user.organization_id,
          homeless_status:  homelessClaimType,
          is_exempt:        homelessClaimType === 'confirmed',
        }, { onConflict: 'plate_number' })
      if (cvErr) throw cvErr

      // Add officer notes on the observation
      if (obs?.observationId) {
        const claimNote = `[Homeless ${homelessClaimType === 'confirmed' ? 'Confirmed' : 'Claimed'}] ${homelessClaimNotes.trim()}`
        const currentNotes = obs.officerNotes ?? ''
        const updatedNotes = currentNotes ? `${currentNotes}\n${claimNote}` : claimNote
        await (supabase.from('observations') as any)
          .update({ officer_notes: updatedNotes })
          .eq('observation_id', obs.observationId)
        setObs(prev => prev ? { ...prev, officerNotes: updatedNotes, homelessStatus: homelessClaimType, isHomelessExempt: homelessClaimType === 'confirmed' } : null)
        setEditNotes(updatedNotes)
      }

      toast.success(`Homeless ${homelessClaimType === 'confirmed' ? 'confirmation' : 'claim'} recorded for ${plate}`)
      setShowHomelessForm(false)
      setHomelessClaimNotes('')
      onActivity?.()
    } catch (err: any) {
      toast.error(err.message || 'Failed to record homeless claim')
    } finally {
      setIsSavingHomeless(false)
    }
  }, [obs, user, homelessClaimType, homelessClaimNotes, onActivity])

  // ── H&S incident (navigate away — kept as fallback for full form) ─────────
  const handleHSIncident = () => {
    const plate = obs?.plateNumber || ''
    const zone  = obs?.observationZoneId || ''
    navigate(`/incidents?plate=${encodeURIComponent(plate)}&zone=${encodeURIComponent(zone)}&from=scan`)
    onActivity?.()
  }

  if (!obs) return null

  const pending   = obs.processingPending
  const plate     = obs.plateNumber
  const compliant = obs.isCompliant

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent
        side="bottom"
        className="h-[92dvh] rounded-t-2xl overflow-hidden flex flex-col p-0"
      >
        {/* ── Header ───────────────────────────────────────────────── */}
        <SheetHeader className="px-4 pt-4 pb-0 shrink-0">
          <div className="flex items-center gap-3">
            {/* Photo thumbnail */}
            {obs.photoUrl ? (
              <img src={obs.photoUrl} alt="Vehicle"
                className="h-14 w-14 rounded-lg object-cover border shrink-0" />
            ) : (
              <div className="h-14 w-14 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0 border">
                <Camera className="h-6 w-6 text-gray-400" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <SheetTitle className="flex items-center gap-2 flex-wrap text-base">
                {pending ? (
                  <span className="flex items-center gap-1.5 text-blue-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span aria-label="Detecting plate">Detecting…</span>
                  </span>
                ) : plate === 'MANUAL_REQUIRED' ? (
                  <span className="font-mono font-bold text-orange-600">Enter Plate ↓</span>
                ) : (
                  <span className="font-mono font-bold">{plate || '—'}</span>
                )}

                {/* Compliance badge */}
                {!pending && compliant === true && (
                  <Badge className="bg-green-600 text-white text-[10px]">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {obs.isHomelessExempt ? 'Exempt (Homeless)' : 'Compliant'}
                  </Badge>
                )}
                {!pending && compliant === false && (
                  <Badge variant="destructive" className="text-[10px]">
                    <XCircle className="h-3 w-3 mr-1" />{fmtBreach(obs.breachType)}
                  </Badge>
                )}
                {plate === 'MANUAL_REQUIRED' && (
                  <Badge className="bg-orange-500 text-white text-[10px]">
                    <Edit3 className="h-2.5 w-2.5 mr-1" />Manual Entry Required
                  </Badge>
                )}
                {pending && plate !== 'MANUAL_REQUIRED' && (
                  <Badge variant="secondary" className="text-[10px] animate-pulse">
                    <Clock className="h-2.5 w-2.5 mr-1" />Processing
                  </Badge>
                )}
              </SheetTitle>

              {/* Vehicle line */}
              {(obs.vehicleMake || obs.vehicleModel) && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Car className="h-3 w-3 shrink-0" />
                  {[obs.vehicleMake, obs.vehicleModel, obs.vehicleYear, obs.vehicleColor]
                    .filter(Boolean).join(' ')}
                </p>
              )}

              {/* Zone + location */}
              {obs.zoneName && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3 w-3 shrink-0" />{obs.zoneName}
                  <span className="text-gray-400">· {fmtDate(obs.recordedAt)}</span>
                </p>
              )}
              {locationAddress && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Home className="h-3 w-3 shrink-0" />{locationAddress}
                </p>
              )}
            </div>
          </div>
        </SheetHeader>

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <Tabs defaultValue="details" className="flex-1 flex flex-col overflow-hidden mt-3">
          <TabsList className="mx-4 shrink-0 grid grid-cols-3">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="notes">Notes &amp; H&amp;S</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
          </TabsList>

          {/* ── DETAILS TAB ────────────────────────────────────────── */}
          <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

            {/* ── Scan result notification banner ──────────────────────
                Shown immediately when processing completes so officer gets
                a clear pass / fail callout at the top of the Details tab   */}
            {!pending && plate && plate !== 'MANUAL_REQUIRED' && (
              compliant === false ? (
                <div className="rounded-xl border-2 border-red-400 bg-red-50 dark:bg-red-950/30 p-3 flex items-start gap-3">
                  <XCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-red-800 dark:text-red-300">
                      ⚠️ Breach Detected — {fmtBreach(obs.breachType)}
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                      Go to the <strong>Actions</strong> tab to issue a warning, notice to vacate, or infringement.
                    </p>
                  </div>
                </div>
              ) : compliant === true ? (
                <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/30 p-3 flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-green-800 dark:text-green-300">
                      ✅ Vehicle Compliant
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                      {obs.isHomelessExempt
                        ? 'Homeless exemption applies — no enforcement action required.'
                        : 'No enforcement action required. Observation recorded.'}
                    </p>
                  </div>
                </div>
              ) : null
            )}

            {/* Manual plate entry prompt */}
            {plate === 'MANUAL_REQUIRED' && !editMode && (
              <div className="rounded-xl border-2 border-orange-400 bg-orange-50 dark:bg-orange-950/30 p-3 space-y-2">
                <p className="text-sm font-semibold text-orange-800 dark:text-orange-300 flex items-center gap-1.5">
                  <Edit3 className="h-4 w-4 shrink-0" />
                  Plate number could not be detected
                </p>
                <p className="text-xs text-orange-700 dark:text-orange-400">
                  Please enter the plate number manually to complete this observation.
                </p>
                <Button
                  className="w-full h-8 text-xs bg-orange-600 hover:bg-orange-700 text-white"
                  onClick={() => setEditMode(true)}
                >
                  <Edit3 className="h-3 w-3 mr-1.5" />Enter Plate Number
                </Button>
              </div>
            )}

            {/* CSC status + Homeless status */}
            {!pending && plate !== 'MANUAL_REQUIRED' && (
              <div className="flex flex-wrap gap-2">
                {obs.isSelfContained ? (
                  <Badge className="bg-emerald-600 text-white text-xs">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Self-Contained{obs.selfContainedExpiry
                      ? ` — exp ${obs.selfContainedExpiry.slice(0, 10)}` : ''}
                  </Badge>
                ) : plate ? (
                  <Badge variant="outline" className="text-xs border-orange-400 text-orange-700">
                    <ShieldAlert className="h-3 w-3 mr-1" />No CSC on record
                  </Badge>
                ) : null}

                {/* Homeless status badge */}
                {obs.homelessStatus === 'confirmed' && (
                  <Badge className="bg-purple-600 text-white text-xs">
                    <Home className="h-3 w-3 mr-1" />Confirmed Homeless — Exempt
                  </Badge>
                )}
                {obs.homelessStatus === 'claimed' && (
                  <Badge variant="outline" className="text-xs border-purple-400 text-purple-700">
                    <Home className="h-3 w-3 mr-1" />Homeless Claimed — Unverified
                  </Badge>
                )}

                {obs.isNewVehicle && (
                  <Badge variant="secondary" className="text-xs">🆕 New vehicle in zone</Badge>
                )}
                {obs.vehicleMoved === true && (
                  <Badge variant="secondary" className="text-xs">📍 Vehicle has moved</Badge>
                )}
                {obs.vehicleMoved === false && (
                  <Badge variant="secondary" className="text-xs">🅿️ Vehicle stationary</Badge>
                )}
              </div>
            )}

            {/* ── Discrepancy warnings ──────────────────────────────── */}
            {!pending && obs.hasDiscrepancies && obs.discrepancyFlags && obs.discrepancyFlags.length > 0 && (() => {
              const hasCritical = obs.discrepancyFlags.some(d => d.severity === 'critical')
              const borderColor = hasCritical
                ? 'border-red-400 bg-red-50 dark:bg-red-950/30'
                : 'border-amber-400 bg-amber-50 dark:bg-amber-950/30'
              const titleColor = hasCritical
                ? 'text-red-700 dark:text-red-300'
                : 'text-amber-800 dark:text-amber-300'
              const icon = hasCritical ? '🚨' : '⚠️'
              const title = hasCritical
                ? 'Critical: Data Integrity Issue Detected'
                : 'Data Discrepancies Detected'
              const fmt = (s: string) =>
                s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              return (
                <div className={`rounded-xl border-2 p-3 space-y-2 ${borderColor}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 ${titleColor}`}>
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    {icon} {title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cross-source data check found inconsistencies. Admin has been alerted. Please verify the vehicle manually.
                  </p>
                  <div className="space-y-1.5">
                    {obs.discrepancyFlags.map((d, i) => (
                      <div key={i} className="rounded-lg border bg-white/60 dark:bg-black/20 p-2 text-xs">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Badge
                            variant={d.severity === 'critical' ? 'destructive' : 'outline'}
                            className="text-[10px] h-4 px-1.5"
                          >
                            {d.severity === 'critical' ? '🚨 Critical' : '⚠️ Warning'}
                          </Badge>
                          <span className="font-medium text-foreground">{fmt(d.type)}</span>
                        </div>
                        <p className="text-muted-foreground">
                          {fmt(d.source_a)}: <span className="font-mono">{d.value_a ?? '—'}</span>
                          {' vs '}
                          {fmt(d.source_b)}: <span className="font-mono">{d.value_b ?? '—'}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* ── TicketOr2-style Stay Duration + Prior History card ── */}
            {!obs.processingPending && obs.plateNumber && obs.plateNumber !== 'MANUAL_REQUIRED' && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 space-y-2.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Officer Intelligence — {obs.plateNumber}
                </p>

                {/* Stay duration */}
                {(obs.consecutiveNights !== null || obs.nightsStayedThisMonth !== null) && (
                  <div className="flex gap-2 flex-wrap">
                    {obs.consecutiveNights !== null && (
                      <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold border ${
                        obs.consecutiveNights >= 3
                          ? 'bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800'
                          : obs.consecutiveNights >= 2
                            ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 border-orange-200 dark:border-orange-800'
                            : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                      }`}>
                        <Car className="h-3 w-3 shrink-0" />
                        {obs.consecutiveNights} consecutive night{obs.consecutiveNights !== 1 ? 's' : ''}
                      </div>
                    )}
                    {obs.nightsStayedThisMonth !== null && (
                      <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                        <Clock className="h-3 w-3 shrink-0" />
                        {obs.nightsStayedThisMonth} nights this month
                      </div>
                    )}
                  </div>
                )}

                {/* Return detection — highest priority alert */}
                {plateHistory?.returnDetected && (
                  <div className="flex items-start gap-2 rounded-lg p-2 bg-red-100 dark:bg-red-950/50 border border-red-300 dark:border-red-700">
                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-red-800 dark:text-red-200">
                      <span className="font-bold">Return Detected</span>
                      {' — '}Notice to Vacate served {plateHistory.returnDaysAgo} day{plateHistory.returnDaysAgo === 1 ? '' : 's'} ago
                      {plateHistory.lastNtVZone && ` at ${plateHistory.lastNtVZone}`}.
                      {' '}Vehicle has returned.
                    </div>
                  </div>
                )}

                {/* Prior enforcement history pills */}
                {plateHistory && (plateHistory.warningCount + plateHistory.ntVCount + plateHistory.infringementCount) > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Prior enforcement for this plate:</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {plateHistory.warningCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-700">
                          <FileWarning className="h-3 w-3" />
                          {plateHistory.warningCount} Warning{plateHistory.warningCount > 1 ? 's' : ''}
                        </span>
                      )}
                      {plateHistory.ntVCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-700">
                          <Megaphone className="h-3 w-3" />
                          {plateHistory.ntVCount} Notice{plateHistory.ntVCount > 1 ? 's' : ''} to Vacate
                        </span>
                      )}
                      {plateHistory.infringementCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-purple-100 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                          <Printer className="h-3 w-3" />
                          {plateHistory.infringementCount} Infringement{plateHistory.infringementCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {plateHistory.lastNtVAt && (
                      <p className="text-xs text-muted-foreground">
                        Last NtV: {new Date(plateHistory.lastNtVAt).toLocaleDateString('en-NZ')}
                        {plateHistory.lastNtVZone && ` (${plateHistory.lastNtVZone})`}
                      </p>
                    )}
                  </div>
                ) : plateHistory ? (
                  <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    No prior enforcement history for this plate
                  </p>
                ) : null}
              </div>
            )}

            {/* Editable vehicle fields */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Vehicle Details
              </p>
              {!editMode && (
                <Button variant="ghost" size="sm" className="h-6 text-xs"
                  onClick={() => setEditMode(true)}>
                  <Edit3 className="h-3 w-3 mr-1" />Edit / Correct
                </Button>
              )}
            </div>

            {editMode ? (
              <div className="space-y-3 rounded-xl border p-3 bg-slate-50 dark:bg-slate-900">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor="dp-plate" className="text-xs font-semibold">
                      Plate number{obs.plateNumber === 'MANUAL_REQUIRED' && (
                        <span className="ml-1 text-orange-500">* Required</span>
                      )}
                    </Label>
                    <Input id="dp-plate" value={editPlate}
                      onChange={e => setEditPlate(e.target.value.toUpperCase())}
                      className="font-mono uppercase h-8 text-sm"
                      placeholder="ABC123"
                      autoFocus={obs.plateNumber === 'MANUAL_REQUIRED'} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dp-make" className="text-xs">Make</Label>
                    <Input id="dp-make" value={editMake}
                      onChange={e => setEditMake(e.target.value)}
                      className="h-8 text-sm" placeholder="Toyota" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dp-model" className="text-xs">Model</Label>
                    <Input id="dp-model" value={editModel}
                      onChange={e => setEditModel(e.target.value)}
                      className="h-8 text-sm" placeholder="Camper" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dp-year" className="text-xs">Year</Label>
                    <Input id="dp-year" value={editYear} inputMode="numeric"
                      onChange={e => setEditYear(e.target.value)}
                      className="h-8 text-sm" placeholder="2019" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dp-colour" className="text-xs">Colour</Label>
                    <Input id="dp-colour" value={editColour}
                      onChange={e => setEditColour(e.target.value)}
                      className="h-8 text-sm" placeholder="White" />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor="dp-address" className="text-xs">Location / Street Address</Label>
                    <Input id="dp-address" value={editAddress}
                      onChange={e => setEditAddress(e.target.value)}
                      className="h-8 text-sm"
                      placeholder={locationAddress || 'e.g. 12 Wakatu Ln, Nelson'} />
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button className="flex-1 h-8 text-xs" onClick={handleSave} disabled={isSaving}>
                    {isSaving
                      ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving…</>
                      : <><Save className="h-3 w-3 mr-1" />Save Changes</>}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 text-xs"
                    onClick={() => { setEditMode(false) }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              /* Read-only details grid */
              <div className="space-y-2 text-sm">
                {[
                  { label: 'Plate',  value: plate === 'MANUAL_REQUIRED' ? '— (enter manually)' : (plate || (pending ? 'Detecting…' : '—')), sourceKey: null },
                  { label: 'Make',   value: obs.vehicleMake   || '—', sourceKey: 'make_source' as const },
                  { label: 'Model',  value: obs.vehicleModel  || '—', sourceKey: 'model_source' as const },
                  { label: 'Year',   value: obs.vehicleYear   || '—', sourceKey: 'year_source' as const },
                  { label: 'Colour', value: obs.vehicleColor  || '—', sourceKey: 'color_source' as const },
                ].map(({ label, value, sourceKey }) => {
                  const source = sourceKey && obs.vehicleAttributeSources ? obs.vehicleAttributeSources[sourceKey] : null
                  return (
                    <div key={label} className="flex justify-between items-center border-b pb-1.5 last:border-0">
                      <span className="text-muted-foreground">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${label === 'Plate' ? 'font-mono' : ''}`}>{value}</span>
                        {source && (
                          <span className="text-[11px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                            {fmtSource(source)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Location address */}
                {locationAddress && (
                  <div className="flex justify-between items-start border-b pb-1.5">
                    <span className="text-muted-foreground">Location</span>
                    <span className="font-medium text-right max-w-[60%] text-xs">{locationAddress}</span>
                  </div>
                )}

                {/* GPS coordinates */}
                {obs.gpsLatitude != null && obs.gpsLongitude != null && (
                  <div className="flex justify-between items-center border-b pb-1.5">
                    <span className="text-muted-foreground">GPS</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {Number(obs.gpsLatitude).toFixed(5)}, {Number(obs.gpsLongitude).toFixed(5)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── NOTES & H&S TAB ────────────────────────────────────── */}
          <TabsContent value="notes" className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dp-notes" className="text-sm font-semibold">
                Officer Notes
              </Label>
              <p className="text-xs text-muted-foreground">
                Record observations, behaviour, occupant interactions, or vehicle condition.
              </p>
              <Textarea
                id="dp-notes"
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={5}
                className="resize-none text-sm"
                placeholder="e.g. Occupant advised of 3-night limit. Vehicle appears to have been here 5+ nights. Generator running..."
              />
            </div>

            <Button
              className="w-full h-9 text-sm"
              onClick={async () => {
                if (!obs?.observationId) return
                if (editNotes === (obs.officerNotes ?? '')) { toast.info('No note changes'); return }
                setIsSaving(true)
                try {
                  const { error } = await (supabase.from('observations') as any)
                    .update({ officer_notes: editNotes || null })
                    .eq('observation_id', obs.observationId)
                  if (error) throw error
                  setObs(prev => prev ? { ...prev, officerNotes: editNotes } : null)
                  toast.success('Notes saved')
                  onActivity?.()
                } catch (err: any) {
                  toast.error(err.message || 'Failed to save notes')
                } finally {
                  setIsSaving(false)
                }
              }}
              disabled={isSaving}
            >
              {isSaving
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                : <><Save className="h-4 w-4 mr-2" />Save Notes</>}
            </Button>

            {/* ── Homeless claim ──────────────────────────────────────── */}
            <div className="rounded-xl border border-purple-200 bg-purple-50 dark:bg-purple-950/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Home className="h-4 w-4 text-purple-600 shrink-0" />
                  <p className="text-sm font-semibold text-purple-800 dark:text-purple-300">
                    Homeless Status
                  </p>
                </div>
                {obs.homelessStatus ? (
                  <Badge className="bg-purple-600 text-white text-[10px]">
                    {obs.homelessStatus === 'confirmed' ? 'Confirmed' : 'Claimed'}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-purple-400 text-purple-700 hover:bg-purple-100"
                    onClick={() => setShowHomelessForm(v => !v)}
                  >
                    <Flag className="h-3 w-3 mr-1" />
                    {showHomelessForm ? 'Cancel' : 'Flag Claim'}
                  </Button>
                )}
              </div>

              {showHomelessForm && !obs.homelessStatus && (
                <div className="space-y-2 pt-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Claim type</Label>
                    <Select value={homelessClaimType} onValueChange={v => setHomelessClaimType(v as 'claimed'|'confirmed')}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="claimed">Claimed — occupant self-reports (unverified)</SelectItem>
                        <SelectItem value="confirmed">Confirmed — officer verified / documented evidence</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    value={homelessClaimNotes}
                    onChange={e => setHomelessClaimNotes(e.target.value)}
                    rows={2}
                    className="text-xs resize-none"
                    placeholder="Notes (e.g. spoke to occupant, visible bedding, welfare check done)"
                  />
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white"
                    disabled={isSavingHomeless || !plate || plate === 'MANUAL_REQUIRED'}
                    onClick={handleSubmitHomelessClaim}
                  >
                    {isSavingHomeless
                      ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving…</>
                      : <><Home className="h-3 w-3 mr-1" />Record Homeless {homelessClaimType === 'confirmed' ? 'Confirmation' : 'Claim'}</>}
                  </Button>
                  <p className="text-[10px] text-purple-700 dark:text-purple-400">
                    This updates the vehicle record and may exempt the vehicle from enforcement.
                  </p>
                </div>
              )}

              {obs.homelessStatus && (
                <p className="text-xs text-purple-700 dark:text-purple-400">
                  {obs.homelessStatus === 'confirmed'
                    ? 'Vehicle is confirmed homeless — exempt from standard enforcement rules.'
                    : 'Homeless claim recorded (unverified) — awaiting admin review.'}
                </p>
              )}
            </div>

            {/* ── H&S incident inline form ──────────────────────────── */}
            <div className="rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-orange-600 shrink-0" />
                  <p className="text-sm font-semibold text-orange-800 dark:text-orange-300">
                    Health &amp; Safety Incident
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-orange-400 text-orange-700 hover:bg-orange-100"
                  onClick={() => setShowHSForm(v => !v)}
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {showHSForm ? 'Cancel' : 'Log Incident'}
                </Button>
              </div>

              {showHSForm ? (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Incident type</Label>
                      <Select value={hsIncidentType} onValueChange={setHSIncidentType}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="threatening_behaviour">Threatening Behaviour</SelectItem>
                          <SelectItem value="medical_emergency">Medical Emergency</SelectItem>
                          <SelectItem value="property_damage">Property Damage</SelectItem>
                          <SelectItem value="welfare_concern">Welfare Concern</SelectItem>
                          <SelectItem value="noise_complaint">Noise Complaint</SelectItem>
                          <SelectItem value="hazard">Hazard / Safety Risk</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Severity</Label>
                      <Select value={hsSeverity} onValueChange={v => setHSSeverity(v as 'low'|'medium'|'high'|'critical')}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="critical">Critical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Textarea
                    value={hsDescription}
                    onChange={e => setHSDescription(e.target.value)}
                    rows={3}
                    className="text-xs resize-none"
                    placeholder="Describe what happened — be specific about the risk, who was involved, and the location"
                  />
                  <Textarea
                    value={hsActionTaken}
                    onChange={e => setHSActionTaken(e.target.value)}
                    rows={2}
                    className="text-xs resize-none"
                    placeholder="Action taken (e.g. police contacted, person warned, area secured)"
                  />
                  {locationAddress && (
                    <p className="text-[10px] text-orange-700 dark:text-orange-400 flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      Location: {locationAddress}
                    </p>
                  )}
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-orange-600 hover:bg-orange-700 text-white"
                    disabled={isSavingHS || !hsDescription.trim()}
                    onClick={handleSubmitHS}
                  >
                    {isSavingHS
                      ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Submitting…</>
                      : <><ShieldAlert className="h-3 w-3 mr-1" />Submit H&amp;S Report</>}
                  </Button>
                  <p className="text-[10px] text-orange-700">
                    Admin will be notified immediately. Linked to this observation.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-orange-700 dark:text-orange-400">
                  If this scan involves threatening behaviour, a medical emergency, property damage,
                  or any H&amp;S risk — log a formal incident report now.
                </p>
              )}
            </div>
          </TabsContent>

          {/* ── ACTIONS TAB ────────────────────────────────────────── */}
          <TabsContent value="actions" className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

            {/* ── Admin response banner (highest priority) ─────────── */}
            {adminHasResponded && (
              <div className="rounded-xl border-2 border-blue-400 bg-blue-50 dark:bg-blue-950/40 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide flex items-center gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5 shrink-0" />
                  Admin Instructions
                </p>
                <p className="text-sm text-blue-900 dark:text-blue-200 leading-snug font-medium">
                  {breachAlert.admin_review_notes}
                </p>
                {breachAlert.due_date && (
                  <p className={`text-xs flex items-center gap-1 ${
                    new Date(breachAlert.due_date) < new Date() ? 'text-red-700 font-semibold' : 'text-blue-700'
                  }`}>
                    <Clock className="h-3 w-3 shrink-0" />
                    Due: {new Date(breachAlert.due_date).toLocaleDateString('en-NZ')}
                    {new Date(breachAlert.due_date) < new Date() && ' ⚠️ Overdue'}
                  </p>
                )}
              </div>
            )}

            {pending ? (
              <div className="flex items-center gap-3 text-blue-600 text-sm py-6 justify-center">
                <Loader2 className="h-5 w-5 animate-spin" />
                Processing scan — compliance results loading…
              </div>
            ) : compliant === false ? (
              <>
                <p className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <XCircle className="h-4 w-4" />
                  Breach detected: {fmtBreach(obs.breachType)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Select an enforcement action to take on-site.
                  All actions are logged and visible to administration.
                </p>

                {/* ── TicketOr2-style action recommendation ──────────────── */}
                {plateHistory && plateHistory.recommendation !== 'none' && (
                  <div className={`rounded-xl border-2 p-3 space-y-1 ${
                    plateHistory.recommendation === 'infringement'
                      ? 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700'
                      : plateHistory.recommendation === 'notice_to_vacate'
                        ? 'bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-700'
                        : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-700'
                  }`}>
                    <p className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 ${
                      plateHistory.recommendation === 'infringement' ? 'text-red-700 dark:text-red-300'
                      : plateHistory.recommendation === 'notice_to_vacate' ? 'text-orange-700 dark:text-orange-300'
                      : 'text-yellow-700 dark:text-yellow-300'
                    }`}>
                      {plateHistory.recommendation === 'infringement' && <Printer className="h-3.5 w-3.5 shrink-0" />}
                      {plateHistory.recommendation === 'notice_to_vacate' && <Megaphone className="h-3.5 w-3.5 shrink-0" />}
                      {plateHistory.recommendation === 'warning' && <FileWarning className="h-3.5 w-3.5 shrink-0" />}
                      Recommended:{' '}
                      {plateHistory.recommendation === 'infringement' ? 'Issue Infringement Notice'
                        : plateHistory.recommendation === 'notice_to_vacate' ? 'Issue Notice to Vacate'
                        : 'Issue Warning'}
                    </p>
                    <p className="text-xs text-muted-foreground">{plateHistory.recommendationReason}</p>
                  </div>
                )}

                {/* Warning — shown for officer_direct, hybrid, and admin_first */}
                <Button
                  variant="outline"
                  className="w-full justify-start h-14 border-yellow-400 text-yellow-800 hover:bg-yellow-50 dark:border-yellow-500 dark:text-yellow-300 dark:hover:bg-yellow-950/40"
                  disabled={isIssuingAction || !plate || plate === 'MANUAL_REQUIRED' || !obs.observationId}
                  onClick={() => {
                    onIssueAction({
                      observationId: obs.observationId,
                      zoneId:        obs.observationZoneId,
                      plateNumber:   plate!,
                      actionType:    'warning',
                    })
                    onActivity?.()
                  }}
                >
                  <FileWarning className="h-5 w-5 mr-3 text-yellow-600 dark:text-yellow-400 shrink-0" />
                  <div className="text-left">
                    <div className="text-base font-bold">Issue Warning</div>
                    <div className="text-xs font-normal opacity-70">Verbal + logged notice of breach</div>
                  </div>
                </Button>

                {/* Notice to Vacate — officer_direct and hybrid workflows */}
                {(orgWorkflow === 'officer_direct' || orgWorkflow === 'hybrid') && (
                  <Button
                    variant="outline"
                    className="w-full justify-start h-14 border-red-400 text-red-800 hover:bg-red-50 dark:border-red-500 dark:text-red-300 dark:hover:bg-red-950/40"
                    disabled={isIssuingAction || !plate || plate === 'MANUAL_REQUIRED' || !obs.observationId}
                    onClick={() => {
                      onIssueAction({
                        observationId: obs.observationId,
                        zoneId:        obs.observationZoneId,
                        plateNumber:   plate!,
                        actionType:    'notice_to_vacate',
                      })
                      onActivity?.()
                    }}
                  >
                    <Megaphone className="h-5 w-5 mr-3 text-red-600 dark:text-red-400 shrink-0" />
                    <div className="text-left">
                      <div className="text-base font-bold">Notice to Vacate</div>
                      <div className="text-xs font-normal opacity-70">Formal order to leave the area</div>
                    </div>
                  </Button>
                )}

                {/* Issue Infringement Notice — navigates to full notice form */}
                {obs.observationId && (
                  <Button
                    variant="outline"
                    className="w-full justify-start h-14 border-purple-400 text-purple-800 hover:bg-purple-50 dark:border-purple-500 dark:text-purple-300 dark:hover:bg-purple-950/40"
                    disabled={!plate || plate === 'MANUAL_REQUIRED' || !obs.observationId}
                    onClick={() => {
                      navigate(`/infringements?observation_id=${encodeURIComponent(obs.observationId)}`)
                      onActivity?.()
                    }}
                  >
                    <Printer className="h-5 w-5 mr-3 text-purple-600 dark:text-purple-400 shrink-0" />
                    <div className="text-left">
                      <div className="text-base font-bold">Issue Infringement Notice</div>
                      <div className="text-xs font-normal opacity-70">Generate formal infringement / fine</div>
                    </div>
                  </Button>
                )}

                {/* Admin First — auto-reported + escalate option */}
                {(!orgWorkflow || orgWorkflow === 'admin_first') && (
                  <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-3">
                    <Shield className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                    <div className="text-sm flex-1">
                      <p className="font-semibold text-blue-800 dark:text-blue-300">Reported to Admin</p>
                      <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                        This breach has been automatically flagged.
                        Administration will review and authorise next steps.
                      </p>
                    </div>
                  </div>
                )}

                {/* Escalate to admin — shown when admin hasn't responded yet */}
                {!adminHasResponded && (
                  <Button
                    variant="outline"
                    className="w-full justify-start h-14 border-indigo-400 text-indigo-800 hover:bg-indigo-50 dark:border-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                    disabled={escalateMutation.isPending || !plate || plate === 'MANUAL_REQUIRED'}
                    onClick={() => { escalateMutation.mutate(); onActivity?.() }}
                  >
                    <Bell className="h-5 w-5 mr-3 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <div className="text-left">
                      <div className="text-base font-bold">
                        {escalateMutation.isPending ? 'Flagging…' : 'Escalate — Request Urgent Admin Review'}
                      </div>
                      <div className="text-xs font-normal opacity-70">
                        Flags this scan for immediate admin attention
                      </div>
                    </div>
                  </Button>
                )}
              </>
            ) : compliant === true ? (
              <>
                <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/30 p-4">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-semibold text-green-800 dark:text-green-300">Vehicle is Compliant</p>
                    <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                      No enforcement action required. Observation has been recorded.
                    </p>
                  </div>
                </div>
                {/* Still allow infringement for compliant vehicles if officer decides */}
                {obs.observationId && (
                  <Button
                    variant="outline"
                    className="w-full justify-start h-14 border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                    onClick={() => {
                      navigate(`/infringements?observation_id=${encodeURIComponent(obs.observationId)}`)
                      onActivity?.()
                    }}
                  >
                    <Printer className="h-5 w-5 mr-3 text-gray-500 dark:text-gray-400 shrink-0" />
                    <div className="text-left">
                      <div className="text-base font-bold">Issue Infringement Notice</div>
                      <div className="text-xs font-normal opacity-70">Generate formal infringement if needed</div>
                    </div>
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">
                Compliance status not yet available.
              </p>
            )}

            {/* View full vehicle record (admin_officer + admin roles) */}
            {plate && (
              <Button
                variant="ghost"
                className="w-full text-xs text-muted-foreground"
                onClick={() => {
                  navigate(`/vehicles?plate=${encodeURIComponent(plate)}`)
                  onActivity?.()
                }}
              >
                <ExternalLink className="h-3 w-3 mr-1.5" />
                View full vehicle record
              </Button>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
