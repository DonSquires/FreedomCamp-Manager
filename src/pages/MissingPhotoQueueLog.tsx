/**
 * MissingPhotoQueueLog — B-126
 *
 * Admin log for missing_photo_queue — records where observation photos
 * could not be retrieved or verified and are queued for repair.
 *
 * Features:
 *  - KPIs: Total / Pending / Failed / Resolved
 *  - Filters: status / plate search / date-from
 *  - Expandable row: attempted_hash + repair_notes + original_photo_url
 *
 * Route: /missing-photo-queue — admin / admin_officer / master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ImageOff, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
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

type MissingPhotoRow = Database['public']['Tables']['missing_photo_queue']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusTone(s: string | null) {
  switch (s) {
    case 'resolved': return 'bg-green-100 text-green-800'
    case 'failed': return 'bg-red-100 text-red-800'
    case 'in_progress': return 'bg-blue-100 text-blue-800'
    case 'pending': return 'bg-orange-100 text-orange-800'
    default: return 'bg-gray-100 text-gray-700'
  }
}

const STATUSES = ['pending', 'in_progress', 'failed', 'resolved']

export default function MissingPhotoQueueLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter, setStatusFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<MissingPhotoRow[]>({
    queryKey: ['missing-photo-queue-log', orgId, statusFilter, plateQuery, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('missing_photo_queue')
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

  const pendingCount = rows.filter(r => r.status === 'pending').length
  const failedCount = rows.filter(r => r.status === 'failed').length
  const resolvedCount = rows.filter(r => r.status === 'resolved').length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ImageOff className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Missing Photo Queue</h1>
              <p className="text-sm text-muted-foreground">Observations with unverified or missing photo evidence queued for repair</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Queued', value: rows.length, colour: 'text-gray-700' },
            { label: 'Pending', value: pendingCount, colour: 'text-orange-700' },
            { label: 'Failed', value: failedCount, colour: 'text-red-700' },
            { label: 'Resolved', value: resolvedCount, colour: 'text-green-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={plateQuery}
            onChange={e => setPlateQuery(e.target.value)}
            placeholder="Search plate…"
            className="w-44"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No missing photo records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Recorded At</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Last Attempt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const isFailed = row.status === 'failed'
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${isFailed ? 'bg-red-50/40' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.recorded_at)}</TableCell>
                        <TableCell className="font-mono text-sm font-medium">{row.plate_number ?? '—'}</TableCell>
                        <TableCell><Badge className={statusTone(row.status)}>{row.status ?? '—'}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{row.reason}</TableCell>
                        <TableCell className="text-sm font-mono text-muted-foreground">{row.attempts ?? 0}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(row.last_attempt_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Queue ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Observation:</span> <span className="font-mono text-xs">{row.observation_id}</span></div>
                                <div><span className="font-medium">Assigned To:</span> <span className="font-mono text-xs">{row.assigned_to ? `${row.assigned_to.slice(0, 8)}…` : '—'}</span></div>
                                <div><span className="font-medium">Created At:</span> <span className="text-muted-foreground">{fmtDate(row.created_at)}</span></div>
                              </div>
                              {row.attempted_hash && (
                                <div><span className="font-medium">Attempted Hash:</span> <span className="font-mono text-xs text-muted-foreground break-all">{row.attempted_hash}</span></div>
                              )}
                              {row.original_photo_url && (
                                <div>
                                  <span className="font-medium">Original URL: </span>
                                  <a href={row.original_photo_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline text-xs break-all">
                                    {row.original_photo_url}
                                  </a>
                                </div>
                              )}
                              {row.repair_notes && (
                                <div>
                                  <p className="font-medium mb-1">Repair Notes:</p>
                                  <p className="text-muted-foreground bg-muted rounded p-3">{row.repair_notes}</p>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
