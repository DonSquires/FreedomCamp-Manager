import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ShieldCheck, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type EnforcementActionRow = Database['public']['Tables']['enforcement_actions']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
  escalated: 'bg-orange-100 text-orange-800',
}

export default function EnforcementActionLog() {
  const { user } = useAuthStore()
  const [statusFilter, setStatusFilter] = useState('all')
  const [actionTypeFilter, setActionTypeFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<EnforcementActionRow[]>({
    queryKey: ['enforcement-actions-log', statusFilter, actionTypeFilter, plateQuery, dateFrom],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('enforcement_actions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (actionTypeFilter !== 'all') q = q.eq('action_type', actionTypeFilter)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const completedCount = rows.filter((r) => r.status === 'completed').length
  const pendingCount = rows.filter((r) => r.status === 'pending').length
  const actionTypes = ['all', ...Array.from(new Set(rows.map((r) => r.action_type).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Enforcement Action Log</h1>
              <p className="text-sm text-muted-foreground">Enforcement actions with assignment, outcome, and breach status tracking</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Actions', value: rows.length, color: 'text-gray-700' },
            { label: 'Completed', value: completedCount, color: 'text-green-700' },
            { label: 'Pending', value: pendingCount, color: 'text-yellow-700' },
            { label: 'Action Types', value: actionTypes.length - 1, color: 'text-blue-700' },
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
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="escalated">Escalated</SelectItem>
            </SelectContent>
          </Select>
          <Select value={actionTypeFilter} onValueChange={setActionTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Action type" /></SelectTrigger>
            <SelectContent>
              {actionTypes.map((t) => (
                <SelectItem key={t} value={t}>{t === 'all' ? 'All types' : t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={plateQuery}
            onChange={(e) => setPlateQuery(e.target.value)}
            placeholder="Search plate…"
            className="w-36"
          />
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
            <p>No enforcement actions found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Action Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Breach Status</TableHead>
                  <TableHead>Assigned To</TableHead>
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
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-sm font-mono font-semibold">{row.plate_number ?? '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.action_type ?? '—'}</Badge></TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLORS[row.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                          {row.status ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{row.breach_status ?? '—'}</TableCell>
                      <TableCell className="text-xs">{row.assigned_to ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">ID:</span> {row.id}</div>
                            <div><span className="font-medium">Observation ID:</span> {row.observation_id ?? '—'}</div>
                            <div><span className="font-medium">Vehicle Record:</span> {row.vehicle_record_id ?? '—'}</div>
                            <div><span className="font-medium">Compliance Result:</span> {row.compliance_result_id ?? '—'}</div>
                            <div><span className="font-medium">Zone:</span> {row.zone_id ?? '—'}</div>
                            <div><span className="font-medium">Created By:</span> {row.created_by ?? '—'}</div>
                            <div><span className="font-medium">Assigned By:</span> {row.assigned_by ?? '—'}</div>
                            <div><span className="font-medium">Assigned At:</span> {fmtDate(row.assigned_at)}</div>
                            <div><span className="font-medium">Completed By:</span> {row.completed_by ?? '—'}</div>
                            <div><span className="font-medium">Completed At:</span> {fmtDate(row.completed_at)}</div>
                            <div><span className="font-medium">Outcome:</span> {row.completion_outcome ?? '—'}</div>
                          </div>
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                          {row.completion_notes && <div><span className="font-medium">Completion Notes:</span> {row.completion_notes}</div>}
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
