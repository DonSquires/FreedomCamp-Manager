/**
 * ImportStagingLog — B-144
 *
 * Admin audit log for import_staging.
 * Shows each staged import record within a batch — status, enrichment outcomes,
 * validation errors, and raw/enriched data inspection.
 *
 * Route: /import-staging-log — admin/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Table2, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type StagingRow = Database['public']['Tables']['import_staging']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLOURS: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-800',
  validated:  'bg-blue-100 text-blue-800',
  enriched:   'bg-indigo-100 text-indigo-800',
  imported:   'bg-green-100 text-green-800',
  failed:     'bg-rose-100 text-rose-800',
  skipped:    'bg-gray-100 text-gray-700',
}

export default function ImportStagingLog() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [batchQuery, setBatchQuery]     = useState('')
  const [dateFrom, setDateFrom]         = useState('')
  const [expanded, setExpanded]         = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<StagingRow[]>({
    queryKey: ['import-staging-log', statusFilter, batchQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('import_staging')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (batchQuery.trim())      q = q.ilike('batch_id', `%${batchQuery.trim()}%`)
      if (dateFrom)               q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const imported  = rows.filter(r => r.status === 'imported').length
  const failed    = rows.filter(r => r.status === 'failed').length
  const enriched  = rows.filter(r => r.enriched_at !== null).length
  const withErrors = rows.filter(r => r.error_log).length

  const statuses = ['all', ...Array.from(new Set(rows.map(r => r.status).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Table2 className="h-6 w-6 text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold">Import Staging Log</h1>
              <p className="text-sm text-muted-foreground">Per-record staging audit for all import batches — status, enrichment, validation errors</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records',  value: rows.length,            colour: 'text-gray-700' },
            { label: 'Imported',       value: imported,               colour: 'text-green-700' },
            { label: 'Failed',         value: failed,                 colour: 'text-rose-700' },
            { label: 'With Errors',    value: withErrors,             colour: 'text-amber-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={batchQuery}
            onChange={e => setBatchQuery(e.target.value)}
            placeholder="Search batch ID…"
            className="w-52"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>{statuses.map(s => <SelectItem key={s} value={s}>{s === 'all' ? 'All statuses' : s}</SelectItem>)}</SelectContent>
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
            <AlertCircle className="h-8 w-8" /><p>No staging records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created At</TableHead>
                  <TableHead>Batch ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enriched At</TableHead>
                  <TableHead>Imported At</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Observation</TableHead>
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
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.batch_id.slice(0, 8)}…</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLOURS[row.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                          {row.status ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{fmtDate(row.enriched_at)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.imported_at)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.vehicle_id ? row.vehicle_id.slice(0, 8) + '…' : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.observation_id ? row.observation_id.slice(0, 8) + '…' : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-2 py-3">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Record ID:</span> {row.id}</div>
                            <div><span className="font-medium">Batch ID:</span> {row.batch_id}</div>
                            <div><span className="font-medium">Vehicle ID:</span> {row.vehicle_id ?? '—'}</div>
                            <div><span className="font-medium">Observation ID:</span> {row.observation_id ?? '—'}</div>
                          </div>
                          {row.error_log && (
                            <div className="text-rose-700"><span className="font-medium">Error log:</span> {row.error_log}</div>
                          )}
                          {row.validation_errors && (
                            <div>
                              <span className="font-medium">Validation errors:</span>
                              <pre className="mt-1 overflow-auto max-h-24 text-xs bg-muted rounded p-2">
                                {JSON.stringify(row.validation_errors, null, 2)}
                              </pre>
                            </div>
                          )}
                          {row.confidence_scores && (
                            <div>
                              <span className="font-medium">Confidence scores:</span>
                              <pre className="mt-1 overflow-auto max-h-24 text-xs bg-muted rounded p-2">
                                {JSON.stringify(row.confidence_scores, null, 2)}
                              </pre>
                            </div>
                          )}
                          <div>
                            <span className="font-medium">Raw data:</span>
                            <pre className="mt-1 overflow-auto max-h-32 text-xs bg-muted rounded p-2">
                              {JSON.stringify(row.raw_data, null, 2)}
                            </pre>
                          </div>
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
            Showing {rows.length} record{rows.length !== 1 ? 's' : ''} · {enriched} enriched · {failed} failed
          </p>
        )}
      </div>
    </AppLayout>
  )
}
