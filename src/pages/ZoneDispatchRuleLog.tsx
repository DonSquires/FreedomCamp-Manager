/**
 * ZoneDispatchRuleLog — B-147
 *
 * Admin log for zone_dispatch_resource_rules.
 * Shows zone/resource routing rules, priority windows, and activation state.
 *
 * Route: /zone-dispatch-rules-log — admin/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Waypoints, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type DispatchRuleRow = Database['public']['Tables']['zone_dispatch_resource_rules']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function dayLabel(day: number | null) {
  if (day == null) return 'Any'
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] ?? String(day)
}

function timeWindow(from: string | null, to: string | null) {
  if (!from && !to) return 'Any'
  return `${from ?? '00:00'} → ${to ?? '23:59'}`
}

export default function ZoneDispatchRuleLog() {
  const [activeFilter, setActiveFilter] = useState('all')
  const [jobTypeFilter, setJobTypeFilter] = useState('all')
  const [orgQuery, setOrgQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')

  const { data: rows = [], isLoading, refetch } = useQuery<DispatchRuleRow[]>({
    queryKey: ['zone-dispatch-rules-log', activeFilter, jobTypeFilter, orgQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('zone_dispatch_resource_rules')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (jobTypeFilter !== 'all') q = q.eq('job_type_code', jobTypeFilter)
      if (orgQuery.trim()) q = q.ilike('organization_id', `%${orgQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter(r => r.is_active).length
  const uniqueZones = new Set(rows.map(r => r.zone_id)).size
  const uniqueResources = new Set(rows.map(r => r.dispatch_resource_id)).size
  const withSchedule = rows.filter(r => r.day_of_week != null || r.time_from || r.time_to).length
  const jobTypes = ['all', ...Array.from(new Set(rows.map(r => r.job_type_code).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Waypoints className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Dispatch Rule Log</h1>
              <p className="text-sm text-muted-foreground">Dispatch resource routing rules per zone and job type</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Rules', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-green-700' },
            { label: 'Unique Zones', value: uniqueZones, colour: 'text-blue-700' },
            { label: 'Scheduled Rules', value: withSchedule, colour: 'text-amber-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={orgQuery}
            onChange={(e) => setOrgQuery(e.target.value)}
            placeholder="Search org ID…"
            className="w-52"
          />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Job type" /></SelectTrigger>
            <SelectContent>
              {jobTypes.map((jt) => (
                <SelectItem key={jt} value={jt}>{jt === 'all' ? 'All job types' : jt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No dispatch rules found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Job Type</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.zone_id}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.dispatch_resource_id}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{row.job_type_code ?? 'Any'}</Badge></TableCell>
                    <TableCell className="text-sm">{dayLabel(row.day_of_week)}</TableCell>
                    <TableCell className="text-sm">{timeWindow(row.time_from, row.time_to)}</TableCell>
                    <TableCell className="text-sm font-medium">{row.priority}</TableCell>
                    <TableCell>
                      <Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'}>
                        {row.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            Showing {rows.length} rule{rows.length !== 1 ? 's' : ''} · {uniqueResources} unique resource{uniqueResources !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </AppLayout>
  )
}
