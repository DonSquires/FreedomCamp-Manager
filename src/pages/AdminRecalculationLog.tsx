/**
 * AdminRecalculationLog — B-142
 *
 * Admin audit log for admin_recalculation_actions.
 * Surfaces each compliance recalculation run: scope, status, duration, observations
 * processed, compliance changes, drift events created, and any error messages.
 *
 * Route: /admin-recalculation-log — admin/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { RefreshCw, AlertCircle, Loader2, RotateCcw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

type RecalcRow = Database['public']['Tables']['admin_recalculation_actions']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDuration(seconds: number | null) {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

const STATUS_COLOURS: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-800',
  running:    'bg-blue-100 text-blue-800',
  completed:  'bg-green-100 text-green-800',
  failed:     'bg-rose-100 text-rose-800',
  cancelled:  'bg-gray-100 text-gray-700',
}

export default function AdminRecalculationLog() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [scopeFilter, setScopeFilter]   = useState<string>('all')
  const [dateFrom, setDateFrom]         = useState('')
  const [expanded, setExpanded]         = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<RecalcRow[]>({
    queryKey: ['admin-recalculation-log', statusFilter, scopeFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('admin_recalculation_actions')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (scopeFilter !== 'all')  q = q.eq('scope_type', scopeFilter)
      if (dateFrom)               q = q.gte('started_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const completed     = rows.filter(r => r.status === 'completed').length
  const failed        = rows.filter(r => r.status === 'failed').length
  const totalObs      = rows.reduce((a, r) => a + (r.observations_processed ?? 0), 0)
  const totalChanged  = rows.reduce((a, r) => a + (r.compliance_changed ?? 0), 0)

  const statuses  = ['all', ...Array.from(new Set(rows.map(r => r.status)))]
  const scopes    = ['all', ...Array.from(new Set(rows.map(r => r.scope_type)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RotateCcw className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Admin Recalculation Log</h1>
              <p className="text-sm text-muted-foreground">Audit trail of all compliance recalculation runs with scope, duration, and outcomes</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Runs',              value: rows.length,                colour: 'text-gray-700' },
            { label: 'Completed',               value: completed,                  colour: 'text-green-700' },
            { label: 'Failed',                  value: failed,                     colour: 'text-rose-700' },
            { label: 'Observations Processed',  value: totalObs.toLocaleString(),  colour: 'text-sky-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>{statuses.map(s => <SelectItem key={s} value={s}>{s === 'all' ? 'All statuses' : s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Scope type" /></SelectTrigger>
            <SelectContent>{scopes.map(s => <SelectItem key={s} value={s}>{s === 'all' ? 'All scopes' : s}</SelectItem>)}</SelectContent>
          </Select>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border rounded px-3 py-1 text-sm w-40 bg-background"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No recalculation runs found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started At</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Obs. Processed</TableHead>
                  <TableHead>Compliance Δ</TableHead>
                  <TableHead>Drift Events</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.started_at)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{row.scope_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLOURS[row.status] ?? 'bg-gray-100 text-gray-700'}`}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{fmtDuration(row.duration_seconds)}</TableCell>
                      <TableCell className="text-sm">{row.observations_processed?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-sm text-amber-700">{row.compliance_changed?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-sm text-indigo-700">{row.drift_events_created?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Performed by:</span> {row.performed_by}</div>
                            <div><span className="font-medium">Started:</span> {fmtDate(row.started_at)}</div>
                            <div><span className="font-medium">Completed:</span> {fmtDate(row.completed_at)}</div>
                            <div><span className="font-medium">Date range:</span> {row.date_range_start ?? '—'} → {row.date_range_end ?? '—'}</div>
                          </div>
                          {row.target_org_ids?.length > 0 && (
                            <div><span className="font-medium">Target orgs:</span> {row.target_org_ids.join(', ')}</div>
                          )}
                          {row.target_zone_ids?.length > 0 && (
                            <div><span className="font-medium">Target zones:</span> {row.target_zone_ids.join(', ')}</div>
                          )}
                          {row.error_message && (
                            <div className="text-rose-700"><span className="font-medium">Error:</span> {row.error_message}</div>
                          )}
                          <div><span className="font-medium">Compliance changed:</span> {row.compliance_changed?.toLocaleString() ?? '—'} &nbsp; <span className="font-medium">Drift events:</span> {row.drift_events_created?.toLocaleString() ?? '—'}</div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            Showing {rows.length} run{rows.length !== 1 ? 's' : ''} · {totalObs.toLocaleString()} total observations · {totalChanged.toLocaleString()} compliance changes
          </p>
        )}
      </div>
    </AppLayout>
  )
}
