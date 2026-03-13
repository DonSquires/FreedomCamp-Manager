import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { ComplianceTrendChart, type TrendDataPoint } from '@/components/features/ComplianceTrendChart'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { HOMELESS_UI_STATUSES } from '@/lib/homelessStatus'
import { toast } from 'sonner'
import { 
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bookmark,
  Car,
  Clock3,
  Eye,
  Gavel,
  Layers,
  Map,
  Pin,
  Radio,
  Shield,
  Star,
  Users,
} from 'lucide-react'

type DrillConfig = {
  to: string
  metric: string
  period: string
  tab?: string
  status?: string
  label?: string
}

type SavedView = {
  id: string
  name: string
  to: string
  params: Record<string, string>
  createdAt: string
}

type ObservationSummaryRow = {
  total_observations: number
  compliant_count: number
  breach_count: number
  unique_vehicles: number
  unique_zones: number
}

const SAVED_VIEWS_KEY = 'admin-dashboard-saved-views-v1'

const QUICK_BOOKMARKS: Array<{ name: string; to: string; params: Record<string, string> }> = [
  { name: 'Breach Triage', to: '/breaches', params: { metric: 'active_breaches', status: 'pending' } },
  { name: 'Zone Performance', to: '/compliance', params: { metric: 'zone_compliance', tab: 'zones' } },
  { name: 'Homeless Review', to: '/compliance', params: { metric: 'homeless_status', tab: 'homeless' } },
  { name: 'Vehicle Exceptions', to: '/vehicles', params: { metric: 'active_vehicles', status: 'homeless' } },
]

function readSavedViews(): SavedView[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default function AdminPortal() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const navigate = useNavigate()
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => readSavedViews())
  const [recentDrilldowns, setRecentDrilldowns] = useState<Array<{ label: string; at: string }>>([])
  const [lastZeroToastKey, setLastZeroToastKey] = useState<string | null>(null)

  const effectiveOrganizationId =
    user?.role === 'master' ? organizationId || null : user?.organization_id || null

  const normalizeFilterDate = (value: string | null): string | null => {
    if (!value) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    const slash = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (slash) {
      const [, dd, mm, yyyy] = slash
      return `${yyyy}-${mm}-${dd}`
    }
    return null
  }

  const normalizedDateFrom = normalizeFilterDate(dateFrom)
  const normalizedDateTo = normalizeFilterDate(dateTo)

  const startDate = normalizedDateFrom ? nzDateToUTCStart(normalizedDateFrom) : null
  const endDate = normalizedDateTo ? nzDateToUTCEnd(normalizedDateTo) : null

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-primary-dashboard', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const diagnostics: string[] = []

      // ── Helper: apply org / zone / date filters to any query ──────────────
      const applyFilters = (q: any) => {
        if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
        if (zoneId)                  q = q.eq('zone_id', zoneId)
        if (startDate)               q = q.gte('recorded_at', startDate)
        if (endDate)                 q = q.lte('recorded_at', endDate)
        return q
      }

      // ── 1. Total observations (accurate server-side COUNT, no row cap) ────
      const { count: totalObservations, error: totalErr } = await applyFilters(
        supabase.from('observations').select('*', { count: 'exact', head: true })
      )
      if (totalErr) diagnostics.push(`observations_total: ${totalErr.message || 'unknown error'}`)

      // ── 2. Compliant observations count ──────────────────────────────────
      const { count: compliantCount, error: compliantErr } = await applyFilters(
        supabase.from('observations').select('*', { count: 'exact', head: true }).eq('is_compliant', true)
      )
      if (compliantErr) diagnostics.push(`observations_compliant: ${compliantErr.message || 'unknown error'}`)

      // ── 3. Active vehicles — unique plates in the date range ─────────────
      // get_observation_summary returns COUNT(DISTINCT plate_number) server-side.
      // When no date is set, use a wide sentinel range so the RPC returns all-time data.
      let activeVehicles = 0
      const rpcFrom = normalizedDateFrom ?? '1970-01-01'
      const rpcTo   = normalizedDateTo   ?? new Date().toISOString().slice(0, 10)
      const { data: summaryRows, error: summaryErr } = await (supabase.rpc as any)(
        'get_observation_summary',
        {
          p_start_date: rpcFrom,
          p_end_date: rpcTo,
          p_organization_id: effectiveOrganizationId ?? null,
          p_zone_id: zoneId ?? null,
        },
      )
      if (!summaryErr && summaryRows && summaryRows[0]) {
        activeVehicles = Number(summaryRows[0].unique_vehicles) || 0
      } else {
        // Fallback when RPC is unavailable in schema cache: count distinct plates directly.
        // We page through results to avoid row limits while still keeping an exact count.
        const uniquePlates = new Set<string>()
        const pageSize = 1000
        let offset = 0

        while (true) {
          let vehicleQuery = supabase
            .from('observations')
            .select('plate_number')
            .not('plate_number', 'is', null)
            .order('recorded_at', { ascending: false })
            .range(offset, offset + pageSize - 1)

          if (effectiveOrganizationId) vehicleQuery = vehicleQuery.eq('organization_id', effectiveOrganizationId)
          if (zoneId) vehicleQuery = vehicleQuery.eq('zone_id', zoneId)
          if (startDate) vehicleQuery = vehicleQuery.gte('recorded_at', startDate)
          if (endDate) vehicleQuery = vehicleQuery.lte('recorded_at', endDate)

          const { data: vehicleRows, error: vehicleErr } = await vehicleQuery
          if (vehicleErr) {
            diagnostics.push(`active_vehicles_fallback: ${vehicleErr.message || 'unknown error'}`)
            break
          }

          const rows = vehicleRows ?? []
          rows.forEach((r: any) => {
            if (r?.plate_number) uniquePlates.add(String(r.plate_number).trim().toUpperCase())
          })

          if (rows.length < pageSize) break
          offset += pageSize
        }

        activeVehicles = uniquePlates.size
      }

      // ── 4. Trend data rows (for the chart only — limited fetch is fine) ──
      const trendRows: Array<{ plate_number: string | null; is_compliant: boolean | null; recorded_at: string }> = []
      const trendPageSize = 1000
      const trendMaxRows = 100000
      let trendOffset = 0

      while (trendOffset < trendMaxRows) {
        const trendPageQuery = applyFilters(
          supabase
            .from('observations')
            .select('plate_number, is_compliant, recorded_at')
            .order('recorded_at', { ascending: true })
            .range(trendOffset, trendOffset + trendPageSize - 1)
        )

        const { data: trendPageRows, error: trendErr } = await trendPageQuery
        if (trendErr) {
          diagnostics.push(`observations_trend: ${trendErr.message || 'unknown error'}`)
          break
        }

        const rows = (trendPageRows ?? []) as Array<{ plate_number: string | null; is_compliant: boolean | null; recorded_at: string }>
        trendRows.push(...rows)

        if (rows.length < trendPageSize) break
        trendOffset += trendPageSize
      }

      if (trendRows.length >= trendMaxRows) {
        diagnostics.push(`observations_trend: capped at ${trendMaxRows} rows for dashboard performance`)
      }

      const homelessPlates = new Set<string>()
      {
        let homelessQuery = (supabase.from('homeless_records') as any)
          .select('plate_number, status')
          .eq('is_active', true)
          .in('status', HOMELESS_UI_STATUSES)

        if (effectiveOrganizationId) {
          homelessQuery = homelessQuery.eq('organization_id', effectiveOrganizationId)
        }

        const { data: homelessRows, error: homelessErr } = await homelessQuery
        if (homelessErr) {
          diagnostics.push(`homeless_records_trend: ${homelessErr.message || 'unknown error'}`)
        } else {
          ;(homelessRows ?? []).forEach((row: any) => {
            const plate = String(row?.plate_number ?? '').trim().toUpperCase()
            if (plate) homelessPlates.add(plate)
          })
        }
      }

      {
        const { data: canonicalHomelessRows, error: canonicalHomelessErr } = await (supabase.from('canonical_vehicles') as any)
          .select('plate_number, homeless_status')
          .in('homeless_status', HOMELESS_UI_STATUSES)

        if (canonicalHomelessErr) {
          diagnostics.push(`canonical_homeless_trend: ${canonicalHomelessErr.message || 'unknown error'}`)
        } else {
          ;(canonicalHomelessRows ?? []).forEach((row: any) => {
            const plate = String(row?.plate_number ?? '').trim().toUpperCase()
            if (plate) homelessPlates.add(plate)
          })
        }
      }

      // ── 5. Active breaches (COUNT, filtered by date range + active status) ─
      let breachesQuery = (supabase.from('breach_alerts') as any)
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'acknowledged', 'enforcement_started'])

      if (effectiveOrganizationId) breachesQuery = breachesQuery.eq('organization_id', effectiveOrganizationId)
      if (zoneId)                  breachesQuery = breachesQuery.eq('zone_id', zoneId)
      if (startDate)               breachesQuery = breachesQuery.gte('created_at', startDate)
      if (endDate)                 breachesQuery = breachesQuery.lte('created_at', endDate)

      const { count: activeBreaches, error: breachError } = await breachesQuery
      if (breachError) diagnostics.push(`breach_alerts_active: ${breachError.message || 'unknown error'}`)

      return {
        totalObservations: totalObservations ?? 0,
        compliantCount:    compliantCount    ?? 0,
        activeVehicles,
        trendRows,
        homelessPlates: Array.from(homelessPlates),
        activeBreaches:    activeBreaches    ?? 0,
        diagnostics,
      }
    },
  })

  const metrics = useMemo(() => {
    const totalObservations = data?.totalObservations ?? 0
    const compliant         = data?.compliantCount    ?? 0
    const complianceRate    = totalObservations > 0
      ? Math.round((compliant / totalObservations) * 100)
      : 0
    const activeVehicles    = data?.activeVehicles ?? 0

    const toNzDayKey = (isoDateTime: string) =>
      new Date(isoDateTime).toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })

    // Build trend data from filtered observation rows.
    const homelessPlateSet = new Set<string>((data as any)?.homelessPlates ?? [])
    const byDate = new globalThis.Map<string, { compliant: number; breaches: number; homeless: number; total: number }>()
    ;(data?.trendRows ?? []).forEach((o: any) => {
      const key = toNzDayKey(o.recorded_at)
      const current = byDate.get(key) || { compliant: 0, breaches: 0, homeless: 0, total: 0 }
      current.total += 1
      if (o.is_compliant) current.compliant += 1
      else current.breaches += 1
      const plate = String(o.plate_number ?? '').trim().toUpperCase()
      if (plate && homelessPlateSet.has(plate)) current.homeless += 1
      byDate.set(key, current)
    })

    let trendData: TrendDataPoint[] = []

    if (normalizedDateFrom && normalizedDateTo) {
      const start = new Date(nzDateToUTCStart(normalizedDateFrom))
      const end = new Date(nzDateToUTCStart(normalizedDateTo))

      for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const key = cursor.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
        const value = byDate.get(key) || { compliant: 0, breaches: 0, homeless: 0, total: 0 }
        trendData.push({ date: key, ...value })
      }
    } else {
      trendData = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-30)
        .map(([date, value]) => ({ date, ...value }))
    }

    const totalBreaches = totalObservations - compliant
    const homelessVehicleCount = data?.homelessPlates?.length ?? 0

    return {
      totalObservations,
      complianceRate,
      activeVehicles,
      activeBreaches: data?.activeBreaches ?? 0,
      totalBreaches,
      homelessVehicleCount,
      trendData,
    }
  }, [data, normalizedDateFrom, normalizedDateTo])

  const periodLabel = useMemo(() => {
    if (!dateFrom || !dateTo) return '30d'
    const start = new Date(nzDateToUTCStart(dateFrom)).getTime()
    const end = new Date(nzDateToUTCEnd(dateTo)).getTime()
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1)
    return `${days}d`
  }, [dateFrom, dateTo])

  useEffect(() => {
    if (isError) {
      toast.error('Dashboard KPI query failed', {
        description: (error as any)?.message || 'Unknown query error. Check diagnostics panel.',
        duration: 10000,
      })
      return
    }

    if (isLoading || !data) return

    const totalObservations = data.totalObservations ?? 0
    const activeBreaches = data.activeBreaches ?? 0
    const activeVehicles = data.activeVehicles ?? 0
    const hasDiagnostics = Array.isArray((data as any).diagnostics) && (data as any).diagnostics.length > 0
    const hasScopedFilters = Boolean(effectiveOrganizationId || zoneId || normalizedDateFrom || normalizedDateTo)

    // Warn once per filter key when a scoped query returns all-zero KPIs.
    if (hasScopedFilters && totalObservations === 0 && activeBreaches === 0 && activeVehicles === 0) {
      const key = [effectiveOrganizationId ?? 'all-orgs', zoneId ?? 'all-zones', normalizedDateFrom ?? 'no-from', normalizedDateTo ?? 'no-to'].join('|')
      if (key !== lastZeroToastKey) {
        toast.warning('Dashboard returned zero results for the selected filters', {
          description: hasDiagnostics
            ? 'Open the diagnostics panel on this page for exact query errors.'
            : 'Try Clear All, then re-apply filters. If this persists, it may be an access-policy scope issue.',
          duration: 8000,
        })
        setLastZeroToastKey(key)
      }
    }
  }, [
    data,
    isError,
    error,
    isLoading,
    effectiveOrganizationId,
    zoneId,
    normalizedDateFrom,
    normalizedDateTo,
    lastZeroToastKey,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews.slice(0, 12)))
  }, [savedViews])

  const buildQueryParams = useCallback(
    (config: DrillConfig, extras?: Record<string, string>) => {
      const params = new URLSearchParams({
        source: 'primary_dashboard',
        metric: config.metric,
        period: config.period,
      })

      if (config.tab) params.set('tab', config.tab)
      if (config.status) params.set('status', config.status)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (effectiveOrganizationId) params.set('orgId', effectiveOrganizationId)
      if (zoneId) params.set('zoneId', zoneId)

      Object.entries(extras ?? {}).forEach(([key, value]) => {
        if (value) params.set(key, value)
      })

      return params
    },
    [dateFrom, dateTo, effectiveOrganizationId, zoneId]
  )

  const openDrilldown = useCallback(
    (config: DrillConfig, extras?: Record<string, string>) => {
      const params = buildQueryParams(config, extras)
      navigate(`${config.to}?${params.toString()}`)
      setRecentDrilldowns((prev) => [{ label: config.label || config.metric, at: new Date().toISOString() }, ...prev].slice(0, 5))
    },
    [buildQueryParams, navigate]
  )

  const saveView = useCallback(
    (name: string, config: DrillConfig, extras?: Record<string, string>) => {
      const params = Object.fromEntries(buildQueryParams(config, extras).entries())
      const next: SavedView = {
        id: `${Date.now()}`,
        name,
        to: config.to,
        params,
        createdAt: new Date().toISOString(),
      }
      setSavedViews((prev) => [next, ...prev].slice(0, 12))
    },
    [buildQueryParams]
  )

  const openSavedView = useCallback(
    (to: string, params: Record<string, string>) => {
      const q = new URLSearchParams(params)
      navigate(`${to}?${q.toString()}`)
    },
    [navigate]
  )

  const drilldowns = [
    {
      title: 'Manual Recalculation',
      description: 'Run targeted compliance recalculation jobs with audit tracking.',
      to: '/compliance-recalculation',
      icon: Shield,
      metric: 'Admin utility',
      config: { to: '/compliance-recalculation', metric: 'manual_recalculation', period: periodLabel, label: 'Manual Recalculation' },
    },
    {
      title: 'Compliance Analysis',
      description: 'Dive into trends, exemptions and by-zone compliance performance.',
      to: '/compliance',
      icon: Shield,
      metric: `${metrics.complianceRate}% compliant`,
      config: { to: '/compliance', metric: 'compliance_rate', period: periodLabel, tab: 'overview', label: 'Compliance Analysis' },
    },
    {
      title: 'Breach Command',
      description: 'Investigate active breaches and progress enforcement outcomes.',
      to: '/breaches',
      icon: AlertTriangle,
      metric: `${metrics.activeBreaches} active`,
      config: { to: '/breaches', metric: 'active_breaches', period: periodLabel, status: 'pending', label: 'Breach Command' },
    },
    {
      title: 'Live Patrol & Welfare',
      description: 'Track patrol movement and officer safety in near real-time.',
      to: '/live-patrol',
      icon: Radio,
      metric: 'Live operations',
      config: { to: '/live-patrol', metric: 'live_patrol', period: periodLabel, label: 'Live Patrol and Welfare' },
    },
    {
      title: 'Vehicle Intelligence',
      description: 'Inspect fleet activity, homeless status, and repeat offenders.',
      to: '/vehicles',
      icon: Car,
      metric: `${metrics.activeVehicles} active vehicles`,
      config: { to: '/vehicles', metric: 'active_vehicles', period: periodLabel, status: 'all', label: 'Vehicle Intelligence' },
    },
    {
      title: 'Zone & Spatial Performance',
      description: 'Assess hotspot pressure and zone-level policy effectiveness.',
      to: '/hotspots',
      icon: Map,
      metric: 'Spatial heatmap',
      config: { to: '/hotspots', metric: 'zone_heatmap', period: periodLabel, label: 'Zone and Spatial Performance' },
    },
    {
      title: 'Enforcement Pipeline',
      description: 'Move from review to notices and infringements with full audit trace.',
      to: '/enforcement-command-center',
      icon: Gavel,
      metric: 'Workflow view',
      config: { to: '/enforcement-command-center', metric: 'enforcement_pipeline', period: periodLabel, label: 'Enforcement Pipeline' },
    },
  ]

  const kpiDrilldowns: Array<{
    title: string
    value: string | number
    config: DrillConfig
    icon: React.FC<{ className?: string }>
    iconBg: string
    iconColor: string
    accentColor: string
  }> = [
    {
      title: 'Observations',
      value: isLoading ? '...' : metrics.totalObservations,
      icon: Eye,
      iconBg: 'bg-blue-100 dark:bg-blue-900/40',
      iconColor: 'text-blue-600 dark:text-blue-400',
      accentColor: 'from-blue-500 to-blue-600',
      config: { to: '/compliance', metric: 'observations', period: periodLabel, tab: 'overview', label: 'Observations KPI' },
    },
    {
      title: 'Compliance Rate',
      value: isLoading ? '...' : `${metrics.complianceRate}%`,
      icon: Shield,
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      accentColor: 'from-emerald-500 to-emerald-600',
      config: { to: '/compliance', metric: 'compliance_rate', period: periodLabel, tab: 'zones', label: 'Compliance Rate KPI' },
    },
    {
      title: 'Total Breaches',
      value: isLoading ? '...' : metrics.totalBreaches,
      icon: AlertTriangle,
      iconBg: 'bg-red-100 dark:bg-red-900/40',
      iconColor: 'text-red-600 dark:text-red-400',
      accentColor: 'from-red-500 to-red-600',
      config: { to: '/compliance', metric: 'active_breaches', period: periodLabel, tab: 'breaches', label: 'Total Breaches KPI' },
    },
    {
      title: 'Active Vehicles',
      value: isLoading ? '...' : metrics.activeVehicles,
      icon: Car,
      iconBg: 'bg-violet-100 dark:bg-violet-900/40',
      iconColor: 'text-violet-600 dark:text-violet-400',
      accentColor: 'from-violet-500 to-violet-600',
      config: { to: '/vehicles', metric: 'active_vehicles', period: periodLabel, status: 'all', label: 'Active Vehicles KPI' },
    },
    {
      title: 'Homeless Vehicles',
      value: isLoading ? '...' : metrics.homelessVehicleCount,
      icon: Users,
      iconBg: 'bg-orange-100 dark:bg-orange-900/40',
      iconColor: 'text-orange-600 dark:text-orange-400',
      accentColor: 'from-orange-500 to-orange-600',
      config: { to: '/compliance', metric: 'homeless_status', period: periodLabel, tab: 'homeless', label: 'Homeless Vehicles KPI' },
    },
  ]

  return (
    <AppLayout
      title="Primary Operations Dashboard"
      description={user?.role === 'master' ? 'BI command view across organisations' : 'BI command view for your organisation'}
    >
      <GlobalFilterRibbon />

      <div className="space-y-6">
        {/* KPI Cards */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {kpiDrilldowns.map((kpi) => {
            const Icon = kpi.icon
            return (
              <Card
                key={kpi.title}
                className="cursor-pointer overflow-hidden group"
                onClick={() => openDrilldown(kpi.config)}
              >
                {/* Color accent bar at top */}
                <div className={`h-1 w-full bg-gradient-to-r ${kpi.accentColor}`} />
                <CardHeader className="pb-2 pt-4">
                  <CardDescription className="flex items-center justify-between text-xs font-medium uppercase tracking-wide">
                    {kpi.title}
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </CardDescription>
                  <div className="flex items-end justify-between mt-1">
                    <CardTitle className="text-4xl font-bold tracking-tight">{kpi.value}</CardTitle>
                    <div className={`rounded-xl p-2.5 ${kpi.iconBg}`}>
                      <Icon className={`h-5 w-5 ${kpi.iconColor}`} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 pb-3">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      saveView(`KPI: ${kpi.title}`, kpi.config)
                    }}
                  >
                    Save View
                  </button>
                </CardContent>
              </Card>
            )
          })}
        </section>

        <Card className="border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Dashboard Query Context</CardTitle>
            <CardDescription>
              Use this to verify active org/date filters and query status.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 text-xs space-y-1 text-slate-700 dark:text-slate-300">
            <div>org_id: {effectiveOrganizationId ?? 'all'}</div>
            <div>zone_id: {zoneId ?? 'all'}</div>
            <div>date_from(raw): {dateFrom ?? 'null'}</div>
            <div>date_to(raw): {dateTo ?? 'null'}</div>
            <div>date_from(normalized): {normalizedDateFrom ?? 'null'}</div>
            <div>date_to(normalized): {normalizedDateTo ?? 'null'}</div>
            <div>query_state: {isLoading ? 'loading' : isError ? 'error' : 'ok'}</div>
            {isError && <div>query_error: {(error as any)?.message || 'unknown'}</div>}
          </CardContent>
        </Card>

        {Array.isArray((data as any)?.diagnostics) && (data as any).diagnostics.length > 0 && (
          <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Dashboard Data Diagnostics</CardTitle>
              <CardDescription>
                Some KPI queries failed and may show partial/zero values.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-amber-900 dark:text-amber-200 space-y-1">
              {(data as any).diagnostics.map((d: string, idx: number) => (
                <div key={`${d}-${idx}`}>{d}</div>
              ))}
            </CardContent>
          </Card>
        )}

        <section className="grid gap-6 xl:grid-cols-[300px_1.4fr_1fr]">
          {/* Analysis Workspace */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bookmark className="h-4 w-4 text-blue-600" />
                Analysis Workspace
              </CardTitle>
              <CardDescription className="text-xs">Saved views and rapid bookmarks for drill-down workflows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">Quick Bookmarks</p>
                {QUICK_BOOKMARKS.map((item) => {
                  const config: DrillConfig = { to: item.to, metric: item.params.metric || 'bookmark', period: periodLabel, tab: item.params.tab, status: item.params.status, label: item.name }
                  return (
                    <button
                      key={item.name}
                      onClick={() => openDrilldown(config)}
                      className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-left text-sm hover:bg-muted hover:shadow-sm transition-all"
                    >
                      <span className="font-medium">{item.name}</span>
                      <Star className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    </button>
                  )
                })}
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">Saved Views</p>
                {savedViews.length === 0 && <p className="text-xs text-muted-foreground px-1">No saved views yet.</p>}
                {savedViews.map((view) => (
                  <button
                    key={view.id}
                    onClick={() => openSavedView(view.to, view.params)}
                    className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-left text-sm hover:bg-muted hover:shadow-sm transition-all"
                  >
                    <span className="truncate font-medium">{view.name}</span>
                    <Pin className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">Recent Drilldowns</p>
                {recentDrilldowns.length === 0 && <p className="text-xs text-muted-foreground px-1">No recent drilldowns in this session.</p>}
                {recentDrilldowns.map((item, idx) => (
                  <div key={`${item.label}-${idx}`} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs bg-muted/20">
                    <span className="truncate">{item.label}</span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground shrink-0 ml-2">
                      <Clock3 className="h-3 w-3" />
                      now
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <ComplianceTrendChart
            data={metrics.trendData}
            title="Compliance Performance"
            description="Rolling compliance vs breach signal for current filter scope"
          />

          {/* BI Drill-Down Lanes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-blue-600" />
                BI Drill-Down Lanes
              </CardTitle>
              <CardDescription className="text-xs">
                Start at macro KPIs, then jump into operational workflows.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {drilldowns.map(({ title, description, to, icon: Icon, metric, config }) => (
                <div
                  key={to}
                  className="group rounded-xl border bg-muted/20 hover:bg-muted/60 hover:shadow-sm transition-all duration-150 cursor-pointer"
                  onClick={() => openDrilldown(config)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrilldown(config) } }}
                >
                  <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">{title}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{description}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5 hidden group-hover:inline-flex">
                        {metric}
                      </Badge>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <Button
            variant="outline"
            onClick={() => openDrilldown({ to: '/compliance-recalculation', metric: 'manual_recalculation', period: periodLabel, label: 'Manual Recalculation' })}
            className="justify-between hover:shadow-sm transition-shadow"
          >
            Manual Recalculation <Shield className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => openDrilldown({ to: '/reports-hub', metric: 'reporting_workspace', period: periodLabel, label: 'Reporting Workspace' })}
            className="justify-between hover:shadow-sm transition-shadow"
          >
            Reporting Workspace <BarChart3 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => openDrilldown({ to: '/users', metric: 'team_access', period: periodLabel, label: 'Team and Access' })}
            className="justify-between hover:shadow-sm transition-shadow"
          >
            Team & Access <Users className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => openDrilldown({ to: '/enforcement-command-center', metric: 'enforcement_control', period: periodLabel, label: 'Enforcement Control' })}
            className="justify-between hover:shadow-sm transition-shadow"
          >
            Enforcement Control <Gavel className="h-4 w-4" />
          </Button>
        </section>
      </div>
    </AppLayout>
  )
}
