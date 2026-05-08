import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, RefreshCw, Video, Clapperboard, AlertCircle } from 'lucide-react'
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

type VideoPackRow = {
  id: string
  title: string | null
  description: string | null
  format: string
  bitrate_tier: string
  duration_seconds: number | null
  output_url: string | null
  media_log_id: string
  created_at: string
  revoked_at: string | null
}

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try {
    return format(parseISO(ts), 'dd MMM yyyy HH:mm')
  } catch {
    return ts
  }
}

export default function BriefingVideoSuite() {
  const { user } = useAuthStore()
  const [quality, setQuality] = useState('medium')
  const [formatType, setFormatType] = useState('mp4')
  const [incidentId, setIncidentId] = useState('')
  const [breachId, setBreachId] = useState('')
  const [title, setTitle] = useState('Operational Briefing Pack')
  const [description, setDescription] = useState('')
  const [purpose, setPurpose] = useState('briefing')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const canGenerate = ['admin', 'admin_officer', 'master'].includes(String(user?.role || ''))

  const { data: packs = [], isLoading, refetch } = useQuery<VideoPackRow[]>({
    queryKey: ['briefing-video-suite', user?.organization_id],
    queryFn: async () => {
      if (!user?.organization_id) return []
      const { data, error } = await (supabase
        .from('video_briefing_packs' as any)
        .select('*')
        .eq('org_id', user.organization_id)
        .order('created_at', { ascending: false })
        .limit(200))

      if (error) throw error
      return (data ?? []) as VideoPackRow[]
    },
  })

  const activeCount = useMemo(() => packs.filter((p) => !p.revoked_at).length, [packs])
  const revokedCount = useMemo(() => packs.filter((p) => !!p.revoked_at).length, [packs])

  async function handleGenerate() {
    if (!canGenerate) {
      setResultMessage('Your role cannot generate briefing videos.')
      return
    }

    if (!incidentId.trim() && !breachId.trim()) {
      setResultMessage('Provide at least one source id (incident or breach).')
      return
    }

    setIsSubmitting(true)
    setResultMessage(null)

    const payload = {
      purpose,
      quality,
      format: formatType,
      title: title.trim() || 'Operational Briefing Pack',
      description: description.trim() || null,
      incident_id: incidentId.trim() || null,
      breach_id: breachId.trim() || null,
      source_entity_type: incidentId.trim() ? 'incident' : 'breach_alert',
      source_entity_id: incidentId.trim() || breachId.trim(),
    }

    const { data, error } = await supabase.functions.invoke('generate-briefing-video', { body: payload })

    setIsSubmitting(false)

    if (error) {
      setResultMessage(`Generation request failed: ${error.message}`)
      return
    }

    if (data?.success) {
      setResultMessage(`Video generation logged: pack ${data.video_pack_id}`)
      void refetch()
      return
    }

    setResultMessage('Generation request completed with unexpected response.')
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Video className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Briefing Video Suite</h1>
              <p className="text-sm text-muted-foreground">Generate, review, and audit Bob operational video briefing packs</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Packs', value: packs.length, color: 'text-gray-700' },
            { label: 'Active', value: activeCount, color: 'text-green-700' },
            { label: 'Revoked', value: revokedCount, color: 'text-slate-700' },
            { label: 'Org Scope', value: user?.organization_id ? 'Bound' : 'Missing', color: 'text-indigo-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Clapperboard className="h-4 w-4 text-violet-600" /> Generate New Pack</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input value={incidentId} onChange={(e) => setIncidentId(e.target.value)} placeholder="Incident ID (optional)" />
              <Input value={breachId} onChange={(e) => setBreachId(e.target.value)} placeholder="Breach Alert ID (optional)" />
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pack title" />
            </div>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Select value={purpose} onValueChange={setPurpose}>
                <SelectTrigger><SelectValue placeholder="Purpose" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="briefing">briefing</SelectItem>
                  <SelectItem value="research">research</SelectItem>
                  <SelectItem value="training">training</SelectItem>
                </SelectContent>
              </Select>
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger><SelectValue placeholder="Quality" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
              <Select value={formatType} onValueChange={setFormatType}>
                <SelectTrigger><SelectValue placeholder="Format" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp4">mp4</SelectItem>
                  <SelectItem value="webm">webm</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleGenerate} disabled={isSubmitting || !canGenerate}>
                {isSubmitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                {isSubmitting ? 'Submitting…' : 'Generate Pack'}
              </Button>
              {!canGenerate && (
                <Badge variant="outline" className="text-xs">Role not allowed</Badge>
              )}
            </div>
            {resultMessage && <p className="text-sm text-muted-foreground">{resultMessage}</p>}
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : packs.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No video briefing packs found for this organization</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packs.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm font-medium">{row.title || 'Operational Briefing Pack'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.format || 'mp4'}</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.bitrate_tier || 'medium'}</Badge></TableCell>
                      <TableCell className="text-sm">{row.duration_seconds ? `${row.duration_seconds}s` : '—'}</TableCell>
                      <TableCell>
                        <Badge className={row.revoked_at ? 'bg-slate-100 text-slate-700' : 'bg-green-100 text-green-800'}>
                          {row.revoked_at ? 'Revoked' : 'Active'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Pack ID:</span> {row.id}</div>
                          <div><span className="font-medium">Media Log:</span> {row.media_log_id}</div>
                          <div><span className="font-medium">Output URL:</span> {row.output_url || '—'}</div>
                          {row.description && <div><span className="font-medium">Description:</span> {row.description}</div>}
                          {row.revoked_at && <div><span className="font-medium">Revoked:</span> {fmtDate(row.revoked_at)}</div>}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
