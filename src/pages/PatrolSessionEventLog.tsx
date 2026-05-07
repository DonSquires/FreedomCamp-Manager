/**
 * PatrolSessionEventLog — B-109
 *
 * Log viewer for patrol_session_events — typed events emitted during patrol sessions.
 *
 * Features:
 *  - KPI cards: Total / Checkpoints Scanned / Missed / Patrols Started/Completed
 *  - Filters: event_type (typed enum), date from, officer_id search
 *  - Table: event_type badge, checkpoint_name, officer_id (truncated),
 *           case_id (truncated), event_time
 *  - Expandable row: notes, patrol_route_instance_id, full case_id, full officer_id,
 *                    created_at
 *
 * Route: /patrol-session-events-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  FootprintsIcon, RefreshCw, AlertCircle, Loader2,
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

type PatrolSessionEvent = Database['public']['Tables']['patrol_session_events']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function eventTypeBadge(type: string) {
  if (type === 'patrol_started')    return 'bg-blue-100 text-blue-800'
  if (type === 'checkpoint_scan')   return 'bg-green-100 text-green-800'
  if (type === 'checkpoint_missed') return 'bg-red-100 text-red-800'
  if (type === 'patrol_completed')  return 'bg-purple-100 text-purple-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PatrolSessionEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [typeFilter,    setTypeFilter]    = useState('all')
  const [dateFrom,      setDateFrom]      = useState('')
  const [officerSearch, setOfficerSearch] = useState('')
  const [expandedId,    setExpandedId]    = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<PatrolSessionEvent[]>({
    queryKey: ['patrol-session-events-log', orgId, typeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('patrol_session_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('event_time', { ascending: false })
        .limit(500)

      if (typeFilter !== 'all') q = q.eq('event_type', typeFilter as PatrolSessionEvent['event_type'])
      if (dateFrom)             q = q.gte('event_time', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const filtered = officerSearch
    ? rows.filter(r => r.officer_id.toLowerCase().includes(officerSearch.toLowerCase()))
    : rows

  const scannedCount   = filtered.filter(r => r.event_type === 'checkpoint_scan').length
  const missedCount    = filtered.filter(r => r.event_type === 'checkpoint_missed').length
  const startedCount   = filtered.filter(r => r.event_type === 'patrol_started').length
  const completedCount = filtered.filter(r => r.event_type === 'patrol_completed').length

  const EVENT_TYPES: PatrolSessionEvent['event_type'][] = [
    'patrol_started',
    'checkpoint_scan',
    'checkpoint_missed',
    'patrol_completed',
  ]

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FootprintsIcon className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Patrol Session Event Log</h1>
              <p className="text-sm text-muted-foreground">Typed events emitted during patrol sessions (start, scan, missed, complete)</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Checkpoints Scanned', value: scannedCount,   colour: 'text-green-700' },
            { label: 'Checkpoints Missed',  value: missedCount,    colour: 'text-red-700' },
            { label: 'Patrols Started',     value: startedCount,   colour: 'text-blue-700' },
            { label: 'Patrols Completed',   value: completedCount, colour: 'text-purple-700' },
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
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
          <Input
            placeholder="Filter by officer ID…"
            value={officerSearch}
            onChange={e => setOfficerSearch(e.target.value)}
            className="w-52"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No patrol session events found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Event Type</TableHead>
                  <TableHead>Checkpoint</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Case</TableHead>
                  <TableHead>Event Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${row.event_type === 'checkpoint_missed' ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell>
                          <Badge className={eventTypeBadge(row.event_type)}>
                            {row.event_type.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{row.checkpoint_name ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.case_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.event_time)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Officer: {row.officer_id}</span>
                              <span>Case: {row.case_id}</span>
                              {row.patrol_route_instance_id && <span>Route instance: {row.patrol_route_instance_id.slice(0, 8)}…</span>}
                              {row.created_at && <span>Created: {fmtDate(row.created_at)}</span>}
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
