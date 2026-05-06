/**
 * InvestigationJobLog — B-79
 *
 * Log viewer for investigation_jobs with Mark Complete action.
 *
 * Features:
 *  - KPI cards: Total / Open / In Progress / Completed
 *  - Filters: status, job_type, priority, keyword search
 *  - Table: title, job_type, priority, status, assigned_to, created_at, zone
 *  - Expandable row: description, completion_summary, followup_notes
 *  - Mark Complete inline action
 *
 * Route: /investigation-jobs-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  SearchCheck, RefreshCw, AlertCircle, Loader2,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type InvestigationJob = Database['public']['Tables']['investigation_jobs']['Row']

// ─── Styling maps ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  open:        { label: 'Open',        className: 'bg-yellow-100 text-yellow-800' },
  in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-800' },
  completed:   { label: 'Completed',   className: 'bg-green-100 text-green-800' },
  cancelled:   { label: 'Cancelled',   className: 'bg-gray-100 text-gray-600' },
}

const PRIORITY_STYLES: Record<string, string> = {
  low:      'bg-gray-100 text-gray-600',
  medium:   'bg-yellow-100 text-yellow-700',
  high:     'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InvestigationJobLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter]   = useState('all')
  const [prioFilter, setPrioFilter]   = useState('all')
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<InvestigationJob[]>({
    queryKey: ['investigation-jobs-log', orgId, statusFilter, typeFilter, prioFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('investigation_jobs')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all')   q = q.eq('job_type', typeFilter)
      if (prioFilter !== 'all')   q = q.eq('priority', prioFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const jobTypes = [...new Set(rows.map(r => r.job_type).filter(Boolean))].sort()

  const displayed = search
    ? rows.filter(r =>
        r.title?.toLowerCase().includes(search.toLowerCase()) ||
        r.description?.toLowerCase().includes(search.toLowerCase()))
    : rows

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total      = rows.length
  const open       = rows.filter(r => r.status === 'open').length
  const inProgress = rows.filter(r => r.status === 'in_progress').length
  const completed  = rows.filter(r => r.status === 'completed').length

  // ── Mutation ──────────────────────────────────────────────────────────────

  const markComplete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('investigation_jobs')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Job marked complete')
      qc.invalidateQueries({ queryKey: ['investigation-jobs-log'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SearchCheck className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Investigation Job Log</h1>
              <p className="text-sm text-muted-foreground">All investigation jobs across the organisation</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total',       value: total,       colour: 'text-gray-700' },
            { label: 'Open',        value: open,        colour: 'text-yellow-700' },
            { label: 'In Progress', value: inProgress,  colour: 'text-blue-700' },
            { label: 'Completed',   value: completed,   colour: 'text-green-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Input placeholder="Search title…" value={search} onChange={e => setSearch(e.target.value)} className="w-52" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_STYLES).map(([v, s]) => <SelectItem key={v} value={v}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Job type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {jobTypes.map(t => <SelectItem key={t!} value={t!}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={prioFilter} onValueChange={setPrioFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No investigation jobs found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map(row => {
                  const expanded = expandedId === row.id
                  const statusStyle = STATUS_STYLES[row.status ?? ''] ?? { label: row.status ?? '—', className: 'bg-gray-100 text-gray-600' }
                  const prioClass = PRIORITY_STYLES[row.priority ?? ''] ?? 'bg-gray-100 text-gray-600'
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-medium max-w-xs truncate">{row.title ?? '(untitled)'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.job_type ?? '—'}</TableCell>
                        <TableCell>{row.priority ? <Badge className={prioClass}>{row.priority}</Badge> : '—'}</TableCell>
                        <TableCell><Badge className={statusStyle.className}>{statusStyle.label}</Badge></TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.zone_id ?? '—'}</TableCell>
                        <TableCell className="text-right">
                          {row.status !== 'completed' && (
                            <Button
                              size="sm" variant="outline"
                              disabled={markComplete.isPending}
                              onClick={e => { e.stopPropagation(); markComplete.mutate(row.id) }}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Complete
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">Description</p>
                                <p className="text-muted-foreground">{row.description ?? 'None'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Completion Summary</p>
                                <p className="text-muted-foreground">{row.completion_summary ?? 'None'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Follow-up Notes</p>
                                <p className="text-muted-foreground">{row.followup_notes ?? 'None'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Template Used</p>
                                <p className="text-muted-foreground">{row.template_used ?? 'None'}</p>
                              </div>
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
