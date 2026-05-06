/**
 * OccupancyAnalytics — B-25
 *
 * Occupancy Analytics Dashboard.
 * Combines freedom-camping zone observations (obs count by day/zone)
 * and parking session data (session dwell by zone/hour) into
 * recharts visualisations.
 *
 * Charts:
 *   1. Daily observation count over selected period (bar chart)
 *   2. Top-10 most-observed zones (horizontal bar)
 *   3. Breach rate over time (line chart)
 *   4. Parking: avg dwell by day of week (bar chart)
 *   5. Parking: sessions per zone (horizontal bar)
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts'
import {
  BarChart2,
  TrendingUp,
  MapPin,
  ParkingSquare,
  AlertTriangle,
} from 'lucide-react'
import { format, subDays, eachDayOfInterval, parseISO, getDay } from 'date-fns'
import { nzNow } from '@/lib/timezone'

// ─── Date helpers ─────────────────────────────────────────────────────────────

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Component ────────────────────────────────────────────────────────────────

export default function OccupancyAnalytics() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  const today     = format(nzNow(), 'yyyy-MM-dd')
  const thirtyAgo = format(subDays(nzNow(), 30), 'yyyy-MM-dd')

  const [dateFrom, setDateFrom] = useState(thirtyAgo)
  const [dateTo, setDateTo]     = useState(today)
  const [rangePreset, setRangePreset] = useState('30')

  function applyPreset(days: string) {
    setRangePreset(days)
    const d = parseInt(days, 10)
    if (!isNaN(d)) {
      setDateFrom(format(subDays(nzNow(), d), 'yyyy-MM-dd'))
      setDateTo(format(nzNow(), 'yyyy-MM-dd'))
    }
  }

  // ── Freedom camping observations query ────────────────────────────────────
  const { data: obsRaw = [] } = useQuery({
    queryKey: ['occ-obs', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await supabase
        .from('observations')
        .select('recorded_at, zone_id, zone_name_at_import, is_breach')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .gte('recorded_at', `${dateFrom}T00:00:00`)
        .lte('recorded_at', `${dateTo}T23:59:59`)
        .limit(5000)
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Parking sessions query ─────────────────────────────────────────────────
  const { data: parkRaw = [] } = useQuery({
    queryKey: ['occ-park', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await supabase
        .from('parking_sessions')
        .select('entry_time, exit_time, parking_zone_id, dwell_minutes')
        .eq('organization_id', orgId)
        .gte('entry_time', `${dateFrom}T00:00:00`)
        .lte('entry_time', `${dateTo}T23:59:59`)
        .limit(5000)
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Chart 1: Daily obs count ───────────────────────────────────────────────
  const dailyObs = useMemo(() => {
    if (!obsRaw.length) return []
    const from = parseISO(dateFrom)
    const to   = parseISO(dateTo)
    const days = eachDayOfInterval({ start: from, end: to })
    const byDay: Record<string, { total: number; breaches: number }> = {}
    days.forEach(d => { byDay[format(d, 'yyyy-MM-dd')] = { total: 0, breaches: 0 } })
    obsRaw.forEach((o: any) => {
      const key = format(parseISO(o.recorded_at), 'yyyy-MM-dd')
      if (byDay[key]) {
        byDay[key].total++
        if (o.is_breach) byDay[key].breaches++
      }
    })
    return Object.entries(byDay).map(([date, v]) => ({
      date: format(parseISO(date), 'd MMM'),
      Observations: v.total,
      Breaches: v.breaches,
    }))
  }, [obsRaw, dateFrom, dateTo])

  // ── Chart 2: Top zones by obs count ───────────────────────────────────────
  const topZones = useMemo(() => {
    const counts: Record<string, number> = {}
    obsRaw.forEach((o: any) => {
      const label = o.zone_name_at_import ?? o.zone_id ?? 'Unknown'
      counts[label] = (counts[label] ?? 0) + 1
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([zone, count]) => ({ zone: zone.length > 22 ? zone.slice(0, 22) + '…' : zone, count }))
  }, [obsRaw])

  // ── Chart 3: Breach rate by day ────────────────────────────────────────────
  const breachRateSeries = useMemo(() => {
    return dailyObs.map(d => ({
      date: d.date,
      'Breach Rate %': d.Observations > 0 ? Math.round((d.Breaches / d.Observations) * 100) : 0,
    }))
  }, [dailyObs])

  // ── Chart 4: Parking avg dwell by day of week ─────────────────────────────
  const dwellByDow = useMemo(() => {
    const byDow: Record<number, number[]> = {}
    DOW_LABELS.forEach((_, i) => { byDow[i] = [] })
    parkRaw.forEach((s: any) => {
      if (s.dwell_minutes != null) {
        const dow = getDay(parseISO(s.entry_time))
        byDow[dow].push(s.dwell_minutes)
      }
    })
    return DOW_LABELS.map((label, i) => ({
      day: label,
      'Avg Dwell (min)': byDow[i].length
        ? Math.round(byDow[i].reduce((a, b) => a + b, 0) / byDow[i].length)
        : 0,
    }))
  }, [parkRaw])

  // ── Chart 5: Parking sessions per zone ────────────────────────────────────
  const parkByZone = useMemo(() => {
    const counts: Record<string, number> = {}
    parkRaw.forEach((s: any) => {
      const key = s.parking_zone_id ?? 'Unzoned'
      counts[key] = (counts[key] ?? 0) + 1
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([zone, count]) => ({
        zone: zone.length > 16 ? zone.slice(0, 16) + '…' : zone,
        Sessions: count,
      }))
  }, [parkRaw])

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalObs      = obsRaw.length
  const totalBreaches = obsRaw.filter((o: any) => o.is_breach).length
  const totalPark     = parkRaw.length
  const avgDwell      = parkRaw.length
    ? Math.round((parkRaw as any[]).filter(s => s.dwell_minutes != null)
        .reduce((a: number, s: any) => a + (s.dwell_minutes ?? 0), 0) /
        Math.max(1, (parkRaw as any[]).filter(s => s.dwell_minutes != null).length))
    : 0

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-primary" />
            Occupancy Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Freedom camping zone occupancy and parking session trends
          </p>
        </div>

        {/* Date controls */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs mb-1 block">Preset</Label>
                <Select value={rangePreset} onValueChange={applyPreset}>
                  <SelectTrigger className="w-32 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="14">Last 14 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">From</Label>
                <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setRangePreset('custom') }} className="w-36 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">To</Label>
                <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setRangePreset('custom') }} className="w-36 h-8 text-sm" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <MapPin className="h-3 w-3" /> FC Observations
              </p>
              <p className="text-2xl font-bold">{totalObs.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-orange-500" /> Breaches
              </p>
              <p className="text-2xl font-bold text-orange-600">{totalBreaches.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <ParkingSquare className="h-3 w-3" /> Parking Sessions
              </p>
              <p className="text-2xl font-bold">{totalPark.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> Avg Dwell
              </p>
              <p className="text-2xl font-bold">{avgDwell} <span className="text-sm font-normal text-muted-foreground">min</span></p>
            </CardContent>
          </Card>
        </div>

        {/* Charts grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Daily observations */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                Daily Freedom Camping Observations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dailyObs.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data for selected period</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={dailyObs} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Observations" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Breaches" fill="#f97316" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Top zones */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" />
                Top 10 Zones by Observations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topZones.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No zone data</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={topZones} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="zone" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[0, 2, 2, 0]} name="Observations" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Breach rate trend */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-orange-500" />
                Breach Rate Trend (%)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {breachRateSeries.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={breachRateSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                    <Tooltip formatter={(v: any) => `${v}%`} />
                    <Line
                      type="monotone"
                      dataKey="Breach Rate %"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Parking dwell by day of week */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-base flex items-center gap-2">
                <ParkingSquare className="h-4 w-4 text-blue-500" />
                Parking — Avg Dwell by Day of Week
              </CardTitle>
            </CardHeader>
            <CardContent>
              {parkRaw.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No parking session data</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dwellByDow} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit=" min" />
                    <Tooltip formatter={(v: any) => `${v} min`} />
                    <Bar dataKey="Avg Dwell (min)" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Parking sessions per zone */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-base flex items-center gap-2">
                <ParkingSquare className="h-4 w-4 text-blue-500" />
                Parking Sessions by Zone
              </CardTitle>
            </CardHeader>
            <CardContent>
              {parkByZone.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No parking zone data</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={parkByZone} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="zone" tick={{ fontSize: 11 }} width={90} />
                    <Tooltip />
                    <Bar dataKey="Sessions" fill="#0ea5e9" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}
