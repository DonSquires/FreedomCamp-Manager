/**
 * ParkingPaymentLog — B-86
 * Log of parking_payments — payment transactions for parking zones.
 * Route: /parking-payments-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  CreditCard, Search, RefreshCw, AlertCircle, Loader2,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ParkingPaymentRow = Database['public']['Tables']['parking_payments']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtNZD(amount: number | null | undefined) {
  if (amount == null) return '—'
  return `$${amount.toFixed(2)}`
}

const STATUS_COLOURS: Record<string, string> = {
  paid:     'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  pending:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  failed:   'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  refunded: 'bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-400',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ParkingPaymentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch]               = useState('')
  const [filterStatus, setFilterStatus]   = useState('all')
  const [filterProvider, setFilterProvider] = useState('all')
  const [filterMonth, setFilterMonth]     = useState('all')
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: payments = [], isLoading, error, refetch } = useQuery<ParkingPaymentRow[]>({
    queryKey: ['parking-payments', orgId],
    queryFn: async () => {
      let q = supabase
        .from('parking_payments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = payments.filter(e => {
    if (filterStatus   !== 'all' && e.status !== filterStatus) return false
    if (filterProvider !== 'all' && e.payment_provider !== filterProvider) return false
    if (filterMonth    !== 'all' && e.created_at?.substring(0, 7) !== filterMonth) return false
    if (search) {
      const s = search.toLowerCase()
      return e.plate_number?.toLowerCase().includes(s)
    }
    return true
  })

  const total        = payments.length
  const paid         = payments.filter(e => e.status === 'paid').length
  const failed       = payments.filter(e => e.status === 'failed').length
  const totalRevenue = payments
    .filter(e => e.status === 'paid')
    .reduce((sum, e) => sum + (e.amount_nzd ?? 0), 0)
  const revenueStr   = '$' + totalRevenue.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const providers = Array.from(new Set(payments.map(e => e.payment_provider).filter(Boolean)))
  const months    = Array.from(new Set(payments.map(e => e.created_at?.substring(0, 7)).filter(Boolean))).sort().reverse()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CreditCard className="h-7 w-7 text-green-600" />
            <div>
              <h1 className="text-2xl font-bold">Parking Payment Log</h1>
              <p className="text-sm text-muted-foreground">Payment transactions for parking zones</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total',         value: total,       colour: 'text-slate-600' },
            { label: 'Paid',          value: paid,        colour: 'text-green-600' },
            { label: 'Failed',        value: failed,      colour: failed > 0 ? 'text-red-600' : 'text-muted-foreground' },
            { label: 'Revenue (NZD)', value: revenueStr,  colour: 'text-emerald-600' },
          ].map(({ label, value, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <span className={`text-2xl font-bold ${colour}`}>{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Plate number…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {['paid', 'pending', 'failed', 'refunded'].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {providers.length > 0 && (
            <Select value={filterProvider} onValueChange={setFilterProvider}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Providers</SelectItem>
                {providers.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {months.length > 0 && (
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {months.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No parking payments match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Created</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Email</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => {
                    const isExpanded = expandedId === e.id
                    return (
                      <>
                        <TableRow
                          key={e.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setExpandedId(isExpanded ? null : e.id)}
                        >
                          <TableCell>
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.created_at)}</TableCell>
                          <TableCell className="font-mono font-semibold">{e.plate_number ?? '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.zone_id ?? '—'}</TableCell>
                          <TableCell className="text-sm font-semibold">{fmtNZD(e.amount_nzd)}</TableCell>
                          <TableCell className="text-sm">{e.payment_provider ?? '—'}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{e.provider_reference ?? '—'}</TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${STATUS_COLOURS[e.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                              {e.status ?? '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{e.contact_email ?? '—'}</TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${e.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={9} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">Session ID</p>
                                  <p className="font-mono text-xs">{e.session_id ?? '—'}</p>
                                  <p className="font-semibold text-muted-foreground mb-1 mt-2">Contact Phone</p>
                                  <p>{e.contact_phone ?? '—'}</p>
                                </div>
                                {e.metadata && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Metadata</p>
                                    <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-32">
                                      {JSON.stringify(e.metadata, null, 2)}
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
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
