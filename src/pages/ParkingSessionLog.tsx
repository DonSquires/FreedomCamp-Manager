/**
 * ParkingSessionLog — B-84
 *
 * Log viewer for parking_sessions with violation filter and avg dwell KPI.
 *
 * Features:
 *  - KPI cards: Total / Violations / Avg Dwell (mins)
 *  - Filters: is_violation toggle, plate search, date range
 *  - Table: plate, vehicle (make/model/colour), pass_number, is_violation, entry_time, dwell_minutes, zone
 *  - Expandable row: violation_reason, GPS, photo links (entry/exit/sign/tyre)
 *
 * Route: /parking-sessions-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ParkingSquare, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, Image as ImageIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
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

type ParkingSession = Database['public']['Tables']['parking_sessions']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParkingSessionLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [plateSearch, setPlateSearch]       = useState('')
  const [violationOnly, setViolationOnly]   = useState(false)
  const [dateFrom, setDateFrom]             = useState('')
  const [expandedId, setExpandedId]         = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<ParkingSession[]>({
    queryKey: ['parking-sessions-log', orgId, violationOnly, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('parking_sessions')
        .select('*')
        .eq('organization_id', orgId!)
        .order('entry_time', { ascending: false })
        .limit(500)

      if (violationOnly) q = q.eq('is_violation', true)
      if (dateFrom)      q = q.gte('entry_time', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const displayed = plateSearch
    ? rows.filter(r => r.plate_number.toLowerCase().includes(plateSearch.toLowerCase()))
    : rows

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total      = rows.length
  const violations = rows.filter(r => r.is_violation).length
  const dwellVals  = rows.map(r => r.dwell_minutes).filter(v => v != null) as number[]
  const avgDwell   = dwellVals.length > 0
    ? (dwellVals.reduce((a, b) => a + b, 0) / dwellVals.length).toFixed(0)
    : '—'

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ParkingSquare className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Parking Session Log</h1>
              <p className="text-sm text-muted-foreground">Vehicle parking sessions and violations</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total',          value: total,      colour: 'text-gray-700' },
            { label: 'Violations',     value: violations, colour: 'text-red-700' },
            { label: 'Avg Dwell (min)',value: avgDwell,   colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <Input placeholder="Search plate…" value={plateSearch} onChange={e => setPlateSearch(e.target.value)} className="w-44" />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
          <div className="flex items-center gap-2">
            <Checkbox id="viol" checked={violationOnly} onCheckedChange={v => setViolationOnly(!!v)} />
            <Label htmlFor="viol" className="text-sm cursor-pointer">Violations only</Label>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No parking sessions found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Plate</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Pass #</TableHead>
                  <TableHead>Violation</TableHead>
                  <TableHead>Entry Time</TableHead>
                  <TableHead>Dwell (min)</TableHead>
                  <TableHead>Zone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map(row => {
                  const expanded = expandedId === row.id
                  const vehicleDesc = [row.vehicle_make, row.vehicle_model, row.vehicle_colour].filter(Boolean).join(' ') || '—'
                  const photoCount = [row.entry_photo_url, row.exit_photo_url, row.sign_photo_url, row.tyre_valve_photo_url].filter(Boolean).length
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-mono font-semibold">{row.plate_number}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{vehicleDesc}</TableCell>
                        <TableCell className="text-sm">{row.pass_number}</TableCell>
                        <TableCell>
                          {row.is_violation
                            ? <Badge className="bg-red-100 text-red-800">Violation</Badge>
                            : <Badge className="bg-green-100 text-green-800">OK</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.entry_time)}</TableCell>
                        <TableCell className="text-sm">{row.dwell_minutes ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.parking_zone_id ?? '—'}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">Violation Reason</p>
                                <p className="text-muted-foreground">{row.violation_reason ?? 'None'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Exit Time</p>
                                <p className="text-muted-foreground">{fmtDate(row.exit_time)}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">GPS</p>
                                <p className="text-muted-foreground">
                                  {row.gps_lat != null && row.gps_lng != null
                                    ? `${row.gps_lat.toFixed(5)}, ${row.gps_lng.toFixed(5)}`
                                    : '—'}
                                </p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Notes</p>
                                <p className="text-muted-foreground">{row.notes ?? 'None'}</p>
                              </div>
                              {photoCount > 0 && (
                                <div className="col-span-4">
                                  <p className="font-medium mb-1">Photos</p>
                                  <div className="flex flex-wrap gap-2">
                                    {row.entry_photo_url && <a href={row.entry_photo_url} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs flex items-center gap-1"><ImageIcon className="h-3 w-3" />Entry</a>}
                                    {row.exit_photo_url && <a href={row.exit_photo_url} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs flex items-center gap-1"><ImageIcon className="h-3 w-3" />Exit</a>}
                                    {row.sign_photo_url && <a href={row.sign_photo_url} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs flex items-center gap-1"><ImageIcon className="h-3 w-3" />Sign</a>}
                                    {row.tyre_valve_photo_url && <a href={row.tyre_valve_photo_url} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs flex items-center gap-1"><ImageIcon className="h-3 w-3" />Tyre</a>}
                                  </div>
                                </div>
                              )}
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
