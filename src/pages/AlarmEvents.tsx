/**
 * AlarmEvents — B-24
 *
 * Admin dashboard for inbound alarm system events.
 * Alarm events are ingested by the alarm-webhook edge function and
 * stored in public.alarm_events.
 *
 * Admins can:
 *   - View all active / recent alarm events with severity badges
 *   - Acknowledge an event (sets status → 'acknowledged')
 *   - Resolve or mark as false alarm
 *   - Create a linked Dispatch incident directly from an alarm
 *   - Filter by status, severity, source system, and date
 */

import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  BellRing,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Siren,
  MapPin,
  Building2,
  Clock,
  RefreshCw,
  AlertTriangle,
  Eye,
  Plus,
  Radio,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type AlarmEvent = Database['public']['Tables']['alarm_events']['Row']
type StatusFilter = 'all' | 'active' | 'acknowledged' | 'dispatched' | 'resolved' | 'false_alarm'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    critical: 'bg-red-600 text-white border-red-600',
    high:     'bg-orange-500 text-white border-orange-500',
    medium:   'bg-amber-400 text-black border-amber-400',
    low:      'bg-blue-400 text-white border-blue-400',
  }
  return map[severity] ?? 'bg-gray-400 text-white border-gray-400'
}

function statusBadge(status: string): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    active:       { label: 'Active',       cls: 'text-red-600 border-red-300' },
    acknowledged: { label: 'Acknowledged', cls: 'text-amber-600 border-amber-300' },
    dispatched:   { label: 'Dispatched',   cls: 'text-blue-600 border-blue-300' },
    resolved:     { label: 'Resolved',     cls: 'text-green-600 border-green-300' },
    false_alarm:  { label: 'False Alarm',  cls: 'text-muted-foreground border-muted-foreground/40' },
  }
  return map[status] ?? { label: status, cls: '' }
}

function alarmTypeIcon(type: string) {
  const map: Record<string, React.ReactNode> = {
    intruder:     <ShieldAlert className="h-3.5 w-3.5 text-red-500" />,
    panic:        <Siren className="h-3.5 w-3.5 text-red-600" />,
    duress:       <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />,
    fire:         <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
    hold_up:      <Siren className="h-3.5 w-3.5 text-red-600" />,
  }
  return map[type] ?? <BellRing className="h-3.5 w-3.5 text-muted-foreground" />
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlarmEvents() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const orgId = user?.organization_id ?? ''

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [resolveDialog, setResolveDialog] = useState<AlarmEvent | null>(null)
  const [resolveMode, setResolveMode] = useState<'resolved' | 'false_alarm'>('resolved')
  const [resolveNotes, setResolveNotes] = useState('')

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: events = [], isFetching, refetch } = useQuery<AlarmEvent[]>({
    queryKey: ['alarm-events', orgId, statusFilter, severityFilter],
    queryFn: async () => {
      let q = supabase
        .from('alarm_events')
        .select('*')
        .eq('organization_id', orgId)
        .order('trigger_time', { ascending: false })
        .limit(200)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (severityFilter !== 'all') q = q.eq('severity', severityFilter)
      const { data } = await q
      return (data ?? []) as AlarmEvent[]
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  })

  // ── Filtered ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return events
    const q = search.toLowerCase()
    return events.filter(e =>
      e.address?.toLowerCase().includes(q) ||
      e.alarm_type.toLowerCase().includes(q) ||
      e.source_system.toLowerCase().includes(q) ||
      e.site_reference?.toLowerCase().includes(q)
    )
  }, [events, search])

  const activeCount = events.filter(e => e.status === 'active').length

  // ── Acknowledge ────────────────────────────────────────────────────────────
  const acknowledgeMutation = useMutation({
    mutationFn: async (event: AlarmEvent) => {
      const { error } = await supabase
        .from('alarm_events')
        .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() })
        .eq('id', event.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Alarm event acknowledged')
      qc.invalidateQueries({ queryKey: ['alarm-events'] })
    },
    onError: () => toast.error('Failed to acknowledge'),
  })

  // ── Resolve / False Alarm ──────────────────────────────────────────────────
  const resolveMutation = useMutation({
    mutationFn: async ({ event, mode, notes }: { event: AlarmEvent; mode: 'resolved' | 'false_alarm'; notes: string }) => {
      const { error } = await supabase
        .from('alarm_events')
        .update({
          status: mode,
          resolved_at: new Date().toISOString(),
          notes: notes || event.notes,
        })
        .eq('id', event.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Alarm event updated')
      qc.invalidateQueries({ queryKey: ['alarm-events'] })
      setResolveDialog(null)
      setResolveNotes('')
    },
    onError: () => toast.error('Failed to update alarm'),
  })

  // ── Create Incident from alarm ─────────────────────────────────────────────
  const createIncidentMutation = useMutation({
    mutationFn: async (event: AlarmEvent) => {
      const { data, error } = await supabase
        .from('incidents')
        .insert({
          organization_id: orgId,
          incident_type: `alarm_${event.alarm_type}`,
          severity: event.severity,
          location_address: event.address,
          zone_id: event.zone_id,
          description: `Alarm from ${event.source_system.toUpperCase()} — ${event.alarm_type.replace(/_/g, ' ')}. Site: ${event.site_reference ?? 'unknown'}`,
          status: 'open',
          user_id: user?.id,
        })
        .select('id')
        .single()
      if (error) throw error
      // Link alarm event to the new incident
      await supabase
        .from('alarm_events')
        .update({ status: 'dispatched', linked_incident_id: data.id })
        .eq('id', event.id)
      return data.id
    },
    onSuccess: (incidentId) => {
      toast.success('Incident created')
      qc.invalidateQueries({ queryKey: ['alarm-events'] })
      navigate(`/incidents?id=${incidentId}`)
    },
    onError: () => toast.error('Failed to create incident'),
  })

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Siren className="h-6 w-6 text-red-500" />
                Alarm Events
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Inbound alarm events from connected security systems
              </p>
            </div>
            {activeCount > 0 && (
              <Badge className="bg-red-600 text-white text-sm px-2.5 py-1 animate-pulse">
                {activeCount} Active
              </Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['critical', 'high', 'medium', 'low'] as const).map(sev => {
            const count = events.filter(e => e.severity === sev && e.status === 'active').length
            return (
              <Card key={sev} className={count > 0 ? 'border-red-300' : ''}>
                <CardContent className="pt-3 pb-3 px-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{sev} (active)</p>
                  <p className={`text-2xl font-bold ${count > 0 ? 'text-red-600' : ''}`}>{count}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs mb-1 block">Status</Label>
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
                  <SelectTrigger className="w-36 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="acknowledged">Acknowledged</SelectItem>
                    <SelectItem value="dispatched">Dispatched</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="false_alarm">False Alarm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Severity</Label>
                <Select value={severityFilter} onValueChange={setSeverityFilter}>
                  <SelectTrigger className="w-32 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-32">
                <Label className="text-xs mb-1 block">Search</Label>
                <Input
                  className="h-8 text-sm"
                  placeholder="Address, type, source…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Address / Site</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Triggered</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      {isFetching ? 'Loading…' : 'No alarm events match the selected filters.'}
                    </TableCell>
                  </TableRow>
                ) : filtered.map(e => {
                  const { label: statusLabel, cls: statusCls } = statusBadge(e.status)
                  return (
                    <TableRow key={e.id} className={e.status === 'active' ? 'bg-red-50 dark:bg-red-950/30' : ''}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {alarmTypeIcon(e.alarm_type)}
                          <span className="text-sm font-medium capitalize">{e.alarm_type.replace(/_/g, ' ')}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {e.address
                            ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground shrink-0" />{e.address}</span>
                            : <span className="text-muted-foreground">—</span>}
                          {e.site_reference && (
                            <span className="text-xs text-muted-foreground block mt-0.5 flex items-center gap-1">
                              <Building2 className="h-3 w-3 shrink-0" />{e.site_reference}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          <Radio className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="uppercase font-mono text-xs">{e.source_system}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 shrink-0" />
                          {formatDateTime(e.trigger_time)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border ${severityBadge(e.severity)}`}>
                          {e.severity}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusCls}`}>
                          {statusLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {e.status === 'active' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              onClick={() => acknowledgeMutation.mutate(e)}
                            >
                              <Eye className="h-3 w-3 mr-1" />Ack
                            </Button>
                          )}
                          {['active', 'acknowledged'].includes(e.status) && (
                            <Button
                              size="sm"
                              className="h-6 px-2 text-xs bg-red-600 hover:bg-red-700 text-white"
                              onClick={() => createIncidentMutation.mutate(e)}
                            >
                              <Plus className="h-3 w-3 mr-1" />Dispatch
                            </Button>
                          )}
                          {['active', 'acknowledged', 'dispatched'].includes(e.status) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              onClick={() => { setResolveDialog(e); setResolveMode('resolved') }}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />Resolve
                            </Button>
                          )}
                          {e.linked_incident_id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => navigate(`/incidents?id=${e.linked_incident_id}`)}
                            >
                              View Incident
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Resolve Dialog */}
        <Dialog open={!!resolveDialog} onOpenChange={open => !open && setResolveDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Close Alarm Event
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={resolveMode === 'resolved' ? 'default' : 'outline'}
                  className="w-full"
                  onClick={() => setResolveMode('resolved')}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />Resolved
                </Button>
                <Button
                  variant={resolveMode === 'false_alarm' ? 'default' : 'outline'}
                  className="w-full"
                  onClick={() => setResolveMode('false_alarm')}
                >
                  <XCircle className="h-4 w-4 mr-1.5" />False Alarm
                </Button>
              </div>
              <div>
                <Label className="text-sm">Notes (optional)</Label>
                <Textarea
                  className="mt-1"
                  placeholder="Add closure notes…"
                  value={resolveNotes}
                  onChange={e => setResolveNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResolveDialog(null)}>Cancel</Button>
              <Button
                onClick={() => resolveDialog && resolveMutation.mutate({ event: resolveDialog, mode: resolveMode, notes: resolveNotes })}
                disabled={resolveMutation.isPending}
              >
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  )
}
