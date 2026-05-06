/**
 * ParkingSessionLog — B-84
 * Log of parking_sessions — vehicle parking entries, exits, and violations.
 * Route: /parking-sessions-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ParkingSquare, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, ExternalLink,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ParkingSessionRow = Database['public']['Tables']['parking_sessions']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ParkingSessionLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch]                 = useState('')
  const [filterViolation, setFilterViolation] = useState('all')
  const [filterZone, setFilterZone]         = useState('all')
  const [filterMonth, setFilterMonth]       = useState('all')
  const [expandedId, setExpandedId]         = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: events = [], isLoading, error, refetch } = useQuery<ParkingSessionRow[]>({
    queryKey: ['parking-sessions', orgId],
    queryFn: async () => {
      let q = supabase
        .from('parking_sessions')
        .select('*')
        .order('entry_time', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = events.filter(e => {
    if (filterViolation === 'true'  && !e.is_violation) return false
    if (filterViolation === 'false' && e.is_violation)  return false
    if (filterZone !== 'all' && e.parking_zone_id !== filterZone) return false
    if (filterMonth !== 'all' && e.entry_time?.substring(0, 7) !== filterMonth) return false
    if (search) {
      const s = search.toLowerCase()
      return e.plate_number?.toLowerCase().includes(s)
    }
    return true
  })

  const total       = events.length
  const violations  = events.filter(e => e.is_violation === true).length
  const dwellVals   = events.map(e => e.dwell_minutes).filter(v => v != null) as number[]
  const avgDwell    = dwellVals.length > 0
    ? Math.round(dwellVals.reduce((a, b) => a + b, 0) / dwellVals.length) + ' min'
    : '—'
  const withPhotos  = events.filter(e => e.entry_photo_url || e.exit_photo_url).length

  const zones  = Array.from(new Set(events.map(e => e.parking_zone_id).filter(Boolean)))
  const months = Array.from(new Set(events.map(e => e.entry_time?.substring(0, 7)).filter(Boolean))).sort().reverse()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ParkingSquare className="h-7 w-7 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Parking Session Log</h1>
              <p className="text-sm text-muted-foreground">Vehicle parking entries, exits, and violations</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total',      value: total,      colour: 'text-slate-600' },
            { label: 'Violations', value: violations, colour: violations > 0 ? 'text-red-600' : 'text-muted-foreground' },
            { label: 'Avg Dwell',  value: avgDwell,   colour: 'text-blue-600' },
            { label: 'With Photos',value: withPhotos, colour: 'text-green-600' },
          ].map(({ label, value, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <span className={`text-2xl font-bold ${colour}`}>{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Plate number…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterViolation} onValueChange={setFilterViolation}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Violation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">Violations</SelectItem>
              <SelectItem value="false">No Violation</SelectItem>
            </SelectContent>
          </Select>

          {zones.length > 0 && (
            <Select value={filterZone} onValueChange={setFilterZone}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Zone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Zones</SelectItem>
                {zones.map(z => (
                  <SelectItem key={z} value={z}>{z}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {months.length > 0 && (
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {months.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No parking sessions match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Entry Time</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Dwell (min)</TableHead>
                    <TableHead>Violation</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Photos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => {
                    const isExpanded = expandedId === e.id
                    return (
                      <>
                        <TableRow
                          key={e.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setExpandedId(isExpanded ? null : e.id)}
                        >
                          <TableCell>
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.entry_time)}</TableCell>
                          <TableCell className="font-mono font-semibold">{e.plate_number ?? '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.parking_zone_id ?? '—'}</TableCell>
                          <TableCell className="text-sm">
                            {[e.vehicle_make, e.vehicle_model].filter(Boolean).join(' ') || '—'}
                          </TableCell>
                          <TableCell className="text-sm">{e.dwell_minutes != null ? e.dwell_minutes : '—'}</TableCell>
                          <TableCell>
                            {e.is_violation === true && (
                              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Yes</Badge>
                            )}
                            {e.is_violation === false && (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">No</Badge>
                            )}
                            {e.is_violation == null && <span className="text-muted-foreground text-sm">—</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{e.violation_reason ?? '—'}</TableCell>
                          <TableCell className="text-sm" onClick={ev => ev.stopPropagation()}>
                            <div className="flex gap-1">
                              {e.entry_photo_url && (
                                <a href={e.entry_photo_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                              {e.exit_photo_url && (
                                <a href={e.exit_photo_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                              {!e.entry_photo_url && !e.exit_photo_url && <span className="text-muted-foreground">—</span>}
                            </div>
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${e.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={9} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">GPS Coordinates</p>
                                  <p className="font-mono text-xs">
                                    {e.gps_lat != null ? e.gps_lat.toFixed(6) : '—'}, {e.gps_lng != null ? e.gps_lng.toFixed(6) : '—'}
                                  </p>
                                </div>
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">Tyre Valve Positions</p>
                                  <p className="text-xs">Entry: {e.entry_tyre_valve_pos ?? '—'} / Exit: {e.exit_tyre_valve_pos ?? '—'}</p>
                                </div>
                                {e.notes && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Notes</p>
                                    <p>{e.notes}</p>
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
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
