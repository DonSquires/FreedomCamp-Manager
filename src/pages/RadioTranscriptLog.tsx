import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, Radio, ChevronDown, ChevronRight } from 'lucide-react'
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

type RadioTranscriptSegment = Database['public']['Views']['radio_transcript_segments']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function confidencePct(v: number | null) {
  if (v == null) return 0
  if (v <= 1) return Math.round(v * 100)
  return Math.max(0, Math.min(100, Math.round(v)))
}

export default function RadioTranscriptLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [languageFilter, setLanguageFilter] = useState('all')
  const [isFinalFilter, setIsFinalFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [textSearch, setTextSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<RadioTranscriptSegment[]>({
    queryKey: ['radio-transcript-log', orgId, languageFilter, isFinalFilter, dateFrom, textSearch],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('radio_transcript_segments')
        .select('*')
        .eq('org_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(700)

      if (languageFilter !== 'all') q = q.eq('language', languageFilter)
      if (isFinalFilter === 'yes') q = q.eq('is_final', true)
      if (isFinalFilter === 'no') q = q.eq('is_final', false)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (textSearch.trim()) q = q.ilike('text', `%${textSearch.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const languages = useMemo(
    () => [...new Set(rows.map((r) => r.language).filter(Boolean))].sort(),
    [rows],
  )
  const finalCount = rows.filter((r) => r.is_final).length
  const avgConfidence = (() => {
    const vals = rows.map((r) => r.confidence).filter((v): v is number => v != null)
    if (vals.length === 0) return null
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
  })()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="h-6 w-6 text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Transcript Log</h1>
              <p className="text-sm text-muted-foreground">Segment-level transcript stream for radio transmissions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Segments', value: rows.length, color: 'text-slate-700' },
            { label: 'Final Segments', value: finalCount, color: 'text-green-700' },
            { label: 'Avg Confidence', value: avgConfidence == null ? '—' : avgConfidence, color: 'text-cyan-700' },
            { label: 'Languages', value: languages.length, color: 'text-blue-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={languageFilter} onValueChange={setLanguageFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Language" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All languages</SelectItem>
              {languages.map((lang) => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={isFinalFilter} onValueChange={setIsFinalFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Final" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Final only</SelectItem>
              <SelectItem value="no">Interim only</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-44" />
          <Input
            placeholder="Search transcript text…"
            value={textSearch}
            onChange={(e) => setTextSearch(e.target.value)}
            className="min-w-[220px] max-w-[340px]"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No transcript segments found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Created</TableHead>
                  <TableHead>Seq</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Final</TableHead>
                  <TableHead>Text</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  const pct = confidencePct(row.confidence)
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="text-sm">{row.sequence_num}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{row.language}</Badge></TableCell>
                        <TableCell>
                          <div className="w-24">
                            <div className="h-2 rounded bg-muted overflow-hidden">
                              <div className="h-full bg-cyan-500" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">{row.confidence == null ? '—' : `${pct}%`}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.is_final ? <Badge className="bg-green-100 text-green-800 text-xs">Final</Badge> : <Badge className="bg-yellow-100 text-yellow-800 text-xs">Interim</Badge>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[420px] truncate">{row.text}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Transmission: {row.transmission_id ?? '—'}</span>
                              <span>Segment start: {row.segment_start_ms} ms</span>
                              <span>Segment end: {row.segment_end_ms} ms</span>
                              <span>Org: {row.org_id ?? '—'}</span>
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
