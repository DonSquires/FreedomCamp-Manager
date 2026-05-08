import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ParkingSquare, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
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

type PermitRow = Database['public']['Tables']['parking_permits']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function ParkingPermitLog() {
  const [activeFilter, setActiveFilter] = useState('all')
  const [permitTypeFilter, setPermitTypeFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<PermitRow[]>({
    queryKey: ['parking-permits-log', activeFilter, permitTypeFilter, plateQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('parking_permits')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500)

      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (permitTypeFilter !== 'all') q = q.eq('permit_type', permitTypeFilter)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('updated_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter((r) => r.is_active).length
  const inactiveCount = rows.length - activeCount
  const expiringCount = rows.filter((r) => r.valid_to && new Date(r.valid_to) < new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)).length
  const permitTypes = ['all', ...Array.from(new Set(rows.map((r) => r.permit_type).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ParkingSquare className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Parking Permit Log</h1>
              <p className="text-sm text-muted-foreground">Permit lifecycle by plate, type, and validity window</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Permits', value: rows.length, color: 'text-gray-700' },
            { label: 'Active', value: activeCount, color: 'text-green-700' },
            { label: 'Inactive', value: inactiveCount, color: 'text-slate-700' },
            { label: 'Expiring ≤30d', value: expiringCount, color: 'text-amber-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={plateQuery}
            onChange={(e) => setPlateQuery(e.target.value)}
            placeholder="Search plate…"
            className="w-44"
          />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="State" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={permitTypeFilter} onValueChange={setPermitTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Permit type" /></SelectTrigger>
            <SelectContent>
              {permitTypes.map((type) => (
                <SelectItem key={type} value={type}>{type === 'all' ? 'All permit types' : type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded px-3 py-1 text-sm w-40 bg-background"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No parking permits found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Updated</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Permit Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Valid From</TableHead>
                  <TableHead>Valid To</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.updated_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.plate_number}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.permit_type}</Badge></TableCell>
                      <TableCell>
                        <Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'}>
                          {row.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.valid_from)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.valid_to)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Permit ID:</span> {row.id}</div>
                            <div><span className="font-medium">Organization:</span> {row.organization_id}</div>
                            <div><span className="font-medium">Zone:</span> {row.parking_zone_id ?? '—'}</div>
                            <div><span className="font-medium">Holder:</span> {row.holder_name ?? '—'}</div>
                            <div><span className="font-medium">Issued by:</span> {row.issued_by ?? '—'}</div>
                            <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)}</div>
                          </div>
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
