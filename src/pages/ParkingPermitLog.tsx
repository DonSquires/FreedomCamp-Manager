import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ParkingSquare, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type ParkingPermitRow = Database['public']['Tables']['parking_permits']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function isExpired(validTo: string | null) {
  if (!validTo) return false
  return Number.isFinite(Date.parse(validTo)) && Date.parse(validTo) < Date.now()
}

export default function ParkingPermitLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ParkingPermitRow[]>({
    queryKey: ['parking-permit-log', user?.role, orgId, searchQuery, activeFilter, typeFilter, dateFrom],
    enabled: !!user,
    queryFn: async () => {
      let q = (supabase as any)
        .from('parking_permits')
        .select('*')
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (user?.role !== 'master') {
        if (!orgId) return []
        q = q.eq('organization_id', orgId)
      }

      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (typeFilter !== 'all') q = q.eq('permit_type', typeFilter)
      if (dateFrom) q = q.gte('valid_from', dateFrom)
      if (searchQuery.trim()) {
        const term = searchQuery.trim()
        q = q.or(`plate_number.ilike.%${term}%,holder_name.ilike.%${term}%,holder_email.ilike.%${term}%,issued_by.ilike.%${term}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter((row) => row.is_active).length
  const expiredCount = rows.filter((row) => isExpired(row.valid_to)).length
  const permitTypes = [...new Set(rows.map((row) => row.permit_type).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ParkingSquare className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Parking Permit Log</h1>
              <p className="text-sm text-muted-foreground">Permit registry with holder details, validity windows, and zone-linked metadata</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Permits', value: rows.length, colour: 'text-slate-700' },
            { label: 'Active', value: activeCount, colour: 'text-green-700' },
            { label: 'Expired', value: expiredCount, colour: 'text-rose-700' },
            { label: 'Permit Types', value: permitTypes.length, colour: 'text-orange-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search plate, holder, issuer…" className="w-64" />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Permit type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All permit types</SelectItem>
              {permitTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plate</TableHead>
                  <TableHead>Permit Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Holder</TableHead>
                  <TableHead>Valid From</TableHead>
                  <TableHead>Valid To</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-mono text-xs">{row.plate_number}</TableCell>
                      <TableCell className="text-sm">{row.permit_type}</TableCell>
                      <TableCell>
                        <Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'}>
                          {row.is_active ? 'active' : 'inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.holder_name ?? row.holder_email ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.valid_from)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.valid_to)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Holder:</span> {row.holder_name ?? '—'} · {row.holder_email ?? '—'} · {row.holder_phone ?? '—'}</div>
                          <div><span className="font-medium">Address:</span> {row.holder_address ?? '—'}</div>
                          <div><span className="font-medium">Issued by:</span> {row.issued_by ?? '—'} · <span className="font-medium">Zone:</span> {row.parking_zone_id ?? '—'} · <span className="font-medium">ParkPow vehicle:</span> {row.parkpow_vehicle_id ?? '—'}</div>
                          <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)} · <span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
