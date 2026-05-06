/**
 * CredentialProcessingLog — B-89
 *
 * Admin log for credential_processing_log.
 *
 * Features:
 *  - KPI cards: Total / Verified / Pending / Failed / Avg Confidence
 *  - Filters: status select, document_type select (dynamic), date range, license number search
 *  - Table: document_type, license_number, issuing_authority, status badge, confidence bar,
 *           manually_verified badge, processed_at
 *  - Expandable row: full extracted_text snippet, authorized_activities, ai_model,
 *                    error_message, expiry_date, user_id, verified_by
 *  - Mark Verified action (manually_verified → true, status → 'verified') for unverified rows
 *
 * Route: /credential-processing-log — admin / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ShieldCheck, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, XCircle, BadgeCheck,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
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

type CredentialLog = Database['public']['Tables']['credential_processing_log']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string | null) {
  switch (status) {
    case 'verified':    return <Badge variant="secondary" className="text-xs text-green-700"><CheckCircle2 className="h-3 w-3 mr-1 inline" />Verified</Badge>
    case 'pending':     return <Badge variant="outline" className="text-xs text-amber-700">Pending</Badge>
    case 'processing':  return <Badge variant="outline" className="text-xs text-blue-700">Processing</Badge>
    case 'failed':      return <Badge variant="destructive" className="text-xs">Failed</Badge>
    case 'rejected':    return <Badge variant="destructive" className="text-xs">Rejected</Badge>
    default:            return <Badge variant="outline" className="text-xs text-muted-foreground">{status ?? '—'}</Badge>
  }
}

function confidenceBar(score: number | null) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>
  const pct = Math.round(score * 100)
  const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-500'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CredentialProcessingLog() {
  const qc = useQueryClient()

  const [licenseSearch, setLicense] = useState('')
  const [statusFilter, setStatus]   = useState('all')
  const [typeFilter, setType]       = useState('all')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Main query — no org_id column on this table ────────────────────────────

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['credential-processing-log', statusFilter, typeFilter, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from('credential_processing_log')
        .select('*')
        .order('processed_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all')   q = q.eq('document_type', typeFilter)
      if (dateFrom) q = q.gte('processed_at', dateFrom)
      if (dateTo)   q = q.lte('processed_at', `${dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as CredentialLog[]
    },
  })

  // ── Mark Verified mutation ─────────────────────────────────────────────────

  const markVerified = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('credential_processing_log')
        .update({ manually_verified: true, status: 'verified', verified_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credential-processing-log'] })
      toast.success('Credential marked as verified')
    },
    onError: (e: any) => toast.error(e.message || 'Update failed'),
  })

  // ── Dynamic type list ──────────────────────────────────────────────────────

  const docTypes = Array.from(new Set(logs.map(l => l.document_type))).sort()

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const verified = logs.filter(l => l.status === 'verified').length
  const failed   = logs.filter(l => l.status === 'failed' || l.status === 'rejected').length
  const pending  = logs.filter(l => l.status === 'pending' || l.status === 'processing').length
  const scores   = logs.map(l => l.confidence_score).filter((s): s is number => s != null)
  const avgConf  = scores.length ? (scores.reduce((s, v) => s + v, 0) / scores.length) : null

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = logs.filter(l => {
    if (licenseSearch) {
      if (!l.license_number?.toLowerCase().includes(licenseSearch.toLowerCase())) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Credential Processing Log" description="AI-processed officer credential verification records">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-5 w-5 text-purple-600" />
          <span className="font-semibold text-lg">Credential Processing Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',          value: logs.length, icon: <BadgeCheck className="h-4 w-4" />,     color: 'text-foreground',     fmt: (v: number) => String(v) },
          { label: 'Verified',       value: verified,    icon: <CheckCircle2 className="h-4 w-4" />,   color: 'text-green-600',      fmt: (v: number) => String(v) },
          { label: 'Pending/Proc',   value: pending,     icon: <AlertCircle className="h-4 w-4" />,    color: 'text-amber-600',      fmt: (v: number) => String(v) },
          { label: 'Avg Confidence', value: avgConf,     icon: <ShieldCheck className="h-4 w-4" />,    color: 'text-purple-600',     fmt: (v: number | null) => v != null ? `${Math.round(v * 100)}%` : '—' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{(k.fmt as any)(k.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search licence number…"
            value={licenseSearch}
            onChange={e => setLicense(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setType}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Document type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {docTypes.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && logs.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No credential processing records found.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Document Type</TableHead>
              <TableHead>Licence #</TableHead>
              <TableHead>Issuing Authority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Manual</TableHead>
              <TableHead>Processed</TableHead>
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
            {!isLoading && filtered.length === 0 && logs.length > 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No records match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(l => {
              const expanded = expandedId === l.id
              return [
                <TableRow
                  key={l.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : l.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{l.document_type}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {l.license_number ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.issuing_authority ?? '—'}</TableCell>
                  <TableCell>{statusBadge(l.status)}</TableCell>
                  <TableCell>{confidenceBar(l.confidence_score)}</TableCell>
                  <TableCell>
                    {l.manually_verified
                      ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                      : <XCircle className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(l.processed_at)}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    {!l.manually_verified && l.status !== 'verified' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-green-700 hover:text-green-800"
                        onClick={() => markVerified.mutate(l.id)}
                        disabled={markVerified.isPending}
                      >
                        {markVerified.isPending
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : 'Verify'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${l.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={8} className="py-3 space-y-2 text-sm">
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        {l.user_id && <span>User: <code className="bg-muted px-1 rounded">{l.user_id.slice(0, 8)}…</code></span>}
                        {l.ai_model && <span>AI Model: {l.ai_model}</span>}
                        {l.expiry_date && <span>Expires: {fmtDate(l.expiry_date)}</span>}
                        {l.verified_by && <span>Verified By: <code className="bg-muted px-1 rounded">{l.verified_by.slice(0, 8)}…</code></span>}
                        {l.verified_at && <span>Verified At: {fmtDate(l.verified_at)}</span>}
                      </div>
                      {l.authorized_activities && l.authorized_activities.length > 0 && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Authorised Activities</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {l.authorized_activities.map(act => (
                              <Badge key={act} variant="secondary" className="text-xs">{act}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {l.error_message && (
                        <div>
                          <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">Error</span>
                          <p className="mt-0.5 text-xs text-red-700">{l.error_message}</p>
                        </div>
                      )}
                      {l.extracted_text && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Extracted Text</span>
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-3">{l.extracted_text}</p>
                        </div>
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
          Showing {filtered.length} of {logs.length} records
        </p>
      )}
    </AppLayout>
  )
}
