/**
 * BobProposalLog — B-139
 *
 * Admin audit log for bob_action_proposals.
 * Surfaces all Bob-generated proposals with approval status, impact level, and execution outcomes.
 *
 * Route: /bob-proposals-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { BrainCircuit, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
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

type ProposalRow = Database['public']['Tables']['bob_action_proposals']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLOURS: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-800',
  approved:  'bg-green-100 text-green-800',
  rejected:  'bg-rose-100 text-rose-800',
  executed:  'bg-blue-100 text-blue-800',
  failed:    'bg-red-100 text-red-800',
  escalated: 'bg-purple-100 text-purple-800',
}

const IMPACT_COLOURS: Record<string, string> = {
  low:      'bg-slate-100 text-slate-700',
  medium:   'bg-yellow-100 text-yellow-700',
  high:     'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

export default function BobProposalLog() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter]     = useState<string>('all')
  const [impactFilter, setImpactFilter] = useState<string>('all')
  const [dateFrom, setDateFrom]         = useState('')
  const [titleQuery, setTitleQuery]     = useState('')
  const [expanded, setExpanded]         = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ProposalRow[]>({
    queryKey: ['bob-proposals-log', statusFilter, typeFilter, impactFilter, dateFrom, titleQuery],
    queryFn: async () => {
      let q = supabase
        .from('bob_action_proposals')
        .select('*')
        .order('proposed_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all')   q = q.eq('proposal_type', typeFilter)
      if (impactFilter !== 'all') q = q.eq('impact_level', impactFilter)
      if (dateFrom)               q = q.gte('proposed_at', dateFrom)
      if (titleQuery.trim())      q = q.ilike('title', `%${titleQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const pending  = rows.filter(r => r.status === 'pending').length
  const approved = rows.filter(r => r.status === 'approved').length
  const rejected = rows.filter(r => r.status === 'rejected').length
  const failed   = rows.filter(r => r.status === 'failed').length

  const statuses  = ['all', ...Array.from(new Set(rows.map(r => r.status)))]
  const types     = ['all', ...Array.from(new Set(rows.map(r => r.proposal_type)))]
  const impacts   = ['all', 'low', 'medium', 'high', 'critical']

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrainCircuit className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Bob Proposal Log</h1>
              <p className="text-sm text-muted-foreground">Audit trail of all Bob-generated action proposals with approval and execution outcomes</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Proposals', value: rows.length,  colour: 'text-gray-700' },
            { label: 'Pending',         value: pending,       colour: 'text-amber-700' },
            { label: 'Approved',        value: approved,      colour: 'text-green-700' },
            { label: 'Rejected / Failed', value: rejected + failed, colour: 'text-rose-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={titleQuery}
            onChange={e => setTitleQuery(e.target.value)}
            placeholder="Search title…"
            className="w-52"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>{statuses.map(s => <SelectItem key={s} value={s}>{s === 'all' ? 'All statuses' : s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>{types.map(t => <SelectItem key={t} value={t}>{t === 'all' ? 'All types' : t}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={impactFilter} onValueChange={setImpactFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Impact" /></SelectTrigger>
            <SelectContent>{impacts.map(i => <SelectItem key={i} value={i}>{i === 'all' ? 'All impact' : i}</SelectItem>)}</SelectContent>
          </Select>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border rounded px-3 py-1 text-sm w-40 bg-background"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No proposals found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proposed At</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead>Case</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.proposed_at)}</TableCell>
                      <TableCell className="max-w-[18rem] truncate font-medium text-sm" title={row.title}>{row.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{row.proposal_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLOURS[row.status] ?? ''}`}>{row.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${IMPACT_COLOURS[row.impact_level] ?? ''}`}>{row.impact_level}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.case_id ? row.case_id.slice(0, 8) + '…' : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Requested by:</span> {row.requested_by ?? '—'}</div>
                            <div><span className="font-medium">Approver:</span> {row.approver_id ?? '—'}</div>
                            <div><span className="font-medium">Approved at:</span> {fmtDate(row.approved_at)}</div>
                            <div><span className="font-medium">Due:</span> {fmtDate(row.approval_due_at)}</div>
                            <div><span className="font-medium">Executed at:</span> {fmtDate(row.executed_at)}</div>
                            <div><span className="font-medium">Escalated at:</span> {fmtDate(row.escalated_at)}</div>
                            <div><span className="font-medium">Source table:</span> {row.source_record_table ?? '—'}</div>
                            <div><span className="font-medium">Source record:</span> {row.source_record_id ? row.source_record_id.slice(0, 8) + '…' : '—'}</div>
                          </div>
                          {row.approval_notes && (
                            <div><span className="font-medium">Approval notes:</span> {row.approval_notes}</div>
                          )}
                          {row.rejection_reason && (
                            <div><span className="font-medium">Rejection reason:</span> {row.rejection_reason}</div>
                          )}
                          {row.execution_error && (
                            <div className="text-rose-700"><span className="font-medium">Execution error:</span> {row.execution_error}</div>
                          )}
                          <div>
                            <span className="font-medium">Proposal payload:</span>
                            <pre className="mt-1 overflow-auto max-h-32 text-xs bg-muted rounded p-2">
                              {JSON.stringify(row.proposal_payload, null, 2)}
                            </pre>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
