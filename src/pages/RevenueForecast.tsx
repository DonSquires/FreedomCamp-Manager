/**
 * RevenueForecast -- B-33
 *
 * Parking Revenue Forecasting Dashboard.
 *
 * Actual revenue section:
 *   1. Daily revenue bar chart (parking_payments, status='completed')
 *   2. Revenue by zone (horizontal bar)
 *   3. Payment provider split (pie-style legend)
 *   4. KPI cards: total collected, avg per day, top zone, payments count
 *
 * Forecast section (simple linear extrapolation):
 *   5. 30-day forward projection using last-30-day daily average
 *   6. Best/base/worst scenario bands (+/-20%)
 *
 * Filters: org (master), date range, zone picker.
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
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts'
import {
  TrendingUp,
  DollarSign,
  MapPin,
  BarChart2,
  CreditCard,
  Calendar,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import type { Database } from '@/types/database'

type PaymentRow = Pick<
  Database['public']['Tables']['parking_payments']['Row'],
  'id' | 'zone_id' | 'amount_nzd' | 'payment_provider' | 'status' | 'created_at'
>

type ZoneRow = Pick<Database['public']['Tables']['zones']['Row'], 'id' | 'name'>

function fmtNZD(v: number) {
  return `$${v.toFixed(2)}`
}

function toNZDateStr(iso: string) {
  return new Date(iso).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland', month: 'short', day: 'numeric' })
}

export default function RevenueForecast() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  // Default: last 30 days
  const defaultDateFrom = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  }, [])
  const defaultDateTo = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(defaultDateTo)
  const [filterZoneId, setFilterZoneId] = useState('__all__')

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: payments = [] } = useQuery<PaymentRow[]>({
    queryKey: ['revenue-payments', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await supabase
        .from('parking_payments')
        .select('id, zone_id, amount_nzd, payment_provider, status, created_at')
        .eq('organization_id', orgId)
        .eq('status', 'completed')
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .order('created_at')
      return (data ?? []) as PaymentRow[]
    },
    enabled: !!orgId,
  })

  const { data: zones = [] } = useQuery<ZoneRow[]>({
    queryKey: ['zones-revenue', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name')
      return (data ?? []) as ZoneRow[]
    },
    enabled: !!orgId,
  })

  // ── Derived data ──────────────────────────────────────────────────────────
  const filtered = useMemo(
    () => filterZoneId === '__all__' ? payments : payments.filter(p => p.zone_id === filterZoneId),
    [payments, filterZoneId]
  )

  // Daily revenue series
  const dailySeries = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of filtered) {
      const day = toNZDateStr(p.created_at)
      map.set(day, (map.get(day) ?? 0) + p.amount_nzd)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100 }))
  }, [filtered])

  // Revenue by zone
  const byZone = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of filtered) {
      const key = p.zone_id ?? 'Unknown'
      map.set(key, (map.get(key) ?? 0) + p.amount_nzd)
    }
    return Array.from(map.entries())
      .map(([zoneId, revenue]) => ({
        zone: zones.find(z => z.id === zoneId)?.name ?? zoneId.slice(0, 8),
        revenue: Math.round(revenue * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [filtered, zones])

  // Provider split
  const byProvider = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>()
    for (const p of filtered) {
      const k = p.payment_provider || 'unknown'
      const cur = map.get(k) ?? { count: 0, total: 0 }
      map.set(k, { count: cur.count + 1, total: cur.total + p.amount_nzd })
    }
    return Array.from(map.entries()).map(([provider, v]) => ({ provider, ...v }))
  }, [filtered])

  // KPIs
  const totalRevenue = useMemo(() => filtered.reduce((s, p) => s + p.amount_nzd, 0), [filtered])
  const dayCount = Math.max(1, dailySeries.length)
  const avgPerDay = totalRevenue / dayCount
  const topZone = byZone[0]?.zone ?? '—'

  // Forecast: simple 30-day linear projection based on recent daily average
  const forecastSeries = useMemo(() => {
    if (dailySeries.length === 0) return []
    const lookback = dailySeries.slice(-14) // last 14 days of actuals
    const avg = lookback.reduce((s, d) => s + d.revenue, 0) / Math.max(1, lookback.length)
    const series = []
    const today = new Date()
    for (let i = 1; i <= 30; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      const label = d.toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland', month: 'short', day: 'numeric' })
      series.push({
        date: label,
        base: Math.round(avg * 100) / 100,
        best: Math.round(avg * 1.2 * 100) / 100,
        worst: Math.round(avg * 0.8 * 100) / 100,
      })
    }
    return series
  }, [dailySeries])

  const projectedMonthly = forecastSeries.reduce((s, d) => s + d.base, 0)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Revenue Forecasting
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Parking payment actuals and 30-day forward projection
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-sm mt-1 w-36" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-sm mt-1 w-36" />
              </div>
              <div>
                <Label className="text-xs">Zone</Label>
                <Select value={filterZoneId} onValueChange={setFilterZoneId}>
                  <SelectTrigger className="h-8 text-sm mt-1 w-48">
                    <SelectValue placeholder="All zones" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All zones</SelectItem>
                    {zones.map(z => (
                      <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Collected', value: fmtNZD(totalRevenue), icon: DollarSign },
            { label: 'Avg / Day', value: fmtNZD(avgPerDay), icon: Calendar },
            { label: 'Top Zone', value: topZone, icon: MapPin },
            { label: 'Payments', value: String(filtered.length), icon: CreditCard },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <Icon className="h-8 w-8 text-muted-foreground opacity-40" />
                <div>
                  <p className="text-xl font-bold truncate max-w-[120px]" title={value}>{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Daily revenue chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart2 className="h-4 w-4" />
              Daily Revenue (NZD)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dailySeries.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">No completed payments in selected period</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dailySeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'Revenue']} />
                  <Bar dataKey="revenue" fill="#2563eb" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Revenue by zone */}
        {byZone.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Revenue by Zone (Top 10)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byZone} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="zone" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'Revenue']} />
                  <Bar dataKey="revenue" fill="#7c3aed" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Provider split */}
        {byProvider.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Payment Provider Split
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                {byProvider.map(p => (
                  <div key={p.provider} className="text-sm">
                    <p className="font-semibold capitalize">{p.provider}</p>
                    <p className="text-muted-foreground">{p.count} payments · {fmtNZD(p.total)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 30-day forecast */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              30-Day Revenue Projection
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                Base: {fmtNZD(projectedMonthly)} · Best: {fmtNZD(projectedMonthly * 1.2)} · Worst: {fmtNZD(projectedMonthly * 0.8)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {forecastSeries.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">Not enough data to generate forecast</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={forecastSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`]} />
                  <Legend />
                  <Area type="monotone" dataKey="best" stroke="#16a34a" fill="#dcfce7" strokeDasharray="4 2" name="Best (+20%)" />
                  <Area type="monotone" dataKey="base" stroke="#2563eb" fill="#dbeafe" name="Base" />
                  <Area type="monotone" dataKey="worst" stroke="#dc2626" fill="#fee2e2" strokeDasharray="4 2" name="Worst (-20%)" />
                  <ReferenceLine y={0} stroke="#6b7280" />
                </AreaChart>
              </ResponsiveContainer>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Projection based on average daily revenue from last 14 days of the selected period. For indicative purposes only.
            </p>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  )
}
