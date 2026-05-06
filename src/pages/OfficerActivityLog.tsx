/**
 * OfficerActivityLog — B-88
 *
 * Log viewer for officer_activity_log — officer GPS/activity telemetry.
 *
 * Features:
 *  - KPI cards: Total / Unique Officers / GPS Fixes / Activity Types
 *  - Filters: activity_type (dynamic with colour-coded badges), date range
 *  - Table: user_id, activity_type badge, recorded_at, GPS lat/lng, accuracy
 *  - Expandable row: metadata JSON, created_at
 *
 * Route: /officer-activity-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Activity, RefreshCw, AlertCircle, Loader2,
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

type ActivityLog = Database['public']['Tables']['officer_activity_log']['Row']

// ─── Activity type colour palette ─────────────────────────────────────────────

const ACTIVITY_COLOURS = [
  'bg-blue-100 text-blue-800',
  'bg-green-100 text-green-800',
  'bg-purple-100 text-purple-800',
  'bg-orange-100 text-orange-800',
  'bg-teal-100 text-teal-800',
  'bg-rose-100 text-rose-800',
  'bg-yellow-100 text-yellow-800',
  'bg-indigo-100 text-indigo-800',
]

function activityColour(type: string, allTypes: string[]) {
  const idx = allTypes.indexOf(type)
  return ACTIVITY_COLOURS[idx % ACTIVITY_COLOURS.length]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfficerActivityLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [typeFilter, setTypeFilter] = useState('all')
  const [dateFrom, setDateFrom]     = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<ActivityLog[]>({
    queryKey: ['officer-activity-log', orgId, typeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('officer_activity_log')
        .select('*')
        .eq('organization_id', orgId!)
        .order('recorded_at', { ascending: false })
        .limit(500)

      if (typeFilter !== 'all') q = q.eq('activity_type', typeFilter)
      if (dateFrom)             q = q.gte('recorded_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activityTypes = [...new Set(rows.map(r => r.activity_type).filter(Boolean))].sort()

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total          = rows.length
  const uniqueOfficers = new Set(rows.map(r => r.user_id)).size
  const gpsFixes       = rows.filter(r => r.gps_latitude != null && r.gps_longitude != null).length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Officer Activity Log</h1>
              <p className="text-sm text-muted-foreground">Officer GPS and activity telemetry</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events',     value: total,           colour: 'text-gray-700' },
            { label: 'Unique Officers',  value: uniqueOfficers,  colour: 'text-blue-700' },
            { label: 'GPS Fixes',        value: gpsFixes,        colour: 'text-green-700' },
            { label: 'Activity Types',   value: activityTypes.length, colour: 'text-purple-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Activity type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All activity types</SelectItem>
              {activityTypes.map(t => (
                <SelectItem key={t} value={t}>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs mr-1 ${activityColour(t, activityTypes)}`}>{t}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No activity log entries found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Officer</TableHead>
                  <TableHead>Activity Type</TableHead>
                  <TableHead>Recorded At</TableHead>
                  <TableHead>GPS Lat</TableHead>
                  <TableHead>GPS Lng</TableHead>
                  <TableHead>Accuracy (m)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const colour = activityColour(row.activity_type, activityTypes)
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.user_id.slice(0, 8)}…</TableCell>
                        <TableCell><Badge className={colour}>{row.activity_type}</Badge></TableCell>
                        <TableCell className="text-sm">{fmtDate(row.recorded_at)}</TableCell>
                        <TableCell className="text-sm">{row.gps_latitude != null ? row.gps_latitude.toFixed(5) : '—'}</TableCell>
                        <TableCell className="text-sm">{row.gps_longitude != null ? row.gps_longitude.toFixed(5) : '—'}</TableCell>
                        <TableCell className="text-sm">{row.gps_accuracy ?? '—'}</TableCell>
                      </TableRow>
                      {expanded && row.metadata && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <p className="font-medium text-sm mb-1">Metadata</p>
                            <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-40">
                              {JSON.stringify(row.metadata, null, 2)}
                            </pre>
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
