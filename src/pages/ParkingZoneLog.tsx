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

type ParkingZoneRow = Database['public']['Tables']['parking_zones']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try {
    return format(parseISO(ts), 'dd MMM yyyy HH:mm')
  } catch {
    return ts
  }
}

function listCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

export default function ParkingZoneLog() {
  const { user } = useAuthStore()
  const [activeFilter, setActiveFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ParkingZoneRow[]>({
    queryKey: ['parking-zones-log', activeFilter, typeFilter, searchQuery, user?.organization_id, user?.role],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('parking_zones')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (typeFilter !== 'all') q = q.eq('zone_type', typeFilter)
      if (searchQuery.trim()) q = q.or(`name.ilike.%${searchQuery.trim()}%,zone_id.ilike.%${searchQuery.trim()}%,address.ilike.%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter((row) => row.is_active).length
  const fineCount = rows.filter((row) => (row.fine_amount_nzd ?? 0) > 0).length
  const permitAwareCount = rows.filter((row) => listCount(row.permit_types_accepted) > 0).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ParkingSquare className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Parking Zone Log</h1>
              <p className="text-sm text-muted-foreground">Parking configuration audit view for parking_zones</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Zones', value: rows.length, color: 'text-gray-700' },
            { label: 'Active', value: activeCount, color: 'text-green-700' },
            { label: 'With Fine', value: fineCount, color: 'text-amber-700' },
            { label: 'Permit Aware', value: permitAwareCount, color: 'text-sky-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Zone type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="permit">Permit</SelectItem>
              <SelectItem value="timed">Timed</SelectItem>
              <SelectItem value="mixed">Mixed</SelectItem>
            </SelectContent>
          </Select>
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Zone, ID, or address…" className="w-56" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No parking zones found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Zone ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Fine</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-sm font-medium">{row.name ?? '—'}</TableCell>
                      <TableCell className="text-sm font-mono">{row.zone_id ?? '—'}</TableCell>
                      <TableCell>{row.is_active ? <Badge className="bg-green-100 text-green-800 text-xs">Active</Badge> : <Badge variant="outline" className="text-xs">Inactive</Badge>}</TableCell>
                      <TableCell className="text-sm">{row.zone_type ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.fine_amount_nzd != null ? `$${row.fine_amount_nzd}` : '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Parking Zone ID:</span> {row.id}</div>
                            <div><span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                            <div><span className="font-medium">ParkPow Lot:</span> {row.parkpow_lot_id ?? '—'}</div>
                            <div><span className="font-medium">Max Stay:</span> {row.max_stay_minutes ?? '—'} min</div>
                            <div><span className="font-medium">Grace Period:</span> {row.grace_period_minutes ?? '—'} min</div>
                            <div><span className="font-medium">Updated At:</span> {fmtDate(row.updated_at)}</div>
                          </div>
                          <div><span className="font-medium">Address:</span> {row.address ?? '—'}</div>
                          <div><span className="font-medium">Enforcement Hours:</span> {row.enforcement_hours ? JSON.stringify(row.enforcement_hours) : '—'}</div>
                          <div><span className="font-medium">Permit Types:</span> {listCount(row.permit_types_accepted) ? JSON.stringify(row.permit_types_accepted) : '—'}</div>
                          <div><span className="font-medium">Camera IDs:</span> {listCount(row.camera_ids) ? JSON.stringify(row.camera_ids) : '—'}</div>
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
