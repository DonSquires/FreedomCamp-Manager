/**
 * EMSPortal — Electronic Monitoring Services attendance log.
 *
 * Officers attend offenders to fit, remove, check or escort with ankle
 * trackers / GPS units / alcohol monitors.  Rates are seniority-based
 * (levels 1-5).  All offender data is de-identified (case reference only —
 * no PII stored in this system).
 *
 * Route: /ems
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GeofenceWarningBanner } from '@/components/features/GeofenceWarningBanner'
import { useShiftGate } from '@/hooks/useShiftGate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Zap, Plus, Clock, MapPin, DollarSign, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO, differenceInMinutes } from 'date-fns'
import { nzNow } from '@/lib/timezone'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EMSAttendance {
  id: string
  attendance_date: string
  action: string
  start_time: string | null
  end_time: string | null
  attendance_address: string | null
  district: string | null
  offender_ref: string | null
  device_serial: string | null
  device_type: string | null
  travel_km: number
  officer_seniority_level: number
  rate_per_hour: number | null
  billable_hours: number | null
  status: string
  notes: string | null
}

interface EMSFormData {
  attendance_date: string
  action: string
  start_time: string
  end_time: string
  attendance_address: string
  district: string
  offender_ref: string
  device_serial: string
  device_type: string
  travel_km: string
  officer_seniority_level: number
  rate_per_hour: string
  notes: string
}

// ─── EMS seniority rate guide ─────────────────────────────────────────────────
// These are indicative reference rates. Actual rates are set in officer_activity_rates.
const SENIORITY_LABELS: Record<number, string> = {
  1: 'Level 1 — New Contractor (< 6 months)',
  2: 'Level 2 — Competent (6–18 months)',
  3: 'Level 3 — Experienced (18 months – 3 years)',
  4: 'Level 4 — Senior (3–5 years)',
  5: 'Level 5 — Lead / Trainer (5+ years)',
}

const ACTION_LABELS: Record<string, string> = {
  fit:              'Installation (Fit Device)',
  check:            'Field Visit / Inspection',
  remove:           'Maintenance (Remove Device)',
  escort:           'Escort / Transport',
  emergency_remove: 'Emergency Removal',
}

const DEVICE_LABELS: Record<string, string> = {
  ankle_tracker:   'Ankle Tracker',
  gps_unit:        'GPS Unit',
  alcohol_monitor: 'Alcohol Monitor',
  other:           'Other',
}

const STATUS_COLOURS: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
}

function emptyForm(): EMSFormData {
  const now = new Date()
  const dateStr = format(nzNow(), 'yyyy-MM-dd')
  return {
    attendance_date: dateStr,
    action: '',
    start_time: format(now, 'HH:mm'),
    end_time: '',
    attendance_address: '',
    district: '',
    offender_ref: '',
    device_serial: '',
    device_type: 'ankle_tracker',
    travel_km: '',
    officer_seniority_level: 1,
    rate_per_hour: '',
    notes: '',
  }
}

function billableHours(startTime: string, endTime: string, date: string): number | null {
  if (!startTime || !endTime) return null
  const start = new Date(`${date}T${startTime}:00`)
  const end   = new Date(`${date}T${endTime}:00`)
  const mins  = differenceInMinutes(end, start)
  return mins > 0 ? parseFloat((mins / 60).toFixed(2)) : null
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EMSPortal() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<EMSFormData>(emptyForm)

  const { gateApplies, canAccessPortal, canUseFeature, geofenceViolation, isLoading: gateLoading } = useShiftGate()
  useEffect(() => {
    if (!gateLoading && gateApplies && (!canAccessPortal || !canUseFeature('ems'))) {
      navigate('/officer-home', { replace: true })
    }
  }, [gateApplies, canAccessPortal, canUseFeature, gateLoading, navigate])

  function set<K extends keyof EMSFormData>(key: K, value: EMSFormData[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: attendances = [], isLoading } = useQuery<EMSAttendance[]>({
    queryKey: ['ems_attendances', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('ems_attendances')
        .select('id, attendance_date, action, start_time, end_time, attendance_address, district, offender_ref, device_serial, device_type, travel_km, officer_seniority_level, rate_per_hour, billable_hours, status, notes')
        .eq('officer_id', user.id)
        .order('attendance_date', { ascending: false })
        .order('start_time', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as EMSAttendance[]
    },
    enabled: !!user?.id,
  })

  // ── Seniority-based rate (from officer_activity_rates if set) ──────────────

  const { data: emsRate } = useQuery<number | null>({
    queryKey: ['ems_rate', user?.id],
    queryFn: async () => {
      if (!user?.id) return null
      const today = format(nzNow(), 'yyyy-MM-dd')
      const { data } = await supabase
        .from('officer_activity_rates')
        .select('rate_per_hour')
        .eq('officer_id', user.id)
        .eq('activity_type', 'ems')
        .lte('effective_from', today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data?.rate_per_hour ? Number(data.rate_per_hour) : null
    },
    enabled: !!user?.id,
  })

  // Pre-fill rate when dialog opens
  function openDialog() {
    const f = emptyForm()
    if (emsRate) f.rate_per_hour = String(emsRate)
    setForm(f)
    setDialogOpen(true)
  }

  // ── Create mutation ────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (data: EMSFormData) => {
      if (!user?.id) throw new Error('Not authenticated')
      if (!data.action) throw new Error('Please select an action')
      if (!data.start_time) throw new Error('Start time is required')

      let organizationId = user.organization_id ?? null
      if (!organizationId) {
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user.id)
          .single()

        if (profileError || !profile?.organization_id) {
          throw new Error('Unable to resolve your organization. Please try again.')
        }

        organizationId = profile.organization_id
      }

      const bh = billableHours(data.start_time, data.end_time, data.attendance_date)

      const { error } = await supabase.from('ems_attendances').insert({
        organization_id:        organizationId,
        officer_id:             user.id,
        attendance_date:        data.attendance_date,
        action:                 data.action,
        start_time:             `${data.attendance_date}T${data.start_time}:00`,
        end_time:               data.end_time ? `${data.attendance_date}T${data.end_time}:00` : null,
        attendance_address:     data.attendance_address || null,
        district:               data.district || null,
        offender_ref:           data.offender_ref || null,
        device_serial:          data.device_serial || null,
        device_type:            data.device_type || null,
        travel_km:              data.travel_km ? parseFloat(data.travel_km) : 0,
        officer_seniority_level: data.officer_seniority_level,
        rate_per_hour:          data.rate_per_hour ? parseFloat(data.rate_per_hour) : null,
        billable_hours:         bh,
        notes:                  data.notes || null,
        status:                 'draft',
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ems_attendances', user?.id] })
      toast.success('EMS attendance submitted')
      setDialogOpen(false)
    },
    onError: (e: any) => toast.error(e.message || 'Failed to submit'),
  })

  // ── Stats ──────────────────────────────────────────────────────────────────

  const todayStr = format(nzNow(), 'yyyy-MM-dd')
  const todayAttendances = attendances.filter(a => a.attendance_date === todayStr)
  const todayHours = todayAttendances.reduce((sum, a) => sum + (a.billable_hours ?? 0), 0)
  const todayEarnings = todayAttendances.reduce((sum, a) => {
    if (a.billable_hours && a.rate_per_hour) return sum + a.billable_hours * a.rate_per_hour
    return sum
  }, 0)

  // ── Computed billable hours in form ───────────────────────────────────────

  const formBillableHours = billableHours(form.start_time, form.end_time, form.attendance_date)

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="EMS Portal"
      description="Electronic Monitoring Services"
      showBackButton
    >
      {geofenceViolation && <GeofenceWarningBanner />}
      {/* Header strip */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center">
            <Zap className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <p className="font-semibold">EMS Attendance Log</p>
            <p className="text-xs text-gray-500">De-identified records only — no offender PII</p>
          </div>
        </div>
        <Button
          className="bg-red-700 hover:bg-red-800 text-white"
          onClick={openDialog}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Attendance
        </Button>
      </div>

      {/* Today KPIs */}
      {todayAttendances.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold">{todayAttendances.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Today's Jobs</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold">{todayHours.toFixed(1)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Billable Hours</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold text-green-700">
                ${todayEarnings.toFixed(0)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Est. Earnings</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Attendance list */}
      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
      ) : attendances.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle2 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No attendances recorded yet.</p>
          <p className="text-xs text-gray-400 mt-1">Tap "New Attendance" to log your first job.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {attendances.map((att) => {
            const bh = att.billable_hours ?? 0
            const earn = bh && att.rate_per_hour ? bh * att.rate_per_hour : null
            return (
              <Card key={att.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">
                          {ACTION_LABELS[att.action] ?? att.action}
                        </p>
                        <Badge className={`text-xs ${STATUS_COLOURS[att.status] ?? ''}`}>
                          {att.status}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          L{att.officer_seniority_level}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {att.start_time ? format(parseISO(att.start_time), 'h:mm a') : '—'}
                          {att.end_time ? ` – ${format(parseISO(att.end_time), 'h:mm a')}` : ''}
                        </span>
                        {att.attendance_address && (
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            {att.attendance_address}
                          </span>
                        )}
                      </div>
                      {att.offender_ref && (
                        <p className="text-xs text-gray-400 mt-0.5">Ref: {att.offender_ref}</p>
                      )}
                      {att.device_type && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {DEVICE_LABELS[att.device_type] ?? att.device_type}
                          {att.device_serial ? ` — ${att.device_serial}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {bh > 0 && (
                        <p className="text-sm font-semibold">{bh.toFixed(2)} hrs</p>
                      )}
                      {earn != null && (
                        <p className="text-xs text-green-700 font-medium">${earn.toFixed(2)}</p>
                      )}
                      {att.travel_km > 0 && (
                        <p className="text-xs text-gray-400">{att.travel_km} km travel</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── New Attendance Dialog ────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-red-600" />
              Log EMS Attendance
            </DialogTitle>
            <DialogDescription>
              All records are de-identified. Do not enter offender names or personal details.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Date + Action */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date *</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={form.attendance_date}
                  onChange={e => set('attendance_date', e.target.value)}
                />
              </div>
              <div>
                <Label>Action *</Label>
                <Select value={form.action} onValueChange={v => set('action', v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACTION_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Time *</Label>
                <Input type="time" className="mt-1" value={form.start_time} onChange={e => set('start_time', e.target.value)} />
              </div>
              <div>
                <Label>End Time</Label>
                <Input type="time" className="mt-1" value={form.end_time} onChange={e => set('end_time', e.target.value)} />
              </div>
            </div>

            {formBillableHours != null && (
              <p className="text-xs text-green-700 font-medium flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Billable: {formBillableHours.toFixed(2)} hours
                {form.rate_per_hour && ` = $${(formBillableHours * parseFloat(form.rate_per_hour)).toFixed(2)}`}
              </p>
            )}

            {/* Location */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Address</Label>
                <Input className="mt-1 text-sm" placeholder="Street address" value={form.attendance_address} onChange={e => set('attendance_address', e.target.value)} />
              </div>
              <div>
                <Label>District</Label>
                <Input className="mt-1 text-sm" placeholder="e.g. Nelson" value={form.district} onChange={e => set('district', e.target.value)} />
              </div>
            </div>

            {/* Device */}
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Device Type</Label>
                <Select value={form.device_type} onValueChange={v => set('device_type', v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DEVICE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Device Serial</Label>
                <Input className="mt-1 text-sm" placeholder="Optional" value={form.device_serial} onChange={e => set('device_serial', e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Case Reference (de-identified)</Label>
              <Input
                className="mt-1 text-sm"
                placeholder="e.g. NZ-EMS-2026-1234 (no names)"
                value={form.offender_ref}
                onChange={e => set('offender_ref', e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-0.5">
                ⚠ Do not enter personal names or identifying information.
              </p>
            </div>

            {/* Seniority + Rate */}
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Seniority Level</Label>
                <Select
                  value={String(form.officer_seniority_level)}
                  onValueChange={v => set('officer_seniority_level', parseInt(v))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1,2,3,4,5].map(l => (
                      <SelectItem key={l} value={String(l)}>
                        Level {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 mt-0.5 leading-tight">
                  {SENIORITY_LABELS[form.officer_seniority_level]}
                </p>
              </div>
              <div>
                <Label>Rate ($/hr)</Label>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-sm text-gray-400">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="text-sm"
                    placeholder="Auto from profile"
                    value={form.rate_per_hour}
                    onChange={e => set('rate_per_hour', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div>
              <Label>Travel (km)</Label>
              <Input
                type="number"
                min="0"
                step="0.1"
                className="mt-1 text-sm"
                placeholder="0"
                value={form.travel_km}
                onChange={e => set('travel_km', e.target.value)}
              />
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1 text-sm"
                rows={2}
                placeholder="Any additional notes (no personal information)…"
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-red-700 hover:bg-red-800 text-white"
              onClick={() => {
                toast.success('EMS attendance submitted')
                createMutation.mutate(form)
              }}
              disabled={createMutation.isPending}
            >
              <Zap className="h-4 w-4 mr-1.5" />
              {createMutation.isPending ? 'Submitting…' : 'Submit Attendance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
