import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, Route, ChevronDown, ChevronRight } from 'lucide-react'
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

type PatrolSessionEvent = Database['public']['Tables']['patrol_session_events']['Row']
type PatrolEventType = PatrolSessionEvent['event_type']

const EVENT_TYPES: PatrolEventType[] = [
  'patrol_started',
  'checkpoint_scan',
  'checkpoint_missed',
  'patrol_completed',
]

const typeLabel: Record<PatrolEventType, string> = {
  patrol_started: 'Patrol Started',
  checkpoint_scan: 'Checkpoint Scan',
  checkpoint_missed: 'Checkpoint Missed',
  patrol_completed: 'Patrol Completed',
}

const typeBadge: Record<PatrolEventType, string> = {
  patrol_started: 'bg-blue-100 text-blue-800',
  checkpoint_scan: 'bg-green-100 text-green-800',
  checkpoint_missed: 'bg-red-100 text-red-800',
  patrol_completed: 'bg-purple-100 text-purple-800',
}

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function PatrolSessionEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | PatrolEventType>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<PatrolSessionEvent[]>({
    queryKey: ['patrol-session-events-log', orgId, eventTypeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('patrol_session_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('event_time', { ascending: false })
        .limit(500)

      if (eventTypeFilter !== 'all') q = q.eq('event_type', eventTypeFilter)
      if (dateFrom) q = q.gte('event_time', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const missedCount = rows.filter((r) => r.event_type === 'checkpoint_missed').length
  const completedCount = rows.filter((r) => r.event_type === 'patrol_completed').length
  const uniqueOfficers = new Set(rows.map((r) => r.officer_id)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Route className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Patrol Session Event Log</h1>
              <p className="text-sm text-muted-foreground">Patrol lifecycle and checkpoint events</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events', value: rows.length, color: 'text-slate-700' },
            { label: 'Checkpoint Missed', value: missedCount, color: 'text-red-700' },
            { label: 'Patrol Completed', value: completedCount, color: 'text-purple-700' },
            { label: 'Unique Officers', value: uniqueOfficers, color: 'text-indigo-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={eventTypeFilter} onValueChange={(v) => setEventTypeFilter(v as 'all' | PatrolEventType)}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {EVENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{typeLabel[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-44" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No patrol session events found</p>
          </div>
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
                  <TableHead>Case</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className={`cursor-pointer hover:bg-muted/50 ${row.event_type === 'checkpoint_missed' ? 'bg-red-50/40 dark:bg-red-950/10' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.event_time)}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${typeBadge[row.event_type]}`}>{typeLabel[row.event_type]}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{row.checkpoint_name ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id?.slice(0, 8) ?? '—'}…</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.case_id?.slice(0, 8) ?? '—'}…</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Created: {fmtDate(row.created_at)}</span>
                              <span>Full officer: {row.officer_id ?? '—'}</span>
                              <span>Full case: {row.case_id ?? '—'}</span>
                              <span>Route instance: {row.patrol_route_instance_id ?? '—'}</span>
                            </div>
                            {row.notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Notes</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.notes}</p>
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
