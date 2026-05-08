/**
 * FixedCameraLog — B-175
 *
 * Admin viewer for fixed_cameras.
 * Displays fixed camera installations including type, status, location,
 * zone assignments, stream/snapshot URLs, and last-seen timestamps.
 *
 * Route: /fixed-cameras-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Camera, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type FixedCameraRow = Database['public']['Tables']['fixed_cameras']['Row']

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

function statusBadge(status: string | null) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const colour =
    status === 'online' ? 'bg-emerald-100 text-emerald-800' :
    status === 'offline' ? 'bg-red-100 text-red-700' :
    'bg-gray-100 text-gray-600'
  return <Badge className={colour}>{status}</Badge>
}

export default function FixedCameraLog() {
  const { user } = useAuthStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [cameraTypeFilter, setCameraTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<FixedCameraRow[]>({
    queryKey: ['fixed-cameras-log', user?.organization_id, searchQuery, statusFilter, cameraTypeFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('fixed_cameras')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (searchQuery.trim()) q = q.ilike('name', `%${searchQuery.trim()}%`)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (cameraTypeFilter !== 'all') q = q.eq('camera_type', cameraTypeFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const onlineCount = rows.filter(r => r.status === 'online').length
  const withZone = rows.filter(r => r.zone_id).length
  const withStream = rows.filter(r => r.stream_url).length

  const statuses = Array.from(new Set(rows.map(r => r.status).filter(Boolean)))
  const cameraTypes = Array.from(new Set(rows.map(r => r.camera_type).filter(Boolean)))

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Camera className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Fixed Camera Log</h1>
              <p className="text-sm text-muted-foreground">Fixed camera installations including type, status, location, zone assignments, and stream URLs</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: rows.length, colour: 'text-gray-700' },
            { label: 'Online', value: onlineCount, colour: 'text-emerald-700' },
            { label: 'With Zone', value: withZone, colour: 'text-sky-700' },
            { label: 'With Stream', value: withStream, colour: 'text-purple-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search camera name…" className="w-52" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={cameraTypeFilter} onValueChange={setCameraTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Camera type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {cameraTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
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
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Last Seen</TableHead>
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
                      <TableCell className="font-medium text-sm">{row.name}</TableCell>
                      <TableCell className="text-sm">{row.camera_type}</TableCell>
                      <TableCell>{statusBadge(row.status)}</TableCell>
                      <TableCell className="text-sm max-w-[180px] truncate">{row.address ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.zone_id ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.last_seen_at)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          <div>
                            <span className="font-medium">Lat:</span> {row.latitude ?? '—'} &nbsp;
                            <span className="font-medium">Lng:</span> {row.longitude ?? '—'}
                          </div>
                          {row.stream_url && <div><span className="font-medium">Stream URL:</span> <span className="break-all">{row.stream_url}</span></div>}
                          {row.snapshot_url && <div><span className="font-medium">Snapshot URL:</span> <span className="break-all">{row.snapshot_url}</span></div>}
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                          <div><span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
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
            {onlineCount} online &nbsp;·&nbsp; {rows.length} total cameras
          </p>
        )}
      </div>
    </AppLayout>
  )
}
