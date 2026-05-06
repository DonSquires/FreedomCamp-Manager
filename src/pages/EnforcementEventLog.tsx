/**
 * EnforcementEventLog — B-92
 *
 * Log viewer for enforcement_events — per-case enforcement actions and outcomes.
 *
 * Features:
 *  - KPI cards: Total / Open / Closed / Unique Officers
 *  - Filters: event_type (dynamic), status (dynamic), violation_type (dynamic), date from
 *  - Table: case_id, officer_id, event_type badge, subject_type + identifier,
 *           violation_type, status badge, event_timestamp, outcome
 *  - Expandable row: action_taken, evidence_notes, photo URLs
 *
 * Route: /enforcement-events-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Siren, RefreshCw, AlertCircle, Loader2,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type EnforcementEvent = Database['public']['Tables']['enforcement_events']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string) {
  if (status === 'open')       return 'bg-blue-100 text-blue-800'
  if (status === 'closed')     return 'bg-gray-100 text-gray-700'
  if (status === 'resolved')   return 'bg-green-100 text-green-800'
  if (status === 'escalated')  return 'bg-red-100 text-red-800'
  return 'bg-yellow-100 text-yellow-800'
}

function eventTypeBadge(type: string) {
  const colours: Record<string, string> = {
    warning:       'bg-yellow-100 text-yellow-800',
    infringement:  'bg-orange-100 text-orange-800',
    arrest:        'bg-red-100 text-red-800',
    caution:       'bg-blue-100 text-blue-800',
    trespass:      'bg-purple-100 text-purple-800',
  }
  return colours[type] ?? 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EnforcementEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [eventTypeFilter,    setEventTypeFilter]    = useState('all')
  const [statusFilter,       setStatusFilter]       = useState('all')
  const [violationTypeFilter, setViolationTypeFilter] = useState('all')
  const [dateFrom,           setDateFrom]           = useState('')
  const [expandedId,         setExpandedId]         = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<EnforcementEvent[]>({
    queryKey: ['enforcement-events-log', orgId, eventTypeFilter, statusFilter, violationTypeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('enforcement_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('event_timestamp', { ascending: false })
        .limit(500)

      if (eventTypeFilter     !== 'all') q = q.eq('event_type', eventTypeFilter)
      if (statusFilter        !== 'all') q = q.eq('status', statusFilter)
      if (violationTypeFilter !== 'all') q = q.eq('violation_type', violationTypeFilter)
      if (dateFrom)                      q = q.gte('event_timestamp', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const eventTypes     = [...new Set(rows.map(r => r.event_type).filter(Boolean))].sort()
  const statusTypes    = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const violationTypes = [...new Set(rows.map(r => r.violation_type).filter(Boolean))].sort()
  const uniqueOfficers = new Set(rows.map(r => r.officer_id).filter(Boolean)).size
  const openCount      = rows.filter(r => r.status === 'open').length
  const closedCount    = rows.filter(r => r.status === 'closed' || r.status === 'resolved').length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Siren className="h-6 w-6 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Enforcement Event Log</h1>
              <p className="text-sm text-muted-foreground">Per-case enforcement actions, outcomes and evidence</p>
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
            { label: 'Open',            value: openCount,      colour: 'text-blue-700' },
            { label: 'Closed/Resolved', value: closedCount,    colour: 'text-green-700' },
            { label: 'Unique Officers', value: uniqueOfficers, colour: 'text-purple-700' },
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
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              {eventTypes.map(t => (
                <SelectItem key={t} value={t}>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs mr-1 ${eventTypeBadge(t)}`}>{t}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusTypes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={violationTypeFilter} onValueChange={setViolationTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Violation type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All violation types</SelectItem>
              {violationTypes.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
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
            <AlertCircle className="h-8 w-8" /><p>No enforcement events found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Case ID</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Violation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Event Time</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.case_id ? `${row.case_id.slice(0, 8)}…` : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge className={eventTypeBadge(row.event_type)}>{row.event_type}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.subject_type && (
                            <span className="text-muted-foreground mr-1">{row.subject_type}:</span>
                          )}
                          {row.subject_identifier ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">{row.violation_type ?? '—'}</TableCell>
                        <TableCell>
                          <Badge className={statusBadge(row.status)}>{row.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.event_timestamp)}</TableCell>
                        <TableCell className="text-sm">{row.outcome ?? '—'}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4 space-y-3">
                            {row.action_taken && (
                              <div>
                                <p className="font-medium text-sm mb-1">Action Taken</p>
                                <p className="text-sm text-muted-foreground">{row.action_taken}</p>
                              </div>
                            )}
                            {row.evidence_notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Evidence Notes</p>
                                <p className="text-sm text-muted-foreground">{row.evidence_notes}</p>
                              </div>
                            )}
                            {row.photo_urls && row.photo_urls.length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Photos</p>
                                <div className="flex flex-wrap gap-2">
                                  {row.photo_urls.map((url, i) => (
                                    <a
                                      key={i}
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                      Photo {i + 1}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground">
                              Officer: <span className="font-mono">{row.officer_id ? `${row.officer_id.slice(0, 8)}…` : '—'}</span>
                              {' · '}Created: {fmtDate(row.created_at)}
                              {' · '}Updated: {fmtDate(row.updated_at)}
                            </p>
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
