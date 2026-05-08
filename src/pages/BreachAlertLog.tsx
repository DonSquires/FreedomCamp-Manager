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
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLOURS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  acknowledged: 'bg-blue-100 text-blue-800',
  enforcement_started: 'bg-violet-100 text-violet-800',
  resolved: 'bg-green-100 text-green-800',
  dismissed: 'bg-gray-100 text-gray-700',
}

function statusBadge(status: string | null) {
  return STATUS_COLOURS[status?.toLowerCase() ?? ''] ?? 'bg-gray-100 text-gray-700'
}

export default function BreachAlertLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [breachTypeFilter, setBreachTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<BreachAlertRow[]>({
    queryKey: ['breach-alerts-log', orgId, searchQuery, statusFilter, breachTypeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('breach_alerts')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (breachTypeFilter !== 'all') q = q.eq('breach_type', breachTypeFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (searchQuery.trim()) {
        const term = searchQuery.trim()
        q = q.or(`plate_number.ilike.%${term}%,case_id.ilike.%${term}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const pendingCount = rows.filter(r => r.status === 'pending').length
  const acknowledgedCount = rows.filter(r => r.status === 'acknowledged').length
  const resolvedCount = rows.filter(r => r.status === 'resolved').length
  const breachTypes = [...new Set(rows.map(r => r.breach_type).filter(Boolean))].sort()
  const statuses = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Breach Alert Log</h1>
              <p className="text-sm text-muted-foreground">Compliance breach alerts with review and resolution lifecycle metadata</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Alerts', value: rows.length, colour: 'text-gray-700' },
            { label: 'Pending', value: pendingCount, colour: 'text-amber-700' },
            { label: 'Acknowledged', value: acknowledgedCount, colour: 'text-blue-700' },
            { label: 'Resolved', value: resolvedCount, colour: 'text-green-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search plate or case id…" className="w-56" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={breachTypeFilter} onValueChange={setBreachTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Breach type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All breach types</SelectItem>
              {breachTypes.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
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
                  <TableHead>Plate</TableHead>
                  <TableHead>Breach Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Case</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-mono text-xs">{row.plate_number ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.breach_type}</TableCell>
                      <TableCell><Badge className={statusBadge(row.status)}>{row.status ?? '—'}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{row.zone_id}</TableCell>
                      <TableCell className="font-mono text-xs">{row.case_id ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Alert ID:</span> {row.id}</div>
                          <div><span className="font-medium">Observation:</span> {row.observation_id ?? '—'} &nbsp; <span className="font-medium">Vehicle record:</span> {row.vehicle_record_id ?? '—'}</div>
                          <div><span className="font-medium">Patrol:</span> {row.patrol_id ?? '—'} &nbsp; <span className="font-medium">Assigned to:</span> {row.assigned_to ?? '—'}</div>
                          <div><span className="font-medium">Assigned by:</span> {row.assigned_by ?? '—'} at {fmtDate(row.assigned_at)}</div>
                          <div><span className="font-medium">Notified:</span> {row.notification_sent ? 'yes' : 'no'} &nbsp; <span className="font-medium">Method:</span> {row.notification_method ?? '—'} &nbsp; <span className="font-medium">At:</span> {fmtDate(row.notified_at)}</div>
                          <div><span className="font-medium">Due:</span> {fmtDate(row.due_date)} &nbsp; <span className="font-medium">Resolved:</span> {fmtDate(row.resolved_at)}</div>
                          <div><span className="font-medium">Admin reviewed:</span> {fmtDate(row.admin_reviewed_at)} by {row.admin_reviewed_by ?? '—'}</div>
                          {row.admin_review_notes && <div><span className="font-medium">Admin review notes:</span> {row.admin_review_notes}</div>}
                          {row.resolution_notes && <div><span className="font-medium">Resolution notes:</span> {row.resolution_notes}</div>}
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
