/**
 * RadioTranscriptLog — B-110
 *
 * Log viewer for radio_transcript_segments (View) — individual transcript segments
 * from radio transmissions.
 *
 * Features:
 *  - KPI cards: Total Segments / Final Segments / Avg Confidence / Unique Transmissions
 *  - Filters: is_final, language (dynamic), date from
 *  - Table: sequence_num, text (truncated), language, confidence bar, is_final badge,
 *           duration (end_ms – start_ms), created_at
 *  - Expandable row: full text, transmission_id, segment_start_ms / segment_end_ms
 *
 * Note: radio_transcript_segments is a View; scoped by org_id (not organization_id).
 *
 * Route: /radio-transcript-log — admin/admin_officer/master
 */

import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  FileText, RefreshCw, AlertCircle, Loader2,
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

type RadioTranscriptSegment = Database['public']['Views']['radio_transcript_segments']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtMs(ms: number | null) {
  if (ms == null) return '—'
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtDuration(start: number | null, end: number | null) {
  if (start == null || end == null) return '—'
  const diff = end - start
  return `${(diff / 1000).toFixed(2)}s`
}

function ConfidenceBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>
  const pct = Math.round(value * 100)
  const colour = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-2 rounded-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RadioTranscriptLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [finalFilter,   setFinalFilter]   = useState('all')
  const [langFilter,    setLangFilter]    = useState('all')
  const [dateFrom,      setDateFrom]      = useState('')
  const [expandedId,    setExpandedId]    = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<RadioTranscriptSegment[]>({
    queryKey: ['radio-transcript-log', orgId, finalFilter, langFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = (supabase as any)
        .from('radio_transcript_segments')
        .select('*')
        .eq('org_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (finalFilter !== 'all') q = q.eq('is_final', finalFilter === 'yes')
      if (langFilter  !== 'all') q = q.eq('language', langFilter)
      if (dateFrom)              q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const finalCount      = rows.filter(r => r.is_final).length
  const confidenceSum   = rows.reduce((sum, r) => sum + (r.confidence ?? 0), 0)
  const avgConf         = rows.length > 0 ? (confidenceSum / rows.length) : null
  const uniqueXmits     = new Set(rows.map(r => r.transmission_id)).size
  const languages       = [...new Set(rows.map(r => r.language).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Transcript Log</h1>
              <p className="text-sm text-muted-foreground">Individual transcript segments from radio transmissions with confidence scores</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Segments',       value: rows.length,                                      colour: 'text-gray-700' },
            { label: 'Final Segments',        value: finalCount,                                       colour: 'text-green-700' },
            { label: 'Avg Confidence',        value: avgConf != null ? `${Math.round(avgConf * 100)}%` : '—', colour: 'text-blue-700' },
            { label: 'Unique Transmissions',  value: uniqueXmits,                                      colour: 'text-purple-700' },
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
          <Select value={finalFilter} onValueChange={setFinalFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All segments</SelectItem>
              <SelectItem value="yes">Final only</SelectItem>
              <SelectItem value="no">Partial only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={langFilter} onValueChange={setLangFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Language" /></SelectTrigger>
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
            <AlertCircle className="h-8 w-8" /><p>No transcript segments found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>#</TableHead>
                  <TableHead>Text</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Final</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{row.sequence_num}</TableCell>
                        <TableCell className="text-sm max-w-64 truncate">{row.text}</TableCell>
                        <TableCell className="text-xs">{row.language}</TableCell>
                        <TableCell><ConfidenceBar value={row.confidence} /></TableCell>
                        <TableCell className="text-xs">{fmtDuration(row.segment_start_ms, row.segment_end_ms)}</TableCell>
                        <TableCell>
                          {row.is_final
                            ? <Badge className="bg-green-100 text-green-800">Final</Badge>
                            : <Badge className="bg-yellow-100 text-yellow-700">Partial</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Transmission: {row.transmission_id}</span>
                              <span>Start: {fmtMs(row.segment_start_ms)}</span>
                              <span>End: {fmtMs(row.segment_end_ms)}</span>
                            </div>
                            <div>
                              <p className="font-medium text-sm mb-1">Full Text</p>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.text}</p>
                            </div>
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
