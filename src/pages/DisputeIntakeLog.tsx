import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, Scale, ChevronDown, ChevronRight } from 'lucide-react'
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

type DisputeIntake = Database['public']['Tables']['dispute_intake']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string) {
  const s = status.toLowerCase()
  if (s.includes('approved') || s.includes('accepted')) return 'bg-green-100 text-green-800'
  if (s.includes('rejected') || s.includes('declined')) return 'bg-red-100 text-red-800'
  if (s.includes('review') || s.includes('pending') || s.includes('open')) return 'bg-yellow-100 text-yellow-800'
  return 'bg-slate-100 text-slate-800'
}

export default function DisputeIntakeLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [plateSearch, setPlateSearch] = useState('')
  const [claimantSearch, setClaimantSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<DisputeIntake[]>({
    queryKey: ['dispute-intake-log', orgId, statusFilter, dateFrom, plateSearch, claimantSearch],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('dispute_intake')
        .select('*')
        .eq('organization_id', orgId!)
        .order('submitted_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom) q = q.gte('submitted_at', dateFrom)
      if (plateSearch.trim()) q = q.ilike('plate_number', `%${plateSearch.trim()}%`)
      if (claimantSearch.trim()) q = q.ilike('claimant_name', `%${claimantSearch.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(), [rows])
  const homelessReviewCount = rows.filter((r) => r.request_homeless_review).length
  const withEvidenceCount = rows.filter((r) => !!r.evidence_statement).length
  const assignedCount = rows.filter((r) => !!r.assigned_to).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Dispute Intake Log</h1>
              <p className="text-sm text-muted-foreground">Public dispute submissions and review state</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Disputes', value: rows.length, color: 'text-slate-700' },
            { label: 'Homeless Review', value: homelessReviewCount, color: 'text-orange-700' },
            { label: 'With Evidence', value: withEvidenceCount, color: 'text-blue-700' },
            { label: 'Assigned', value: assignedCount, color: 'text-emerald-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-44" />
          <Input
            placeholder="Search plate…"
            value={plateSearch}
            onChange={(e) => setPlateSearch(e.target.value)}
            className="w-44"
          />
          <Input
            placeholder="Search claimant…"
            value={claimantSearch}
            onChange={(e) => setClaimantSearch(e.target.value)}
            className="w-56"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No disputes found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Claimant</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Homeless Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.submitted_at)}</TableCell>
                        <TableCell><Badge className={`text-xs ${statusBadge(row.status)}`}>{row.status}</Badge></TableCell>
                        <TableCell className="font-mono text-sm">{row.plate_number ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.claimant_name ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.source_type} / {row.submitted_via}</TableCell>
                        <TableCell>
                          {row.request_homeless_review ? (
                            <Badge className="bg-orange-100 text-orange-800 text-xs">Requested</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>ID: {row.id}</span>
                              <span>Assigned: {row.assigned_to ?? '—'}</span>
                              <span>Zone: {row.zone_id ?? '—'}</span>
                              <span>Source ref: {row.source_reference ?? '—'}</span>
                              <span>Updated: {fmtDate(row.updated_at)}</span>
                              <span>Email: {row.claimant_email ?? '—'}</span>
                            </div>
                            <div>
                              <p className="font-medium text-sm mb-1">Message</p>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.message}</p>
                            </div>
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
