/**
 * OnCallPeriods — Sprint 15 / B-51
 *
 * Manages on-call availability rostering for officers.
 * Tables: on_call_periods (+ on_call_rates for rate lookup) — NOT in database.ts; uses (supabase as any).
 *
 * Features:
 * - KPI strip: Total / Active / Completed / Pending callouts
 * - Table with date filter, officer filter, status filter
 * - Schedule new on-call period dialog (officer, start/end, period_type, flat_rate)
 * - Cancel / Accept row actions
 * - Link to callout shifts via badge count
 *
 * Route: /on-call-periods
 * Roles: admin, admin_officer, master
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { formatInTimeZone } from 'date-fns-tz'
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  Moon,
  Phone,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// ─── Types ──────────────────────────────────────────────────────────────────────

type OcpStatus = 'scheduled' | 'active' | 'completed' | 'cancelled'
type PeriodType =
  | 'standard'
  | 'before_shift'
  | 'after_shift'
  | 'overnight'
  | 'weekend'
  | 'public_holiday'

interface OnCallPeriod {
  id: string
  organization_id: string
  officer_id: string
  start_time: string
  end_time: string
  period_type: PeriodType
  linked_roster_shift_id: string | null
  flat_rate_amount: number | null
  hourly_rate_amount: number | null
  status: OcpStatus
  officer_accepted: boolean | null
  officer_accepted_at: string | null
  officer_notes: string | null
  callout_count: number
  total_callout_hours: number
  on_call_pay_amount: number | null
  callout_pay_amount: number | null
  travel_pay_amount: number | null
  total_pay_amount: number | null
  notes: string | null
  internal_notes: string | null
  created_at: string
  updated_at: string
  officer?: { first_name: string; last_name: string } | null
}

interface Officer {
  id: string
  first_name: string
  last_name: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const NZ_TZ = 'Pacific/Auckland'

const STATUS_CONFIG: Record<OcpStatus, { label: string; color: string }> = {
  scheduled: {
    label: 'Scheduled',
    color:
      'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
  active: {
    label: 'Active',
    color:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  completed: {
    label: 'Completed',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300',
  },
  cancelled: {
    label: 'Cancelled',
    color:
      'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
}

const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
  standard: 'Standard',
  before_shift: 'Before Shift',
  after_shift: 'After Shift',
  overnight: 'Overnight',
  weekend: 'Weekend',
  public_holiday: 'Public Holiday',
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtTs(iso: string | null) {
  if (!iso) return '—'
  try {
    return formatInTimeZone(new Date(iso), NZ_TZ, 'd MMM yy HH:mm')
  } catch {
    return iso
  }
}

function officerName(p: OnCallPeriod) {
  if (!p.officer) return '—'
  return [p.officer.first_name, p.officer.last_name].filter(Boolean).join(' ')
}

function fmtCurrency(v: number | null) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

// ─── Schedule Dialog ────────────────────────────────────────────────────────────

interface ScheduleDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (values: Record<string, any>) => void
  isSaving: boolean
  officers: Officer[]
}

function ScheduleDialog({
  open,
  onClose,
  onSubmit,
  isSaving,
  officers,
}: ScheduleDialogProps) {
  const [form, setForm] = useState({
    officer_id: '',
    start_time: '',
    end_time: '',
    period_type: 'standard' as PeriodType,
    flat_rate_amount: '',
    notes: '',
  })

  const set = (k: string) => (v: any) => setForm((f) => ({ ...f, [k]: v }))

  const isValid =
    form.officer_id && form.start_time && form.end_time && form.start_time < form.end_time

  const handleSubmit = () => {
    if (!isValid) return
    onSubmit({
      officer_id: form.officer_id,
      start_time: new Date(form.start_time).toISOString(),
      end_time: new Date(form.end_time).toISOString(),
      period_type: form.period_type,
      flat_rate_amount: form.flat_rate_amount ? parseFloat(form.flat_rate_amount) : null,
      notes: form.notes || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-blue-500" />
            Schedule On-Call Period
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Officer <span className="text-red-500">*</span></Label>
            <Select value={form.officer_id} onValueChange={set('officer_id')}>
              <SelectTrigger>
                <SelectValue placeholder="Select an officer…" />
              </SelectTrigger>
              <SelectContent>
                {officers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {[o.first_name, o.last_name].filter(Boolean).join(' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Start Time <span className="text-red-500">*</span></Label>
              <Input
                type="datetime-local"
                value={form.start_time}
                onChange={(e) => set('start_time')(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>End Time <span className="text-red-500">*</span></Label>
              <Input
                type="datetime-local"
                value={form.end_time}
                onChange={(e) => set('end_time')(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Period Type</Label>
            <Select value={form.period_type} onValueChange={set('period_type') as any}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PERIOD_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Flat Rate (NZD, blank = use rate table)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 60.00"
              value={form.flat_rate_amount}
              onChange={(e) => set('flat_rate_amount')(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Internal Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => set('notes')(e.target.value)}
              rows={2}
              placeholder="Optional notes for this on-call period…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving || !isValid}>
            {isSaving ? 'Saving…' : 'Schedule On-Call'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function OnCallPeriods() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const qc = useQueryClient()

  const [officerFilter, setOfficerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)

  // ── Fetch on-call periods ──────────────────────────────────────────────────
  const { data: periods = [], isLoading } = useQuery<OnCallPeriod[]>({
    queryKey: ['on-call-periods', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('on_call_periods')
        .select('*, officer:officer_id(first_name, last_name)')
        .eq('organization_id', orgId)
        .order('start_time', { ascending: false })
        .limit(200)
      if (error && (error.code === 'PGRST205' || error.code === '42P01')) return []
      if (error) throw error
      return (data ?? []) as OnCallPeriod[]
    },
    enabled: !!orgId,
    staleTime: 30_000,
    retry: false,
  })

  // ── Fetch officers for dropdown ────────────────────────────────────────────
  const { data: officers = [] } = useQuery<Officer[]>({
    queryKey: ['on-call-officers', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('user_profiles')
        .select('id, first_name, last_name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .in('role', ['officer', 'admin_officer'])
        .order('first_name')
      if (error) throw error
      return (data ?? []) as Officer[]
    },
    enabled: !!orgId,
  })

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(
    () => ({
      total: periods.length,
      active: periods.filter((p) => p.status === 'active').length,
      scheduled: periods.filter((p) => p.status === 'scheduled').length,
      pendingCallouts: periods.reduce((s, p) => s + (p.callout_count ?? 0), 0),
    }),
    [periods]
  )

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return periods.filter((p) => {
      if (officerFilter !== 'all' && p.officer_id !== officerFilter) return false
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const name = officerName(p).toLowerCase()
        const notes = (p.notes ?? '').toLowerCase()
        if (!name.includes(q) && !notes.includes(q)) return false
      }
      return true
    })
  }, [periods, officerFilter, statusFilter, search])

  // ── Schedule on-call period ───────────────────────────────────────────────
  const scheduleMutation = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const { error } = await (supabase as any)
        .from('on_call_periods')
        .insert({
          ...values,
          organization_id: orgId,
          created_by: user?.id,
          status: 'scheduled',
        })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['on-call-periods'] })
      toast.success('On-call period scheduled')
      setScheduleOpen(false)
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to schedule on-call period'),
  })

  // ── Cancel ────────────────────────────────────────────────────────────────
  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('on_call_periods')
        .update({ status: 'cancelled' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['on-call-periods'] })
      toast.success('On-call period cancelled')
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to cancel'),
  })

  // ── Accept (admin-side confirm) ───────────────────────────────────────────
  const acceptMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('on_call_periods')
        .update({ officer_accepted: true, officer_accepted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['on-call-periods'] })
      toast.success('On-call period accepted')
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to mark as accepted'),
  })

  return (
    <AppLayout
      title="On-Call Periods"
      description="Schedule and manage on-call availability windows — officers receive a fixed rate for being on-call"
    >
      {/* Back nav */}
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/admin')}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total',        value: kpis.total,           Icon: CalendarClock, color: 'text-blue-600' },
          { label: 'Active Now',   value: kpis.active,          Icon: Moon,          color: 'text-emerald-600' },
          { label: 'Scheduled',    value: kpis.scheduled,       Icon: Clock,         color: 'text-sky-600' },
          { label: 'Total Callouts', value: kpis.pendingCallouts, Icon: Phone,       color: 'text-amber-600' },
        ].map(({ label, value, Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <Icon className={`h-5 w-5 shrink-0 ${color}`} />
              <div>
                <p className="text-2xl font-bold leading-tight">{isLoading ? '—' : value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search officer, notes…"
            className="pl-8 w-52 h-8 text-xs"
          />
        </div>
        <Select value={officerFilter} onValueChange={setOfficerFilter}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue placeholder="Officer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All officers</SelectItem>
            {officers.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {[o.first_name, o.last_name].filter(Boolean).join(' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setScheduleOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Schedule On-Call
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <div className="rounded-xl overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs">Officer</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Start</TableHead>
                <TableHead className="text-xs">End</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Accepted</TableHead>
                <TableHead className="text-xs">Callouts</TableHead>
                <TableHead className="text-xs">Rate</TableHead>
                <TableHead className="text-xs">Total Pay</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={10}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="text-center text-sm text-muted-foreground py-10"
                  >
                    No on-call periods match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((period) => {
                  const statusCfg = STATUS_CONFIG[period.status as OcpStatus] ?? STATUS_CONFIG.scheduled
                  return (
                    <TableRow key={period.id}>
                      <TableCell className="py-2 text-sm font-medium">
                        {officerName(period)}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">
                        {PERIOD_TYPE_LABELS[period.period_type] ?? period.period_type}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtTs(period.start_time)}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtTs(period.end_time)}
                      </TableCell>
                      <TableCell className="py-2">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusCfg.color}`}
                        >
                          {statusCfg.label}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-center">
                        {period.officer_accepted === true ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mx-auto" />
                        ) : period.officer_accepted === false ? (
                          <X className="h-3.5 w-3.5 text-red-500 mx-auto" />
                        ) : (
                          <Clock className="h-3.5 w-3.5 text-amber-400 mx-auto" aria-label="Pending" />
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-center text-xs">
                        {period.callout_count > 0 ? (
                          <button
                            className="text-blue-600 hover:underline font-medium"
                            onClick={() => navigate(`/callout-shifts?on_call_period_id=${period.id}`)}
                          >
                            {period.callout_count}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">
                        {period.flat_rate_amount != null
                          ? `$${period.flat_rate_amount.toFixed(2)} flat`
                          : period.hourly_rate_amount != null
                          ? `$${period.hourly_rate_amount.toFixed(2)}/hr`
                          : '—'}
                      </TableCell>
                      <TableCell className="py-2 text-xs font-medium">
                        {fmtCurrency(period.total_pay_amount)}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-1">
                          {period.status === 'scheduled' && !period.officer_accepted && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px] text-emerald-700 hover:text-emerald-900"
                              onClick={() => acceptMutation.mutate(period.id)}
                              disabled={acceptMutation.isPending}
                              title="Mark as accepted"
                            >
                              Accept
                            </Button>
                          )}
                          {(period.status === 'scheduled' || period.status === 'active') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px] text-red-700 hover:text-red-900"
                              onClick={() => cancelMutation.mutate(period.id)}
                              disabled={cancelMutation.isPending}
                              title="Cancel on-call period"
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            {filtered.length} of {periods.length} period{periods.length !== 1 ? 's' : ''}
          </div>
        )}
      </Card>

      {/* Schedule dialog */}
      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSubmit={(v) => scheduleMutation.mutate(v)}
        isSaving={scheduleMutation.isPending}
        officers={officers}
      />
    </AppLayout>
  )
}
