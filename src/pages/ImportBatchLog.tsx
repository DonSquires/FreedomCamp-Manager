/**
 * ImportBatchLog — B-141
 *
 * Admin audit log for import_batches.
 * Surfaces each historical data import run with record counts, enrichment stats, and error summaries.
 *
 * Route: /import-batches-log — admin/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Upload, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type BatchRow = Database['public']['Tables']['import_batches']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtBytes(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const STATUS_COLOURS: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-800',
  processing: 'bg-blue-100 text-blue-800',
  complete:   'bg-green-100 text-green-800',
  completed:  'bg-green-100 text-green-800',
  failed:     'bg-rose-100 text-rose-800',
  partial:    'bg-orange-100 text-orange-800',
}

export default function ImportBatchLog() {
  const [statusFilter, setStatusFilter]   = useState<string>('all')
  const [dateFrom, setDateFrom]           = useState('')
  const [batchQuery, setBatchQuery]       = useState('')
  const [expanded, setExpanded]           = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<BatchRow[]>({
    queryKey: ['import-batches-log', statusFilter, dateFrom, batchQuery],
    queryFn: async () => {
      let q = supabase
        .from('import_batches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom)               q = q.gte('created_at', dateFrom)
      if (batchQuery.trim())      q = q.ilike('batch_name', `%${batchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const totalRecords    = rows.reduce((acc, r) => acc + (r.total_records ?? 0), 0)
  const totalSuccessful = rows.reduce((acc, r) => acc + (r.successful_records ?? 0), 0)
  const totalFailed     = rows.reduce((acc, r) => acc + (r.failed_records ?? 0), 0)

  const statuses = ['all', ...Array.from(new Set(rows.map(r => r.status)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Upload className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Import Batch Log</h1>
              <p className="text-sm text-muted-foreground">History of all data import runs with record counts, enrichment stats, and error summaries</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Batches',       value: rows.length,    colour: 'text-gray-700' },
            { label: 'Total Records',       value: totalRecords.toLocaleString(), colour: 'text-sky-700' },
            { label: 'Successful Records',  value: totalSuccessful.toLocaleString(), colour: 'text-green-700' },
            { label: 'Failed Records',      value: totalFailed.toLocaleString(), colour: 'text-rose-700' },
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
            placeholder="Search batch name…"
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
            <AlertCircle className="h-8 w-8" />
            <p>No import batches found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created At</TableHead>
                  <TableHead>Batch Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Successful</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Uploaded By</TableHead>
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
                      <TableCell className="max-w-[14rem] truncate font-medium text-sm" title={row.batch_name}>{row.batch_name}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLOURS[row.status] ?? 'bg-gray-100 text-gray-700'}`}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.total_records?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-sm text-green-700">{row.successful_records?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-sm text-rose-700">{row.failed_records?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.uploaded_by.slice(0, 8)}…</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                            <div><span className="font-medium">File name:</span> {row.file_name ?? '—'}</div>
                            <div><span className="font-medium">File size:</span> {fmtBytes(row.file_size_bytes)}</div>
                            <div><span className="font-medium">Started at:</span> {fmtDate(row.started_at)}</div>
                            <div><span className="font-medium">Completed at:</span> {fmtDate(row.completed_at)}</div>
                            <div><span className="font-medium">Parsed records:</span> {row.parsed_records}</div>
                            <div><span className="font-medium">Processed:</span> {row.processed_records ?? '—'}</div>
                            <div><span className="font-medium">Zones created:</span> {row.zones_created}</div>
                            <div><span className="font-medium">Uploaded by:</span> {row.uploaded_by}</div>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-1">
                            <div><span className="font-medium">Vehicles enriched:</span> {row.vehicles_enriched ?? '—'}</div>
                            <div><span className="font-medium">Plates enriched:</span> {row.plates_enriched ?? '—'}</div>
                            <div><span className="font-medium">Homeless inferred:</span> {row.homeless_inferred ?? '—'}</div>
                            <div><span className="font-medium">H&S issues inferred:</span> {row.hs_issues_inferred ?? '—'}</div>
                          </div>
                          {row.error_summary && (
                            <div className="text-rose-700">
                              <span className="font-medium">Error summary:</span> {row.error_summary}
                            </div>
                          )}
                          {row.import_config && (
                            <div>
                              <span className="font-medium">Import config:</span>
                              <pre className="mt-1 overflow-auto max-h-32 text-xs bg-muted rounded p-2">
                                {JSON.stringify(row.import_config, null, 2)}
                              </pre>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
