/**
 * RosterPlanner — InTime + Deputy-inspired weekly visual roster board for
 * security companies. Officers as rows, days as columns, shift cards in cells.
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { buildPreferredMapUrlForCoordinates } from '@/lib/inhouseMapping'
import { useAuthStore } from '@/stores/authStore'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
import { useClientOrgIds } from '@/hooks/useClientOrgIds'
import { parseDeputyImportText, type DeputyImportParseResult, type DeputyParsedRow } from '@/lib/deputyImport'
import {
  shouldEnableRosterPlannerClientScopedQueries,
  shouldEnableRosterPlannerQueries,
} from '@/pages/rosterPlannerQueryGuards'
import { AppLayout } from '@/components/features/AppLayout'
import UserManagement from '@/pages/UserManagement'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { ListCardRow } from '@/components/features/ListCardRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  AlertTriangle,
  Download,
  Send,
  Upload,
  Calendar,
  Users,
  Clock,
  MapPin,
  CheckCircle,
  FileText,
  X,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useGeneratePatrolRouteInstance,
  usePatrolRouteInstanceStops,
  usePatrolRouteInstances,
} from '@/hooks/usePatrolRouteInstances'
import {
  format,
  addDays,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  isSameDay,
  parseISO,
  differenceInMinutes,
} from 'date-fns'

// ─────────────────────────────────────────────────────────────────────────────
// Types (all inline — page is self-contained)
// ─────────────────────────────────────────────────────────────────────────────

type ShiftStatus = 'draft' | 'published' | 'confirmed' | 'completed' | 'cancelled'
type ShiftType = 'day' | 'night' | 'morning' | 'afternoon' | 'evening' | 'custom'
type OfficerResponse = 'pending' | 'accepted' | 'declined'

interface RosterShift {
  id: string
  organization_id: string
  officer_id: string | null
  client_site_id: string | null
  zone_id: string | null
  patrol_route_id: string | null
  shift_date: string
  shift_type: ShiftType
  start_time: string | null
  end_time: string | null
  break_minutes: number
  position_title: string | null
  required_skills: string[]
  status: ShiftStatus
  published_at: string | null
  officer_response: OfficerResponse
  officer_response_at: string | null
  officer_notes: string | null
  has_conflict: boolean
  conflict_reason: string | null
  notes: string | null
  internal_notes: string | null
  // Rate / costing fields (populated by DB trigger for contractor guards)
  guard_cost_rate: number | null
  client_charge_rate: number | null
  rate_type: string | null
  contractor_org_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  schedule_warning?: string | null
  pay_period_name?: string | null
  deputy_schedule_id?: string | null
  deputy_imported_at?: string | null
}

interface Officer {
  id: string
  first_name: string
  last_name: string
  email: string
  role: string
  is_active: boolean
  employer_organization_id: string | null
  contractor_org: { id: string; name: string; organization_type: string } | null
  deputy_employee_id?: string | null
  deputy_display_name?: string | null
}

interface ClientSite {
  id: string
  name: string
  site_code?: string | null
  default_pay_rate: number | null
  default_charge_rate: number | null
}

interface Zone {
  id: string
  name: string
  location_lat: number | null
  location_lng: number | null
}

interface PatrolRoute {
  id: string
  route_name: string
  default_shift: string | null
  randomization_enabled: boolean | null
  jitter_window_minutes: number | null
  mandatory_first_stop: boolean | null
}

interface OfficerAvailability {
  id: string
  officer_id: string
  day_of_week: number | null
  specific_date: string | null
  is_available: boolean
  unavailability_reason: string | null
}

interface LeaveRequest {
  id: string
  officer_id: string | null
  leave_type_name: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  date_start: string
  date_end: string
  total_hours: number | null
}

interface ShiftFormData {
  officer_id: string
  shift_date: string
  shift_type: ShiftType
  start_time: string
  end_time: string
  break_minutes: number
  position_title: string
  client_site_id: string
  zone_id: string
  patrol_route_id: string
  required_skills: string[]
  notes: string
  internal_notes: string
  // Service type — drives portal routing when officer logs in
  service_type: string
  // Rate overrides (auto-filled for contractor guards, editable)
  guard_cost_rate: string    // string for input binding
  client_charge_rate: string
  rate_type: string
}

const emptyForm = (officerId = '', date = ''): ShiftFormData => ({
  officer_id: officerId,
  shift_date: date || new Date().toISOString().split('T')[0],
  shift_type: 'day',
  start_time: '07:00',
  end_time: '15:00',
  break_minutes: 0,
  position_title: '',
  client_site_id: '',
  zone_id: '',
  patrol_route_id: '',
  required_skills: [],
  notes: '',
  internal_notes: '',
  service_type: '',
  guard_cost_rate: '',
  client_charge_rate: '',
  rate_type: 'standard',
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<ShiftStatus, { border: string; bg: string; label: string; badge: string }> = {
  draft:      { border: 'border-l-gray-400',   bg: 'bg-gray-50',    label: 'Draft',     badge: 'bg-gray-100 text-gray-700' },
  published:  { border: 'border-l-blue-500',   bg: 'bg-blue-50',    label: 'Published', badge: 'bg-blue-100 text-blue-700' },
  confirmed:  { border: 'border-l-green-500',  bg: 'bg-green-50',   label: 'Confirmed', badge: 'bg-green-100 text-green-700' },
  completed:  { border: 'border-l-purple-500', bg: 'bg-purple-50',  label: 'Completed', badge: 'bg-purple-100 text-purple-700' },
  cancelled:  { border: 'border-l-red-400',    bg: 'bg-red-50',     label: 'Cancelled', badge: 'bg-red-100 text-red-600' },
}

function formatTime(iso: string | null): string {
  if (!iso) return '–'
  try {
    return format(parseISO(iso), 'HH:mm')
  } catch {
    return '–'
  }
}

function shiftDurationHours(shift: RosterShift): number {
  if (!shift.start_time || !shift.end_time) return 0
  try {
    const mins = differenceInMinutes(parseISO(shift.end_time), parseISO(shift.start_time))
    return Math.max(0, (mins - (shift.break_minutes || 0)) / 60)
  } catch {
    return 0
  }
}

function getWeekDays(weekStart: Date, count = 7): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(weekStart, i))
}

function exportToCSV(shifts: RosterShift[], officers: Officer[], sites: ClientSite[]) {
  const officerMap = Object.fromEntries(officers.map((o) => [o.id, `${o.first_name} ${o.last_name}`]))
  const siteMap = Object.fromEntries(sites.map((s) => [s.id, s.name]))

  const rows = [
    ['Officer', 'Date', 'Start', 'End', 'Site', 'Position', 'Status', 'Hours'],
    ...shifts.map((s) => [
      s.officer_id ? officerMap[s.officer_id] || 'Unknown' : 'Unassigned',
      s.shift_date,
      formatTime(s.start_time),
      formatTime(s.end_time),
      s.client_site_id ? siteMap[s.client_site_id] || '' : '',
      s.position_title || '',
      s.status,
      shiftDurationHours(s).toFixed(1),
    ]),
  ]

  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `roster-${format(new Date(), 'yyyy-MM-dd')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface ShiftCardProps {
  shift: RosterShift
  siteName: string
  zoneName: string
  mapUrl?: string
  onClick: (e?: React.MouseEvent) => void
}

function ShiftCard({ shift, siteName, zoneName, mapUrl, onClick }: ShiftCardProps) {
  const style = STATUS_STYLE[shift.status]
  const isCancelled = shift.status === 'cancelled'
  const label = siteName || zoneName || shift.position_title || '–'
  const timeRange = `${formatTime(shift.start_time)}–${formatTime(shift.end_time)}`

  return (
    <div className="mb-1 flex items-start gap-1">
      <button
        onClick={onClick}
        className={`
          w-full text-left text-xs rounded border-l-4 px-2 py-1 cursor-pointer
          hover:brightness-95 transition-all select-none
          ${style.border} ${shift.has_conflict ? 'bg-orange-50 border-l-orange-500' : style.bg}
          ${isCancelled ? 'opacity-60 line-through' : ''}
        `}
      >
        <ListCardRow
          className="gap-1 rounded-none bg-transparent p-0 text-xs"
          left={<span className="font-medium truncate leading-tight">{timeRange}</span>}
          right={shift.has_conflict ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-orange-500" /> : undefined}
        />
        <ListCardRow
          className="mt-0.5 gap-1 rounded-none bg-transparent p-0 text-xs"
          left={<span className="truncate text-gray-600 leading-tight">{label}</span>}
          right={<span className={`rounded px-1 py-0 text-[10px] ${style.badge}`}>{style.label}</span>}
        />
        {shift.schedule_warning && (
          <div className="mt-1 inline-flex max-w-full items-center gap-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{shift.schedule_warning}</span>
          </div>
        )}
      </button>
      {mapUrl && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            window.open(mapUrl, '_blank', 'noopener,noreferrer')
          }}
          aria-label="Open shift zone map"
        >
          <MapPin className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

interface OfficerRowStatsProps {
  officer: Officer
  shifts: RosterShift[]
  availability: OfficerAvailability[]
  weekDays: Date[]
}

function OfficerRowStats({ officer, shifts, availability, weekDays }: OfficerRowStatsProps) {
  const weeklyHours = shifts.reduce((sum, s) => sum + shiftDurationHours(s), 0)
  const shiftCount = shifts.length

  // Determine availability status for the week
  const hasUnavailability = weekDays.some((day) => {
    const dow = day.getDay()
    const dateStr = format(day, 'yyyy-MM-dd')
    return availability.some(
      (a) =>
        !a.is_available &&
        (a.specific_date === dateStr || (a.day_of_week !== null && a.day_of_week === dow))
    )
  })

  const dotColor = hasUnavailability
    ? 'bg-red-400'
    : shiftCount >= 5
    ? 'bg-orange-400'
    : 'bg-green-400'

  return (
    <div className="flex items-center gap-2 min-w-[140px] max-w-[180px] px-2 py-1">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      <div className="min-w-0">
        <div className="text-xs font-medium truncate">
          {officer.first_name} {officer.last_name}
        </div>
        <div className="text-[10px] text-gray-500">
          {weeklyHours.toFixed(1)}h · {shiftCount} shift{shiftCount !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Conflict checker hook (inline)
// ─────────────────────────────────────────────────────────────────────────────

function useConflicts(
  officerId: string,
  shiftDate: string,
  excludeShiftId: string | null,
  allShifts: RosterShift[],
  availability: OfficerAvailability[],
  leaveRequests: LeaveRequest[]
): string[] {
  return useMemo(() => {
    const warnings: string[] = []
    if (!officerId || !shiftDate) return warnings

    // Check officer already has a shift that day
    const existing = allShifts.filter(
      (s) =>
        s.officer_id === officerId &&
        s.shift_date === shiftDate &&
        s.status !== 'cancelled' &&
        s.id !== excludeShiftId
    )
    if (existing.length > 0) {
      warnings.push('Officer already has a shift on this date')
    }

    // Check unavailability
    try {
      const date = parseISO(shiftDate)
      const dow = date.getDay()
      const unavail = availability.filter(
        (a) =>
          a.officer_id === officerId &&
          !a.is_available &&
          (a.specific_date === shiftDate || (a.day_of_week !== null && a.day_of_week === dow))
      )
      if (unavail.length > 0) {
        warnings.push(
          `Officer has unavailability on this date${unavail[0].unavailability_reason ? ': ' + unavail[0].unavailability_reason : ''}`
        )
      }
    } catch {
      // ignore date parse errors
    }

    const activeLeave = leaveRequests.find(
      (leave) =>
        leave.officer_id === officerId &&
        !['rejected', 'cancelled'].includes(leave.status) &&
        leave.date_start <= shiftDate &&
        leave.date_end >= shiftDate
    )
    if (activeLeave) {
      warnings.push(`Officer has ${activeLeave.status === 'pending' ? 'pending' : 'approved'} leave: ${activeLeave.leave_type_name}`)
    }

    return warnings
  }, [officerId, shiftDate, excludeShiftId, allShifts, availability, leaveRequests])
}

// ─────────────────────────────────────────────────────────────────────────────
// Shift Dialog (Add / Edit)
// ─────────────────────────────────────────────────────────────────────────────

interface ShiftDialogProps {
  open: boolean
  onClose: () => void
  editShift: RosterShift | null
  prefillOfficerId: string
  prefillDate: string
  officers: Officer[]
  sites: ClientSite[]
  zones: Zone[]
  patrolRoutes: PatrolRoute[]
  allShifts: RosterShift[]
  availability: OfficerAvailability[]
  leaveRequests: LeaveRequest[]
  isAdmin: boolean
  onSave: (data: ShiftFormData) => void
  onDelete: (id: string) => void
  saving: boolean
  deleting: boolean
}

function ShiftDialog({
  open,
  onClose,
  editShift,
  prefillOfficerId,
  prefillDate,
  officers,
  sites,
  zones,
  patrolRoutes,
  allShifts,
  availability,
  leaveRequests,
  isAdmin,
  onSave,
  onDelete,
  saving,
  deleting,
}: ShiftDialogProps) {
  const [form, setFormState] = useState<ShiftFormData>(() =>
    editShift
      ? {
          officer_id: editShift.officer_id || '',
          shift_date: editShift.shift_date,
          shift_type: editShift.shift_type,
          start_time: editShift.start_time ? format(parseISO(editShift.start_time), 'HH:mm') : '07:00',
          end_time: editShift.end_time ? format(parseISO(editShift.end_time), 'HH:mm') : '15:00',
          break_minutes: editShift.break_minutes || 0,
          position_title: editShift.position_title || '',
          client_site_id: editShift.client_site_id || '',
          zone_id: editShift.zone_id || '',
          patrol_route_id: editShift.patrol_route_id || '',
          required_skills: editShift.required_skills || [],
          notes: editShift.notes || '',
          internal_notes: editShift.internal_notes || '',
          service_type: (editShift as any).service_type || '',
          guard_cost_rate: editShift.guard_cost_rate != null ? String(editShift.guard_cost_rate) : '',
          client_charge_rate: editShift.client_charge_rate != null ? String(editShift.client_charge_rate) : '',
          rate_type: editShift.rate_type || 'standard',
        }
      : emptyForm(prefillOfficerId, prefillDate)
  )

  const [skillInput, setSkillInput] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [selectedRouteInstanceId, setSelectedRouteInstanceId] = useState<string>('')

  const set = useCallback(
    <K extends keyof ShiftFormData>(key: K, value: ShiftFormData[K]) =>
      setFormState((prev) => ({ ...prev, [key]: value })),
    []
  )

  const conflicts = useConflicts(
    form.officer_id,
    form.shift_date,
    editShift?.id ?? null,
    allShifts,
    availability,
    leaveRequests
  )

  const routeInstanceFilters = editShift?.id ? { rosterShiftId: editShift.id } : undefined
  const { data: routeInstances = [], isLoading: routeInstancesLoading } = usePatrolRouteInstances(routeInstanceFilters)
  const { data: routeStops = [], isLoading: routeStopsLoading } = usePatrolRouteInstanceStops(selectedRouteInstanceId)
  const generateRouteInstanceMutation = useGeneratePatrolRouteInstance()

  useEffect(() => {
    if (routeInstances.length > 0 && !selectedRouteInstanceId) {
      setSelectedRouteInstanceId(routeInstances[0].id)
    }
    if (routeInstances.length === 0 && selectedRouteInstanceId) {
      setSelectedRouteInstanceId('')
    }
  }, [routeInstances, selectedRouteInstanceId])

  function addSkill() {
    const trimmed = skillInput.trim()
    if (trimmed && !form.required_skills.includes(trimmed)) {
      set('required_skills', [...form.required_skills, trimmed])
    }
    setSkillInput('')
  }

  function removeSkill(skill: string) {
    set('required_skills', form.required_skills.filter((s) => s !== skill))
  }

  function handleSubmit() {
    if (!form.officer_id) { toast.error('Please select an officer'); return }
    if (!form.shift_date) { toast.error('Please select a date'); return }
    if (!form.start_time) { toast.error('Please enter a start time'); return }
    if (!form.end_time)   { toast.error('Please enter an end time'); return }
    onSave(form)
  }

  function handleGenerateRoutePlan(forceRegenerate = false) {
    if (!editShift?.id) {
      toast.error('Save this shift before generating a route plan')
      return
    }

    const effectiveRouteId = form.patrol_route_id || editShift.patrol_route_id
    if (!effectiveRouteId) {
      toast.error('Select a patrol route before generating a plan')
      return
    }

    if (form.patrol_route_id !== (editShift.patrol_route_id || '')) {
      toast.error('Save patrol route changes first, then generate plan')
      return
    }

    generateRouteInstanceMutation.mutate(
      { rosterShiftId: editShift.id, forceRegenerate },
      {
        onSuccess: (result) => {
          if (result?.route_instance_id) {
            setSelectedRouteInstanceId(result.route_instance_id)
          }
        },
      }
    )
  }

  const showPatrolRoutePicker = ['patrol', 'alarm_response', 'freedom_camping'].includes(form.service_type)

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editShift ? 'Edit Shift' : 'Add Shift'}</DialogTitle>
            <DialogDescription>
              {editShift
                ? `Editing shift for ${format(parseISO(editShift.shift_date), 'EEEE d MMMM yyyy')}`
                : 'Create a new roster shift'}
            </DialogDescription>
          </DialogHeader>

          {conflicts.length > 0 && (
            <div className="rounded-md border border-orange-200 bg-orange-50 p-3 space-y-1">
              {conflicts.map((c) => (
                <div key={c} className="flex items-center gap-2 text-sm text-orange-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {c}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Officer */}
            <div className="col-span-2">
              <Label>Officer *</Label>
              <Select value={form.officer_id} onValueChange={(v) => set('officer_id', v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select officer…" />
                </SelectTrigger>
                <SelectContent>
                  {officers.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.first_name} {o.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div>
              <Label>Date *</Label>
              <Input
                type="date"
                className="mt-1"
                value={form.shift_date}
                onChange={(e) => set('shift_date', e.target.value)}
              />
            </div>

            {/* Shift Type */}
            <div>
              <Label>Shift Type</Label>
              <Select value={form.shift_type} onValueChange={(v) => set('shift_type', v as ShiftType)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['day', 'morning', 'afternoon', 'evening', 'night', 'custom'] as ShiftType[]).map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Start Time */}
            <div>
              <Label>Start Time *</Label>
              <Input
                type="time"
                className="mt-1"
                value={form.start_time}
                onChange={(e) => set('start_time', e.target.value)}
              />
            </div>

            {/* End Time */}
            <div>
              <Label>End Time *</Label>
              <Input
                type="time"
                className="mt-1"
                value={form.end_time}
                onChange={(e) => set('end_time', e.target.value)}
              />
            </div>

            {/* Break */}
            <div>
              <Label>Break (minutes)</Label>
              <Input
                type="number"
                min={0}
                max={120}
                className="mt-1"
                value={form.break_minutes}
                onChange={(e) => set('break_minutes', parseInt(e.target.value) || 0)}
              />
            </div>

            {/* Service Type */}
            <div>
              <Label>Service Type</Label>
              <Select
                value={form.service_type || '__none__'}
                onValueChange={(v) => set('service_type', v === '__none__' ? '' : v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select service type…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Not specified —</SelectItem>
                  {([
                    ['freedom_camping', 'Freedom Camping Patrol'],
                    ['guarding',        'Site Guarding'],
                    ['parking',         'Parking Enforcement'],
                    ['noise',           'Noise Control'],
                    ['patrol',          'General Patrol'],
                    ['alarm_response',  'Alarm Response'],
                    ['ems',             'EMS (Electronic Monitoring)'],
                    ['biosecurity_inspection', 'Biosecurity Inspection'],
                    ['smoke_complaint_ooh',    'Smoke Complaint (OOH)'],
                  ] as const).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400 mt-0.5">
                Controls which portal the officer is routed to on login.
              </p>
            </div>

            {/* Patrol Route (pilot, additive) */}
            {showPatrolRoutePicker && (
              <div>
                <Label>Patrol Route</Label>
                <Select
                  value={form.patrol_route_id || '__none__'}
                  onValueChange={(v) => set('patrol_route_id', v === '__none__' ? '' : v)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select patrol route…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {patrolRoutes.map((route) => (
                      <SelectItem key={route.id} value={route.id}>
                        {route.route_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 mt-0.5">
                  Optional pilot field. Route-aware planning is additive and does not alter existing shift behavior.
                </p>
              </div>
            )}

            {isAdmin && editShift && showPatrolRoutePicker && (
              <div className="col-span-2 rounded-md border p-3 bg-slate-50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">Patrol Plan</p>
                    <p className="text-xs text-slate-500">Generate and review route-instance stops for this shift.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleGenerateRoutePlan(false)}
                      disabled={generateRouteInstanceMutation.isPending || !form.patrol_route_id}
                    >
                      {generateRouteInstanceMutation.isPending ? 'Generating…' : 'Generate Plan'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleGenerateRoutePlan(true)}
                      disabled={generateRouteInstanceMutation.isPending || !form.patrol_route_id}
                    >
                      Regenerate
                    </Button>
                  </div>
                </div>

                {(() => {
                  const selectedRoute = patrolRoutes.find(r => r.id === form.patrol_route_id)
                  if (!selectedRoute) return null
                  return (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Badge variant="outline" className="text-[10px]">
                        {selectedRoute.randomization_enabled ? '🔀 Randomized' : '⏩ Sequential'}
                      </Badge>
                      {selectedRoute.randomization_enabled && selectedRoute.jitter_window_minutes != null && (
                        <Badge variant="outline" className="text-[10px]">
                          ±{selectedRoute.jitter_window_minutes}min jitter
                        </Badge>
                      )}
                      {selectedRoute.mandatory_first_stop && (
                        <Badge variant="outline" className="text-[10px]">First stop locked</Badge>
                      )}
                    </div>
                  )
                })()}

                <Separator className="my-3" />

                {routeInstancesLoading ? (
                  <p className="text-xs text-slate-500">Loading plan instances…</p>
                ) : routeInstances.length === 0 ? (
                  <p className="text-xs text-slate-500">No route plan generated for this shift yet.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Plan Instance</Label>
                        <Select value={selectedRouteInstanceId} onValueChange={setSelectedRouteInstanceId}>
                          <SelectTrigger className="mt-1 h-8">
                            <SelectValue placeholder="Select plan instance" />
                          </SelectTrigger>
                          <SelectContent>
                            {routeInstances.map((instance) => (
                              <SelectItem key={instance.id} value={instance.id}>
                                {format(parseISO(instance.created_at), 'd MMM HH:mm')} · {instance.plan_status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end">
                        {(() => {
                          const selectedInstance = routeInstances.find((r) => r.id === selectedRouteInstanceId)
                          if (!selectedInstance) return null
                          return (
                            <Badge variant="outline" className="capitalize">
                              {selectedInstance.plan_status.replace('_', ' ')}
                            </Badge>
                          )
                        })()}
                      </div>
                    </div>

                    <div className="rounded border bg-white p-2 max-h-48 overflow-y-auto space-y-1">
                      {routeStopsLoading ? (
                        <p className="text-xs text-slate-500">Loading stops…</p>
                      ) : routeStops.length === 0 ? (
                        <p className="text-xs text-slate-500">No stops found for this plan instance.</p>
                      ) : (
                        routeStops.map((stop) => (
                          <div key={stop.id} className="flex items-center justify-between gap-2 text-xs border rounded px-2 py-1">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-700 truncate">
                                {stop.sequence_no}. {stop.stop_name}
                                {stop.is_mandatory ? ' • mandatory' : ''}
                              </p>
                              <p className="text-slate-500 capitalize">{stop.visit_status}</p>
                            </div>
                            <div className="shrink-0 text-slate-500">
                              {stop.planned_arrival_window_start && stop.planned_arrival_window_end
                                ? `${format(parseISO(stop.planned_arrival_window_start), 'HH:mm')}–${format(parseISO(stop.planned_arrival_window_end), 'HH:mm')}`
                                : 'No window'}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Position Title */}
            <div>
              <Label>Position Title</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Patrol Officer"
                value={form.position_title}
                onChange={(e) => set('position_title', e.target.value)}
              />
            </div>

            {/* Site */}
            <div>
              <Label>Site</Label>
              <Select
                value={form.client_site_id || '__none__'}
                onValueChange={(v) => {
                  const siteId = v === '__none__' ? '' : v
                  set('client_site_id', siteId)
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select site…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {(s.default_pay_rate || s.default_charge_rate) && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {s.default_pay_rate ? `Pay $${s.default_pay_rate}/hr` : ''}
                          {s.default_pay_rate && s.default_charge_rate ? ' · ' : ''}
                          {s.default_charge_rate ? `Charge $${s.default_charge_rate}/hr` : ''}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Show inherited rates when a site with rates is selected */}
              {(() => {
                const sel = sites.find(s => s.id === form.client_site_id)
                if (!sel || (!sel.default_pay_rate && !sel.default_charge_rate)) return null
                return (
                  <p className="text-xs text-muted-foreground mt-1">
                    Inherited from site —{sel.default_pay_rate ? ` Pay: $${sel.default_pay_rate}/hr` : ''}{sel.default_charge_rate ? ` · Charge: $${sel.default_charge_rate}/hr` : ''}
                  </p>
                )
              })()}
            </div>

            {/* Zone */}
            <div>
              <Label>Zone</Label>
              <Select
                value={form.zone_id || '__none__'}
                onValueChange={(v) => set('zone_id', v === '__none__' ? '' : v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select zone…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Required Skills */}
            <div className="col-span-2">
              <Label>Required Skills</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  placeholder="Type skill and press Enter"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addSkill() }
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={addSkill}>
                  Add
                </Button>
              </div>
              {form.required_skills.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {form.required_skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full"
                    >
                      {skill}
                      <button onClick={() => removeSkill(skill)} className="hover:text-blue-900">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea
                className="mt-1"
                rows={2}
                placeholder="Visible to officer…"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </div>

            {/* ── Contractor Rate / Margin panel ──────────────────────── */}
            {(() => {
              const officer = officers.find((o) => o.id === form.officer_id)
              const isContractor = officer?.contractor_org?.organization_type === 'contractor'
              const cost   = parseFloat(form.guard_cost_rate)   || null
              const charge = parseFloat(form.client_charge_rate) || null
              const margin = cost != null && charge != null ? charge - cost : null
              if (!isContractor && !cost && !charge) return null
              return (
                <div className="col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-800 flex items-center gap-1">
                    💰 {isContractor ? `Contractor: ${officer!.contractor_org!.name}` : 'Rate Override'}
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-gray-500">Guard Cost $/hr</label>
                      <Input
                        type="number" step="0.01" min="0"
                        className="h-8 mt-0.5 text-sm"
                        placeholder="Auto"
                        value={form.guard_cost_rate}
                        onChange={(e) => set('guard_cost_rate', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Client Charge $/hr</label>
                      <Input
                        type="number" step="0.01" min="0"
                        className="h-8 mt-0.5 text-sm"
                        placeholder="Auto from site"
                        value={form.client_charge_rate}
                        onChange={(e) => set('client_charge_rate', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Margin $/hr</label>
                      <div className={`h-8 mt-0.5 flex items-center px-3 rounded-md border text-sm font-semibold ${
                        margin == null  ? 'bg-white text-gray-400 border-gray-200' :
                        margin >= 0     ? 'bg-green-50 text-green-700 border-green-200' :
                                          'bg-red-50 text-red-700 border-red-200'
                      }`}>
                        {margin != null ? `$${margin.toFixed(2)}` : '—'}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Rate Type</label>
                    <Select value={form.rate_type} onValueChange={(v) => set('rate_type', v)}>
                      <SelectTrigger className="h-8 mt-0.5 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(['standard','standby','short_notice','long_term','overtime'] as const).map((t) => (
                          <SelectItem key={t} value={t} className="capitalize text-sm">
                            {t.replace(/_/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )
            })()}

            {/* Internal Notes (admin-only) */}
            {isAdmin && (
              <div className="col-span-2">
                <Label>Internal Notes <span className="text-xs text-gray-400">(admin only)</span></Label>
                <Textarea
                  className="mt-1"
                  rows={2}
                  placeholder="Not visible to officer…"
                  value={form.internal_notes}
                  onChange={(e) => set('internal_notes', e.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
            {editShift && (
              <Button
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleting}
                className="mr-auto"
              >
                Delete Shift
              </Button>
            )}
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving…' : editShift ? 'Save Changes' : 'Add Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The shift will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => editShift && onDelete(editShift.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default function RosterPlanner() {
  const { user } = useAuthStore()
  const { operationalOrganizationId } = useOperationalOrganization()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin' || user?.role === 'master' || user?.role === 'grand_master' || user?.role === 'admin_officer'
  const isGrandMaster = user?.role === 'grand_master'
  const activeTab = isAdmin && searchParams.get('tab') === 'users' ? 'users' : 'planner'
  const hasOrganizationId = isGrandMaster || !!operationalOrganizationId
  const plannerQueriesEnabled = shouldEnableRosterPlannerQueries(activeTab, hasOrganizationId)
  const { orgIds: clientOrgIds, isLoading: clientOrgIdsLoading } = useClientOrgIds({ enabled: plannerQueriesEnabled })
  const clientScopedQueriesEnabled = shouldEnableRosterPlannerClientScopedQueries(activeTab, hasOrganizationId, clientOrgIdsLoading)
  const effectiveOperationalOrganizationId =
    operationalOrganizationId || (clientOrgIds !== null && clientOrgIds.length > 0 ? clientOrgIds[0] : null)

  const applyClientOrgScope = (query: any) => {
    // null means unrestricted scope (grand_master role)
    if (clientOrgIds !== null) return query.in('organization_id', clientOrgIds)
    return query
  }

  // ─── Week navigation ───────────────────────────────────────────────────────
  const [viewStart, setViewStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  )
  const [viewMode, setViewMode] = useState<'week' | 'fortnight'>('week')

  const dayCount = viewMode === 'fortnight' ? 14 : 7
  const weekDays = useMemo(() => getWeekDays(viewStart, dayCount), [viewStart, dayCount])
  const viewEnd = weekDays[weekDays.length - 1]

  function goPrev() {
    setViewStart((d) => (viewMode === 'fortnight' ? addDays(d, -14) : subWeeks(d, 1)))
  }
  function goNext() {
    setViewStart((d) => (viewMode === 'fortnight' ? addDays(d, 14) : addWeeks(d, 1)))
  }
  function goToday() {
    setViewStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
  }

  // ─── Filters ───────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<'all' | ShiftStatus>('all')
  const [siteFilter, setSiteFilter] = useState<string>('all')
  const [officerSearch, setOfficerSearch] = useState<string>('')

  // ─── Dialog state ──────────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editShift, setEditShift] = useState<RosterShift | null>(null)
  const [prefillOfficerId, setPrefillOfficerId] = useState('')
  const [prefillDate, setPrefillDate] = useState('')
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [showDeputyImport, setShowDeputyImport] = useState(false)
  const [deputyFileName, setDeputyFileName] = useState('')
  const [deputyPreview, setDeputyPreview] = useState<DeputyImportParseResult | null>(null)

  // ─── Data queries ──────────────────────────────────────────────────────────

  const dateFrom = format(viewStart, 'yyyy-MM-dd')
  const dateTo = format(viewEnd, 'yyyy-MM-dd')

  const { data: shifts = [], isLoading: shiftsLoading } = useQuery<RosterShift[]>({
    queryKey: ['roster_shifts', user?.organization_id, clientOrgIds, dateFrom, dateTo],
    queryFn: async () => {
      const q = applyClientOrgScope(
        ((supabase as any).from('roster_shifts') as any)
          .select('*')
      )
      const { data, error } = await q
        .gte('shift_date', dateFrom)
        .lte('shift_date', dateTo)
        .order('shift_date')
        .order('start_time')
      if (error) throw error
      return (data || []) as RosterShift[]
    },
    enabled: clientScopedQueriesEnabled,
  })

  const { data: officers = [], isLoading: officersLoading } = useQuery<Officer[]>({
    queryKey: ['roster_officers', user?.organization_id, clientOrgIds],
    queryFn: async () => {
      const q = applyClientOrgScope(
        (supabase as any)
          .from('user_profiles')
          .select(`
            id, first_name, last_name, email, role, is_active,
            employer_organization_id,
            contractor_org:organizations!employer_organization_id(id, name, organization_type)
          `)
      )
      const { data, error } = await q
        .eq('is_active', true)
        .in('role', ['officer', 'admin_officer'])
        .order('first_name')
      if (error) throw error
      return (data || []).map((o: any) => ({
        ...o,
        contractor_org: Array.isArray(o.contractor_org) ? o.contractor_org[0] ?? null : o.contractor_org,
      })) as Officer[]
    },
    enabled: clientScopedQueriesEnabled,
  })

  const { data: sites = [] } = useQuery<ClientSite[]>({
    queryKey: ['roster_sites', user?.organization_id, clientOrgIds],
    queryFn: async () => {
        let q = (supabase as any).from('client_sites')
          .select('id, name, site_code, default_pay_rate, default_charge_rate')
          .order('name')
      // clientOrgIds === null means grand_master (unrestricted)
      if (clientOrgIds !== null) q = q.in('organization_id', clientOrgIds)
      const { data, error } = await q
      if (error) throw error
      return (data || []) as ClientSite[]
    },
    enabled: clientScopedQueriesEnabled,
  })

  const { data: zones = [] } = useQuery<Zone[]>({
    queryKey: ['roster_zones', user?.organization_id, clientOrgIds],
    queryFn: async () => {
      let q = (supabase as any)
        .from('zones')
        .select('id, name, location_lat, location_lng')
        .eq('is_active', true)
        .order('name')

      // clientOrgIds === null means grand_master (unrestricted)
      if (clientOrgIds !== null) q = q.in('organization_id', clientOrgIds)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as Zone[]
    },
    enabled: clientScopedQueriesEnabled,
  })

  const { data: patrolRoutes = [] } = useQuery<PatrolRoute[]>({
    queryKey: ['roster_patrol_routes', user?.organization_id, clientOrgIds],
    queryFn: async () => {
      const q = applyClientOrgScope(
        (supabase as any)
          .from('patrol_routes')
          .select('id, route_name, default_shift, randomization_enabled, jitter_window_minutes, mandatory_first_stop')
      )
      const { data, error } = await q
        .eq('is_active', true)
        .order('route_name')
      if (error) throw error
      return (data || []) as PatrolRoute[]
    },
    enabled: clientScopedQueriesEnabled,
  })

  const { data: availability = [] } = useQuery<OfficerAvailability[]>({
    queryKey: ['officer_availability', user?.organization_id, clientOrgIds],
    queryFn: async () => {
      const q = applyClientOrgScope(
        ((supabase as any).from('officer_availability') as any)
          .select('id, officer_id, day_of_week, specific_date, is_available, unavailability_reason')
      )
      const { data, error } = await q
      if (error) throw error
      return (data || []) as OfficerAvailability[]
    },
    enabled: clientScopedQueriesEnabled,
  })

  const { data: leaveRequests = [] } = useQuery<LeaveRequest[]>({
    queryKey: ['leave_requests', user?.organization_id, clientOrgIds, dateFrom, dateTo, isAdmin],
    queryFn: async () => {
      let query = applyClientOrgScope(
        (supabase as any)
          .from('leave_requests')
          .select('id, officer_id, leave_type_name, status, date_start, date_end, total_hours')
      )
        .lte('date_start', dateTo)
        .gte('date_end', dateFrom)
        .order('date_start', { ascending: false })

      if (!isAdmin) {
        query = query.eq('officer_id', user!.id)
      }

      const { data, error } = await query
      if (error) throw error
      return (data || []) as LeaveRequest[]
    },
    enabled: clientScopedQueriesEnabled,
  })

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['roster_shifts', user?.organization_id] })
  }

  const createMutation = useMutation({
    mutationFn: async (data: ShiftFormData) => {
      const payload = {
        organization_id: effectiveOperationalOrganizationId,
        officer_id: data.officer_id || null,
        shift_date: data.shift_date,
        shift_type: data.shift_type,
        start_time: data.shift_date && data.start_time ? `${data.shift_date}T${data.start_time}:00` : null,
        end_time: data.shift_date && data.end_time ? `${data.shift_date}T${data.end_time}:00` : null,
        break_minutes: data.break_minutes,
        position_title: data.position_title || null,
        client_site_id: data.client_site_id || null,
        zone_id: data.zone_id || null,
        patrol_route_id: data.patrol_route_id || null,
        required_skills: data.required_skills,
        notes: data.notes || null,
        internal_notes: data.internal_notes || null,
        service_type: data.service_type || null,
        status: 'draft',
        officer_response: 'pending',
        has_conflict: false,
        created_by: user!.id,
        // Rate fields — DB trigger auto-populates for contractors; manual override kept if set
        guard_cost_rate:    data.guard_cost_rate    ? parseFloat(data.guard_cost_rate)    : null,
        client_charge_rate: data.client_charge_rate ? parseFloat(data.client_charge_rate) : null,
        rate_type:          data.rate_type || 'standard',
      }
      if (!payload.organization_id) throw new Error('No organization selected')
      const { error } = await ((supabase as any).from('roster_shifts') as any).insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Shift created')
      invalidate()
      setDialogOpen(false)
    },
    onError: (err: any) => toast.error(err.message || 'Failed to create shift'),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ShiftFormData }) => {
      const payload = {
        officer_id: data.officer_id || null,
        shift_date: data.shift_date,
        shift_type: data.shift_type,
        start_time: data.shift_date && data.start_time ? `${data.shift_date}T${data.start_time}:00` : null,
        end_time: data.shift_date && data.end_time ? `${data.shift_date}T${data.end_time}:00` : null,
        break_minutes: data.break_minutes,
        position_title: data.position_title || null,
        client_site_id: data.client_site_id || null,
        zone_id: data.zone_id || null,
        patrol_route_id: data.patrol_route_id || null,
        required_skills: data.required_skills,
        notes: data.notes || null,
        internal_notes: data.internal_notes || null,
        service_type: data.service_type || null,
        updated_at: new Date().toISOString(),
        guard_cost_rate:    data.guard_cost_rate    ? parseFloat(data.guard_cost_rate)    : null,
        client_charge_rate: data.client_charge_rate ? parseFloat(data.client_charge_rate) : null,
        rate_type:          data.rate_type || 'standard',
      }
      const { error } = await ((supabase as any).from('roster_shifts') as any).update(payload).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Shift updated')
      invalidate()
      setDialogOpen(false)
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update shift'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await ((supabase as any).from('roster_shifts') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Shift deleted')
      invalidate()
      setDialogOpen(false)
    },
    onError: (err: any) => toast.error(err.message || 'Failed to delete shift'),
  })

  const publishWeekMutation = useMutation({
    mutationFn: async () => {
      const draftIds = shifts
        .filter((s) => s.status === 'draft' && s.shift_date >= dateFrom && s.shift_date <= dateTo)
        .map((s) => s.id)
      if (draftIds.length === 0) throw new Error('No draft shifts to publish in this period')
      const { error } = await ((supabase as any).from('roster_shifts') as any)
        .update({ status: 'published', published_at: new Date().toISOString() })
        .in('id', draftIds)
      if (error) throw error
      return draftIds.length
    },
    onSuccess: (count) => {
      toast.success(`${count} shift${count !== 1 ? 's' : ''} published`)
      invalidate()
      setShowPublishConfirm(false)
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to publish shifts')
      setShowPublishConfirm(false)
    },
  })

  const deputyImportMutation = useMutation({
    mutationFn: async (parsed: DeputyImportParseResult) => {
      if (!effectiveOperationalOrganizationId) throw new Error('No organization selected')

      const normalizeOfficerName = (value: string) =>
        value
          .replace(/\[.*?\]/g, '')
          .replace(/^\(.*?\)\s*-\s*/, '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase()

      const officerByDeputyCode = new Map(
        officers
          .filter((officer) => officer.deputy_employee_id)
          .map((officer) => [String(officer.deputy_employee_id), officer])
      )

      const officerByName = new Map(
        officers.map((officer) => [
          normalizeOfficerName(`${officer.first_name} ${officer.last_name}`),
          officer,
        ])
      )

      const siteByCode = new Map(
        sites
          .filter((site) => site.site_code)
          .flatMap((site) => {
            const keys = [String(site.site_code)]
            return keys.map((key) => [key, site] as const)
          })
      )

      const siteByName = new Map(
        sites.map((site) => [site.name.trim().toLowerCase(), site])
      )

      const pendingProfileUpdates = new Map<string, { deputy_employee_id: string; deputy_display_name: string | null }>()
      const rosterPayload: Record<string, unknown>[] = []
      const leavePayload: Record<string, unknown>[] = []
      const timesheetPayload: Record<string, unknown>[] = []
      const warnings: string[] = []

      for (const row of parsed.rows) {
        let matchedOfficer =
          (row.employeeExportCode ? officerByDeputyCode.get(row.employeeExportCode) : undefined) ||
          officerByName.get(normalizeOfficerName(row.employeeDisplayName || row.employeeName))

        if (!matchedOfficer && row.employeeName) {
          matchedOfficer = officerByName.get(normalizeOfficerName(row.employeeName))
        }

        if (matchedOfficer && row.employeeExportCode && matchedOfficer.deputy_employee_id !== row.employeeExportCode) {
          pendingProfileUpdates.set(matchedOfficer.id, {
            deputy_employee_id: row.employeeExportCode,
            deputy_display_name: row.employeeDisplayName || null,
          })
        }

        const matchedSite =
          (row.locationCode ? siteByCode.get(row.locationCode) : undefined) ||
          (row.locationName ? siteByName.get(row.locationName.trim().toLowerCase()) : undefined) ||
          (row.areaName ? siteByName.get(row.areaName.trim().toLowerCase()) : undefined)

        if (!matchedOfficer && row.isLeave) {
          warnings.push(`Skipped leave for unmatched officer: ${row.employeeDisplayName || row.employeeName}`)
        }

        if (row.isLeave && matchedOfficer && row.scheduleStart) {
          leavePayload.push({
            organization_id: effectiveOperationalOrganizationId,
            officer_id: matchedOfficer.id,
            leave_type_name: row.leaveTypeName || 'Leave',
            leave_export_code: row.leaveExportCode,
            is_paid: row.isLeavePaid,
            date_start: row.scheduleStart.slice(0, 10),
            date_end: (row.scheduleEnd || row.scheduleStart).slice(0, 10),
            total_hours: row.scheduleDurationHours,
            status: row.approved ? 'approved' : 'pending',
            deputy_leave_id: row.externalId,
            deputy_imported_at: new Date().toISOString(),
          })
        }

        if (!row.isLeave && row.scheduleStart) {
          rosterPayload.push({
            organization_id: effectiveOperationalOrganizationId,
            officer_id: matchedOfficer?.id ?? null,
            client_site_id: matchedSite?.id ?? null,
            shift_date: row.scheduleStart.slice(0, 10),
            shift_type: 'custom',
            start_time: row.scheduleStart,
            end_time: row.scheduleEnd,
            break_minutes: 0,
            position_title: row.locationName || row.areaName || null,
            status: row.approved ? 'confirmed' : 'published',
            officer_response: 'pending',
            has_conflict: false,
            notes: row.employeeComment,
            internal_notes: matchedSite ? null : `Deputy import could not map site: ${row.locationName || row.areaName || 'Unknown'}`,
            created_by: user.id,
            deputy_schedule_id: row.externalId,
            schedule_warning: row.scheduleWarning,
            pay_period_name: row.payPeriodName,
            deputy_imported_at: new Date().toISOString(),
          })
        }

        if (row.timesheetStart && matchedOfficer) {
          timesheetPayload.push({
            organization_id: effectiveOperationalOrganizationId,
            officer_id: matchedOfficer.id,
            started_at: row.timesheetStart,
            ended_at: row.timesheetEnd,
            approval_status: row.approved ? 'approved' : 'pending',
            employee_comment: row.employeeComment,
            timesheet_cost: row.timesheetCost,
            auto_rounded: row.autoRounded,
            is_in_progress: row.isInProgress,
            discarded: row.discarded,
            deputy_timesheet_id: row.externalId,
            deputy_imported_at: new Date().toISOString(),
          })
        }
      }

      if (pendingProfileUpdates.size > 0) {
        const profileUpdateResults = await Promise.allSettled(
          Array.from(pendingProfileUpdates.entries()).map(([officerId, payload]) =>
            ((supabase as any).from('user_profiles') as any).update(payload).eq('id', officerId)
          )
        )

        const failedProfileUpdates = profileUpdateResults.filter((result) => {
          if (result.status === 'rejected') return true
          return !!result.value?.error
        }).length

        if (failedProfileUpdates > 0) {
          warnings.push(
            `Skipped ${failedProfileUpdates} officer profile sync update${failedProfileUpdates === 1 ? '' : 's'} due to permissions or validation.`
          )
        }
      }

      if (rosterPayload.length > 0) {
        const { error } = await ((supabase as any).from('roster_shifts') as any)
          .upsert(rosterPayload, { onConflict: 'organization_id,deputy_schedule_id' })
        if (error) throw error
      }

      if (leavePayload.length > 0) {
        const { error } = await ((supabase as any).from('leave_requests') as any)
          .upsert(leavePayload, { onConflict: 'organization_id,deputy_leave_id' })
        if (error) throw error
      }

      if (timesheetPayload.length > 0) {
        const { error } = await ((supabase as any).from('officer_shifts') as any)
          .upsert(timesheetPayload, { onConflict: 'organization_id,deputy_timesheet_id' })
        if (error) throw error
      }

      return {
        warnings,
        rosterCount: rosterPayload.length,
        leaveCount: leavePayload.length,
        timesheetCount: timesheetPayload.length,
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['roster_shifts'] })
      queryClient.invalidateQueries({ queryKey: ['leave_requests'] })
      queryClient.invalidateQueries({ queryKey: ['timesheets'] })
      setShowDeputyImport(false)
      setDeputyPreview(null)
      setDeputyFileName('')
      toast.success(`Imported ${result.rosterCount} shifts, ${result.leaveCount} leave requests, ${result.timesheetCount} timesheets`)
      if (result.warnings.length > 0) {
        toast.warning(`${result.warnings.length} import warning${result.warnings.length === 1 ? '' : 's'} — check unmapped staff/sites`)
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to import Deputy data')
    },
  })

  // ─── Computed data ─────────────────────────────────────────────────────────

  const siteMap = useMemo(
    () => Object.fromEntries(sites.map((s) => [s.id, s.name])),
    [sites]
  )
  const zoneMap = useMemo(
    () => Object.fromEntries(zones.map((z) => [z.id, z.name])),
    [zones]
  )
  const zoneCoordinateMap = useMemo(
    () => Object.fromEntries(zones.map((z) => [z.id, { lat: z.location_lat, lng: z.location_lng }])),
    [zones]
  )

  const filteredShifts = useMemo(() => {
    return shifts.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (siteFilter !== 'all' && s.client_site_id !== siteFilter) return false
      return true
    })
  }, [shifts, statusFilter, siteFilter])

  const filteredOfficers = useMemo(() => {
    if (!officerSearch.trim()) return officers
    const q = officerSearch.toLowerCase()
    return officers.filter(
      (o) =>
        o.first_name.toLowerCase().includes(q) ||
        o.last_name.toLowerCase().includes(q)
    )
  }, [officers, officerSearch])

  // Shift lookup: officer_id → date → shifts[]
  const shiftsByOfficerDate = useMemo(() => {
    const map: Record<string, Record<string, RosterShift[]>> = {}
    for (const shift of filteredShifts) {
      const oid = shift.officer_id || '__unassigned__'
      if (!map[oid]) map[oid] = {}
      if (!map[oid][shift.shift_date]) map[oid][shift.shift_date] = []
      map[oid][shift.shift_date].push(shift)
    }
    return map
  }, [filteredShifts])

  const leaveByOfficerDate = useMemo(() => {
    const map: Record<string, Record<string, LeaveRequest[]>> = {}
    for (const leave of leaveRequests) {
      if (!leave.officer_id) continue
      let cursor = parseISO(`${leave.date_start}T00:00:00`)
      const end = parseISO(`${leave.date_end}T00:00:00`)
      while (cursor <= end) {
        const dateKey = format(cursor, 'yyyy-MM-dd')
        if (!map[leave.officer_id]) map[leave.officer_id] = {}
        if (!map[leave.officer_id][dateKey]) map[leave.officer_id][dateKey] = []
        map[leave.officer_id][dateKey].push(leave)
        cursor = addDays(cursor, 1)
      }
    }
    return map
  }, [leaveRequests])

  const unassignedShifts = shiftsByOfficerDate['__unassigned__'] || {}
  const hasUnassigned = Object.keys(unassignedShifts).length > 0

  // ─── Summary stats ─────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const inPeriod = shifts.filter((s) => s.shift_date >= dateFrom && s.shift_date <= dateTo)
    return {
      total: inPeriod.length,
      draft: inPeriod.filter((s) => s.status === 'draft').length,
      published: inPeriod.filter((s) => s.status === 'published').length,
      confirmed: inPeriod.filter((s) => s.status === 'confirmed').length,
      conflicts: inPeriod.filter((s) => s.has_conflict).length,
    }
  }, [shifts, dateFrom, dateTo])

  // ─── Event handlers ────────────────────────────────────────────────────────

  function openAdd(officerId: string, date: string) {
    setEditShift(null)
    setPrefillOfficerId(officerId)
    setPrefillDate(date)
    setDialogOpen(true)
  }

  function openEdit(shift: RosterShift) {
    setEditShift(shift)
    setPrefillOfficerId(shift.officer_id || '')
    setPrefillDate(shift.shift_date)
    setDialogOpen(true)
  }

  function handleSave(data: ShiftFormData) {
    if (editShift) {
      updateMutation.mutate({ id: editShift.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id)
  }

  async function handleExportCsv() {
    try {
      setIsExporting(true)
      await new Promise((resolve) => setTimeout(resolve, 0))
      exportToCSV(filteredShifts, officers, sites)
    } finally {
      setIsExporting(false)
    }
  }

  async function handleDeputyFileChange(file: File | null) {
    if (!file) return
    const text = await file.text()
    const parsed = parseDeputyImportText(text)
    if (parsed.rows.length === 0) {
      toast.error('No Deputy rows were found in that file')
      return
    }
    setDeputyFileName(file.name)
    setDeputyPreview(parsed)
  }

  const isLoading = shiftsLoading || officersLoading
  const saving = createMutation.isPending || updateMutation.isPending
  const deleting = deleteMutation.isPending

  if (activeTab === 'users') {
    return (
      <AppLayout>
        <div className="flex flex-col h-full min-h-0">
          <GlobalFilterRibbon showDateFilter={false} showOrgFilter={false} showZoneFilter={false} />
          <div className="flex flex-col gap-3 px-4 pt-4 pb-2 border-b bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <h1 className="text-xl font-semibold">Roster Workforce</h1>
              </div>
              <div className="inline-flex rounded-md border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSearchParams({ tab: 'planner' })}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Planner
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-blue-600 text-white"
                >
                  Workforce
                </button>
              </div>
            </div>
          </div>
          <div className="p-4 overflow-y-auto">
            <UserManagement embedded />
          </div>
        </div>
      </AppLayout>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="flex flex-col h-full min-h-0">
        <GlobalFilterRibbon showDateFilter={false} showOrgFilter={false} showZoneFilter={false} />

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 px-4 pt-4 pb-2 border-b bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              <h1 className="text-xl font-semibold">Roster Planner</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <div className="inline-flex rounded-md border overflow-hidden mr-1">
                  <button
                    type="button"
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white"
                  >
                    Planner
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchParams({ tab: 'users' })}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    Workforce
                  </button>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={isExporting || isLoading}
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-1" />
                )}
                {isExporting ? 'Exporting…' : 'Export CSV'}
              </Button>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeputyImport(true)}
                  disabled={deputyImportMutation.isPending}
                >
                  {deputyImportMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-1" />
                  )}
                  {deputyImportMutation.isPending ? 'Importing…' : 'Import Deputy'}
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPublishConfirm(true)}
                  disabled={stats.draft === 0}
                >
                  <Send className="w-4 h-4 mr-1" />
                  Publish Week ({stats.draft})
                </Button>
              )}
              <Button size="sm" onClick={() => openAdd('', format(new Date(), 'yyyy-MM-dd'))}>
                <Plus className="w-4 h-4 mr-1" />
                Add Shift
              </Button>
            </div>
          </div>

          {/* Week navigation + view toggle */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={goPrev}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8" onClick={goToday}>
                This Week
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={goNext}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <span className="text-sm font-medium text-gray-700">
              {format(viewStart, 'd MMM')} – {format(viewEnd, 'd MMM yyyy')}
            </span>
            <div className="ml-auto flex items-center gap-1 border rounded-md overflow-hidden">
              {(['week', 'fortnight'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 text-xs capitalize transition-colors ${
                    viewMode === mode
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* ── Filters ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search officers…"
              className="h-8 w-44 text-sm"
              value={officerSearch}
              onChange={(e) => setOfficerSearch(e.target.value)}
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="h-8 w-36 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {(['draft', 'published', 'confirmed', 'completed', 'cancelled'] as ShiftStatus[]).map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={siteFilter} onValueChange={setSiteFilter}>
              <SelectTrigger className="h-8 w-44 text-sm">
                <SelectValue placeholder="Site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sites</SelectItem>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Summary Stats ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 px-4 py-2 bg-gray-50 border-b">
          <StatPill icon={<FileText className="w-3.5 h-3.5" />} label="Total" value={stats.total} />
          <StatPill icon={<Clock className="w-3.5 h-3.5 text-blue-500" />} label="Published" value={stats.published} color="blue" />
          <StatPill icon={<CheckCircle className="w-3.5 h-3.5 text-green-500" />} label="Confirmed" value={stats.confirmed} color="green" />
          <StatPill icon={<RefreshCw className="w-3.5 h-3.5 text-gray-400" />} label="Draft" value={stats.draft} />
          <StatPill
            icon={<AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
            label="Conflicts"
            value={stats.conflicts}
            color={stats.conflicts > 0 ? 'red' : undefined}
          />
        </div>

        {/* ── Roster Board ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <RosterSkeleton />
          ) : (
            <div className="min-w-max">
              {/* Column headers */}
              <div
                className="grid sticky top-0 z-10 bg-white border-b shadow-sm"
                style={{ gridTemplateColumns: `minmax(160px,200px) repeat(${dayCount}, minmax(130px,1fr))` }}
              >
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  Officer
                </div>
                {weekDays.map((day) => {
                  const isToday = isSameDay(day, new Date())
                  return (
                    <div
                      key={day.toISOString()}
                      className={`px-2 py-2 text-center border-l ${isToday ? 'bg-blue-50' : ''}`}
                    >
                      <div className={`text-xs font-semibold ${isToday ? 'text-blue-700' : 'text-gray-500'}`}>
                        {format(day, 'EEE')}
                      </div>
                      <div
                        className={`text-sm font-bold mt-0.5 ${
                          isToday
                            ? 'bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center mx-auto'
                            : 'text-gray-800'
                        }`}
                      >
                        {format(day, 'd')}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Officer rows */}
              {filteredOfficers.length === 0 && !isLoading && (
                <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
                  No officers found.
                </div>
              )}
              {filteredOfficers.map((officer, idx) => {
                const officerShifts = Object.values(shiftsByOfficerDate[officer.id] || {}).flat()
                return (
                  <div
                    key={officer.id}
                    className={`grid border-b ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}
                    style={{ gridTemplateColumns: `minmax(160px,200px) repeat(${dayCount}, minmax(130px,1fr))` }}
                  >
                    {/* Officer label */}
                    <div className="border-r">
                      <OfficerRowStats
                        officer={officer}
                        shifts={officerShifts}
                        availability={availability}
                        weekDays={weekDays}
                      />
                    </div>

                    {/* Day cells */}
                    {weekDays.map((day) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      const cellShifts = shiftsByOfficerDate[officer.id]?.[dateStr] || []
                      const cellLeave = leaveByOfficerDate[officer.id]?.[dateStr] || []
                      const isToday = isSameDay(day, new Date())
                      return (
                        <div
                          key={dateStr}
                          className={`border-l min-h-[72px] p-1 cursor-pointer group ${
                            isToday ? 'bg-blue-50/40' : ''
                          }`}
                          onClick={() => {
                            if (cellShifts.length === 0) openAdd(officer.id, dateStr)
                          }}
                        >
                          {cellLeave.map((leave) => (
                            <div
                              key={leave.id}
                              className="mb-1 rounded border border-teal-200 bg-teal-50 px-2 py-1 text-[10px] text-teal-800"
                            >
                              <div className="font-medium truncate">{leave.leave_type_name}</div>
                              <div className="text-teal-700">{leave.status === 'approved' ? 'Approved leave' : 'Pending leave'}</div>
                            </div>
                          ))}
                          {cellShifts.map((shift) => (
                            (() => {
                              const coords = shift.zone_id ? zoneCoordinateMap[shift.zone_id] : null
                              const mapUrl =
                                coords?.lat != null && coords?.lng != null
                                  ? buildPreferredMapUrlForCoordinates(coords.lat, coords.lng)
                                  : undefined
                              return (
                            <ShiftCard
                              key={shift.id}
                              shift={shift}
                              siteName={shift.client_site_id ? siteMap[shift.client_site_id] || '' : ''}
                              zoneName={shift.zone_id ? zoneMap[shift.zone_id] || '' : ''}
                              mapUrl={mapUrl}
                              onClick={(e) => {
                                (e as any).stopPropagation?.()
                                openEdit(shift)
                              }}
                            />
                              )
                            })()
                          ))}
                          {cellShifts.length === 0 && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center h-full">
                              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                <Plus className="w-3 h-3" /> Add
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}

              {/* Unassigned row */}
              {(hasUnassigned || isAdmin) && (
                <>
                  <div className="px-3 py-1 bg-gray-100 border-b border-t text-xs text-gray-500 font-medium uppercase tracking-wide">
                    Unassigned
                  </div>
                  <div
                    className="grid border-b bg-amber-50/30"
                    style={{ gridTemplateColumns: `minmax(160px,200px) repeat(${dayCount}, minmax(130px,1fr))` }}
                  >
                    <div className="border-r px-3 py-2">
                      <div className="text-xs text-gray-500 italic">No officer</div>
                    </div>
                    {weekDays.map((day) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      const cellShifts = unassignedShifts[dateStr] || []
                      const isToday = isSameDay(day, new Date())
                      return (
                        <div
                          key={dateStr}
                          className={`border-l min-h-[56px] p-1 cursor-pointer group ${isToday ? 'bg-blue-50/40' : ''}`}
                          onClick={() => {
                            if (cellShifts.length === 0) openAdd('', dateStr)
                          }}
                        >
                          {cellShifts.map((shift) => (
                            (() => {
                              const coords = shift.zone_id ? zoneCoordinateMap[shift.zone_id] : null
                              const mapUrl =
                                coords?.lat != null && coords?.lng != null
                                  ? buildPreferredMapUrlForCoordinates(coords.lat, coords.lng)
                                  : undefined
                              return (
                            <ShiftCard
                              key={shift.id}
                              shift={shift}
                              siteName={shift.client_site_id ? siteMap[shift.client_site_id] || '' : ''}
                              zoneName={shift.zone_id ? zoneMap[shift.zone_id] || '' : ''}
                              mapUrl={mapUrl}
                              onClick={(e) => {
                                (e as any).stopPropagation?.()
                                openEdit(shift)
                              }}
                            />
                              )
                            })()
                          ))}
                          {cellShifts.length === 0 && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center h-full">
                              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                <Plus className="w-3 h-3" /> Add
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Shift Dialog ──────────────────────────────────────────────────── */}
      {dialogOpen && (
        <ShiftDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          editShift={editShift}
          prefillOfficerId={prefillOfficerId}
          prefillDate={prefillDate}
          officers={officers}
          sites={sites}
          zones={zones}
          patrolRoutes={patrolRoutes}
          allShifts={shifts}
          availability={availability}
          leaveRequests={leaveRequests}
          isAdmin={isAdmin}
          onSave={handleSave}
          onDelete={handleDelete}
          saving={saving}
          deleting={deleting}
        />
      )}

      <Dialog open={showDeputyImport} onOpenChange={setShowDeputyImport}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import Deputy roster
            </DialogTitle>
            <DialogDescription>
              Upload a Deputy CSV or TSV export. We import it into native roster shifts, leave requests, and timesheets.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-dashed p-4">
              <Label htmlFor="deputy-import-file" className="text-sm font-medium">Deputy export file</Label>
              <Input
                id="deputy-import-file"
                type="file"
                accept=".csv,.tsv,.txt"
                className="mt-2"
                onChange={(e) => void handleDeputyFileChange(e.target.files?.[0] ?? null)}
              />
              {deputyFileName && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Loaded <strong>{deputyFileName}</strong> · {deputyPreview?.rows.length ?? 0} rows
                </p>
              )}
            </div>

            {deputyPreview && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Schedules</CardTitle></CardHeader>
                    <CardContent className="pt-0 text-2xl font-semibold">{deputyPreview.scheduleCount}</CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Leave</CardTitle></CardHeader>
                    <CardContent className="pt-0 text-2xl font-semibold">{deputyPreview.leaveCount}</CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Timesheets</CardTitle></CardHeader>
                    <CardContent className="pt-0 text-2xl font-semibold">{deputyPreview.timesheetCount}</CardContent>
                  </Card>
                </div>

                <div className="rounded-lg border">
                  <div className="grid grid-cols-[1.2fr_1fr_1.2fr_1fr_1fr] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium">
                    <div>Employee</div>
                    <div>Location</div>
                    <div>Schedule</div>
                    <div>Leave</div>
                    <div>Warning</div>
                  </div>
                  {deputyPreview.previewRows.map((row, index) => (
                    <div key={`${row.employee}-${index}`} className="grid grid-cols-[1.2fr_1fr_1.2fr_1fr_1fr] gap-2 px-3 py-2 text-xs border-b last:border-b-0">
                      <div className="truncate">{row.employee}</div>
                      <div className="truncate">{row.location}</div>
                      <div className="truncate">{row.schedule}</div>
                      <div className="truncate">{row.leave}</div>
                      <div className="truncate">{row.warning}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeputyImport(false)}>Cancel</Button>
            <Button onClick={() => deputyPreview && deputyImportMutation.mutate(deputyPreview)} disabled={!deputyPreview || deputyImportMutation.isPending}>
              {deputyImportMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Publish Confirmation ──────────────────────────────────────────── */}
      <AlertDialog open={showPublishConfirm} onOpenChange={setShowPublishConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish {stats.draft} draft shift{stats.draft !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will publish all draft shifts for{' '}
              <strong>
                {format(viewStart, 'd MMM')} – {format(viewEnd, 'd MMM yyyy')}
              </strong>
              . Officers will be notified. Published shifts can still be edited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => publishWeekMutation.mutate()}
              disabled={publishWeekMutation.isPending}
            >
              {publishWeekMutation.isPending ? 'Publishing…' : 'Publish'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function StatPill({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color?: 'blue' | 'green' | 'red'
}) {
  const colorClass =
    color === 'blue'
      ? 'text-blue-700'
      : color === 'green'
      ? 'text-green-700'
      : color === 'red'
      ? 'text-red-600 font-semibold'
      : 'text-gray-700'

  return (
    <div className="flex items-center gap-1.5 text-sm">
      {icon}
      <span className="text-gray-500">{label}:</span>
      <span className={`font-semibold ${colorClass}`}>{value}</span>
    </div>
  )
}

function RosterSkeleton() {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-2">
          <Skeleton className="h-16 w-40 shrink-0" />
          {Array.from({ length: 7 }).map((_, j) => (
            <Skeleton key={j} className="h-16 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}
