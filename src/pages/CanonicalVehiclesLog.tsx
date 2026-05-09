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

type CanonicalVehicleRow = Database['public']['Tables']['canonical_vehicles']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function CanonicalVehiclesLog() {
  const [flaggedFilter, setFlaggedFilter] = useState('all')
  const [homelessFilter, setHomelessFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<CanonicalVehicleRow[]>({
    queryKey: ['canonical-vehicles-log', flaggedFilter, homelessFilter, plateQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('canonical_vehicles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (flaggedFilter === 'flagged') q = q.eq('is_flagged', true)
      if (flaggedFilter === 'not_flagged') q = q.eq('is_flagged', false)
      if (homelessFilter === 'homeless') q = q.eq('is_homeless', true)
      if (homelessFilter === 'not_homeless') q = q.eq('is_homeless', false)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const flaggedCount = rows.filter((r) => r.is_flagged).length
  const homelessCount = rows.filter((r) => r.is_homeless).length
  const exemptCount = rows.filter((r) => r.is_exempt).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Car className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Canonical Vehicles Log</h1>
              <p className="text-sm text-muted-foreground">Canonical vehicle registry records used for compliance and enforcement context</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: rows.length, color: 'text-gray-700' },
            { label: 'Flagged', value: flaggedCount, color: 'text-red-700' },
            { label: 'Homeless', value: homelessCount, color: 'text-amber-700' },
            { label: 'Exempt', value: exemptCount, color: 'text-green-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={flaggedFilter} onValueChange={setFlaggedFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Flag state" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="not_flagged">Not Flagged</SelectItem>
            </SelectContent>
          </Select>
          <Select value={homelessFilter} onValueChange={setHomelessFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Homeless state" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="homeless">Homeless</SelectItem>
              <SelectItem value="not_homeless">Not Homeless</SelectItem>
            </SelectContent>
          </Select>
          <Input value={plateQuery} onChange={(e) => setPlateQuery(e.target.value)} placeholder="Search plate…" className="w-40" />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No canonical vehicle records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Flagged</TableHead>
                  <TableHead>Homeless</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => {
                  const rowKey = row.vehicle_id ?? row.plate_number ?? `${i}`
                  return (
                    <Fragment key={rowKey}>
                      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === rowKey ? null : rowKey)}>
                        <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="text-sm font-mono font-semibold">{row.plate_number ?? '—'}</TableCell>
                        <TableCell className="text-sm">{[row.vehicle_make, row.vehicle_model, row.vehicle_year].filter(Boolean).join(' ') || '—'}</TableCell>
                        <TableCell>{row.is_flagged ? <Badge className="bg-red-100 text-red-800 text-xs">Flagged</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                        <TableCell>{row.is_homeless ? <Badge className="bg-amber-100 text-amber-800 text-xs">Homeless</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.last_seen_at)}</TableCell>
                        <TableCell className="text-xs text-sky-600">{expanded === rowKey ? '▲ hide' : '▼ show'}</TableCell>
                      </TableRow>
                      {expanded === rowKey && (
                        <TableRow className="bg-muted/20">
                          <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                              <div><span className="font-medium">Vehicle ID:</span> {row.vehicle_id ?? '—'}</div>
                              <div><span className="font-medium">Color:</span> {row.vehicle_color ?? '—'}</div>
                              <div><span className="font-medium">Priority:</span> {row.flagged_priority ?? '—'}</div>
                              <div><span className="font-medium">Enforcement Count:</span> {row.enforcement_count ?? 0}</div>
                              <div><span className="font-medium">Total Breaches:</span> {row.total_breaches ?? 0}</div>
                              <div><span className="font-medium">Updated At:</span> {fmtDate(row.updated_at)}</div>
                            </div>
                            {row.flagged_reason && <div><span className="font-medium">Flag Reason:</span> {row.flagged_reason}</div>}
                            {row.homeless_notes && <div><span className="font-medium">Homeless Notes:</span> {row.homeless_notes}</div>}
                            {row.flagged_notes && <div><span className="font-medium">Flag Notes:</span> {row.flagged_notes}</div>}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
