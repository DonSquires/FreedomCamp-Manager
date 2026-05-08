import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Car, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type CanonicalScvRow = Database['public']['Tables']['canonical_scv']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLORS: Record<string, string> = {
  valid: 'bg-green-100 text-green-800',
  expired: 'bg-red-100 text-red-800',
  pending: 'bg-yellow-100 text-yellow-800',
  invalid: 'bg-gray-100 text-gray-800',
}

export default function CanonicalScvLog() {
  const [statusFilter, setStatusFilter] = useState('all')
  const [selfContainedFilter, setSelfContainedFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<CanonicalScvRow[]>({
    queryKey: ['canonical-scv-log', statusFilter, selfContainedFilter, plateQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('canonical_scv')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('certificate_status', statusFilter)
      if (selfContainedFilter === 'yes') q = q.eq('is_self_contained', true)
      if (selfContainedFilter === 'no') q = q.eq('is_self_contained', false)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const validCount = rows.filter((r) => r.certificate_status === 'valid').length
  const expiredCount = rows.filter((r) => r.certificate_status === 'expired').length
  const selfContainedCount = rows.filter((r) => r.is_self_contained).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Car className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Canonical SCV Log</h1>
              <p className="text-sm text-muted-foreground">Self-contained vehicle certification records from the NZSCV canonical dataset</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: rows.length, color: 'text-gray-700' },
            { label: 'Valid', value: validCount, color: 'text-green-700' },
            { label: 'Expired', value: expiredCount, color: 'text-red-700' },
            { label: 'Self-Contained', value: selfContainedCount, color: 'text-sky-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Certificate status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="valid">Valid</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="invalid">Invalid</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selfContainedFilter} onValueChange={setSelfContainedFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Self-contained" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vehicles</SelectItem>
              <SelectItem value="yes">Self-contained</SelectItem>
              <SelectItem value="no">Not self-contained</SelectItem>
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
            <p>No canonical SCV records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Self-Contained</TableHead>
                  <TableHead>Issue Date</TableHead>
                  <TableHead>Expiry</TableHead>
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
                        <Badge className={`text-xs ${STATUS_COLORS[row.certificate_status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                          {row.certificate_status ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.is_self_contained ? (
                          <Badge className="bg-sky-100 text-sky-800 text-xs">Yes</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{row.certificate_issue_date ?? '—'}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{row.certificate_expiry ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.plate_number ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.plate_number && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">VIN:</span> {row.vin ?? '—'}</div>
                            <div><span className="font-medium">Max Occupants:</span> {row.max_occupants ?? '—'}</div>
                            <div><span className="font-medium">Source:</span> {row.source ?? '—'}</div>
                            <div><span className="font-medium">Verified At:</span> {fmtDate(row.verified_at)}</div>
                            <div><span className="font-medium">Updated At:</span> {fmtDate(row.updated_at)}</div>
                          </div>
                          {row.logo_url && <div><span className="font-medium">Logo URL:</span> {row.logo_url}</div>}
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
