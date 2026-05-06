/**
 * RadioTransmissionsLog — B-48
 *
 * Log viewer for radio_transmissions + inline radio_transcript_segments.
 *
 * Features:
 *  - KPI cards: Total / Emergency / With Transcripts / Avg Duration
 *  - Filters: is_emergency toggle, channel_type select, date-range pickers, keyword search
 *  - Table: speaker, channel, started_at, duration, emergency badge, segment count
 *  - Expandable row: full transcript text stitched from segments
 *
 * Route: /radio-transmissions  — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Radio, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, Zap, MessageSquare,
  Clock, Mic,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Transmission {
  id: string
  org_id: string
  channel_id: string
  channel_type: string
  speaker_id: string
  speaker_name: string
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  recording_enabled: boolean
  is_emergency: boolean
  floor_granted_at: string | null
  floor_released_at: string | null
  metadata: Record<string, any>
  created_at: string
}

interface TranscriptSegment {
  id: string
  org_id: string
  transmission_id: string
  sequence_num: number
  segment_start_ms: number
  segment_end_ms: number
  text: string
  language: string
  confidence: number | null
  is_final: boolean
  created_at: string
}

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

function avgDuration(transmissions: Transmission[]): string {
  const withDuration = transmissions.filter(t => t.duration_ms != null)
  if (!withDuration.length) return '—'
  const avg = withDuration.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0) / withDuration.length
  return fmtDuration(Math.round(avg))
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RadioTransmissionsLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch] = useState('')
  const [channelType, setChannelType] = useState('all')
  const [emergencyOnly, setEmergencyOnly] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Main query: transmissions ──────────────────────────────────────────────

  const { data: transmissions = [], isLoading, refetch } = useQuery({
    queryKey: ['radio-transmissions', orgId, channelType, emergencyOnly, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = (supabase as any)
        .from('radio_transmissions')
        .select('*')
        .eq('org_id', orgId!)
        .order('started_at', { ascending: false })
        .limit(500)

      if (channelType !== 'all') q = q.eq('channel_type', channelType)
      if (emergencyOnly) q = q.eq('is_emergency', true)
      if (dateFrom) q = q.gte('started_at', dateFrom)
      if (dateTo) q = q.lte('started_at', `${dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Transmission[]
    },
  })

  // ── Segments query for expanded row ─────────────────────────────────────────

  const { data: segments = [] } = useQuery({
    queryKey: ['radio-transcript-segments', expandedId],
    enabled: !!expandedId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('radio_transcript_segments')
        .select('*')
        .eq('transmission_id', expandedId!)
        .eq('is_final', true)
        .order('sequence_num', { ascending: true })
      if (error) throw error
      return (data ?? []) as TranscriptSegment[]
    },
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const withTranscripts = new Set(
    transmissions.filter(t => {
      // We can only know from the segments query if one is loaded; estimate from metadata
      const meta = t.metadata as any
      return meta?.transcript_count > 0 || meta?.has_transcript
    })
  ).size

  const kpis = {
    total:     transmissions.length,
    emergency: transmissions.filter(t => t.is_emergency).length,
    withTrans: withTranscripts,
    avgDur:    avgDuration(transmissions),
  }

  // ── Channel types for filter ───────────────────────────────────────────────

  const channelTypes = Array.from(new Set(transmissions.map(t => t.channel_type))).sort()

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = transmissions.filter(t => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !t.speaker_name.toLowerCase().includes(q) &&
        !t.channel_id.toLowerCase().includes(q) &&
        !t.channel_type.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Radio Transmissions Log" description="Audit log of all PTT radio transmissions">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-cyan-600" />
          <span className="font-semibold text-lg">Radio Transmissions Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',           value: kpis.total,     icon: <Radio className="h-4 w-4" />,          color: 'text-foreground' },
          { label: 'Emergency',       value: kpis.emergency, icon: <Zap className="h-4 w-4" />,            color: 'text-red-600' },
          { label: 'With Transcripts',value: kpis.withTrans, icon: <MessageSquare className="h-4 w-4" />, color: 'text-blue-600' },
          { label: 'Avg Duration',    value: kpis.avgDur,    icon: <Clock className="h-4 w-4" />,          color: 'text-muted-foreground' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search speaker, channel…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={channelType} onValueChange={setChannelType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Channel type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            {channelTypes.map(ct => (
              <SelectItem key={ct} value={ct}>{ct}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 px-1">
          <Checkbox
            id="emergency-only"
            checked={emergencyOnly}
            onCheckedChange={v => setEmergencyOnly(!!v)}
          />
          <Label htmlFor="emergency-only" className="text-sm cursor-pointer">Emergency only</Label>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-36 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-36 h-9 text-sm"
          />
        </div>
      </div>

      {/* Empty-state */}
      {!isLoading && transmissions.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No radio transmissions found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Speaker</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Emergency</TableHead>
              <TableHead>Recording</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && transmissions.length > 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No transmissions match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(t => {
              const expanded = expandedId === t.id
              const segmentsForRow = expanded ? segments : []
              const transcript = segmentsForRow.map(s => s.text).join(' ')

              return [
                <TableRow
                  key={t.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    <div className="flex items-center gap-1.5">
                      <Mic className="h-3 w-3 text-muted-foreground" />
                      {t.speaker_name}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.channel_id}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{t.channel_type}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(t.started_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDuration(t.duration_ms)}</TableCell>
                  <TableCell>
                    {t.is_emergency
                      ? <Badge variant="destructive" className="text-xs">Emergency</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {t.recording_enabled
                      ? <Badge variant="secondary" className="text-xs text-green-700">On</Badge>
                      : <span className="text-xs text-muted-foreground">Off</span>}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${t.id}-segments`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={7} className="py-3">
                      {segmentsForRow.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No transcript segments available.</p>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Transcript ({segmentsForRow.length} segment{segmentsForRow.length !== 1 ? 's' : ''})</p>
                          <p className="text-sm leading-relaxed">{transcript}</p>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ),
              ]
            })}
          </TableBody>
        </Table>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {transmissions.length} transmissions
        </p>
      )}
    </AppLayout>
  )
}
