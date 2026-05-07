/**
 * UserSessionsLog — B-129
 *
 * Master-only admin log for user_sessions.
 *
 * Features:
 *  - KPIs: Total / Active in 24h / Platforms / With Device Name
 *  - Filters: platform / user_id search / last_seen date-from
 *
 * Route: /user-sessions-log — master
 */
import { useState } from 'react'
import { format, parseISO, subHours } from 'date-fns'
import { Laptop2, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/features/AppLayout'
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

type SessionRow = Database['public']['Tables']['user_sessions']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function UserSessionsLog() {
  const [platformFilter, setPlatformFilter] = useState('all')
  const [userQuery, setUserQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')

  const { data: rows = [], isLoading, refetch } = useQuery<SessionRow[]>({
    queryKey: ['user-sessions-log', platformFilter, userQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('user_sessions')
        .select('*')
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (platformFilter !== 'all') q = q.eq('device_platform', platformFilter)
      if (userQuery.trim()) q = q.ilike('user_id', `%${userQuery.trim()}%`)
      if (dateFrom) q = q.gte('last_seen_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCutoff = subHours(new Date(), 24)
  const activeLast24h = rows.filter(r => r.last_seen_at && parseISO(r.last_seen_at) >= activeCutoff).length
  const platforms = [...new Set(rows.map(r => r.device_platform).filter(Boolean))].sort()
  const withDeviceName = rows.filter(r => !!r.device_name).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Laptop2 className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">User Sessions Log</h1>
              <p className="text-sm text-muted-foreground">Session and device activity records</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Sessions', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active in 24h', value: activeLast24h, colour: 'text-green-700' },
            { label: 'Platforms', value: platforms.length, colour: 'text-indigo-700' },
            { label: 'With Device Name', value: withDeviceName, colour: 'text-purple-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={userQuery} onChange={e => setUserQuery(e.target.value)} placeholder="Search user ID…" className="w-56" />
          <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)} className="border rounded px-3 py-1 text-sm bg-background w-44">
            <option value="all">All platforms</option>
            {platforms.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No sessions found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Last Seen</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Device Name</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{fmtDate(row.last_seen_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(row.created_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.user_id}</TableCell>
                    <TableCell className="text-sm">{row.device_platform ?? '—'}</TableCell>
                    <TableCell className="text-sm">{row.device_name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.ip_address ?? '—'}</TableCell>
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
