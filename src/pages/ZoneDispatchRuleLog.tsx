/**
 * ZoneDispatchRuleLog — B-147
 *
 * Admin log and viewer for zone_dispatch_resource_rules.
 * Displays zone-to-resource dispatch assignments, scheduling windows,
 * priority order, and active coverage by organization.
 *
 * Route: /zone-dispatch-rule-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { MapPinned, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type ZoneDispatchRuleRow = Database['public']['Tables']['zone_dispatch_resource_rules']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDay(day: number | null) {
  if (day == null) return 'All days'
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] ?? String(day)
}

export default function ZoneDispatchRuleLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ZoneDispatchRuleRow[]>({
    queryKey: ['zone-dispatch-rule-log', orgId, searchQuery, statusFilter, dayFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('zone_dispatch_resource_rules')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (searchQuery.trim()) q = q.or(`zone_id.ilike.%${searchQuery.trim()}%,dispatch_resource_id.ilike.%${searchQuery.trim()}%,job_type_code.ilike.%${searchQuery.trim()}%`)
      if (statusFilter === 'active') q = q.eq('is_active', true)
      if (statusFilter === 'inactive') q = q.eq('is_active', false)
      if (dayFilter !== 'all') q = q.eq('day_of_week', Number(dayFilter))

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter(row => row.is_active).length
  const uniqueZones = new Set(rows.map(row => row.zone_id)).size
  const uniqueResources = new Set(rows.map(row => row.dispatch_resource_id)).size
  const scheduledCount = rows.filter(row => row.day_of_week != null || row.time_from || row.time_to).length
  const days = [...new Set(rows.map(row => row.day_of_week).filter(day => day != null))].sort((a, b) => Number(a) - Number(b))

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPinned className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Dispatch Rule Log</h1>
              <p className="text-sm text-muted-foreground">Zone dispatch assignments with priority, scheduling windows, and resource coverage</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Rules', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-emerald-700' },
            { label: 'Zones Covered', value: uniqueZones, colour: 'text-amber-700' },
            { label: 'Scheduled Rules', value: scheduledCount, colour: 'text-sky-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search zone, resource, or job type…" className="w-72" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dayFilter} onValueChange={setDayFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Day" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All days</SelectItem>
              {days.map(day => <SelectItem key={day} value={String(day)}>{fmtDay(day as number)}</SelectItem>)}
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
                  <TableHead>Zone</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Job Type</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-mono text-xs">{row.zone_id.slice(0, 8)}…</TableCell>
                      <TableCell className="font-mono text-xs">{row.dispatch_resource_id.slice(0, 8)}…</TableCell>
                      <TableCell className="text-sm">{row.job_type_code ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDay(row.day_of_week)}</TableCell>
                      <TableCell className="text-sm">{row.time_from || row.time_to ? `${row.time_from ?? '00:00'} → ${row.time_to ?? '23:59'}` : 'Always'}</TableCell>
                      <TableCell className="text-sm text-right">{row.priority}</TableCell>
                      <TableCell>
                        <Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                          {row.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Rule ID:</span> {row.id}</div>
                          <div><span className="font-medium">Zone ID:</span> {row.zone_id}</div>
                          <div><span className="font-medium">Dispatch resource ID:</span> {row.dispatch_resource_id}</div>
                          <div><span className="font-medium">Organization:</span> {row.organization_id}</div>
                          <div><span className="font-medium">Created by:</span> {row.created_by ?? '—'}</div>
                          <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)}</div>
                          <div><span className="font-medium">Unique resources in result set:</span> {uniqueResources}</div>
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
