/**
 * NoiseAssessmentLog — B-99
 *
 * Log viewer for noise_assessments — on-site noise measurement records.
 *
 * Features:
 *  - KPI cards: Total / Exceeds District Plan / Avg dB / Avg AI Confidence
 *  - Filters: noise_type (dynamic), recommended_action (dynamic),
 *             exceeds_district_plan toggle, date from
 *  - Table: address, noise_type badge, noise_level_db, district_plan_limit_db,
 *           exceeds badge, AI confidence bar, recommended_action, assessed_at
 *  - Expandable row: officer_id, GPS, measurement_method, noise_source,
 *                    ai_rationale, action_notes, matrix scores, photos
 *
 * Route: /noise-assessments-log — admin/admin_officer/master
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

type NoiseAssessment = Database['public']['Tables']['noise_assessments']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function actionBadge(action: string) {
  if (action === 'no_action')    return 'bg-green-100 text-green-800'
  if (action === 'verbal_warning') return 'bg-yellow-100 text-yellow-800'
  if (action === 'written_warning') return 'bg-orange-100 text-orange-800'
  if (action === 'enforcement' || action === 'issue_notice') return 'bg-red-100 text-red-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NoiseAssessmentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [noiseTypeFilter,   setNoiseTypeFilter]   = useState('all')
  const [actionFilter,      setActionFilter]      = useState('all')
  const [exceedsFilter,     setExceedsFilter]     = useState('all')
  const [dateFrom,          setDateFrom]          = useState('')
  const [expandedId,        setExpandedId]        = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<NoiseAssessment[]>({
    queryKey: ['noise-assessments-log', orgId, noiseTypeFilter, actionFilter, exceedsFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('noise_assessments')
        .select('*')
        .eq('organization_id', orgId!)
        .order('assessed_at', { ascending: false })
        .limit(500)

      if (noiseTypeFilter !== 'all') q = q.eq('noise_type', noiseTypeFilter)
      if (actionFilter    !== 'all') q = q.eq('recommended_action', actionFilter)
      if (exceedsFilter === 'yes')   q = q.eq('exceeds_district_plan', true)
      if (dateFrom)                  q = q.gte('assessed_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const noiseTypes      = [...new Set(rows.map(r => r.noise_type).filter(Boolean))].sort()
  const actionTypes     = [...new Set(rows.map(r => r.recommended_action).filter(Boolean))].sort()
  const exceedsCount    = rows.filter(r => r.exceeds_district_plan).length
  const dbValues        = rows.map(r => r.noise_level_db).filter((d): d is number => d != null)
  const avgDb           = dbValues.length > 0
    ? (dbValues.reduce((a, b) => a + b, 0) / dbValues.length).toFixed(1)
    : '—'
  const confValues      = rows.map(r => r.ai_confidence_score).filter((c): c is number => c != null)
  const avgConf         = confValues.length > 0
    ? ((confValues.reduce((a, b) => a + b, 0) / confValues.length) * 100).toFixed(0) + '%'
    : '—'

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Volume2 className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Noise Assessment Log</h1>
              <p className="text-sm text-muted-foreground">On-site noise measurement and AI assessment records</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Assessments',  value: rows.length,  colour: 'text-gray-700' },
            { label: 'Exceeds Limit',      value: exceedsCount, colour: 'text-red-700' },
            { label: 'Avg Noise (dB)',      value: avgDb,        colour: 'text-orange-700' },
            { label: 'Avg AI Confidence',  value: avgConf,      colour: 'text-purple-700' },
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
          <Select value={noiseTypeFilter} onValueChange={setNoiseTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Noise type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All noise types</SelectItem>
              {noiseTypes.map(t => <SelectItem key={t!} value={t!}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Recommended action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {actionTypes.map(a => <SelectItem key={a} value={a}>{a.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={exceedsFilter} onValueChange={setExceedsFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="District plan" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assessments</SelectItem>
              <SelectItem value="yes">Exceeds limit only</SelectItem>
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
            <AlertCircle className="h-8 w-8" /><p>No noise assessments found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Address</TableHead>
                  <TableHead>Noise Type</TableHead>
                  <TableHead>dB</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Exceeds</TableHead>
                  <TableHead>AI Confidence</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Assessed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const confPct  = row.ai_confidence_score != null ? Math.round(row.ai_confidence_score * 100) : null
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
                        <TableCell className="text-sm max-w-44 truncate">{row.address}</TableCell>
                        <TableCell>
                          {row.noise_type
                            ? <Badge className="bg-orange-100 text-orange-800">{row.noise_type}</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {row.noise_level_db != null ? `${row.noise_level_db} dB` : '—'}
                        </TableCell>
                        <TableCell className="text-sm font-mono text-muted-foreground">
                          {row.district_plan_limit_db != null ? `${row.district_plan_limit_db} dB` : '—'}
                        </TableCell>
                        <TableCell>
                          {row.exceeds_district_plan
                            ? <Badge className="bg-red-200 text-red-900">⚠ Exceeds</Badge>
                            : <Badge className="bg-green-100 text-green-800">OK</Badge>}
                        </TableCell>
                        <TableCell>
                          {confPct != null ? (
                            <div className="flex items-center gap-2 min-w-[80px]">
                              <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                                <div
                                  className="h-1.5 rounded-full bg-purple-500"
                                  style={{ width: `${confPct}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-9 text-right">{confPct}%</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={actionBadge(row.recommended_action)}>
                            {row.recommended_action.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.assessed_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={9} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Officer: {row.officer_id ? `${row.officer_id.slice(0, 8)}…` : '—'}</span>
                              {row.gps_lat != null && <span>GPS: {row.gps_lat.toFixed(5)}, {row.gps_lng?.toFixed(5) ?? '?'}</span>}
                              <span>Method: {row.measurement_method}</span>
                              {row.noise_source && <span>Source: {row.noise_source}</span>}
                              {row.noise_source_address && <span>Source address: {row.noise_source_address}</span>}
                              {row.measurement_location && <span>Location: {row.measurement_location}</span>}
                              {row.responsible_person_name && <span>Responsible: {row.responsible_person_name}</span>}
                              {row.verbal_warning_given != null && (
                                <span>Verbal warning: {row.verbal_warning_given ? 'Yes' : 'No'}</span>
                              )}
                              {row.zone_classification && <span>Zone class: {row.zone_classification}</span>}
                            </div>
                            {row.ai_rationale && (
                              <div>
                                <p className="font-medium text-sm mb-1">AI Rationale</p>
                                <p className="text-sm text-muted-foreground">{row.ai_rationale}</p>
                              </div>
                            )}
                            {row.action_notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Action Notes</p>
                                <p className="text-sm text-muted-foreground">{row.action_notes}</p>
                              </div>
                            )}
                            {(row.matrix_total_score != null || row.time_score != null) && (
                              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                                {row.matrix_total_score != null && <span>Matrix total: {row.matrix_total_score}</span>}
                                {row.volume_score != null && <span>Volume score: {row.volume_score}</span>}
                                {row.time_score != null && <span>Time score: {row.time_score}</span>}
                                {row.tone_score != null && <span>Tone score: {row.tone_score}</span>}
                              </div>
                            )}
                            {row.photos && row.photos.length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Photos ({row.photos.length})</p>
                                <div className="flex flex-wrap gap-2">
                                  {row.photos.map((url, i) => (
                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                      className="text-xs text-blue-600 underline">
                                      Photo {i + 1}
                                    </a>
                                  ))}
                                </div>
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
