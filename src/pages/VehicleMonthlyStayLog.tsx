import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, Car, ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

type VehicleMonthlyStay = Database['public']['Tables']['vehicle_monthly_stays']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

export default function VehicleMonthlyStayLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [monthFilter, setMonthFilter] = useState('')
  const [plateSearch, setPlateSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<VehicleMonthlyStay[]>({
    queryKey: ['vehicle-monthly-stays-log', orgId, monthFilter, plateSearch],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('vehicle_monthly_stays')
        .select('*')
        .eq('organization_id', orgId!)
        .order('calendar_month', { ascending: false })
        .limit(600)

      if (monthFilter) q = q.eq('calendar_month', monthFilter)
      if (plateSearch.trim()) q = q.ilike('plate_number', `%${plateSearch.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const totalNights = rows.reduce((sum, r) => sum + (r.nights_stayed ?? 0), 0)
  const highConsecutive = rows.filter((r) => (r.consecutive_nights ?? 0) >= 3).length
  const uniqueZones = new Set(rows.map((r) => r.zone_id).filter(Boolean)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Car className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Vehicle Monthly Stays Log</h1>
              <p className="text-sm text-muted-foreground">Monthly per-plate stay aggregates by zone</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Records', value: rows.length, color: 'text-slate-700' },
            { label: 'Total Nights', value: totalNights, color: 'text-sky-700' },
            { label: 'Consecutive ≥3', value: highConsecutive, color: 'text-orange-700' },
            { label: 'Zones', value: uniqueZones, color: 'text-indigo-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="w-44" />
          <Input
            placeholder="Search plate…"
            value={plateSearch}
            onChange={(e) => setPlateSearch(e.target.value)}
            className="w-44"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No monthly stay records found</p></div>
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
                  <TableHead>Last Observed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow className={`cursor-pointer hover:bg-muted/50 ${(row.consecutive_nights ?? 0) >= 3 ? 'bg-orange-50/40 dark:bg-orange-950/10' : ''}`} onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{row.calendar_month}</TableCell>
                        <TableCell className="font-mono text-sm">{row.plate_number}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.zone_id?.slice(0, 8) ?? '—'}…</TableCell>
                        <TableCell className="text-sm">{row.nights_stayed ?? 0}</TableCell>
                        <TableCell>{(row.consecutive_nights ?? 0) >= 3 ? <Badge className="bg-orange-100 text-orange-800 text-xs">{row.consecutive_nights ?? 0}</Badge> : <span className="text-sm">{row.consecutive_nights ?? 0}</span>}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.last_observation_date)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>ID: {row.id}</span>
                              <span>Full zone: {row.zone_id}</span>
                              <span>Reset at: {fmtDate(row.reset_at)}</span>
                              <span>Last reset: {fmtDate(row.last_reset_at)}</span>
                              <span>Created: {fmtDate(row.created_at)}</span>
                              <span>Updated: {fmtDate(row.updated_at)}</span>
                            </div>
                            {row.observation_ids && row.observation_ids.length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Observation IDs</p>
                                <p className="text-xs text-muted-foreground break-all">{row.observation_ids.join(', ')}</p>
                              </div>
                            )}
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
