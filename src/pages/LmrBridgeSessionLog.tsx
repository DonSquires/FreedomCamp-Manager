/**
 * LmrBridgeSessionLog — B-108
 *
 * Log viewer for lmr_bridge_sessions — LMR (Land Mobile Radio) bridge sessions.
 *
 * Features:
 *  - KPI cards: Total / Emergency / Avg Duration (s) / With Transcript
 *  - Filters: direction (dynamic), is_emergency toggle, date from
 *  - Table: started_at, direction badge, radio_unit_alias, ptt_speaker_name,
 *           duration_ms, emergency badge
 *  - Expandable row: config_id, channel_id, audio_url, full transcript, metadata
 *
 * Route: /lmr-bridge-sessions-log — admin/admin_officer/master
 */

import { useState, Fragment } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Antenna, RefreshCw, AlertCircle, Loader2,
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

type LmrSession = Database['public']['Tables']['lmr_bridge_sessions']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDuration(ms: number | null) {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function directionBadge(dir: string) {
  if (dir === 'lmr_to_ptt') return 'bg-blue-100 text-blue-800'
  if (dir === 'ptt_to_lmr') return 'bg-teal-100 text-teal-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LmrBridgeSessionLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [dirFilter,       setDirFilter]       = useState('all')
  const [emergencyFilter, setEmergencyFilter] = useState('all')
  const [dateFrom,        setDateFrom]        = useState('')
  const [expandedId,      setExpandedId]      = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<LmrSession[]>({
    queryKey: ['lmr-bridge-sessions-log', orgId, dirFilter, emergencyFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('lmr_bridge_sessions')
        .select('*')
        .eq('organization_id', orgId!)
        .order('started_at', { ascending: false })
        .limit(500)

      if (dirFilter !== 'all')          q = q.eq('direction', dirFilter)
      if (emergencyFilter === 'yes')    q = q.eq('is_emergency', true)
      if (emergencyFilter === 'no')     q = q.eq('is_emergency', false)
      if (dateFrom)                     q = q.gte('started_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const emergencyCount   = rows.filter(r => r.is_emergency).length
  const withTranscript   = rows.filter(r => !!r.transcript).length
  const durations        = rows.map(r => r.duration_ms).filter((d): d is number => d != null)
  const avgDuration      = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000)
    : null
  const directions       = [...new Set(rows.map(r => r.direction).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Antenna className="h-6 w-6 text-purple-600" />
            <div>
              <h1 className="text-2xl font-bold">LMR Bridge Session Log</h1>
              <p className="text-sm text-muted-foreground">Land Mobile Radio bridge sessions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Sessions',   value: rows.length,                             colour: 'text-gray-700' },
            { label: 'Emergency',        value: emergencyCount,                          colour: 'text-red-700' },
            { label: 'Avg Duration',     value: avgDuration != null ? `${avgDuration}s` : '—', colour: 'text-purple-700' },
            { label: 'With Transcript',  value: withTranscript,                          colour: 'text-teal-700' },
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
          <Select value={dirFilter} onValueChange={setDirFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Direction" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All directions</SelectItem>
              {directions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={emergencyFilter} onValueChange={setEmergencyFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Emergency" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Emergency only</SelectItem>
              <SelectItem value="no">Non-emergency</SelectItem>
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
            <AlertCircle className="h-8 w-8" /><p>No LMR bridge sessions found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Started</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Radio Unit</TableHead>
                  <TableHead>PTT Speaker</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Emergency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className={`cursor-pointer hover:bg-muted/50 ${row.is_emergency ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.started_at)}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${directionBadge(row.direction)}`}>{row.direction}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.radio_unit_alias ?? row.radio_unit_id?.slice(0, 8) ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.ptt_speaker_name ?? row.ptt_speaker_id?.slice(0, 8) ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDuration(row.duration_ms)}</TableCell>
                        <TableCell>
                          {row.is_emergency ? (
                            <Badge className="bg-red-100 text-red-800 text-xs">Emergency</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Config: {row.config_id?.slice(0, 8) ?? '—'}…</span>
                              <span>Channel: {row.channel_id?.slice(0, 8) ?? '—'}…</span>
                              {row.ended_at && <span>Ended: {fmtDate(row.ended_at)}</span>}
                            </div>
                            {row.audio_url && (
                              <div>
                                <p className="font-medium text-sm mb-1">Audio</p>
                                <a href={row.audio_url} target="_blank" rel="noopener noreferrer"
                                  className="text-xs text-blue-600 underline break-all">
                                  {row.audio_url}
                                </a>
                              </div>
                            )}
                            {row.transcript && (
                              <div>
                                <p className="font-medium text-sm mb-1">Transcript</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.transcript}</p>
                              </div>
                            )}
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
