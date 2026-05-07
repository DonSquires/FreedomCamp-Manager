/**
 * FeatureFlagRolloutLog — B-125
 *
 * Admin log for feature_flag_rollout_history — tracks every rollout percentage
 * change made to feature flags, including error rates and latency at change time.
 *
 * Features:
 *  - KPIs: Total Changes / Increases / Rollbacks / Unique Flags
 *  - Filters: flag_id search / stage filter / date-from
 *  - Expandable row: change_reason + monitoring_notes + error_rate + p95_latency
 *
 * Route: /feature-flag-rollout-log — master only
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  TrendingUp, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

type RolloutRow = Database['public']['Tables']['feature_flag_rollout_history']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function changeTone(from: number, to: number) {
  if (to > from) return 'bg-green-100 text-green-800'
  if (to < from) return 'bg-red-100 text-red-800'
  return 'bg-gray-100 text-gray-700'
}

export default function FeatureFlagRolloutLog() {
  const [flagQuery, setFlagQuery] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<RolloutRow[]>({
    queryKey: ['feature-flag-rollout-log', flagQuery, stageFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('feature_flag_rollout_history')
        .select('*')
        .order('changed_at', { ascending: false })
        .limit(500)

      if (flagQuery.trim()) q = q.ilike('flag_id', `%${flagQuery.trim()}%`)
      if (stageFilter !== 'all') q = q.eq('stage', stageFilter)
      if (dateFrom) q = q.gte('changed_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const stages = [...new Set(rows.map(r => r.stage).filter(Boolean))].sort()
  const increases = rows.filter(r => r.to_percentage > r.from_percentage).length
  const rollbacks = rows.filter(r => r.to_percentage < r.from_percentage).length
  const uniqueFlags = new Set(rows.map(r => r.flag_id)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Feature Flag Rollout Log</h1>
              <p className="text-sm text-muted-foreground">Rollout percentage change history for feature flags</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Changes', value: rows.length, colour: 'text-gray-700' },
            { label: 'Increases', value: increases, colour: 'text-green-700' },
            { label: 'Rollbacks', value: rollbacks, colour: 'text-red-700' },
            { label: 'Unique Flags', value: uniqueFlags, colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={flagQuery}
            onChange={e => setFlagQuery(e.target.value)}
            placeholder="Search flag ID…"
            className="w-56"
          />
          <select
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value)}
            className="border rounded px-3 py-1 text-sm bg-background w-44"
          >
            <option value="all">All stages</option>
            {stages.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No rollout history found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Changed At</TableHead>
                  <TableHead>Flag</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>From %</TableHead>
                  <TableHead>To %</TableHead>
                  <TableHead>Error Rate</TableHead>
                  <TableHead>P95 Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.changed_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{row.flag_id?.slice(0, 16)}…</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.stage ?? '—'}</TableCell>
                        <TableCell className="text-sm font-mono">{row.from_percentage}%</TableCell>
                        <TableCell>
                          <Badge className={changeTone(row.from_percentage, row.to_percentage)}>
                            {row.to_percentage}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.error_rate_at_change != null ? `${row.error_rate_at_change}%` : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.p95_latency_at_change_ms != null ? `${row.p95_latency_at_change_ms}ms` : '—'}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Record ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Flag ID:</span> <span className="font-mono text-xs">{row.flag_id}</span></div>
                                <div><span className="font-medium">Changed By:</span> <span className="font-mono text-xs">{row.changed_by ?? '—'}</span></div>
                                <div><span className="font-medium">Created At:</span> <span className="text-muted-foreground">{fmtDate(row.created_at)}</span></div>
                              </div>
                              {row.change_reason && (
                                <div>
                                  <p className="font-medium mb-1">Change Reason:</p>
                                  <p className="text-muted-foreground bg-muted rounded p-3">{row.change_reason}</p>
                                </div>
                              )}
                              {row.monitoring_notes && (
                                <div>
                                  <p className="font-medium mb-1">Monitoring Notes:</p>
                                  <p className="text-muted-foreground bg-muted rounded p-3">{row.monitoring_notes}</p>
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
