/**
 * OfficerActivityLog — B-88
 *
 * Admin log for officer_activity_log.
 *
 * Features:
 *  - KPI cards: Total Events / Unique Officers / With GPS / Activity-type breakdown
 *  - Filters: activity_type select (dynamic), officer UUID prefix search, date range
 *  - Table: user_id (truncated), activity_type badge, GPS indicator, accuracy, recorded_at
 *  - Expandable row: full user_id, lat/lng, metadata JSON
 *
 * Route: /officer-activity-log — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Activity, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, MapPin, Users,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import type { Database } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type OfficerActivity = Database['public']['Tables']['officer_activity_log']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function activityBadge(type: string) {
  const colorMap: Record<string, string> = {
    login:             'text-green-700',
    logout:            'text-gray-600',
    patrol_start:      'text-blue-700',
    patrol_end:        'text-blue-500',
    checkin:           'text-teal-700',
    breach_created:    'text-red-700',
    observation:       'text-purple-700',
  }
  const cls = colorMap[type] ?? 'text-muted-foreground'
  return <Badge variant="outline" className={`text-xs ${cls}`}>{type.replace(/_/g, ' ')}</Badge>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfficerActivityLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [officerSearch, setOfficer] = useState('')
  const [typeFilter, setType]       = useState('all')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data: activities = [], isLoading, refetch } = useQuery({
    queryKey: ['officer-activity-log', orgId, typeFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('officer_activity_log')
        .select('*')
        .eq('organization_id', orgId!)
        .order('recorded_at', { ascending: false })
        .limit(500)

      if (typeFilter !== 'all') q = q.eq('activity_type', typeFilter)
      if (dateFrom) q = q.gte('recorded_at', dateFrom)
      if (dateTo)   q = q.lte('recorded_at', `${dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as OfficerActivity[]
    },
  })

  // ── Dynamic lists ──────────────────────────────────────────────────────────

  const activityTypes = Array.from(new Set(activities.map(a => a.activity_type))).sort()

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:      activities.length,
    officers:   new Set(activities.map(a => a.user_id)).size,
    withGps:    activities.filter(a => a.gps_latitude != null).length,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = activities.filter(a => {
    if (officerSearch) {
      if (!a.user_id.toLowerCase().includes(officerSearch.toLowerCase())) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Officer Activity Log" description="All recorded officer activity events for this organisation">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-blue-600" />
          <span className="font-semibold text-lg">Officer Activity Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Events',     value: kpis.total,    icon: <Activity className="h-4 w-4" />, color: 'text-foreground' },
          { label: 'Unique Officers',  value: kpis.officers, icon: <Users className="h-4 w-4" />,    color: 'text-blue-600' },
          { label: 'Events With GPS',  value: kpis.withGps,  icon: <MapPin className="h-4 w-4" />,   color: 'text-teal-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search officer ID…"
            value={officerSearch}
            onChange={e => setOfficer(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={typeFilter} onValueChange={setType}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Activity type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {activityTypes.map(t => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && activities.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No activity records found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Officer ID</TableHead>
              <TableHead>Activity Type</TableHead>
              <TableHead>GPS</TableHead>
              <TableHead>Accuracy (m)</TableHead>
              <TableHead>Recorded At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && activities.length > 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No events match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(a => {
              const expanded = expandedId === a.id
              const hasGps = a.gps_latitude != null && a.gps_longitude != null
              return [
                <TableRow
                  key={a.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : a.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {a.user_id.slice(0, 8)}…
                  </TableCell>
                  <TableCell>{activityBadge(a.activity_type)}</TableCell>
                  <TableCell>
                    {hasGps
                      ? <Badge variant="secondary" className="text-xs text-teal-700"><MapPin className="h-3 w-3 mr-1 inline" />Yes</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.gps_accuracy != null ? `${a.gps_accuracy.toFixed(1)} m` : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(a.recorded_at)}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${a.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={5} className="py-3 space-y-1 text-sm">
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Officer: <code className="bg-muted px-1 rounded">{a.user_id}</code></span>
                        {hasGps && (
                          <span><MapPin className="h-3 w-3 inline mr-0.5" />{a.gps_latitude!.toFixed(6)}, {a.gps_longitude!.toFixed(6)}</span>
                        )}
                        <span>Created: {fmtDate(a.created_at)}</span>
                      </div>
                      {a.metadata && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Metadata</span>
                          <pre className="mt-0.5 text-xs bg-muted rounded p-2 overflow-x-auto">
                            {JSON.stringify(a.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ),
              ]
            })}
          </TableBody>
        </Table>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {activities.length} events
        </p>
      )}
    </AppLayout>
  )
}
