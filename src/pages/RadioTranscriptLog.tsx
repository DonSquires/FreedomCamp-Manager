import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Subtitles, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

type TranscriptRow = Database['public']['Views']['radio_transcript_segments']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtMs(ms: number | null) {
  if (ms == null) return '—'
  return `${(ms / 1000).toFixed(1)}s`
}

function confidenceColor(c: number | null) {
  if (c == null) return 'bg-gray-200'
  if (c >= 0.9) return 'bg-green-500'
  if (c >= 0.7) return 'bg-yellow-400'
  return 'bg-red-400'
}

export default function RadioTranscriptLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [isFinalFilter, setIsFinalFilter] = useState('all')
  const [languageFilter, setLanguageFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<TranscriptRow[]>({
    queryKey: ['radio-transcript-log', orgId, isFinalFilter, languageFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('radio_transcript_segments')
        .select('*')
        .eq('org_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (isFinalFilter === 'yes') q = q.eq('is_final', true)
      if (isFinalFilter === 'no') q = q.eq('is_final', false)
      if (languageFilter !== 'all') q = q.eq('language', languageFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const languages = [...new Set(rows.map(r => r.language).filter(Boolean))].sort()
  const finalCount = rows.filter(r => r.is_final).length
  const confidenceValues = rows.map(r => r.confidence).filter((v): v is number => v != null)
  const avgConfidence = confidenceValues.length
    ? (confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length * 100).toFixed(0) + '%'
    : '—'
  const uniqueTransmissions = new Set(rows.map(r => r.transmission_id)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Subtitles className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Transcript Log</h1>
              <p className="text-sm text-muted-foreground">Speech-to-text transcript segments from radio transmissions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Segments', value: rows.length, colour: 'text-gray-700' },
            { label: 'Final Segments', value: finalCount, colour: 'text-green-700' },
            { label: 'Avg Confidence', value: avgConfidence, colour: 'text-blue-700' },
            { label: 'Transmissions', value: uniqueTransmissions, colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={isFinalFilter} onValueChange={setIsFinalFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Finality" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All segments</SelectItem>
              <SelectItem value="yes">Final only</SelectItem>
              <SelectItem value="no">Partial only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={languageFilter} onValueChange={setLanguageFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Language" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All languages</SelectItem>
              {languages.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No transcript segments found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Created</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Final</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Preview</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const confPct = row.confidence != null ? Math.round(row.confidence * 100) : null
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.language}</Badge></TableCell>
                        <TableCell>{row.is_final ? <Badge className="bg-green-100 text-green-800">Final</Badge> : <Badge className="bg-gray-100 text-gray-700">Partial</Badge>}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-20 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${confidenceColor(row.confidence)}`}
                                style={{ width: `${confPct ?? 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{confPct != null ? `${confPct}%` : '—'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-mono">{fmtMs(row.segment_start_ms)}</TableCell>
                        <TableCell className="text-sm font-mono">{fmtMs(row.segment_end_ms)}</TableCell>
                        <TableCell className="text-sm max-w-48 truncate text-muted-foreground">{row.text}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Segment ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Transmission ID:</span> <span className="font-mono text-xs">{row.transmission_id}</span></div>
                                <div><span className="font-medium">Sequence:</span> <span className="text-muted-foreground">#{row.sequence_num}</span></div>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Full Text:</p>
                                <p className="text-muted-foreground bg-muted rounded p-3">{row.text}</p>
                              </div>
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
