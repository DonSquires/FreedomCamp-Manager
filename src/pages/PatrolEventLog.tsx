/**
 * PatrolEventLog — B-81
 *
 * Admin log viewer for patrol_events.
 *
 * Features:
 *  - KPI cards: Total / Active / With Photos / Unique Cases
 *  - Filters: event_type select, patrol_type select, status select,
 *             date-range pickers, free-text search (observation_text)
 *  - Table: event_type, patrol_type, officer_id (UUID prefix), zone_id (UUID prefix),
 *           status badge, event_timestamp, photos count
 *  - Expandable row: observation_text, photo_urls list, GPS coords, case_id
 *
 * Route: /patrol-events-log — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Activity, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, Camera, MapPin,
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

type PatrolEvent = Database['public']['Tables']['patrol_events']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string) {
  switch (status) {
    case 'completed':   return <Badge variant="secondary" className="text-xs text-green-700">Completed</Badge>
    case 'active':      return <Badge variant="secondary" className="text-xs text-blue-700">Active</Badge>
    case 'pending':     return <Badge variant="outline" className="text-xs text-amber-700">Pending</Badge>
    case 'cancelled':   return <Badge variant="outline" className="text-xs text-muted-foreground">Cancelled</Badge>
    default:            return <Badge variant="outline" className="text-xs">{status}</Badge>
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PatrolEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch]         = useState('')
  const [eventTypeFilter, setEventType] = useState('all')
  const [patrolTypeFilter, setPatrolType] = useState('all')
  const [statusFilter, setStatus]   = useState('all')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ['patrol-events-log', orgId, eventTypeFilter, patrolTypeFilter, statusFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('patrol_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('event_timestamp', { ascending: false })
        .limit(500)

      if (eventTypeFilter !== 'all') q = q.eq('event_type', eventTypeFilter)
      if (patrolTypeFilter !== 'all') q = q.eq('patrol_type', patrolTypeFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom) q = q.gte('event_timestamp', dateFrom)
      if (dateTo) q = q.lte('event_timestamp', `${dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as PatrolEvent[]
    },
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:        events.length,
    active:       events.filter(e => e.status === 'active').length,
    withPhotos:   events.filter(e => (e.photo_urls ?? []).length > 0).length,
    uniqueCases:  new Set(events.filter(e => e.case_id).map(e => e.case_id)).size,
  }

  // ── Dynamic filter options ─────────────────────────────────────────────────

  const eventTypes   = Array.from(new Set(events.map(e => e.event_type))).sort()
  const patrolTypes  = Array.from(new Set(events.map(e => e.patrol_type).filter(Boolean))).sort()

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = events.filter(e => {
    if (search) {
      const q = search.toLowerCase()
      if (!e.observation_text?.toLowerCase().includes(q)) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Patrol Event Log" description="Review all patrol events linked to operational cases">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-emerald-600" />
          <span className="font-semibold text-lg">Patrol Event Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Events',   value: kpis.total,       icon: <Activity className="h-4 w-4" />,  color: 'text-foreground' },
          { label: 'Active',         value: kpis.active,      icon: <Activity className="h-4 w-4" />,  color: 'text-blue-600' },
          { label: 'With Photos',    value: kpis.withPhotos,  icon: <Camera className="h-4 w-4" />,    color: 'text-amber-600' },
          { label: 'Unique Cases',   value: kpis.uniqueCases, icon: <MapPin className="h-4 w-4" />,    color: 'text-emerald-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search observation text…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={eventTypeFilter} onValueChange={setEventType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {eventTypes.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={patrolTypeFilter} onValueChange={setPatrolType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Patrol type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All patrol types</SelectItem>
            {patrolTypes.map(t => (
              <SelectItem key={t!} value={t!}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-36 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-36 h-9 text-sm"
          />
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && events.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No patrol events found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Event Type</TableHead>
              <TableHead>Patrol Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Officer</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Photos</TableHead>
              <TableHead>Timestamp</TableHead>
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
            {!isLoading && filtered.length === 0 && events.length > 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No events match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(e => {
              const expanded = expandedId === e.id
              const photoCount = (e.photo_urls ?? []).length
              const hasGps = e.gps_lat != null && e.gps_lng != null

              return [
                <TableRow
                  key={e.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : e.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{e.event_type}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.patrol_type ?? '—'}</TableCell>
                  <TableCell>{statusBadge(e.status)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {e.officer_id.slice(0, 8)}…
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {e.zone_id ? `${e.zone_id.slice(0, 8)}…` : '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    {photoCount > 0
                      ? <span className="flex items-center gap-1 text-xs text-amber-700"><Camera className="h-3 w-3" />{photoCount}</span>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(e.event_timestamp)}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${e.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={7} className="py-3 space-y-2 text-sm">
                      {e.observation_text && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Observation</span>
                          <p className="mt-0.5">{e.observation_text}</p>
                        </div>
                      )}
                      {hasGps && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          <span>{e.gps_lat!.toFixed(6)}, {e.gps_lng!.toFixed(6)}</span>
                        </div>
                      )}
                      {photoCount > 0 && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Photos ({photoCount})
                          </span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(e.photo_urls ?? []).map((url, i) => (
                              <a
                                key={i}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-blue-700 underline truncate max-w-60"
                                onClick={ev => ev.stopPropagation()}
                              >
                                Photo {i + 1}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Case: <code className="bg-muted px-1 rounded">{e.case_id.slice(0, 8)}…</code>
                      </div>
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
          Showing {filtered.length} of {events.length} events
        </p>
      )}
    </AppLayout>
  )
}
