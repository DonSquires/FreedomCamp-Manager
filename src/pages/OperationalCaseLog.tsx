/**
 * OperationalCaseLog — B-80
 *
 * Admin log viewer for operational_cases.
 * Complements CaseBridge (B-37) which handles case creation and detailed editing.
 * This page focuses on bulk status overview, filtering, and the Close Case action.
 *
 * Features:
 *  - KPI cards: Total / Open / Pending / Closed
 *  - Filters: status select, case_type select, date-range pickers, free-text search
 *  - Table: case_number, title, case_type, status badge, created_from, created_at, closed_at
 *  - Expandable row: summary, officer_notes, dispatch_job_id link
 *  - Close Case action (status → 'closed', closed_at = now())
 *
 * Route: /operational-cases-log — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  LayoutList, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, Clock, XCircle,
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
import { Label } from '@/components/ui/label'
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

type OperationalCase = Database['public']['Tables']['operational_cases']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string) {
  switch (status) {
    case 'closed':    return <Badge variant="secondary" className="text-xs text-slate-600">Closed</Badge>
    case 'archived':  return <Badge variant="outline" className="text-xs text-muted-foreground">Archived</Badge>
    case 'pending':   return <Badge variant="outline" className="text-xs text-amber-700">Pending</Badge>
    case 'open':      return <Badge variant="secondary" className="text-xs text-blue-700">Open</Badge>
    default:          return <Badge variant="outline" className="text-xs">{status}</Badge>
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OperationalCaseLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('all')
  const [typeFilter, setType]     = useState('all')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data: cases = [], isLoading, refetch } = useQuery({
    queryKey: ['operational-cases-log', orgId, statusFilter, typeFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('operational_cases')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all') q = q.eq('case_type', typeFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo) q = q.lte('created_at', `${dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as OperationalCase[]
    },
  })

  // ── Close Case mutation ────────────────────────────────────────────────────

  const closeCase = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('operational_cases')
        .update({ status: 'closed', closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operational-cases-log'] })
      toast.success('Case closed')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to close case'),
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:   cases.length,
    open:    cases.filter(c => c.status === 'open').length,
    pending: cases.filter(c => c.status === 'pending').length,
    closed:  cases.filter(c => c.status === 'closed' || c.status === 'archived').length,
  }

  // ── Case types for filter ──────────────────────────────────────────────────

  const caseTypes = Array.from(new Set(cases.map(c => c.case_type))).sort()

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = cases.filter(c => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !c.title?.toLowerCase().includes(q) &&
        !c.case_number?.toLowerCase().includes(q) &&
        !c.summary?.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Operational Case Log" description="Overview of all operational cases and their current status">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <LayoutList className="h-5 w-5 text-violet-600" />
          <span className="font-semibold text-lg">Operational Case Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',   value: kpis.total,   icon: <LayoutList className="h-4 w-4" />,    color: 'text-foreground' },
          { label: 'Open',    value: kpis.open,    icon: <Clock className="h-4 w-4" />,          color: 'text-blue-600' },
          { label: 'Pending', value: kpis.pending, icon: <AlertCircle className="h-4 w-4" />,   color: 'text-amber-600' },
          { label: 'Closed',  value: kpis.closed,  icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-slate-500' },
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
            placeholder="Search case number, title, summary…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Case type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {caseTypes.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-36 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-36 h-9 text-sm"
          />
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && cases.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No operational cases found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Case #</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created From</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Closed</TableHead>
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
            {!isLoading && filtered.length === 0 && cases.length > 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No cases match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(c => {
              const expanded = expandedId === c.id
              const canClose = c.status !== 'closed' && c.status !== 'archived'

              return [
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : c.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.case_number ?? '—'}
                  </TableCell>
                  <TableCell className="font-medium text-sm max-w-48 truncate">
                    {c.title ?? <span className="italic text-muted-foreground">Untitled</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{c.case_type}</Badge>
                  </TableCell>
                  <TableCell>{statusBadge(c.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.created_from}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(c.created_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(c.closed_at)}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    {canClose && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-slate-600 hover:text-slate-800 h-7 text-xs"
                        onClick={() => closeCase.mutate(c.id)}
                        disabled={closeCase.isPending}
                      >
                        {closeCase.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Close'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${c.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={8} className="py-3 space-y-2 text-sm">
                      {c.summary && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Summary</span>
                          <p className="mt-0.5">{c.summary}</p>
                        </div>
                      )}
                      {c.officer_notes && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Officer Notes</span>
                          <p className="mt-0.5">{c.officer_notes}</p>
                        </div>
                      )}
                      {c.dispatch_job_id && (
                        <div className="text-xs text-muted-foreground">
                          Dispatch Job: <code className="bg-muted px-1 rounded">{c.dispatch_job_id.slice(0, 8)}…</code>
                        </div>
                      )}
                      {!c.summary && !c.officer_notes && !c.dispatch_job_id && (
                        <p className="text-xs text-muted-foreground italic">No additional details recorded.</p>
                      )}
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
          Showing {filtered.length} of {cases.length} cases
        </p>
      )}

      {/* Hint to full Case Bridge */}
      {!isLoading && cases.length > 0 && (
        <p className="text-xs text-muted-foreground mt-1 text-right">
          For detailed case management, case creation, and enforcement event linking see{' '}
          <a href="/case-bridge" className="underline hover:text-foreground">Case Bridge</a>.
        </p>
      )}
    </AppLayout>
  )
}
