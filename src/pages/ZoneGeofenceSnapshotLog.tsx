/**
 * ZoneGeofenceSnapshotLog — B-122
 *
 * Monthly geofence quality snapshots for zones.
 * Tracks geometry integrity, quality status, and quality metrics over time.
 *
 * Features:
 *  - KPIs: Total Snapshots / Good Quality / Needs Review / Zones Covered
 *  - Filters: quality_status / zone_type / month picker
 *  - Expandable row: geometry hash + quality metrics JSON
 *
 * Route: /zone-geofence-snapshots — admin / master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Map, RefreshCw, AlertCircle, Loader2,
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

type ZoneGeofenceSnapshotRow = Database['public']['Tables']['zone_geofence_monthly_snapshots']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtMonth(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'MMM yyyy') } catch { return ts }
}

function qualityTone(qs: string | null) {
  switch (qs) {
    case 'good': return 'bg-green-100 text-green-800'
    case 'needs_review': return 'bg-yellow-100 text-yellow-800'
    case 'poor': return 'bg-red-100 text-red-800'
    default: return 'bg-gray-100 text-gray-700'
  }
}

export default function ZoneGeofenceSnapshotLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [qualityStatusFilter, setQualityStatusFilter] = useState('all')
  const [zoneTypeFilter, setZoneTypeFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ZoneGeofenceSnapshotRow[]>({
    queryKey: ['zone-geofence-snapshots', orgId, qualityStatusFilter, zoneTypeFilter, monthFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('zone_geofence_monthly_snapshots')
        .select('*')
        .eq('organization_id', orgId!)
        .order('snapshot_month', { ascending: false })
        .limit(500)

      if (qualityStatusFilter !== 'all') q = q.eq('quality_status', qualityStatusFilter)
      if (zoneTypeFilter !== 'all') q = q.eq('zone_type', zoneTypeFilter)
      if (monthFilter) q = q.gte('snapshot_month', monthFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const zoneTypes = [...new Set(rows.map(r => r.zone_type).filter(Boolean))].sort()
  const goodCount = rows.filter(r => r.quality_status === 'good').length
  const needsReviewCount = rows.filter(r => r.quality_status === 'needs_review').length
  const uniqueZones = new Set(rows.map(r => r.zone_id)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Map className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Geofence Snapshot Log</h1>
              <p className="text-sm text-muted-foreground">Monthly geofence quality assessments for operational zones</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Snapshots', value: rows.length, colour: 'text-gray-700' },
            { label: 'Good Quality', value: goodCount, colour: 'text-green-700' },
            { label: 'Needs Review', value: needsReviewCount, colour: 'text-yellow-700' },
            { label: 'Zones Covered', value: uniqueZones, colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={qualityStatusFilter} onValueChange={setQualityStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Quality status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="good">Good</SelectItem>
              <SelectItem value="needs_review">Needs Review</SelectItem>
              <SelectItem value="poor">Poor</SelectItem>
            </SelectContent>
          </Select>
          <Select value={zoneTypeFilter} onValueChange={setZoneTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Zone type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All zone types</SelectItem>
              {zoneTypes.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="month"
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
            className="w-40"
            placeholder="From month"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No geofence snapshots found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Month</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Zone Type</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Geometry Type</TableHead>
                  <TableHead>Source Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm font-medium">{fmtMonth(row.snapshot_month)}</TableCell>
                        <TableCell className="text-sm">{row.zone_name ?? row.zone_id?.slice(0, 8) ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.zone_type ?? '—'}</TableCell>
                        <TableCell><Badge className={qualityTone(row.quality_status)}>{row.quality_status ?? '—'}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.geometry_type ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(row.source_updated_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Snapshot ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Zone ID:</span> <span className="font-mono text-xs">{row.zone_id}</span></div>
                                <div><span className="font-medium">Geometry Hash:</span> <span className="font-mono text-xs text-muted-foreground">{row.geometry_hash ?? '—'}</span></div>
                                <div><span className="font-medium">Created At:</span> <span className="text-muted-foreground">{fmtDate(row.created_at)}</span></div>
                              </div>
                              {row.quality_reason && (
                                <div><span className="font-medium">Quality Reason:</span> <span className="text-muted-foreground">{row.quality_reason}</span></div>
                              )}
                              {row.quality_metrics && (
                                <div>
                                  <p className="font-medium mb-1">Quality Metrics:</p>
                                  <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-32">{JSON.stringify(row.quality_metrics, null, 2)}</pre>
                                </div>
                              )}
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
