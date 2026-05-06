/**
 * EmsAttendanceLog — B-83
 *
 * Log viewer for ems_attendances with Approve action.
 *
 * Features:
 *  - KPI cards: Total / Pending / Approved / Billable Hours
 *  - Filters: status, date range
 *  - Table: officer_id, action, status, attendance_date, billable_hours, district
 *  - Expandable row: start/end time, address, notes, travel_km, device_type
 *  - Approve inline action (sets status = 'approved', approved_at = now())
 *
 * Route: /ems-attendances-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Stethoscope, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import type { Database } from '@/types/database'

// ─── Types ─────────────────────────────────────────────────────────────────────

type EmsAttendance = Database['public']['Tables']['ems_attendances']['Row']

// ─── Styling maps ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending:  { label: 'Pending',  className: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800' },
  submitted:{ label: 'Submitted',className: 'bg-blue-100 text-blue-800' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function fmtTime(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmsAttendanceLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom]         = useState('')
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<EmsAttendance[]>({
    queryKey: ['ems-attendances-log', orgId, statusFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('ems_attendances')
        .select('*')
        .eq('organization_id', orgId!)
        .order('attendance_date', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom)               q = q.gte('attendance_date', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total        = rows.length
  const pending      = rows.filter(r => r.status === 'pending' || r.status === 'submitted').length
  const approved     = rows.filter(r => r.status === 'approved').length
  const billableHrs  = rows.reduce((sum, r) => sum + (r.billable_hours ?? 0), 0)

  // ── Mutation ──────────────────────────────────────────────────────────────

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ems_attendances')
        .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: user?.id })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Attendance approved')
      qc.invalidateQueries({ queryKey: ['ems-attendances-log'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Stethoscope className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">EMS Attendance Log</h1>
              <p className="text-sm text-muted-foreground">EMS attendance records and approvals</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total',         value: total,                     colour: 'text-gray-700' },
            { label: 'Pending',       value: pending,                   colour: 'text-yellow-700' },
            { label: 'Approved',      value: approved,                  colour: 'text-green-700' },
            { label: 'Billable Hrs',  value: billableHrs.toFixed(1),    colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_STYLES).map(([v, s]) => <SelectItem key={v} value={v}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No EMS attendances found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Officer</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Billable Hrs</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const statusStyle = STATUS_STYLES[row.status] ?? { label: row.status, className: 'bg-gray-100 text-gray-600' }
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-sm">{row.action}</TableCell>
                        <TableCell><Badge className={statusStyle.className}>{statusStyle.label}</Badge></TableCell>
                        <TableCell className="text-sm">{fmtDate(row.attendance_date)}</TableCell>
                        <TableCell className="text-sm">{row.billable_hours ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.district ?? '—'}</TableCell>
                        <TableCell className="text-right">
                          {row.status !== 'approved' && (
                            <Button
                              size="sm" variant="outline"
                              disabled={approve.isPending}
                              onClick={e => { e.stopPropagation(); approve.mutate(row.id) }}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">Start Time</p>
                                <p className="text-muted-foreground">{fmtTime(row.start_time)}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">End Time</p>
                                <p className="text-muted-foreground">{fmtTime(row.end_time)}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Travel KM</p>
                                <p className="text-muted-foreground">{row.travel_km ?? '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Device Type</p>
                                <p className="text-muted-foreground">{row.device_type ?? '—'}</p>
                              </div>
                              <div className="col-span-2">
                                <p className="font-medium mb-1">Address</p>
                                <p className="text-muted-foreground">{row.attendance_address ?? '—'}</p>
                              </div>
                              <div className="col-span-2">
                                <p className="font-medium mb-1">Notes</p>
                                <p className="text-muted-foreground">{row.notes ?? 'None'}</p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
