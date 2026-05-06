/**
 * RadioTransmissionsLog — Sprint 13 / B-48
 *
 * Org-scoped log of radio_transmissions rows with inline-expandable
 * radio_transcript_segments. Supports date, channel-type, and emergency
 * filters plus CSV export.
 *
 * Route: /radio-transmissions
 * Roles: admin, admin_officer, master, grand_master
 *
 * Note: radio_* tables are not yet in the generated database.ts snapshot;
 * all Supabase calls use (supabase as any) until types are regenerated.
 */

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { formatInTimeZone } from 'date-fns-tz'
import { ArrowLeft, ChevronDown, ChevronRight, Download, Mic, Radio, Shield } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Constants ─────────────────────────────────────────────────────────────────

const NZ_TZ = 'Pacific/Auckland'
const CHANNEL_TYPES = ['org', 'incident', 'direct', 'emergency'] as const

// ─── Types ──────────────────────────────────────────────────────────────────────

interface TransmissionRow {
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
}

interface TranscriptSegment {
  id: string
  sequence_num: number
  segment_start_ms: number
  segment_end_ms: number
  text: string
  language: string
  confidence: number | null
  is_final: boolean
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtTs(iso: string | null) {
  if (!iso) return '—'
  try {
    return formatInTimeZone(new Date(iso), NZ_TZ, 'dd MMM yyyy HH:mm:ss')
  } catch {
    return iso
  }
}

function fmtDuration(ms: number | null) {
  if (ms == null || ms < 0) return '—'
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}m ${s}s`
}

function channelTypeBadge(type: string) {
  const styles: Record<string, string> = {
    org:       'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    incident:  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    direct:    'bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300',
    emergency: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  }
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${styles[type] ?? styles['org']}`}>
      {type}
    </span>
  )
}

function confidenceBadge(confidence: number | null) {
  if (confidence == null) return <span className="text-muted-foreground text-xs">—</span>
  const pct = Math.round(confidence * 100)
  const style = confidence >= 0.8
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
    : confidence >= 0.5
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${style}`}>
      {pct}%
    </span>
  )
}

// ─── Expandable transcript row ───────────────────────────────────────────────────

function TranscriptPanel({ transmissionId, orgId }: { transmissionId: string; orgId: string }) {
  const { data: segments = [], isLoading } = useQuery<TranscriptSegment[]>({
    queryKey: ['radio-transcript-segments', transmissionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('radio_transcript_segments')
        .select('id, sequence_num, segment_start_ms, segment_end_ms, text, language, confidence, is_final')
        .eq('transmission_id', transmissionId)
        .eq('org_id', orgId)
        .order('sequence_num', { ascending: true })
      if (error) {
        if (error.code === 'PGRST205' || error.code === '42P01') return []
        throw error
      }
      return (data ?? []) as TranscriptSegment[]
    },
    staleTime: 60_000,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="px-6 py-3 space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    )
  }

  if (segments.length === 0) {
    return (
      <div className="px-6 py-3 text-xs text-muted-foreground italic">
        No transcript segments available for this transmission.
      </div>
    )
  }

  return (
    <div className="px-6 py-3 space-y-1.5 bg-slate-50/70 dark:bg-slate-800/30">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
        Transcript — {segments.length} segment{segments.length !== 1 ? 's' : ''}
      </p>
      {segments.map((seg) => (
        <div key={seg.id} className="flex items-start gap-3 text-xs">
          <span className="shrink-0 font-mono text-muted-foreground w-12 text-right">
            {(seg.segment_start_ms / 1000).toFixed(1)}s
          </span>
          <span className={`flex-1 leading-snug ${!seg.is_final ? 'italic text-muted-foreground' : 'text-foreground'}`}>
            {seg.text}
            {!seg.is_final && <span className="ml-1 text-[10px] text-amber-500">(interim)</span>}
          </span>
          <span className="shrink-0">{confidenceBadge(seg.confidence)}</span>
          <span className="shrink-0 text-muted-foreground text-[10px] uppercase">{seg.language}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function RadioTransmissionsLog() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [channelTypeFilter, setChannelTypeFilter] = useState<string>('all')
  const [emergencyFilter, setEmergencyFilter] = useState<string>('all')
  const [speakerSearch, setSpeakerSearch] = useState('')

  // Expanded row set
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Fetch transmissions
  const { data: transmissions = [], isLoading, error, refetch } = useQuery<TransmissionRow[]>({
    queryKey: ['radio-transmissions-log', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('radio_transmissions')
        .select(
          'id, org_id, channel_id, channel_type, speaker_id, speaker_name, started_at, ended_at, duration_ms, recording_enabled, is_emergency, floor_granted_at, floor_released_at'
        )
        .eq('org_id', orgId)
        .order('started_at', { ascending: false })
        .limit(500)

      if (error) {
        if (error.code === 'PGRST205' || error.code === '42P01') return []
        throw error
      }
      return (data ?? []) as TransmissionRow[]
    },
    enabled: !!orgId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })

  // Client-side filters
  const filtered = useMemo(() => {
    return transmissions.filter((t) => {
      if (dateFrom && new Date(t.started_at) < new Date(dateFrom + 'T00:00:00Z')) return false
      if (dateTo && new Date(t.started_at) > new Date(dateTo + 'T23:59:59Z')) return false
      if (channelTypeFilter !== 'all' && t.channel_type !== channelTypeFilter) return false
      if (emergencyFilter === 'yes' && !t.is_emergency) return false
      if (emergencyFilter === 'no' && t.is_emergency) return false
      if (speakerSearch.trim()) {
        const q = speakerSearch.toLowerCase()
        if (!(t.speaker_name ?? '').toLowerCase().includes(q) && !t.channel_id.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [transmissions, dateFrom, dateTo, channelTypeFilter, emergencyFilter, speakerSearch])

  // KPI metrics
  const kpis = useMemo(() => {
    const total = filtered.length
    const emergency = filtered.filter((t) => t.is_emergency).length
    const durations = filtered.filter((t) => t.duration_ms != null).map((t) => t.duration_ms as number)
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null
    const recorded = filtered.filter((t) => t.recording_enabled).length
    return { total, emergency, avgDuration, recorded }
  }, [filtered])

  // CSV export
  const exportCSV = useCallback(() => {
    const headers = ['Transmission ID', 'Speaker', 'Channel ID', 'Channel Type', 'Emergency', 'Started At (NZ)', 'Duration', 'Recorded']
    const rows = filtered.map((t) => [
      t.id,
      t.speaker_name,
      t.channel_id,
      t.channel_type,
      t.is_emergency ? 'Yes' : 'No',
      fmtTs(t.started_at),
      fmtDuration(t.duration_ms),
      t.recording_enabled ? 'Yes' : 'No',
    ])
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `radio-transmissions-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered])

  return (
    <AppLayout
      title="Radio Transmissions Log"
      description="Org-scoped audit log of all PTT transmission sessions with inline transcript viewer"
    >
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/radio')} className="gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Radio
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Transmissions', value: isLoading ? '—' : kpis.total, icon: Radio, color: 'text-blue-600' },
          { label: 'Emergency Calls', value: isLoading ? '—' : kpis.emergency, icon: Shield, color: 'text-red-600' },
          { label: 'Avg Duration', value: isLoading ? '—' : fmtDuration(kpis.avgDuration), icon: Mic, color: 'text-green-600' },
          { label: 'With Recording', value: isLoading ? '—' : kpis.recorded, icon: Radio, color: 'text-violet-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border shadow-sm">
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <Icon className={`h-5 w-5 shrink-0 ${color}`} />
              <div>
                <p className="text-2xl font-bold leading-tight">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-3">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-36 h-8 text-xs"
              placeholder="From"
              aria-label="From date"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-36 h-8 text-xs"
              placeholder="To"
              aria-label="To date"
            />
            <Select value={channelTypeFilter} onValueChange={setChannelTypeFilter}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue placeholder="Channel type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {CHANNEL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={emergencyFilter} onValueChange={setEmergencyFilter}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue placeholder="Emergency?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="yes">Emergency only</SelectItem>
                <SelectItem value="no">Non-emergency</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={speakerSearch}
              onChange={(e) => setSpeakerSearch(e.target.value)}
              placeholder="Search speaker / channel…"
              className="w-48 h-8 text-xs"
            />
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={exportCSV} disabled={filtered.length === 0}>
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => void refetch()}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {error ? (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
          <CardContent className="pt-4">
            <p className="text-sm text-red-700 dark:text-red-300">
              Failed to load transmissions: {(error as any)?.message ?? 'Unknown error'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="rounded-xl overflow-hidden border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-8" />
                  <TableHead className="text-xs">Speaker</TableHead>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Started (NZ)</TableHead>
                  <TableHead className="text-xs">Duration</TableHead>
                  <TableHead className="text-xs">Emergency</TableHead>
                  <TableHead className="text-xs">Recorded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                      No transmissions match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((t) => {
                    const isExpanded = expandedIds.has(t.id)
                    return (
                      <>
                        <TableRow
                          key={t.id}
                          className={`cursor-pointer hover:bg-muted/40 ${t.is_emergency ? 'bg-red-50/50 dark:bg-red-950/10' : ''}`}
                          onClick={() => toggleExpand(t.id)}
                        >
                          <TableCell className="py-2 pr-0">
                            {isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            }
                          </TableCell>
                          <TableCell className="py-2 text-sm font-medium">{t.speaker_name}</TableCell>
                          <TableCell className="py-2 text-xs font-mono text-muted-foreground truncate max-w-[120px]">{t.channel_id}</TableCell>
                          <TableCell className="py-2">{channelTypeBadge(t.channel_type)}</TableCell>
                          <TableCell className="py-2 text-xs">{fmtTs(t.started_at)}</TableCell>
                          <TableCell className="py-2 text-xs">{fmtDuration(t.duration_ms)}</TableCell>
                          <TableCell className="py-2">
                            {t.is_emergency
                              ? <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 text-[10px] px-1.5 py-0">Emergency</Badge>
                              : <span className="text-xs text-muted-foreground">—</span>
                            }
                          </TableCell>
                          <TableCell className="py-2 text-xs">
                            {t.recording_enabled
                              ? <span className="text-emerald-600 dark:text-emerald-400">Yes</span>
                              : <span className="text-muted-foreground">No</span>
                            }
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${t.id}-transcript`} className="hover:bg-transparent">
                            <TableCell colSpan={8} className="p-0">
                              <TranscriptPanel transmissionId={t.id} orgId={orgId} />
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
          {!isLoading && filtered.length > 0 && (
            <div className="px-4 py-2 text-xs text-muted-foreground border-t">
              Showing {filtered.length} of {transmissions.length} transmission{transmissions.length !== 1 ? 's' : ''}
              {transmissions.length >= 500 && ' (capped at 500 — refine filters to see more)'}
            </div>
          )}
        </Card>
      )}
    </AppLayout>
  )
}
