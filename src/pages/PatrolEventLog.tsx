/**
 * PatrolEventLog — B-59
 *
 * Browseable log of patrol_session_events — checkpoint scans, missed
 * checkpoints, patrol starts and completions — across all officers.
 *
 * Features:
 *  - KPI cards: Total today / Checkpoints Scanned / Missed / Patrols Started
 *  - Filters: event type, officer, date range, case ID search
 *  - Sortable table; expandable row shows notes + patrol route instance
 *
 * Route: /patrol-events  — admin / admin_officer / master
 * patrol_session_events is fully typed in database.ts
 */

import { useState } from 'react'
import { format, parseISO, isToday } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import {
  Route, CheckCircle2, AlertCircle, Play, Loader2,
  RefreshCw, ChevronDown, ChevronUp, Users, Calendar,
} from 'lucide-react'

import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

// ─── Types ────────────────────────────────────────────────────────────────────

type PatrolEvent = Database['public']['Tables']['patrol_session_events']['Row']
type EventType = PatrolEvent['event_type']

// ─── Config ────────────────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<EventType, { label: string; colour: string; Icon: React.ElementType }> = {
  patrol_started:    { label: 'Patrol Started',    colour: 'text-blue-700 bg-blue-50 dark:bg-blue-900/30',    Icon: Play         },
  checkpoint_scan:   { label: 'Checkpoint Scan',   colour: 'text-green-700 bg-green-50 dark:bg-green-900/30', Icon: CheckCircle2 },
  checkpoint_missed: { label: 'Checkpoint Missed', colour: 'text-red-700 bg-red-50 dark:bg-red-900/30',       Icon: AlertCircle  },
  patrol_completed:  { label: 'Patrol Completed',  colour: 'text-purple-700 bg-purple-50 dark:bg-purple-900/30', Icon: CheckCircle2 },
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PatrolEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const [officerSearch, setOfficerSearch] = useState('')
  const [caseSearch, setCaseSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: events = [], isLoading, error, refetch } = useQuery<PatrolEvent[]>({
    queryKey: ['patrol_events', orgId, eventTypeFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('patrol_session_events')
        .select('*')
        .eq('organization_id', orgId as string)
        .order('event_time', { ascending: false })
        .limit(500)

      if (eventTypeFilter !== 'all') q = q.eq('event_type', eventTypeFilter as EventType)
      if (dateFrom)                  q = q.gte('event_time', dateFrom)
      if (dateTo)                    q = q.lte('event_time', dateTo + 'T23:59:59')

      const { data, error } = await q
      if (error) throw error
      return data as PatrolEvent[]
    },
  })

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtered = events.filter(e => {
    if (officerSearch && !e.officer_id.toLowerCase().includes(officerSearch.toLowerCase())) return false
    if (caseSearch    && !e.case_id.toLowerCase().includes(caseSearch.toLowerCase()))       return false
    return true
  })

  const kpi = {
    today:    events.filter(e => e.created_at && isToday(parseISO(e.created_at))).length,
    scanned:  events.filter(e => e.event_type === 'checkpoint_scan').length,
    missed:   events.filter(e => e.event_type === 'checkpoint_missed').length,
    started:  events.filter(e => e.event_type === 'patrol_started').length,
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Route className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Patrol Event Log</h1>
              <p className="text-sm text-muted-foreground">Checkpoint scans, missed checkpoints, and patrol lifecycle events</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Today</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-indigo-600">{kpi.today}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Play className="h-3.5 w-3.5" /> Patrols Started</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-blue-600">{kpi.started}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Checkpoints Scanned</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-green-600">{kpi.scanned}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" /> Checkpoints Missed</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-red-600">{kpi.missed}</p></CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Event Type</Label>
                <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {Object.entries(EVENT_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Officer ID</Label>
                <Input placeholder="Filter by officer ID…" value={officerSearch} onChange={e => setOfficerSearch(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Case ID</Label>
                <Input placeholder="Filter by case ID…" value={caseSearch} onChange={e => setCaseSearch(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive py-8 justify-center"><AlertCircle className="h-5 w-5" /> Failed to load patrol events.</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Route className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No patrol events match your filters.</p>
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Event Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Checkpoint</TableHead>
                  <TableHead>Officer ID</TableHead>
                  <TableHead>Case ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(evt => {
                  const expanded = expandedId === evt.id
                  const cfg = EVENT_CONFIG[evt.event_type]
                  return (
                    <>
                      <TableRow
                        key={evt.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : evt.id)}
                      >
                        <TableCell className="py-2">
                          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(parseISO(evt.event_time), 'dd MMM yyyy HH:mm')}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.colour}`}>
                            <cfg.Icon className="h-3 w-3" />{cfg.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{evt.checkpoint_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="font-mono text-xs">{evt.officer_id.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs">{evt.case_id.slice(0, 8)}…</TableCell>
                      </TableRow>

                      {expanded && (
                        <TableRow key={`${evt.id}-detail`} className="bg-muted/30">
                          <TableCell colSpan={6} className="py-4 px-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-1">Officer</p>
                                <p className="font-mono">{evt.officer_id}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-1">Case</p>
                                <p className="font-mono">{evt.case_id}</p>
                              </div>
                              {evt.patrol_route_instance_id && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">Route Instance</p>
                                  <p className="font-mono">{evt.patrol_route_instance_id}</p>
                                </div>
                              )}
                              {evt.notes && (
                                <div className="md:col-span-3">
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">Notes</p>
                                  <p className="bg-background rounded border p-2">{evt.notes}</p>
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
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
