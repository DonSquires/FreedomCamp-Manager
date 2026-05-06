/**
 * DispatchAcknowledgementLog — B-90
 *
 * Admin log for dispatch_acknowledgement_log.
 *
 * Features:
 *  - KPI cards: Total / On Scene / Completed / Cancelled / Avg ETA (minutes)
 *  - Filters: lifecycle_stage select, callsign free-text search, date range
 *  - Table: callsign, lifecycle_stage badge, eta display, officer (truncated),
 *           dispatch_job_id (linked), acknowledged_at
 *  - Expandable row: full IDs (case_id, dispatch_job_id, officer_id), notes, created_at
 *
 * Route: /dispatch-ack-log — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Radio, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, XCircle, MapPin,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import type { Database } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type AckLog = Database['public']['Tables']['dispatch_acknowledgement_log']['Row']

type LifecycleStage = AckLog['lifecycle_stage']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function stageBadge(stage: LifecycleStage) {
  const map: Record<LifecycleStage, { label: string; cls: string }> = {
    assigned:     { label: 'Assigned',     cls: 'text-gray-600' },
    acknowledged: { label: 'Acknowledged', cls: 'text-blue-600' },
    en_route:     { label: 'En Route',     cls: 'text-amber-700' },
    on_scene:     { label: 'On Scene',     cls: 'text-purple-700' },
    completed:    { label: 'Completed',    cls: 'text-green-700' },
    cancelled:    { label: 'Cancelled',    cls: 'text-red-600' },
  }
  const cfg = map[stage] ?? { label: stage, cls: 'text-muted-foreground' }
  return <Badge variant="outline" className={`text-xs ${cfg.cls}`}>{cfg.label}</Badge>
}

function etaLabel(seconds: number | null) {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DispatchAcknowledgementLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const navigate = useNavigate()

  const [callsignSearch, setCallsign] = useState('')
  const [stageFilter, setStage]       = useState('all')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['dispatch-ack-log', orgId, stageFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('dispatch_acknowledgement_log')
        .select('*')
        .eq('organization_id', orgId!)
        .order('acknowledged_at', { ascending: false })
        .limit(500)

      if (stageFilter !== 'all') q = q.eq('lifecycle_stage', stageFilter as LifecycleStage)
      if (dateFrom) q = q.gte('acknowledged_at', dateFrom)
      if (dateTo)   q = q.lte('acknowledged_at', `${dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as AckLog[]
    },
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const onScene   = logs.filter(l => l.lifecycle_stage === 'on_scene').length
  const completed = logs.filter(l => l.lifecycle_stage === 'completed').length
  const cancelled = logs.filter(l => l.lifecycle_stage === 'cancelled').length
  const etas      = logs.map(l => l.eta_seconds).filter((v): v is number => v != null)
  const avgEta    = etas.length ? etas.reduce((s, v) => s + v, 0) / etas.length : null

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = logs.filter(l => {
    if (callsignSearch) {
      if (!l.callsign?.toLowerCase().includes(callsignSearch.toLowerCase())) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Dispatch Acknowledgement Log" description="Lifecycle tracking for all dispatch job acknowledgements">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-indigo-600" />
          <span className="font-semibold text-lg">Dispatch Acknowledgement Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',     value: logs.length, icon: <Radio className="h-4 w-4" />,          color: 'text-foreground',    fmt: (v: number) => String(v) },
          { label: 'On Scene',  value: onScene,     icon: <MapPin className="h-4 w-4" />,          color: 'text-purple-600',    fmt: (v: number) => String(v) },
          { label: 'Completed', value: completed,   icon: <CheckCircle2 className="h-4 w-4" />,   color: 'text-green-600',     fmt: (v: number) => String(v) },
          { label: 'Avg ETA',   value: avgEta,      icon: <AlertCircle className="h-4 w-4" />,    color: 'text-amber-600',     fmt: (v: number | null) => v != null ? etaLabel(Math.round(v)) : '—' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{(k.fmt as any)(k.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search callsign…"
            value={callsignSearch}
            onChange={e => setCallsign(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStage}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="en_route">En Route</SelectItem>
            <SelectItem value="on_scene">On Scene</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && logs.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No dispatch acknowledgement records found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Callsign</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>ETA</TableHead>
              <TableHead>Officer</TableHead>
              <TableHead>Dispatch Job</TableHead>
              <TableHead>Acknowledged</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && logs.length > 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No records match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(l => {
              const expanded = expandedId === l.id
              return [
                <TableRow
                  key={l.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : l.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-mono font-semibold text-sm">
                    {l.callsign ?? '—'}
                  </TableCell>
                  <TableCell>{stageBadge(l.lifecycle_stage)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {etaLabel(l.eta_seconds)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {l.officer_id ? `${l.officer_id.slice(0, 8)}…` : '—'}
                  </TableCell>
                  <TableCell>
                    <button
                      className="font-mono text-xs text-blue-700 underline hover:no-underline"
                      onClick={e => { e.stopPropagation(); navigate('/dispatch-events') }}
                    >
                      {l.dispatch_job_id.slice(0, 8)}…
                    </button>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(l.acknowledged_at)}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${l.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={6} className="py-3 space-y-1 text-sm">
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Case: <code className="bg-muted px-1 rounded">{l.case_id.slice(0, 8)}…</code></span>
                        <span>Job: <code className="bg-muted px-1 rounded">{l.dispatch_job_id.slice(0, 8)}…</code></span>
                        {l.officer_id && <span>Officer: <code className="bg-muted px-1 rounded">{l.officer_id.slice(0, 8)}…</code></span>}
                        <span>Created: {fmtDate(l.created_at)}</span>
                      </div>
                      {l.notes && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</span>
                          <p className="mt-0.5">{l.notes}</p>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ),
              ]
            })}
          </TableBody>
        </Table>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {logs.length} records
        </p>
      )}
    </AppLayout>
  )
}
