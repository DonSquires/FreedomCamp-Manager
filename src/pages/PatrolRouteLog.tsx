/**
 * PatrolRouteLog — B-94
 *
 * Log viewer for the patrols table — scheduled and completed patrol records.
 *
 * Features:
 *  - KPI cards: Total / Active / Completed / Avg Breaches Found
 *  - Filters: status (dynamic), priority (dynamic), date from
 *  - Table: officer, patrol_date, status badge, priority badge,
 *           breaches_found, vehicles_checked, duration_minutes, zone_id
 *  - Expandable row: description, notes, scheduled/actual times, accepted status
 *
 * Route: /patrol-route-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Navigation2, RefreshCw, AlertCircle, Loader2,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type PatrolRow = Database['public']['Tables']['patrols']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string | null) {
  if (!status) return 'bg-gray-100 text-gray-600'
  if (status === 'completed')  return 'bg-green-100 text-green-800'
  if (status === 'active' || status === 'in_progress') return 'bg-blue-100 text-blue-800'
  if (status === 'scheduled')  return 'bg-purple-100 text-purple-800'
  if (status === 'cancelled')  return 'bg-gray-100 text-gray-600'
  return 'bg-yellow-100 text-yellow-800'
}

function priorityBadge(priority: string | null) {
  if (!priority) return 'bg-gray-100 text-gray-600'
  if (priority === 'high')   return 'bg-red-100 text-red-800'
  if (priority === 'medium') return 'bg-yellow-100 text-yellow-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PatrolRouteLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter,   setStatusFilter]   = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [dateFrom,       setDateFrom]       = useState('')
  const [expandedId,     setExpandedId]     = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<PatrolRow[]>({
    queryKey: ['patrol-route-log', orgId, statusFilter, priorityFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('patrols')
        .select('*')
        .eq('organization_id', orgId!)
        .order('patrol_date', { ascending: false })
        .limit(500)

      if (statusFilter   !== 'all') q = q.eq('status', statusFilter)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)
      if (dateFrom)                 q = q.gte('patrol_date', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const statusTypes    = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const priorityTypes  = [...new Set(rows.map(r => r.priority).filter(Boolean))].sort()
  const activeCount    = rows.filter(r => r.status === 'active' || r.status === 'in_progress').length
  const completedCount = rows.filter(r => r.status === 'completed').length
  const totalBreaches  = rows.reduce((sum, r) => sum + (r.breaches_found ?? 0), 0)
  const avgBreaches    = completedCount > 0 ? (totalBreaches / completedCount).toFixed(1) : '—'

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Navigation2 className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Patrol Route Log</h1>
              <p className="text-sm text-muted-foreground">Scheduled and completed patrol records</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Patrols',      value: rows.length,    colour: 'text-gray-700' },
            { label: 'Active',             value: activeCount,    colour: 'text-blue-700' },
            { label: 'Completed',          value: completedCount, colour: 'text-green-700' },
            { label: 'Avg Breaches Found', value: avgBreaches,    colour: 'text-orange-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusTypes.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {priorityTypes.map(p => (
                <SelectItem key={p} value={p!}>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs mr-1 ${priorityBadge(p)}`}>{p}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No patrol records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Patrol Date</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Breaches</TableHead>
                  <TableHead>Vehicles</TableHead>
                  <TableHead>Duration (min)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.patrol_date)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.assigned_to ? `${row.assigned_to.slice(0, 8)}…` : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusBadge(row.status)}>{row.status ?? '—'}</Badge>
                        </TableCell>
                        <TableCell>
                          {row.priority
                            ? <Badge className={priorityBadge(row.priority)}>{row.priority}</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-sm">{row.breaches_found ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.vehicles_checked ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.duration_minutes ?? '—'}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4 space-y-2">
                            {row.description && (
                              <div>
                                <p className="font-medium text-sm mb-1">Description</p>
                                <p className="text-sm text-muted-foreground">{row.description}</p>
                              </div>
                            )}
                            {row.notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Notes</p>
                                <p className="text-sm text-muted-foreground">{row.notes}</p>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              <span>Scheduled start: {fmtDate(row.scheduled_start_time)}</span>
                              <span>Scheduled end: {fmtDate(row.scheduled_end_time)}</span>
                              <span>Actual start: {fmtDate(row.actual_start_time)}</span>
                              <span>Actual end: {fmtDate(row.actual_end_time)}</span>
                            </div>
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              {row.officer_accepted != null && (
                                <span>Accepted: {row.officer_accepted ? 'Yes' : 'No'}</span>
                              )}
                              {row.officer_declined && (
                                <span>Decline reason: {row.officer_decline_reason ?? '—'}</span>
                              )}
                              {row.zone_id && <span>Zone: {row.zone_id.slice(0, 8)}…</span>}
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
