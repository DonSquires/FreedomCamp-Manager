/**
 * DispatchAcknowledgementLog — B-90
 *
 * Log viewer for dispatch_acknowledgement_log — officer acknowledgement events
 * for dispatch jobs, with typed lifecycle_stage enum filter and ETA display.
 *
 * Features:
 *  - KPI cards: Total / Acknowledged / En Route / On Scene
 *  - Filters: lifecycle_stage (typed enum), date range
 *  - Table: callsign, officer_id, lifecycle_stage badge, ETA (Xm Ys), acknowledged_at,
 *           link to /dispatch-events (dispatch_job_id)
 *  - Expandable row: notes, case_id link
 *
 * Route: /dispatch-ack-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Link } from 'react-router-dom'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type AckLog = Database['public']['Tables']['dispatch_acknowledgement_log']['Row']

type LifecycleStage = AckLog['lifecycle_stage']

// ─── Styling maps ──────────────────────────────────────────────────────────────

const STAGE_STYLES: Record<LifecycleStage, { label: string; className: string }> = {
  assigned:     { label: 'Assigned',     className: 'bg-gray-100 text-gray-600' },
  acknowledged: { label: 'Acknowledged', className: 'bg-blue-100 text-blue-800' },
  en_route:     { label: 'En Route',     className: 'bg-yellow-100 text-yellow-800' },
  on_scene:     { label: 'On Scene',     className: 'bg-orange-100 text-orange-800' },
  completed:    { label: 'Completed',    className: 'bg-green-100 text-green-800' },
  cancelled:    { label: 'Cancelled',    className: 'bg-red-100 text-red-800' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtEta(seconds: number | null): string {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DispatchAcknowledgementLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [stageFilter, setStageFilter] = useState<'all' | LifecycleStage>('all')
  const [dateFrom, setDateFrom]       = useState('')
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<AckLog[]>({
    queryKey: ['dispatch-ack-log', orgId, stageFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('dispatch_acknowledgement_log')
        .select('*')
        .eq('organization_id', orgId!)
        .order('acknowledged_at', { ascending: false })
        .limit(500)

      if (stageFilter !== 'all') q = q.eq('lifecycle_stage', stageFilter)
      if (dateFrom)              q = q.gte('acknowledged_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total        = rows.length
  const acknowledged = rows.filter(r => r.lifecycle_stage === 'acknowledged').length
  const enRoute      = rows.filter(r => r.lifecycle_stage === 'en_route').length
  const onScene      = rows.filter(r => r.lifecycle_stage === 'on_scene').length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Dispatch Acknowledgement Log</h1>
              <p className="text-sm text-muted-foreground">Officer acknowledgement and lifecycle events for dispatch jobs</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total',        value: total,        colour: 'text-gray-700' },
            { label: 'Acknowledged', value: acknowledged, colour: 'text-blue-700' },
            { label: 'En Route',     value: enRoute,      colour: 'text-yellow-700' },
            { label: 'On Scene',     value: onScene,      colour: 'text-orange-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={stageFilter} onValueChange={v => setStageFilter(v as 'all' | LifecycleStage)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Lifecycle stage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {(Object.entries(STAGE_STYLES) as [LifecycleStage, { label: string; className: string }][]).map(([v, s]) => (
                <SelectItem key={v} value={v}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No acknowledgement records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Callsign</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Acknowledged At</TableHead>
                  <TableHead>Dispatch Job</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const stageStyle = STAGE_STYLES[row.lifecycle_stage]
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-medium">{row.callsign ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id ? `${row.officer_id.slice(0, 8)}…` : '—'}</TableCell>
                        <TableCell><Badge className={stageStyle.className}>{stageStyle.label}</Badge></TableCell>
                        <TableCell className="text-sm font-mono">{fmtEta(row.eta_seconds)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.acknowledged_at)}</TableCell>
                        <TableCell>
                          <Link
                            to={`/dispatch-events?dispatch_job_id=${row.dispatch_job_id}`}
                            onClick={e => e.stopPropagation()}
                            className="text-blue-600 underline text-xs flex items-center gap-1 hover:text-blue-800"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {row.dispatch_job_id.slice(0, 8)}…
                          </Link>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">Notes</p>
                                <p className="text-muted-foreground">{row.notes ?? 'None'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Case</p>
                                <p className="text-muted-foreground font-mono text-xs">{row.case_id}</p>
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
