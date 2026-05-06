/**
 * OfficerPerformanceReport — B-61
 *
 * Per-officer KPI dashboard aggregated from:
 *   - patrol_session_events  (checkpoints scanned/missed, patrols started/completed)
 *   - breach_alerts          (breaches raised, resolved)
 *
 * Features:
 *  - Officer selector (by ID derived from unique set in patrol_session_events)
 *  - Date range filter
 *  - KPI cards: Patrols, Checkpoints Scanned, Missed, Miss Rate, Breaches Raised
 *  - Bar chart: daily checkpoint scans vs misses (last 30 days)
 *  - Sortable officer league table when no single officer selected
 *
 * Route: /officer-performance  — admin / admin_officer / master
 * Both tables are fully typed in database.ts
 */

import { useMemo, useState } from 'react'
import { format, parseISO, subDays, startOfDay } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import {
  UserCheck, CheckCircle2, AlertCircle, TrendingUp,
  Loader2, RefreshCw, ShieldAlert, Route,
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

type PatrolEvent = Database['public']['Tables']['patrol_session_events']['Row']
type BreachAlert = Database['public']['Tables']['breach_alerts']['Row']

interface OfficerStats {
  officerId: string
  patrols: number
  scanned: number
  missed: number
  completed: number
  missRate: number
  breachesRaised: number
  breachesResolved: number
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildLeagueTable(events: PatrolEvent[], breaches: BreachAlert[]): OfficerStats[] {
  const map = new Map<string, OfficerStats>()
  for (const e of events) {
    if (!map.has(e.officer_id)) {
      map.set(e.officer_id, { officerId: e.officer_id, patrols: 0, scanned: 0, missed: 0, completed: 0, missRate: 0, breachesRaised: 0, breachesResolved: 0 })
    }
    const s = map.get(e.officer_id)!
    if (e.event_type === 'patrol_started')    s.patrols++
    if (e.event_type === 'checkpoint_scan')   s.scanned++
    if (e.event_type === 'checkpoint_missed') s.missed++
    if (e.event_type === 'patrol_completed')  s.completed++
  }
  for (const b of breaches) {
    if (!b.assigned_to) continue
    if (!map.has(b.assigned_to)) {
      map.set(b.assigned_to, { officerId: b.assigned_to, patrols: 0, scanned: 0, missed: 0, completed: 0, missRate: 0, breachesRaised: 0, breachesResolved: 0 })
    }
    const s = map.get(b.assigned_to)!
    s.breachesRaised++
    if (b.status === 'resolved') s.breachesResolved++
  }
  for (const s of map.values()) {
    const total = s.scanned + s.missed
    s.missRate = total > 0 ? Math.round((s.missed / total) * 100) : 0
  }
  return [...map.values()].sort((a, b) => b.scanned - a.scanned)
}

function buildDailyChart(events: PatrolEvent[], officerId: string | null): { date: string; scanned: number; missed: number }[] {
  const filtered = officerId ? events.filter(e => e.officer_id === officerId) : events
  const days = new Map<string, { scanned: number; missed: number }>()
  for (let i = 29; i >= 0; i--) {
    days.set(format(subDays(new Date(), i), 'dd MMM'), { scanned: 0, missed: 0 })
  }
  for (const e of filtered) {
    const day = format(parseISO(e.event_time), 'dd MMM')
    if (!days.has(day)) continue
    const d = days.get(day)!
    if (e.event_type === 'checkpoint_scan')   d.scanned++
    if (e.event_type === 'checkpoint_missed') d.missed++
  }
  return [...days.entries()].map(([date, v]) => ({ date, ...v }))
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfficerPerformanceReport() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [officerId, setOfficerId] = useState('all')
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: events = [], isLoading: eventsLoading, refetch: refetchEvents } = useQuery<PatrolEvent[]>({
    queryKey: ['officer_perf_events', orgId, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('patrol_session_events')
        .select('*')
        .eq('organization_id', orgId as string)
        .order('event_time', { ascending: false })
      if (dateFrom) q = q.gte('event_time', dateFrom)
      if (dateTo)   q = q.lte('event_time', dateTo + 'T23:59:59')
      const { data, error } = await q
      if (error) throw error
      return data as PatrolEvent[]
    },
  })

  const { data: breaches = [], isLoading: breachesLoading, refetch: refetchBreaches } = useQuery<BreachAlert[]>({
    queryKey: ['officer_perf_breaches', orgId, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('breach_alerts')
        .select('id, assigned_to, status, created_at')
        .eq('organization_id', orgId as string)
        .not('assigned_to', 'is', null)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59')
      const { data, error } = await q
      if (error) throw error
      return data as BreachAlert[]
    },
  })

  const isLoading = eventsLoading || breachesLoading

  // ── Derived ────────────────────────────────────────────────────────────────
  const league = useMemo(() => buildLeagueTable(events, breaches), [events, breaches])
  const officerIds = useMemo(() => [...new Set(events.map(e => e.officer_id))].sort(), [events])

  const selected: OfficerStats | undefined = useMemo(
    () => officerId !== 'all' ? league.find(o => o.officerId === officerId) : undefined,
    [officerId, league]
  )

  const kpi = selected ?? {
    patrols:         events.filter(e => e.event_type === 'patrol_started').length,
    scanned:         events.filter(e => e.event_type === 'checkpoint_scan').length,
    missed:          events.filter(e => e.event_type === 'checkpoint_missed').length,
    completed:       events.filter(e => e.event_type === 'patrol_completed').length,
    breachesRaised:  breaches.length,
    breachesResolved: breaches.filter(b => b.status === 'resolved').length,
    missRate: (() => {
      const s = events.filter(e => e.event_type === 'checkpoint_scan').length
      const m = events.filter(e => e.event_type === 'checkpoint_missed').length
      const t = s + m
      return t > 0 ? Math.round((m / t) * 100) : 0
    })(),
  }

  const dailyData = useMemo(() => buildDailyChart(events, officerId !== 'all' ? officerId : null), [events, officerId])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UserCheck className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Officer Performance Report</h1>
              <p className="text-sm text-muted-foreground">Checkpoint scan rates and breach activity by officer</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { refetchEvents(); refetchBreaches() }}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Officer</Label>
                <Select value={officerId} onValueChange={setOfficerId}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All officers</SelectItem>
                    {officerIds.map(id => (
                      <SelectItem key={id} value={id}>{id.slice(0, 8)}…</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm" />
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Route className="h-3.5 w-3.5" /> Patrols</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-blue-600">{kpi.patrols}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Checkpoints Scanned</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-green-600">{kpi.scanned}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" /> Miss Rate</CardTitle></CardHeader>
                <CardContent>
                  <p className={`text-3xl font-bold ${kpi.missRate > 20 ? 'text-red-600' : kpi.missRate > 10 ? 'text-yellow-600' : 'text-green-600'}`}>{kpi.missRate}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" /> Breaches Raised</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-orange-600">{kpi.breachesRaised}</p></CardContent>
              </Card>
            </div>

            {/* Daily chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Daily Checkpoint Activity (Last 30 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={dailyData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="scanned" name="Scanned" fill="#22c55e" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="missed"  name="Missed"  fill="#ef4444" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* League table (only when all officers) */}
            {officerId === 'all' && league.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Officer League Table</CardTitle></CardHeader>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Officer ID</TableHead>
                      <TableHead className="text-right">Patrols</TableHead>
                      <TableHead className="text-right">Scanned</TableHead>
                      <TableHead className="text-right">Missed</TableHead>
                      <TableHead className="text-right">Miss Rate</TableHead>
                      <TableHead className="text-right">Breaches</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {league.map(o => (
                      <TableRow
                        key={o.officerId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setOfficerId(o.officerId)}
                      >
                        <TableCell className="font-mono text-xs">{o.officerId.slice(0, 8)}…</TableCell>
                        <TableCell className="text-right text-sm">{o.patrols}</TableCell>
                        <TableCell className="text-right text-sm text-green-600">{o.scanned}</TableCell>
                        <TableCell className="text-right text-sm text-red-600">{o.missed}</TableCell>
                        <TableCell className="text-right text-sm">
                          <span className={o.missRate > 20 ? 'text-red-600 font-semibold' : o.missRate > 10 ? 'text-yellow-600' : 'text-green-600'}>
                            {o.missRate}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm text-orange-600">{o.breachesRaised}</TableCell>
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
