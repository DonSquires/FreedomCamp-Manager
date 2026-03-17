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
 *  - H&S incident quick-link (pre-fills zone + plate)
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
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import {
  Camera, Car, CheckCircle, XCircle, Clock, Save, AlertTriangle,
  ShieldAlert, MapPin, FileWarning, Megaphone, Shield, ExternalLink,
  Loader2, Edit3, Bell, ClipboardList,
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
  isSelfContained: boolean
  selfContainedExpiry: string | null
  cscStatus: string | null
  vehicleMoved: boolean | null
  isNewVehicle: boolean
  officerNotes: string | null
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
  const [editPlate,  setEditPlate]  = useState('')
  const [editMake,   setEditMake]   = useState('')
  const [editModel,  setEditModel]  = useState('')
  const [editYear,   setEditYear]   = useState('')
  const [editColour, setEditColour] = useState('')
  const [editNotes,  setEditNotes]  = useState('')
  const [isSaving,   setIsSaving]   = useState(false)
  const [editMode,   setEditMode]   = useState(false)

  // Keep local state in sync when initialData changes (new scan opened)
  useEffect(() => {
    setObs(initialData)
    setEditPlate(initialData?.plateNumber  ?? '')
    setEditMake(initialData?.vehicleMake   ?? '')
    setEditModel(initialData?.vehicleModel ?? '')
    setEditYear(initialData?.vehicleYear   ?? '')
    setEditColour(initialData?.vehicleColor ?? '')
    setEditNotes(initialData?.officerNotes  ?? '')
    setEditMode(false)
  }, [initialData?.observationId]) // reset only when a new observation opens

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
          'vehicle_make, vehicle_model, vehicle_year, vehicle_color,' +
          'self_contained, self_contained_expiry, zone_id,' +
          'has_discrepancies, discrepancy_flags,' +
          'zone:zones!zone_id(name)'
        )
        .eq('observation_id', obs.observationId)
        .maybeSingle()

      if (!data) {
        if (attempts < MAX_POLL_ATTEMPTS) timer = setTimeout(poll, POLL_INTERVAL_MS)
        return
      }

      const resolved =
        data.plate_number &&
        data.plate_number !== 'PROCESSING...' &&
        data.plate_number !== 'MANUAL_REQUIRED'

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
        isSelfContained:   !!data.self_contained,
        selfContainedExpiry: data.self_contained_expiry ?? prev.selfContainedExpiry,
        officerNotes:      data.officer_notes        ?? prev.officerNotes,
        hasDiscrepancies:  !!(data.has_discrepancies),
        discrepancyFlags:  Array.isArray(data.discrepancy_flags) ? data.discrepancy_flags : prev.discrepancyFlags,
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
      if (plateNorm && plateNorm !== (obs.plateNumber ?? ''))     updates.plate_number  = plateNorm
      if (editMake.trim()   !== (obs.vehicleMake   ?? ''))        updates.vehicle_make  = editMake.trim() || null
      if (editModel.trim()  !== (obs.vehicleModel  ?? ''))        updates.vehicle_model = editModel.trim() || null
      if (editYear.trim()   !== (obs.vehicleYear   ?? ''))        updates.vehicle_year  = editYear.trim() ? Number(editYear) : null
      if (editColour.trim() !== (obs.vehicleColor  ?? ''))        updates.vehicle_color = editColour.trim() || null
      if (editNotes         !== (obs.officerNotes  ?? ''))        updates.officer_notes = editNotes || null

      if (Object.keys(updates).length === 0) {
        toast.info('No changes to save')
        setEditMode(false)
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
      } : null)

      toast.success('Observation updated')
      setEditMode(false)
      onActivity?.()
    } catch (err: any) {
      toast.error(err.message || 'Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }, [obs, editPlate, editMake, editModel, editYear, editColour, editNotes, onActivity])

  // ── H&S incident ─────────────────────────────────────────────────────────
  const handleHSIncident = () => {
    const plate = obs?.plateNumber || ''
    const zone  = obs?.observationZoneId || ''
    // Navigate to incident creation, pre-filling plate + zone via query params
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
                {pending && (
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

              {/* Zone */}
              {obs.zoneName && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3 w-3 shrink-0" />{obs.zoneName}
                  <span className="text-gray-400">· {fmtDate(obs.recordedAt)}</span>
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

            {/* CSC status */}
            {!pending && (
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
                    <Label htmlFor="dp-plate" className="text-xs">Plate number</Label>
                    <Input id="dp-plate" value={editPlate}
                      onChange={e => setEditPlate(e.target.value.toUpperCase())}
                      className="font-mono uppercase h-8 text-sm"
                      placeholder="ABC123" />
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
                  { label: 'Plate',  value: plate || (pending ? 'Detecting…' : '—') },
                  { label: 'Make',   value: obs.vehicleMake   || '—' },
                  { label: 'Model',  value: obs.vehicleModel  || '—' },
                  { label: 'Year',   value: obs.vehicleYear   || '—' },
                  { label: 'Colour', value: obs.vehicleColor  || '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between border-b pb-1.5 last:border-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-medium ${label === 'Plate' ? 'font-mono' : ''}`}>{value}</span>
                  </div>
                ))}
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

            {/* H&S incident */}
            <div className="rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-orange-600 shrink-0" />
                <p className="text-sm font-semibold text-orange-800 dark:text-orange-300">
                  Health &amp; Safety Incident
                </p>
              </div>
              <p className="text-xs text-orange-700 dark:text-orange-400">
                If this scan involves threatening behaviour, a medical emergency, property damage,
                or any H&amp;S risk — log a formal incident report now.
              </p>
              <Button
                variant="outline"
                className="w-full h-8 text-xs border-orange-400 text-orange-700 hover:bg-orange-100"
                onClick={handleHSIncident}
              >
                <AlertTriangle className="h-3 w-3 mr-1.5" />
                Create H&amp;S Incident Report
                <ExternalLink className="h-3 w-3 ml-1.5 opacity-60" />
              </Button>
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

                {/* Warning */}
                {(orgWorkflow === 'officer_direct' || orgWorkflow === 'hybrid') && (
                  <Button
                    variant="outline"
                    className="w-full justify-start h-11 border-yellow-400 text-yellow-800 hover:bg-yellow-50"
                    disabled={isIssuingAction || !plate || !obs.observationId}
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
                    <FileWarning className="h-4 w-4 mr-2 text-yellow-600 shrink-0" />
                    <div className="text-left">
                      <div className="text-sm font-semibold">Issue Warning</div>
                      <div className="text-[11px] font-normal opacity-70">Verbal + logged notice of breach</div>
                    </div>
                  </Button>
                )}

                {/* Notice to Vacate */}
                {orgWorkflow === 'officer_direct' && (
                  <Button
                    variant="outline"
                    className="w-full justify-start h-11 border-red-400 text-red-800 hover:bg-red-50"
                    disabled={isIssuingAction || !plate || !obs.observationId}
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
                    <Megaphone className="h-4 w-4 mr-2 text-red-600 shrink-0" />
                    <div className="text-left">
                      <div className="text-sm font-semibold">Notice to Vacate</div>
                      <div className="text-[11px] font-normal opacity-70">Formal order to leave the area</div>
                    </div>
                  </Button>
                )}

                {/* Admin First — auto-reported + escalate option */}
                {(!orgWorkflow || orgWorkflow === 'admin_first' || orgWorkflow === 'hybrid') && (
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
                    className="w-full justify-start h-11 border-indigo-400 text-indigo-800 hover:bg-indigo-50"
                    disabled={escalateMutation.isPending || !plate}
                    onClick={() => { escalateMutation.mutate(); onActivity?.() }}
                  >
                    <Bell className="h-4 w-4 mr-2 text-indigo-600 shrink-0" />
                    <div className="text-left">
                      <div className="text-sm font-semibold">
                        {escalateMutation.isPending ? 'Flagging…' : 'Escalate — Request Urgent Admin Review'}
                      </div>
                      <div className="text-[11px] font-normal opacity-70">
                        Flags this scan for immediate admin attention
                      </div>
                    </div>
                  </Button>
                )}
              </>
            ) : compliant === true ? (
              <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/30 p-4">
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-green-800 dark:text-green-300">Vehicle is Compliant</p>
                  <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                    No enforcement action required. Observation has been recorded.
                  </p>
                </div>
              </div>
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
