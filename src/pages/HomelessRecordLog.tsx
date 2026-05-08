/**
 * HomelessRecordLog — B-149
 *
 * Admin log and viewer for homeless_records.
 * Displays vehicles and persons tracked with homeless-exempt status,
 * their source, active/inactive state, and first/last reported dates.
 *
 * Route: /homeless-records-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Home, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type HomelessRow = Database['public']['Tables']['homeless_records']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function HomelessRecordLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery,  setSearchQuery]  = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')
  const [expanded,     setExpanded]     = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<HomelessRow[]>({
    queryKey: ['homeless-records-log', orgId, searchQuery, statusFilter, sourceFilter, activeFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('homeless_records')
        .select('*')
        .eq('organization_id', orgId!)
        .order('last_reported_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (searchQuery.trim()) q = q.ilike('plate_number', `%${searchQuery.trim()}%`)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (sourceFilter !== 'all') q = q.eq('source', sourceFilter)
      if (activeFilter === 'active')   q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount   = rows.filter(r => r.is_active).length
  const statuses      = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const sources       = [...new Set(rows.map(r => r.source).filter(Boolean))].sort()
  const uniquePlates  = new Set(rows.map(r => r.plate_number)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Home className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Homeless Record Log</h1>
              <p className="text-sm text-muted-foreground">Vehicles and persons registered under homeless-exempt status with activity history</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records',    value: rows.length,    colour: 'text-gray-700' },
            { label: 'Active',           value: activeCount,    colour: 'text-emerald-700' },
            { label: 'Inactive',         value: rows.length - activeCount, colour: 'text-rose-700' },
            { label: 'Unique Plates',    value: uniquePlates,   colour: 'text-amber-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search plate number…" className="w-52" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Active" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
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
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>First Reported</TableHead>
                  <TableHead>Last Reported</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-mono font-semibold">{row.plate_number}</TableCell>
                      <TableCell><Badge className="bg-sky-100 text-sky-800">{row.status}</Badge></TableCell>
                      <TableCell className="text-sm">{row.source}</TableCell>
                      <TableCell>
                        <Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                          {row.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{fmtDate(row.first_reported_at)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.last_reported_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Record ID:</span> {row.id}</div>
                          <div><span className="font-medium">Created by:</span> {row.created_by ?? '—'} &nbsp; <span className="font-medium">at:</span> {fmtDate(row.created_at)}</div>
                          <div><span className="font-medium">Updated by:</span> {row.updated_by ?? '—'} &nbsp; <span className="font-medium">at:</span> {fmtDate(row.updated_at)}</div>
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
