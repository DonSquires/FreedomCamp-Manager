/**
 * AlarmEventLog — B-79
 * Admin log for alarm_events — alarm triggering and acknowledgement.
 * Route: /alarm-events-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Bell, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type AlarmEventRow = Database['public']['Tables']['alarm_events']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const SEVERITY_COLOURS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  medium:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low:      'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
}

const STATUS_COLOURS: Record<string, string> = {
  active:       'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  acknowledged: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  resolved:     'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  false_alarm:  'bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-400',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AlarmEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]               = useState('')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterStatus, setFilterStatus]   = useState('all')
  const [filterType, setFilterType]       = useState('all')
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: events = [], isLoading, error, refetch } = useQuery<AlarmEventRow[]>({
    queryKey: ['alarm-events', orgId],
    queryFn: async () => {
      let q = supabase
        .from('alarm_events')
        .select('*')
        .order('trigger_time', { ascending: false })
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
    if (filterSeverity !== 'all' && e.severity !== filterSeverity) return false
    if (filterStatus   !== 'all' && e.status !== filterStatus) return false
    if (filterType     !== 'all' && e.alarm_type !== filterType) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        e.address?.toLowerCase().includes(s) ||
        e.zone_id?.toLowerCase().includes(s) ||
        e.source_system?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total        = events.length
  const active       = events.filter(e => e.status === 'active').length
  const acknowledged = events.filter(e => e.status === 'acknowledged').length
  const resolved     = events.filter(e => e.status === 'resolved').length

  const alarmTypes = Array.from(new Set(events.map(e => e.alarm_type).filter(Boolean)))

  // ── Mutation ──────────────────────────────────────────────────────────────

  const acknowledge = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('alarm_events')
        .update({
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user?.id,
          status: 'acknowledged',
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alarm-events'] }); toast.success('Alarm acknowledged') },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bell className="h-7 w-7 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Alarm Event Log</h1>
              <p className="text-sm text-muted-foreground">Alarm triggering and acknowledgement records</p>
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
            { label: 'Total',        value: total,        icon: Bell,         colour: 'text-slate-600' },
            { label: 'Active',       value: active,       icon: AlertCircle,  colour: active > 0 ? 'text-red-600' : 'text-muted-foreground' },
            { label: 'Acknowledged', value: acknowledged, icon: CheckCircle2, colour: 'text-amber-600' },
            { label: 'Resolved',     value: resolved,     icon: CheckCircle2, colour: 'text-green-600' },
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
              placeholder="Address, zone, source…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              {['critical', 'high', 'medium', 'low'].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {['active', 'acknowledged', 'resolved', 'false_alarm'].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {alarmTypes.length > 0 && (
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Alarm Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {alarmTypes.map(t => (
                  <SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
              <div className="text-center py-12 text-muted-foreground text-sm">No alarm events match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Trigger Time</TableHead>
                    <TableHead>Alarm Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Acknowledged</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => {
                    const isExpanded = expandedId === e.id
                    return (
                      <>
                        <TableRow
                          key={e.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setExpandedId(isExpanded ? null : e.id)}
                        >
                          <TableCell>
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.trigger_time)}</TableCell>
                          <TableCell className="text-sm capitalize">{e.alarm_type?.replace(/_/g, ' ') ?? '—'}</TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${SEVERITY_COLOURS[e.severity ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                              {e.severity ?? '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.source_system ?? '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.address ?? e.zone_id ?? '—'}</TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${STATUS_COLOURS[e.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                              {e.status?.replace(/_/g, ' ') ?? 'unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {e.acknowledged_at
                              ? <span className="text-amber-600 text-xs">{fmtDate(e.acknowledged_at)}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell onClick={ev => ev.stopPropagation()}>
                            {!e.acknowledged_at && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2"
                                disabled={acknowledge.isPending}
                                onClick={() => acknowledge.mutate(e.id)}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Acknowledge
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${e.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={9} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                {e.notes && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Notes</p>
                                    <p>{e.notes}</p>
                                  </div>
                                )}
                                {e.raw_payload && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Raw Payload</p>
                                    <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-32">
                                      {JSON.stringify(e.raw_payload, null, 2)}
                                    </pre>
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
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
