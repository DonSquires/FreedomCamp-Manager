/**
 * PatrolEventLog — B-81
 *
 * Log viewer for patrol_events — field patrol observations and events.
 *
 * Features:
 *  - KPI cards: Total / Open / Closed
 *  - Filters: event_type, patrol_type, status, date range
 *  - Table: event_type, patrol_type, status, officer_id, event_timestamp, zone
 *  - Expandable row: observation_text, photo links, GPS coords
 *
 * Route: /patrol-events-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  MapPinCheck, RefreshCw, AlertCircle, Loader2,
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

type PatrolEvent = Database['public']['Tables']['patrol_events']['Row']

// ─── Styling maps ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  open:     { label: 'Open',     className: 'bg-yellow-100 text-yellow-800' },
  closed:   { label: 'Closed',   className: 'bg-gray-100 text-gray-600' },
  resolved: { label: 'Resolved', className: 'bg-green-100 text-green-800' },
  pending:  { label: 'Pending',  className: 'bg-blue-100 text-blue-800' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PatrolEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [typeFilter, setTypeFilter]   = useState('all')
  const [patrolFilter, setPatrolFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom]       = useState('')
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<PatrolEvent[]>({
    queryKey: ['patrol-events-log', orgId, typeFilter, patrolFilter, statusFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('patrol_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('event_timestamp', { ascending: false })
        .limit(500)

      if (typeFilter !== 'all')   q = q.eq('event_type', typeFilter)
      if (patrolFilter !== 'all') q = q.eq('patrol_type', patrolFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom)               q = q.gte('event_timestamp', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const eventTypes  = [...new Set(rows.map(r => r.event_type).filter(Boolean))].sort()
  const patrolTypes = [...new Set(rows.map(r => r.patrol_type).filter(Boolean))].sort()

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total  = rows.length
  const open   = rows.filter(r => r.status === 'open').length
  const closed = rows.filter(r => r.status === 'closed' || r.status === 'resolved').length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPinCheck className="h-6 w-6 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold">Patrol Event Log</h1>
              <p className="text-sm text-muted-foreground">Field patrol events and observations</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total',  value: total,  colour: 'text-gray-700' },
            { label: 'Open',   value: open,   colour: 'text-yellow-700' },
            { label: 'Closed', value: closed, colour: 'text-gray-500' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              {eventTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={patrolFilter} onValueChange={setPatrolFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Patrol type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All patrol types</SelectItem>
              {patrolTypes.map(t => <SelectItem key={t!} value={t!}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_STYLES).map(([v, s]) => <SelectItem key={v} value={v}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No patrol events found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Event Type</TableHead>
                  <TableHead>Patrol Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Photos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const statusStyle = STATUS_STYLES[row.status] ?? { label: row.status, className: 'bg-gray-100 text-gray-600' }
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-medium">{row.event_type}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.patrol_type ?? '—'}</TableCell>
                        <TableCell><Badge className={statusStyle.className}>{statusStyle.label}</Badge></TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{row.officer_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.event_timestamp)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.zone_id ?? '—'}</TableCell>
                        <TableCell>
                          {row.photo_urls && row.photo_urls.length > 0 && (
                            <Badge variant="outline"><ImageIcon className="h-3 w-3 mr-1" />{row.photo_urls.length}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">Observation</p>
                                <p className="text-muted-foreground">{row.observation_text ?? 'None'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">GPS</p>
                                <p className="text-muted-foreground">
                                  {row.gps_lat != null && row.gps_lng != null
                                    ? `${row.gps_lat.toFixed(6)}, ${row.gps_lng.toFixed(6)}`
                                    : '—'}
                                </p>
                              </div>
                              {row.photo_urls && row.photo_urls.length > 0 && (
                                <div className="md:col-span-2">
                                  <p className="font-medium mb-1">Photo Links</p>
                                  <div className="flex flex-wrap gap-2">
                                    {row.photo_urls.map((url, i) => (
                                      <a key={i} href={url} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">
                                        Photo {i + 1}
                                      </a>
                                    ))}
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
