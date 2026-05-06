/**
 * ParkingPaymentLog — B-86
 *
 * Admin log viewer for parking_payments.
 *
 * Features:
 *  - KPI cards: Total Payments / Successful / Failed/Pending / Total Revenue (NZD)
 *  - Filters: status select, payment_provider select, date-range, plate search
 *  - Table: plate_number, payment_provider, provider_reference, amount_nzd, status badge,
 *           contact_email, created_at
 *  - Expandable row: zone_id, session_id, contact_phone, metadata
 *
 * Route: /parking-payments-log — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  CreditCard, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, DollarSign,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

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

type ParkingPayment = Database['public']['Tables']['parking_payments']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string) {
  switch (status) {
    case 'succeeded':
    case 'paid':
    case 'complete':   return <Badge variant="secondary" className="text-xs text-green-700">Paid</Badge>
    case 'pending':    return <Badge variant="outline" className="text-xs text-amber-700">Pending</Badge>
    case 'failed':
    case 'cancelled':  return <Badge variant="destructive" className="text-xs">Failed</Badge>
    case 'refunded':   return <Badge variant="outline" className="text-xs text-blue-700">Refunded</Badge>
    default:           return <Badge variant="outline" className="text-xs">{status}</Badge>
  }
}

function isSuccessful(status: string) {
  return ['succeeded', 'paid', 'complete'].includes(status)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParkingPaymentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [plateSearch, setPlate]         = useState('')
  const [statusFilter, setStatus]       = useState('all')
  const [providerFilter, setProvider]   = useState('all')
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data: payments = [], isLoading, refetch } = useQuery({
    queryKey: ['parking-payments-log', orgId, statusFilter, providerFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('parking_payments')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all')   q = q.eq('status', statusFilter)
      if (providerFilter !== 'all') q = q.eq('payment_provider', providerFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo)   q = q.lte('created_at', `${dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as ParkingPayment[]
    },
  })

  // ── Dynamic lists ──────────────────────────────────────────────────────────

  const providers = Array.from(new Set(payments.map(p => p.payment_provider))).sort()

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const successful = payments.filter(p => isSuccessful(p.status))
  const revenue = successful.reduce((s, p) => s + p.amount_nzd, 0)

  const kpis = {
    total:      payments.length,
    successful: successful.length,
    other:      payments.length - successful.length,
    revenue,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = payments.filter(p => {
    if (plateSearch) {
      if (!p.plate_number.toLowerCase().includes(plateSearch.toLowerCase())) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Parking Payment Log" description="Review all parking payment transactions for this organisation">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-emerald-600" />
          <span className="font-semibold text-lg">Parking Payment Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Payments',  value: kpis.total,                           icon: <CreditCard className="h-4 w-4" />,    color: 'text-foreground',  fmt: (v: number) => String(v) },
          { label: 'Successful',      value: kpis.successful,                      icon: <CreditCard className="h-4 w-4" />,    color: 'text-green-600',   fmt: (v: number) => String(v) },
          { label: 'Pending/Failed',  value: kpis.other,                           icon: <AlertCircle className="h-4 w-4" />,   color: 'text-amber-600',   fmt: (v: number) => String(v) },
          { label: 'Revenue (NZD)',   value: kpis.revenue,                         icon: <DollarSign className="h-4 w-4" />,    color: 'text-emerald-600', fmt: (v: number) => `$${v.toFixed(2)}` },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.fmt(k.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search plate number…"
            value={plateSearch}
            onChange={e => setPlate(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="succeeded">Succeeded</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
          </SelectContent>
        </Select>
        <Select value={providerFilter} onValueChange={setProvider}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers.map(pr => (
              <SelectItem key={pr} value={pr}>{pr}</SelectItem>
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
      {!isLoading && payments.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No parking payment records found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Plate</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount (NZD)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Contact Email</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && payments.length > 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No payments match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(p => {
              const expanded = expandedId === p.id
              return [
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : p.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-mono font-semibold">{p.plate_number}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{p.payment_provider}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {p.provider_reference ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-emerald-700">
                    ${p.amount_nzd.toFixed(2)}
                  </TableCell>
                  <TableCell>{statusBadge(p.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.contact_email ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(p.created_at)}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${p.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={7} className="py-3 space-y-1 text-sm">
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        {p.zone_id && (
                          <span>Zone: <code className="bg-muted px-1 rounded">{p.zone_id.slice(0, 8)}…</code></span>
                        )}
                        {p.session_id && (
                          <span>Session: <code className="bg-muted px-1 rounded">{p.session_id.slice(0, 8)}…</code></span>
                        )}
                        {p.contact_phone && <span>Phone: {p.contact_phone}</span>}
                        <span>Updated: {fmtDate(p.updated_at)}</span>
                      </div>
                      {p.metadata && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Metadata</span>
                          <pre className="mt-0.5 text-xs bg-muted rounded p-2 overflow-x-auto">
                            {JSON.stringify(p.metadata, null, 2)}
                          </pre>
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
          Showing {filtered.length} of {payments.length} payments
        </p>
      )}
    </AppLayout>
  )
}
