import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type BreachAlertRow = Database['public']['Tables']['breach_alerts']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try {
    return format(parseISO(ts), 'dd MMM yyyy HH:mm')
  } catch {
    return ts
  }
}

export default function BreachAlertLog() {
  const { user } = useAuthStore()
  const [statusFilter, setStatusFilter] = useState('all')
  const [notificationFilter, setNotificationFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<BreachAlertRow[]>({
    queryKey: ['breach-alerts-log', statusFilter, notificationFilter, plateQuery, user?.organization_id, user?.role],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('breach_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (notificationFilter === 'sent') q = q.eq('notification_sent', true)
      if (notificationFilter === 'unsent') q = q.eq('notification_sent', false)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const openCount = rows.filter((r) => ['pending', 'acknowledged', 'enforcement_started'].includes((r.status ?? '').toLowerCase())).length
  const sentCount = rows.filter((r) => r.notification_sent).length
  const resolvedCount = rows.filter((r) => (r.status ?? '').toLowerCase() === 'resolved').length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Breach Alert Log</h1>
              <p className="text-sm text-muted-foreground">Operational breach alert audit view from breach_alerts</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Alerts', value: rows.length, color: 'text-gray-700' },
            { label: 'Open', value: openCount, color: 'text-amber-700' },
            { label: 'Resolved', value: resolvedCount, color: 'text-green-700' },
            { label: 'Notified', value: sentCount, color: 'text-sky-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="enforcement_started">Enforcement Started</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <Select value={notificationFilter} onValueChange={setNotificationFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Notified" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="unsent">Unsent</SelectItem>
            </SelectContent>
          </Select>
          <Input value={plateQuery} onChange={(e) => setPlateQuery(e.target.value)} placeholder="Plate…" className="w-44" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No breach alerts found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Notified</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-sm font-medium">{row.plate_number ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.status ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.breach_type ?? '—'}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.due_date)}</TableCell>
                      <TableCell>{row.notification_sent ? <Badge className="bg-green-100 text-green-800 text-xs">Sent</Badge> : <Badge variant="outline" className="text-xs">No</Badge>}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Alert ID:</span> {row.id}</div>
                            <div><span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                            <div><span className="font-medium">Zone ID:</span> {row.zone_id ?? '—'}</div>
                            <div><span className="font-medium">Assigned To:</span> {row.assigned_to ?? '—'}</div>
                            <div><span className="font-medium">Resolved At:</span> {fmtDate(row.resolved_at)}</div>
                            <div><span className="font-medium">Updated At:</span> {fmtDate(row.updated_at)}</div>
                          </div>
                          {row.breach_details && <div><span className="font-medium">Details:</span> {typeof row.breach_details === 'string' ? row.breach_details : JSON.stringify(row.breach_details)}</div>}
                          {row.resolution_notes && <div><span className="font-medium">Resolution:</span> {row.resolution_notes}</div>}
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
