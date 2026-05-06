/**
 * InvestigationJobLog — B-79
 *
 * Admin log viewer for investigation_jobs.
 *
 * Features:
 *  - KPI cards: Total / Open / Completed / Overdue
 *  - Filters: status select, priority select, free-text search (title / description)
 *  - Table: title, job_type, priority badge, status badge, assigned_to (UUID prefix),
 *           zone_id, created_at
 *  - Expandable row: description, completion_summary, followup_notes, associated IDs
 *  - Mark Complete action for non-completed jobs (status → 'completed', updated_at = now())
 *
 * Route: /investigation-jobs-log — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ClipboardList, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import type { Database } from '@/types/database'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type InvestigationJob = Database['public']['Tables']['investigation_jobs']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string | null) {
  switch (status) {
    case 'completed':   return <Badge variant="secondary" className="text-xs text-green-700">Completed</Badge>
    case 'in_progress': return <Badge variant="secondary" className="text-xs text-blue-700">In Progress</Badge>
    case 'assigned':    return <Badge variant="outline" className="text-xs text-indigo-700">Assigned</Badge>
    case 'overdue':     return <Badge variant="destructive" className="text-xs">Overdue</Badge>
    case 'pending':     return <Badge variant="outline" className="text-xs text-muted-foreground">Pending</Badge>
    default:            return <Badge variant="outline" className="text-xs">{status ?? '—'}</Badge>
  }
}

function priorityBadge(priority: string | null) {
  switch (priority) {
    case 'critical': return <Badge variant="destructive" className="text-xs">Critical</Badge>
    case 'high':     return <Badge variant="destructive" className="text-xs bg-orange-600">High</Badge>
    case 'medium':   return <Badge variant="secondary" className="text-xs text-amber-700">Medium</Badge>
    case 'low':      return <Badge variant="outline" className="text-xs text-muted-foreground">Low</Badge>
    default:         return <Badge variant="outline" className="text-xs">{priority ?? '—'}</Badge>
  }
}

const OPEN_STATUSES = ['pending', 'assigned', 'in_progress', 'overdue']

// ─── Component ────────────────────────────────────────────────────────────────

export default function InvestigationJobLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]         = useState('')
  const [statusFilter, setStatus]   = useState('all')
  const [priorityFilter, setPriority] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data: jobs = [], isLoading, refetch } = useQuery({
    queryKey: ['investigation-jobs-log', orgId, statusFilter, priorityFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('investigation_jobs')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as InvestigationJob[]
    },
  })

  // ── Mark Complete mutation ─────────────────────────────────────────────────

  const markComplete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('investigation_jobs')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investigation-jobs-log'] })
      toast.success('Job marked as completed')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update job'),
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:     jobs.length,
    open:      jobs.filter(j => OPEN_STATUSES.includes(j.status ?? '')).length,
    completed: jobs.filter(j => j.status === 'completed').length,
    overdue:   jobs.filter(j => j.status === 'overdue').length,
  }

  // ── Priorities for filter ──────────────────────────────────────────────────

  const priorities = Array.from(new Set(jobs.map(j => j.priority).filter(Boolean))).sort()

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = jobs.filter(j => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !j.title?.toLowerCase().includes(q) &&
        !j.description?.toLowerCase().includes(q) &&
        !j.job_type?.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Investigation Job Log" description="Review and manage all investigation jobs for this organisation">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-indigo-600" />
          <span className="font-semibold text-lg">Investigation Job Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',     value: kpis.total,     icon: <ClipboardList className="h-4 w-4" />, color: 'text-foreground' },
          { label: 'Open',      value: kpis.open,      icon: <Clock className="h-4 w-4" />,         color: 'text-blue-600' },
          { label: 'Completed', value: kpis.completed, icon: <CheckCircle2 className="h-4 w-4" />,  color: 'text-green-600' },
          { label: 'Overdue',   value: kpis.overdue,   icon: <XCircle className="h-4 w-4" />,       color: 'text-red-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title, description, job type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriority}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {priorities.map(p => (
              <SelectItem key={p!} value={p!}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Empty state */}
      {!isLoading && jobs.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No investigation jobs found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Title</TableHead>
              <TableHead>Job Type</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && jobs.length > 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No jobs match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(j => {
              const expanded = expandedId === j.id
              const isOpen = OPEN_STATUSES.includes(j.status ?? '')

              return [
                <TableRow
                  key={j.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : j.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-medium text-sm max-w-52 truncate">
                    {j.title ?? <span className="text-muted-foreground italic">Untitled</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{j.job_type ?? '—'}</TableCell>
                  <TableCell>{priorityBadge(j.priority)}</TableCell>
                  <TableCell>{statusBadge(j.status)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {j.assigned_to ? `${j.assigned_to.slice(0, 8)}…` : '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {j.zone_id ? `${j.zone_id.slice(0, 8)}…` : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(j.created_at)}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    {isOpen && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-green-700 hover:text-green-800 h-7 text-xs"
                        onClick={() => markComplete.mutate(j.id)}
                        disabled={markComplete.isPending}
                      >
                        {markComplete.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Complete'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${j.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={8} className="py-3 space-y-2 text-sm">
                      {j.description && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</span>
                          <p className="mt-0.5">{j.description}</p>
                        </div>
                      )}
                      {j.completion_summary && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Completion Summary</span>
                          <p className="mt-0.5">{j.completion_summary}</p>
                        </div>
                      )}
                      {j.followup_notes && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Follow-up Notes</span>
                          <p className="mt-0.5">{j.followup_notes}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-1">
                        {j.template_used && <span>Template: <code className="bg-muted px-1 rounded">{j.template_used.slice(0, 8)}…</code></span>}
                        {j.associated_person_id && <span>Person: <code className="bg-muted px-1 rounded">{j.associated_person_id.slice(0, 8)}…</code></span>}
                        {j.associated_vehicle_id && <span>Vehicle: <code className="bg-muted px-1 rounded">{j.associated_vehicle_id.slice(0, 8)}…</code></span>}
                        {j.associated_observation_id && <span>Observation: <code className="bg-muted px-1 rounded">{j.associated_observation_id.slice(0, 8)}…</code></span>}
                        {j.followup_days != null && <span>Follow-up in {j.followup_days} day{j.followup_days !== 1 ? 's' : ''}</span>}
                        {j.quick_completion && <span className="text-green-700">Quick completion enabled</span>}
                      </div>
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
          Showing {filtered.length} of {jobs.length} jobs
        </p>
      )}
    </AppLayout>
  )
}
