/**
 * NoiseSeizureLog — B-114
 *
 * Log viewer for noise_seizures — equipment seized under RMA noise enforcement.
 *
 * Features:
 *  - KPI cards: Total / Active / Police Present / Total Estimated Value (NZD)
 *  - Filters: status (dynamic), equipment_type (dynamic), date from
 *  - Table: seizure_number, equipment_type, owner_name, status badge,
 *           police_present, seized_at
 *  - Expandable row: equipment_description/count/make/condition, address,
 *                    court_order_ref, rma_authority, seizing_officer, witness,
 *                    storage_location, return_date, photos links, notes
 *
 * Route: /noise-seizures-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  PackageX, RefreshCw, AlertCircle, Loader2,
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

type NoiseSeizure = Database['public']['Tables']['noise_seizures']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtCurrency(val: number | null) {
  if (val == null) return '—'
  return `$${val.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function statusBadge(status: string) {
  if (status === 'active' || status === 'seized')          return 'bg-red-100 text-red-800'
  if (status === 'pending_return' || status === 'pending') return 'bg-yellow-100 text-yellow-800'
  if (status === 'returned' || status === 'released')      return 'bg-green-100 text-green-800'
  if (status === 'disposed')                               return 'bg-gray-200 text-gray-700'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NoiseSeizureLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter,   setTypeFilter]   = useState('all')
  const [dateFrom,     setDateFrom]     = useState('')
  const [expandedId,   setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<NoiseSeizure[]>({
    queryKey: ['noise-seizures-log', orgId, statusFilter, typeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('noise_seizures')
        .select('*')
        .eq('organization_id', orgId!)
        .order('seized_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter   !== 'all') q = q.eq('equipment_type', typeFilter)
      if (dateFrom)               q = q.gte('seized_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount  = rows.filter(r => r.status === 'active' || r.status === 'seized').length
  const policeCount  = rows.filter(r => r.police_present).length
  const totalValue   = rows.reduce((sum, r) => sum + (r.estimated_value_nzd ?? 0), 0)
  const statuses     = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const equipTypes   = [...new Set(rows.map(r => r.equipment_type).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PackageX className="h-6 w-6 text-red-700" />
            <div>
              <h1 className="text-2xl font-bold">Noise Seizure Log</h1>
              <p className="text-sm text-muted-foreground">Equipment seized under RMA noise enforcement powers</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Seizures',     value: rows.length,          colour: 'text-gray-700' },
            { label: 'Active',             value: activeCount,          colour: 'text-red-700' },
            { label: 'Police Present',     value: policeCount,          colour: 'text-blue-700' },
            { label: 'Est. Total Value',   value: fmtCurrency(totalValue), colour: 'text-green-700' },
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
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Equipment type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {equipTypes.map(t => <SelectItem key={t} value={t!}>{t.replace(/_/g, ' ')}</SelectItem>)}
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
            <AlertCircle className="h-8 w-8" /><p>No noise seizures found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>#</TableHead>
                  <TableHead>Equipment Type</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Police</TableHead>
                  <TableHead>Seized</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
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
                        <TableCell className="font-mono text-xs">{row.seizure_number}</TableCell>
                        <TableCell className="text-sm">{row.equipment_type ? row.equipment_type.replace(/_/g, ' ') : '—'}</TableCell>
                        <TableCell className="text-sm">{row.owner_name ?? '—'}</TableCell>
                        <TableCell><Badge className={statusBadge(row.status)}>{row.status}</Badge></TableCell>
                        <TableCell className="text-center">
                          {row.police_present
                            ? <span className="text-blue-600 text-xs font-medium">Yes</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.seized_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Equipment: {row.equipment_description}</span>
                              <span>Count: {row.equipment_count}</span>
                              {row.equipment_make      && <span>Make: {row.equipment_make}</span>}
                              {row.equipment_condition && <span>Condition: {row.equipment_condition}</span>}
                              <span>Address: {row.address}</span>
                              {row.gps_lat != null && row.gps_lng != null && <span>GPS: {row.gps_lat.toFixed(5)}, {row.gps_lng.toFixed(5)}</span>}
                              {row.court_order_ref     && <span>Court Order: {row.court_order_ref}</span>}
                              {row.rma_authority       && <span>RMA Authority: {row.rma_authority}</span>}
                              {row.seizing_officer_name && <span>Officer: {row.seizing_officer_name}</span>}
                              {row.police_officer_name  && <span>Police: {row.police_officer_name}</span>}
                              {row.witness_name         && <span>Witness: {row.witness_name}</span>}
                              {row.storage_location     && <span>Storage: {row.storage_location}</span>}
                              {row.storage_reference    && <span>Storage ref: {row.storage_reference}</span>}
                              {row.return_date          && <span>Return date: {fmtDate(row.return_date)}</span>}
                              {row.returned_to          && <span>Returned to: {row.returned_to}</span>}
                              {row.estimated_value_nzd != null && <span>Est. value: {fmtCurrency(row.estimated_value_nzd)}</span>}
                              {row.disposal_method      && <span>Disposal: {row.disposal_method}</span>}
                              {row.updated_at           && <span>Updated: {fmtDate(row.updated_at)}</span>}
                            </div>
                            {row.notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Notes</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.notes}</p>
                              </div>
                            )}
                            {row.return_conditions && (
                              <div>
                                <p className="font-medium text-sm mb-1">Return Conditions</p>
                                <p className="text-sm text-muted-foreground">{row.return_conditions}</p>
                              </div>
                            )}
                            {row.photos && row.photos.length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Photos</p>
                                <div className="flex flex-wrap gap-2">
                                  {row.photos.map((url, i) => (
                                    <a
                                      key={i}
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm text-blue-600 hover:underline"
                                      onClick={e => e.stopPropagation()}
                                    >
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
