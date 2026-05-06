/**
 * RadioTtsRenderLog — B-112
 *
 * Log viewer for radio_tts_renders (View) — text-to-speech renders from
 * radio translation pipeline.
 *
 * Features:
 *  - KPI cards: Total Renders / Synthetic / Avg Duration / Avg Render Latency
 *  - Filters: provider (dynamic), is_synthetic, target_language (dynamic), date from
 *  - Table: target_language, provider, is_synthetic badge, duration_ms,
 *           render_latency_ms, created_at
 *  - Expandable row: storage_path audio link, translation_segment_id,
 *                    voice_profile_id, full timestamps
 *
 * Note: radio_tts_renders is a View; scoped by org_id.
 *
 * Route: /radio-tts-render-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Volume2, RefreshCw, AlertCircle, Loader2,
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

type RadioTtsRender = Database['public']['Views']['radio_tts_renders']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtMs(ms: number | null) {
  if (ms == null) return '—'
  return `${(ms / 1000).toFixed(2)}s`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RadioTtsRenderLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [providerFilter,  setProviderFilter]  = useState('all')
  const [syntheticFilter, setSyntheticFilter] = useState('all')
  const [langFilter,      setLangFilter]      = useState('all')
  const [dateFrom,        setDateFrom]        = useState('')
  const [expandedId,      setExpandedId]      = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<RadioTtsRender[]>({
    queryKey: ['radio-tts-render-log', orgId, providerFilter, syntheticFilter, langFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = (supabase as any)
        .from('radio_tts_renders')
        .select('*')
        .eq('org_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (providerFilter  !== 'all') q = q.eq('provider', providerFilter)
      if (syntheticFilter !== 'all') q = q.eq('is_synthetic', syntheticFilter === 'yes')
      if (langFilter      !== 'all') q = q.eq('target_language', langFilter)
      if (dateFrom)                  q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const syntheticCount = rows.filter(r => r.is_synthetic).length
  const durations      = rows.map(r => r.duration_ms).filter(v => v != null) as number[]
  const latencies      = rows.map(r => r.render_latency_ms).filter(v => v != null) as number[]
  const avgDuration    = durations.length  > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null
  const avgLatency     = latencies.length  > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null
  const providers      = [...new Set(rows.map(r => r.provider).filter(Boolean))].sort()
  const languages      = [...new Set(rows.map(r => r.target_language).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Volume2 className="h-6 w-6 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio TTS Render Log</h1>
              <p className="text-sm text-muted-foreground">Text-to-speech renders from the radio translation pipeline</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Renders',     value: rows.length,                   colour: 'text-gray-700' },
            { label: 'Synthetic',         value: syntheticCount,                colour: 'text-purple-700' },
            { label: 'Avg Duration',      value: avgDuration != null ? fmtMs(Math.round(avgDuration)) : '—', colour: 'text-blue-700' },
            { label: 'Avg Render Latency',value: avgLatency  != null ? fmtMs(Math.round(avgLatency))  : '—', colour: 'text-orange-700' },
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
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map(p => <SelectItem key={p} value={p!}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={syntheticFilter} onValueChange={setSyntheticFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Synthetic" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All renders</SelectItem>
              <SelectItem value="yes">Synthetic only</SelectItem>
              <SelectItem value="no">Non-synthetic</SelectItem>
            </SelectContent>
          </Select>
          <Select value={langFilter} onValueChange={setLangFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Language" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All languages</SelectItem>
              {languages.map(l => <SelectItem key={l} value={l!}>{l}</SelectItem>)}
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
            <AlertCircle className="h-8 w-8" /><p>No TTS renders found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Language</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Synthetic</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Created</TableHead>
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
                        <TableCell className="text-sm font-medium">{row.target_language}</TableCell>
                        <TableCell className="text-sm">{row.provider}</TableCell>
                        <TableCell>
                          {row.is_synthetic
                            ? <Badge className="bg-purple-100 text-purple-800">Synthetic</Badge>
                            : <Badge className="bg-gray-100 text-gray-700">Human</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtMs(row.duration_ms)}</TableCell>
                        <TableCell className="text-sm">{fmtMs(row.render_latency_ms)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Segment ID: {row.translation_segment_id.slice(0, 8)}…</span>
                              {row.voice_profile_id && <span>Voice Profile: {row.voice_profile_id.slice(0, 8)}…</span>}
                            </div>
                            {row.storage_path && (
                              <div>
                                <p className="font-medium text-sm mb-1">Audio</p>
                                <a
                                  href={row.storage_path}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-blue-600 hover:underline break-all"
                                  onClick={e => e.stopPropagation()}
                                >
                                  {row.storage_path}
                                </a>
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
