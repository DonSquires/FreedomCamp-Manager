import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { useBobBrain } from '@/hooks/useBobBrain'
import { emitAiTelemetry } from '@/lib/aiTelemetry'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { ListCardRow } from '@/components/features/ListCardRow'
import { ComplianceTrendChart, type TrendDataPoint } from '@/components/features/ComplianceTrendChart'
import { SystemHealthIndicator } from '@/components/features/SystemHealthIndicator'
import { nzDateToUTCStart, nzDateToUTCEnd, parseNZDate } from '@/lib/timezone'
import {
  useAdminActivePatrolCount,
  useAdminPrimaryDashboard,
  useAdminRecentHistoricalObservations,
  useAdminTodayRosterShifts,
  useAdminWelfareAlertCount,
  HOMELESS_EXEMPT_STATUSES,
} from '@/hooks/useAdminPortalData'
import { format } from 'date-fns'
import { HOMELESS_UI_STATUSES } from '@/lib/homelessStatus'

import { toast } from 'sonner'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Ban,
  BarChart3,
  Building2,
  CalendarCheck2,
  CalendarDays,
  Camera,
  Car,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Database,
  Eye,
  FileBarChart,
  FileText,
  FileWarning,
  Gavel,
  GraduationCap,
  Heart,
  Home,
  KeyRound,
  LayoutGrid,
  Lock,
  Map,
  MapPin,
  CalendarRange,
  ShieldCheck,
  Mic,
  Navigation,
  ParkingSquare,
  Package,
  PieChart,
  Printer,
  Radio,
  Receipt,
  ScanLine,
  ScrollText,
  Search,
  Shield,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  Volume2,
  Zap,
  AlertCircle,
  Package2,
  PhoneCall,
  Siren,
  BadgeDollarSign,
  Tent,
  Wrench,
  Route,
  ShieldAlert,
  Flame,
  HeartPulse,
  BadgeCheck,
  BellRing,
  Bug,
  CalendarClock,
  TicketX,
  UserX,
  Scale,
  PackageX,
  MessageSquare,
  BrainCircuit,
  Upload,
  RotateCcw,
  Table2,
  Briefcase,
  Bell,
  PersonStanding,
  MoreHorizontal,
} from 'lucide-react'

type DrillConfig = {
  to: string
  metric: string
  period: string
  tab?: string
  status?: string
  label?: string
}

type AdminTriageRisk = 'low' | 'medium' | 'high'

type AdminTriageSuggestion = {
  label: string
  route: string
  reason: string
  risk: AdminTriageRisk
}

// SCV enforcement date: NZ midnight 1 June 2026 (NZST, UTC+12).
// parseNZDate anchors the date to NZ timezone so the countdown is accurate
// for NZ operators regardless of the server/browser UTC offset.
const SCV_ENFORCEMENT_DATE = parseNZDate('2026-06-01')
const MS_PER_DAY = 1000 * 60 * 60 * 24

function scvEnforcementCountdown(): string {
  const days = Math.ceil((SCV_ENFORCEMENT_DATE.getTime() - Date.now()) / MS_PER_DAY)
  return days > 0 ? `${days}d` : 'Active'
}

function deriveAdminTriageConfidence(answer: string): 'high' | 'medium' | 'low' {
  const normalized = String(answer || '').toLowerCase()
  if (/uncertain|unknown|possibly|might|insufficient|not enough/.test(normalized)) return 'low'
  if (/critical|immediate|urgent|escalate now|must/.test(normalized)) return 'high'
  return 'medium'
}

function deriveAdminTriageSuggestion(params: {
  answer: string
  welfareAlertCount: number
  activeBreaches: number
  openDisputes: number
}): AdminTriageSuggestion | null {
  const normalized = String(params.answer || '').toLowerCase()

  if (params.welfareAlertCount > 0 || /welfare|officer safety|man down|panic/.test(normalized)) {
    return {
      label: 'Open welfare command',
      route: '/officer-welfare',
      reason: 'Officer safety signals detected in triage output',
      risk: 'high',
    }
  }

  if (params.activeBreaches > 0 || /breach|enforcement|notice|infringement/.test(normalized)) {
    return {
      label: 'Open breach command',
      route: '/breaches',
      reason: 'Active compliance risk needs enforcement review',
      risk: params.activeBreaches >= 10 ? 'high' : 'medium',
    }
  }

  if (params.openDisputes > 0 || /dispute|appeal|review queue/.test(normalized)) {
    return {
      label: 'Open dispute queue',
      route: '/disputes',
      reason: 'Triage indicates pending dispute workload',
      risk: 'medium',
    }
  }

  if (/patrol|dispatch|tracking|coverage/.test(normalized)) {
    return {
      label: 'Open live patrol monitor',
      route: '/live-patrol',
      reason: 'Triage recommends patrol posture review',
      risk: 'low',
    }
  }

  return null
}

export default function AdminPortal() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [lastZeroToastKey, setLastZeroToastKey] = useState<string | null>(null)
  const [adminTriagePrompt, setAdminTriagePrompt] = useState('')
  const [pendingTriageSuggestion, setPendingTriageSuggestion] = useState<AdminTriageSuggestion | null>(null)
  const {
    askBobBrain,
    clearResponse: clearTriageResponse,
    response: triageResponse,
    error: triageError,
    isLoading: isTriageLoading,
    completedAt: triageCompletedAt,
  } = useBobBrain()

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

  const { data, isLoading, isError, error } = useAdminPrimaryDashboard({
    organizationId: effectiveOrganizationId,
    zoneId,
    dateFrom,
    dateTo,
    startDate,
    endDate,
    normalizedDateFrom,
    normalizedDateTo,
  })

  useEffect(() => {
    const refreshDashboard = () => {
      queryClient.invalidateQueries({ queryKey: ['admin-primary-dashboard'] })
    }

    const onFocus = () => refreshDashboard()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshDashboard()
      }
    }

    refreshDashboard()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [queryClient, effectiveOrganizationId, zoneId, dateFrom, dateTo])

  const { data: recentHistoricalObservations = [] } = useAdminRecentHistoricalObservations({
    organizationId: effectiveOrganizationId,
    zoneId,
    startDate,
    endDate,
    enabled: !!effectiveOrganizationId,
  })

  // Welfare alerts — Welfare First inspired: surface officer safety issues immediately
  const { data: welfareAlertCount = 0 } = useAdminWelfareAlertCount(effectiveOrganizationId)

  // Active patrols today — Wilsar inspired: show guard tour progress
  const { data: activePatrolCount = 0 } = useAdminActivePatrolCount(effectiveOrganizationId)

  // Today's roster shifts — Deputy / InTime inspired: show who is on duty today
  const { data: todayRosterShifts = [] } = useAdminTodayRosterShifts(effectiveOrganizationId)

  const metrics = useMemo(() => {
    const totalObservations = data?.totalObservations ?? 0
    const compliant         = data?.compliantCount    ?? 0
    const activeVehicles    = data?.activeVehicles ?? 0

    const toNzDayKey = (isoDateTime: string) =>
      new Date(isoDateTime).toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })

    // Build trend data from filtered observation rows.
    // Homeless-confirmed/claimed vehicles are FC Act exempt – their non-compliant
    // observations must count as "homeless" (breach-exempt), NOT as breaches.
    const homelessPlateSet = new Set<string>((data as any)?.homelessPlates ?? [])
    const homelessExemptPlateSet = new Set<string>((data as any)?.homelessExemptPlates ?? [])
    let homelessExemptTotal = 0
    const byDate = new globalThis.Map<string, { compliant: number; breaches: number; homeless: number; total: number }>()
    ;(data?.trendRows ?? []).forEach((o: any) => {
      const key = toNzDayKey(o.recorded_at)
      const current = byDate.get(key) || { compliant: 0, breaches: 0, homeless: 0, total: 0 }
      current.total += 1
      const plate = String(o.plate_number ?? '').trim().toUpperCase()
      const isHomelessPlate = plate && homelessPlateSet.has(plate)
      const isHomelessExemptPlate = plate && homelessExemptPlateSet.has(plate)
      if (o.is_compliant) {
        current.compliant += 1
      } else if (isHomelessExemptPlate) {
        // Homeless vehicle – breach exempt under FC Act; do NOT count as breach
        current.homeless += 1
        homelessExemptTotal += 1
      } else {
        current.breaches += 1
      }
      byDate.set(key, current)
    })

    let trendData: TrendDataPoint[] = []

    // Helper: compute the per-day compliance rate using the same formula as the
    // KPI card – (genuinely compliant + homeless-exempt) / total – so the chart
    // tooltip and the summary footer always agree with the headline percentage.
    type DayMetrics = Pick<TrendDataPoint, 'compliant' | 'homeless' | 'total'>
    const dayRate = (v: DayMetrics) =>
      v.total > 0 ? Math.round(((v.compliant + (v.homeless ?? 0)) / v.total) * 100) : null

    if (normalizedDateFrom && normalizedDateTo) {
      const start = new Date(nzDateToUTCStart(normalizedDateFrom))
      const end = new Date(nzDateToUTCStart(normalizedDateTo))

      for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const key = cursor.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
        const value = byDate.get(key) || { compliant: 0, breaches: 0, homeless: 0, total: 0 }
        trendData.push({ date: key, ...value, compliance_rate: dayRate(value) })
      }
    } else {
      trendData = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-30)
        .map(([date, value]) => ({ date, ...value, compliance_rate: dayRate(value) }))
    }

    // Exclude homeless-exempt observations from breach count.
    // Prefer the precise server-side count; fall back to the trend-row tally
    // in case the new field hasn't loaded yet.
    const homelessExemptBreaches = data?.homelessExemptBreachCount ?? homelessExemptTotal
    const totalBreaches = Math.max(0, totalObservations - compliant - homelessExemptBreaches)
    const homelessVehicleCount = data?.homelessPlates?.length ?? 0

    // Adjust compliance rate: homeless-exempt observations are not breaches.
    const effectiveCompliant = compliant + homelessExemptBreaches
    const adjustedComplianceRate = totalObservations > 0
      ? Math.round((effectiveCompliant / totalObservations) * 100)
      : 0

    return {
      totalObservations,
      complianceRate: adjustedComplianceRate,
      activeVehicles,
      activeBreaches: data?.activeBreaches ?? 0,
      totalBreaches,
      homelessVehicleCount,
      homelessExemptBreaches,
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

  // RAG operational status — Rapid Global / Lighthouse IO inspired
  const ragStatus = useMemo((): 'green' | 'amber' | 'red' | 'loading' => {
    if (isLoading) return 'loading'
    if (welfareAlertCount > 0) return 'red'
    if (metrics.complianceRate >= 80 && metrics.activeBreaches < 5) return 'green'
    if (metrics.complianceRate >= 60 && metrics.activeBreaches <= 20) return 'amber'
    return 'red'
  }, [isLoading, metrics.complianceRate, metrics.activeBreaches, welfareAlertCount])

  const SERVICE_TYPE_LABELS: Record<string, string> = {
    freedom_camping: 'Freedom Camping',
    guarding: 'Guarding',
    parking: 'Parking',
    noise: 'Noise Control',
    patrol: 'Patrol',
    alarm_response: 'Alarm Response',
    ems: 'EMS',
  }

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
    },
    [buildQueryParams, navigate]
  )

  const openInfringementFromObservation = useCallback((observationId?: string | null) => {
    const id = String(observationId ?? '').trim()
    if (!id) {
      toast.error('Observation link missing. Opening infringements page instead.')
      navigate('/infringements')
      return
    }
    navigate(`/infringements?observation_id=${encodeURIComponent(id)}`)
  }, [navigate])

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
      title: 'Investigations',
      description: 'Manage assigned investigation jobs and progress them to completion.',
      to: '/investigations',
      icon: Search,
      metric: `${(data as any)?.activeInvestigations ?? 0} active jobs`,
      config: { to: '/investigations', metric: 'active_investigations', period: periodLabel, status: 'active', label: 'Investigations' },
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
    {
      title: 'Live Officer Tracking',
      description: 'See where every officer is in real time — H&S welfare overview.',
      to: '/live-tracking',
      icon: Navigation,
      metric: 'Officer H&S',
      config: { to: '/live-tracking', metric: 'officer_locations', period: periodLabel, label: 'Live Officer Tracking' },
    },
    {
      title: 'Patrol Schedule',
      description: 'Load, review and manage pre-scheduled and ad-hoc patrol routes.',
      to: '/patrol-schedule',
      icon: CalendarDays,
      metric: 'Scheduling',
      config: { to: '/patrol-schedule', metric: 'patrol_schedule', period: periodLabel, label: 'Patrol Schedule' },
    },
    {
      title: 'Patrol KPIs',
      description: 'Review patrol completion rates and KPIs for scheduled jobs.',
      to: '/patrol-kpis',
      icon: TrendingUp,
      metric: 'KPIs & completions',
      config: { to: '/patrol-kpis', metric: 'patrol_kpis', period: periodLabel, label: 'Patrol KPIs' },
    },
    {
      title: 'Observations',
      description: 'Review all officer observations — update details, check accuracy.',
      to: '/observation-records',
      icon: Eye,
      metric: `${metrics.totalObservations.toLocaleString()} in period`,
      config: { to: '/observation-records', metric: 'observations', period: periodLabel, label: 'Observations' },
    },
    {
      title: 'Homeless Register',
      description: 'Review and amend the homeless claims register for your organisation.',
      to: '/person-records',
      icon: Home,
      metric: `${metrics.homelessVehicleCount} recorded`,
      config: { to: '/person-records', metric: 'homeless_register', period: periodLabel, label: 'Homeless Register' },
    },
  ]

  // ── Primary KPIs: the "Big Three" for at-a-glance operational status ──
  const primaryKPIs: Array<{
    title: string
    value: string | number
    subtitle?: string
    config: DrillConfig
    icon: React.FC<{ className?: string }>
    iconBg: string
    iconColor: string
    accentColor: string
  }> = [
    {
      title: 'Active Breaches',
      value: isLoading ? '...' : metrics.activeBreaches,
      subtitle: isLoading ? undefined : `${metrics.totalBreaches} total in period`,
      icon: AlertTriangle,
      iconBg: 'bg-red-100 dark:bg-red-900/40',
      iconColor: 'text-red-600 dark:text-red-400',
      accentColor: 'from-red-500 to-red-600',
      config: { to: '/breaches', metric: 'active_breaches', period: periodLabel, status: 'pending', label: 'Active Breaches' },
    },
    {
      title: 'Compliance Rate',
      value: isLoading ? '...' : `${metrics.complianceRate}%`,
      subtitle: isLoading ? undefined : `${metrics.totalObservations.toLocaleString()} observations`,
      icon: Shield,
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      accentColor: 'from-emerald-500 to-emerald-600',
      config: { to: '/compliance', metric: 'compliance_rate', period: periodLabel, tab: 'zones', label: 'Compliance Rate' },
    },
    {
      title: 'Active Vehicles',
      value: isLoading ? '...' : metrics.activeVehicles,
      subtitle: isLoading ? undefined : `${metrics.homelessVehicleCount} homeless-flagged`,
      icon: Car,
      iconBg: 'bg-blue-100 dark:bg-blue-900/40',
      iconColor: 'text-blue-600 dark:text-blue-400',
      accentColor: 'from-blue-500 to-blue-600',
      config: { to: '/vehicles', metric: 'active_vehicles', period: periodLabel, status: 'all', label: 'Active Vehicles' },
    },
  ]

  // ── Secondary KPIs: supplementary metrics shown with reduced weight ──
  const secondaryKPIs: Array<{
    title: string
    value: string | number
    config: DrillConfig
    icon: React.FC<{ className?: string }>
    iconColor: string
  }> = [
    {
      title: 'Observations',
      value: isLoading ? '...' : metrics.totalObservations.toLocaleString(),
      icon: Eye,
      iconColor: 'text-blue-500',
      config: { to: '/compliance', metric: 'observations', period: periodLabel, tab: 'overview', label: 'Observations' },
    },
    {
      title: 'Exempt Breaches',
      value: isLoading ? '...' : metrics.homelessExemptBreaches,
      icon: Home,
      iconColor: 'text-purple-500',
      config: { to: '/compliance', metric: 'homeless_status', period: periodLabel, tab: 'homeless', label: 'Exempt Breaches' },
    },
    {
      title: 'Homeless Vehicles',
      value: isLoading ? '...' : metrics.homelessVehicleCount,
      icon: Users,
      iconColor: 'text-orange-500',
      config: { to: '/compliance', metric: 'homeless_status', period: periodLabel, tab: 'homeless', label: 'Homeless Vehicles' },
    },
    {
      title: 'Open Disputes',
      value: isLoading ? '...' : (data?.openDisputeIntake ?? 0),
      icon: AlertTriangle,
      iconColor: 'text-red-500',
      config: { to: '/disputes', metric: 'open_disputes', period: periodLabel, label: 'Open Disputes' },
    },
    {
      title: 'Pending Discrepancies',
      value: isLoading ? '...' : (data?.discrepanciesPending ?? 0),
      icon: AlertTriangle,
      iconColor: 'text-amber-500',
      config: { to: '/admin/discrepancies', metric: 'discrepancies_pending', period: periodLabel, label: 'Pending Discrepancies' },
    },
    {
      title: 'SCV Expiring (30d)',
      value: isLoading ? '...' : (data?.scvExpiringSoon ?? 0),
      icon: Shield,
      iconColor: 'text-blue-500',
      config: { to: '/admin/nzscv', metric: 'scv_expiring_soon', period: periodLabel, label: 'SCV Expiring Soon' },
    },
    {
      title: 'SCV Enforcement',
      value: scvEnforcementCountdown(),
      icon: CalendarDays,
      iconColor: 'text-green-600',
      config: { to: '/admin/nzscv', metric: 'scv_enforcement_countdown', period: periodLabel, label: 'SCV Enforcement Countdown' },
    },
    {
      title: 'Active Trespass Notices',
      value: isLoading ? '...' : ((data as any)?.activeTrespassCount ?? 0),
      icon: Ban,
      iconColor: 'text-rose-600',
      config: { to: '/trespass-notices', metric: 'active_trespass_notices', period: periodLabel, label: 'Active Trespass Notices' },
    },
    {
      title: 'Radio Transmissions Today',
      value: isLoading ? '...' : ((data as any)?.radioTransmissionsToday ?? 0),
      icon: Mic,
      iconColor: 'text-cyan-600',
      config: { to: '/radio-transmissions', metric: 'radio_transmissions_today', period: periodLabel, label: 'Radio Transmissions Today' },
    },
  ]

  const moduleTileClass =
    'relative min-h-20 flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2.5 text-center border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
  const moduleTileCompactClass =
    'min-h-20 flex flex-col items-center justify-center gap-0.5 rounded-lg border p-2.5 text-center border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
  const moduleTileLabelClass = 'text-xs font-medium text-gray-700 dark:text-gray-300 leading-tight'
  const quickActionRowClass =
    'flex w-full items-center justify-between rounded-lg border border-white/60 dark:border-white/10 bg-white/70 dark:bg-slate-800/50 px-3 py-2.5 text-left hover:bg-white dark:hover:bg-slate-800 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
  const listRowClass =
    'flex items-center justify-between gap-3 rounded-lg border border-white/60 dark:border-white/10 bg-white/70 dark:bg-slate-800/50 px-3 py-2.5'

  const openDisputesCount = Number(data?.openDisputeIntake ?? 0)

  const triageQuickPrompts = useMemo(() => {
    if (welfareAlertCount > 0) {
      return [
        'Prioritize current welfare and officer-safety actions for the next 30 minutes.',
        'Generate an immediate safety triage sequence for active patrol supervisors.',
      ]
    }

    if (metrics.activeBreaches > 0) {
      return [
        'Summarize enforcement triage priorities for current active breaches.',
        'Recommend the top 3 operational actions for compliance risk reduction today.',
      ]
    }

    return [
      'Provide a concise admin triage summary and the next three actions.',
      'Assess operational risks from dashboard metrics and suggest response order.',
    ]
  }, [metrics.activeBreaches, welfareAlertCount])

  const domainTriagePrompts = useMemo(() => ([
    {
      key: 'freedom_camping',
      label: 'Freedom Camping',
      prompt: 'Run triage for freedom camping operations with top risk areas, enforcement queue priorities, and immediate supervisor actions.',
    },
    {
      key: 'biosecurity',
      label: 'Biosecurity',
      prompt: 'Run triage for biosecurity operations with containment priorities, escalation triggers, and evidence requirements.',
    },
    {
      key: 'noise',
      label: 'Noise Control',
      prompt: 'Run triage for noise-control workload with priority incidents, officer deployment guidance, and compliance risks.',
    },
    {
      key: 'smoke',
      label: 'Smoke Control',
      prompt: 'Run triage for smoke-control complaints with immediate public-safety priorities and recommended enforcement sequence.',
    },
    {
      key: 'parking',
      label: 'Parking',
      prompt: 'Run triage for parking enforcement with hotspots, infringement queue priorities, and dispute-risk indicators.',
    },
  ]), [])

  const triageConfidence = useMemo(() => {
    if (!triageResponse?.answer) return null
    return deriveAdminTriageConfidence(triageResponse.answer)
  }, [triageResponse?.answer])

  const runAdminTriage = useCallback(async (promptOverride?: string) => {
    const prompt = String(promptOverride ?? adminTriagePrompt).trim()
    if (!prompt) {
      toast.warning('Enter a triage prompt first')
      return
    }

    const startedAt = Date.now()
    emitAiTelemetry({
      surface: 'admin-triage',
      stage: 'request',
      success: true,
      details: {
        active_breaches: metrics.activeBreaches,
        welfare_alerts: welfareAlertCount,
      },
    })

    const contextPrompt = [
      'You are an admin operations triage assistant for NZ field operations.',
      'Return concise triage priorities with clear human-review checkpoints.',
      `Organization: ${effectiveOrganizationId ?? 'all visible orgs'}`,
      `Compliance rate: ${metrics.complianceRate}%`,
      `Active breaches: ${metrics.activeBreaches}`,
      `Welfare alerts: ${welfareAlertCount}`,
      `Active patrols: ${activePatrolCount}`,
      `Open disputes: ${openDisputesCount}`,
      `Admin request: ${prompt}`,
    ].join('\n')

    const result = await askBobBrain({
      prompt: contextPrompt,
      organizationId: effectiveOrganizationId,
    })

    emitAiTelemetry({
      surface: 'admin-triage',
      stage: 'response',
      success: !!result?.answer,
      latency_ms: Date.now() - startedAt,
      reason: result?.answer ? undefined : 'empty-answer',
    })

    if (!result?.answer) return

    const suggestion = deriveAdminTriageSuggestion({
      answer: result.answer,
      welfareAlertCount,
      activeBreaches: metrics.activeBreaches,
      openDisputes: openDisputesCount,
    })
    if (suggestion) {
      emitAiTelemetry({
        surface: 'admin-triage',
        stage: 'action_suggested',
        success: true,
        details: {
          action: suggestion.label,
          route: suggestion.route,
          risk: suggestion.risk,
        },
      })
    }
    setPendingTriageSuggestion(suggestion)
  }, [
    activePatrolCount,
    adminTriagePrompt,
    askBobBrain,
    effectiveOrganizationId,
    metrics.activeBreaches,
    metrics.complianceRate,
    openDisputesCount,
    welfareAlertCount,
  ])

  const applyTriageSuggestion = useCallback(() => {
    if (!pendingTriageSuggestion) return
    emitAiTelemetry({
      surface: 'admin-triage',
      stage: 'action_applied',
      success: true,
      details: {
        action: pendingTriageSuggestion.label,
        route: pendingTriageSuggestion.route,
      },
    })
    navigate(pendingTriageSuggestion.route)
    toast.success(`Opened ${pendingTriageSuggestion.label}`)
    setPendingTriageSuggestion(null)
  }, [navigate, pendingTriageSuggestion])

  if (isError) {
    return (
      <AppLayout
        title="Command Centre"
        description="Dashboard KPI query failed"
      >
        <div className="max-w-2xl mx-auto mt-16 px-4">
          <Card className="border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20">
            <CardHeader>
              <CardTitle className="text-red-800 dark:text-red-200 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Dashboard failed to load
              </CardTitle>
              <CardDescription className="text-red-700 dark:text-red-300">
                {(error as any)?.message ?? 'KPI query returned an unexpected error. Try refreshing.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-primary-dashboard'] })}>
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    )
  }

  if (isLoading && !data) {
    return (
      <AppLayout
        title="Command Centre"
        description="Loading…"
      >
        <div className="space-y-4 p-4">
          <Skeleton className="h-14 w-full rounded-xl" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Command Centre"
      description={user?.role === 'master' ? 'All systems · All organisations' : `All systems · ${user?.full_name ?? user?.email ?? ''}`}
    >
      <GlobalFilterRibbon />

      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-foreground">Priority actions</span>
          <span className="text-muted-foreground">·</span>
          <span className={`font-medium ${metrics.activeBreaches > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
            {metrics.activeBreaches} active breach{metrics.activeBreaches === 1 ? '' : 'es'}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className={`font-medium ${welfareAlertCount > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
            {welfareAlertCount} welfare alert{welfareAlertCount === 1 ? '' : 's'}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="font-medium text-muted-foreground">
            {activePatrolCount} active patrol{activePatrolCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/** One primary CTA only: Welfare takes precedence when alerts exist, otherwise Breaches. */}
          {(() => {
            const primaryAction = welfareAlertCount > 0 ? 'welfare' : 'breaches'
            return (
              <>
          <Button
            size="sm"
            variant={primaryAction === 'breaches' ? 'default' : 'outline'}
            className="gap-1.5"
            onClick={() => navigate('/breaches')}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Breaches
          </Button>
          <Button
            size="sm"
            variant={primaryAction === 'welfare' ? 'default' : 'outline'}
            className="gap-1.5"
            onClick={() => navigate('/officer-welfare')}
          >
            <Heart className="h-3.5 w-3.5" />
            Welfare
          </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                      More
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-48 p-2">
                    <div className="flex flex-col gap-1">
                      <Button size="sm" variant="ghost" className="justify-start gap-2" onClick={() => navigate('/dispatch')}>
                        <Radio className="h-3.5 w-3.5" />
                        Dispatch
                      </Button>
                      <Button size="sm" variant="ghost" className="justify-start gap-2" onClick={() => navigate('/reports-hub')}>
                        <FileBarChart className="h-3.5 w-3.5" />
                        Reports
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </>
            )
          })()}
        </div>
      </div>

      <div className="space-y-4">

        {/* ── Scope model strip ───────────────────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Operational Scope Model</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[11px]">Zone-based: Parking, Freedom Camping</Badge>
            <Badge variant="outline" className="text-[11px]">Jurisdiction-wide: Noise, Smoke, Biosecurity</Badge>
            <Badge variant="outline" className="text-[11px]">Client/Site driven: ID Verification</Badge>
          </div>
        </div>

        {/* ── RAG OPERATIONAL STATUS BANNER — Rapid Global / Lighthouse IO inspired ── */}
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
          ragStatus === 'green' ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-700'
          : ragStatus === 'amber' ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700'
          : ragStatus === 'red'   ? 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-700'
          : 'bg-gray-50 dark:bg-[#1E1E1E] border-gray-200 dark:border-[#9E9E9E]/20'
        }`}>
          <div className={`h-3 w-3 rounded-full shrink-0 ${
            ragStatus === 'green' ? 'bg-emerald-500'
            : ragStatus === 'amber' ? 'bg-amber-500'
            : ragStatus === 'red'   ? 'bg-red-500 animate-pulse'
            : 'bg-gray-400'
          }`} />
          <div className="flex-1 min-w-0">
            <span className={`text-sm font-semibold ${
              ragStatus === 'green' ? 'text-emerald-800 dark:text-emerald-200'
              : ragStatus === 'amber' ? 'text-amber-800 dark:text-amber-200'
              : ragStatus === 'red'   ? 'text-red-800 dark:text-red-200'
              : 'text-gray-700 dark:text-gray-300'
            }`}>
              {ragStatus === 'green' ? 'Operations Normal'
              : ragStatus === 'amber' ? 'Attention Required'
              : ragStatus === 'red'   ? 'Immediate Action Required'
              : 'Loading operational status…'}
            </span>
            {!isLoading && (
              <span className="text-xs text-muted-foreground ml-2">
                {ragStatus === 'green' && `Compliance ${metrics.complianceRate}% · No critical issues`}
                {ragStatus === 'amber' && `Compliance ${metrics.complianceRate}% · ${metrics.activeBreaches} active breaches — review required`}
                {ragStatus === 'red'   && `${welfareAlertCount > 0 ? `${welfareAlertCount} welfare alert${welfareAlertCount > 1 ? 's' : ''} · ` : ''}Compliance ${metrics.complianceRate}% · ${metrics.activeBreaches} breaches`}
              </span>
            )}
          </div>
          {welfareAlertCount > 0 && (
            <button
              onClick={() => navigate('/officer-welfare')}
              className="min-h-10 flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              <Heart className="h-3.5 w-3.5" />
              {welfareAlertCount} Welfare Alert{welfareAlertCount > 1 ? 's' : ''}
            </button>
          )}
        </div>

        <Card className="border-violet-200 dark:border-violet-900/60 bg-violet-50/60 dark:bg-violet-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-violet-600" />
              Admin AI Triage
            </CardTitle>
            <CardDescription>
              AI-assisted triage summary with explicit operator-controlled action routing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="border-violet-300 text-violet-700 dark:text-violet-300">
                Assistive only
              </Badge>
              {triageConfidence && (
                <Badge
                  variant="outline"
                  className={
                    triageConfidence === 'high'
                      ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
                      : triageConfidence === 'medium'
                        ? 'border-amber-300 text-amber-700 dark:text-amber-300'
                        : 'border-rose-300 text-rose-700 dark:text-rose-300'
                  }
                >
                  Confidence: {triageConfidence}
                </Badge>
              )}
              {pendingTriageSuggestion && (
                <Badge
                  variant="outline"
                  className={
                    pendingTriageSuggestion.risk === 'high'
                      ? 'border-rose-300 text-rose-700 dark:text-rose-300'
                      : pendingTriageSuggestion.risk === 'medium'
                        ? 'border-amber-300 text-amber-700 dark:text-amber-300'
                        : 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
                  }
                >
                  Suggested risk: {pendingTriageSuggestion.risk}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {triageQuickPrompts.map((prompt) => (
                <Button
                  key={prompt}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAdminTriagePrompt(prompt)
                    void runAdminTriage(prompt)
                  }}
                  disabled={isTriageLoading}
                >
                  {prompt.length > 50 ? `${prompt.slice(0, 50)}...` : prompt}
                </Button>
              ))}
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Domain triage lanes</p>
              <div className="flex flex-wrap gap-2">
                {domainTriagePrompts.map((domainPrompt) => (
                  <Button
                    key={domainPrompt.key}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAdminTriagePrompt(domainPrompt.prompt)
                      void runAdminTriage(domainPrompt.prompt)
                    }}
                    disabled={isTriageLoading}
                  >
                    {domainPrompt.label}
                  </Button>
                ))}
              </div>
            </div>

            <Textarea
              value={adminTriagePrompt}
              onChange={(event) => setAdminTriagePrompt(event.target.value)}
              placeholder="Ask for triage priorities, risk review, or action sequencing..."
              rows={3}
            />

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void runAdminTriage()} disabled={isTriageLoading}>
                {isTriageLoading ? (
                  <>
                    <RotateCcw className="h-4 w-4 mr-1.5 animate-spin" />
                    Triage running...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    Run triage
                  </>
                )}
              </Button>

              {(triageResponse || triageError) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    clearTriageResponse()
                    setPendingTriageSuggestion(null)
                  }}
                  disabled={isTriageLoading}
                >
                  Clear
                </Button>
              )}
            </div>

            {triageError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                {triageError}
              </div>
            )}

            {triageResponse?.answer && (
              <div className="rounded-lg border border-violet-200 bg-white/80 dark:border-violet-900 dark:bg-slate-950/40 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <p className="text-xs text-muted-foreground">
                    Triage result {triageCompletedAt ? `· ${format(new Date(triageCompletedAt), 'dd MMM yyyy HH:mm')}` : ''}
                  </p>
                  {triageResponse.provider && (
                    <Badge variant="outline" className="border-violet-300 text-violet-700 dark:text-violet-300">
                      Provider: {triageResponse.provider}
                    </Badge>
                  )}
                  {triageResponse.model && (
                    <Badge variant="outline" className="border-blue-300 text-blue-700 dark:text-blue-300">
                      Model: {triageResponse.model}
                    </Badge>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap text-foreground">{triageResponse.answer}</p>
              </div>
            )}

            {pendingTriageSuggestion && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300">
                    Suggested next action
                  </Badge>
                  <span className="text-muted-foreground">{pendingTriageSuggestion.reason}</span>
                </div>
                <p className="text-sm font-medium text-foreground">{pendingTriageSuggestion.label}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={applyTriageSuggestion}>
                    Open recommended queue
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      emitAiTelemetry({
                        surface: 'admin-triage',
                        stage: 'action_dismissed',
                        success: true,
                        details: {
                          action: pendingTriageSuggestion.label,
                          route: pendingTriageSuggestion.route,
                        },
                      })
                      setPendingTriageSuggestion(null)
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── LIVE OPS STATUS BAR — 5 key real-time metrics ───────────────────────── */}
        <section
          aria-label="Live operations status"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 lg:gap-3"
        >
          {[
            { label: 'Active Officers', value: (data as any)?.activeOfficers ?? 0, Icon: UserCheck, colorClass: 'text-cyan-700 dark:text-cyan-400', bgClass: 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800', path: '/live-tracking' },
            { label: 'Checks Today', value: (data as any)?.checksToday ?? 0, Icon: ClipboardCheck, colorClass: 'text-blue-700 dark:text-blue-400', bgClass: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', path: null },
            { label: 'Active Patrols', value: activePatrolCount, Icon: Navigation, colorClass: 'text-green-700 dark:text-green-400', bgClass: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', path: '/live-patrol' },
            { label: 'Infringements Today', value: (data as any)?.infringementsIssued ?? 0, Icon: Gavel, colorClass: 'text-red-700 dark:text-red-400', bgClass: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', path: '/infringements' },
            { label: 'Disputes Pending', value: (data as any)?.disputesPending ?? 0, Icon: FileWarning, colorClass: 'text-amber-700 dark:text-amber-400', bgClass: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', path: '/disputes' },
          ].map(({ label, value, Icon, colorClass, bgClass, path }) => (
            <button
              key={label}
              onClick={() => path && navigate(path)}
              disabled={!path}
              aria-label={`${label}: ${isLoading ? 'loading' : value}`}
              className={`min-h-[4.25rem] flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${bgClass} ${path ? 'cursor-pointer hover:shadow-sm active:scale-[0.98]' : 'cursor-default'}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${colorClass}`} />
              <div className="min-w-0">
                <p className={`text-xl font-bold leading-tight tracking-tight ${colorClass}`}>{isLoading ? '—' : value}</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{label}</p>
              </div>
            </button>
          ))}
        </section>

        {/* ── SYSTEM HEALTH ────────────────────────────────────────────────────────── */}
        <details className="group">
          <summary className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors list-none mb-2 select-none">
            <span className="font-medium">System Health</span>
            <span className="text-[10px] text-gray-400 group-open:hidden">(click to expand)</span>
          </summary>
          <SystemHealthIndicator />
        </details>

        {/* ── PRIMARY KPIs — Big Three ──────────────────────────────────────────────── */}
        <section aria-label="Primary operational KPIs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {primaryKPIs.map((kpi) => {
            const Icon = kpi.icon
            return (
              <Card
                key={kpi.title}
                role="button"
                tabIndex={0}
                aria-label={`${kpi.title}: ${kpi.value}`}
                className="cursor-pointer overflow-hidden group border border-white/60 dark:border-white/10 bg-white/85 dark:bg-slate-900/70 backdrop-blur-sm shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                onClick={() => openDrilldown(kpi.config)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openDrilldown(kpi.config)
                  }
                }}
              >
                <div className={`h-1 w-full bg-gradient-to-r ${kpi.accentColor}`} />
                <CardHeader className="pb-2.5 pt-4">
                  <CardDescription className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {kpi.title}
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </CardDescription>
                  <div className="flex items-end justify-between mt-1">
                    <CardTitle className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 dark:text-white">{kpi.value}</CardTitle>
                    <div className={`rounded-xl p-2.5 shadow-sm ring-1 ring-black/10 ${kpi.iconBg}`}>
                      <Icon className={`h-5 w-5 ${kpi.iconColor}`} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 pb-3.5">
                  {kpi.subtitle && (
                    <p className="inline-flex rounded-md border border-white/70 dark:border-white/10 bg-white/70 dark:bg-black/20 px-2 py-1 text-[11px] text-muted-foreground leading-tight">
                      {kpi.subtitle}
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </section>

        {/* ── SECONDARY KPIs — attention items ─────────────────────────────────────── */}
        <section aria-label="Secondary operational KPIs" className="grid gap-2.5 grid-cols-2 sm:grid-cols-4 xl:grid-cols-9">
          {secondaryKPIs.map((kpi) => {
            const Icon = kpi.icon
            return (
              <button
                key={kpi.title}
                onClick={() => openDrilldown(kpi.config)}
                aria-label={`${kpi.title}: ${kpi.value}`}
                className="min-h-[3.75rem] flex items-center gap-2.5 rounded-lg border border-white/60 dark:border-white/10 bg-white/85 dark:bg-slate-900/70 px-3.5 py-2.5 text-left hover:bg-white dark:hover:bg-slate-900 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <Icon className={`h-4 w-4 shrink-0 ${kpi.iconColor}`} />
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">{kpi.value}</p>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground truncate mt-0.5">{kpi.title}</p>
                </div>
              </button>
            )
          })}
        </section>

        {/* ── TODAY'S ROSTER — Deputy / InTime Rostering inspired ──────────────────── */}
        {todayRosterShifts.length > 0 && (
          <section>
            <Card className="bg-white dark:bg-[#1A1A1A] shadow-sm overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-violet-600" />
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <CalendarCheck2 className="h-4 w-4 text-indigo-600" />
                    Today's Roster
                    <Badge variant="secondary" className="text-xs ml-1">{format(new Date(), 'EEE d MMM')}</Badge>
                  </span>
                  <button
                    onClick={() => navigate('/roster')}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Full Roster <ArrowRight className="h-3 w-3 ml-0.5" />
                  </button>
                </CardTitle>
                <CardDescription className="text-xs">Officers rostered on for today — {todayRosterShifts.length} shift{todayRosterShifts.length > 1 ? 's' : ''} scheduled</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {todayRosterShifts.map((shift: any) => {
                    const officer = Array.isArray(shift.officer) ? (shift.officer.length > 0 ? shift.officer[0] : null) : shift.officer
                    const officerName = officer ? `${officer.first_name ?? ''} ${officer.last_name ?? ''}`.trim() || 'Unassigned' : 'Unassigned'
                    const startTime = shift.start_time ? shift.start_time.slice(0, 5) : '—'
                    const endTime = shift.end_time ? shift.end_time.slice(0, 5) : '—'
                    const serviceLabel = SERVICE_TYPE_LABELS[shift.service_type] ?? shift.position_title ?? 'Shift'
                    const isActive = shift.status === 'in_progress'
                    return (
                      <div
                        key={shift.id}
                        className={`min-h-20 rounded-lg border p-3 text-sm ${
                          isActive
                            ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/20'
                            : 'border-gray-200 dark:border-[#9E9E9E]/20 bg-gray-50 dark:bg-[#1E1E1E]/40'
                        }`}
                      >
                        <ListCardRow
                          className="mb-1 gap-1.5 rounded-none bg-transparent p-0 text-xs"
                          left={(
                            <>
                              {isActive && <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />}
                              <span className="truncate font-medium text-xs">{officerName}</span>
                            </>
                          )}
                        />
                        <ListCardRow
                          className="gap-1.5 rounded-none bg-transparent p-0 text-xs"
                          left={<span className="text-xs text-muted-foreground">{startTime} – {endTime}</span>}
                          right={<span className="truncate text-xs text-muted-foreground">{serviceLabel}</span>}
                        />
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── ALL SYSTEMS HUB — integrated navigation grid ─────────────────────────── */}
        <section>
          <Card className="bg-white dark:bg-[#1A1A1A] shadow-sm overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-slate-400 to-slate-600" />
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <LayoutGrid className="h-4 w-4 text-gray-500" />
                All Systems
              </CardTitle>
              <CardDescription className="text-xs">Every operational module — click any tile to navigate</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">

              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">
                  Module groups are organised by operational function. Specialist services include scope context to reduce cross-jurisdiction mistakes.
                </p>
              </div>

              {/* Compliance & Enforcement */}
              <div className="rounded-xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/40 dark:bg-blue-950/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <BarChart3 className="h-3 w-3 text-blue-500" /> Compliance & Enforcement
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                  {[
                    { path: '/compliance',                 label: 'Compliance',       Icon: BarChart3,     color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/breaches',                   label: 'Breaches',         Icon: AlertTriangle, color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20',    badge: metrics.activeBreaches > 0 ? metrics.activeBreaches : undefined },
                    { path: '/enforcement-command-center', label: 'Command Centre',   Icon: Gavel,         color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/enforcement-review',         label: 'Review',           Icon: ClipboardCheck,color: 'text-teal-600',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/enforcement-events-log',     label: 'Event Log',        Icon: Siren,         color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/trespass-notices-log',       label: 'Trespass Log',     Icon: Ban,            color: 'text-rose-700',   bg: 'bg-rose-50 dark:bg-rose-900/20' },
                    { path: '/parking-infringements-log',  label: 'Infringement Log', Icon: TicketX,        color: 'text-orange-700', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/disputes',                   label: 'Disputes',         Icon: FileWarning,   color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20', badge: (data as any)?.openDisputeIntake > 0 ? (data as any)?.openDisputeIntake : undefined },
                    { path: '/infringements',              label: 'Infringements',    Icon: Receipt,       color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/breach-notices',             label: 'Breach Notices',   Icon: ScrollText,    color: 'text-rose-600',   bg: 'bg-rose-50 dark:bg-rose-900/20' },
                    { path: '/notice-to-vacate',           label: 'Notice to Vacate', Icon: FileText,      color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                    { path: '/compliance-analytics',       label: 'Analytics',        Icon: PieChart,      color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/compliance-audit-log',       label: 'Audit Log',        Icon: BadgeCheck,    color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                    { path: '/spatial-compliance',         label: 'Spatial',          Icon: Map,           color: 'text-cyan-600',   bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                  ].map(({ path, label, Icon, color, bg, badge }) => (
                    <button key={path} onClick={() => navigate(path)} aria-label={`Open ${label}`} className={`${moduleTileClass} ${bg}`}>
                      {badge !== undefined && (
                        <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>
                      )}
                      <Icon className={`h-5 w-5 ${color}`} />
                      <span className={moduleTileLabelClass}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Patrol & Officers */}
              <div className="rounded-xl border border-green-100 dark:border-green-900/40 bg-green-50/40 dark:bg-green-950/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Navigation className="h-3 w-3 text-green-500" /> Patrol & Officers
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                  {[
                    { path: '/live-patrol',        label: 'Live Patrol',     Icon: Activity,      color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20',   badge: activePatrolCount > 0 ? activePatrolCount : undefined },
                    { path: '/live-tracking',      label: 'Officer Tracking',Icon: Navigation,    color: 'text-cyan-600',   bg: 'bg-cyan-50 dark:bg-cyan-900/20',     badge: (data as any)?.activeOfficers > 0 ? (data as any)?.activeOfficers : undefined },
                    { path: '/officer-welfare',    label: 'Welfare',         Icon: Heart,         color: 'text-pink-600',   bg: 'bg-pink-50 dark:bg-pink-900/20',     badge: welfareAlertCount > 0 ? welfareAlertCount : undefined },
                    { path: '/patrol-schedule',    label: 'Schedule',        Icon: CalendarDays,  color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/patrol-kpis',        label: 'Patrol KPIs',     Icon: TrendingUp,    color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/patrol-checkpoints', label: 'Checkpoints',     Icon: ScanLine,      color: 'text-teal-600',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/patrol-events',      label: 'Event Log',       Icon: Route,         color: 'text-slate-600',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
                    { path: '/patrol-route-log',   label: 'Route Log',       Icon: Navigation,    color: 'text-teal-600',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/alarm-events-log',       label: 'Alarm Events',     Icon: BellRing,   color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/checkpoint-visits-log',  label: 'Checkpoint Visits',Icon: ScanLine,   color: 'text-teal-700',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/ems-attendances-log',    label: 'EMS Attendances',  Icon: HeartPulse, color: 'text-rose-600',   bg: 'bg-rose-50 dark:bg-rose-900/20' },
                    { path: '/officer-activity-log',  label: 'Officer Activity', Icon: Activity,   color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/officer-performance',label: 'Performance',     Icon: UserCheck,     color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                  ].map(({ path, label, Icon, color, bg, badge }) => (
                    <button key={path} onClick={() => navigate(path)} aria-label={`Open ${label}`} className={`${moduleTileClass} ${bg}`}>
                      {badge !== undefined && (
                        <span className={`absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full ${path === '/officer-welfare' ? 'bg-red-500' : 'bg-green-500'} text-[9px] font-bold text-white`}>{badge > 99 ? '99+' : badge}</span>
                      )}
                      <Icon className={`h-5 w-5 ${color}`} />
                      <span className={moduleTileLabelClass}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Vehicles & Zones */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Car className="h-3 w-3 text-slate-500" /> Vehicles & Zones
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                  {[
                    { path: '/vehicles',               label: 'Vehicles',          Icon: Car,           color: 'text-slate-600',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
                    { path: '/asset-management',       label: 'Assets',            Icon: Package,       color: 'text-amber-700',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    { path: '/vehicle-registry',       label: 'Registry',          Icon: Database,      color: 'text-gray-600',   bg: 'bg-gray-100 dark:bg-[#1E1E1E]/30' },
                    { path: '/zones',                  label: 'Zones',             Icon: MapPin,        color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20' },
                    { path: '/hotspots',               label: 'Hotspots',          Icon: Map,           color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/admin/nzscv',            label: 'NZSCV Monitor',     Icon: Shield,        color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20', badge: (data as any)?.scvExpiringSoon > 0 ? (data as any)?.scvExpiringSoon : undefined },
                    { path: '/admin/discrepancies',    label: 'Discrepancies',     Icon: AlertTriangle, color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20', badge: (data as any)?.discrepanciesPending > 0 ? (data as any)?.discrepanciesPending : undefined },
                    { path: '/admin/canonical-records',label: 'Canonical Records', Icon: Database,      color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                    { path: '/drift-events',          label: 'Drift Events',      Icon: Navigation,    color: 'text-slate-600',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
                    { path: '/parking-payments-log',  label: 'Parking Payments',  Icon: Receipt,       color: 'text-emerald-600',bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                    { path: '/parking-sessions-log',  label: 'Parking Sessions',  Icon: ParkingSquare, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/plate-scans-log',       label: 'Plate Scans',       Icon: ScanLine,      color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                  ].map(({ path, label, Icon, color, bg, badge }) => (
                    <button key={path} onClick={() => navigate(path)} aria-label={`Open ${label}`} className={`${moduleTileClass} ${bg}`}>
                      {badge !== undefined && (
                        <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>
                      )}
                      <Icon className={`h-5 w-5 ${color}`} />
                      <span className={moduleTileLabelClass}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* People & Records */}
              <div className="rounded-xl border border-orange-100 dark:border-orange-900/40 bg-orange-50/40 dark:bg-orange-950/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Users className="h-3 w-3 text-orange-500" /> People & Records
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                  {[
                    { path: '/person-records',      label: 'Person Records',    Icon: Users,         color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/face-recognition',    label: 'Face Recognition',  Icon: Camera,        color: 'text-teal-600',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/points-of-interest',  label: 'Points of Interest',Icon: Ban,           color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/incidents',           label: 'Incidents',         Icon: Shield,        color: 'text-slate-600',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
                    { path: '/investigations',      label: 'Investigations',    Icon: Search,        color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20', badge: (data as any)?.activeInvestigations > 0 ? (data as any)?.activeInvestigations : undefined },
                    { path: '/observation-records', label: 'Observations',      Icon: Eye,           color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/person-observations-log', label: 'Obs. Log',       Icon: Eye,           color: 'text-teal-600',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/site-risk-assessment',label: 'Risk Assessment',   Icon: ClipboardCheck,color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    { path: '/site-risk-trends',    label: 'Risk Trends',       Icon: TrendingUp,    color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/trespass-notices',    label: 'Trespass Notices',  Icon: Ban,           color: 'text-rose-600',   bg: 'bg-rose-50 dark:bg-rose-900/20',   badge: (data as any)?.activeTrespassCount > 0 ? (data as any)?.activeTrespassCount : undefined },
                    { path: '/access-permissions',  label: 'Access Permissions',Icon: KeyRound,      color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/access-audit',       label: 'Access Audit',      Icon: ScanLine,      color: 'text-slate-600',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
                    { path: '/canonical-persons',   label: 'Canonical Persons', Icon: Users,         color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                  ].map(({ path, label, Icon, color, bg, badge }) => (
                    <button key={path} onClick={() => navigate(path)} aria-label={`Open ${label}`} className={`${moduleTileClass} ${bg}`}>
                      {badge !== undefined && (
                        <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[9px] font-bold text-white">{badge}</span>
                      )}
                      <Icon className={`h-5 w-5 ${color}`} />
                      <span className={moduleTileLabelClass}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Specialist Services */}
              <div className="rounded-xl border border-teal-100 dark:border-teal-900/40 bg-teal-50/40 dark:bg-teal-950/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Lock className="h-3 w-3 text-teal-500" /> Specialist Services
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                  {[
                    { path: '/field-officer?service=freedom_camping', label: 'Freedom Camping', Icon: MapPin, color: 'text-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-900/20', scopeHint: 'Zone-based' },
                    { path: '/parking-officer', label: 'Parking',      Icon: ParkingSquare, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', scopeHint: 'Zone-based' },
                    { path: '/noise-officer', label: 'Noise Control', Icon: Volume2,       color: 'text-yellow-700', bg: 'bg-yellow-50 dark:bg-yellow-900/20', scopeHint: 'Jurisdiction' },
                    { path: '/noise-complaints', label: 'Noise Log', Icon: Volume2,      color: 'text-violet-700', bg: 'bg-violet-50 dark:bg-violet-900/20', scopeHint: 'Admin' },
                    { path: '/noise-jobs-log',   label: 'Noise Jobs', Icon: Volume2,      color: 'text-orange-700', bg: 'bg-orange-50 dark:bg-orange-900/20', scopeHint: 'Admin' },
                    { path: '/noise-assessments-log', label: 'Noise Assessments', Icon: Volume2, color: 'text-amber-700',  bg: 'bg-amber-50 dark:bg-amber-900/20',  scopeHint: 'Admin' },
                    { path: '/breach-escalation', label: 'Escalation', Icon: ShieldAlert, color: 'text-red-700',   bg: 'bg-red-50 dark:bg-red-900/20', scopeHint: 'Admin' },
                    { path: '/incident-heatmap',  label: 'Incident Map', Icon: Flame,      color: 'text-rose-700', bg: 'bg-rose-50 dark:bg-rose-900/20', scopeHint: 'Admin' },
                    { path: '/health-safety-reports', label: 'H&S Reports', Icon: ShieldAlert, color: 'text-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-900/20', scopeHint: 'Admin' },
                    { path: '/welfare-checkins',  label: 'Welfare Log', Icon: HeartPulse,  color: 'text-pink-700', bg: 'bg-pink-50 dark:bg-pink-900/20', scopeHint: 'Admin' },
                    { path: '/biosecurity-officer', label: 'Biosecurity', Icon: Search,    color: 'text-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-900/20', scopeHint: 'Jurisdiction' },
                    { path: '/smoke-officer', label: 'Smoke (OOH)', Icon: AlertTriangle, color: 'text-amber-700', bg: 'bg-amber-50 dark:bg-amber-900/20', scopeHint: 'Jurisdiction' },
                    { path: '/ems',          label: 'EMS',           Icon: Zap,           color: 'text-red-700',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/site-guard',   label: 'Site Guard',    Icon: Lock,          color: 'text-teal-600',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/client-sites', label: 'Client Sites',  Icon: Building2,     color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                    { path: '/dispatch',     label: 'Dispatch',      Icon: Radio,         color: 'text-cyan-600',   bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                  ].map(({ path, label, Icon, color, bg, scopeHint }) => (
                    <button key={path} onClick={() => navigate(path)} aria-label={`Open ${label}`} className={`${moduleTileCompactClass} ${bg}`}>
                      <Icon className={`h-5 w-5 ${color}`} />
                      <span className={moduleTileLabelClass}>{label}</span>
                      {scopeHint && <span className="text-[10px] text-muted-foreground leading-tight">{scopeHint}</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Intelligence & Radio */}
              <div className="rounded-xl border border-cyan-100 dark:border-cyan-900/40 bg-cyan-50/40 dark:bg-cyan-950/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Mic className="h-3 w-3 text-cyan-500" /> Intelligence & Radio
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                  {[
                    { path: '/radio-transmissions', label: 'Transmissions',     Icon: Radio,     color: 'text-cyan-600',   bg: 'bg-cyan-50 dark:bg-cyan-900/20',     badge: (data as any)?.radioTransmissionsToday > 0 ? (data as any)?.radioTransmissionsToday : undefined },
                    { path: '/radio-transmissions-log', label: 'TX Log',          Icon: Radio,     color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/voice-profiles',      label: 'Voice Profiles',    Icon: Mic,       color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/radio/audit',         label: 'Radio Audit',       Icon: Radio,     color: 'text-slate-600',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
                    { path: '/lmr-bridge',          label: 'LMR Bridge',        Icon: Radio,     color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/loi-browser',         label: 'LOI Browser',       Icon: MapPin,    color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    { path: '/case-bridge',         label: 'Case Bridge',       Icon: Database,  color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/vehicles-of-interest-log', label: 'VOI Log',      Icon: Car,       color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/persons-of-interest-log',  label: 'POI Log',      Icon: UserX,     color: 'text-red-700',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/photo-metadata-log',       label: 'Photo Metadata',Icon: Camera,    color: 'text-blue-600',  bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/radio-comms-events-log',   label: 'Radio Events',  Icon: Radio,     color: 'text-cyan-700',  bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                    { path: '/case-comments-log',        label: 'Case Comments', Icon: MessageSquare, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/lmr-bridge-sessions-log',  label: 'LMR Sessions',  Icon: Radio,     color: 'text-slate-600', bg: 'bg-slate-50 dark:bg-slate-900/30' },
                    { path: '/patrol-session-events-log',label: 'Patrol Events',  Icon: Route,     color: 'text-indigo-600',bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/radio-transcript-log',     label: 'Transcripts',    Icon: FileText,  color: 'text-cyan-700',  bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                    { path: '/dispute-intake-log',       label: 'Dispute Intake', Icon: Scale,     color: 'text-amber-700', bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    { path: '/radio-tts-render-log',     label: 'TTS Renders',    Icon: Volume2,   color: 'text-teal-700',  bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/health-safety-report-log', label: 'H&S Reports',    Icon: HeartPulse,color: 'text-rose-700',  bg: 'bg-rose-50 dark:bg-rose-900/20' },
                    { path: '/noise-seizures-log',       label: 'Noise Seizures', Icon: PackageX,  color: 'text-red-800',   bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/locations-of-interest-log', label: 'Locations',     Icon: MapPin,    color: 'text-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                    { path: '/vehicle-monthly-stays-log', label: 'Monthly Stays', Icon: CalendarRange, color: 'text-cyan-700', bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                    { path: '/radio-voice-consent-log',   label: 'Voice Consents', Icon: ShieldCheck, color: 'text-green-700', bg: 'bg-green-50 dark:bg-green-900/20' },
                    { path: '/dispatch-ack-log',          label: 'Dispatch Acks',  Icon: Radio,      color: 'text-cyan-700',  bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                    { path: '/credential-processing-log', label: 'Credentials',    Icon: BadgeCheck, color: 'text-violet-700',bg: 'bg-violet-50 dark:bg-violet-900/20' },
                  ].map(({ path, label, Icon, color, bg, badge }) => (
                    <button key={path} onClick={() => navigate(path)} aria-label={`Open ${label}`} className={`${moduleTileClass} ${bg}`}>
                      {badge !== undefined && (
                        <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 text-[9px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>
                      )}
                      <Icon className={`h-5 w-5 ${color}`} />
                      <span className={moduleTileLabelClass}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Workforce */}
              <div className="rounded-xl border border-violet-100 dark:border-violet-900/40 bg-violet-50/40 dark:bg-violet-950/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <CalendarDays className="h-3 w-3 text-violet-500" /> Workforce
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                  {[
                    { path: '/roster',            label: 'Roster Planner',   Icon: CalendarDays,  color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/timesheets',        label: 'Timesheets',       Icon: Clock,         color: 'text-slate-600',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
                    { path: '/open-shifts',       label: 'Open Shifts',      Icon: CalendarCheck2,color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20' },
                    { path: '/officer-skills',    label: 'Skills & Licences',Icon: GraduationCap, color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    { path: '/availability',      label: 'Availability',     Icon: CalendarDays,  color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/asset-management',  label: 'Assets',           Icon: Package2,      color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/on-call-periods',   label: 'On-Call',          Icon: PhoneCall,     color: 'text-pink-600',   bg: 'bg-pink-50 dark:bg-pink-900/20' },
                    { path: '/callout-shifts',    label: 'Callout Shifts',   Icon: Siren,         color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/officer-allowances',label: 'Allowances',       Icon: BadgeDollarSign,color:'text-emerald-600',bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                    { path: '/travel-allowances', label: 'Travel Allowances',Icon: Car,           color: 'text-sky-600',    bg: 'bg-sky-50 dark:bg-sky-900/20' },
                    { path: '/parking-appeals',   label: 'Parking Appeals',  Icon: Gavel,         color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/camper-registrations',label:'Camper Reg.',     Icon: Tent,          color: 'text-teal-600',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/zone-amenities',    label: 'Zone Amenities',   Icon: Wrench,        color: 'text-slate-600',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
                    { path: '/parking-permits',   label: 'Parking Permits',  Icon: BadgeCheck,    color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20' },
                    { path: '/roster-shifts',     label: 'Roster Shifts',    Icon: ClipboardList, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                  ].map(({ path, label, Icon, color, bg }) => (
                    <button key={path} onClick={() => navigate(path)} aria-label={`Open ${label}`} className={`${moduleTileClass} ${bg}`}>
                      <Icon className={`h-5 w-5 ${color}`} />
                      <span className={moduleTileLabelClass}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Reports & Analytics */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <FileBarChart className="h-3 w-3 text-gray-500" /> Reports & Analytics
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                  {[
                    { path: '/reports-hub',         label: 'Reports Hub',         Icon: FileBarChart,  color: 'text-gray-600',   bg: 'bg-gray-100 dark:bg-[#1E1E1E]/30' },
                    { path: '/ai-analysis',          label: 'Bob Analysis',        Icon: Sparkles,      color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/compliance-analytics', label: 'Compliance Analytics',Icon: PieChart,      color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/observations-report',  label: 'Obs. Report',         Icon: LayoutGrid,    color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/audit-log',            label: 'Audit Log',           Icon: ScrollText,    color: 'text-gray-600',   bg: 'bg-gray-100 dark:bg-[#1E1E1E]/30' },
                    { path: '/bug-reports-log',      label: 'Bug Reports',          Icon: Bug,           color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/users',                label: 'Users',               Icon: Users,         color: 'text-slate-600',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
                    // Sprint 43: B-139–B-141
                    { path: '/bob-proposals-log',       label: 'Bob Proposals',    Icon: BrainCircuit,  color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/bob-proposal-events-log', label: 'Bob Prop. Events', Icon: BrainCircuit,  color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/admin/video-generation',  label: 'Video Generation', Icon: BrainCircuit,  color: 'text-fuchsia-600',bg: 'bg-fuchsia-50 dark:bg-fuchsia-900/20' },
                    { path: '/import-batches-log',      label: 'Import Batches',   Icon: Upload,        color: 'text-emerald-600',bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                    // Sprint 44: B-142–B-144
                    { path: '/admin-recalculation-log',  label: 'Recalc. Runs',     Icon: RotateCcw,     color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/contractor-documents-log', label: 'Contractor Docs',  Icon: Briefcase,     color: 'text-teal-600',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/import-staging-log',       label: 'Import Staging',   Icon: Table2,        color: 'text-cyan-600',   bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                    // Sprint 45: B-145–B-147
                    { path: '/lmr-bridge-config-log',    label: 'LMR Config',       Icon: Radio,         color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/radio-voice-profiles-log', label: 'Voice Profiles',   Icon: Mic,           color: 'text-fuchsia-600',bg: 'bg-fuchsia-50 dark:bg-fuchsia-900/20' },
                    { path: '/zone-dispatch-rules-log',  label: 'Dispatch Rules',   Icon: Route,         color: 'text-emerald-600',bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                    // Sprint 46: B-148–B-150
                    { path: '/bob-action-proposal-events-log', label: 'Bob Action Evts', Icon: BrainCircuit, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/homeless-records-log',           label: 'Homeless Log',    Icon: Tent,         color: 'text-cyan-600',   bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                    { path: '/restrictions-log',               label: 'Restrictions',    Icon: Map,          color: 'text-emerald-600',bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                    // Sprint 47: B-151–B-153
                    { path: '/organizations-log',              label: 'Org Log',         Icon: Building2,    color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/client-sites-log',               label: 'Client Sites Log',Icon: MapPin,       color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/parking-permits-log',            label: 'Permits Log',     Icon: ParkingSquare,color: 'text-emerald-600',bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                    // Sprint 48: B-154–B-156
                    { path: '/incidents-log',                  label: 'Incident Log',    Icon: AlertTriangle,color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/person-records-log',             label: 'Person Records',  Icon: Users,        color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/notifications-log',              label: 'Notifications Log',Icon: Bell,        color: 'text-sky-600',    bg: 'bg-sky-50 dark:bg-sky-900/20' },
                    // Sprint 49: B-157–B-159
                    { path: '/face-records-log',               label: 'Face Records',    Icon: Camera,       color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/infringement-notices-log',       label: 'Notice Log',      Icon: Receipt,      color: 'text-emerald-600',bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                    { path: '/site-risk-assessments-log',      label: 'Site Risk Log',   Icon: ShieldAlert,  color: 'text-rose-600',   bg: 'bg-rose-50 dark:bg-rose-900/20' },
                    // Sprint 50: B-160–B-162
                    { path: '/dispatch-jobs-log',              label: 'Dispatch Jobs',   Icon: ClipboardList,color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/enforcement-actions-log',        label: 'Enforcement Log', Icon: Gavel,        color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/observations-log',               label: 'Observations',    Icon: Eye,          color: 'text-sky-600',    bg: 'bg-sky-50 dark:bg-sky-900/20' },
                    // Sprint 51: B-163–B-165
                    { path: '/canonical-scv-log',              label: 'Canonical SCV',   Icon: ShieldCheck,  color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20' },
                    { path: '/officer-availability-log',       label: 'Officer Avail.',  Icon: CalendarCheck2,color:'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/canonical-homeless-log',         label: 'Homeless Canon.', Icon: Users,        color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    // Sprint 52: B-166–B-168
                    { path: '/breach-alerts-log',              label: 'Breach Alerts',   Icon: AlertTriangle,color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/canonical-vehicles-log',         label: 'Canon. Vehicles', Icon: Car,          color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/flagged-vehicles-log',           label: 'Flagged Vehicles',Icon: AlertTriangle,color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    // Sprint 53: B-169–B-171
                    { path: '/officer-shifts-log',             label: 'Officer Shifts',  Icon: Clock,        color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/open-shifts-log',                label: 'Open Shifts Log', Icon: CalendarClock,color: 'text-teal-600',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/zone-compliance-matrix-log',     label: 'Zone Compliance', Icon: ShieldCheck,  color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20' },
                    // Sprint 54: B-172–B-174
                    { path: '/pricing-rules-log',              label: 'Pricing Rules',   Icon: BadgeDollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                    { path: '/zone-legal-config-log',          label: 'Zone Legal Config', Icon: Scale,      color: 'text-slate-600',   bg: 'bg-slate-50 dark:bg-slate-900/20' },
                    { path: '/zone-signage-evidence-log',      label: 'Signage Evidence', Icon: Camera,      color: 'text-indigo-600',  bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    // Sprint 55: B-175–B-177
                    { path: '/fixed-cameras-log',              label: 'Fixed Cameras',   Icon: Camera,       color: 'text-cyan-600',    bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                    { path: '/officer-skills-log',             label: 'Officer Skills',  Icon: GraduationCap,color: 'text-blue-600',    bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/patrol-checkpoints-log',         label: 'Patrol Checkpts', Icon: Navigation,   color: 'text-violet-600',  bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    // Sprint 56: B-178–B-180
                    { path: '/contractor-profiles-log',        label: 'Contractor Profiles', Icon: Briefcase,color: 'text-orange-600',  bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/parking-zones-log',              label: 'Parking Zones',   Icon: ParkingSquare,color: 'text-teal-600',    bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/canonical-persons-log',          label: 'Canonical Persons', Icon: PersonStanding, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20' },
                  ].map(({ path, label, Icon, color, bg }) => (
                    <button key={path} onClick={() => navigate(path)} aria-label={`Open ${label}`} className={`${moduleTileClass} ${bg}`}>
                      <Icon className={`h-5 w-5 ${color}`} />
                      <span className={moduleTileLabelClass}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

            </CardContent>
          </Card>
        </section>

        {/* ── Diagnostics ───────────────────────────────────────────────────────────── */}
        {Array.isArray((data as any)?.diagnostics) && (data as any).diagnostics.length > 0 && (
          <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Dashboard Data Diagnostics</CardTitle>
              <CardDescription>Some KPI queries failed and may show partial/zero values.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-amber-900 dark:text-amber-200 space-y-1">
              {(data as any).diagnostics.map((d: string, idx: number) => (
                <div key={`${d}-${idx}`}>{d}</div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ── COMPLIANCE TREND CHART + QUICK ACTIONS ───────────────────────────────── */}
        <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <ComplianceTrendChart
            data={metrics.trendData}
            title="Compliance Performance"
            description="Rolling compliance vs breach signal for current filter scope"
          />
          <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 backdrop-blur-sm shadow-sm overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-cyan-500 to-blue-600" />
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4 text-cyan-600" />
                Quick Actions
              </CardTitle>
              <CardDescription className="text-xs">Jump into key operational workflows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {drilldowns.map(({ title, to, icon: Icon, metric, config }) => (
                <button
                  key={to}
                  className={quickActionRowClass}
                  onClick={() => openDrilldown(config)}
                  aria-label={`Open quick action: ${title}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">{title}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 hidden group-hover:inline-flex">{metric}</Badge>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* ── RECENT OBSERVATIONS ──────────────────────────────────────────────────── */}
        <section>
          <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 backdrop-blur-sm shadow-sm overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-indigo-600" />
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="flex items-center justify-between text-base">
                <span>Recent Observations</span>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => navigate('/observation-records')}>
                  View all <ArrowRight className="h-3 w-3" />
                </Button>
              </CardTitle>
              <CardDescription className="text-xs">Latest scans — click Print Ticket to issue an infringement from any observation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {recentHistoricalObservations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent observations found.</p>
              ) : recentHistoricalObservations.map((obs: any) => (
                <div key={obs.observation_id} className={listRowClass}>
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold truncate">{obs.plate_number || 'UNKNOWN'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {obs?.zone?.name || 'Unknown zone'} · {new Date(obs.recorded_at).toLocaleString('en-NZ')}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => openInfringementFromObservation(obs.observation_id)}>
                    <Printer className="h-3.5 w-3.5" />
                    Print Ticket
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

      </div>
    </AppLayout>
  )
}
