/**
 * RecentObservationPhotoStatusLog — B-130
 *
 * Admin log for recent_observations_photo_status.
 *
 * Features:
 *  - KPIs: Total / Healthy / Missing Hash / Missing URL
 *  - Filters: status / plate / date-from
 *
 * Route: /recent-observations-photo-status-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Image, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

type PhotoStatusRow = Database['public']['Views']['recent_observations_photo_status']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function RecentObservationPhotoStatusLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter, setStatusFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')

  const { data: rows = [], isLoading, refetch } = useQuery<PhotoStatusRow[]>({
    queryKey: ['recent-observations-photo-status-log', orgId, statusFilter, plateQuery, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('recent_observations_photo_status')
        .select('*')
        .eq('organization_id', orgId!)
        .order('recorded_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('recorded_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const statuses = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const healthy = rows.filter(r => r.has_hash && r.has_url).length
  const missingHash = rows.filter(r => !r.has_hash).length
  const missingUrl = rows.filter(r => !r.has_url).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image className="h-6 w-6 text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold">Recent Observation Photo Status</h1>
              <p className="text-sm text-muted-foreground">Recent observation photo completeness by plate and timestamp</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Rows', value: rows.length, colour: 'text-gray-700' },
            { label: 'Healthy Photos', value: healthy, colour: 'text-green-700' },
            { label: 'Missing Hash', value: missingHash, colour: 'text-amber-700' },
            { label: 'Missing URL', value: missingUrl, colour: 'text-red-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={plateQuery} onChange={e => setPlateQuery(e.target.value)} placeholder="Search plate…" className="w-44" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded px-3 py-1 text-sm bg-background w-48">
            <option value="all">All statuses</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
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
                  <TableHead>Recorded At</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Has URL</TableHead>
                  <TableHead>Has Hash</TableHead>
                  <TableHead>Observation ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={row.observation_id ?? String(idx)}>
                    <TableCell className="text-sm">{fmtDate(row.recorded_at)}</TableCell>
                    <TableCell className="font-mono text-sm">{row.plate_number ?? '—'}</TableCell>
                    <TableCell className="text-sm">{row.status ?? '—'}</TableCell>
                    <TableCell>
                      <Badge className={row.has_url ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                        {row.has_url ? 'yes' : 'no'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={row.has_hash ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                        {row.has_hash ? 'yes' : 'no'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.observation_id ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
