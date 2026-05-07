/**
 * FeatureFlagEvaluationLog — B-124
 *
 * Admin log for feature_flag_evaluations — per-request flag resolution records.
 * Shows whether each evaluation resolved the flag as enabled or disabled,
 * the rollout bucket drawn, and the context attached to the evaluation.
 *
 * Features:
 *  - KPIs: Total / Enabled / Disabled / Unique Flags
 *  - Filters: enabled (yes/no) / flag_id search / date-from
 *  - Expandable row: evaluation_context JSON + rollout_bucket + user_id
 *
 * Route: /feature-flag-evaluations-log — master only
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  FlaskConical, RefreshCw, AlertCircle, Loader2,
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

type EvalRow = Database['public']['Tables']['feature_flag_evaluations']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function FeatureFlagEvaluationLog() {
  const [enabledFilter, setEnabledFilter] = useState('all')
  const [flagQuery, setFlagQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<EvalRow[]>({
    queryKey: ['feature-flag-evaluations-log', enabledFilter, flagQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('feature_flag_evaluations')
        .select('*')
        .order('evaluated_at', { ascending: false })
        .limit(500)

      if (enabledFilter === 'yes') q = q.eq('enabled', true)
      if (enabledFilter === 'no') q = q.eq('enabled', false)
      if (flagQuery.trim()) q = q.ilike('flag_id', `%${flagQuery.trim()}%`)
      if (dateFrom) q = q.gte('evaluated_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const enabledCount = rows.filter(r => r.enabled).length
  const disabledCount = rows.filter(r => !r.enabled).length
  const uniqueFlags = new Set(rows.map(r => r.flag_id)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FlaskConical className="h-6 w-6 text-purple-600" />
            <div>
              <h1 className="text-2xl font-bold">Feature Flag Evaluation Log</h1>
              <p className="text-sm text-muted-foreground">Per-request feature flag resolution records</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Evaluations', value: rows.length, colour: 'text-gray-700' },
            { label: 'Resolved Enabled', value: enabledCount, colour: 'text-green-700' },
            { label: 'Resolved Disabled', value: disabledCount, colour: 'text-red-700' },
            { label: 'Unique Flags', value: uniqueFlags, colour: 'text-purple-700' },
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
          <Select value={enabledFilter} onValueChange={setEnabledFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Result" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              <SelectItem value="yes">Enabled only</SelectItem>
              <SelectItem value="no">Disabled only</SelectItem>
            </SelectContent>
          </Select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No evaluations found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Evaluated At</TableHead>
                  <TableHead>Flag ID</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Rollout Bucket</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Org</TableHead>
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
                        <TableCell className="text-sm">{fmtDate(row.evaluated_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{row.flag_id?.slice(0, 16)}…</TableCell>
                        <TableCell>
                          <Badge className={row.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                            {row.enabled ? 'enabled' : 'disabled'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-mono text-muted-foreground">{row.rollout_bucket ?? '—'}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{row.user_id ? `${row.user_id.slice(0, 8)}…` : '—'}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{row.organization_id ? `${row.organization_id.slice(0, 8)}…` : '—'}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Evaluation ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Flag ID:</span> <span className="font-mono text-xs">{row.flag_id}</span></div>
                                <div><span className="font-medium">User ID:</span> <span className="font-mono text-xs">{row.user_id ?? '—'}</span></div>
                                <div><span className="font-medium">Created By:</span> <span className="font-mono text-xs">{row.created_by ?? '—'}</span></div>
                                <div><span className="font-medium">Rollout Bucket:</span> <span className="text-muted-foreground">{row.rollout_bucket ?? '—'}</span></div>
                              </div>
                              {row.evaluation_context && (
                                <div>
                                  <p className="font-medium mb-1">Evaluation Context:</p>
                                  <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-32">{JSON.stringify(row.evaluation_context, null, 2)}</pre>
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
