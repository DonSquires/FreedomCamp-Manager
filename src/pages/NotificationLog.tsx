import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Bell, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type NotificationRow = Database['public']['Tables']['notifications']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const PRIORITY_COLOURS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  normal: 'bg-blue-100 text-blue-800',
  low: 'bg-slate-100 text-slate-700',
}

export default function NotificationLog() {
  const { user } = useAuthStore()
  const [typeFilter, setTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [deliveredFilter, setDeliveredFilter] = useState('all')
  const [titleQuery, setTitleQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<NotificationRow[]>({
    queryKey: ['notifications-log', typeFilter, priorityFilter, deliveredFilter, titleQuery, dateFrom],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (typeFilter !== 'all') q = q.eq('type', typeFilter)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)
      if (deliveredFilter === 'yes') q = q.eq('delivered', true)
      if (deliveredFilter === 'no') q = q.eq('delivered', false)
      if (titleQuery.trim()) q = q.ilike('title', `%${titleQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const deliveredCount = rows.filter((r) => r.delivered).length
  const undeliveredCount = rows.length - deliveredCount
  const unreadCount = rows.filter((r) => !r.read).length
  const notifTypes = ['all', ...Array.from(new Set(rows.map((r) => r.type).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Notification Log</h1>
              <p className="text-sm text-muted-foreground">In-app notification delivery records by type, priority, and read state</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Notifications', value: rows.length, color: 'text-gray-700' },
            { label: 'Delivered', value: deliveredCount, color: 'text-green-700' },
            { label: 'Undelivered', value: undeliveredCount, color: 'text-slate-700' },
            { label: 'Unread', value: unreadCount, color: 'text-sky-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            placeholder="Search title…"
            className="w-48"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              {notifTypes.map((t) => (
                <SelectItem key={t} value={t}>{t === 'all' ? 'All types' : t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={deliveredFilter} onValueChange={setDeliveredFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Delivered" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Delivered</SelectItem>
              <SelectItem value="no">Undelivered</SelectItem>
            </SelectContent>
          </Select>
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
            <p>No notifications found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Read</TableHead>
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
                      <TableCell className="text-sm font-medium max-w-[180px] truncate">{row.title}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.type}</Badge></TableCell>
                      <TableCell>
                        <Badge className={PRIORITY_COLOURS[row.priority] ?? 'bg-slate-100 text-slate-700'}>
                          {row.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.delivered ? (
                          <Badge className="bg-green-100 text-green-800">Yes</Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-700">No</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.read ? (
                          <span className="text-xs text-muted-foreground">Read</span>
                        ) : (
                          <Badge className="bg-sky-100 text-sky-800">Unread</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Notification ID:</span> {row.id}</div>
                            <div><span className="font-medium">User:</span> {row.user_id}</div>
                            <div><span className="font-medium">Delivered at:</span> {fmtDate(row.delivered_at)}</div>
                            <div><span className="font-medium">Read at:</span> {fmtDate(row.read_at)}</div>
                          </div>
                          {row.body && <div><span className="font-medium">Body:</span> {row.body}</div>}
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
