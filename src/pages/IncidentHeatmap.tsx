/**
 * IncidentHeatmap — B-63
 *
 * Incident density analytics across zones and incident types.
 *
 * Features:
 *  - KPI cards: Total / Open / High Severity / Avg per Zone
 *  - Horizontal bar chart: incidents by zone (top 15)
 *  - Stacked bar chart: incidents by type per week (last 12 weeks)
 *  - Severity breakdown colour band
 *  - Filters: date range, incident_type, severity, status
 *  - Table: top zones with counts and highest severity
 *
 * Route: /incident-heatmap  — admin / admin_officer / master
 * incidents is fully typed in database.ts
 */

import { useMemo, useState } from 'react'
import { format, parseISO, subDays, startOfWeek } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from 'recharts'
import {
  Flame, AlertTriangle, Loader2, RefreshCw,
  MapPin, Activity, TrendingUp,
} from 'lucide-react'

import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Incident = Database['public']['Tables']['incidents']['Row']

// ─── Config ───────────────────────────────────────────────────────────────────

const SEVERITY_COLOURS: Record<string, string> = {
  critical: '#7c3aed',
  high:     '#ef4444',
  medium:   '#f59e0b',
  low:      '#22c55e',
}

const TYPE_PALETTE = [
  '#6366f1', '#f97316', '#22c55e', '#3b82f6', '#a855f7',
  '#ec4899', '#14b8a6', '#eab308', '#ef4444', '#64748b',
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function IncidentHeatmap() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 89), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [typeFilter, setTypeFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: incidents = [], isLoading, error, refetch } = useQuery<Incident[]>({
    queryKey: ['incident_heatmap', orgId, dateFrom, dateTo, typeFilter, severityFilter, statusFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('incidents')
        .select('*')
        .eq('organization_id', orgId as string)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (dateFrom)            q = q.gte('created_at', dateFrom)
      if (dateTo)              q = q.lte('created_at', dateTo + 'T23:59:59')
      if (typeFilter !== 'all')     q = q.eq('incident_type', typeFilter)
      if (severityFilter !== 'all') q = q.eq('severity', severityFilter)
      if (statusFilter !== 'all')   q = q.eq('status', statusFilter)
      const { data, error } = await q.limit(2000)
      if (error) throw error
      return data as Incident[]
    },
  })

  // ── Derived ────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => ({
    total:  incidents.length,
    open:   incidents.filter(i => i.status !== 'resolved' && i.status !== 'closed').length,
    high:   incidents.filter(i => i.severity === 'high' || i.severity === 'critical').length,
    zones:  new Set(incidents.filter(i => i.zone_id).map(i => i.zone_id)).size,
  }), [incidents])

  // By-zone bar chart (top 15)
  const byZone = useMemo(() => {
    const map = new Map<string, number>()
    for (const i of incidents) {
      const key = i.zone_id ?? 'Unknown'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([zone, count]) => ({ zone: zone.slice(0, 8) + '…', fullZone: zone, count }))
  }, [incidents])

  // Weekly by type stacked bar
  const incidentTypes = useMemo(() => {
    const types = [...new Set(incidents.map(i => i.incident_type).filter(Boolean))]
    return types.slice(0, 8) as string[]
  }, [incidents])

  const weeklyByType = useMemo(() => {
    const weeks: (Record<string, number | string> & { week: string })[] = []
    for (let i = 11; i >= 0; i--) {
      const d = subDays(new Date(), i * 7)
      const obj: Record<string, number | string> = { week: format(startOfWeek(d), 'dd MMM') }
      for (const t of incidentTypes) obj[t] = 0
      weeks.push(obj as (Record<string, number | string> & { week: string }))
    }
    for (const inc of incidents) {
      if (!inc.created_at || !inc.incident_type) continue
      if (!incidentTypes.includes(inc.incident_type)) continue
      const weekLabel = format(startOfWeek(parseISO(inc.created_at)), 'dd MMM')
      const w = weeks.find(w => w.week === weekLabel)
      if (!w) continue
      (w[inc.incident_type] as number) = ((w[inc.incident_type] as number) ?? 0) + 1
    }
    return weeks
  }, [incidents, incidentTypes])

  // Severity distribution
  const severityDist = useMemo(() => {
    const map: Record<string, number> = {}
    for (const i of incidents) {
      const s = i.severity ?? 'unknown'
      map[s] = (map[s] ?? 0) + 1
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [incidents])

  // Zone table
  const zoneTable = useMemo(() => {
    const map = new Map<string, { count: number; highestSeverity: string; types: Set<string> }>()
    for (const i of incidents) {
      const key = i.zone_id ?? 'No Zone'
      if (!map.has(key)) map.set(key, { count: 0, highestSeverity: 'low', types: new Set() })
      const entry = map.get(key)!
      entry.count++
      if (i.severity) entry.types.add(i.severity)
      const sev = ['critical', 'high', 'medium', 'low']
      if (i.severity && sev.indexOf(i.severity) < sev.indexOf(entry.highestSeverity)) {
        entry.highestSeverity = i.severity
      }
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20)
  }, [incidents])

  const incidentTypeOptions = useMemo(() => [...new Set(incidents.map(i => i.incident_type).filter(Boolean))].sort() as string[], [incidents])
  const statusOptions = useMemo(() => [...new Set(incidents.map(i => i.status).filter(Boolean))].sort() as string[], [incidents])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Flame className="h-6 w-6 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Incident Heatmap</h1>
              <p className="text-sm text-muted-foreground">Incident density by zone, type, and severity</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Date From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Incident Type</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {incidentTypeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Severity</Label>
                <Select value={severityFilter} onValueChange={setSeverityFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive py-8 justify-center"><AlertTriangle className="h-5 w-5" /> Failed to load incidents.</div>
        ) : incidents.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Flame className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No incidents match your filters.</p>
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Activity className="h-3.5 w-3.5" /> Total Incidents</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-slate-700">{kpi.total}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-yellow-500" /> Open</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-yellow-600">{kpi.open}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Flame className="h-3.5 w-3.5 text-red-500" /> High / Critical</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-red-600">{kpi.high}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-blue-500" /> Active Zones</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-blue-600">{kpi.zones}</p></CardContent>
              </Card>
            </div>

            {/* By-zone bar chart */}
            {byZone.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><MapPin className="h-4 w-4" /> Incidents by Zone (Top 15)</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart layout="vertical" data={byZone} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="zone" tick={{ fontSize: 10 }} width={80} />
                      <Tooltip />
                      <Bar dataKey="count" name="Incidents" radius={[0, 3, 3, 0]}>
                        {byZone.map((_, i) => (
                          <Cell key={i} fill={`hsl(${220 + i * 12}, 70%, ${55 - i * 2}%)`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Weekly by type */}
            {incidentTypes.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Weekly Incidents by Type</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={weeklyByType} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {incidentTypes.map((t, i) => (
                        <Bar key={t} dataKey={t} stackId="a" fill={TYPE_PALETTE[i % TYPE_PALETTE.length]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Severity distribution */}
            {severityDist.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Severity Distribution</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {severityDist.map(([sev, count]) => (
                      <div key={sev} className="flex items-center gap-2 px-3 py-2 rounded-lg border">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: SEVERITY_COLOURS[sev] ?? '#94a3b8' }} />
                        <span className="text-sm capitalize">{sev}</span>
                        <span className="text-sm font-bold">{count}</span>
                        <span className="text-xs text-muted-foreground">({Math.round((count / kpi.total) * 100)}%)</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Zone table */}
            {zoneTable.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Top Zones by Incident Count</CardTitle></CardHeader>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zone ID</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead>Highest Severity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zoneTable.map(([zoneId, info]) => (
                      <TableRow key={zoneId}>
                        <TableCell className="font-mono text-xs">{zoneId.length > 36 ? zoneId.slice(0, 8) + '…' : zoneId}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{info.count}</TableCell>
                        <TableCell>
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize"
                            style={{ color: SEVERITY_COLOURS[info.highestSeverity] ?? '#64748b', backgroundColor: `${SEVERITY_COLOURS[info.highestSeverity] ?? '#94a3b8'}20` }}
                          >
                            {info.highestSeverity}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}
