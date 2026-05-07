/**
 * VehiclesOfInterestLog — B-103
 *
 * Log viewer for vehicles_of_interest — flagged vehicles tracked across zones.
 *
 * Features:
 *  - KPI cards: Total / Active / Expiring Soon (≤7 days) / Expired
 *  - Filters: status (dynamic), active toggle, date from, plate search
 *  - Table: plate_number, status badge, active badge, make/model, reason, created_at, expires_at
 *  - Expandable row: description, notes, linked_person_id, primary_zone_id,
 *                    zone_last_observed_at, photos
 *
 * Route: /vehicles-of-interest-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO, differenceInDays } from 'date-fns'
import {
  Car, RefreshCw, AlertCircle, Loader2,
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

type VehicleOfInterest = Database['public']['Tables']['vehicles_of_interest']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function statusBadge(status: string) {
  if (status === 'active')    return 'bg-red-100 text-red-800'
  if (status === 'expired')   return 'bg-gray-100 text-gray-600'
  if (status === 'revoked')   return 'bg-yellow-100 text-yellow-700'
  if (status === 'resolved')  return 'bg-green-100 text-green-700'
  return 'bg-gray-100 text-gray-700'
}

function activeBadge(active: boolean | null) {
  if (active === true)  return <Badge className="bg-green-100 text-green-800">Active</Badge>
  if (active === false) return <Badge className="bg-gray-100 text-gray-600">Inactive</Badge>
  return <span className="text-muted-foreground text-xs">—</span>
}

function isExpiringSoon(expires_at: string | null) {
  if (!expires_at) return false
  try {
    const days = differenceInDays(parseISO(expires_at), new Date())
    return days >= 0 && days <= 7
  } catch { return false }
}

function isExpired(expires_at: string | null) {
  if (!expires_at) return false
  try { return new Date() > parseISO(expires_at) } catch { return false }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VehiclesOfInterestLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter,  setStatusFilter]  = useState('all')
  const [activeFilter,  setActiveFilter]  = useState('all')
  const [dateFrom,      setDateFrom]      = useState('')
  const [plateSearch,   setPlateSearch]   = useState('')
  const [expandedId,    setExpandedId]    = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<VehicleOfInterest[]>({
    queryKey: ['vehicles-of-interest-log', orgId, statusFilter, activeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('vehicles_of_interest')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (activeFilter === 'yes') q = q.eq('active', true)
      if (activeFilter === 'no')  q = q.eq('active', false)
      if (dateFrom)               q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const filtered       = plateSearch
    ? rows.filter(r => r.plate_number?.toLowerCase().includes(plateSearch.toLowerCase()))
    : rows

  const activeCount    = filtered.filter(r => r.active === true).length
  const expiringSoon   = filtered.filter(r => isExpiringSoon(r.expires_at)).length
  const expiredCount   = filtered.filter(r => isExpired(r.expires_at)).length
  const statuses       = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Car className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Vehicles of Interest Log</h1>
              <p className="text-sm text-muted-foreground">Flagged vehicles tracked across zones</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records',   value: filtered.length, colour: 'text-gray-700' },
            { label: 'Active',          value: activeCount,      colour: 'text-red-700' },
            { label: 'Expiring ≤7 Days', value: expiringSoon,   colour: 'text-orange-700' },
            { label: 'Expired',         value: expiredCount,     colour: 'text-gray-500' },
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
              {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Active" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Active only</SelectItem>
              <SelectItem value="no">Inactive only</SelectItem>
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
            <AlertCircle className="h-8 w-8" /><p>No vehicles of interest found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Plate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Make / Model</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(row => {
                  const expanded  = expandedId === row.id
                  const expiring  = isExpiringSoon(row.expires_at)
                  const expired   = isExpired(row.expires_at)
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${expired ? 'opacity-60' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-mono font-semibold">{row.plate_number}</TableCell>
                        <TableCell>
                          <Badge className={statusBadge(row.status)}>{row.status}</Badge>
                        </TableCell>
                        <TableCell>{activeBadge(row.active)}</TableCell>
                        <TableCell className="text-sm">
                          {[row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || '—'}
                          {row.vehicle_year ? ` (${row.vehicle_year})` : ''}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                          {row.reason ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className={`text-sm ${expiring ? 'text-orange-700 font-medium' : ''}`}>
                          {row.expires_at ? (
                            <>
                              {fmtDate(row.expires_at)}
                              {expiring && !expired && <span className="ml-1 text-xs">(soon)</span>}
                              {expired  && <span className="ml-1 text-xs text-gray-500">(expired)</span>}
                            </>
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              {row.vehicle_color && <span>Colour: {row.vehicle_color}</span>}
                              {row.linked_person_id && <span>Linked person: {row.linked_person_id.slice(0, 8)}…</span>}
                              {row.primary_zone_id  && <span>Zone: {row.primary_zone_id.slice(0, 8)}…</span>}
                              {row.zone_last_observed_at && (
                                <span>Last observed: {fmtDate(row.zone_last_observed_at)}</span>
                              )}
                            </div>
                            {row.description && (
                              <div>
                                <p className="font-medium text-sm mb-1">Description</p>
                                <p className="text-sm text-muted-foreground">{row.description}</p>
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
