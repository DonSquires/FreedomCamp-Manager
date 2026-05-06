/**
 * EmsAttendanceLog — B-83
 * Log of ems_attendances — officer attendance records for EMS shifts.
 * Route: /ems-attendances-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Activity, Search, RefreshCw, AlertCircle, Loader2,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type EmsAttendanceRow = Database['public']['Tables']['ems_attendances']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLOURS: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function EmsAttendanceLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]           = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterAction, setFilterAction] = useState('all')
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: events = [], isLoading, error, refetch } = useQuery<EmsAttendanceRow[]>({
    queryKey: ['ems-attendances', orgId],
    queryFn: async () => {
      let q = supabase
        .from('ems_attendances')
        .select('*')
        .order('attendance_date', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = events.filter(e => {
    if (filterStatus !== 'all' && e.status !== filterStatus) return false
    if (filterAction !== 'all' && e.action !== filterAction) return false
    if (filterMonth  !== 'all' && e.attendance_date?.substring(0, 7) !== filterMonth) return false
    if (search) {
      const s = search.toLowerCase()
      return e.officer_id?.toLowerCase().includes(s)
    }
    return true
  })

  const total           = events.length
  const pending         = events.filter(e => e.status === 'pending').length
  const approved        = events.filter(e => e.status === 'approved').length
  const billableVals    = events.map(e => e.billable_hours).filter(v => v != null) as number[]
  const totalBillable   = billableVals.reduce((a, b) => a + b, 0).toFixed(1)

  const actions = Array.from(new Set(events.map(e => e.action).filter(Boolean)))
  const months  = Array.from(new Set(events.map(e => e.attendance_date?.substring(0, 7)).filter(Boolean))).sort().reverse()

  // ── Mutation ──────────────────────────────────────────────────────────────

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ems_attendances')
        .update({
          approved_at: new Date().toISOString(),
          approved_by: user?.id,
          status: 'approved',
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ems-attendances'] }); toast.success('Attendance approved') },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Activity className="h-7 w-7 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">EMS Attendance Log</h1>
              <p className="text-sm text-muted-foreground">Officer attendance records for EMS shifts</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total',           value: total,         colour: 'text-slate-600' },
            { label: 'Pending',         value: pending,       colour: pending > 0 ? 'text-yellow-600' : 'text-muted-foreground' },
            { label: 'Approved',        value: approved,      colour: 'text-green-600' },
            { label: 'Billable Hrs',    value: totalBillable, colour: 'text-blue-600' },
          ].map(({ label, value, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <span className={`text-2xl font-bold ${colour}`}>{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Officer ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {['pending', 'approved', 'rejected'].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {actions.length > 0 && (
            <Select value={filterAction} onValueChange={setFilterAction}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {actions.map(a => (
                  <SelectItem key={a} value={a} className="capitalize">{a?.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {months.length > 0 && (
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {months.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No EMS attendances match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Officer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Billable Hrs</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Approved At</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => (
                    <TableRow key={e.id} className="hover:bg-muted/40">
                      <TableCell className="text-sm whitespace-nowrap">{e.attendance_date ?? '—'}</TableCell>
                      <TableCell className="text-sm capitalize">{e.action?.replace(/_/g, ' ') ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{e.officer_id ? e.officer_id.substring(0, 8) + '…' : '—'}</TableCell>
                      <TableCell>
                        <Badge className={`capitalize ${STATUS_COLOURS[e.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                          {e.status ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {e.start_time ?? '—'} – {e.end_time ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm">{e.billable_hours != null ? e.billable_hours : '—'}</TableCell>
                      <TableCell className="text-sm">{e.device_type ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(e.approved_at)}</TableCell>
                      <TableCell onClick={ev => ev.stopPropagation()}>
                        {e.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs px-2"
                            disabled={approve.isPending}
                            onClick={() => approve.mutate(e.id)}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Approve
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
