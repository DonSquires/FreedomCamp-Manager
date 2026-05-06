/**
 * DriftEventLog — B-76
 *
 * Admin log for drift_events — vehicle drift detections that need review.
 *
 * Features:
 *  - KPI cards: Total / Pending / Reviewed / Flagged
 *  - Filters: status, event_type, review_month, plate search
 *  - Table: plate, event_type, status, detected_at, review_month, zone
 *  - Expandable row: metadata JSON, remediation_notes, reviewed_by
 *  - Mark Reviewed inline action
 *
 * Route: /drift-events — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Navigation2, RefreshCw, AlertCircle, Loader2,
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

type DriftEvent = Database['public']['Tables']['drift_events']['Row']

// ─── Styling maps ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending:  { label: 'Pending',  className: 'bg-yellow-100 text-yellow-800' },
  reviewed: { label: 'Reviewed', className: 'bg-green-100 text-green-800' },
  flagged:  { label: 'Flagged',  className: 'bg-red-100 text-red-800' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtMonth(m: string | null) {
  if (!m) return '—'
  try { return format(parseISO(m + '-01'), 'MMM yyyy') } catch { return m }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DriftEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [plateSearch, setPlateSearch]     = useState('')
  const [statusFilter, setStatusFilter]   = useState('all')
  const [typeFilter, setTypeFilter]       = useState('all')
  const [monthFilter, setMonthFilter]     = useState('all')
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<DriftEvent[]>({
    queryKey: ['drift-events', orgId, statusFilter, typeFilter, monthFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('drift_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('detected_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all')   q = q.eq('event_type', typeFilter)
      if (monthFilter !== 'all')  q = q.eq('review_month', monthFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // ── Distinct options ───────────────────────────────────────────────────────

  const eventTypes = [...new Set(rows.map(r => r.event_type).filter(Boolean))].sort()
  const months     = [...new Set(rows.map(r => r.review_month).filter(Boolean))].sort().reverse()

  // ── Filtered display ──────────────────────────────────────────────────────

  const displayed = plateSearch
    ? rows.filter(r => r.plate_number?.toLowerCase().includes(plateSearch.toLowerCase()))
    : rows

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total    = rows.length
  const pending  = rows.filter(r => r.status === 'pending').length
  const reviewed = rows.filter(r => r.status === 'reviewed').length
  const flagged  = rows.filter(r => r.status === 'flagged').length

  // ── Mutation: mark reviewed ────────────────────────────────────────────────

  const markReviewed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('drift_events')
        .update({ status: 'reviewed', reviewed_at: new Date().toISOString(), reviewed_by: user?.id })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Drift event marked as reviewed')
      qc.invalidateQueries({ queryKey: ['drift-events'] })
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
            <Navigation2 className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Drift Event Log</h1>
              <p className="text-sm text-muted-foreground">Vehicle drift detection review queue</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total',    value: total,    colour: 'text-gray-700' },
            { label: 'Pending',  value: pending,  colour: 'text-yellow-700' },
            { label: 'Reviewed', value: reviewed, colour: 'text-green-700' },
            { label: 'Flagged',  value: flagged,  colour: 'text-red-700' },
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
          <Input
            placeholder="Search plate…"
            value={plateSearch}
            onChange={e => setPlateSearch(e.target.value)}
            className="w-44"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {eventTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {months.map(m => <SelectItem key={m!} value={m!}>{fmtMonth(m)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No drift events found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Plate</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map(row => {
                  const expanded = expandedId === row.id
                  const statusStyle = STATUS_STYLES[row.status ?? ''] ?? { label: row.status ?? '—', className: 'bg-gray-100 text-gray-600' }
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-mono font-semibold">{row.plate_number ?? '—'}</TableCell>
                        <TableCell>{row.event_type}</TableCell>
                        <TableCell>
                          <Badge className={statusStyle.className}>{statusStyle.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.detected_at)}</TableCell>
                        <TableCell className="text-sm">{fmtMonth(row.review_month)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.zone_id ?? '—'}</TableCell>
                        <TableCell className="text-right">
                          {row.status !== 'reviewed' && (
                            <Button
                              size="sm" variant="outline"
                              disabled={markReviewed.isPending}
                              onClick={e => { e.stopPropagation(); markReviewed.mutate(row.id) }}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Mark Reviewed
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-expand`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">Remediation Notes</p>
                                <p className="text-muted-foreground">{row.remediation_notes ?? 'None'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Reviewed By / At</p>
                                <p className="text-muted-foreground">
                                  {row.reviewed_by ?? '—'} {row.reviewed_at ? `· ${fmtDate(row.reviewed_at)}` : ''}
                                </p>
                              </div>
                              {row.metadata && (
                                <div className="md:col-span-2">
                                  <p className="font-medium mb-1">Metadata</p>
                                  <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-40">
                                    {JSON.stringify(row.metadata, null, 2)}
                                  </pre>
                                </div>
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
