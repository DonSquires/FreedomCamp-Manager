import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Radio, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, ExternalLink,
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

type TtsRenderRow = Database['public']['Tables']['radio_tts_renders']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtMs(v: number | null) {
  if (v == null) return '—'
  return `${v} ms`
}

export default function RadioTtsRenderLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [providerFilter, setProviderFilter] = useState('all')
  const [languageFilter, setLanguageFilter] = useState('all')
  const [syntheticFilter, setSyntheticFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<TtsRenderRow[]>({
    queryKey: ['radio-tts-render-log', orgId, providerFilter, languageFilter, syntheticFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('radio_tts_renders')
        .select('*')
        .eq('org_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (providerFilter !== 'all') q = q.eq('provider', providerFilter)
      if (languageFilter !== 'all') q = q.eq('target_language', languageFilter)
      if (syntheticFilter === 'yes') q = q.eq('is_synthetic', true)
      if (syntheticFilter === 'no') q = q.eq('is_synthetic', false)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const providers = [...new Set(rows.map(r => r.provider).filter(Boolean))].sort()
  const languages = [...new Set(rows.map(r => r.target_language).filter(Boolean))].sort()
  const syntheticCount = rows.filter(r => r.is_synthetic).length
  const latencyValues = rows.map(r => r.render_latency_ms).filter((v): v is number => v != null)
  const avgLatency = latencyValues.length > 0
    ? `${Math.round(latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length)} ms`
    : '—'
  const withAudioCount = rows.filter(r => !!r.storage_path).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio TTS Render Log</h1>
              <p className="text-sm text-muted-foreground">Synthesized and translated radio render records</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Renders', value: rows.length, colour: 'text-gray-700' },
            { label: 'Synthetic', value: syntheticCount, colour: 'text-violet-700' },
            { label: 'Avg Latency', value: avgLatency, colour: 'text-orange-700' },
            { label: 'Audio Linked', value: withAudioCount, colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={languageFilter} onValueChange={setLanguageFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Language" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All languages</SelectItem>
              {languages.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={syntheticFilter} onValueChange={setSyntheticFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Synthetic" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All renders</SelectItem>
              <SelectItem value="yes">Synthetic only</SelectItem>
              <SelectItem value="no">Non-synthetic only</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No TTS renders found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Created</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Synthetic</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Audio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.provider}</Badge></TableCell>
                        <TableCell className="text-sm">{row.target_language}</TableCell>
                        <TableCell>{row.is_synthetic ? <Badge className="bg-violet-100 text-violet-800">Yes</Badge> : <Badge className="bg-gray-100 text-gray-700">No</Badge>}</TableCell>
                        <TableCell className="text-sm font-mono">{fmtMs(row.render_latency_ms)}</TableCell>
                        <TableCell className="text-sm font-mono">{fmtMs(row.duration_ms)}</TableCell>
                        <TableCell className="text-sm">
                          {row.storage_path ? (
                            <a href={row.storage_path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                              Open <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div><span className="font-medium">Render ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                              <div><span className="font-medium">Translation Segment:</span> <span className="font-mono text-xs">{row.translation_segment_id}</span></div>
                              <div><span className="font-medium">Voice Profile:</span> <span className="font-mono text-xs">{row.voice_profile_id ?? '—'}</span></div>
                              <div><span className="font-medium">Org:</span> <span className="font-mono text-xs">{row.org_id}</span></div>
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
