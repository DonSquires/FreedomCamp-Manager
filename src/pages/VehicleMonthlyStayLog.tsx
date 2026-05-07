/**
 * VehicleMonthlyStayLog — B-116
 *
 * Log viewer for vehicle_monthly_stays — monthly stay records tracking
 * how many nights a vehicle has stayed in a zone (Freedom Camping Act compliance).
 *
 * Features:
 *  - KPI cards: Total Records / Unique Plates / Avg Nights / Avg Consecutive Nights
 *  - Filters: calendar_month (dynamic), zone_id search
 *  - Table: plate_number, calendar_month, zone_id (truncated), nights_stayed,
 *           consecutive_nights (highlighted if high), last_observation_date
 *  - Expandable row: zone_id (full), reset_at, last_reset_at, observation_ids count,
 *                    created_at, updated_at
 *
 * Route: /vehicle-monthly-stays-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  CalendarRange, RefreshCw, AlertCircle, Loader2,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type VehicleMonthlyStay = Database['public']['Tables']['vehicle_monthly_stays']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDay(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VehicleMonthlyStayLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [monthFilter,   setMonthFilter]   = useState('all')
  const [plateSearch,   setPlateSearch]   = useState('')
  const [expandedId,    setExpandedId]    = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<VehicleMonthlyStay[]>({
    queryKey: ['vehicle-monthly-stays-log', orgId, monthFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('vehicle_monthly_stays')
        .select('*')
        .eq('organization_id', orgId!)
        .order('calendar_month', { ascending: false })
        .limit(500)

      if (monthFilter !== 'all') q = q.eq('calendar_month', monthFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const filtered = plateSearch
    ? rows.filter(r => r.plate_number.toLowerCase().includes(plateSearch.toLowerCase()))
    : rows

  const uniquePlates  = new Set(filtered.map(r => r.plate_number)).size
  const nightsArr     = filtered.map(r => r.nights_stayed).filter((v): v is number => v != null)
  const consArr       = filtered.map(r => r.consecutive_nights).filter((v): v is number => v != null)
  const avgNights     = nightsArr.length > 0 ? (nightsArr.reduce((a, b) => a + b, 0) / nightsArr.length).toFixed(1) : '—'
  const avgCons       = consArr.length   > 0 ? (consArr.reduce((a, b) => a + b, 0)  / consArr.length).toFixed(1)  : '—'
  const months        = [...new Set(rows.map(r => r.calendar_month).filter(Boolean))].sort().reverse()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarRange className="h-6 w-6 text-cyan-700" />
            <div>
              <h1 className="text-2xl font-bold">Vehicle Monthly Stay Log</h1>
              <p className="text-sm text-muted-foreground">Monthly stay records for Freedom Camping Act compliance tracking</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records',          value: filtered.length, colour: 'text-gray-700' },
            { label: 'Unique Plates',           value: uniquePlates,    colour: 'text-cyan-700' },
            { label: 'Avg Nights / Month',      value: avgNights,       colour: 'text-blue-700' },
            { label: 'Avg Consecutive Nights',  value: avgCons,         colour: 'text-orange-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {months.map(m => <SelectItem key={m} value={m!}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            placeholder="Filter by plate…"
            value={plateSearch}
            onChange={e => setPlateSearch(e.target.value)}
            className="w-44"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No stay records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Plate</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Nights</TableHead>
                  <TableHead>Consecutive</TableHead>
                  <TableHead>Last Observed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(row => {
                  const expanded = expandedId === row.id
                  const isHighConsecutive = (row.consecutive_nights ?? 0) >= 3
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${isHighConsecutive ? 'bg-orange-50/30 dark:bg-orange-950/10' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-mono font-medium text-sm">{row.plate_number}</TableCell>
                        <TableCell className="text-sm">{row.calendar_month}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.zone_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-sm font-medium">{row.nights_stayed ?? '—'}</TableCell>
                        <TableCell>
                          {row.consecutive_nights != null ? (
                            <Badge className={isHighConsecutive ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-700'}>
                              {row.consecutive_nights}
                            </Badge>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDay(row.last_observation_date)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Zone (full): {row.zone_id}</span>
                              {row.observation_ids && <span>Observations: {row.observation_ids.length}</span>}
                              {row.reset_at       && <span>Reset: {fmtDate(row.reset_at)}</span>}
                              {row.last_reset_at  && <span>Last reset: {fmtDate(row.last_reset_at)}</span>}
                              {row.created_at     && <span>Created: {fmtDate(row.created_at)}</span>}
                              {row.updated_at     && <span>Updated: {fmtDate(row.updated_at)}</span>}
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
