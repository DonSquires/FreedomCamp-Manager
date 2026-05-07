import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, Compass, ChevronDown, ChevronRight } from 'lucide-react'
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

type PatrolEvent = Database['public']['Tables']['patrol_events']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function PatrolFieldEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [patrolTypeFilter, setPatrolTypeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<PatrolEvent[]>({
    queryKey: ['patrol-field-events-log', orgId, eventTypeFilter, statusFilter, patrolTypeFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('patrol_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('event_timestamp', { ascending: false })
        .limit(600)

      if (eventTypeFilter !== 'all') q = q.eq('event_type', eventTypeFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (patrolTypeFilter !== 'all') q = q.eq('patrol_type', patrolTypeFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const eventTypes = useMemo(() => [...new Set(rows.map((r) => r.event_type).filter(Boolean))].sort(), [rows])
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(), [rows])
  const patrolTypes = useMemo(() => [...new Set(rows.map((r) => r.patrol_type).filter(Boolean))].sort(), [rows])
  const withGpsCount = rows.filter((r) => r.gps_lat != null && r.gps_lng != null).length
  const withPhotosCount = rows.filter((r) => (r.photo_urls?.length ?? 0) > 0).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Compass className="h-6 w-6 text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold">Patrol Field Event Log</h1>
              <p className="text-sm text-muted-foreground">On-patrol recorded events and field observations</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events', value: rows.length, color: 'text-slate-700' },
            { label: 'With GPS', value: withGpsCount, color: 'text-cyan-700' },
            { label: 'With Photos', value: withPhotosCount, color: 'text-blue-700' },
            { label: 'Statuses', value: statuses.length, color: 'text-indigo-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              {eventTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={patrolTypeFilter} onValueChange={setPatrolTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Patrol type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All patrol types</SelectItem>
              {patrolTypes.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No patrol field events found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Patrol Type</TableHead>
                  <TableHead>Case</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.event_timestamp)}</TableCell>
                        <TableCell className="text-sm">{row.event_type}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{row.status}</Badge></TableCell>
                        <TableCell className="text-sm">{row.patrol_type ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.case_id?.slice(0, 8) ?? '—'}…</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>ID: {row.id}</span>
                              <span>Officer: {row.officer_id}</span>
                              <span>Zone: {row.zone_id ?? '—'}</span>
                              <span>GPS: {row.gps_lat ?? '—'}, {row.gps_lng ?? '—'}</span>
                              <span>Created: {fmtDate(row.created_at)}</span>
                            </div>
                            {row.observation_text && (
                              <div>
                                <p className="font-medium text-sm mb-1">Observation</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.observation_text}</p>
                              </div>
                            )}
                            {row.photo_urls && row.photo_urls.length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Photos</p>
                                <div className="space-y-1">
                                  {row.photo_urls.map((url) => (
                                    <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block text-xs text-blue-600 underline break-all">{url}</a>
                                  ))}
                                </div>
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
