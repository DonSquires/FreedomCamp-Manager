/**
 * EmsAttendanceLog — B-83
 *
 * Admin log viewer and approval manager for ems_attendances.
 *
 * Features:
 *  - KPI cards: Total / Pending / Approved / Total Billable Hours
 *  - Filters: status select, date-range, free-text (action / attendance_address / offender_ref)
 *  - Table: officer_id (UUID prefix), action, status badge, attendance_date,
 *           billable_hours, travel_km, attendance_address
 *  - Expandable row: notes, admin_notes, device info, district, start/end time, rate
 *  - Approve action (status → 'approved', approved_at = now()) for pending/submitted records
 *
 * Route: /ems-attendances-log — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Zap, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, Clock,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import type { Database } from '@/types/database'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type EmsAttendance = Database['public']['Tables']['ems_attendances']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function statusBadge(status: string) {
  switch (status) {
    case 'approved':   return <Badge variant="secondary" className="text-xs text-green-700">Approved</Badge>
    case 'pending':    return <Badge variant="outline" className="text-xs text-amber-700">Pending</Badge>
    case 'submitted':  return <Badge variant="outline" className="text-xs text-blue-700">Submitted</Badge>
    case 'rejected':   return <Badge variant="destructive" className="text-xs">Rejected</Badge>
    default:           return <Badge variant="outline" className="text-xs">{status}</Badge>
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmsAttendanceLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]         = useState('')
  const [statusFilter, setStatus]   = useState('all')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data: records = [], isLoading, refetch } = useQuery({
    queryKey: ['ems-attendances-log', orgId, statusFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('ems_attendances')
        .select('*')
        .eq('organization_id', orgId!)
        .order('attendance_date', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom) q = q.gte('attendance_date', dateFrom)
      if (dateTo)   q = q.lte('attendance_date', dateTo)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as EmsAttendance[]
    },
  })

  // ── Approve mutation ───────────────────────────────────────────────────────

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ems_attendances')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ems-attendances-log'] })
      toast.success('Attendance approved')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to approve'),
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const totalBillable = records.reduce((s, r) => s + (r.billable_hours ?? 0), 0)
  const kpis = {
    total:    records.length,
    pending:  records.filter(r => r.status === 'pending' || r.status === 'submitted').length,
    approved: records.filter(r => r.status === 'approved').length,
    billable: totalBillable,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = records.filter(r => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !r.action?.toLowerCase().includes(q) &&
        !r.attendance_address?.toLowerCase().includes(q) &&
        !r.offender_ref?.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="EMS Attendance Log" description="Review and approve EMS attendance records">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-red-600" />
          <span className="font-semibold text-lg">EMS Attendance Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',          value: kpis.total,    icon: <Zap className="h-4 w-4" />,            color: 'text-foreground',  suffix: '' },
          { label: 'Pending',        value: kpis.pending,  icon: <Clock className="h-4 w-4" />,          color: 'text-amber-600',   suffix: '' },
          { label: 'Approved',       value: kpis.approved, icon: <CheckCircle2 className="h-4 w-4" />,   color: 'text-green-600',   suffix: '' },
          { label: 'Billable Hours', value: kpis.billable, icon: <Clock className="h-4 w-4" />,          color: 'text-blue-600',    suffix: ' h' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{typeof k.value === 'number' && k.suffix ? k.value.toFixed(1) : k.value}{k.suffix}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search action, address, offender ref…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && records.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No EMS attendance records found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Officer</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Billable h</TableHead>
              <TableHead>Travel km</TableHead>
              <TableHead>Address</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && records.length > 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No records match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(r => {
              const expanded = expandedId === r.id
              const canApprove = r.status === 'pending' || r.status === 'submitted'
              return [
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : r.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.officer_id.slice(0, 8)}…
                  </TableCell>
                  <TableCell className="text-sm max-w-36 truncate">{r.action}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(r.attendance_date)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground text-right">
                    {r.billable_hours != null ? r.billable_hours.toFixed(1) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground text-right">
                    {r.travel_km != null ? r.travel_km.toFixed(1) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-40 truncate">
                    {r.attendance_address ?? '—'}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    {canApprove && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-green-700 hover:text-green-800 h-7 text-xs"
                        onClick={() => approve.mutate(r.id)}
                        disabled={approve.isPending}
                      >
                        {approve.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${r.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={8} className="py-3 space-y-2 text-sm">
                      {r.notes && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</span>
                          <p className="mt-0.5">{r.notes}</p>
                        </div>
                      )}
                      {r.admin_notes && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Admin Notes</span>
                          <p className="mt-0.5">{r.admin_notes}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        {r.district && <span>District: {r.district}</span>}
                        {r.start_time && <span>Start: {r.start_time}</span>}
                        {r.end_time && <span>End: {r.end_time}</span>}
                        {r.device_type && <span>Device: {r.device_type}{r.device_serial ? ` (${r.device_serial})` : ''}</span>}
                        {r.rate_per_hour != null && <span>Rate: ${r.rate_per_hour}/h</span>}
                        {r.travel_rate_per_km != null && <span>Travel rate: ${r.travel_rate_per_km}/km</span>}
                        {r.offender_ref && <span>Offender ref: {r.offender_ref}</span>}
                        {r.approved_at && <span>Approved: {fmtDate(r.approved_at)}</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ),
              ]
            })}
          </TableBody>
        </Table>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {records.length} records
        </p>
      )}
    </AppLayout>
  )
}
