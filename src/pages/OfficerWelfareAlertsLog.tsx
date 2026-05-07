/**
 * OfficerWelfareAlertsLog — B-134
 *
 * Admin log for officer_welfare_alerts.
 *
 * Route: /officer-welfare-alerts-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { HeartPulse, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type WelfareAlertRow = Database['public']['Tables']['officer_welfare_alerts']['Row']

function fmtAgo(ts: string | null) {
  if (!ts) return '—'
  try { return `${formatDistanceToNow(parseISO(ts))} ago` } catch { return ts }
}

export default function OfficerWelfareAlertsLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter, setStatusFilter] = useState('all')
  const [alertTypeFilter, setAlertTypeFilter] = useState('all')
  const [officerQuery, setOfficerQuery] = useState('')

  const { data: rows = [], isLoading, refetch } = useQuery<WelfareAlertRow[]>({
    queryKey: ['officer-welfare-alerts-log', orgId, statusFilter, alertTypeFilter, officerQuery],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('officer_welfare_alerts')
        .select('*')
        .eq('organization_id', orgId!)
        .order('last_activity_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (alertTypeFilter !== 'all') q = q.eq('alert_type', alertTypeFilter)
      if (officerQuery.trim()) q = q.or(`officer_name.ilike.%${officerQuery.trim()}%,officer_id.ilike.%${officerQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const statuses = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const types = [...new Set(rows.map(r => r.alert_type).filter(Boolean))].sort()
  const openCount = rows.filter(r => r.status === 'open').length
  const resolvedCount = rows.filter(r => r.status === 'resolved').length
  const escalatedCount = rows.filter(r => (r.escalation_level ?? 0) > 0).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HeartPulse className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">Officer Welfare Alerts Log</h1>
              <p className="text-sm text-muted-foreground">Welfare alert state, escalation, and response tracking</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Alerts', value: rows.length, colour: 'text-gray-700' },
            { label: 'Open', value: openCount, colour: 'text-red-700' },
            { label: 'Resolved', value: resolvedCount, colour: 'text-green-700' },
            { label: 'Escalated', value: escalatedCount, colour: 'text-amber-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={officerQuery} onChange={e => setOfficerQuery(e.target.value)} placeholder="Search officer name/ID…" className="w-60" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={alertTypeFilter} onValueChange={setAlertTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Alert type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No welfare alerts found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Officer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Escalation</TableHead>
                  <TableHead>Last Activity</TableHead>
                  <TableHead>Acknowledged</TableHead>
                  <TableHead>Resolved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{row.officer_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{row.officer_id}</div>
                    </TableCell>
                    <TableCell className="text-sm">{row.alert_type}</TableCell>
                    <TableCell>
                      <Badge className={row.status === 'resolved' ? 'bg-green-100 text-green-800' : row.status === 'open' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}>
                        {row.status ?? 'unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{row.escalation_level ?? 0}</TableCell>
                    <TableCell className="text-sm">{fmtAgo(row.last_activity_at)}</TableCell>
                    <TableCell className="text-sm">{fmtAgo(row.acknowledged_at)}</TableCell>
                    <TableCell className="text-sm">{fmtAgo(row.resolved_at)}</TableCell>
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
