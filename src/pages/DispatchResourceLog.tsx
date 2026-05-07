/**
 * DispatchResourceLog — B-137
 *
 * Admin log and viewer for dispatch_resources.
 * Shows all registered dispatch resources (vehicles, officers, units)
 * with their scheduling config and active status.
 *
 * Route: /dispatch-resources-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Truck, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type ResourceRow = Database['public']['Tables']['dispatch_resources']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function DispatchResourceLog() {
  const [kindFilter, setKindFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ResourceRow[]>({
    queryKey: ['dispatch-resources-log', kindFilter, activeFilter, searchQuery],
    queryFn: async () => {
      let q = supabase
        .from('dispatch_resources')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (kindFilter !== 'all') q = q.eq('resource_kind', kindFilter)
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (searchQuery.trim()) q = q.or(`callsign.ilike.%${searchQuery.trim()}%,name.ilike.%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const kinds = [...new Set(rows.map(r => r.resource_kind).filter(Boolean))].sort()
  const activeCount = rows.filter(r => r.is_active).length
  const autoDispatch = rows.filter(r => r.auto_dispatch_enabled).length
  const schedulingEnabled = rows.filter(r => r.scheduling_enabled).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Truck className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Dispatch Resources</h1>
              <p className="text-sm text-muted-foreground">All registered dispatch resources with scheduling and auto-dispatch configuration</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Resources', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-green-700' },
            { label: 'Auto-Dispatch', value: autoDispatch, colour: 'text-blue-700' },
            { label: 'Scheduling On', value: schedulingEnabled, colour: 'text-amber-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search callsign / name…" className="w-52" />
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Resource kind" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {kinds.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
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
                  <TableHead>Callsign</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Auto-Dispatch</TableHead>
                  <TableHead>Scheduling</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Config</TableHead>
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
                      <TableCell className="font-mono font-semibold">{row.callsign}</TableCell>
                      <TableCell className="text-sm">{row.name}</TableCell>
                      <TableCell>
                        <Badge className="bg-emerald-100 text-emerald-800">{row.resource_kind}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                          {row.is_active ? 'active' : 'inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={row.auto_dispatch_enabled ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}>
                          {row.auto_dispatch_enabled ? 'on' : 'off'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={row.scheduling_enabled ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}>
                          {row.scheduling_enabled ? 'on' : 'off'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          {row.description && <div><span className="font-medium">Description:</span> {row.description}</div>}
                          <div><span className="font-medium">Default shift:</span> {row.default_shift ?? '—'} &nbsp; <span className="font-medium">Hours:</span> {row.default_start_time ?? '?'} – {row.default_end_time ?? '?'}</div>
                          <div><span className="font-medium">Active days:</span> {row.active_days?.join(', ') ?? '—'}</div>
                          {row.sms_number && <div><span className="font-medium">SMS:</span> {row.sms_number}</div>}
                          {row.email_address && <div><span className="font-medium">Email:</span> {row.email_address}</div>}
                          <div><span className="font-medium">Base LOI:</span> {row.base_loi_id ?? '—'} &nbsp; <span className="font-medium">Patrol route:</span> {row.patrol_route_id ?? '—'}</div>
                          <div><span className="font-medium">App queue:</span> {row.app_queue_id ?? '—'}</div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
