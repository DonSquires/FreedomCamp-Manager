import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, Volume2, ChevronDown, ChevronRight } from 'lucide-react'
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

type RadioTtsRender = Database['public']['Views']['radio_tts_renders']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function RadioTtsRenderLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [providerFilter, setProviderFilter] = useState('all')
  const [syntheticFilter, setSyntheticFilter] = useState('all')
  const [languageFilter, setLanguageFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<RadioTtsRender[]>({
    queryKey: ['radio-tts-render-log', orgId, providerFilter, syntheticFilter, languageFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('radio_tts_renders')
        .select('*')
        .eq('org_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(600)

      if (providerFilter !== 'all') q = q.eq('provider', providerFilter)
      if (languageFilter !== 'all') q = q.eq('target_language', languageFilter)
      if (syntheticFilter === 'yes') q = q.eq('is_synthetic', true)
      if (syntheticFilter === 'no') q = q.eq('is_synthetic', false)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const providers = useMemo(() => [...new Set(rows.map((r) => r.provider).filter(Boolean))].sort(), [rows])
  const languages = useMemo(() => [...new Set(rows.map((r) => r.target_language).filter(Boolean))].sort(), [rows])
  const syntheticCount = rows.filter((r) => r.is_synthetic).length
  const latencyVals = rows.map((r) => r.render_latency_ms).filter((v): v is number => v != null)
  const avgLatency = latencyVals.length ? Math.round(latencyVals.reduce((a, b) => a + b, 0) / latencyVals.length) : null

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Volume2 className="h-6 w-6 text-fuchsia-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio TTS Render Log</h1>
              <p className="text-sm text-muted-foreground">Text-to-speech renders for translated radio segments</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Renders', value: rows.length, color: 'text-slate-700' },
            { label: 'Synthetic', value: syntheticCount, color: 'text-fuchsia-700' },
            { label: 'Avg Latency (ms)', value: avgLatency ?? '—', color: 'text-blue-700' },
            { label: 'Providers', value: providers.length, color: 'text-purple-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={languageFilter} onValueChange={setLanguageFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Language" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All languages</SelectItem>
              {languages.map((lang) => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={syntheticFilter} onValueChange={setSyntheticFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Synthetic" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Synthetic only</SelectItem>
              <SelectItem value="no">Non-synthetic</SelectItem>
            </SelectContent>
          </Select>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="text-sm">{row.provider}</TableCell>
                        <TableCell className="text-sm">{row.target_language}</TableCell>
                        <TableCell>{row.is_synthetic ? <Badge className="bg-fuchsia-100 text-fuchsia-800 text-xs">Yes</Badge> : <span className="text-muted-foreground text-xs">No</span>}</TableCell>
                        <TableCell className="text-sm">{row.render_latency_ms ?? '—'} ms</TableCell>
                        <TableCell className="text-sm">{row.duration_ms ?? '—'} ms</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Render ID: {row.id}</span>
                              <span>Translation Segment: {row.translation_segment_id}</span>
                              <span>Voice Profile: {row.voice_profile_id ?? '—'}</span>
                            </div>
                            {row.storage_path && (
                              <div>
                                <p className="font-medium text-sm mb-1">Audio Path</p>
                                <p className="text-sm text-muted-foreground break-all">{row.storage_path}</p>
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
