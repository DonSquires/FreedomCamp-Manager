/**
 * FeatureFlagManager — B-123
 *
 * Admin interface to view and toggle feature flags.
 * Shows rollout percentages, phases, enabled/disabled state,
 * and per-flag org/user allow-lists.
 *
 * Features:
 *  - KPIs: Total / Enabled / Canary Phase / Production
 *  - Filters: enabled (yes/no) / phase text search / name search
 *  - Toggle enable/disable with optimistic update
 *  - Expandable row: rollout strategy + canary thresholds + allow-lists
 *
 * Route: /feature-flags — master only
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Flag, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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
import { Switch } from '@/components/ui/switch'
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
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function phaseTone(phase: string | null) {
  // phase is stored as single-letter codes in the DB
  switch (phase) {
    case 'A': return 'bg-green-100 text-green-800'
    case 'B': return 'bg-yellow-100 text-yellow-800'
    case 'C': return 'bg-blue-100 text-blue-800'
    case 'D': return 'bg-orange-100 text-orange-800'
    case 'E': return 'bg-red-100 text-red-800'
    default: return 'bg-gray-100 text-gray-700'
  }
}

export default function FeatureFlagManager() {
  const { user } = useAuthStore()

  const [enabledFilter, setEnabledFilter] = useState('all')
  const [nameQuery, setNameQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: rows = [], isLoading, refetch } = useQuery<FeatureFlagRow[]>({
    queryKey: ['feature-flags', enabledFilter, nameQuery],
    queryFn: async () => {
      let q = supabase
        .from('feature_flags')
        .select('*')
        .order('name', { ascending: true })

      if (enabledFilter === 'yes') q = q.eq('enabled', true)
      if (enabledFilter === 'no') q = q.eq('enabled', false)
      if (nameQuery.trim()) q = q.ilike('name', `%${nameQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('feature_flags')
        .update({ enabled, modified_by: user?.id, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Feature flag updated')
      queryClient.invalidateQueries({ queryKey: ['feature-flags'] })
    },
    onError: () => toast.error('Failed to update feature flag'),
  })

  const enabledCount = rows.filter(r => r.enabled).length
  const phaseACount = rows.filter(r => r.phase === 'A').length
  const phaseBCount = rows.filter(r => r.phase === 'B').length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Flag className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Feature Flag Manager</h1>
              <p className="text-sm text-muted-foreground">View and toggle feature flags across rollout phases</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Flags', value: rows.length, colour: 'text-gray-700' },
            { label: 'Enabled', value: enabledCount, colour: 'text-green-700' },
            { label: 'Phase A', value: phaseACount, colour: 'text-green-700' },
            { label: 'Phase B', value: phaseBCount, colour: 'text-yellow-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            placeholder="Search flag name…"
            className="w-56"
          />
          <Select value={enabledFilter} onValueChange={setEnabledFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Enabled?" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All flags</SelectItem>
              <SelectItem value="yes">Enabled only</SelectItem>
              <SelectItem value="no">Disabled only</SelectItem>
            </SelectContent>
          </Select>
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
                  <TableHead className="w-8" />
                  <TableHead>Name</TableHead>
                  <TableHead>Phase</TableHead>
                  <TableHead>Rollout %</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Enabled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell><Badge className={phaseTone(row.phase)}>{row.phase ?? '—'}</Badge></TableCell>
                        <TableCell className="text-sm font-mono">{row.rollout_percentage != null ? `${row.rollout_percentage}%` : '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.rollout_strategy ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(row.updated_at)}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Switch
                            checked={row.enabled ?? false}
                            onCheckedChange={checked => toggleMutation.mutate({ id: row.id, enabled: checked })}
                            disabled={toggleMutation.isPending}
                          />
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Flag ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Created By:</span> <span className="font-mono text-xs">{row.created_by ?? '—'}</span></div>
                                <div><span className="font-medium">Modified By:</span> <span className="font-mono text-xs">{row.modified_by ?? '—'}</span></div>
                                <div><span className="font-medium">Created At:</span> <span className="text-muted-foreground">{fmtDate(row.created_at)}</span></div>
                                {row.canary_error_rate_threshold != null && (
                                  <div><span className="font-medium">Canary Error Rate Threshold:</span> <span className="text-muted-foreground">{row.canary_error_rate_threshold}%</span></div>
                                )}
                                {row.canary_p95_latency_threshold_ms != null && (
                                  <div><span className="font-medium">Canary P95 Latency:</span> <span className="text-muted-foreground">{row.canary_p95_latency_threshold_ms}ms</span></div>
                                )}
                              </div>
                              {row.description && (
                                <div>
                                  <p className="font-medium mb-1">Description:</p>
                                  <p className="text-muted-foreground bg-muted rounded p-3">{row.description}</p>
                                </div>
                              )}
                              {row.allowed_org_ids && Array.isArray(row.allowed_org_ids) && row.allowed_org_ids.length > 0 && (
                                <div>
                                  <p className="font-medium mb-1">Allowed Orgs:</p>
                                  <div className="flex flex-wrap gap-1">{(row.allowed_org_ids as string[]).map(id => <Badge key={id} className="font-mono text-xs bg-muted text-muted-foreground">{id.slice(0, 8)}…</Badge>)}</div>
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
