/**
 * UserDeactivationQueueLog — B-132
 *
 * Master-only admin log for user_deactivation_queue.
 *
 * Features:
 *  - KPIs: Total / Processed / Pending / Errors
 *  - Filters: processed / action / user / date-from
 *  - Expandable row: error message + timestamps
 *
 * Route: /user-deactivation-queue-log — master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  UserX2, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
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

type QueueRow = Database['public']['Tables']['user_deactivation_queue']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function UserDeactivationQueueLog() {
  const [processedFilter, setProcessedFilter] = useState('all')
  const [actionQuery, setActionQuery] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<QueueRow[]>({
    queryKey: ['user-deactivation-queue-log', processedFilter, actionQuery, userQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('user_deactivation_queue')
        .select('*')
        .order('requested_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (processedFilter === 'yes') q = q.eq('processed', true)
      if (processedFilter === 'no') q = q.eq('processed', false)
      if (actionQuery.trim()) q = q.ilike('action', `%${actionQuery.trim()}%`)
      if (userQuery.trim()) q = q.ilike('user_id', `%${userQuery.trim()}%`)
      if (dateFrom) q = q.gte('requested_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const processed = rows.filter(r => r.processed).length
  const pending = rows.filter(r => !r.processed).length
  const errors = rows.filter(r => !!r.error_message).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UserX2 className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">User Deactivation Queue Log</h1>
              <p className="text-sm text-muted-foreground">Queue lifecycle for user deactivation and reactivation actions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Entries', value: rows.length, colour: 'text-gray-700' },
            { label: 'Processed', value: processed, colour: 'text-green-700' },
            { label: 'Pending', value: pending, colour: 'text-amber-700' },
            { label: 'With Errors', value: errors, colour: 'text-red-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={actionQuery} onChange={e => setActionQuery(e.target.value)} placeholder="Search action…" className="w-48" />
          <Input value={userQuery} onChange={e => setUserQuery(e.target.value)} placeholder="Search user ID…" className="w-56" />
          <Select value={processedFilter} onValueChange={setProcessedFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Processed" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entries</SelectItem>
              <SelectItem value="yes">Processed only</SelectItem>
              <SelectItem value="no">Pending only</SelectItem>
            </SelectContent>
          </Select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No queue entries found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Requested At</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Processed At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.requested_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{row.user_id}</TableCell>
                        <TableCell className="text-sm">{row.action}</TableCell>
                        <TableCell>
                          <Badge className={row.processed ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                            {row.processed ? 'processed' : 'pending'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(row.processed_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4">
                            <div className="space-y-2 text-sm">
                              <div><span className="font-medium">Queue ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                              {row.error_message ? (
                                <div>
                                  <p className="font-medium mb-1">Error Message:</p>
                                  <p className="text-red-700 bg-red-50 rounded p-3">{row.error_message}</p>
                                </div>
                              ) : (
                                <p className="text-muted-foreground">No error recorded.</p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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
