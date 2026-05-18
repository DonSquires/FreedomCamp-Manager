import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Gavel, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
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

type EnforcementActionRow = Database['public']['Tables']['enforcement_actions']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLOURS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  assigned: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-cyan-100 text-cyan-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-700',
}

function statusBadge(status: string | null) {
  return STATUS_COLOURS[status?.toLowerCase() ?? ''] ?? 'bg-gray-100 text-gray-700'
}

function csvEscape(value: unknown) {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export default function EnforcementActionLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [actionTypeFilter, setActionTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<EnforcementActionRow[]>({
    queryKey: ['enforcement-actions-log', orgId, searchQuery, statusFilter, actionTypeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('enforcement_actions')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (actionTypeFilter !== 'all') q = q.eq('action_type', actionTypeFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (searchQuery.trim()) {
        const term = searchQuery.trim()
        q = q.or(`plate_number.ilike.%${term}%,notes.ilike.%${term}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const pendingCount = rows.filter(r => r.status === 'pending').length
  const completedCount = rows.filter(r => r.status === 'completed').length
  const assignedCount = rows.filter(r => !!r.assigned_to).length
  const actionTypes = [...new Set(rows.map(r => r.action_type).filter(Boolean))].sort()
  const statuses = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()

  const toggleExpanded = (rowId: string) => {
    setExpanded(expanded === rowId ? null : rowId)
  }

  const exportCsv = () => {
    if (rows.length === 0) return
    const headers = ['Action Type', 'Status', 'Plate', 'Assigned To', 'Observation', 'Created At']
    const lines = rows.map((row) => [
      row.action_type,
      row.status,
      row.plate_number,
      row.assigned_to,
      row.observation_id,
      row.created_at,
    ].map(csvEscape).join(','))

    const csv = [headers.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `enforcement-action-log-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <GlobalFilterRibbon />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gavel className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Enforcement Action Log</h1>
              <p className="text-sm text-muted-foreground">All enforcement actions with assignment, completion, and linked observation metadata</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" className="bg-[#D32F2F] hover:bg-[#B71C1C] text-white" onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
        </div>

        <div className="grid gap-2 rounded-lg border border-gray-200 p-3 text-xs dark:border-[#9E9E9E]/20 md:grid-cols-4">
          <div><span className="font-semibold text-gray-700 dark:text-gray-200">Normal:</span> Completed {completedCount}</div>
          <div><span className="font-semibold text-amber-700 dark:text-amber-300">Watch:</span> Pending {pendingCount}</div>
          <div><span className="font-semibold text-orange-700 dark:text-orange-300">Action:</span> Assigned {assignedCount}</div>
          <div><span className="font-semibold text-red-700 dark:text-red-300">Critical:</span> In progress {rows.filter(r => r.status === 'in_progress').length}</div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Actions', value: rows.length, colour: 'text-gray-700' },
            { label: 'Pending', value: pendingCount, colour: 'text-amber-700' },
            { label: 'Completed', value: completedCount, colour: 'text-green-700' },
            { label: 'Assigned', value: assignedCount, colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            aria-label="Search by plate or notes"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search plate or notes…"
            className="w-56"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" aria-label="Filter by status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={actionTypeFilter} onValueChange={setActionTypeFilter}>
            <SelectTrigger className="w-48" aria-label="Filter by action type"><SelectValue placeholder="Action type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All action types</SelectItem>
              {actionTypes.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input aria-label="Filter from created date" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-3">
            <AlertCircle className="h-8 w-8" />
            <p>No enforcement actions match the active filters.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery('')
                setStatusFilter('all')
                setActionTypeFilter('all')
                setDateFrom('')
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Observation</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="hover:bg-muted/40">
                      <TableCell className="text-sm">{row.action_type ?? '—'}</TableCell>
                      <TableCell><Badge className={statusBadge(row.status)}>{row.status ?? '—'}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{row.plate_number ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.assigned_to ? `${row.assigned_to.slice(0, 8)}…` : '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.observation_id ? `${row.observation_id.slice(0, 8)}…` : '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-sky-700"
                          aria-expanded={expanded === row.id}
                          aria-controls={`enforcement-action-detail-${row.id}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleExpanded(row.id)
                          }}
                        >
                          {expanded === row.id ? 'Hide details' : 'Show details'}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow id={`enforcement-action-detail-${row.id}`} className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Action ID:</span> {row.id}</div>
                          <div><span className="font-medium">Zone:</span> {row.zone_id ?? '—'} &nbsp; <span className="font-medium">Breach status:</span> {row.breach_status ?? '—'}</div>
                          <div><span className="font-medium">Observation:</span> {row.observation_id ?? '—'} &nbsp; <span className="font-medium">Vehicle record:</span> {row.vehicle_record_id ?? '—'}</div>
                          <div><span className="font-medium">Compliance result:</span> {row.compliance_result_id ?? '—'}</div>
                          <div><span className="font-medium">Assigned by:</span> {row.assigned_by ?? '—'} at {fmtDate(row.assigned_at)}</div>
                          <div><span className="font-medium">Completed by:</span> {row.completed_by ?? '—'} at {fmtDate(row.completed_at)}</div>
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                          {row.completion_notes && <div><span className="font-medium">Completion notes:</span> {row.completion_notes}</div>}
                          {row.completion_outcome && <div><span className="font-medium">Outcome:</span> {row.completion_outcome}</div>}
                          <div><span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-[#9E9E9E]/20 dark:bg-[#1E1E1E] dark:text-gray-300">
            Audit trace: {rows.length > 0 ? `latest record update ${fmtDate(rows[0]?.updated_at ?? rows[0]?.created_at ?? null)}` : 'no records available'}.
          </div>
        )}
      </div>
    </AppLayout>
  )
}
