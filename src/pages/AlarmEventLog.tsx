/**
 * AlarmEventLog — B-95
 *
 * Log viewer for alarm_events — alarm incidents received from integrated systems.
 *
 * Features:
 *  - KPI cards: Total / Open / Acknowledged / Critical/High
 *  - Filters: alarm_type (dynamic), severity (dynamic), status (dynamic), date from
 *  - Table: source_system, alarm_type badge, severity badge, status badge,
 *           address, trigger_time, acknowledged_by
 *  - Actions: Acknowledge (sets acknowledged_at + acknowledged_by)
 *  - Expandable row: notes, raw_payload JSON, zone_id, linked_incident_id
 *
 * Route: /alarm-events-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  BellRing, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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

type AlarmEvent = Database['public']['Tables']['alarm_events']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function severityBadge(severity: string) {
  if (severity === 'critical') return 'bg-red-200 text-red-900'
  if (severity === 'high')     return 'bg-red-100 text-red-800'
  if (severity === 'medium')   return 'bg-yellow-100 text-yellow-800'
  if (severity === 'low')      return 'bg-green-100 text-green-800'
  return 'bg-gray-100 text-gray-700'
}

function statusBadge(status: string) {
  if (status === 'open')         return 'bg-blue-100 text-blue-800'
  if (status === 'acknowledged') return 'bg-purple-100 text-purple-800'
  if (status === 'resolved')     return 'bg-green-100 text-green-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlarmEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [alarmTypeFilter, setAlarmTypeFilter] = useState('all')
  const [severityFilter,  setSeverityFilter]  = useState('all')
  const [statusFilter,    setStatusFilter]    = useState('all')
  const [dateFrom,        setDateFrom]        = useState('')
  const [expandedId,      setExpandedId]      = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<AlarmEvent[]>({
    queryKey: ['alarm-events-log', orgId, alarmTypeFilter, severityFilter, statusFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('alarm_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('trigger_time', { ascending: false })
        .limit(500)

      if (alarmTypeFilter !== 'all') q = q.eq('alarm_type', alarmTypeFilter)
      if (severityFilter  !== 'all') q = q.eq('severity', severityFilter)
      if (statusFilter    !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom)                  q = q.gte('trigger_time', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // ── Acknowledge mutation ───────────────────────────────────────────────────

  const acknowledge = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('alarm_events')
        .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by: user?.id ?? null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Alarm acknowledged')
      qc.invalidateQueries({ queryKey: ['alarm-events-log'] })
    },
    onError: () => toast.error('Failed to acknowledge alarm'),
  })

  const alarmTypes  = [...new Set(rows.map(r => r.alarm_type).filter(Boolean))].sort()
  const severities  = [...new Set(rows.map(r => r.severity).filter(Boolean))].sort()
  const statusTypes = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const openCount   = rows.filter(r => r.status === 'open').length
  const ackCount    = rows.filter(r => r.status === 'acknowledged').length
  const critHigh    = rows.filter(r => r.severity === 'critical' || r.severity === 'high').length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BellRing className="h-6 w-6 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Alarm Event Log</h1>
              <p className="text-sm text-muted-foreground">Alarm incidents from integrated monitoring systems</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Alarms',   value: rows.length, colour: 'text-gray-700' },
            { label: 'Open',           value: openCount,   colour: 'text-blue-700' },
            { label: 'Acknowledged',   value: ackCount,    colour: 'text-purple-700' },
            { label: 'Critical/High',  value: critHigh,    colour: 'text-red-700' },
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
          <Select value={alarmTypeFilter} onValueChange={setAlarmTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Alarm type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All alarm types</SelectItem>
              {alarmTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {severities.map(s => (
                <SelectItem key={s} value={s}>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs mr-1 ${severityBadge(s)}`}>{s}</span>
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
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No alarm events found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Source</TableHead>
                  <TableHead>Alarm Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Trigger Time</TableHead>
                  <TableHead>Acknowledged By</TableHead>
                  <TableHead className="w-32" />
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
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="text-sm font-medium">{row.source_system}</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.alarm_type}</Badge></TableCell>
                        <TableCell><Badge className={severityBadge(row.severity)}>{row.severity}</Badge></TableCell>
                        <TableCell><Badge className={statusBadge(row.status)}>{row.status}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-40 truncate">{row.address ?? '—'}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.trigger_time)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.acknowledged_by ? `${row.acknowledged_by.slice(0, 8)}…` : '—'}
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          {row.status === 'open' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              disabled={acknowledge.isPending}
                              onClick={() => acknowledge.mutate(row.id)}
                            >
                              Acknowledge
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={9} className="p-4 space-y-3">
                            {row.notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Notes</p>
                                <p className="text-sm text-muted-foreground">{row.notes}</p>
                              </div>
                            )}
                            {row.raw_payload && (
                              <div>
                                <p className="font-medium text-sm mb-1">Raw Payload</p>
                                <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-40">
                                  {JSON.stringify(row.raw_payload, null, 2)}
                                </pre>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              {row.zone_id && <span>Zone: {row.zone_id.slice(0, 8)}…</span>}
                              {row.linked_incident_id && <span>Incident: {row.linked_incident_id.slice(0, 8)}…</span>}
                              {row.site_reference && <span>Site ref: {row.site_reference}</span>}
                              <span>Resolved: {fmtDate(row.resolved_at)}</span>
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
