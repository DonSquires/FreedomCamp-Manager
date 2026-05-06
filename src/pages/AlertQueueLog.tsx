/**
 * AlertQueueLog — B-119
 *
 * Operational alert queue viewer and manager.
 * Shows all alerts in the queue with priority/status/type filters and
 * supports acknowledging dismissible alerts.
 *
 * Features:
 *  - KPIs: Total / Unacknowledged / High-Priority / Expired
 *  - Filters: alert_type / status / priority / can_dismiss
 *  - Expandable row: full details + observation/vehicle/person refs
 *
 * Route: /alert-queue-log — admin / admin_officer / master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Bell, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

type AlertQueueRow = Database['public']['Tables']['alert_queue']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function priorityTone(p: string | null) {
  switch (p) {
    case 'critical': return 'bg-red-100 text-red-800'
    case 'high': return 'bg-orange-100 text-orange-800'
    case 'medium': return 'bg-yellow-100 text-yellow-800'
    case 'low': return 'bg-gray-100 text-gray-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function statusTone(s: string | null) {
  switch (s) {
    case 'acknowledged': return 'bg-green-100 text-green-800'
    case 'active': return 'bg-blue-100 text-blue-800'
    case 'expired': return 'bg-gray-100 text-gray-500'
    default: return 'bg-gray-100 text-gray-700'
  }
}

export default function AlertQueueLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const queryClient = useQueryClient()

  const [alertTypeFilter, setAlertTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<AlertQueueRow[]>({
    queryKey: ['alert-queue-log', orgId, alertTypeFilter, statusFilter, priorityFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('alert_queue')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (alertTypeFilter !== 'all') q = q.eq('alert_type', alertTypeFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Not authenticated')
      const { error } = await supabase
        .from('alert_queue')
        .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by: user.id })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Alert acknowledged')
      queryClient.invalidateQueries({ queryKey: ['alert-queue-log'] })
    },
    onError: () => toast.error('Failed to acknowledge alert'),
  })

  const alertTypes = [...new Set(rows.map(r => r.alert_type).filter(Boolean))].sort()
  const unacknowledgedCount = rows.filter(r => r.status !== 'acknowledged').length
  const highPriorityCount = rows.filter(r => r.priority === 'critical' || r.priority === 'high').length
  const expiredCount = rows.filter(r => r.status === 'expired').length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Alert Queue Log</h1>
              <p className="text-sm text-muted-foreground">Operational alerts awaiting acknowledgement or action</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Alerts', value: rows.length, colour: 'text-gray-700' },
            { label: 'Unacknowledged', value: unacknowledgedCount, colour: 'text-orange-700' },
            { label: 'High / Critical', value: highPriorityCount, colour: 'text-red-700' },
            { label: 'Expired', value: expiredCount, colour: 'text-gray-500' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={alertTypeFilter} onValueChange={setAlertTypeFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Alert type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All alert types</SelectItem>
              {alertTypes.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No alerts found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Created</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const canDismiss = row.can_dismiss && row.status !== 'acknowledged'
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${row.priority === 'critical' ? 'bg-red-50/40' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="text-sm font-medium max-w-48 truncate">{row.title ?? '—'}</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.alert_type ?? '—'}</Badge></TableCell>
                        <TableCell><Badge className={priorityTone(row.priority)}>{row.priority ?? '—'}</Badge></TableCell>
                        <TableCell><Badge className={statusTone(row.status)}>{row.status ?? '—'}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(row.expires_at)}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          {canDismiss && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={dismissMutation.isPending}
                              onClick={() => dismissMutation.mutate(row.id)}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Acknowledge
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Alert ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Push Sent:</span> <span className="text-muted-foreground">{row.push_sent ? 'Yes' : 'No'}</span></div>
                                <div><span className="font-medium">Observation:</span> <span className="font-mono text-xs">{row.observation_id ?? '—'}</span></div>
                                <div><span className="font-medium">Vehicle:</span> <span className="font-mono text-xs">{row.vehicle_id ?? '—'}</span></div>
                                <div><span className="font-medium">Person:</span> <span className="font-mono text-xs">{row.person_id ?? '—'}</span></div>
                                <div><span className="font-medium">Zone:</span> <span className="font-mono text-xs">{row.zone_id ?? '—'}</span></div>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Message:</p>
                                <p className="text-muted-foreground bg-muted rounded p-3">{row.message ?? '—'}</p>
                              </div>
                              {row.details && (
                                <div>
                                  <p className="font-medium mb-1">Details:</p>
                                  <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-32">{JSON.stringify(row.details, null, 2)}</pre>
                                </div>
                              )}
                              {row.acknowledged_at && (
                                <div className="text-muted-foreground text-xs">Acknowledged: {fmtDate(row.acknowledged_at)} · Notes: {row.acknowledgement_notes ?? '—'}</div>
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
