/**
 * ParkingSessionLog — B-84
 *
 * Admin log viewer for parking_sessions.
 *
 * Features:
 *  - KPI cards: Total Sessions / Violations / Avg Dwell (min) / Unique Plates
 *  - Filters: violation toggle, plate search, date-range pickers
 *  - Table: plate_number, vehicle_make/colour, parking_zone_id (UUID prefix),
 *           pass_number, is_violation badge, dwell_minutes, entry_time
 *  - Expandable row: violation_reason, GPS, entry/exit photos, officer_id, notes
 *
 * Route: /parking-sessions-log — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ParkingSquare, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, Clock, Camera,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import type { Database } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type ParkingSession = Database['public']['Tables']['parking_sessions']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function violationBadge(isViolation: boolean) {
  return isViolation
    ? <Badge variant="destructive" className="text-xs">Violation</Badge>
    : <Badge variant="secondary" className="text-xs text-green-700">OK</Badge>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParkingSessionLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [plateSearch, setPlateSearch]     = useState('')
  const [violationFilter, setViolation]   = useState('all')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState('')
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data: sessions = [], isLoading, refetch } = useQuery({
    queryKey: ['parking-sessions-log', orgId, violationFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('parking_sessions')
        .select('*')
        .eq('organization_id', orgId!)
        .order('entry_time', { ascending: false })
        .limit(500)

      if (violationFilter === 'violation') q = q.eq('is_violation', true)
      if (violationFilter === 'ok')        q = q.eq('is_violation', false)
      if (dateFrom) q = q.gte('entry_time', dateFrom)
      if (dateTo)   q = q.lte('entry_time', `${dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as ParkingSession[]
    },
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const dwellValues = sessions.map(s => s.dwell_minutes).filter(d => d != null) as number[]
  const avgDwell = dwellValues.length ? Math.round(dwellValues.reduce((a, b) => a + b, 0) / dwellValues.length) : 0

  const kpis = {
    total:       sessions.length,
    violations:  sessions.filter(s => s.is_violation).length,
    avgDwell,
    uniquePlates: new Set(sessions.map(s => s.plate_number)).size,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = sessions.filter(s => {
    if (plateSearch) {
      if (!s.plate_number.toLowerCase().includes(plateSearch.toLowerCase())) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Parking Session Log" description="Review all parking sessions and violations for this organisation">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ParkingSquare className="h-5 w-5 text-orange-600" />
          <span className="font-semibold text-lg">Parking Session Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Sessions',  value: kpis.total,       icon: <ParkingSquare className="h-4 w-4" />, color: 'text-foreground',  suffix: '' },
          { label: 'Violations',      value: kpis.violations,  icon: <AlertCircle className="h-4 w-4" />,   color: 'text-red-600',     suffix: '' },
          { label: 'Avg Dwell',       value: kpis.avgDwell,    icon: <Clock className="h-4 w-4" />,         color: 'text-blue-600',    suffix: ' min' },
          { label: 'Unique Plates',   value: kpis.uniquePlates,icon: <ParkingSquare className="h-4 w-4" />, color: 'text-orange-600',  suffix: '' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}{k.suffix}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search plate number…"
            value={plateSearch}
            onChange={e => setPlateSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={violationFilter} onValueChange={setViolation}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Violation" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sessions</SelectItem>
            <SelectItem value="violation">Violations only</SelectItem>
            <SelectItem value="ok">No violation</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && sessions.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No parking sessions found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Plate</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Pass #</TableHead>
              <TableHead>Violation</TableHead>
              <TableHead>Dwell</TableHead>
              <TableHead>Entry Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && sessions.length > 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No sessions match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(s => {
              const expanded = expandedId === s.id
              const vehicleDesc = [s.vehicle_make, s.vehicle_colour].filter(Boolean).join(' · ')
              const hasPhotos = s.entry_photo_url || s.exit_photo_url || s.sign_photo_url || s.tyre_valve_photo_url

              return [
                <TableRow
                  key={s.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : s.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-mono font-semibold text-sm">{s.plate_number}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{vehicleDesc || '—'}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.parking_zone_id ? `${s.parking_zone_id.slice(0, 8)}…` : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-center">{s.pass_number}</TableCell>
                  <TableCell>{violationBadge(s.is_violation)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.dwell_minutes != null ? `${s.dwell_minutes} min` : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(s.entry_time)}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${s.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={7} className="py-3 space-y-2 text-sm">
                      {s.violation_reason && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Violation Reason</span>
                          <p className="mt-0.5">{s.violation_reason}</p>
                        </div>
                      )}
                      {s.notes && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</span>
                          <p className="mt-0.5">{s.notes}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        {s.exit_time && <span>Exit: {fmtDate(s.exit_time)}</span>}
                        {s.gps_lat != null && s.gps_lng != null && <span>GPS: {s.gps_lat.toFixed(5)}, {s.gps_lng.toFixed(5)}</span>}
                        {s.officer_id && <span>Officer: <code className="bg-muted px-1 rounded">{s.officer_id.slice(0, 8)}…</code></span>}
                        {s.entry_tyre_valve_pos && <span>Entry tyre valve: {s.entry_tyre_valve_pos}</span>}
                        {s.exit_tyre_valve_pos && <span>Exit tyre valve: {s.exit_tyre_valve_pos}</span>}
                      </div>
                      {hasPhotos && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            <Camera className="h-3 w-3 inline mr-1" />Photos
                          </span>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {s.entry_photo_url && <a href={s.entry_photo_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 underline">Entry</a>}
                            {s.exit_photo_url && <a href={s.exit_photo_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 underline">Exit</a>}
                            {s.sign_photo_url && <a href={s.sign_photo_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 underline">Sign</a>}
                            {s.tyre_valve_photo_url && <a href={s.tyre_valve_photo_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 underline">Tyre Valve</a>}
                          </div>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ),
              ]
            })}
          </TableBody>
        </Table>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {sessions.length} sessions
        </p>
      )}
    </AppLayout>
  )
}
