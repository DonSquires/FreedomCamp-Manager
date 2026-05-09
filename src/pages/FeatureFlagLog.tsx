import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Flag, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type FeatureFlagRow = Database['public']['Tables']['feature_flags']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try {
    return format(parseISO(ts), 'dd MMM yyyy HH:mm')
  } catch {
    return ts
  }
}

function listCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

export default function FeatureFlagLog() {
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [phaseFilter, setPhaseFilter] = useState<'all' | 'A' | 'B' | 'C' | 'D' | 'E'>('all')
  const [nameQuery, setNameQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<FeatureFlagRow[]>({
    queryKey: ['feature-flags-log', enabledFilter, phaseFilter, nameQuery],
    queryFn: async () => {
      let q = supabase
        .from('feature_flags')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500)

      if (enabledFilter === 'enabled') q = q.eq('enabled', true)
      if (enabledFilter === 'disabled') q = q.eq('enabled', false)
      if (phaseFilter !== 'all') q = q.eq('phase', phaseFilter)
      if (nameQuery.trim()) q = q.ilike('name', `%${nameQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const enabledCount = rows.filter((row) => row.enabled).length
  const orgScopedCount = rows.filter((row) => listCount(row.allowed_org_ids) > 0).length
  const userScopedCount = rows.filter((row) => listCount(row.allowed_user_ids) > 0).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Flag className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Feature Flag Log</h1>
              <p className="text-sm text-muted-foreground">Rollout and allow-list audit view for feature_flags</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Flags', value: rows.length, color: 'text-gray-700' },
            { label: 'Enabled', value: enabledCount, color: 'text-green-700' },
            { label: 'Org Scoped', value: orgScopedCount, color: 'text-amber-700' },
            { label: 'User Scoped', value: userScopedCount, color: 'text-sky-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={enabledFilter} onValueChange={(value) => setEnabledFilter(value as 'all' | 'enabled' | 'disabled')}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Enabled" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All flags</SelectItem>
              <SelectItem value="enabled">Enabled</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={phaseFilter} onValueChange={(value) => setPhaseFilter(value as 'all' | 'A' | 'B' | 'C' | 'D' | 'E')}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Phase" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All phases</SelectItem>
              <SelectItem value="A">Phase A</SelectItem>
              <SelectItem value="B">Phase B</SelectItem>
              <SelectItem value="C">Phase C</SelectItem>
              <SelectItem value="D">Phase D</SelectItem>
              <SelectItem value="E">Phase E</SelectItem>
            </SelectContent>
          </Select>
          <Input value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} placeholder="Flag name…" className="w-44" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No feature flags found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Updated</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phase</TableHead>
                  <TableHead>Rollout</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.updated_at)}</TableCell>
                      <TableCell className="text-sm font-medium">{row.name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.phase ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.rollout_percentage != null ? `${row.rollout_percentage}%` : '—'}</TableCell>
                      <TableCell>{row.enabled ? <Badge className="bg-green-100 text-green-800 text-xs">Enabled</Badge> : <Badge variant="outline" className="text-xs">Disabled</Badge>}</TableCell>
                      <TableCell className="text-sm">{row.rollout_strategy ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Flag ID:</span> {row.id}</div>
                            <div><span className="font-medium">Created At:</span> {fmtDate(row.created_at)}</div>
                            <div><span className="font-medium">Created By:</span> {row.created_by ?? '—'}</div>
                            <div><span className="font-medium">Modified By:</span> {row.modified_by ?? '—'}</div>
                            <div><span className="font-medium">Org Allow-list:</span> {listCount(row.allowed_org_ids)}</div>
                            <div><span className="font-medium">User Allow-list:</span> {listCount(row.allowed_user_ids)}</div>
                          </div>
                          <div><span className="font-medium">Description:</span> {row.description ?? '—'}</div>
                          <div><span className="font-medium">Canary Error Threshold:</span> {row.canary_error_rate_threshold != null ? `${row.canary_error_rate_threshold}%` : '—'}</div>
                          <div><span className="font-medium">Canary P95 Threshold:</span> {row.canary_p95_latency_threshold_ms != null ? `${row.canary_p95_latency_threshold_ms} ms` : '—'}</div>
                          <div><span className="font-medium">Allowed Orgs:</span> {listCount(row.allowed_org_ids) ? JSON.stringify(row.allowed_org_ids) : '—'}</div>
                          <div><span className="font-medium">Allowed Users:</span> {listCount(row.allowed_user_ids) ? JSON.stringify(row.allowed_user_ids) : '—'}</div>
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
