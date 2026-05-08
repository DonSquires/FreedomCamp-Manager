import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Truck, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type DispatchJobRow = Database['public']['Tables']['dispatch_jobs']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  dispatched: 'bg-blue-100 text-blue-800',
  en_route: 'bg-sky-100 text-sky-800',
  on_scene: 'bg-violet-100 text-violet-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-800',
}

export default function DispatchJobLog() {
  const { user } = useAuthStore()
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [titleQuery, setTitleQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<DispatchJobRow[]>({
    queryKey: ['dispatch-jobs-log', statusFilter, priorityFilter, titleQuery, dateFrom],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('dispatch_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)
      if (titleQuery.trim()) q = q.ilike('title', `%${titleQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const completedCount = rows.filter((r) => r.status === 'completed').length
  const slaBreachedCount = rows.filter((r) => r.sla_breached).length
  const criticalCount = rows.filter((r) => r.priority === 'critical').length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Truck className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Dispatch Job Log</h1>
              <p className="text-sm text-muted-foreground">Dispatched job records with status, priority, and SLA tracking</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Jobs', value: rows.length, color: 'text-gray-700' },
            { label: 'Completed', value: completedCount, color: 'text-green-700' },
            { label: 'SLA Breached', value: slaBreachedCount, color: 'text-red-700' },
            { label: 'Critical Priority', value: criticalCount, color: 'text-orange-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="dispatched">Dispatched</SelectItem>
              <SelectItem value="en_route">En Route</SelectItem>
              <SelectItem value="on_scene">On Scene</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
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
          <Input
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            placeholder="Search title…"
            className="w-44"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded px-3 py-1 text-sm w-40 bg-background"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No dispatch jobs found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Job #</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-sm font-mono">{row.job_number ?? '—'}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{row.title ?? '—'}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLORS[row.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                          {row.status ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${PRIORITY_COLORS[row.priority ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                          {row.priority ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.sla_breached ? (
                          <Badge className="bg-red-100 text-red-800 text-xs">Breached</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">OK</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">ID:</span> {row.id}</div>
                            <div><span className="font-medium">Job Type:</span> {row.job_type ?? '—'}</div>
                            <div><span className="font-medium">Zone:</span> {row.zone_id ?? '—'}</div>
                            <div><span className="font-medium">Assigned To:</span> {row.assigned_to ?? '—'}</div>
                            <div><span className="font-medium">Dispatched By:</span> {row.dispatched_by ?? '—'}</div>
                            <div><span className="font-medium">Created By:</span> {row.created_by ?? '—'}</div>
                            <div><span className="font-medium">Dispatched At:</span> {fmtDate(row.dispatched_at)}</div>
                            <div><span className="font-medium">En Route At:</span> {fmtDate(row.en_route_at)}</div>
                            <div><span className="font-medium">On Scene At:</span> {fmtDate(row.on_scene_at)}</div>
                            <div><span className="font-medium">Completed At:</span> {fmtDate(row.completed_at)}</div>
                            <div><span className="font-medium">SLA (min):</span> {row.response_sla_minutes ?? '—'}</div>
                            <div><span className="font-medium">Case ID:</span> {row.case_id ?? '—'}</div>
                          </div>
                          {row.address && <div><span className="font-medium">Address:</span> {row.address}</div>}
                          {row.description && <div><span className="font-medium">Description:</span> {row.description}</div>}
                          {row.completion_notes && <div><span className="font-medium">Completion Notes:</span> {row.completion_notes}</div>}
                          {row.cancel_reason && <div><span className="font-medium">Cancel Reason:</span> {row.cancel_reason}</div>}
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
