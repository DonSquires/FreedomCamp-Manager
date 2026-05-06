/**
 * PatrolFieldEventLog — B-118
 *
 * Browseable log of patrol_events: officer field events with GPS coordinates,
 * photo evidence, status tracking, and patrol type classification.
 *
 * Features:
 *  - KPIs: Total / With Photos / With GPS / Unique Officers
 *  - Filters: event_type text / status / patrol_type / date-from
 *  - Expandable row: observation text + GPS + photo links + case/zone refs
 *
 * Route: /patrol-field-events-log — admin / admin_officer / master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  MapPin, RefreshCw, AlertCircle, Loader2,
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

type PatrolEventRow = Database['public']['Tables']['patrol_events']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusTone(s: string | null) {
  switch (s) {
    case 'completed': return 'bg-green-100 text-green-800'
    case 'open': return 'bg-blue-100 text-blue-800'
    case 'cancelled': return 'bg-red-100 text-red-800'
    default: return 'bg-gray-100 text-gray-700'
  }
}

export default function PatrolFieldEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [eventTypeQuery, setEventTypeQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [patrolTypeFilter, setPatrolTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<PatrolEventRow[]>({
    queryKey: ['patrol-field-events-log', orgId, eventTypeQuery, statusFilter, patrolTypeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('patrol_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('event_timestamp', { ascending: false })
        .limit(500)

      if (eventTypeQuery.trim()) q = q.ilike('event_type', `%${eventTypeQuery.trim()}%`)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (patrolTypeFilter !== 'all') q = q.eq('patrol_type', patrolTypeFilter)
      if (dateFrom) q = q.gte('event_timestamp', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const statuses = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const patrolTypes = [...new Set(rows.map(r => r.patrol_type).filter(Boolean))].sort()
  const withPhotosCount = rows.filter(r => Array.isArray(r.photo_urls) && r.photo_urls.length > 0).length
  const withGpsCount = rows.filter(r => r.gps_lat != null && r.gps_lng != null).length
  const uniqueOfficers = new Set(rows.map(r => r.officer_id).filter(Boolean)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Patrol Field Event Log</h1>
              <p className="text-sm text-muted-foreground">Field events logged by officers during patrols, including GPS positions and photo evidence</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events', value: rows.length, colour: 'text-gray-700' },
            { label: 'With Photos', value: withPhotosCount, colour: 'text-violet-700' },
            { label: 'With GPS', value: withGpsCount, colour: 'text-blue-700' },
            { label: 'Unique Officers', value: uniqueOfficers, colour: 'text-green-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={eventTypeQuery}
            onChange={e => setEventTypeQuery(e.target.value)}
            placeholder="Filter event type…"
            className="w-48"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={patrolTypeFilter} onValueChange={setPatrolTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Patrol type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All patrol types</SelectItem>
              {patrolTypes.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
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
                  <TableHead>Event Time</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Patrol Type</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Photos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const photoUrls = Array.isArray(row.photo_urls) ? row.photo_urls as string[] : []
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.event_timestamp)}</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.event_type ?? '—'}</Badge></TableCell>
                        <TableCell><Badge className={statusTone(row.status)}>{row.status ?? '—'}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.patrol_type ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id ? `${row.officer_id.slice(0, 8)}…` : '—'}</TableCell>
                        <TableCell className="text-sm">{photoUrls.length > 0 ? <Badge className="bg-violet-100 text-violet-800">{photoUrls.length}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Event ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Case ID:</span> <span className="font-mono text-xs">{row.case_id ?? '—'}</span></div>
                                <div><span className="font-medium">Zone ID:</span> <span className="font-mono text-xs">{row.zone_id ?? '—'}</span></div>
                                {row.gps_lat != null && row.gps_lng != null && (
                                  <div><span className="font-medium">GPS:</span> <span className="text-muted-foreground">{row.gps_lat.toFixed(6)}, {row.gps_lng.toFixed(6)}</span></div>
                                )}
                              </div>
                              {row.observation_text && (
                                <div>
                                  <p className="font-medium mb-1">Observation:</p>
                                  <p className="text-muted-foreground bg-muted rounded p-3 whitespace-pre-wrap">{row.observation_text}</p>
                                </div>
                              )}
                              {photoUrls.length > 0 && (
                                <div>
                                  <p className="font-medium mb-1">Photos:</p>
                                  <div className="flex flex-wrap gap-2">
                                    {photoUrls.map((url, i) => (
                                      <a key={i} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">
                                        Photo {i + 1} <ExternalLink className="h-3 w-3" />
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
