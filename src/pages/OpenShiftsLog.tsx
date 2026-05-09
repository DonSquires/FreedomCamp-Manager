import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CalendarPlus, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type OpenShiftRow = Database['public']['Tables']['open_shifts']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try {
    return format(parseISO(ts), 'dd MMM yyyy HH:mm')
  } catch {
    return ts
  }
}

export default function OpenShiftsLog() {
  const { user } = useAuthStore()
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [titleQuery, setTitleQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<OpenShiftRow[]>({
    queryKey: ['open-shifts-log', statusFilter, priorityFilter, titleQuery, user?.organization_id, user?.role],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('open_shifts')
        .select('*')
        .order('shift_date', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)
      if (titleQuery.trim()) q = q.ilike('title', `%${titleQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const openCount = rows.filter((row) => row.status === 'open').length
  const filledCount = rows.filter((row) => row.status === 'filled').length
  const urgentCount = rows.filter((row) => row.priority === 'urgent').length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarPlus className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Open Shifts Log</h1>
              <p className="text-sm text-muted-foreground">Coverage marketplace audit view for open_shifts</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Shifts', value: rows.length, color: 'text-gray-700' },
            { label: 'Open', value: openCount, color: 'text-blue-700' },
            { label: 'Filled', value: filledCount, color: 'text-green-700' },
            { label: 'Urgent', value: urgentCount, color: 'text-red-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="filled">Filled</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
          <Input value={titleQuery} onChange={(e) => setTitleQuery(e.target.value)} placeholder="Shift title…" className="w-48" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No open shifts found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shift Date</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.shift_date)}</TableCell>
                      <TableCell className="text-sm font-medium">{row.title ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.status ?? '—'}</TableCell>
                      <TableCell>{row.priority === 'urgent' ? <Badge className="bg-red-100 text-red-800 text-xs">Urgent</Badge> : <Badge variant="outline" className="text-xs capitalize">{row.priority ?? '—'}</Badge>}</TableCell>
                      <TableCell className="text-sm">{row.shift_type ?? '—'}</TableCell>
                      <TableCell className="text-xs font-mono">{row.zone_id ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Shift ID:</span> {row.id}</div>
                            <div><span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                            <div><span className="font-medium">Claimed By:</span> {row.claimed_by ?? '—'}</div>
                            <div><span className="font-medium">Claimed At:</span> {fmtDate(row.claimed_at)}</div>
                            <div><span className="font-medium">Start:</span> {fmtDate(row.start_time)}</div>
                            <div><span className="font-medium">End:</span> {fmtDate(row.end_time)}</div>
                          </div>
                          {row.description && <div><span className="font-medium">Description:</span> {row.description}</div>}
                          {row.requirements && <div><span className="font-medium">Requirements:</span> {row.requirements}</div>}
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
