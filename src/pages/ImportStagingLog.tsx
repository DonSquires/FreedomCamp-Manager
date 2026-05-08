/**
 * ImportStagingLog — B-144
 *
 * Admin log and viewer for import_staging.
 * Displays staging-row validation, enrichment status, batch lineage,
 * and raw payload snapshots for imported records.
 *
 * Route: /import-staging-log — admin/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { DatabaseZap, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

function jsonSize(value: unknown) {
  if (!value) return 0
  try { return JSON.stringify(value).length } catch { return 0 }
}

export default function ImportStagingLog() {
  const [batchQuery, setBatchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [errorFilter, setErrorFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<StagingRow[]>({
    queryKey: ['import-staging-log', batchQuery, statusFilter, errorFilter],
    queryFn: async () => {
      let q = supabase
        .from('import_staging')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (batchQuery.trim()) {
        q = q.or(`batch_id.ilike.%${batchQuery.trim()}%,observation_id.ilike.%${batchQuery.trim()}%,vehicle_id.ilike.%${batchQuery.trim()}%`)
      }
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (errorFilter === 'errors') q = q.not('error_log', 'is', null)
      if (errorFilter === 'clean') q = q.is('error_log', null)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const statuses = [...new Set(rows.map(row => row.status).filter(Boolean))].sort()
  const errored = rows.filter(row => !!row.error_log).length
  const enriched = rows.filter(row => !!row.enriched_at).length
  const imported = rows.filter(row => !!row.imported_at).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DatabaseZap className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Import Staging Log</h1>
              <p className="text-sm text-muted-foreground">Staging-row validation and enrichment audit with batch lineage and raw payload detail</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Staging Rows', value: rows.length, colour: 'text-gray-700' },
            { label: 'Imported', value: imported, colour: 'text-emerald-700' },
            { label: 'Enriched', value: enriched, colour: 'text-sky-700' },
            { label: 'With Errors', value: errored, colour: 'text-rose-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={batchQuery} onChange={e => setBatchQuery(e.target.value)} placeholder="Search batch, observation, or vehicle…" className="w-72" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(status => <SelectItem key={status} value={status!}>{status}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={errorFilter} onValueChange={setErrorFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Error state" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rows</SelectItem>
              <SelectItem value="errors">With errors</SelectItem>
              <SelectItem value="clean">No errors</SelectItem>
            </SelectContent>
          </Select>
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
                  <TableHead>Created</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Imported</TableHead>
                  <TableHead>Enriched</TableHead>
                  <TableHead>Observation</TableHead>
                  <TableHead>Vehicle</TableHead>
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
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.batch_id}</TableCell>
                      <TableCell>
                        {row.status ? (
                          <Badge className="bg-amber-100 text-amber-800">{row.status}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{fmtDate(row.imported_at)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.enriched_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.observation_id ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.vehicle_id ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-2 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          <div>
                            <span className="font-medium">Payload sizes:</span> raw {jsonSize(row.raw_data)} chars &nbsp;
                            confidence {jsonSize(row.confidence_scores)} chars &nbsp;
                            validation {jsonSize(row.validation_errors)} chars
                          </div>
                          {row.error_log && <div><span className="font-medium text-rose-700">Error log:</span> <span className="text-rose-700">{row.error_log}</span></div>}
                          <div>
                            <span className="font-medium">Raw data:</span>
                            <pre className="mt-1 overflow-auto max-h-32 text-xs bg-muted rounded p-2">{JSON.stringify(row.raw_data, null, 2)}</pre>
                          </div>
                          {row.validation_errors && (
                            <div>
                              <span className="font-medium">Validation errors:</span>
                              <pre className="mt-1 overflow-auto max-h-32 text-xs bg-muted rounded p-2">{JSON.stringify(row.validation_errors, null, 2)}</pre>
                            </div>
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
      </div>
    </AppLayout>
  )
}
