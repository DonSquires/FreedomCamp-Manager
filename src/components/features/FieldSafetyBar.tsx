/**
 * FieldSafetyBar
 *
 * Compact always-visible safety strip for ALL field officers regardless of
 * which portal they are using.
 *
 * Contains:
 *   • Welfare "I'm OK" check-in with overdue indicator
 *   • SOS / Panic hold-button (3-second hold to prevent accidental triggers)
 *   • Quick-report launcher (H&S · Incident · Maintenance)
 *
 * Usage:
 *   Place as the FIRST child inside <AppLayout> on every officer portal.
 *   It renders nothing for non-officer roles.
 */

import { useState, useRef, useCallback } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { useWelfareCheckin } from '@/hooks/useWelfareCheckin'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { CheckCircle, Siren, FileWarning, ShieldAlert, Wrench, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldSafetyBarProps {
  officerShiftId?: string | null
  zoneId?: string | null
  position?: { latitude: number; longitude: number } | null
  /** Compact: hide labels, show only icons. Default false */
  compact?: boolean
}

type ReportType = 'hs' | 'incident' | 'maintenance'

const INCIDENT_TYPES = [
  'general_incident', 'aggression', 'theft', 'vandalism', 'trespass',
  'welfare_concern', 'property_damage', 'vehicle_incident', 'other',
]

const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical'] as const

// ─── Component ────────────────────────────────────────────────────────────────

export function FieldSafetyBar({
  officerShiftId = null,
  zoneId = null,
  position = null,
  compact = false,
}: FieldSafetyBarProps) {
  const { user } = useAuthStore()

  // ── Welfare check-in ───────────────────────────────────────────────────────

  const { state: checkinState, checkIn } = useWelfareCheckin({
    officerId:      user?.id ?? null,
    organizationId: user?.organization_id ?? null,
    shiftId:        officerShiftId,
    position,
    isShiftActive:  !!officerShiftId,
  })

  // ── SOS hold ──────────────────────────────────────────────────────────────

  const [sosProgress, setSosProgress]     = useState(0)
  const sosIntervalRef                    = useRef<ReturnType<typeof setInterval> | null>(null)

  function startSosHold() {
    setSosProgress(0)
    sosIntervalRef.current = setInterval(() => {
      setSosProgress(p => {
        if (p >= 100) {
          clearInterval(sosIntervalRef.current!)
          fireSOS()
          return 0
        }
        return p + 10
      })
    }, 300)
  }

  function cancelSosHold() {
    if (sosIntervalRef.current) clearInterval(sosIntervalRef.current)
    setSosProgress(0)
  }

  async function fireSOS() {
    if (!user?.id || !user?.organization_id) return
    try {
      await supabase.from('officer_welfare_alerts').insert({
        officer_id:       user.id,
        organization_id:  user.organization_id,
        alert_type:       'sos',
        officer_name:     `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim(),
        gps_latitude:     position?.latitude  ?? null,
        gps_longitude:    position?.longitude ?? null,
        last_activity_at: new Date().toISOString(),
        escalation_level: 2,
      })
      toast.error('🚨 SOS ALERT SENT — Help is on the way', { duration: 0, id: 'sos-alert' })
    } catch (err: any) {
      toast.error(err?.message ?? 'SOS failed — call emergency services directly')
    }
  }

  // ── Quick report dialog ────────────────────────────────────────────────────

  const [reportOpen, setReportOpen]       = useState(false)
  const [reportType, setReportType]       = useState<ReportType>('incident')
  const [incidentType, setIncidentType]   = useState('general_incident')
  const [severity, setSeverity]           = useState<'low'|'medium'|'high'|'critical'>('medium')
  const [description, setDescription]     = useState('')
  const [actionTaken, setActionTaken]     = useState('')
  const [locationNote, setLocationNote]   = useState('')
  const [submitting, setSubmitting]       = useState(false)

  function openReport(type: ReportType) {
    setReportType(type)
    setDescription('')
    setActionTaken('')
    setLocationNote('')
    setSeverity('medium')
    setIncidentType('general_incident')
    setReportOpen(true)
  }

  const submitReport = useCallback(async () => {
    if (!user?.id || !user?.organization_id) return
    if (!description.trim()) { toast.error('Please enter a description'); return }
    setSubmitting(true)
    try {
      if (reportType === 'hs') {
        await (supabase.from('health_safety_reports') as any).insert({
          organization_id: user.organization_id,
          reported_by:     user.id,
          report_type:     'hazard',
          severity,
          description,
          immediate_action_taken: actionTaken || null,
          location_description:   locationNote || null,
          gps_lat:  position?.latitude  ?? null,
          gps_lng:  position?.longitude ?? null,
          zone_id:  zoneId || null,
          status:   'submitted',
        })
        toast.success('H&S report submitted')
      } else {
        await (supabase.from('incidents') as any).insert({
          organization_id: user.organization_id,
          reported_by:     user.id,
          zone_id:         zoneId || null,
          incident_type:   reportType === 'maintenance' ? 'maintenance_report' : incidentType,
          description,
          action_taken:    actionTaken || null,
          location:        locationNote || null,
          severity,
          gps_lat:         position?.latitude  ?? null,
          gps_lng:         position?.longitude ?? null,
          status:          'open',
        })
        toast.success(reportType === 'maintenance' ? 'Maintenance report submitted' : 'Incident report submitted')
      }
      setReportOpen(false)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to submit report')
    } finally {
      setSubmitting(false)
    }
  }, [user, reportType, incidentType, severity, description, actionTaken, locationNote, zoneId, position])

  // ── Collapse state (for compact mode) ────────────────────────────────────

  const [expanded, setExpanded] = useState(true)

  // ─────────────────────────────────────────────────────────────────────────

  const isOverdue   = checkinState.isOverdue
  const checkinDue  = checkinState.isDue || isOverdue

  return (
    <>
      {/* ── Safety Strip ───────────────────────────────────────────────────── */}
      <div className={`rounded-xl border mb-4 overflow-hidden transition-colors ${
        isOverdue
          ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/30'
          : 'border-gray-200 bg-white dark:bg-gray-900'
      }`}>
        {/* Header row — always visible */}
        <div className="flex items-center gap-2 px-3 py-2">

          {/* Welfare check-in */}
          {checkinState.intervalMinutes > 0 && (
            <Button
              size="sm"
              onClick={checkIn}
              disabled={checkinState.isSubmitting}
              className={`flex-1 font-semibold text-xs ${
                isOverdue
                  ? 'bg-orange-500 hover:bg-orange-600 text-white'
                  : checkinDue
                  ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1 shrink-0" />
              {compact ? "OK" : isOverdue ? "OVERDUE — I'm OK" : checkinDue ? "Check In Due" : "I'm OK"}
            </Button>
          )}

          {/* SOS hold button */}
          <button
            type="button"
            onPointerDown={startSosHold}
            onPointerUp={cancelSosHold}
            onPointerLeave={cancelSosHold}
            className="relative overflow-hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-red-300 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 text-xs font-bold select-none active:scale-95 transition-transform shrink-0"
            aria-label="SOS"
          >
            {sosProgress > 0 && (
              <div
                className="absolute inset-0 bg-red-400/30 transition-all"
                style={{ width: `${sosProgress}%` }}
              />
            )}
            <Siren className="h-3.5 w-3.5 shrink-0 relative z-10" />
            <span className="relative z-10 hidden sm:inline">
              {sosProgress > 0 ? `${Math.round(sosProgress)}%` : 'SOS'}
            </span>
          </button>

          {/* Quick report buttons */}
          <button
            type="button"
            onClick={() => openReport('hs')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 shrink-0"
            title="H&S Report"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            {!compact && <span className="hidden md:inline">H&amp;S</span>}
          </button>
          <button
            type="button"
            onClick={() => openReport('incident')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-yellow-200 bg-yellow-50 text-yellow-700 text-xs font-medium hover:bg-yellow-100 shrink-0"
            title="Incident Report"
          >
            <FileWarning className="h-3.5 w-3.5" />
            {!compact && <span className="hidden md:inline">Incident</span>}
          </button>
          <button
            type="button"
            onClick={() => openReport('maintenance')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 shrink-0"
            title="Maintenance Report"
          >
            <Wrench className="h-3.5 w-3.5" />
            {!compact && <span className="hidden md:inline">Maint.</span>}
          </button>
        </div>

        {/* Overdue banner */}
        {isOverdue && (
          <div className="px-3 pb-2">
            <p className="text-xs text-orange-700 font-medium">
              ⚠ Welfare check-in overdue — please tap "I'm OK" to confirm you're safe
            </p>
          </div>
        )}
      </div>

      {/* ── Quick Report Dialog ────────────────────────────────────────────── */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {reportType === 'hs'
                ? <><ShieldAlert className="h-5 w-5 text-red-600" /> H&amp;S Report</>
                : reportType === 'maintenance'
                ? <><Wrench className="h-5 w-5 text-blue-600" /> Maintenance Report</>
                : <><FileWarning className="h-5 w-5 text-yellow-600" /> Incident Report</>}
            </DialogTitle>
            <DialogDescription>
              {reportType === 'hs'
                ? 'Report a hazard, near-miss or unsafe condition.'
                : reportType === 'maintenance'
                ? 'Log a maintenance issue for follow-up.'
                : 'Record an incident for the admin team.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {reportType === 'incident' && (
              <div>
                <Label className="text-xs">Incident Type</Label>
                <Select value={incidentType} onValueChange={setIncidentType}>
                  <SelectTrigger className="mt-0.5 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INCIDENT_TYPES.map(t => (
                      <SelectItem key={t} value={t} className="text-sm capitalize">
                        {t.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-xs">Severity</Label>
              <Select value={severity} onValueChange={v => setSeverity(v as any)}>
                <SelectTrigger className="mt-0.5 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map(s => (
                    <SelectItem key={s} value={s} className="text-sm capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Description *</Label>
              <Textarea
                className="mt-0.5 text-sm"
                rows={3}
                placeholder="What happened? Include relevant details…"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div>
              <Label className="text-xs">Action Taken</Label>
              <Textarea
                className="mt-0.5 text-sm"
                rows={2}
                placeholder="What did you do immediately?"
                value={actionTaken}
                onChange={e => setActionTaken(e.target.value)}
              />
            </div>

            <div>
              <Label className="text-xs">Location</Label>
              <Input
                className="mt-0.5 text-sm"
                placeholder="e.g. 'main entrance', 'car park B'"
                value={locationNote}
                onChange={e => setLocationNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReportOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={submitting}
              onClick={submitReport}
              className={
                reportType === 'hs' ? 'bg-red-600 hover:bg-red-700 text-white'
                : reportType === 'maintenance' ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-yellow-600 hover:bg-yellow-700 text-white'
              }
            >
              {submitting ? 'Submitting…' : 'Submit Report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
