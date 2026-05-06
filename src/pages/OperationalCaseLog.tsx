/**
 * OperationalCaseLog — B-80
 *
 * Log viewer for operational_cases with Close Case action.
 *
 * Features:
 *  - KPI cards: Total / Open / Closed
 *  - Filters: status, case_type, keyword search
 *  - Table: case_number, title, case_type, status, created_from, created_at
 *  - Expandable row: summary, officer_notes, dispatch_job_id, closed_at
 *  - Close Case inline action (sets status = 'closed', closed_at = now())
 *
 * Route: /operational-cases-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  FolderOpen, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, XCircle,
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

type OperationalCase = Database['public']['Tables']['operational_cases']['Row']

// ─── Styling maps ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  open:      { label: 'Open',      className: 'bg-yellow-100 text-yellow-800' },
  active:    { label: 'Active',    className: 'bg-blue-100 text-blue-800' },
  closed:    { label: 'Closed',    className: 'bg-gray-100 text-gray-600' },
  escalated: { label: 'Escalated', className: 'bg-red-100 text-red-800' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OperationalCaseLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter]   = useState('all')
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<OperationalCase[]>({
    queryKey: ['operational-cases-log', orgId, statusFilter, typeFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('operational_cases')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all')   q = q.eq('case_type', typeFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const caseTypes = [...new Set(rows.map(r => r.case_type).filter(Boolean))].sort()

  const displayed = search
    ? rows.filter(r =>
        r.title?.toLowerCase().includes(search.toLowerCase()) ||
        r.case_number?.toLowerCase().includes(search.toLowerCase()))
    : rows

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total  = rows.length
  const open   = rows.filter(r => r.status === 'open' || r.status === 'active').length
  const closed = rows.filter(r => r.status === 'closed').length

  // ── Mutation ──────────────────────────────────────────────────────────────

  const closeCase = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('operational_cases')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Case closed')
      qc.invalidateQueries({ queryKey: ['operational-cases-log'] })
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
            <FolderOpen className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Operational Case Log</h1>
              <p className="text-sm text-muted-foreground">Operational cases across the organisation</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total',  value: total,  colour: 'text-gray-700' },
            { label: 'Open',   value: open,   colour: 'text-yellow-700' },
            { label: 'Closed', value: closed, colour: 'text-gray-500' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Input placeholder="Search case/title…" value={search} onChange={e => setSearch(e.target.value)} className="w-52" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_STYLES).map(([v, s]) => <SelectItem key={v} value={v}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Case type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {caseTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No operational cases found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Case #</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created From</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map(row => {
                  const expanded = expandedId === row.id
                  const statusStyle = STATUS_STYLES[row.status] ?? { label: row.status, className: 'bg-gray-100 text-gray-600' }
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-mono text-xs">{row.case_number ?? '—'}</TableCell>
                        <TableCell className="font-medium max-w-xs truncate">{row.title ?? '(untitled)'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.case_type}</TableCell>
                        <TableCell><Badge className={statusStyle.className}>{statusStyle.label}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.created_from}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="text-right">
                          {row.status !== 'closed' && (
                            <Button
                              size="sm" variant="outline"
                              disabled={closeCase.isPending}
                              onClick={e => { e.stopPropagation(); closeCase.mutate(row.id) }}
                            >
                              <XCircle className="h-4 w-4 mr-1" /> Close Case
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">Summary</p>
                                <p className="text-muted-foreground">{row.summary ?? 'None'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Officer Notes</p>
                                <p className="text-muted-foreground">{row.officer_notes ?? 'None'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Dispatch Job</p>
                                <p className="text-muted-foreground font-mono text-xs">{row.dispatch_job_id ?? '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Closed At</p>
                                <p className="text-muted-foreground">{fmtDate(row.closed_at)}</p>
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
