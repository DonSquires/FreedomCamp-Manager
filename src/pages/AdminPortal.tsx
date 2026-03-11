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

  const effectiveOrganizationId =
    user?.role === 'master' ? organizationId || null : user?.organization_id || null

  const startDate = dateFrom ? `${dateFrom}T00:00:00Z` : null
  const endDate = dateTo ? `${dateTo}T23:59:59Z` : null

  const { data, isLoading } = useQuery({
    queryKey: ['admin-primary-dashboard', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let obsQuery = (supabase.from('observations') as any)
        .select('plate_number, is_compliant, recorded_at, zone_id, organization_id')
        .order('recorded_at', { ascending: true })
        .limit(5000)

      if (effectiveOrganizationId) {
        obsQuery = obsQuery.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        obsQuery = obsQuery.eq('zone_id', zoneId)
      }
      if (startDate) {
        obsQuery = obsQuery.gte('recorded_at', startDate)
      }
      if (endDate) {
        obsQuery = obsQuery.lte('recorded_at', endDate)
      }

      const { data: observations, error: obsError } = await obsQuery
      if (obsError) throw obsError

      let breachesQuery = (supabase.from('breach_alerts') as any)
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'acknowledged', 'enforcement_started'])

      if (effectiveOrganizationId) {
        breachesQuery = breachesQuery.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        breachesQuery = breachesQuery.eq('zone_id', zoneId)
      }
      if (startDate) {
        breachesQuery = breachesQuery.gte('created_at', startDate)
      }
      if (endDate) {
        breachesQuery = breachesQuery.lte('created_at', endDate)
      }

      const { count: activeBreaches, error: breachError } = await breachesQuery
      if (breachError) throw breachError

      return {
        observations: observations ?? [],
        activeBreaches: activeBreaches ?? 0,
      }
    },
  })

  const metrics = useMemo(() => {
    const observations = data?.observations ?? []
    const totalObservations = observations.length
    const compliant = observations.filter((o: any) => o.is_compliant).length
    const complianceRate = totalObservations > 0 ? Math.round((compliant / totalObservations) * 100) : 0
    const activeVehicles = new Set(
      observations.map((o: any) => String(o.plate_number || '').trim()).filter(Boolean)
    ).size

    const byDate = new globalThis.Map<string, { compliant: number; breaches: number; total: number }>()
    observations.forEach((o: any) => {
      const key = new Date(o.recorded_at).toISOString().slice(0, 10)
      const current = byDate.get(key) || { compliant: 0, breaches: 0, total: 0 }
      current.total += 1
      if (o.is_compliant) current.compliant += 1
      else current.breaches += 1
      byDate.set(key, current)
    })

    const trendData: TrendDataPoint[] = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, value]) => ({ date, ...value }))

    return {
      totalObservations,
      complianceRate,
      activeVehicles,
      activeBreaches: data?.activeBreaches ?? 0,
      trendData,
    }
  }, [data])

  const periodLabel = useMemo(() => {
    if (!dateFrom || !dateTo) return '30d'
    const start = new Date(`${dateFrom}T00:00:00Z`).getTime()
    const end = new Date(`${dateTo}T23:59:59Z`).getTime()
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1)
    return `${days}d`
  }, [dateFrom, dateTo])

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
      title: 'Active Breaches',
      value: isLoading ? '...' : metrics.activeBreaches,
      icon: AlertTriangle,
      iconBg: 'bg-red-100 dark:bg-red-900/40',
      iconColor: 'text-red-600 dark:text-red-400',
      accentColor: 'from-red-500 to-red-600',
      config: { to: '/breaches', metric: 'active_breaches', period: periodLabel, status: 'pending', label: 'Active Breaches KPI' },
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
  ]

  return (
    <AppLayout
      title="Primary Operations Dashboard"
      description={user?.role === 'master' ? 'BI command view across organizations' : 'BI command view for your organization'}
    >
      <GlobalFilterRibbon />

      <div className="space-y-6">
        {/* KPI Cards */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
