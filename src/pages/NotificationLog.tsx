/**
 * NotificationLog — B-153
 *
 * Admin log and viewer for the notifications table.
 * Displays in-app notifications with delivery and read status, type, priority,
 * and recipient user ID. Supports title/body search, type/priority/delivery filters,
 * and an expandable data payload row.
 *
 * Route: /notifications-log — admin/master
 */
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

type NotifRow = Database['public']['Tables']['notifications']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const PRIORITY_COLOURS: Record<string, string> = {
  high:   'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low:    'bg-blue-100 text-blue-800',
}
function priorityBadge(v: string) {
  return PRIORITY_COLOURS[v?.toLowerCase()] ?? 'bg-gray-100 text-gray-700'
}

export default function NotificationLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery,    setSearchQuery]    = useState('')
  const [typeFilter,     setTypeFilter]     = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [deliveredFilter,setDeliveredFilter]= useState('all')
  const [dateFrom,       setDateFrom]       = useState('')
  const [expanded,       setExpanded]       = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<NotifRow[]>({
    queryKey: ['notifications-log', orgId, searchQuery, typeFilter, priorityFilter, deliveredFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('notifications')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (typeFilter !== 'all')     q = q.eq('type', typeFilter)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)
      if (deliveredFilter === 'yes') q = q.eq('delivered', true)
      if (deliveredFilter === 'no')  q = q.eq('delivered', false)
      if (dateFrom)                  q = q.gte('created_at', dateFrom)
      if (searchQuery.trim())        q = q.or(`title.ilike.%${searchQuery.trim()}%,body.ilike.%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const deliveredCount = rows.filter(r => r.delivered).length
  const readCount      = rows.filter(r => r.read).length
  const unreadCount    = rows.length - readCount
  const types          = [...new Set(rows.map(r => r.type).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Notification Log</h1>
              <p className="text-sm text-muted-foreground">In-app notifications with delivery and read status, priority, and recipient detail</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Notifications', value: rows.length,      colour: 'text-gray-700' },
            { label: 'Delivered',           value: deliveredCount,   colour: 'text-emerald-700' },
            { label: 'Read',                value: readCount,        colour: 'text-sky-700' },
            { label: 'Unread',              value: unreadCount,      colour: 'text-amber-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search title or body…" className="w-60" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {['high','medium','low'].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={deliveredFilter} onValueChange={setDeliveredFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Delivery" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Delivered</SelectItem>
              <SelectItem value="no">Not delivered</SelectItem>
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
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Read</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-medium text-sm max-w-[14rem] truncate">{row.title}</TableCell>
                      <TableCell className="text-sm">{row.type}</TableCell>
                      <TableCell><Badge className={priorityBadge(row.priority)}>{row.priority}</Badge></TableCell>
                      <TableCell>
                        <Badge className={row.delivered ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                          {row.delivered ? 'Yes' : 'No'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={row.read ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}>
                          {row.read ? 'Read' : 'Unread'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.user_id.slice(0, 8)}…</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Notification ID:</span> {row.id}</div>
                          <div><span className="font-medium">Recipient:</span> {row.user_id}</div>
                          <div><span className="font-medium">Body:</span> {row.body}</div>
                          {row.delivered_at && <div><span className="font-medium">Delivered at:</span> {fmtDate(row.delivered_at)}</div>}
                          {row.read_at      && <div><span className="font-medium">Read at:</span> {fmtDate(row.read_at)}</div>}
                          {row.data != null && (
                            <div>
                              <span className="font-medium">Data:</span>
                              <pre className="mt-1 whitespace-pre-wrap break-all bg-muted rounded p-2">{JSON.stringify(row.data, null, 2)}</pre>
                            </div>
                          )}
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
