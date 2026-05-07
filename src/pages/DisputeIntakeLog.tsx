/**
 * DisputeIntakeLog — B-111
 *
 * Log viewer for dispute_intake — public dispute submissions against infringements
 * or parking decisions.
 *
 * Features:
 *  - KPI cards: Total / Open / Homeless Review Requested / Unique Plates
 *  - Filters: status (dynamic), source_type (dynamic), date from, plate/claimant search
 *  - Table: claimant_name, plate_number, source_type badge, status badge,
 *           submitted_via, submitted_at
 *  - Expandable row: message, evidence_statement, hardship_context,
 *                    claimant_email, claimant_phone, admin_notes,
 *                    assigned_to, source_reference, zone_id
 *
 * Route: /dispute-intake-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Scale, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type DisputeIntake = Database['public']['Tables']['dispute_intake']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string) {
  if (status === 'open' || status === 'pending')   return 'bg-yellow-100 text-yellow-800'
  if (status === 'under_review' || status === 'in_review') return 'bg-blue-100 text-blue-800'
  if (status === 'resolved' || status === 'closed') return 'bg-green-100 text-green-800'
  if (status === 'rejected')                        return 'bg-red-100 text-red-800'
  return 'bg-gray-100 text-gray-700'
}

function sourceTypeBadge(type: string) {
  if (type === 'portal')   return 'bg-purple-100 text-purple-800'
  if (type === 'email')    return 'bg-blue-100 text-blue-800'
  if (type === 'phone')    return 'bg-green-100 text-green-800'
  if (type === 'in_person')return 'bg-orange-100 text-orange-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DisputeIntakeLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter,   setStatusFilter]   = useState('all')
  const [sourceFilter,   setSourceFilter]   = useState('all')
  const [dateFrom,       setDateFrom]       = useState('')
  const [searchTerm,     setSearchTerm]     = useState('')
  const [expandedId,     setExpandedId]     = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<DisputeIntake[]>({
    queryKey: ['dispute-intake-log', orgId, statusFilter, sourceFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('dispute_intake')
        .select('*')
        .eq('organization_id', orgId!)
        .order('submitted_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (sourceFilter !== 'all') q = q.eq('source_type', sourceFilter)
      if (dateFrom)               q = q.gte('submitted_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const filtered = searchTerm
    ? rows.filter(r =>
        (r.plate_number  ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.claimant_name ?? '').toLowerCase().includes(searchTerm.toLowerCase())
      )
    : rows

  const openCount     = filtered.filter(r => r.status === 'open' || r.status === 'pending').length
  const homelessCount = filtered.filter(r => r.request_homeless_review).length
  const uniquePlates  = new Set(filtered.map(r => r.plate_number).filter(Boolean)).size
  const statuses      = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const sourceTypes   = [...new Set(rows.map(r => r.source_type).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Dispute Intake Log</h1>
              <p className="text-sm text-muted-foreground">Public dispute submissions against infringements and parking decisions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Disputes',       value: filtered.length, colour: 'text-gray-700' },
            { label: 'Open / Pending',        value: openCount,       colour: 'text-yellow-700' },
            { label: 'Homeless Review Req.',  value: homelessCount,   colour: 'text-orange-700' },
            { label: 'Unique Plates',         value: uniquePlates,    colour: 'text-blue-700' },
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
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Source type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sourceTypes.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
          <Input
            placeholder="Search plate or claimant…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-52"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No dispute intake records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Claimant</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Via</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(row => {
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
                        <TableCell className="text-sm">{row.claimant_name ?? '—'}</TableCell>
                        <TableCell className="font-mono text-sm">{row.plate_number ?? '—'}</TableCell>
                        <TableCell><Badge className={sourceTypeBadge(row.source_type)}>{row.source_type}</Badge></TableCell>
                        <TableCell><Badge className={statusBadge(row.status)}>{row.status}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.submitted_via}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.submitted_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              {row.claimant_email    && <span>Email: {row.claimant_email}</span>}
                              {row.claimant_phone    && <span>Phone: {row.claimant_phone}</span>}
                              {row.assigned_to       && <span>Assigned to: {row.assigned_to.slice(0, 8)}…</span>}
                              {row.source_reference  && <span>Reference: {row.source_reference}</span>}
                              {row.zone_id           && <span>Zone: {row.zone_id.slice(0, 8)}…</span>}
                              {row.request_homeless_review && <span className="text-orange-700 font-medium">🏠 Homeless review requested</span>}
                              {row.updated_at        && <span>Updated: {fmtDate(row.updated_at)}</span>}
                            </div>
                            {row.message && (
                              <div>
                                <p className="font-medium text-sm mb-1">Message</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.message}</p>
                              </div>
                            )}
                            {row.evidence_statement && (
                              <div>
                                <p className="font-medium text-sm mb-1">Evidence Statement</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.evidence_statement}</p>
                              </div>
                            )}
                            {row.hardship_context && (
                              <div>
                                <p className="font-medium text-sm mb-1">Hardship Context</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.hardship_context}</p>
                              </div>
                            )}
                            {row.admin_notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Admin Notes</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.admin_notes}</p>
                              </div>
                            )}
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
