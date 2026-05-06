/**
 * CredentialProcessingLog — B-89
 *
 * Log viewer for credential_processing_log — AI-processed credential documents.
 *
 * Features:
 *  - KPI cards: Total / Verified / Pending / Failed
 *  - Filters: status, document_type, date range
 *  - Table: user_id, document_type, status, confidence bar (green/amber/red), processed_at
 *  - Expandable row: license_number, issuing_authority, expiry_date, extracted_text snippet,
 *                    authorized_activities chips, ai_model, error_message
 *  - Mark Verified action (admin/master only)
 *
 * Route: /credential-processing-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  BadgeCheck, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, ShieldCheck,
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

type CredentialLog = Database['public']['Tables']['credential_processing_log']['Row']

// ─── Styling maps ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  verified:    { label: 'Verified',    className: 'bg-green-100 text-green-800' },
  pending:     { label: 'Pending',     className: 'bg-yellow-100 text-yellow-800' },
  processing:  { label: 'Processing',  className: 'bg-blue-100 text-blue-800' },
  failed:      { label: 'Failed',      className: 'bg-red-100 text-red-800' },
  unverified:  { label: 'Unverified',  className: 'bg-gray-100 text-gray-600' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function ConfidenceBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground text-xs">—</span>
  const pct = Math.round(score * 100)
  const colour = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="h-2 flex-1 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${colour} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium w-8 text-right">{pct}%</span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CredentialProcessingLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const canVerify = user?.role === 'admin' || user?.role === 'master'

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter]     = useState('all')
  const [dateFrom, setDateFrom]         = useState('')
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<CredentialLog[]>({
    queryKey: ['credential-processing-log', orgId, statusFilter, typeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('credential_processing_log')
        .select('*')
        .order('processed_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all')   q = q.eq('document_type', typeFilter)
      if (dateFrom)               q = q.gte('processed_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const docTypes = [...new Set(rows.map(r => r.document_type).filter(Boolean))].sort()

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total    = rows.length
  const verified = rows.filter(r => r.status === 'verified' || r.manually_verified).length
  const pending  = rows.filter(r => r.status === 'pending' || r.status === 'processing').length
  const failed   = rows.filter(r => r.status === 'failed').length

  // ── Mutation ──────────────────────────────────────────────────────────────

  const markVerified = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('credential_processing_log')
        .update({
          manually_verified: true,
          verified_at: new Date().toISOString(),
          verified_by: user?.id,
          status: 'verified',
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Credential marked as verified')
      qc.invalidateQueries({ queryKey: ['credential-processing-log'] })
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
            <BadgeCheck className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Credential Processing Log</h1>
              <p className="text-sm text-muted-foreground">AI-processed credential documents and verification</p>
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
            { label: 'Verified', value: verified, colour: 'text-green-700' },
            { label: 'Pending',  value: pending,  colour: 'text-yellow-700' },
            { label: 'Failed',   value: failed,   colour: 'text-red-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_STYLES).map(([v, s]) => <SelectItem key={v} value={v}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Document type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {docTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No credential records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>User</TableHead>
                  <TableHead>Document Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Processed At</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const statusStyle = STATUS_STYLES[row.status ?? ''] ?? { label: row.status ?? '—', className: 'bg-gray-100 text-gray-600' }
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.user_id ? `${row.user_id.slice(0, 8)}…` : '—'}</TableCell>
                        <TableCell className="font-medium">{row.document_type}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Badge className={statusStyle.className}>{statusStyle.label}</Badge>
                            {row.manually_verified && <Badge className="bg-blue-100 text-blue-800"><ShieldCheck className="h-3 w-3 mr-1" />Manual</Badge>}
                          </div>
                        </TableCell>
                        <TableCell><ConfidenceBar score={row.confidence_score} /></TableCell>
                        <TableCell className="text-sm">{fmtDate(row.processed_at)}</TableCell>
                        <TableCell className="text-right">
                          {canVerify && !row.manually_verified && row.status !== 'verified' && (
                            <Button
                              size="sm" variant="outline"
                              disabled={markVerified.isPending}
                              onClick={e => { e.stopPropagation(); markVerified.mutate(row.id) }}
                            >
                              <ShieldCheck className="h-4 w-4 mr-1" /> Verify
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">License Number</p>
                                <p className="text-muted-foreground">{row.license_number ?? '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Issuing Authority</p>
                                <p className="text-muted-foreground">{row.issuing_authority ?? '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Expiry Date</p>
                                <p className="text-muted-foreground">{fmtDate(row.expiry_date)}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">AI Model</p>
                                <p className="text-muted-foreground">{row.ai_model ?? '—'}</p>
                              </div>
                              {row.error_message && (
                                <div className="col-span-2">
                                  <p className="font-medium mb-1 text-red-700">Error</p>
                                  <p className="text-red-600 text-xs">{row.error_message}</p>
                                </div>
                              )}
                              {row.authorized_activities && row.authorized_activities.length > 0 && (
                                <div className="col-span-3">
                                  <p className="font-medium mb-1">Authorized Activities</p>
                                  <div className="flex flex-wrap gap-1">
                                    {row.authorized_activities.map((a, i) => (
                                      <Badge key={i} variant="outline" className="text-xs">{a}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {row.extracted_text && (
                                <div className="col-span-3">
                                  <p className="font-medium mb-1">Extracted Text</p>
                                  <p className="text-muted-foreground text-xs line-clamp-3">{row.extracted_text}</p>
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
