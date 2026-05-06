/**
 * RadioTransmissionLog — B-97
 *
 * Log viewer for radio_transmissions — PTT radio floor grants and recordings.
 *
 * Features:
 *  - KPI cards: Total / Emergency / Active (no ended_at) / Avg Duration (ms → s)
 *  - Filters: channel_type (dynamic), is_emergency toggle, date from
 *  - Table: speaker_name, channel_id, channel_type badge, emergency badge,
 *           started_at, duration, recording_enabled
 *  - Expandable row: metadata JSON, floor_granted_at, floor_released_at
 *
 * Route: /radio-transmissions-log — admin/admin_officer/master/officer
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Radio, RefreshCw, AlertCircle, Loader2,
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

type RadioTx = Database['public']['Views']['radio_transmissions']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDuration(ms: number | null) {
  if (ms == null) return '—'
  const s = (ms / 1000).toFixed(1)
  return `${s}s`
}

function channelBadge(type: string) {
  if (type === 'emergency')   return 'bg-red-100 text-red-800'
  if (type === 'command')     return 'bg-purple-100 text-purple-800'
  if (type === 'patrol')      return 'bg-blue-100 text-blue-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RadioTransmissionLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [channelTypeFilter, setChannelTypeFilter] = useState('all')
  const [emergencyFilter,   setEmergencyFilter]   = useState('all')
  const [dateFrom,          setDateFrom]          = useState('')
  const [expandedId,        setExpandedId]        = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<RadioTx[]>({
    queryKey: ['radio-transmissions-log', orgId, channelTypeFilter, emergencyFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('radio_transmissions')
        .select('*')
        .eq('org_id', orgId!)
        .order('started_at', { ascending: false })
        .limit(500)

      if (channelTypeFilter !== 'all') q = q.eq('channel_type', channelTypeFilter)
      if (emergencyFilter === 'emergency') q = q.eq('is_emergency', true)
      if (dateFrom) q = q.gte('started_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const channelTypes    = [...new Set(rows.map(r => r.channel_type).filter(Boolean))].sort()
  const emergencyCount  = rows.filter(r => r.is_emergency).length
  const activeCount     = rows.filter(r => !r.ended_at).length
  const durations       = rows.map(r => r.duration_ms).filter((d): d is number => d != null)
  const avgDuration     = durations.length > 0
    ? ((durations.reduce((a, b) => a + b, 0) / durations.length) / 1000).toFixed(1) + 's'
    : '—'

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Transmission Log</h1>
              <p className="text-sm text-muted-foreground">PTT radio floor grants and channel recordings</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Transmissions', value: rows.length,    colour: 'text-gray-700' },
            { label: 'Emergency',           value: emergencyCount, colour: 'text-red-700' },
            { label: 'Active (open)',        value: activeCount,    colour: 'text-blue-700' },
            { label: 'Avg Duration',         value: avgDuration,   colour: 'text-violet-700' },
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
          <Select value={channelTypeFilter} onValueChange={setChannelTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Channel type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channel types</SelectItem>
              {channelTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={emergencyFilter} onValueChange={setEmergencyFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Emergency" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All transmissions</SelectItem>
              <SelectItem value="emergency">Emergency only</SelectItem>
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
            <AlertCircle className="h-8 w-8" /><p>No radio transmissions found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Speaker</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Emergency</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Recording</TableHead>
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
                        <TableCell className="text-sm font-medium">{row.speaker_name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.channel_id}</TableCell>
                        <TableCell>
                          <Badge className={channelBadge(row.channel_type)}>{row.channel_type}</Badge>
                        </TableCell>
                        <TableCell>
                          {row.is_emergency
                            ? <Badge className="bg-red-200 text-red-900">🚨 Emergency</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.started_at)}</TableCell>
                        <TableCell className="text-sm">{fmtDuration(row.duration_ms)}</TableCell>
                        <TableCell className="text-sm">
                          {row.recording_enabled
                            ? <Badge className="bg-green-100 text-green-800">Yes</Badge>
                            : <Badge className="bg-gray-100 text-gray-600">No</Badge>}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4 space-y-3">
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              <span>Floor granted: {fmtDate(row.floor_granted_at)}</span>
                              <span>Floor released: {fmtDate(row.floor_released_at)}</span>
                              <span>Ended: {fmtDate(row.ended_at)}</span>
                            </div>
                            {row.metadata && Object.keys(row.metadata as object).length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Metadata</p>
                                <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-40">
                                  {JSON.stringify(row.metadata, null, 2)}
                                </pre>
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
