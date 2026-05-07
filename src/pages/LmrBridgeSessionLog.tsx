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

type LmrBridgeRow = Database['public']['Tables']['lmr_bridge_sessions']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDuration(ms: number | null) {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const rem = s % 60
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`
}

export default function LmrBridgeSessionLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [directionFilter, setDirectionFilter] = useState('all')
  const [emergencyFilter, setEmergencyFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<LmrBridgeRow[]>({
    queryKey: ['lmr-bridge-sessions-log', orgId, directionFilter, emergencyFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('lmr_bridge_sessions')
        .select('*')
        .eq('organization_id', orgId!)
        .order('started_at', { ascending: false })
        .limit(500)

      if (directionFilter !== 'all') q = q.eq('direction', directionFilter)
      if (emergencyFilter === 'yes') q = q.eq('is_emergency', true)
      if (emergencyFilter === 'no') q = q.eq('is_emergency', false)
      if (dateFrom) q = q.gte('started_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const directions = [...new Set(rows.map(r => r.direction).filter(Boolean))].sort()
  const emergencyCount = rows.filter(r => r.is_emergency).length
  const durationValues = rows.map(r => r.duration_ms).filter((v): v is number => v != null)
  const avgDuration = durationValues.length
    ? fmtDuration(Math.round(durationValues.reduce((a, b) => a + b, 0) / durationValues.length))
    : '—'
  const withAudioCount = rows.filter(r => !!r.audio_url).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">LMR Bridge Session Log</h1>
              <p className="text-sm text-muted-foreground">Land Mobile Radio bridging sessions between PTT and radio units</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Sessions', value: rows.length, colour: 'text-gray-700' },
            { label: 'Emergency', value: emergencyCount, colour: 'text-red-700' },
            { label: 'Avg Duration', value: avgDuration, colour: 'text-blue-700' },
            { label: 'With Audio', value: withAudioCount, colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={directionFilter} onValueChange={setDirectionFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Direction" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All directions</SelectItem>
              {directions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={emergencyFilter} onValueChange={setEmergencyFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Emergency" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sessions</SelectItem>
              <SelectItem value="yes">Emergency only</SelectItem>
              <SelectItem value="no">Non-emergency only</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No LMR bridge sessions found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Started At</TableHead>
                  <TableHead>Radio Unit</TableHead>
                  <TableHead>PTT Speaker</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Emergency</TableHead>
                  <TableHead>Audio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${row.is_emergency ? 'bg-red-50/50' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.started_at)}</TableCell>
                        <TableCell className="text-sm">{row.radio_unit_alias ?? row.radio_unit_id ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.ptt_speaker_name ?? '—'}</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.direction ?? '—'}</Badge></TableCell>
                        <TableCell className="text-sm font-mono">{fmtDuration(row.duration_ms)}</TableCell>
                        <TableCell>{row.is_emergency ? <Badge className="bg-red-100 text-red-800">Yes</Badge> : <span className="text-muted-foreground text-xs">No</span>}</TableCell>
                        <TableCell>
                          {row.audio_url ? (
                            <a href={row.audio_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm">
                              Play <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Session ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Channel ID:</span> <span className="font-mono text-xs">{row.channel_id ?? '—'}</span></div>
                                <div><span className="font-medium">Config ID:</span> <span className="font-mono text-xs">{row.config_id ?? '—'}</span></div>
                                <div><span className="font-medium">Ended At:</span> <span className="text-muted-foreground">{fmtDate(row.ended_at)}</span></div>
                              </div>
                              {row.transcript && (
                                <div>
                                  <p className="font-medium mb-1">Transcript:</p>
                                  <p className="text-muted-foreground whitespace-pre-wrap bg-muted rounded p-3 text-xs">{row.transcript}</p>
                                </div>
                              )}
                              {row.metadata && (
                                <div>
                                  <p className="font-medium mb-1">Metadata:</p>
                                  <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-32">{JSON.stringify(row.metadata, null, 2)}</pre>
                                </div>
                              )}
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
