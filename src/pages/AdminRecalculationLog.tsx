/**
 * AdminRecalculationLog — B-142
 *
 * Admin log and viewer for admin_recalculation_actions.
 * Displays recalculation runs, scope coverage, throughput, drift impact,
 * and failure detail for historic admin recalculation actions.
 *
 * Route: /admin-recalculation-log — admin/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { RefreshCw, AlertCircle, Loader2, RotateCw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
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

type RecalcRow = Database['public']['Tables']['admin_recalculation_actions']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLOURS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-rose-100 text-rose-800',
  processing: 'bg-sky-100 text-sky-800',
  running: 'bg-sky-100 text-sky-800',
  pending: 'bg-amber-100 text-amber-800',
}

export default function AdminRecalculationLog() {
  const [actorQuery, setActorQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<RecalcRow[]>({
    queryKey: ['admin-recalculation-log', actorQuery, statusFilter, scopeFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('admin_recalculation_actions')
        .select('*')
        .order('started_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (actorQuery.trim()) q = q.ilike('performed_by', `%${actorQuery.trim()}%`)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (scopeFilter !== 'all') q = q.eq('scope_type', scopeFilter)
      if (dateFrom) q = q.gte('started_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const completed = rows.filter(row => row.status === 'completed').length
  const failed = rows.filter(row => row.status === 'failed').length
  const processed = rows.reduce((acc, row) => acc + (row.observations_processed ?? 0), 0)
  const driftEvents = rows.reduce((acc, row) => acc + (row.drift_events_created ?? 0), 0)
  const scopeTypes = [...new Set(rows.map(row => row.scope_type).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RotateCw className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Admin Recalculation Log</h1>
              <p className="text-sm text-muted-foreground">Historic recalculation actions with throughput, scope coverage, and drift-impact metrics</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Runs', value: rows.length, colour: 'text-gray-700' },
            { label: 'Completed', value: completed, colour: 'text-emerald-700' },
            { label: 'Failed', value: failed, colour: 'text-rose-700' },
            { label: 'Drift Events Created', value: driftEvents.toLocaleString(), colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={actorQuery} onChange={e => setActorQuery(e.target.value)} placeholder="Search performed by…" className="w-56" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Scope type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scopes</SelectItem>
              {scopeTypes.map(scope => <SelectItem key={scope} value={scope}>{scope}</SelectItem>)}
            </SelectContent>
          </Select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Performed By</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Processed</TableHead>
                  <TableHead>Changed</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm">{fmtDate(row.started_at)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.completed_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.performed_by}</TableCell>
                      <TableCell className="text-sm">{row.scope_type}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLOURS[row.status] ?? 'bg-gray-100 text-gray-800'}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-right">{row.observations_processed?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right">{row.compliance_changed?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          <div><span className="font-medium">Duration:</span> {row.duration_seconds != null ? `${row.duration_seconds}s` : '—'}</div>
                          <div>
                            <span className="font-medium">Date range:</span> {fmtDate(row.date_range_start)} → {fmtDate(row.date_range_end)}
                          </div>
                          <div>
                            <span className="font-medium">Target orgs:</span> {row.target_org_ids.length ? row.target_org_ids.join(', ') : '—'}
                          </div>
                          <div>
                            <span className="font-medium">Target zones:</span> {row.target_zone_ids.length ? row.target_zone_ids.join(', ') : '—'}
                          </div>
                          <div>
                            <span className="font-medium">Drift events:</span> {row.drift_events_created?.toLocaleString() ?? '—'} &nbsp;
                            <span className="font-medium">Observations processed:</span> {row.observations_processed?.toLocaleString() ?? '—'}
                          </div>
                          {row.error_message && (
                            <div><span className="font-medium text-rose-700">Error:</span> <span className="text-rose-700">{row.error_message}</span></div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {processed.toLocaleString()} observations processed across {rows.length} recalculation runs
          </p>
        )}
      </div>
    </AppLayout>
  )
}
