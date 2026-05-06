/**
 * ParkingPaymentLog — B-86
 *
 * Log viewer for parking_payments with revenue KPI and metadata expand.
 *
 * Features:
 *  - KPI cards: Total / Paid / Revenue (NZD)
 *  - Filters: status, payment_provider (dynamic), plate search, date range
 *  - Table: plate, zone, amount_nzd, provider, status, created_at
 *  - Expandable row: provider_reference, contact email/phone, metadata JSON
 *
 * Route: /parking-payments-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  CreditCard, RefreshCw, AlertCircle, Loader2,
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

type ParkingPayment = Database['public']['Tables']['parking_payments']['Row']

// ─── Styling maps ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  paid:     { label: 'Paid',     className: 'bg-green-100 text-green-800' },
  pending:  { label: 'Pending',  className: 'bg-yellow-100 text-yellow-800' },
  failed:   { label: 'Failed',   className: 'bg-red-100 text-red-800' },
  refunded: { label: 'Refunded', className: 'bg-gray-100 text-gray-600' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParkingPaymentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [plateSearch, setPlateSearch]       = useState('')
  const [statusFilter, setStatusFilter]     = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [dateFrom, setDateFrom]             = useState('')
  const [expandedId, setExpandedId]         = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<ParkingPayment[]>({
    queryKey: ['parking-payments-log', orgId, statusFilter, providerFilter, dateFrom],
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
      if (dateFrom)                 q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const providers = [...new Set(rows.map(r => r.payment_provider).filter(Boolean))].sort()

  const displayed = plateSearch
    ? rows.filter(r => r.plate_number.toLowerCase().includes(plateSearch.toLowerCase()))
    : rows

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total   = rows.length
  const paid    = rows.filter(r => r.status === 'paid').length
  const revenue = rows.filter(r => r.status === 'paid').reduce((sum, r) => sum + r.amount_nzd, 0)

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard className="h-6 w-6 text-green-600" />
            <div>
              <h1 className="text-2xl font-bold">Parking Payment Log</h1>
              <p className="text-sm text-muted-foreground">Parking payment transactions and revenue</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total',        value: total,                      colour: 'text-gray-700' },
            { label: 'Paid',         value: paid,                       colour: 'text-green-700' },
            { label: 'Revenue (NZD)',value: `$${revenue.toFixed(2)}`,   colour: 'text-emerald-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Input placeholder="Search plate…" value={plateSearch} onChange={e => setPlateSearch(e.target.value)} className="w-44" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_STYLES).map(([v, s]) => <SelectItem key={v} value={v}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No parking payments found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Plate</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Amount (NZD)</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
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
                        <TableCell className="font-mono font-semibold">{row.plate_number}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.zone_id ?? '—'}</TableCell>
                        <TableCell className="font-medium">${row.amount_nzd.toFixed(2)}</TableCell>
                        <TableCell className="text-sm">{row.payment_provider}</TableCell>
                        <TableCell><Badge className={statusStyle.className}>{statusStyle.label}</Badge></TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">Provider Reference</p>
                                <p className="text-muted-foreground font-mono text-xs">{row.provider_reference ?? '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Contact</p>
                                <p className="text-muted-foreground">{row.contact_email ?? '—'} {row.contact_phone ? `· ${row.contact_phone}` : ''}</p>
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
