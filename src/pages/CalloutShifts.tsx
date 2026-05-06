/**
 * CalloutShifts — B-52
 *
 * Ad-hoc callout shifts triggered from on-call periods.
 * Supports deep-linking via ?on_call_period_id=<id> from OnCallPeriods.
 *
 * Features:
 *  - KPI cards: Pending / In Progress / Completed / Cancelled + total pay
 *  - Filter by status, officer, date range; deep-link pre-filter
 *  - Expandable rows with full timestamp breakdown + pay detail
 *  - Complete / Cancel actions
 *  - Links to /travel-allowances?callout_shift_id=<id>
 *
 * Route: /callout-shifts  — admin/admin_officer/master/officer
 * Note: callout_shifts not in database.ts snapshot — uses (supabase as any)
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Siren, ChevronDown, ChevronRight, Clock, MapPin, User,
  RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2,
  Filter, Car, DollarSign, PhoneCall,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ─── Types ───────────────────────────────────────────────────────────────────

interface OfficerOption {
  id: string
  full_name: string
  call_sign: string | null
}

interface CalloutShift {
  id: string
  organization_id: string
  officer_id: string
  officer?: OfficerOption
  on_call_period_id: string
  callout_reason: string | null
  callout_address: string | null
  callout_latitude: number | null
  callout_longitude: number | null
  callout_received_at: string
  departed_at: string | null
  arrived_at: string | null
  work_started_at: string | null
  work_ended_at: string | null
  returned_at: string | null
  actual_work_hours: number | null
  minimum_hours: number
  billable_hours: number | null
  callout_hourly_rate: number | null
  base_pay_amount: number | null
  additional_pay_amount: number | null
  total_pay_amount: number | null
  status: string
  notes: string | null
  admin_notes: string | null
  created_at: string
}

const STATUS_COLOURS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

function fmtTime(ts: string | null): string {
  if (!ts) return '—'
  return format(parseISO(ts), 'HH:mm')
}

function fmtHours(h: number | null): string {
  if (h == null) return '—'
  return `${Number(h).toFixed(2)} h`
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalloutShifts() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const role = user?.role
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const deepLinkPeriodId = searchParams.get('on_call_period_id')

  const [officerFilter, setOfficerFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const isAdmin = ['admin', 'admin_officer', 'master', 'grand_master'].includes(role || '')

  // ── Fetch officers ──────────────────────────────────────────────────────────
  const { data: officers = [] } = useQuery<OfficerOption[]>({
    queryKey: ['callout-officers', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('user_profiles')
        .select('id, full_name, call_sign')
        .eq('organization_id', orgId)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as OfficerOption[]
    },
    enabled: !!orgId && isAdmin,
  })

  // ── Fetch callout shifts ────────────────────────────────────────────────────
  const { data: shifts = [], isLoading, refetch } = useQuery<CalloutShift[]>({
    queryKey: ['callout-shifts', orgId, officerFilter, statusFilter, dateFrom, dateTo, deepLinkPeriodId],
    queryFn: async () => {
      let q = (supabase as any)
        .from('callout_shifts')
        .select(`
          *,
          officer:user_profiles!callout_shifts_officer_id_fkey(id, full_name, call_sign)
        `)
        .eq('organization_id', orgId)
        .order('callout_received_at', { ascending: false })
        .limit(200)

      if (deepLinkPeriodId) q = q.eq('on_call_period_id', deepLinkPeriodId)
      if (officerFilter !== 'all') q = q.eq('officer_id', officerFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom) q = q.gte('callout_received_at', dateFrom)
      if (dateTo) q = q.lte('callout_received_at', dateTo + 'T23:59:59Z')

      // If not admin: only show own callouts
      if (!isAdmin) q = q.eq('officer_id', user?.id)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as CalloutShift[]
    },
    enabled: !!orgId,
  })

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = {
    pending: shifts.filter((s) => s.status === 'pending').length,
    in_progress: shifts.filter((s) => s.status === 'in_progress').length,
    completed: shifts.filter((s) => s.status === 'completed').length,
    cancelled: shifts.filter((s) => s.status === 'cancelled').length,
    totalPay: shifts.reduce((sum, s) => sum + (s.total_pay_amount ?? 0), 0),
  }

  // ── Complete mutation ───────────────────────────────────────────────────────
  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const now = new Date().toISOString()
      const { error } = await (supabase as any)
        .from('callout_shifts')
        .update({ status: 'completed', work_ended_at: now })
        .eq('id', id)
        .eq('organization_id', orgId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Callout shift marked as completed')
      queryClient.invalidateQueries({ queryKey: ['callout-shifts'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to complete'),
  })

  // ── Cancel mutation ─────────────────────────────────────────────────────────
  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('callout_shifts')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('organization_id', orgId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Callout shift cancelled')
      queryClient.invalidateQueries({ queryKey: ['callout-shifts'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to cancel'),
  })

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Siren className="h-6 w-6 text-primary" />
              Callout Shifts
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Ad-hoc shifts triggered from on-call periods (minimum 3-hour pay guarantee)
              {deepLinkPeriodId && (
                <span className="ml-2 text-primary font-medium">
                  — filtered by on-call period
                  <button
                    className="ml-1 underline text-xs"
                    onClick={() => navigate('/callout-shifts')}
                  >
                    Clear
                  </button>
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/on-call-periods')}>
              <PhoneCall className="h-4 w-4 mr-1" /> On-Call Periods
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Pending', value: kpis.pending, icon: Clock, colour: 'text-yellow-600' },
            { label: 'In Progress', value: kpis.in_progress, icon: Siren, colour: 'text-blue-600' },
            { label: 'Completed', value: kpis.completed, icon: CheckCircle, colour: 'text-green-600' },
            { label: 'Cancelled', value: kpis.cancelled, icon: XCircle, colour: 'text-red-600' },
            { label: 'Total Pay', value: `$${kpis.totalPay.toFixed(2)}`, icon: DollarSign, colour: 'text-emerald-600' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold">{value}</p>
                  </div>
                  <Icon className={`h-7 w-7 ${colour} opacity-70`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-end">
              {isAdmin && (
                <div>
                  <Label className="text-xs">Officer</Label>
                  <Select value={officerFilter} onValueChange={setOfficerFilter}>
                    <SelectTrigger className="h-8 text-sm w-44">
                      <SelectValue placeholder="All officers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Officers</SelectItem>
                      {officers.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-sm w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Date From</Label>
                <Input type="date" className="h-8 text-sm w-36" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Date To</Label>
                <Input type="date" className="h-8 text-sm w-36" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setOfficerFilter('all'); setStatusFilter('all'); setDateFrom(''); setDateTo('') }}>
                <Filter className="h-3 w-3 mr-1" /> Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Callout Shifts ({shifts.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : shifts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>No callout shifts found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6" />
                    <TableHead>Officer</TableHead>
                    <TableHead>Callout Received</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actual h</TableHead>
                    <TableHead className="text-right">Billable h</TableHead>
                    <TableHead className="text-right">Pay</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shifts.map((s) => {
                    const isExpanded = expandedId === s.id
                    const canComplete = isAdmin && s.status === 'in_progress'
                    const canCancel = isAdmin && ['pending', 'in_progress'].includes(s.status)
                    return (
                      <>
                        <TableRow
                          key={s.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setExpandedId(isExpanded ? null : s.id)}
                        >
                          <TableCell>
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            }
                          </TableCell>
                          <TableCell>
                            <span className="text-sm font-medium">{s.officer?.full_name ?? s.officer_id.slice(0, 8)}</span>
                            {s.officer?.call_sign && <span className="text-xs text-muted-foreground ml-1">({s.officer.call_sign})</span>}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(parseISO(s.callout_received_at), 'dd MMM HH:mm')}
                          </TableCell>
                          <TableCell className="text-sm max-w-[180px] truncate">
                            {s.callout_address
                              ? <><MapPin className="h-3 w-3 inline mr-1 text-muted-foreground" />{s.callout_address}</>
                              : <span className="text-muted-foreground">—</span>
                            }
                          </TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLOURS[s.status] ?? ''}>{s.status.replace('_', ' ')}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm">{fmtHours(s.actual_work_hours)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{fmtHours(s.billable_hours)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{fmtMoney(s.total_pay_amount)}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-1">
                              {canComplete && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => completeMutation.mutate(s.id)}
                                  disabled={completeMutation.isPending}
                                >
                                  Complete
                                </Button>
                              )}
                              {canCancel && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs text-red-600 hover:text-red-700"
                                  onClick={() => cancelMutation.mutate(s.id)}
                                  disabled={cancelMutation.isPending}
                                >
                                  Cancel
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => navigate(`/travel-allowances?callout_shift_id=${s.id}`)}
                              >
                                <Car className="h-3 w-3 mr-1" /> Travel
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <TableRow key={`${s.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={9}>
                              <div className="py-3 px-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div>
                                  <p className="text-xs text-muted-foreground mb-1 font-medium">Timeline</p>
                                  <div className="space-y-0.5">
                                    <div className="flex gap-2"><span className="text-muted-foreground w-28">Callout received</span><span>{fmtTime(s.callout_received_at)}</span></div>
                                    <div className="flex gap-2"><span className="text-muted-foreground w-28">Departed</span><span>{fmtTime(s.departed_at)}</span></div>
                                    <div className="flex gap-2"><span className="text-muted-foreground w-28">Arrived</span><span>{fmtTime(s.arrived_at)}</span></div>
                                    <div className="flex gap-2"><span className="text-muted-foreground w-28">Work started</span><span>{fmtTime(s.work_started_at)}</span></div>
                                    <div className="flex gap-2"><span className="text-muted-foreground w-28">Work ended</span><span>{fmtTime(s.work_ended_at)}</span></div>
                                    <div className="flex gap-2"><span className="text-muted-foreground w-28">Returned</span><span>{fmtTime(s.returned_at)}</span></div>
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground mb-1 font-medium">Pay Breakdown</p>
                                  <div className="space-y-0.5">
                                    <div className="flex gap-2"><span className="text-muted-foreground w-32">Actual hours</span><span>{fmtHours(s.actual_work_hours)}</span></div>
                                    <div className="flex gap-2"><span className="text-muted-foreground w-32">Min hours (rule)</span><span>{fmtHours(s.minimum_hours)}</span></div>
                                    <div className="flex gap-2"><span className="text-muted-foreground w-32">Billable hours</span><span className="font-medium">{fmtHours(s.billable_hours)}</span></div>
                                    <div className="flex gap-2"><span className="text-muted-foreground w-32">Hourly rate</span><span>{s.callout_hourly_rate != null ? `$${Number(s.callout_hourly_rate).toFixed(2)}/h` : '—'}</span></div>
                                    <div className="flex gap-2"><span className="text-muted-foreground w-32">Base pay</span><span>{fmtMoney(s.base_pay_amount)}</span></div>
                                    <div className="flex gap-2"><span className="text-muted-foreground w-32">Additional pay</span><span>{fmtMoney(s.additional_pay_amount)}</span></div>
                                    <div className="flex gap-2 border-t pt-0.5 mt-0.5"><span className="text-muted-foreground w-32">Total pay</span><span className="font-bold">{fmtMoney(s.total_pay_amount)}</span></div>
                                  </div>
                                </div>
                                {s.callout_reason && (
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-1 font-medium">Reason</p>
                                    <p>{s.callout_reason}</p>
                                  </div>
                                )}
                                {(s.notes || s.admin_notes) && (
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-1 font-medium">Notes</p>
                                    {s.notes && <p>{s.notes}</p>}
                                    {s.admin_notes && <p className="text-muted-foreground text-xs mt-1">{s.admin_notes}</p>}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
