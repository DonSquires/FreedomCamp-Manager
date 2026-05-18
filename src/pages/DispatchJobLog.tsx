import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ClipboardList, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

const STATUS_COLOURS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  dispatched: 'bg-blue-100 text-blue-800',
  acknowledged: 'bg-indigo-100 text-indigo-800',
  en_route: 'bg-cyan-100 text-cyan-800',
  on_scene: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-rose-100 text-rose-800',
}

function statusBadge(status: string) {
  return STATUS_COLOURS[status?.toLowerCase()] ?? 'bg-gray-100 text-gray-700'
}

export default function DispatchJobLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [jobTypeFilter, setJobTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<DispatchJobRow[]>({
    queryKey: ['dispatch-jobs-log', orgId, searchQuery, statusFilter, jobTypeFilter, priorityFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('dispatch_jobs')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (jobTypeFilter !== 'all') q = q.eq('job_type', jobTypeFilter)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (searchQuery.trim()) {
        const term = searchQuery.trim()
        q = q.or(`job_number.ilike.%${term}%,title.ilike.%${term}%,address.ilike.%${term}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter(r => ['pending', 'dispatched', 'acknowledged', 'en_route', 'on_scene'].includes(r.status)).length
  const completedCount = rows.filter(r => r.status === 'completed').length
  const slaBreachedCount = rows.filter(r => r.sla_breached).length
  const statusOptions = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const jobTypeOptions = [...new Set(rows.map(r => r.job_type).filter(Boolean))].sort()
  const priorityOptions = [...new Set(rows.map(r => r.priority).filter(Boolean))].sort()

  const toggleExpanded = (rowId: string) => {
    setExpanded(expanded === rowId ? null : rowId)
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Dispatch Job Log</h1>
              <p className="text-sm text-muted-foreground">All dispatch jobs with lifecycle timestamps, assignment metadata, and SLA status</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Jobs', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-blue-700' },
            { label: 'Completed', value: completedCount, colour: 'text-green-700' },
            { label: 'SLA Breached', value: slaBreachedCount, colour: 'text-rose-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            aria-label="Search job number, title, or address"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search job #, title, address…"
            className="w-60"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" aria-label="Filter by status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusOptions.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
            <SelectTrigger className="w-48" aria-label="Filter by job type"><SelectValue placeholder="Job type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All job types</SelectItem>
              {jobTypeOptions.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-40" aria-label="Filter by priority"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {priorityOptions.map(p => <SelectItem key={p} value={p!}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input aria-label="Filter from created date" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="hover:bg-muted/40">
                      <TableCell className="font-mono text-xs">{row.job_number ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.job_type}</TableCell>
                      <TableCell><Badge className={statusBadge(row.status)}>{row.status}</Badge></TableCell>
                      <TableCell className="text-sm">{row.priority}</TableCell>
                      <TableCell className="text-sm max-w-[12rem] truncate">{row.title}</TableCell>
                      <TableCell className="font-mono text-xs">{row.assigned_to ? `${row.assigned_to.slice(0, 8)}…` : '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-sky-700"
                          aria-expanded={expanded === row.id}
                          aria-controls={`dispatch-job-detail-${row.id}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleExpanded(row.id)
                          }}
                        >
                          {expanded === row.id ? 'Hide details' : 'Show details'}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow id={`dispatch-job-detail-${row.id}`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          {row.address && <div><span className="font-medium">Address:</span> {row.address}</div>}
                          {row.description && <div><span className="font-medium">Description:</span> {row.description}</div>}
                          {row.caller_name && <div><span className="font-medium">Caller:</span> {row.caller_name}{row.caller_phone ? ` (${row.caller_phone})` : ''}</div>}
                          <div><span className="font-medium">Client site:</span> {row.client_site_id ?? '—'} &nbsp; <span className="font-medium">Zone:</span> {row.zone_id ?? '—'}</div>
                          <div><span className="font-medium">Case:</span> {row.case_id ?? '—'} &nbsp; <span className="font-medium">Breach alert:</span> {row.breach_alert_id ?? '—'}</div>
                          <div><span className="font-medium">Investigation job:</span> {row.investigation_job_id ?? '—'} &nbsp; <span className="font-medium">Escalation level:</span> {row.escalation_level}</div>
                          <div><span className="font-medium">Dispatched:</span> {fmtDate(row.dispatched_at)} &nbsp; <span className="font-medium">Acknowledged:</span> {fmtDate(row.acknowledged_at)}</div>
                          <div><span className="font-medium">En route:</span> {fmtDate(row.en_route_at)} &nbsp; <span className="font-medium">On scene:</span> {fmtDate(row.on_scene_at)}</div>
                          <div><span className="font-medium">Completed:</span> {fmtDate(row.completed_at)} &nbsp; <span className="font-medium">Cancelled:</span> {fmtDate(row.cancelled_at)}</div>
                          {row.completion_notes && <div><span className="font-medium">Completion notes:</span> {row.completion_notes}</div>}
                          {row.cancel_reason && <div><span className="font-medium">Cancel reason:</span> {row.cancel_reason}</div>}
                          {(row.gps_lat != null && row.gps_lng != null) && <div><span className="font-medium">GPS:</span> {row.gps_lat}, {row.gps_lng}</div>}
                          <div><span className="font-medium">Updated:</span> {fmtDate(row.updated_at)} &nbsp; <span className="font-medium">SLA:</span> {row.response_sla_minutes ?? '—'} min / {row.sla_breached ? 'breached' : 'within SLA'}</div>
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
