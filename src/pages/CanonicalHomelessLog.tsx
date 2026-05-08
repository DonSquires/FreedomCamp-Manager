import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Tent, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type CanonicalHomelessRow = Database['public']['Tables']['canonical_homeless']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-orange-100 text-orange-800',
  pending: 'bg-yellow-100 text-yellow-800',
  revoked: 'bg-gray-100 text-gray-800',
  disputed: 'bg-red-100 text-red-800',
}

export default function CanonicalHomelessLog() {
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<CanonicalHomelessRow[]>({
    queryKey: ['canonical-homeless-log', statusFilter, sourceFilter, plateQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('canonical_homeless')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (sourceFilter !== 'all') q = q.eq('source', sourceFilter)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const confirmedCount = rows.filter((r) => r.status === 'confirmed').length
  const pendingCount = rows.filter((r) => r.status === 'pending').length
  const sources = ['all', ...Array.from(new Set(rows.map((r) => r.source).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Tent className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Canonical Homeless Log</h1>
              <p className="text-sm text-muted-foreground">Canonical homeless vehicle records confirmed by officers or administrators</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: rows.length, color: 'text-gray-700' },
            { label: 'Confirmed', value: confirmedCount, color: 'text-orange-700' },
            { label: 'Pending', value: pendingCount, color: 'text-yellow-700' },
            { label: 'Unique Sources', value: sources.length - 1, color: 'text-blue-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
              <SelectItem value="disputed">Disputed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>{s === 'all' ? 'All sources' : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={plateQuery}
            onChange={(e) => setPlateQuery(e.target.value)}
            placeholder="Search plate…"
            className="w-36"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded px-3 py-1 text-sm w-40 bg-background"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No canonical homeless records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Confirmed At</TableHead>
                  <TableHead>Confirmed By</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.plate_number}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.plate_number ? null : row.plate_number)}
                    >
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-sm font-mono font-semibold">{row.plate_number ?? '—'}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLORS[row.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                          {row.status ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.source ?? '—'}</Badge></TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.confirmed_at)}</TableCell>
                      <TableCell className="text-xs truncate max-w-[100px]">{row.confirmed_by ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.plate_number ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.plate_number && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Updated At:</span> {fmtDate(row.updated_at)}</div>
                          </div>
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
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
