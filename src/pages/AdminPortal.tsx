import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { ComplianceTrendChart, type TrendDataPoint } from '@/components/features/ComplianceTrendChart'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { HOMELESS_UI_STATUSES } from '@/lib/homelessStatus'
const HOMELESS_EXEMPT_STATUSES = ['confirmed', 'claimed'] as const

import { toast } from 'sonner'
import { 
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Car,
  ClipboardCheck,
  Eye,
  FileWarning,
  Gavel,
  Home,
  Map,
  Navigation,
  Printer,
  Radio,
  Search,
  Shield,
  TrendingUp,
  UserCheck,
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

export default function AdminPortal() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
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

      const nzToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
      const todayStart = nzDateToUTCStart(nzToday)
      const rpcFrom = normalizedDateFrom ?? '1970-01-01'
      const rpcTo   = normalizedDateTo   ?? new Date().toISOString().slice(0, 10)

      // ── Build independent queries ─────────────────────────────────────────
      // Groups 1+2: observation counts
      const totalObsQ = applyFilters(supabase.from('observations').select('*', { count: 'exact', head: true }))
      const compliantQ = applyFilters(supabase.from('observations').select('*', { count: 'exact', head: true }).eq('is_compliant', true))

      // Group 3: active vehicles RPC
      const summaryQ = (supabase.rpc as any)('get_observation_summary', {
        p_start_date: rpcFrom,
        p_end_date: rpcTo,
        p_organization_id: effectiveOrganizationId ?? null,
        p_zone_id: zoneId ?? null,
      })

      // Group 5: active breaches
      let breachesQ = (supabase.from('breach_alerts') as any)
        .select('observation_id')
        .in('status', ['pending', 'acknowledged', 'enforcement_started'])
        .not('observation_id', 'is', null)
      if (effectiveOrganizationId) breachesQ = breachesQ.eq('organization_id', effectiveOrganizationId)
      if (zoneId)                  breachesQ = breachesQ.eq('zone_id', zoneId)
      if (startDate)               breachesQ = breachesQ.gte('created_at', startDate)
      if (endDate)                 breachesQ = breachesQ.lte('created_at', endDate)

      // Group 5b: active investigations
      let investigationsQ = (supabase.from('investigation_jobs') as any)
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'assigned', 'in_progress', 'overdue'])
      if (effectiveOrganizationId) investigationsQ = investigationsQ.eq('organization_id', effectiveOrganizationId)
      if (zoneId) investigationsQ = investigationsQ.eq('associated_zone_id', zoneId)
      if (startDate) investigationsQ = investigationsQ.gte('created_at', startDate)
      if (endDate) investigationsQ = investigationsQ.lte('created_at', endDate)

      // Group 7a: active officers
      let activeOfficersQ = (supabase.from('user_profiles') as any)
        .select('id', { count: 'exact', head: true })
        .in('role', ['officer', 'admin_officer'])
        .eq('is_active', true)
        .gte('last_gps_update', new Date(Date.now() - 20 * 60 * 1000).toISOString())
      if (effectiveOrganizationId) activeOfficersQ = activeOfficersQ.eq('organization_id', effectiveOrganizationId)

      // Group 7b: checks today
      let checksTodayQ = (supabase.from('observations') as any)
        .select('observation_id', { count: 'exact', head: true })
        .gte('recorded_at', todayStart)
      if (effectiveOrganizationId) checksTodayQ = checksTodayQ.eq('organization_id', effectiveOrganizationId)
      if (zoneId) checksTodayQ = checksTodayQ.eq('zone_id', zoneId)

      // Group 7c: infringements issued today
      let infringementsQ = (supabase.from('infringement_notices') as any)
        .select('id', { count: 'exact', head: true })
        .gte('issued_at', todayStart)
      if (effectiveOrganizationId) infringementsQ = infringementsQ.eq('organization_id', effectiveOrganizationId)

      // Group 7d: disputes pending
      let disputesQ = (supabase.from('infringement_notices') as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'disputed')
      if (effectiveOrganizationId) disputesQ = disputesQ.eq('organization_id', effectiveOrganizationId)

      // Group homeless: homeless_records + canonical_vehicles
      let homelessRecordsQ = (supabase.from('homeless_records') as any)
        .select('plate_number, status')
        .eq('is_active', true)
        .in('status', HOMELESS_UI_STATUSES)
      if (effectiveOrganizationId) homelessRecordsQ = homelessRecordsQ.eq('organization_id', effectiveOrganizationId)

      const canonicalHomelessQ = (supabase.from('canonical_vehicles') as any)
        .select('plate_number, homeless_status')
        .in('homeless_status', HOMELESS_UI_STATUSES)

      // ── Fire all independent queries in parallel ──────────────────────────
      const [
        totalObsRes,
        compliantRes,
        summaryRes,
        breachesRes,
        investigationsRes,
        activeOfficersRes,
        checksTodayRes,
        infringementsRes,
        disputesRes,
        homelessRecordsRes,
        canonicalHomelessRes,
      ] = await Promise.all([
        totalObsQ,
        compliantQ,
        summaryQ,
        breachesQ,
        investigationsQ,
        activeOfficersQ,
        checksTodayQ,
        infringementsQ,
        disputesQ,
        homelessRecordsQ,
        canonicalHomelessQ,
      ])

      // ── 1. Total observations ─────────────────────────────────────────────
      if (totalObsRes.error) diagnostics.push(`observations_total: ${totalObsRes.error.message || 'unknown error'}`)
      const totalObservations = totalObsRes.count

      // ── 2. Compliant observations count ──────────────────────────────────
      if (compliantRes.error) diagnostics.push(`observations_compliant: ${compliantRes.error.message || 'unknown error'}`)
      const compliantCount = compliantRes.count

      // ── 3. Active vehicles — unique plates in the date range ─────────────
      // get_observation_summary returns COUNT(DISTINCT plate_number) server-side.
      let activeVehicles = 0
      if (!summaryRes.error && summaryRes.data && summaryRes.data[0]) {
        activeVehicles = Number(summaryRes.data[0].unique_vehicles) || 0
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

      // ── Homeless plates ───────────────────────────────────────────────────
      const homelessPlates = new Set<string>()
      const homelessExemptPlates = new Set<string>()

      if (homelessRecordsRes.error) {
        diagnostics.push(`homeless_records_trend: ${homelessRecordsRes.error.message || 'unknown error'}`)
      } else {
        ;(homelessRecordsRes.data ?? []).forEach((row: any) => {
          const plate = String(row?.plate_number ?? '').trim().toUpperCase()
          if (plate) homelessPlates.add(plate)
          const status = String(row?.status ?? '').trim().toLowerCase()
          if (plate && HOMELESS_EXEMPT_STATUSES.includes(status as any)) homelessExemptPlates.add(plate)
        })
      }

      if (canonicalHomelessRes.error) {
        diagnostics.push(`canonical_homeless_trend: ${canonicalHomelessRes.error.message || 'unknown error'}`)
      } else {
        ;(canonicalHomelessRes.data ?? []).forEach((row: any) => {
          const plate = String(row?.plate_number ?? '').trim().toUpperCase()
          if (plate) homelessPlates.add(plate)
          const status = String((row as any)?.homeless_status ?? '').trim().toLowerCase()
          if (plate && HOMELESS_EXEMPT_STATUSES.includes(status as any)) homelessExemptPlates.add(plate)
        })
      }

      // ── 5. Active breaches (distinct observation_id count to avoid duplicates) ─
      let activeBreaches = 0
      if (breachesRes.error) {
        diagnostics.push(`breach_alerts_active: ${breachesRes.error.message || 'unknown error'}`)
      } else {
        activeBreaches = new Set((breachesRes.data ?? []).map((r: any) => r.observation_id)).size
      }

      // ── 5b. Active investigations count ──────────────────────────────────
      if (investigationsRes.error) diagnostics.push(`investigation_jobs_active: ${investigationsRes.error.message || 'unknown error'}`)
      const activeInvestigations = investigationsRes.count

      // ── 7. Command snapshot metrics ──────────────────────────────────────
      if (activeOfficersRes.error) diagnostics.push(`active_officers: ${activeOfficersRes.error.message || 'unknown error'}`)
      const activeOfficers = activeOfficersRes.count

      if (checksTodayRes.error) diagnostics.push(`checks_today: ${checksTodayRes.error.message || 'unknown error'}`)
      const checksToday = checksTodayRes.count

      if (infringementsRes.error) diagnostics.push(`infringements_issued: ${infringementsRes.error.message || 'unknown error'}`)
      const infringementsIssued = infringementsRes.count

      if (disputesRes.error) diagnostics.push(`disputes_pending: ${disputesRes.error.message || 'unknown error'}`)
      const disputesPending = disputesRes.count

      // ── 6. Homeless-exempt breach count ──────────────────────────────────
      // Count non-compliant observations where the plate belongs to a homeless vehicle.
      // This is the exact number of "breaches" that are actually FC Act exempt.
      let homelessExemptBreachCount = 0
      const homelessPlateList = Array.from(homelessExemptPlates)
      if (homelessPlateList.length > 0) {
        const { count: exemptCount, error: exemptErr } = await applyFilters(
          supabase
            .from('observations')
            .select('observation_id', { count: 'exact', head: true })
            .eq('is_compliant', false)
            .in('plate_number', homelessPlateList)
        )
        if (exemptErr) diagnostics.push(`homeless_exempt_breaches: ${exemptErr.message || 'unknown error'}`)
        homelessExemptBreachCount = exemptCount ?? 0
      }

      return {
        totalObservations: totalObservations ?? 0,
        compliantCount:    compliantCount    ?? 0,
        activeVehicles,
        trendRows,
        homelessPlates: Array.from(homelessPlates),
        homelessExemptPlates: Array.from(homelessExemptPlates),
        activeBreaches:            activeBreaches            ?? 0,
        activeInvestigations:      activeInvestigations      ?? 0,
        activeOfficers:            activeOfficers            ?? 0,
        checksToday:               checksToday               ?? 0,
        infringementsIssued:       infringementsIssued       ?? 0,
        disputesPending:           disputesPending           ?? 0,
        homelessExemptBreachCount,
        diagnostics,
      }
    },
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    staleTime: 15000,
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

  const { data: recentHistoricalObservations = [] } = useQuery({
    queryKey: ['admin-recent-historical-observations', effectiveOrganizationId, zoneId, startDate, endDate],
    queryFn: async () => {
      let q = (supabase.from('observations') as any)
        .select('observation_id, plate_number, recorded_at, breach_type, is_compliant, zone:zones!zone_id(name)')
        .order('recorded_at', { ascending: false })
        .limit(8)

      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('recorded_at', startDate)
      if (endDate) q = q.lte('recorded_at', endDate)

      const { data: rows, error: rowsError } = await q
      if (rowsError) throw rowsError
      return (rows || []) as any[]
    },
    enabled: !!effectiveOrganizationId,
  })

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
  ]

  return (
    <AppLayout
      title="Primary Operations Dashboard"
      description={user?.role === 'master' ? 'BI command view across organisations' : 'BI command view for your organisation'}
    >
      {/* Filters anchored directly below the title */}
      <GlobalFilterRibbon />

      <div className="space-y-4">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card
            className="bg-white dark:bg-gray-900 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/live-tracking')}
          >
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Officers</p>
                  <p className="text-2xl font-bold">{isLoading ? '...' : ((data as any)?.activeOfficers ?? 0)}</p>
                </div>
                <UserCheck className="h-5 w-5 text-cyan-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white dark:bg-gray-900 shadow-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Checks Today</p>
                  <p className="text-2xl font-bold">{isLoading ? '...' : ((data as any)?.checksToday ?? 0)}</p>
                </div>
                <ClipboardCheck className="h-5 w-5 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card
            className="bg-white dark:bg-gray-900 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/infringements')}
          >
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Infringements Issued</p>
                  <p className="text-2xl font-bold">{isLoading ? '...' : ((data as any)?.infringementsIssued ?? 0)}</p>
                </div>
                <Gavel className="h-5 w-5 text-red-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white dark:bg-gray-900 shadow-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Disputes Pending</p>
                  <p className="text-2xl font-bold">{isLoading ? '...' : ((data as any)?.disputesPending ?? 0)}</p>
                </div>
                <FileWarning className="h-5 w-5 text-amber-500" />
              </div>
            </CardContent>
          </Card>

          <Card
            className="bg-white dark:bg-gray-900 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openDrilldown({
              to: '/investigations',
              metric: 'active_investigations',
              period: periodLabel,
              status: 'active',
              label: 'Active Investigations',
            })}
          >
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Investigations</p>
                  <p className="text-2xl font-bold">{isLoading ? '...' : ((data as any)?.activeInvestigations ?? 0)}</p>
                </div>
                <Search className="h-5 w-5 text-indigo-500" />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── STATUS: Primary KPIs — the "Big Three" ───────────────────────── */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {primaryKPIs.map((kpi) => {
            const Icon = kpi.icon
            return (
              <Card
                key={kpi.title}
                className="cursor-pointer overflow-hidden group bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-shadow"
                onClick={() => openDrilldown(kpi.config)}
              >
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
                  {kpi.subtitle && (
                    <p className="text-xs text-muted-foreground">{kpi.subtitle}</p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </section>

        {/* ── Secondary KPI summary row — reduced visual weight ──────────── */}
        <section className="grid gap-3 grid-cols-3">
          {secondaryKPIs.map((kpi) => {
            const Icon = kpi.icon
            return (
              <button
                key={kpi.title}
                onClick={() => openDrilldown(kpi.config)}
                className="flex items-center gap-3 rounded-lg border bg-white dark:bg-gray-900 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm"
              >
                <Icon className={`h-4 w-4 shrink-0 ${kpi.iconColor}`} />
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground truncate">{kpi.title}</p>
                </div>
              </button>
            )
          })}
        </section>

        {/* ── Diagnostics (only when errors present) ─────────────────────── */}
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

        {/* ── ANALYSIS: Hero chart + Urgent Actions feed ─────────────────── */}
        <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
          {/* Hero: Compliance Performance chart */}
          <ComplianceTrendChart
            data={metrics.trendData}
            title="Compliance Performance"
            description="Rolling compliance vs breach signal for current filter scope"
          />

          {/* Pulse: Urgent actions / quick navigation */}
          <Card className="bg-white dark:bg-gray-900 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4 text-cyan-600" />
                Quick Actions
              </CardTitle>
              <CardDescription className="text-xs">Jump into key operational workflows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {drilldowns.slice(0, 5).map(({ title, to, icon: Icon, metric, config }) => (
                <button
                  key={to}
                  className="flex w-full items-center justify-between rounded-lg border bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                  onClick={() => openDrilldown(config)}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">{title}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 hidden group-hover:inline-flex">
                      {metric}
                    </Badge>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                </button>
              ))}
              {drilldowns.length > 5 && drilldowns.slice(5).map(({ title, to, icon: Icon, metric, config }) => (
                <button
                  key={to}
                  className="flex w-full items-center justify-between rounded-lg border bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                  onClick={() => openDrilldown(config)}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">{title}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 hidden group-hover:inline-flex">
                      {metric}
                    </Badge>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="bg-white dark:bg-gray-900 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Historical Observations</CardTitle>
              <CardDescription className="text-xs">
                Print a ticket from prior observations in current filter scope.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {recentHistoricalObservations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No historical observations found.</p>
              ) : recentHistoricalObservations.map((obs: any) => (
                <div
                  key={obs.observation_id}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-gray-50 dark:bg-gray-800 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold truncate">{obs.plate_number || 'UNKNOWN'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {obs?.zone?.name || 'Unknown zone'} · {new Date(obs.recorded_at).toLocaleString('en-NZ')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 shrink-0"
                    onClick={() => openInfringementFromObservation(obs.observation_id)}
                  >
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
