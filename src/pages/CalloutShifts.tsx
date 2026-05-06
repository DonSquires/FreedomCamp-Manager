/**
 * CalloutShifts — Sprint 15 / B-52
 *
 * Admin view of ad-hoc callout shifts triggered from on-call periods.
 * Tables: callout_shifts — NOT in database.ts; uses (supabase as any).
 *
 * Features:
 * - KPI strip: Total / In Progress / Completed / Avg Billable Hours
 * - Table with status filter, officer filter, date range filter
 * - URL param ?on_call_period_id=… to pre-filter from OnCallPeriods page
 * - Expandable row: full timestamp progression + pay breakdown
 * - Update-status (complete / cancel) action
 *
 * Route: /callout-shifts
 * Roles: admin, admin_officer, master
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { formatInTimeZone } from 'date-fns-tz'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  MapPin,
  Phone,
  Search,
  Timer,
  TrendingUp,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

// ─── Types ──────────────────────────────────────────────────────────────────────

type CalloutStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

interface CalloutShift {
  id: string
  organization_id: string
  officer_id: string
  on_call_period_id: string
  callout_reason: string | null
  callout_address: string | null
  callout_received_at: string
  departed_at: string | null
  arrived_at: string | null
  work_started_at: string | null
  work_ended_at: string | null
  returned_at: string | null
  actual_work_hours: number | null
  actual_total_hours: number | null
  minimum_hours: number
  billable_hours: number | null
  callout_hourly_rate: number | null
  callout_after_minimum_rate: number | null
  base_pay_amount: number | null
  additional_pay_amount: number | null
  total_pay_amount: number | null
  status: CalloutStatus
  notes: string | null
  admin_notes: string | null
  created_at: string
  updated_at: string
  officer?: { first_name: string; last_name: string } | null
  on_call_period?: { start_time: string; end_time: string } | null
}

interface Officer {
  id: string
  first_name: string
  last_name: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const NZ_TZ = 'Pacific/Auckland'

const STATUS_CONFIG: Record<CalloutStatus, { label: string; color: string }> = {
  pending: {
    label: 'Pending',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  in_progress: {
    label: 'In Progress',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
  completed: {
    label: 'Completed',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
  },
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtTs(iso: string | null) {
  if (!iso) return '—'
  try {
    return formatInTimeZone(new Date(iso), NZ_TZ, 'dd MMM yy HH:mm')
  } catch {
    return iso
  }
}

function fmtHours(h: number | null) {
  if (h == null) return '—'
  return `${h.toFixed(2)} h`
}

function fmtCurrency(v: number | null) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

function officerName(c: CalloutShift) {
  if (!c.officer) return '—'
  return [c.officer.first_name, c.officer.last_name].filter(Boolean).join(' ')
}

// ─── Expandable Detail Panel ────────────────────────────────────────────────────

function DetailPanel({ callout }: { callout: CalloutShift }) {
  const steps = [
    { label: 'Call Received', ts: callout.callout_received_at },
    { label: 'Departed',      ts: callout.departed_at },
    { label: 'Arrived',       ts: callout.arrived_at },
    { label: 'Work Started',  ts: callout.work_started_at },
    { label: 'Work Ended',    ts: callout.work_ended_at },
    { label: 'Returned',      ts: callout.returned_at },
  ]

  return (
    <div className="bg-muted/40 border-t px-5 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-xs">
      {/* Timeline */}
      <div className="col-span-full sm:col-span-1">
        <p className="font-medium text-muted-foreground mb-2">Timestamp Progression</p>
        <ol className="relative border-l border-muted-foreground/20 pl-4 space-y-2">
          {steps.map(({ label, ts }) => (
            <li key={label} className="flex items-start gap-2">
              <span
                className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${ts ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`}
                style={{ marginLeft: '-1.125rem' }}
              />
              <div>
                <p className="font-medium leading-tight">{label}</p>
                <p className="text-muted-foreground">{fmtTs(ts)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Hours & Rates */}
      <div>
        <p className="font-medium text-muted-foreground mb-2">Hours</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Actual work</span>
            <span>{fmtHours(callout.actual_work_hours)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Minimum guarantee</span>
            <span>{fmtHours(callout.minimum_hours)}</span>
          </div>
          <div className="flex justify-between font-medium border-t pt-1 mt-1">
            <span>Billable</span>
            <span>{fmtHours(callout.billable_hours)}</span>
          </div>
        </div>
        <p className="font-medium text-muted-foreground mb-2 mt-4">Rates</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Base rate (3hr min)</span>
            <span>{fmtCurrency(callout.callout_hourly_rate)}/hr</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">After-minimum rate</span>
            <span>{fmtCurrency(callout.callout_after_minimum_rate)}/hr</span>
          </div>
        </div>
      </div>

      {/* Pay */}
      <div>
        <p className="font-medium text-muted-foreground mb-2">Pay Breakdown</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Base pay (min hrs)</span>
            <span>{fmtCurrency(callout.base_pay_amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Additional pay</span>
            <span>{fmtCurrency(callout.additional_pay_amount)}</span>
          </div>
          <div className="flex justify-between font-semibold border-t pt-1 mt-1 text-emerald-700 dark:text-emerald-400">
            <span>Total Callout Pay</span>
            <span>{fmtCurrency(callout.total_pay_amount)}</span>
          </div>
        </div>

        {/* Location */}
        {callout.callout_address && (
          <div className="mt-4">
            <p className="font-medium text-muted-foreground mb-1">Location</p>
            <div className="flex items-start gap-1">
              <MapPin className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
              <span>{callout.callout_address}</span>
            </div>
          </div>
        )}

        {/* Notes */}
        {callout.callout_reason && (
          <div className="mt-4">
            <p className="font-medium text-muted-foreground mb-1">Reason</p>
            <p>{callout.callout_reason}</p>
          </div>
        )}
        {callout.admin_notes && (
          <div className="mt-4">
            <p className="font-medium text-muted-foreground mb-1">Admin Notes</p>
            <p>{callout.admin_notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function CalloutShifts() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const qc = useQueryClient()

  // Pre-filter from OnCallPeriods page
  const preFilterOcpId = searchParams.get('on_call_period_id') ?? ''

  const [statusFilter, setStatusFilter] = useState('all')
  const [officerFilter, setOfficerFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Fetch callout shifts ───────────────────────────────────────────────────
  const { data: callouts = [], isLoading } = useQuery<CalloutShift[]>({
    queryKey: ['callout-shifts', orgId, preFilterOcpId],
    queryFn: async () => {
      if (!orgId) return []
      let q = (supabase as any)
        .from('callout_shifts')
        .select(
          '*, officer:officer_id(first_name, last_name), on_call_period:on_call_period_id(start_time, end_time)'
        )
        .eq('organization_id', orgId)
        .order('callout_received_at', { ascending: false })
        .limit(300)

      if (preFilterOcpId) {
        q = q.eq('on_call_period_id', preFilterOcpId)
      }

      const { data, error } = await q
      if (error && (error.code === 'PGRST205' || error.code === '42P01')) return []
      if (error) throw error
      return (data ?? []) as CalloutShift[]
    },
    enabled: !!orgId,
    staleTime: 30_000,
    retry: false,
  })

  // ── Fetch officers ─────────────────────────────────────────────────────────
  const { data: officers = [] } = useQuery<Officer[]>({
    queryKey: ['callout-officers', orgId],
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
  const kpis = useMemo(() => {
    const completed = callouts.filter((c) => c.status === 'completed')
    const avgBillable =
      completed.length > 0
        ? completed.reduce((s, c) => s + (c.billable_hours ?? 0), 0) / completed.length
        : 0
    return {
      total: callouts.length,
      inProgress: callouts.filter((c) => c.status === 'in_progress' || c.status === 'pending').length,
      completed: completed.length,
      avgBillable,
    }
  }, [callouts])

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return callouts.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (officerFilter !== 'all' && c.officer_id !== officerFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const name = officerName(c).toLowerCase()
        const reason = (c.callout_reason ?? '').toLowerCase()
        const address = (c.callout_address ?? '').toLowerCase()
        if (!name.includes(q) && !reason.includes(q) && !address.includes(q)) return false
      }
      return true
    })
  }, [callouts, statusFilter, officerFilter, search])

  // ── Complete / Cancel mutations ────────────────────────────────────────────
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CalloutStatus }) => {
      const updates: Record<string, any> = { status }
      if (status === 'completed' && !callouts.find((c) => c.id === id)?.work_ended_at) {
        updates.work_ended_at = new Date().toISOString()
      }
      const { error } = await (supabase as any)
        .from('callout_shifts')
        .update(updates)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ['callout-shifts'] })
      qc.invalidateQueries({ queryKey: ['on-call-periods'] })
      toast.success(`Callout shift marked as ${status}`)
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to update callout'),
  })

  return (
    <AppLayout
      title="Callout Shifts"
      description="Ad-hoc shifts triggered from on-call periods — 3-hour minimum pay guarantee applies"
    >
      {/* Back nav */}
      <div className="mb-4 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/on-call-periods')}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          On-Call Periods
        </Button>
        {preFilterOcpId && (
          <Badge variant="secondary" className="text-xs gap-1.5">
            Filtered by on-call period
            <button
              className="hover:text-foreground"
              onClick={() => navigate('/callout-shifts')}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total',          value: kpis.total,              Icon: Phone,       color: 'text-blue-600' },
          { label: 'Active',         value: kpis.inProgress,          Icon: Timer,       color: 'text-amber-600' },
          { label: 'Completed',      value: kpis.completed,           Icon: CheckCircle2,color: 'text-emerald-600' },
          { label: 'Avg Billable',   value: `${kpis.avgBillable.toFixed(1)} h`, Icon: TrendingUp, color: 'text-indigo-600', raw: true },
        ].map(({ label, value, Icon, color, raw }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <Icon className={`h-5 w-5 shrink-0 ${color}`} />
              <div>
                <p className="text-2xl font-bold leading-tight">
                  {isLoading ? '—' : value}
                </p>
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
            placeholder="Search officer, reason, address…"
            className="pl-8 w-56 h-8 text-xs"
          />
        </div>
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
      </div>

      {/* Table */}
      <Card>
        <div className="rounded-xl overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs w-6" />
                <TableHead className="text-xs">Officer</TableHead>
                <TableHead className="text-xs">Call Received</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Billable Hrs</TableHead>
                <TableHead className="text-xs">Total Pay</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-sm text-muted-foreground py-10"
                  >
                    No callout shifts match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((callout) => {
                  const isExpanded = expandedId === callout.id
                  const statusCfg = STATUS_CONFIG[callout.status] ?? STATUS_CONFIG.pending
                  return (
                    <>
                      <TableRow
                        key={callout.id}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => setExpandedId(isExpanded ? null : callout.id)}
                      >
                        <TableCell className="py-2 pl-3 pr-0">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-sm font-medium">
                          {officerName(callout)}
                        </TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {fmtTs(callout.callout_received_at)}
                        </TableCell>
                        <TableCell className="py-2">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusCfg.color}`}
                          >
                            {statusCfg.label}
                          </span>
                        </TableCell>
                        <TableCell className="py-2 text-xs">
                          {callout.billable_hours != null ? (
                            <span
                              className={
                                callout.billable_hours === callout.minimum_hours
                                  ? 'text-amber-600'
                                  : 'text-foreground'
                              }
                              title={
                                callout.billable_hours === callout.minimum_hours
                                  ? 'Paid at minimum'
                                  : undefined
                              }
                            >
                              {fmtHours(callout.billable_hours)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-xs font-medium">
                          {fmtCurrency(callout.total_pay_amount)}
                        </TableCell>
                        <TableCell
                          className="py-2 text-xs text-muted-foreground max-w-[140px] truncate"
                          title={callout.callout_reason ?? undefined}
                        >
                          {callout.callout_reason ?? '—'}
                        </TableCell>
                        <TableCell className="py-2">
                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {callout.status === 'in_progress' || callout.status === 'pending' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[10px] text-emerald-700 hover:text-emerald-900"
                                onClick={() =>
                                  updateStatusMutation.mutate({ id: callout.id, status: 'completed' })
                                }
                                disabled={updateStatusMutation.isPending}
                              >
                                Complete
                              </Button>
                            ) : null}
                            {callout.status !== 'completed' && callout.status !== 'cancelled' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[10px] text-red-700 hover:text-red-900"
                                onClick={() =>
                                  updateStatusMutation.mutate({ id: callout.id, status: 'cancelled' })
                                }
                                disabled={updateStatusMutation.isPending}
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${callout.id}-detail`}>
                          <TableCell colSpan={8} className="p-0">
                            <DetailPanel callout={callout} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            {filtered.length} of {callouts.length} callout{callouts.length !== 1 ? 's' : ''}
          </div>
        )}
      </Card>
    </AppLayout>
  )
}
