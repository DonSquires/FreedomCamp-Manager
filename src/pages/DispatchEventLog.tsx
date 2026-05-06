/**
 * DispatchEventLog — B-72
 *
 * Admin timeline log for dispatch_events — lifecycle events for dispatch jobs.
 *
 * Features:
 *  - KPI cards: Total Events / Unique Jobs / Escalation Events / Open Status Events
 *  - Filters: event_type, status, search (notes / case_id)
 *  - Timeline table: event_timestamp, event_type, job, case, status, escalation_level, notes
 *
 * Route: /dispatch-events — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Radio, Search, RefreshCw, AlertCircle, Loader2,
  Zap, Activity, List,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type DispatchEvent = Database['public']['Tables']['dispatch_events']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm:ss') } catch { return ts }
}

function shortId(id: string | null | undefined) {
  if (!id) return '—'
  return id.slice(0, 8) + '…'
}

const EVENT_TYPE_COLOURS: Record<string, string> = {
  created:       'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  acknowledged:  'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  dispatched:    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  en_route:      'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  on_scene:      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  completed:     'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled:     'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  escalated:     'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  sla_breached:  'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200',
  reassigned:    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
}

const STATUS_COLOURS: Record<string, string> = {
  open:       'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress:'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  completed:  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled:  'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  escalated:  'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DispatchEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch]           = useState('')
  const [filterEventType, setFilterEventType] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: events = [], isLoading, error, refetch } = useQuery<DispatchEvent[]>({
    queryKey: ['dispatch-events', orgId],
    queryFn: async () => {
      let q = supabase
        .from('dispatch_events')
        .select('*')
        .order('event_timestamp', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = events.filter(e => {
    if (filterEventType !== 'all' && e.event_type !== filterEventType) return false
    if (filterStatus !== 'all' && e.status !== filterStatus) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        e.notes?.toLowerCase().includes(s) ||
        e.case_id?.toLowerCase().includes(s) ||
        e.dispatch_job_id?.toLowerCase().includes(s) ||
        e.event_type?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total       = events.length
  const uniqueJobs  = new Set(events.map(e => e.dispatch_job_id)).size
  const escalations = events.filter(e => e.event_type === 'escalated' || e.event_type === 'sla_breached').length
  const openStatus  = events.filter(e => e.status === 'open' || e.status === 'in_progress').length

  const eventTypes = Array.from(new Set(events.map(e => e.event_type).filter(Boolean)))
  const statuses   = Array.from(new Set(events.map(e => e.status).filter(Boolean)))

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Radio className="h-7 w-7 text-purple-500" />
            <div>
              <h1 className="text-2xl font-bold">Dispatch Event Log</h1>
              <p className="text-sm text-muted-foreground">Full lifecycle event timeline for dispatch jobs</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Events',     value: total,       icon: List,         colour: 'text-slate-600' },
            { label: 'Unique Jobs',      value: uniqueJobs,  icon: Activity,     colour: 'text-indigo-600' },
            { label: 'Escalation Events',value: escalations, icon: Zap,          colour: escalations > 0 ? 'text-red-600' : 'text-muted-foreground' },
            { label: 'Open / In Progress',value: openStatus, icon: AlertCircle,  colour: openStatus > 0 ? 'text-amber-600' : 'text-muted-foreground' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${colour}`} />
                <span className={`text-2xl font-bold ${colour}`}>{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Notes, job ID, case ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterEventType} onValueChange={setFilterEventType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Event Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Event Types</SelectItem>
              {eventTypes.map(t => (
                <SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {statuses.map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s?.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No events match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Job ID</TableHead>
                    <TableHead>Case ID</TableHead>
                    <TableHead>Escalation</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => (
                    <TableRow
                      key={e.id}
                      className={
                        e.event_type === 'escalated' || e.event_type === 'sla_breached'
                          ? 'bg-red-50/30 dark:bg-red-950/10'
                          : ''
                      }
                    >
                      <TableCell className="text-sm font-mono whitespace-nowrap">{fmtDate(e.event_timestamp)}</TableCell>
                      <TableCell>
                        <Badge className={`capitalize ${EVENT_TYPE_COLOURS[e.event_type] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                          {e.event_type?.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {e.status ? (
                          <Badge className={`capitalize ${STATUS_COLOURS[e.status] ?? ''}`}>
                            {e.status?.replace(/_/g, ' ')}
                          </Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {shortId(e.dispatch_job_id)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {shortId(e.case_id)}
                      </TableCell>
                      <TableCell className="text-center">
                        {e.escalation_level_at_event != null && e.escalation_level_at_event > 0 ? (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                            L{e.escalation_level_at_event}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[240px] truncate">
                        {e.notes ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
