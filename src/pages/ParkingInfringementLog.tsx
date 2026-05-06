/**
 * ParkingInfringementLog — B-101
 *
 * Log viewer for parking_infringements — issued parking infringement notices.
 *
 * Features:
 *  - KPI cards: Total / Outstanding (unpaid) / Paid / Total Revenue (NZD)
 *  - Filters: status (dynamic), date from, plate search
 *  - Table: infringement_number, plate_number, status badge, fine_amount_nzd,
 *           offence_description, location_address, issued_at, due_date
 *  - Expandable row: officer_name, vehicle details, payment info,
 *                    offence_code, dispute_notes, court_reference,
 *                    evidence photos, PDF link
 *
 * Route: /parking-infringements-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  TicketX, RefreshCw, AlertCircle, Loader2,
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

type ParkingInfringement = Database['public']['Tables']['parking_infringements']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function fmtNzd(amount: number | null) {
  if (amount == null) return '—'
  return `$${amount.toFixed(2)}`
}

function statusBadge(status: string) {
  if (status === 'paid')       return 'bg-green-100 text-green-800'
  if (status === 'issued' || status === 'outstanding') return 'bg-red-100 text-red-800'
  if (status === 'cancelled')  return 'bg-gray-100 text-gray-600'
  if (status === 'disputed')   return 'bg-yellow-100 text-yellow-800'
  if (status === 'waived')     return 'bg-purple-100 text-purple-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParkingInfringementLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom,     setDateFrom]     = useState('')
  const [plateSearch,  setPlateSearch]  = useState('')
  const [expandedId,   setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<ParkingInfringement[]>({
    queryKey: ['parking-infringements-log', orgId, statusFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('parking_infringements')
        .select('*')
        .eq('organization_id', orgId!)
        .order('issued_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom)               q = q.gte('issued_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const filtered     = plateSearch
    ? rows.filter(r => r.plate_number.toLowerCase().includes(plateSearch.toLowerCase()))
    : rows

  const paidRows      = filtered.filter(r => r.status === 'paid')
  const outstandingCount = filtered.filter(r => r.status !== 'paid' && r.status !== 'cancelled' && r.status !== 'waived').length
  const totalRevenue  = paidRows.reduce((sum, r) => sum + (r.fine_amount_nzd ?? 0), 0)
  const statusTypes   = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TicketX className="h-6 w-6 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Parking Infringement Log</h1>
              <p className="text-sm text-muted-foreground">Issued parking infringement notices and payment status</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total',        value: filtered.length,              colour: 'text-gray-700' },
            { label: 'Outstanding',  value: outstandingCount,              colour: 'text-red-700' },
            { label: 'Paid',         value: paidRows.length,              colour: 'text-green-700' },
            { label: 'Revenue (NZD)',value: `$${totalRevenue.toFixed(0)}`, colour: 'text-blue-700' },
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
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
          <Input
            placeholder="Search plate…"
            value={plateSearch}
            onChange={e => setPlateSearch(e.target.value)}
            className="w-40"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No parking infringements found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Number</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fine (NZD)</TableHead>
                  <TableHead>Offence</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
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
                        <TableCell className="font-mono text-xs">{row.infringement_number}</TableCell>
                        <TableCell className="font-mono text-sm font-semibold">{row.plate_number}</TableCell>
                        <TableCell><Badge className={statusBadge(row.status)}>{row.status}</Badge></TableCell>
                        <TableCell className="text-sm font-medium">{fmtNzd(row.fine_amount_nzd)}</TableCell>
                        <TableCell className="text-sm max-w-40 truncate">{row.offence_description}</TableCell>
                        <TableCell className="text-sm max-w-36 truncate">{row.location_address}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.issued_at)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.due_date)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={9} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              {row.officer_name  && <span>Officer: {row.officer_name}</span>}
                              {row.vehicle_make  && <span>Vehicle: {row.vehicle_colour} {row.vehicle_make} {row.vehicle_model}</span>}
                              {row.offence_code  && <span>Offence code: {row.offence_code}</span>}
                              {row.offence_time  && <span>Offence time: {row.offence_time}</span>}
                              {row.early_payment_amount != null && (
                                <span>Early payment: {fmtNzd(row.early_payment_amount)} within {row.early_payment_days} days</span>
                              )}
                              {row.payment_received_at && <span>Paid: {fmtDate(row.payment_received_at)}</span>}
                              {row.payment_method      && <span>Method: {row.payment_method}</span>}
                              {row.payment_reference   && <span>Ref: {row.payment_reference}</span>}
                              {row.court_reference     && <span>Court ref: {row.court_reference}</span>}
                            </div>
                            {row.dispute_notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Dispute Notes</p>
                                <p className="text-sm text-muted-foreground">{row.dispute_notes}</p>
                              </div>
                            )}
                            {row.cancelled_reason && (
                              <div>
                                <p className="font-medium text-sm mb-1">Cancellation Reason</p>
                                <p className="text-sm text-muted-foreground">{row.cancelled_reason}</p>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                              {row.pdf_url && (
                                <a href={row.pdf_url} target="_blank" rel="noopener noreferrer"
                                  className="text-blue-600 underline">
                                  📄 View PDF
                                </a>
                              )}
                              {row.evidence_photos && row.evidence_photos.length > 0 && (
                                <>
                                  {row.evidence_photos.map((url, i) => (
                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                      className="text-blue-600 underline">
                                      Photo {i + 1}
                                    </a>
                                  ))}
                                </>
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
