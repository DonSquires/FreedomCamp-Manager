/**
 * TrespassNoticeLog — B-100
 *
 * Log viewer for trespass_notices — formal trespass notices issued to persons/vehicles.
 *
 * Features:
 *  - KPI cards: Total / Active / Expired / Expiring Soon (≤7 days)
 *  - Filters: status (dynamic), notice_type (dynamic), date from
 *  - Table: reference_number, notice_type badge, status badge,
 *           trespass_reason, issued_at, expires_at (overdue highlight), witness_present
 *  - Expandable row: person_id, vehicle_id, zone_id, legal_basis,
 *                    served_method, notes, privacy_notice_given, photos
 *
 * Route: /trespass-notices-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO, differenceInDays } from 'date-fns'
import {
  Ban, RefreshCw, AlertCircle, Loader2,
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

type TrespassNotice = Database['public']['Tables']['trespass_notices']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function statusBadge(status: string) {
  if (status === 'active')   return 'bg-red-100 text-red-800'
  if (status === 'expired')  return 'bg-gray-100 text-gray-600'
  if (status === 'revoked')  return 'bg-yellow-100 text-yellow-700'
  if (status === 'draft')    return 'bg-blue-100 text-blue-700'
  return 'bg-gray-100 text-gray-700'
}

function isExpiringSoon(expires_at: string | null) {
  if (!expires_at) return false
  try {
    const days = differenceInDays(parseISO(expires_at), new Date())
    return days >= 0 && days <= 7
  } catch { return false }
}

function isOverdue(expires_at: string | null, status: string) {
  if (!expires_at || status !== 'active') return false
  try { return new Date() > parseISO(expires_at) } catch { return false }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TrespassNoticeLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter,      setStatusFilter]      = useState('all')
  const [noticeTypeFilter,  setNoticeTypeFilter]  = useState('all')
  const [dateFrom,          setDateFrom]          = useState('')
  const [expandedId,        setExpandedId]        = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<TrespassNotice[]>({
    queryKey: ['trespass-notices-log', orgId, statusFilter, noticeTypeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('trespass_notices')
        .select('*')
        .eq('organization_id', orgId!)
        .order('issued_at', { ascending: false })
        .limit(500)

      if (statusFilter     !== 'all') q = q.eq('status', statusFilter)
      if (noticeTypeFilter !== 'all') q = q.eq('notice_type', noticeTypeFilter)
      if (dateFrom)                   q = q.gte('issued_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const now            = new Date()
  const activeCount    = rows.filter(r => r.status === 'active').length
  const expiredCount   = rows.filter(r => r.status === 'expired').length
  const soonCount      = rows.filter(r => isExpiringSoon(r.expires_at)).length
  const statusTypes    = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const noticeTypes    = [...new Set(rows.map(r => r.notice_type).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Ban className="h-6 w-6 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Trespass Notice Log</h1>
              <p className="text-sm text-muted-foreground">Formal trespass notices issued to persons and vehicles</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Notices',   value: rows.length,  colour: 'text-gray-700' },
            { label: 'Active',          value: activeCount,  colour: 'text-red-700' },
            { label: 'Expired',         value: expiredCount, colour: 'text-gray-500' },
            { label: 'Expiring ≤7 days', value: soonCount,  colour: 'text-orange-700' },
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
              {statusTypes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={noticeTypeFilter} onValueChange={setNoticeTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Notice type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {noticeTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
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
            <AlertCircle className="h-8 w-8" /><p>No trespass notices found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Reference</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Witness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded   = expandedId === row.id
                  const overdue    = isOverdue(row.expires_at, row.status)
                  const expireSoon = isExpiringSoon(row.expires_at)
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${overdue ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.reference_number ?? row.id.slice(0, 8) + '…'}
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-purple-100 text-purple-800">{row.notice_type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusBadge(row.status)}>{row.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-48 truncate">{row.trespass_reason}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.issued_at)}</TableCell>
                        <TableCell className={`text-sm ${overdue ? 'text-red-600 font-medium' : expireSoon ? 'text-orange-600' : ''}`}>
                          {fmtDate(row.expires_at)}
                          {overdue && <span className="ml-1 text-xs">(overdue)</span>}
                          {!overdue && expireSoon && <span className="ml-1 text-xs">(soon)</span>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.witness_present
                            ? <Badge className="bg-green-100 text-green-800">Yes</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              {row.person_id  && <span>Person: {row.person_id.slice(0, 8)}…</span>}
                              {row.vehicle_id && <span>Vehicle: {row.vehicle_id.slice(0, 8)}…</span>}
                              {row.zone_id    && <span>Zone: {row.zone_id.slice(0, 8)}…</span>}
                              {row.issued_by  && <span>Issued by: {row.issued_by.slice(0, 8)}…</span>}
                              {row.served_method && <span>Served: {row.served_method}</span>}
                              {row.duration_days != null && <span>Duration: {row.duration_days} days</span>}
                              {row.witness_name  && <span>Witness: {row.witness_name}</span>}
                              {row.privacy_notice_given != null && (
                                <span>Privacy notice: {row.privacy_notice_given ? 'Yes' : 'No'}</span>
                              )}
                              {row.trespass_from && <span>Trespass from: {fmtDate(row.trespass_from)}</span>}
                            </div>
                            {row.legal_basis && (
                              <div>
                                <p className="font-medium text-sm mb-1">Legal Basis</p>
                                <p className="text-sm text-muted-foreground">{row.legal_basis}</p>
                              </div>
                            )}
                            {row.notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Notes</p>
                                <p className="text-sm text-muted-foreground">{row.notes}</p>
                              </div>
                            )}
                            {row.photos && row.photos.length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Photos ({row.photos.length})</p>
                                <div className="flex flex-wrap gap-2">
                                  {row.photos.map((url, i) => (
                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                      className="text-xs text-blue-600 underline">
                                      Photo {i + 1}
                                    </a>
                                  ))}
                                </div>
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
