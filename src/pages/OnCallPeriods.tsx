/**
 * OnCallPeriods — B-51
 *
 * On-call rostering management page. Allows admins to schedule on-call periods
 * for officers and officers to accept or view their upcoming on-call shifts.
 *
 * Features:
 *  - KPI cards: Scheduled / Active / Completed / Cancelled counts
 *  - Officer filter, period-type filter, date range
 *  - Table: officer, period type, start/end times, status, callout count
 *  - Actions: Schedule new, Cancel, Accept (for officer)
 *  - Callout count links to /callout-shifts?on_call_period_id=<id>
 *
 * Route: /on-call-periods  — admin/admin_officer/master/officer
 * Note: on_call_periods not in database.ts snapshot — uses (supabase as any)
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Calendar, Clock, User, RefreshCw, Plus, CheckCircle,
  XCircle, AlertCircle, Loader2, Filter, PhoneCall,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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

interface OnCallPeriod {
  id: string
  organization_id: string
  officer_id: string
  officer?: OfficerOption
  start_time: string
  end_time: string
  period_type: string
  status: string
  officer_accepted: boolean | null
  officer_accepted_at: string | null
  callout_count: number
  total_callout_hours: number
  on_call_pay_amount: number | null
  callout_pay_amount: number | null
  total_pay_amount: number | null
  flat_rate_amount: number | null
  hourly_rate_amount: number | null
  notes: string | null
  created_at: string
}

interface NewPeriodForm {
  officer_id: string
  start_time: string
  end_time: string
  period_type: string
  flat_rate_amount: string
  notes: string
}

const PERIOD_TYPE_LABELS: Record<string, string> = {
  standard: 'Standard',
  before_shift: 'Before Shift',
  after_shift: 'After Shift',
  overnight: 'Overnight',
  weekend: 'Weekend',
  public_holiday: 'Public Holiday',
}

const STATUS_COLOURS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-800',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function OnCallPeriods() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const role = user?.role
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [officerFilter, setOfficerFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showSchedule, setShowSchedule] = useState(false)
  const [form, setForm] = useState<NewPeriodForm>({
    officer_id: '',
    start_time: '',
    end_time: '',
    period_type: 'standard',
    flat_rate_amount: '',
    notes: '',
  })

  const isAdmin = ['admin', 'admin_officer', 'master', 'grand_master'].includes(role || '')

  // ── Fetch officers ──────────────────────────────────────────────────────────
  const { data: officers = [] } = useQuery<OfficerOption[]>({
    queryKey: ['on-call-officers', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('user_profiles')
        .select('id, full_name, call_sign')
        .eq('organization_id', orgId)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as OfficerOption[]
    },
    enabled: !!orgId,
  })

  // ── Fetch on-call periods ───────────────────────────────────────────────────
  const { data: periods = [], isLoading, refetch } = useQuery<OnCallPeriod[]>({
    queryKey: ['on-call-periods', orgId, officerFilter, statusFilter, typeFilter, dateFrom, dateTo],
    queryFn: async () => {
      let q = (supabase as any)
        .from('on_call_periods')
        .select(`
          *,
          officer:user_profiles!on_call_periods_officer_id_fkey(id, full_name, call_sign)
        `)
        .eq('organization_id', orgId)
        .order('start_time', { ascending: false })
        .limit(200)

      if (officerFilter !== 'all') q = q.eq('officer_id', officerFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all') q = q.eq('period_type', typeFilter)
      if (dateFrom) q = q.gte('start_time', dateFrom)
      if (dateTo) q = q.lte('end_time', dateTo + 'T23:59:59Z')

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as OnCallPeriod[]
    },
    enabled: !!orgId,
  })

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = {
    scheduled: periods.filter((p) => p.status === 'scheduled').length,
    active: periods.filter((p) => p.status === 'active').length,
    completed: periods.filter((p) => p.status === 'completed').length,
    cancelled: periods.filter((p) => p.status === 'cancelled').length,
  }

  // ── Schedule mutation ───────────────────────────────────────────────────────
  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, any> = {
        organization_id: orgId,
        officer_id: form.officer_id,
        start_time: new Date(form.start_time).toISOString(),
        end_time: new Date(form.end_time).toISOString(),
        period_type: form.period_type,
        status: 'scheduled',
        notes: form.notes || null,
      }
      if (form.flat_rate_amount) payload.flat_rate_amount = parseFloat(form.flat_rate_amount)
      const { error } = await (supabase as any).from('on_call_periods').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('On-call period scheduled')
      setShowSchedule(false)
      setForm({ officer_id: '', start_time: '', end_time: '', period_type: 'standard', flat_rate_amount: '', notes: '' })
      queryClient.invalidateQueries({ queryKey: ['on-call-periods'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to schedule period'),
  })

  // ── Cancel mutation ─────────────────────────────────────────────────────────
  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('on_call_periods')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('organization_id', orgId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('On-call period cancelled')
      queryClient.invalidateQueries({ queryKey: ['on-call-periods'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to cancel'),
  })

  // ── Accept mutation (officer) ───────────────────────────────────────────────
  const acceptMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('on_call_periods')
        .update({ officer_accepted: true, officer_accepted_at: new Date().toISOString() })
        .eq('id', id)
        .eq('officer_id', user?.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('On-call period accepted')
      queryClient.invalidateQueries({ queryKey: ['on-call-periods'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to accept'),
  })

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <PhoneCall className="h-6 w-6 text-primary" />
              On-Call Periods
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage on-call rostering periods and callout availability
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => setShowSchedule(true)}>
                <Plus className="h-4 w-4 mr-1" /> Schedule On-Call
              </Button>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Scheduled', value: kpis.scheduled, icon: Calendar, colour: 'text-blue-600' },
            { label: 'Active', value: kpis.active, icon: CheckCircle, colour: 'text-green-600' },
            { label: 'Completed', value: kpis.completed, icon: Clock, colour: 'text-gray-600' },
            { label: 'Cancelled', value: kpis.cancelled, icon: XCircle, colour: 'text-red-600' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="text-2xl font-bold">{value}</p>
                  </div>
                  <Icon className={`h-8 w-8 ${colour} opacity-70`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {isAdmin && (
                <div>
                  <Label className="text-xs">Officer</Label>
                  <Select value={officerFilter} onValueChange={setOfficerFilter}>
                    <SelectTrigger className="h-8 text-sm">
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
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Period Type</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {Object.entries(PERIOD_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Date From</Label>
                <Input type="date" className="h-8 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Date To</Label>
                <Input type="date" className="h-8 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button variant="ghost" size="sm" onClick={() => { setOfficerFilter('all'); setStatusFilter('all'); setTypeFilter('all'); setDateFrom(''); setDateTo('') }}>
                  <Filter className="h-3 w-3 mr-1" /> Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">On-Call Periods ({periods.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : periods.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>No on-call periods found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Officer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Accepted</TableHead>
                    <TableHead className="text-right">Callouts</TableHead>
                    <TableHead className="text-right">Total Pay</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periods.map((p) => {
                    const canAccept = !isAdmin && p.officer_id === user?.id && p.status === 'scheduled' && !p.officer_accepted
                    const canCancel = isAdmin && ['scheduled', 'active'].includes(p.status)
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-medium">{p.officer?.full_name ?? p.officer_id.slice(0, 8)}</span>
                          </div>
                          {p.officer?.call_sign && (
                            <span className="text-xs text-muted-foreground ml-5">{p.officer.call_sign}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{PERIOD_TYPE_LABELS[p.period_type] ?? p.period_type}</span>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {format(parseISO(p.start_time), 'dd MMM yyyy HH:mm')}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {format(parseISO(p.end_time), 'dd MMM yyyy HH:mm')}
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLOURS[p.status] ?? ''}>
                            {p.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {p.officer_accepted === true ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : p.officer_accepted === false ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : (
                            <span className="text-xs text-muted-foreground">Pending</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.callout_count > 0 ? (
                            <button
                              className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                              onClick={() => navigate(`/callout-shifts?on_call_period_id=${p.id}`)}
                            >
                              {p.callout_count}
                            </button>
                          ) : (
                            <span className="text-sm text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {p.total_pay_amount != null ? `$${Number(p.total_pay_amount).toFixed(2)}` : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {canAccept && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => acceptMutation.mutate(p.id)}
                                disabled={acceptMutation.isPending}
                              >
                                Accept
                              </Button>
                            )}
                            {canCancel && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-red-600 hover:text-red-700"
                                onClick={() => cancelMutation.mutate(p.id)}
                                disabled={cancelMutation.isPending}
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Schedule Dialog */}
      <Dialog open={showSchedule} onOpenChange={setShowSchedule}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule On-Call Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Officer *</Label>
              <Select value={form.officer_id} onValueChange={(v) => setForm({ ...form, officer_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select officer" />
                </SelectTrigger>
                <SelectContent>
                  {officers.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Time *</Label>
                <Input type="datetime-local" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              </div>
              <div>
                <Label>End Time *</Label>
                <Input type="datetime-local" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Period Type</Label>
              <Select value={form.period_type} onValueChange={(v) => setForm({ ...form, period_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PERIOD_TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Flat Rate (NZD, optional)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 45.00"
                value={form.flat_rate_amount}
                onChange={(e) => setForm({ ...form, flat_rate_amount: e.target.value })}
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Input placeholder="Optional notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSchedule(false)}>Cancel</Button>
            <Button
              onClick={() => scheduleMutation.mutate()}
              disabled={!form.officer_id || !form.start_time || !form.end_time || scheduleMutation.isPending}
            >
              {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
