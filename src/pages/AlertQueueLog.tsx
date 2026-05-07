import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, Bell, ChevronDown, ChevronRight } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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

type AlertQueue = Database['public']['Tables']['alert_queue']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function AlertQueueLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const queryClient = useQueryClient()

  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<AlertQueue[]>({
    queryKey: ['alert-queue-log', orgId, typeFilter, statusFilter, priorityFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('alert_queue')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(600)

      if (typeFilter !== 'all') q = q.eq('alert_type', typeFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const acknowledgeMutation = useMutation({
    mutationFn: async (row: AlertQueue) => {
      const { error } = await supabase
        .from('alert_queue')
        .update({
          status: 'acknowledged',
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user?.id ?? null,
        })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-queue-log'] })
    },
  })

  const types = useMemo(() => [...new Set(rows.map((r) => r.alert_type).filter(Boolean))].sort(), [rows])
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(), [rows])
  const priorities = useMemo(() => [...new Set(rows.map((r) => r.priority).filter(Boolean))].sort(), [rows])
  const ackCount = rows.filter((r) => r.status?.toLowerCase() === 'acknowledged').length
  const requiresAckCount = rows.filter((r) => r.requires_acknowledgement).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Alert Queue Log</h1>
              <p className="text-sm text-muted-foreground">Queued operational alerts and acknowledgement workflow</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Alerts', value: rows.length, color: 'text-slate-700' },
            { label: 'Acknowledged', value: ackCount, color: 'text-green-700' },
            { label: 'Requires Ack', value: requiresAckCount, color: 'text-amber-700' },
            { label: 'Types', value: types.length, color: 'text-indigo-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {priorities.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
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
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-[120px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  const canAck = row.status?.toLowerCase() !== 'acknowledged'
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="text-sm">{row.alert_type}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{row.priority}</Badge></TableCell>
                        <TableCell className="text-sm">{row.status ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.title}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canAck || acknowledgeMutation.isPending}
                            onClick={() => acknowledgeMutation.mutate(row)}
                          >
                            Acknowledge
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>ID: {row.id}</span>
                              <span>User: {row.user_id}</span>
                              <span>Zone: {row.zone_id ?? '—'}</span>
                              <span>Ack by: {row.acknowledged_by ?? '—'}</span>
                              <span>Ack at: {fmtDate(row.acknowledged_at)}</span>
                              <span>Expires: {fmtDate(row.expires_at)}</span>
                            </div>
                            <div>
                              <p className="font-medium text-sm mb-1">Message</p>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.message}</p>
                            </div>
                            {row.details && (
                              <div>
                                <p className="font-medium text-sm mb-1">Details</p>
                                <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-40">{JSON.stringify(row.details, null, 2)}</pre>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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
