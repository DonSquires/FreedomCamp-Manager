/**
 * SiteRiskTrends — B-62
 *
 * Trend analytics dashboard for site_risk_assessments.
 *
 * Features:
 *  - KPI cards: Total Assessments / High Risk / Pending Review / Completed
 *  - Line chart: assessments per day (last 30 days)
 *  - Stacked bar chart: risk level breakdown per week (last 12 weeks)
 *  - Pie-style legend: overall_risk_level distribution
 *  - Hazard frequency heat-row: which hazards appear most often
 *  - Filters: date range, overall_risk_level, status
 *
 * Route: /site-risk-trends  — admin / admin_officer / master
 * site_risk_assessments is fully typed in database.ts
 */

import { useMemo, useState } from 'react'
import { format, parseISO, subDays, startOfWeek, eachWeekOfInterval } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  ClipboardCheck, AlertTriangle, TrendingUp, CheckCircle,
  Loader2, RefreshCw, Clock,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type Assessment = Database['public']['Tables']['site_risk_assessments']['Row']

// ─── Config ───────────────────────────────────────────────────────────────────

const RISK_COLOURS: Record<string, string> = {
  low:      '#22c55e',
  medium:   '#f59e0b',
  high:     '#ef4444',
  critical: '#7c3aed',
}

const HAZARD_KEYS: (keyof Assessment)[] = [
  'hazard_aggressive_persons', 'hazard_animals', 'hazard_biological',
  'hazard_confined_spaces', 'hazard_electrical', 'hazard_fire',
  'hazard_hazardous_substances', 'hazard_lone_working', 'hazard_manual_handling',
  'hazard_noise', 'hazard_poor_lighting', 'hazard_slips_trips_falls',
  'hazard_uneven_terrain', 'hazard_vehicles_traffic', 'hazard_water_drowning',
  'hazard_weather_exposure', 'hazard_working_at_height',
]

function hazardLabel(key: string) {
  return key.replace('hazard_', '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SiteRiskTrends() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 89), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [riskFilter, setRiskFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: assessments = [], isLoading, error, refetch } = useQuery<Assessment[]>({
    queryKey: ['site_risk_trends', orgId, dateFrom, dateTo, riskFilter, statusFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('site_risk_assessments')
        .select('*')
        .eq('organization_id', orgId as string)
        .order('assessment_date', { ascending: false })
      if (dateFrom)            q = q.gte('assessment_date', dateFrom)
      if (dateTo)              q = q.lte('assessment_date', dateTo)
      if (riskFilter !== 'all')   q = q.eq('overall_risk_level', riskFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      const { data, error } = await q
      if (error) throw error
      return data as Assessment[]
    },
  })

  // ── Derived ────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => ({
    total:        assessments.length,
    high:         assessments.filter(a => a.overall_risk_level === 'high' || a.overall_risk_level === 'critical').length,
    pendingReview: assessments.filter(a => a.status === 'pending_review' || a.status === 'submitted').length,
    completed:    assessments.filter(a => a.status === 'completed' || a.status === 'reviewed').length,
  }), [assessments])

  // Daily line chart (last 30 days within filtered range)
  const dailyData = useMemo(() => {
    const days = new Map<string, number>()
    for (let i = 29; i >= 0; i--) days.set(format(subDays(new Date(), i), 'dd MMM'), 0)
    for (const a of assessments) {
      if (!a.assessment_date) continue
      const label = format(parseISO(a.assessment_date), 'dd MMM')
      if (days.has(label)) days.set(label, days.get(label)! + 1)
    }
    return [...days.entries()].map(([date, count]) => ({ date, count }))
  }, [assessments])

  // Weekly stacked bar by risk level
  const weeklyData = useMemo(() => {
    const weeks: { week: string; low: number; medium: number; high: number; critical: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const d = subDays(new Date(), i * 7)
      weeks.push({ week: format(startOfWeek(d), 'dd MMM'), low: 0, medium: 0, high: 0, critical: 0 })
    }
    for (const a of assessments) {
      if (!a.assessment_date) continue
      const weekLabel = format(startOfWeek(parseISO(a.assessment_date)), 'dd MMM')
      const w = weeks.find(w => w.week === weekLabel)
      if (!w) continue
      const lvl = a.overall_risk_level as 'low' | 'medium' | 'high' | 'critical'
      if (lvl in w) (w[lvl] as number)++
    }
    return weeks
  }, [assessments])

  // Hazard frequency
  const hazardFreq = useMemo(() => {
    return HAZARD_KEYS.map(key => ({
      hazard: hazardLabel(key as string),
      count: assessments.filter(a => a[key] === true).length,
    })).sort((a, b) => b.count - a.count).slice(0, 10)
  }, [assessments])

  // Risk distribution for summary
  const riskDist = useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of assessments) {
      map[a.overall_risk_level] = (map[a.overall_risk_level] ?? 0) + 1
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [assessments])

  const statuses = useMemo(() => [...new Set(assessments.map(a => a.status))].sort(), [assessments])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Site Risk Trends</h1>
              <p className="text-sm text-muted-foreground">Trend analytics across all site risk assessments</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Date From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Risk Level</Label>
                <Select value={riskFilter} onValueChange={setRiskFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All levels</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive py-8 justify-center"><AlertTriangle className="h-5 w-5" /> Failed to load assessments.</div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><ClipboardCheck className="h-3.5 w-3.5" /> Total</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-slate-700">{kpi.total}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-red-500" /> High / Critical</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-red-600">{kpi.high}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-yellow-500" /> Pending Review</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-yellow-600">{kpi.pendingReview}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5 text-green-500" /> Completed</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-green-600">{kpi.completed}</p></CardContent>
              </Card>
            </div>

            {/* Daily line chart */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Assessments Per Day (Last 30 Days)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={dailyData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" name="Assessments" stroke="#f97316" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Weekly stacked bar */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Risk Level Breakdown by Week</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={weeklyData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="low"      name="Low"      stackId="a" fill={RISK_COLOURS.low}      radius={[0, 0, 0, 0]} />
                    <Bar dataKey="medium"   name="Medium"   stackId="a" fill={RISK_COLOURS.medium}   />
                    <Bar dataKey="high"     name="High"     stackId="a" fill={RISK_COLOURS.high}     />
                    <Bar dataKey="critical" name="Critical" stackId="a" fill={RISK_COLOURS.critical} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Hazard frequency */}
            {hazardFreq.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Top 10 Hazard Frequencies</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {hazardFreq.map(({ hazard, count }) => {
                      const maxCount = hazardFreq[0].count || 1
                      const pct = Math.round((count / maxCount) * 100)
                      return (
                        <div key={hazard} className="flex items-center gap-3">
                          <span className="text-xs w-44 text-muted-foreground truncate" title={hazard}>{hazard}</span>
                          <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                            <div className="h-full rounded bg-orange-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-medium w-6 text-right">{count}</span>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Risk distribution summary */}
            {riskDist.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Risk Level Distribution</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {riskDist.map(([level, count]) => (
                      <div key={level} className="flex items-center gap-2 px-3 py-2 rounded-lg border">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: RISK_COLOURS[level] ?? '#94a3b8' }} />
                        <span className="text-sm capitalize">{level}</span>
                        <span className="text-sm font-bold">{count}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}
