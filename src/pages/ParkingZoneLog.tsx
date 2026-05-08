/**
 * ParkingZoneLog — B-179
 *
 * Admin viewer for parking_zones.
 * Displays parking zone configuration including stay limits, grace periods,
 * fine amounts, camera assignments, and enforcement schedules.
 *
 * Route: /parking-zones-log — admin/admin_officer/master
 */
import { useState } from 'react'
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
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function boolBadge(val: boolean | null, trueLabel = 'Yes', falseLabel = 'No') {
  if (val == null) return <span className="text-muted-foreground">—</span>
  return (
    <Badge className={val ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-600'}>
      {val ? trueLabel : falseLabel}
    </Badge>
  )
}

export default function ParkingZoneLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ParkingZoneRow[]>({
    queryKey: ['parking-zones-log', orgId, search, activeFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('parking_zones')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (orgId) q = q.eq('organization_id', orgId)
      if (search.trim()) q = q.ilike('name', `%${search.trim()}%`)
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const active = rows.filter(r => r.is_active).length
  const withFine = rows.filter(r => r.fine_amount_nzd != null && r.fine_amount_nzd > 0).length
  const withCameras = rows.filter(r => r.camera_ids != null && (r.camera_ids as string[]).length > 0).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ParkingSquare className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Parking Zones</h1>
              <p className="text-sm text-muted-foreground">Parking zone configuration including stay limits, fines, cameras, and enforcement hours</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: active, colour: 'text-emerald-700' },
            { label: 'With Fine', value: withFine, colour: 'text-amber-700' },
            { label: 'With Cameras', value: withCameras, colour: 'text-sky-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search zone name…" className="w-52" />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Active status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All zones</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-44"
            title="Created from date"
          />
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
                  <TableHead>Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Max Stay (min)</TableHead>
                  <TableHead className="text-right">Grace Period</TableHead>
                  <TableHead className="text-right">Fine (NZD)</TableHead>
                  <TableHead>ParkPow ID</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="font-medium">{row.name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.address ?? '—'}</TableCell>
                      <TableCell>{boolBadge(row.is_active, 'Active', 'Inactive')}</TableCell>
                      <TableCell className="text-sm text-right">{row.max_stay_minutes ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right">{row.grace_period_minutes ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right">{row.fine_amount_nzd != null ? `$${row.fine_amount_nzd}` : '—'}</TableCell>
                      <TableCell className="text-sm font-mono">{row.parkpow_lot_id ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={9} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id} &nbsp; <span className="font-medium">Org:</span> {row.organization_id ?? '—'}</div>
                          {row.permit_types_accepted && (row.permit_types_accepted as string[]).length > 0 && (
                            <div><span className="font-medium">Permit Types:</span> {(row.permit_types_accepted as string[]).join(', ')}</div>
                          )}
                          <div><span className="font-medium">Cameras:</span> {row.camera_ids != null ? (row.camera_ids as string[]).length : 0} assigned</div>
                          {row.enforcement_hours != null && (
                            <div><span className="font-medium">Enforcement Hours:</span> {JSON.stringify(row.enforcement_hours)}</div>
                          )}
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {active} active &nbsp;·&nbsp; {rows.length} total parking zones
          </p>
        )}
      </div>
    </AppLayout>
  )
}
