import { useState } from 'react'
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

type RadioCommsRow = Database['public']['Views']['radio_comms_events']['Row']

const EVENT_TYPE_OPTIONS = [
  'radio_callsign_bound',
  'dispatch_escalated_to_radio',
  'radio_degraded_mode',
  'radio_channel_left',
]

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function eventTypeTone(et: string | null) {
  switch (et) {
    case 'dispatch_escalated_to_radio': return 'bg-red-100 text-red-800'
    case 'radio_degraded_mode': return 'bg-orange-100 text-orange-800'
    case 'radio_callsign_bound': return 'bg-blue-100 text-blue-800'
    default: return 'bg-gray-100 text-gray-700'
  }
}

export default function RadioCommsEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const [degradedFilter, setDegradedFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<RadioCommsRow[]>({
    queryKey: ['radio-comms-event-log', orgId, eventTypeFilter, degradedFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('radio_comms_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('event_timestamp', { ascending: false })
        .limit(500)

      if (eventTypeFilter !== 'all') q = q.eq('event_type', eventTypeFilter as RadioCommsRow['event_type'])
      if (degradedFilter === 'yes') q = q.eq('degraded_mode', true)
      if (degradedFilter === 'no') q = q.eq('degraded_mode', false)
      if (dateFrom) q = q.gte('event_timestamp', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const escalatedCount = rows.filter(r => r.event_type === 'dispatch_escalated_to_radio').length
  const degradedCount = rows.filter(r => r.degraded_mode).length
  const withNotesCount = rows.filter(r => !!r.notes).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Comms Event Log</h1>
              <p className="text-sm text-muted-foreground">Radio communication events: callsign bindings, escalations, and degraded-mode entries</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events', value: rows.length, colour: 'text-gray-700' },
            { label: 'Escalated to Radio', value: escalatedCount, colour: 'text-red-700' },
            { label: 'Degraded Mode', value: degradedCount, colour: 'text-orange-700' },
            { label: 'With Notes', value: withNotesCount, colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              {EVENT_TYPE_OPTIONS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={degradedFilter} onValueChange={setDegradedFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Degraded mode" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modes</SelectItem>
              <SelectItem value="yes">Degraded only</SelectItem>
              <SelectItem value="no">Normal only</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No radio comms events found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Callsign</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Degraded</TableHead>
                  <TableHead>PTT Session</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.event_timestamp)}</TableCell>
                        <TableCell><Badge className={eventTypeTone(row.event_type)}>{row.event_type}</Badge></TableCell>
                        <TableCell className="text-sm">{row.callsign ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.channel_scope ?? '—'}</TableCell>
                        <TableCell>{row.degraded_mode ? <Badge className="bg-orange-100 text-orange-800">Yes</Badge> : <span className="text-muted-foreground text-xs">No</span>}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.ptt_session_id ? `${row.ptt_session_id.slice(0, 8)}…` : '—'}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div><span className="font-medium">Event ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                              <div><span className="font-medium">Case ID:</span> <span className="font-mono text-xs">{row.case_id}</span></div>
                              <div><span className="font-medium">Officer:</span> <span className="font-mono text-xs">{row.officer_id ?? '—'}</span></div>
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
