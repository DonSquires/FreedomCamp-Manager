/**
 * ImportBatchLog — B-140
 *
 * Admin log and viewer for import_batches.
 * Displays all historical import batches with status, record counts,
 * file details, and enrichment metrics.
 *
 * Route: /import-batch-log — admin/master
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
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const STATUS_COLOURS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  processing: 'bg-sky-100 text-sky-800',
  failed: 'bg-rose-100 text-rose-800',
  pending: 'bg-amber-100 text-amber-800',
}

export default function ImportBatchLog() {
  const [nameQuery, setNameQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<BatchRow[]>({
    queryKey: ['import-batch-log', nameQuery, statusFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('import_batches')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (nameQuery.trim()) q = q.ilike('batch_name', `%${nameQuery.trim()}%`)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const completed = rows.filter(r => r.status === 'completed').length
  const failed = rows.filter(r => r.status === 'failed').length
  const totalRecords = rows.reduce((acc, r) => acc + (r.total_records ?? 0), 0)
  const totalSuccessful = rows.reduce((acc, r) => acc + (r.successful_records ?? 0), 0)

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Upload className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Import Batch Log</h1>
              <p className="text-sm text-muted-foreground">Historical import batches with status, record counts, and enrichment metrics</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Batches', value: rows.length, colour: 'text-gray-700' },
            { label: 'Completed', value: completed, colour: 'text-emerald-700' },
            { label: 'Failed', value: failed, colour: 'text-rose-700' },
            { label: 'Total Records', value: totalRecords.toLocaleString(), colour: 'text-indigo-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={nameQuery} onChange={e => setNameQuery(e.target.value)} placeholder="Search batch name…" className="w-56" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
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
                  <TableHead>Created</TableHead>
                  <TableHead>Batch Name</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Success</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Details</TableHead>
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
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="font-medium text-sm max-w-[12rem] truncate">{row.batch_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[10rem] truncate" title={row.file_name ?? ''}>
                        {row.file_name ? `${row.file_name} (${fmtBytes(row.file_size_bytes)})` : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLOURS[row.status] ?? 'bg-gray-100 text-gray-800'}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-right">{row.total_records?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right text-emerald-700">{row.successful_records?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right text-rose-700">{row.failed_records?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          <div><span className="font-medium">Uploaded by:</span> {row.uploaded_by} &nbsp; <span className="font-medium">Org:</span> {row.organization_id}</div>
                          <div>
                            <span className="font-medium">Started:</span> {fmtDate(row.started_at)} &nbsp;
                            <span className="font-medium">Completed:</span> {fmtDate(row.completed_at)}
                          </div>
                          <div>
                            <span className="font-medium">Parsed:</span> {row.parsed_records?.toLocaleString() ?? '—'} &nbsp;
                            <span className="font-medium">Processed:</span> {row.processed_records?.toLocaleString() ?? '—'} &nbsp;
                            <span className="font-medium">Plates enriched:</span> {row.plates_enriched?.toLocaleString() ?? '—'} &nbsp;
                            <span className="font-medium">Vehicles enriched:</span> {row.vehicles_enriched?.toLocaleString() ?? '—'} &nbsp;
                            <span className="font-medium">Zones created:</span> {row.zones_created}
                          </div>
                          {row.error_summary && (
                            <div><span className="font-medium text-rose-700">Error summary:</span> <span className="text-rose-700">{row.error_summary}</span></div>
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

        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {totalSuccessful.toLocaleString()} successful out of {totalRecords.toLocaleString()} total records across {rows.length} batches
          </p>
        )}
      </div>
    </AppLayout>
  )
}
