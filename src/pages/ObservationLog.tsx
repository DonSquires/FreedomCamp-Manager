import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Eye, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
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

type ObservationRow = Database['public']['Tables']['observations']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function ObservationLog() {
  const { user } = useAuthStore()
  const [breachFilter, setBreachFilter] = useState('all')
  const [compliantFilter, setCompliantFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ObservationRow[]>({
    queryKey: ['observations-log', breachFilter, compliantFilter, plateQuery, dateFrom],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('observations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (breachFilter === 'breach') q = q.eq('is_breach', true)
      if (breachFilter === 'no_breach') q = q.eq('is_breach', false)
      if (compliantFilter === 'compliant') q = q.eq('is_compliant', true)
      if (compliantFilter === 'non_compliant') q = q.eq('is_compliant', false)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const breachCount = rows.filter((r) => r.is_breach).length
  const compliantCount = rows.filter((r) => r.is_compliant).length
  const withGpsCount = rows.filter((r) => r.gps_latitude !== null && r.gps_longitude !== null).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Eye className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Observation Log</h1>
              <p className="text-sm text-muted-foreground">Field observation records with compliance, breach, and GPS detail</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Observations', value: rows.length, color: 'text-gray-700' },
            { label: 'Breaches', value: breachCount, color: 'text-red-700' },
            { label: 'Compliant', value: compliantCount, color: 'text-green-700' },
            { label: 'With GPS', value: withGpsCount, color: 'text-sky-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={breachFilter} onValueChange={setBreachFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Breach filter" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              <SelectItem value="breach">Breach only</SelectItem>
              <SelectItem value="no_breach">No breach</SelectItem>
            </SelectContent>
          </Select>
          <Select value={compliantFilter} onValueChange={setCompliantFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Compliance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All compliance</SelectItem>
              <SelectItem value="compliant">Compliant</SelectItem>
              <SelectItem value="non_compliant">Non-compliant</SelectItem>
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
            <p>No observations found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recorded</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Breach</TableHead>
                  <TableHead>Compliant</TableHead>
                  <TableHead>Nights</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.recorded_at ?? row.created_at)}</TableCell>
                      <TableCell className="text-sm font-mono font-semibold">{row.plate_number ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.zone_name_at_import ?? row.zone_id ?? '—'}</TableCell>
                      <TableCell>
                        {row.is_breach ? (
                          <Badge className="bg-red-100 text-red-800 text-xs">Breach</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.is_compliant === true ? (
                          <Badge className="bg-green-100 text-green-800 text-xs">Compliant</Badge>
                        ) : row.is_compliant === false ? (
                          <Badge className="bg-red-100 text-red-800 text-xs">Non-compliant</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{row.consecutive_nights ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">ID:</span> {row.id}</div>
                            <div><span className="font-medium">Recorded By:</span> {row.recorded_by ?? '—'}</div>
                            <div><span className="font-medium">Portal Used:</span> {row.portal_used ?? '—'}</div>
                            <div><span className="font-medium">GPS Lat:</span> {row.gps_latitude ?? '—'}</div>
                            <div><span className="font-medium">GPS Lng:</span> {row.gps_longitude ?? '—'}</div>
                            <div><span className="font-medium">GPS Accuracy:</span> {row.gps_accuracy ?? '—'}</div>
                            <div><span className="font-medium">Breach Type:</span> {row.breach_type ?? '—'}</div>
                            <div><span className="font-medium">Breach Reason:</span> {row.breach_reason ?? '—'}</div>
                            <div><span className="font-medium">Nights This Month:</span> {row.nights_stayed_this_month ?? '—'}</div>
                            <div><span className="font-medium">Has Incident:</span> {row.has_incident ? 'Yes' : 'No'}</div>
                            <div><span className="font-medium">Has Homeless Claim:</span> {row.has_homeless_claim ? 'Yes' : 'No'}</div>
                            <div><span className="font-medium">Processing Status:</span> {row.processing_status ?? '—'}</div>
                          </div>
                          {row.observation_notes && <div><span className="font-medium">Observation Notes:</span> {row.observation_notes}</div>}
                          {row.officer_notes && <div><span className="font-medium">Officer Notes:</span> {row.officer_notes}</div>}
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
