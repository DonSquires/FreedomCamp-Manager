import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Activity, RefreshCw, AlertCircle, Loader2,
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

type PatrolSessionEventRow = Database['public']['Tables']['patrol_session_events']['Row']
type PatrolSessionEventType = NonNullable<PatrolSessionEventRow['event_type']>

const MISSED_EVENT_TYPES = ['missed_patrol', 'checkpoint_missed', 'patrol_missed']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function PatrolSessionEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<PatrolSessionEventRow[]>({
    queryKey: ['patrol-session-events-log', orgId, eventTypeFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('patrol_session_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('event_time', { ascending: false })
        .limit(500)

      if (eventTypeFilter !== 'all') q = q.eq('event_type', eventTypeFilter as PatrolSessionEventType)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const eventTypes = [...new Set(rows.map(r => r.event_type).filter(Boolean))].sort()
  const missedCount = rows.filter(r => MISSED_EVENT_TYPES.includes((r.event_type ?? '').toLowerCase())).length
  const withNotesCount = rows.filter(r => !!r.notes).length
  const uniqueOfficers = new Set(rows.map(r => r.officer_id).filter(Boolean)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Patrol Session Event Log</h1>
              <p className="text-sm text-muted-foreground">Events recorded during patrol route instances, including checkpoints and missed patrols</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events', value: rows.length, colour: 'text-gray-700' },
            { label: 'Missed Patrols', value: missedCount, colour: 'text-red-700' },
            { label: 'Unique Officers', value: uniqueOfficers, colour: 'text-blue-700' },
            { label: 'With Notes', value: withNotesCount, colour: 'text-violet-700' },
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
              {eventTypes.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No patrol session events found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Event Time</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Checkpoint</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Case ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const isMissed = MISSED_EVENT_TYPES.includes((row.event_type ?? '').toLowerCase())
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${isMissed ? 'bg-red-50/50' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.event_time)}</TableCell>
                        <TableCell>
                          <Badge className={isMissed ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}>
                            {row.event_type ?? '—'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{row.checkpoint_name ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id ? `${row.officer_id.slice(0, 8)}…` : '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.case_id ? `${row.case_id.slice(0, 8)}…` : '—'}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div><span className="font-medium">Event ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                              <div><span className="font-medium">Patrol Route Instance:</span> <span className="font-mono text-xs">{row.patrol_route_instance_id ? `${row.patrol_route_instance_id.slice(0, 8)}…` : '—'}</span></div>
                              <div><span className="font-medium">Recorded At:</span> <span className="text-muted-foreground">{fmtDate(row.created_at)}</span></div>
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
