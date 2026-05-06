/**
 * BugReportLog — B-96
 *
 * Log viewer for bug_reports — user-submitted and auto-reported bug reports.
 *
 * Features:
 *  - KPI cards: Total / Open / AI Analyzed / Requires Human Review
 *  - Filters: issue_type (dynamic), severity (dynamic), status (dynamic), date from
 *  - Table: title, issue_type badge, severity badge, status badge,
 *           user_role, app_version, created_at, ai_analyzed
 *  - Actions: Mark Resolved
 *  - Expandable row: description, steps_to_reproduce, expected/actual behavior,
 *                    ai_suggested_fix, resolution_notes
 *
 * Route: /bug-reports-log — admin/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Bug, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, BrainCircuit,
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

type BugReport = Database['public']['Tables']['bug_reports']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function severityBadge(severity: string) {
  if (severity === 'critical') return 'bg-red-200 text-red-900'
  if (severity === 'high')     return 'bg-red-100 text-red-800'
  if (severity === 'medium')   return 'bg-yellow-100 text-yellow-800'
  if (severity === 'low')      return 'bg-green-100 text-green-800'
  return 'bg-gray-100 text-gray-700'
}

function statusBadge(status: string | null) {
  if (!status) return 'bg-gray-100 text-gray-600'
  if (status === 'open')       return 'bg-blue-100 text-blue-800'
  if (status === 'in_progress')return 'bg-purple-100 text-purple-800'
  if (status === 'resolved')   return 'bg-green-100 text-green-800'
  if (status === 'closed')     return 'bg-gray-100 text-gray-600'
  return 'bg-yellow-100 text-yellow-800'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BugReportLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [issueTypeFilter, setIssueTypeFilter] = useState('all')
  const [severityFilter,  setSeverityFilter]  = useState('all')
  const [statusFilter,    setStatusFilter]    = useState('all')
  const [dateFrom,        setDateFrom]        = useState('')
  const [expandedId,      setExpandedId]      = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<BugReport[]>({
    queryKey: ['bug-reports-log', orgId, issueTypeFilter, severityFilter, statusFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('bug_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      // Filter by org when available (some reports may have null org_id for system-wide reports)
      if (orgId) q = q.or(`organization_id.eq.${orgId},organization_id.is.null`)

      if (issueTypeFilter !== 'all') q = q.eq('issue_type', issueTypeFilter)
      if (severityFilter  !== 'all') q = q.eq('severity', severityFilter)
      if (statusFilter    !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom)                  q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // ── Resolve mutation ───────────────────────────────────────────────────────

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('bug_reports')
        .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: user?.id ?? null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Bug report marked as resolved')
      qc.invalidateQueries({ queryKey: ['bug-reports-log'] })
    },
    onError: () => toast.error('Failed to update bug report'),
  })

  const issueTypes    = [...new Set(rows.map(r => r.issue_type).filter(Boolean))].sort()
  const severities    = [...new Set(rows.map(r => r.severity).filter(Boolean))].sort()
  const statusTypes   = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const openCount     = rows.filter(r => r.status === 'open' || r.status == null).length
  const aiAnalyzed    = rows.filter(r => r.ai_analyzed).length
  const needsReview   = rows.filter(r => r.requires_human_review).length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bug className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Bug Report Log</h1>
              <p className="text-sm text-muted-foreground">User-submitted and auto-reported application bugs</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Reports',       value: rows.length,  colour: 'text-gray-700' },
            { label: 'Open',                value: openCount,    colour: 'text-blue-700' },
            { label: 'AI Analyzed',         value: aiAnalyzed,   colour: 'text-purple-700' },
            { label: 'Needs Human Review',  value: needsReview,  colour: 'text-red-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={issueTypeFilter} onValueChange={setIssueTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Issue type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All issue types</SelectItem>
              {issueTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {severities.map(s => (
                <SelectItem key={s} value={s}>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs mr-1 ${severityBadge(s)}`}>{s}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusTypes.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No bug reports found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>AI</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-32" />
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
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="text-sm font-medium max-w-48 truncate">{row.title}</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.issue_type}</Badge></TableCell>
                        <TableCell><Badge className={severityBadge(row.severity)}>{row.severity}</Badge></TableCell>
                        <TableCell><Badge className={statusBadge(row.status)}>{row.status ?? 'open'}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.user_role}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.app_version}</TableCell>
                        <TableCell>
                          {row.ai_analyzed && (
                            <BrainCircuit className="h-4 w-4 text-purple-500" />
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          {(row.status === 'open' || row.status == null) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              disabled={resolve.isPending}
                              onClick={() => resolve.mutate(row.id)}
                            >
                              Resolve
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={10} className="p-4 space-y-3">
                            <div>
                              <p className="font-medium text-sm mb-1">Description</p>
                              <p className="text-sm text-muted-foreground">{row.description}</p>
                            </div>
                            {row.steps_to_reproduce && (
                              <div>
                                <p className="font-medium text-sm mb-1">Steps to Reproduce</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.steps_to_reproduce}</p>
                              </div>
                            )}
                            {(row.expected_behavior || row.actual_behavior) && (
                              <div className="grid grid-cols-2 gap-4">
                                {row.expected_behavior && (
                                  <div>
                                    <p className="font-medium text-sm mb-1">Expected</p>
                                    <p className="text-sm text-muted-foreground">{row.expected_behavior}</p>
                                  </div>
                                )}
                                {row.actual_behavior && (
                                  <div>
                                    <p className="font-medium text-sm mb-1">Actual</p>
                                    <p className="text-sm text-muted-foreground">{row.actual_behavior}</p>
                                  </div>
                                )}
                              </div>
                            )}
                            {row.ai_suggested_fix && (
                              <div>
                                <p className="font-medium text-sm mb-1 flex items-center gap-1">
                                  <BrainCircuit className="h-3 w-3 text-purple-500" /> AI Suggested Fix
                                </p>
                                <p className="text-sm text-muted-foreground">{row.ai_suggested_fix}</p>
                              </div>
                            )}
                            {row.resolution_notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Resolution Notes</p>
                                <p className="text-sm text-muted-foreground">{row.resolution_notes}</p>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              {row.current_page && <span>Page: {row.current_page}</span>}
                              {row.requires_human_review && (
                                <span className="text-red-600 font-medium">⚠ Requires human review</span>
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
