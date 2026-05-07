import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Car, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
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

type MonthlyStayRow = Database['public']['Tables']['vehicle_monthly_stays']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

export default function VehicleMonthlyStayLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [monthFilter, setMonthFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<MonthlyStayRow[]>({
    queryKey: ['vehicle-monthly-stays-log', orgId, monthFilter, plateQuery],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('vehicle_monthly_stays')
        .select('*')
        .eq('organization_id', orgId!)
        .order('calendar_month', { ascending: false })
        .limit(500)

      if (monthFilter !== 'all') q = q.eq('calendar_month', monthFilter)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const months = [...new Set(rows.map(r => r.calendar_month).filter(Boolean))].sort().reverse()
  const uniquePlates = new Set(rows.map(r => r.plate_number)).size
  const nights = rows.map(r => r.nights_stayed).filter((v): v is number => v != null)
  const avgNights = nights.length ? (nights.reduce((a, b) => a + b, 0) / nights.length).toFixed(1) : '—'
  const highConsecutive = rows.filter(r => (r.consecutive_nights ?? 0) >= 7).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Car className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Vehicle Monthly Stay Log</h1>
              <p className="text-sm text-muted-foreground">Monthly plate stay tracking and consecutive-night monitoring</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Monthly Records', value: rows.length, colour: 'text-gray-700' },
            { label: 'Unique Plates', value: uniquePlates, colour: 'text-blue-700' },
            { label: 'Avg Nights Stayed', value: avgNights, colour: 'text-violet-700' },
            { label: 'High Consecutive (7+)', value: highConsecutive, colour: 'text-red-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {months.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            value={plateQuery}
            onChange={e => setPlateQuery(e.target.value)}
            placeholder="Search plate…"
            className="w-44"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No vehicle monthly stay records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Month</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Nights Stayed</TableHead>
                  <TableHead>Consecutive Nights</TableHead>
                  <TableHead>Last Observation</TableHead>
                  <TableHead>Reset At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const isHighConsecutive = (row.consecutive_nights ?? 0) >= 7
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${isHighConsecutive ? 'bg-red-50/60' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-medium">{row.calendar_month}</TableCell>
                        <TableCell className="font-mono text-sm">{row.plate_number}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.zone_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-sm">{row.nights_stayed ?? '—'}</TableCell>
                        <TableCell>
                          {isHighConsecutive
                            ? <Badge className="bg-red-200 text-red-900">{row.consecutive_nights ?? 0}</Badge>
                            : <Badge className="bg-blue-100 text-blue-800">{row.consecutive_nights ?? 0}</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.last_observation_date)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.reset_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div><span className="font-medium">Record ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                              <div><span className="font-medium">Last Reset:</span> <span className="text-muted-foreground">{fmtDate(row.last_reset_at)}</span></div>
                              <div className="md:col-span-2"><span className="font-medium">Observation IDs:</span> <span className="text-muted-foreground">{row.observation_ids?.join(', ') || '—'}</span></div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
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
