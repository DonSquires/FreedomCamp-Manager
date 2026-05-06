/**
 * WelfareEventB1Log — B-121
 *
 * Officer welfare events log (welfare_events_b1 table).
 * Captures scheduled check-ins, missed check-ins, officer-initiated
 * events, supervisor alerts, and emergency alerts.
 *
 * Features:
 *  - KPIs: Total / Emergency / Missed / Resolved
 *  - Filters: event_type enum / status enum / date-from
 *  - Expandable row: notes + case/patrol refs
 *
 * Route: /welfare-events-log — admin / admin_officer / master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  HeartPulse, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

type WelfareEventRow = Database['public']['Tables']['welfare_events_b1']['Row']
type WelfareEventType = NonNullable<WelfareEventRow['event_type']>
type WelfareEventStatus = NonNullable<WelfareEventRow['status']>

const EVENT_TYPES: WelfareEventType[] = [
  'scheduled_checkin',
  'officer_initiated',
  'supervisor_alert',
  'missed_checkin',
  'emergency_alert',
]

const STATUSES: WelfareEventStatus[] = ['open', 'acknowledged', 'resolved']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function eventTypeTone(et: WelfareEventType | null) {
  switch (et) {
    case 'emergency_alert': return 'bg-red-100 text-red-800'
    case 'missed_checkin': return 'bg-orange-100 text-orange-800'
    case 'supervisor_alert': return 'bg-yellow-100 text-yellow-800'
    case 'officer_initiated': return 'bg-blue-100 text-blue-800'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function statusTone(s: WelfareEventStatus | null) {
  switch (s) {
    case 'resolved': return 'bg-green-100 text-green-800'
    case 'acknowledged': return 'bg-blue-100 text-blue-800'
    case 'open': return 'bg-orange-100 text-orange-800'
    default: return 'bg-gray-100 text-gray-700'
  }
}

export default function WelfareEventB1Log() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | WelfareEventType>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | WelfareEventStatus>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<WelfareEventRow[]>({
    queryKey: ['welfare-events-b1-log', orgId, eventTypeFilter, statusFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('welfare_events_b1')
        .select('*')
        .eq('organization_id', orgId!)
        .order('reported_at', { ascending: false })
        .limit(500)

      if (eventTypeFilter !== 'all') q = q.eq('event_type', eventTypeFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom) q = q.gte('reported_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const emergencyCount = rows.filter(r => r.event_type === 'emergency_alert').length
  const missedCount = rows.filter(r => r.event_type === 'missed_checkin').length
  const resolvedCount = rows.filter(r => r.status === 'resolved').length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HeartPulse className="h-6 w-6 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Welfare Event Log</h1>
              <p className="text-sm text-muted-foreground">Officer welfare events: check-ins, missed check-ins, alerts, and emergencies</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events', value: rows.length, colour: 'text-gray-700' },
            { label: 'Emergency Alerts', value: emergencyCount, colour: 'text-red-700' },
            { label: 'Missed Check-Ins', value: missedCount, colour: 'text-orange-700' },
            { label: 'Resolved', value: resolvedCount, colour: 'text-green-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={eventTypeFilter} onValueChange={v => setEventTypeFilter(v as 'all' | WelfareEventType)}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              {EVENT_TYPES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as 'all' | WelfareEventStatus)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No welfare events found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Reported At</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Resolved At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const isEmergency = row.event_type === 'emergency_alert'
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${isEmergency ? 'bg-red-50/40' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.reported_at)}</TableCell>
                        <TableCell><Badge className={eventTypeTone(row.event_type)}>{row.event_type ?? '—'}</Badge></TableCell>
                        <TableCell><Badge className={statusTone(row.status)}>{row.status ?? '—'}</Badge></TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id ? `${row.officer_id.slice(0, 8)}…` : '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.severity ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(row.resolved_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div><span className="font-medium">Event ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                              <div><span className="font-medium">Case ID:</span> <span className="font-mono text-xs">{row.case_id ?? '—'}</span></div>
                              <div><span className="font-medium">Patrol Instance:</span> <span className="font-mono text-xs">{row.patrol_route_instance_id ?? '—'}</span></div>
                              <div><span className="font-medium">Created By:</span> <span className="font-mono text-xs">{row.created_by ?? '—'}</span></div>
                              <div className="md:col-span-2"><span className="font-medium">Notes:</span> <span className="text-muted-foreground">{row.notes ?? '—'}</span></div>
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
