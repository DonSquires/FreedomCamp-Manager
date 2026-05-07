/**
 * RadioCommsEventLog — B-106
 *
 * Log viewer for radio_comms_events (View, org-scoped) —
 * radio communication events linked to operational cases.
 *
 * Features:
 *  - KPI cards: Total / Escalated / Degraded Mode / Unique Cases
 *  - Filters: event_type (enum), degraded_mode toggle, date from
 *  - Table: event_type badge, event_timestamp, callsign, channel_scope,
 *           degraded_mode badge, case_id (short)
 *  - Expandable row: officer_id, ptt_session_id, notes
 *
 * Route: /radio-comms-events-log — admin/admin_officer/master
 */

import { useState, Fragment } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Radio, RefreshCw, AlertCircle, Loader2,
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

type RadioCommsEvent = Database['public']['Views']['radio_comms_events']['Row']

type EventType = RadioCommsEvent['event_type']

const EVENT_TYPES: EventType[] = [
  'radio_callsign_bound',
  'dispatch_escalated_to_radio',
  'radio_degraded_mode',
  'radio_channel_left',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function eventTypeBadge(type: EventType) {
  if (type === 'dispatch_escalated_to_radio') return 'bg-red-100 text-red-800'
  if (type === 'radio_degraded_mode')         return 'bg-orange-100 text-orange-800'
  if (type === 'radio_callsign_bound')        return 'bg-blue-100 text-blue-800'
  if (type === 'radio_channel_left')          return 'bg-gray-100 text-gray-700'
  return 'bg-gray-100 text-gray-700'
}

function eventTypeLabel(type: EventType) {
  if (type === 'dispatch_escalated_to_radio') return 'Escalated'
  if (type === 'radio_degraded_mode')         return 'Degraded'
  if (type === 'radio_callsign_bound')        return 'Callsign Bound'
  if (type === 'radio_channel_left')          return 'Channel Left'
  return type
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RadioCommsEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [typeFilter,     setTypeFilter]     = useState<'all' | EventType>('all')
  const [degradedFilter, setDegradedFilter] = useState('all')
  const [dateFrom,       setDateFrom]       = useState('')
  const [expandedId,     setExpandedId]     = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<RadioCommsEvent[]>({
    queryKey: ['radio-comms-events-log', orgId, typeFilter, degradedFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('radio_comms_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('event_timestamp', { ascending: false })
        .limit(500)

      if (typeFilter !== 'all')         q = q.eq('event_type', typeFilter)
      if (degradedFilter === 'yes')     q = q.eq('degraded_mode', true)
      if (degradedFilter === 'no')      q = q.eq('degraded_mode', false)
      if (dateFrom)                     q = q.gte('event_timestamp', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const escalatedCount = rows.filter(r => r.event_type === 'dispatch_escalated_to_radio').length
  const degradedCount  = rows.filter(r => r.degraded_mode).length
  const uniqueCases    = new Set(rows.map(r => r.case_id).filter(Boolean)).size

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Comms Event Log</h1>
              <p className="text-sm text-muted-foreground">Radio communication events linked to operational cases</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events',    value: rows.length,    colour: 'text-gray-700' },
            { label: 'Escalated',       value: escalatedCount, colour: 'text-red-700' },
            { label: 'Degraded Mode',   value: degradedCount,  colour: 'text-orange-700' },
            { label: 'Unique Cases',    value: uniqueCases,    colour: 'text-blue-700' },
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
          <Select value={typeFilter} onValueChange={v => setTypeFilter(v as 'all' | EventType)}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {EVENT_TYPES.map(t => (
                <SelectItem key={t} value={t}>{eventTypeLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={degradedFilter} onValueChange={setDegradedFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Degraded mode" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Degraded only</SelectItem>
              <SelectItem value="no">Normal only</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No radio comms events found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Event Type</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Callsign</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Degraded</TableHead>
                  <TableHead>Case</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className={`cursor-pointer hover:bg-muted/50 ${row.event_type === 'dispatch_escalated_to_radio' ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${eventTypeBadge(row.event_type)}`}>
                            {eventTypeLabel(row.event_type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.event_timestamp)}</TableCell>
                        <TableCell className="font-mono text-sm">{row.callsign ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.channel_scope ?? '—'}
                        </TableCell>
                        <TableCell>
                          {row.degraded_mode ? (
                            <Badge className="bg-orange-100 text-orange-800 text-xs">Degraded</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">Normal</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.case_id.slice(0, 8)}…
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              {row.officer_id    && <span>Officer: {row.officer_id.slice(0, 8)}…</span>}
                              {row.ptt_session_id && <span>PTT session: {row.ptt_session_id.slice(0, 8)}…</span>}
                              {row.created_by    && <span>Created by: {row.created_by.slice(0, 8)}…</span>}
                              <span>Created: {fmtDate(row.created_at)}</span>
                              <span>Full case: {row.case_id}</span>
                            </div>
                            {row.notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Notes</p>
                                <p className="text-sm text-muted-foreground">{row.notes}</p>
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
