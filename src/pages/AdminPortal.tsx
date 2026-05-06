import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { ListCardRow } from '@/components/features/ListCardRow'
import { ComplianceTrendChart, type TrendDataPoint } from '@/components/features/ComplianceTrendChart'
import { SystemHealthIndicator } from '@/components/features/SystemHealthIndicator'
import { nzDateToUTCStart, nzDateToUTCEnd, parseNZDate } from '@/lib/timezone'
import { format } from 'date-fns'
import { HOMELESS_UI_STATUSES } from '@/lib/homelessStatus'
const HOMELESS_EXEMPT_STATUSES = ['confirmed', 'claimed'] as const

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
  Clock,
  Cpu,
  Database,
  Eye,
  FileBarChart,
  FileText,
  FileWarning,
  FolderKanban,
  Gavel,
  GraduationCap,
  Heart,
  Home,
  LayoutGrid,
  Lock,
  Map,
  MapPin,
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
  CalendarClock,
  Phone,
} from 'lucide-react'

type DrillConfig = {
  to: string
  metric: string
  period: string
  tab?: string
  status?: string
  label?: string
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

      // Group homeless: homeless_records (org-scoped) + canonical_homeless (cross-org canonical)
      let homelessRecordsQ = (supabase.from('homeless_records') as any)
        .select('plate_number, status')
        .eq('is_active', true)
        .in('status', HOMELESS_UI_STATUSES)
      if (effectiveOrganizationId) homelessRecordsQ = homelessRecordsQ.eq('organization_id', effectiveOrganizationId)

      const canonicalHomelessQ = supabase
        .from('canonical_homeless')
        .select('plate_number, status')
        .in('status', HOMELESS_UI_STATUSES)

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
          const status = String((row as any)?.status ?? '').trim().toLowerCase()
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

      // Open dispute_intake submissions (new dispute intake system)
      let openDisputeIntakeQuery = supabase
        .from('dispute_intake')
        .select('id', { count: 'exact', head: true })
        .in('status', ['received', 'under_review', 'info_requested'])
      if (effectiveOrganizationId) openDisputeIntakeQuery = openDisputeIntakeQuery.eq('organization_id', effectiveOrganizationId)
      const { count: openDisputeIntake, error: disputeIntakeErr } = await openDisputeIntakeQuery
      if (disputeIntakeErr) diagnostics.push(`open_dispute_intake: ${disputeIntakeErr.message || 'unknown error'}`)

      // Vehicle discrepancies requiring review
      let discrepanciesPendingQuery = (supabase.from('vehicle_discrepancies') as any)
        .select('id', { count: 'exact', head: true })
        .eq('requires_review', true)
        .is('reviewed_at', null)
      if (effectiveOrganizationId) discrepanciesPendingQuery = discrepanciesPendingQuery.eq('organization_id', effectiveOrganizationId)
      const { count: discrepanciesPending, error: discrepanciesErr } = await discrepanciesPendingQuery
      if (discrepanciesErr) diagnostics.push(`discrepancies_pending: ${discrepanciesErr.message || 'unknown error'}`)

      // SCV certifications expiring within 30 days
      const thirtyDaysFromNow = new Date()
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
      const { count: scvExpiringSoon, error: scvErr } = await supabase
        .from('canonical_scv')
        .select('plate_number', { count: 'exact', head: true })
        .eq('is_self_contained', true)
        .not('certificate_expiry', 'is', null)
        .lte('certificate_expiry', thirtyDaysFromNow.toISOString())
        .gt('certificate_expiry', new Date().toISOString())
      if (scvErr) diagnostics.push(`scv_expiring_soon: ${scvErr.message || 'unknown error'}`)
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
        openDisputeIntake:         openDisputeIntake         ?? 0,
        discrepanciesPending:      discrepanciesPending      ?? 0,
        scvExpiringSoon:           scvExpiringSoon            ?? 0,
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

  // Welfare alerts — Welfare First inspired: surface officer safety issues immediately
  const { data: welfareAlertCount = 0 } = useQuery({
    queryKey: ['admin-welfare-alert-count', effectiveOrganizationId],
    queryFn: async () => {
      let q = (supabase.from('officer_welfare_alerts') as any)
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'acknowledged'])
      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
      const { count } = await q
      return count ?? 0
    },
    staleTime: 1000 * 30,
  })

  // Active patrols today — Wilsar inspired: show guard tour progress
  const { data: activePatrolCount = 0 } = useQuery({
    queryKey: ['admin-active-patrol-count', effectiveOrganizationId],
    queryFn: async () => {
      const nzToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
      let q = (supabase.from('patrols') as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'in_progress')
        .eq('patrol_date', nzToday)
      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
      const { count } = await q
      return count ?? 0
    },
    staleTime: 1000 * 30,
  })

  // B-50: Active trespass notices count — lightweight count query
  const { data: activeTrespassCount = 0 } = useQuery({
    queryKey: ['admin-active-trespass-count', effectiveOrganizationId],
    queryFn: async () => {
      let q = supabase
        .from('trespass_notices')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
      const { count } = await q
      return count ?? 0
    },
    staleTime: 1000 * 60,
  })

  // B-50: Radio transmissions today count — uses (supabase as any) — table not in typed snapshot
  const { data: radioTransmissionsTodayCount = 0 } = useQuery({
    queryKey: ['admin-radio-transmissions-today', effectiveOrganizationId],
    queryFn: async () => {
      const nzToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
      const todayStart = nzDateToUTCStart(nzToday)
      let q = (supabase as any)
        .from('radio_transmissions')
        .select('id', { count: 'exact', head: true })
        .gte('started_at', todayStart)
      if (effectiveOrganizationId) q = q.eq('org_id', effectiveOrganizationId)
      const { count, error } = await q
      // radio_transmissions may not exist in remote yet — swallow schema errors silently
      if (error && (error.code === 'PGRST205' || error.code === '42P01')) return 0
      return count ?? 0
    },
    staleTime: 1000 * 60,
    retry: false,
  })

  // Today's roster shifts — Deputy / InTime inspired: show who is on duty today
  const { data: todayRosterShifts = [] } = useQuery({
    queryKey: ['admin-today-roster', effectiveOrganizationId],
    queryFn: async () => {
      const nzToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
      let q = (supabase.from('roster_shifts') as any)
        .select(`id, start_time, end_time, status, position_title, service_type,
          officer:user_profiles!roster_shifts_officer_id_fkey(first_name, last_name)`)
        .eq('shift_date', nzToday)
        .in('status', ['published', 'confirmed', 'in_progress'])
        .order('start_time', { ascending: true })
        .limit(8)
      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
      const { data } = await q
      return (data ?? []) as any[]
    },
    staleTime: 1000 * 60,
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
      title: 'Active Trespass',
      value: activeTrespassCount,
      icon: Ban,
      iconColor: 'text-red-600',
      config: { to: '/trespass-notices', metric: 'active_trespass', period: periodLabel, label: 'Active Trespass Notices' },
    },
    {
      title: 'Radio TX Today',
      value: radioTransmissionsTodayCount,
      icon: Radio,
      iconColor: 'text-sky-600',
      config: { to: '/radio-transmissions', metric: 'radio_tx_today', period: periodLabel, label: 'Radio Transmissions Today' },
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
          <Button
            size="sm"
            variant={metrics.activeBreaches > 0 ? 'default' : 'outline'}
            className="gap-1.5"
            onClick={() => navigate('/breaches')}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Breaches
          </Button>
          <Button
            size="sm"
            variant={welfareAlertCount > 0 ? 'default' : 'outline'}
            className="gap-1.5"
            onClick={() => navigate('/officer-welfare')}
          >
            <Heart className="h-3.5 w-3.5" />
            Welfare
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/dispatch')}>
            <Radio className="h-3.5 w-3.5" />
            Dispatch
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/reports-hub')}>
            <FileBarChart className="h-3.5 w-3.5" />
            Reports
          </Button>
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
          : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
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
        <section aria-label="Secondary operational KPIs" className="grid gap-2.5 grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 2xl:grid-cols-9">
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
            <Card className="bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
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
                            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40'
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
          <Card className="bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
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
                    { path: '/disputes',                   label: 'Disputes',         Icon: FileWarning,   color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20', badge: (data as any)?.openDisputeIntake > 0 ? (data as any)?.openDisputeIntake : undefined },
                    { path: '/infringements',              label: 'Infringements',    Icon: Receipt,       color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                    { path: '/breach-notices',             label: 'Breach Notices',   Icon: ScrollText,    color: 'text-rose-600',   bg: 'bg-rose-50 dark:bg-rose-900/20' },
                    { path: '/notice-to-vacate',           label: 'Notice to Vacate', Icon: FileText,      color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                    { path: '/compliance-analytics',       label: 'Analytics',        Icon: PieChart,      color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
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
                    { path: '/vehicle-registry',       label: 'Registry',          Icon: Database,      color: 'text-gray-600',   bg: 'bg-gray-100 dark:bg-gray-800/30' },
                    { path: '/zones',                  label: 'Zones',             Icon: MapPin,        color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20' },
                    { path: '/hotspots',               label: 'Hotspots',          Icon: Map,           color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { path: '/admin/nzscv',            label: 'NZSCV Monitor',     Icon: Shield,        color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20', badge: (data as any)?.scvExpiringSoon > 0 ? (data as any)?.scvExpiringSoon : undefined },
                    { path: '/admin/discrepancies',    label: 'Discrepancies',     Icon: AlertTriangle, color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20', badge: (data as any)?.discrepanciesPending > 0 ? (data as any)?.discrepanciesPending : undefined },
                    { path: '/admin/canonical-records',label: 'Canonical Records', Icon: Database,      color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
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
                    { path: '/site-risk-assessment',label: 'Risk Assessment',   Icon: ClipboardCheck,color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    { path: '/trespass-notices',    label: 'Trespass Notices',  Icon: Ban,           color: 'text-red-700',    bg: 'bg-red-50 dark:bg-red-900/20', badge: activeTrespassCount > 0 ? activeTrespassCount : undefined },
                    { path: '/access-permissions',  label: 'Access Permissions',Icon: Lock,          color: 'text-teal-700',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/canonical-persons',   label: 'Canonical Persons', Icon: Users,         color: 'text-purple-700', bg: 'bg-purple-50 dark:bg-purple-900/20' },
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
              <div className="rounded-xl border border-sky-100 dark:border-sky-900/40 bg-sky-50/40 dark:bg-sky-950/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Cpu className="h-3 w-3 text-sky-500" /> Intelligence & Radio
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                  {[
                    { path: '/radio-transmissions', label: 'Transmissions',  Icon: Mic,          color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20', badge: radioTransmissionsTodayCount > 0 ? radioTransmissionsTodayCount : undefined },
                    { path: '/voice-profiles',      label: 'Voice Profiles', Icon: Mic,          color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/radio/audit',         label: 'Radio Audit',    Icon: Shield,       color: 'text-teal-600',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
                    { path: '/lmr-bridge',          label: 'LMR Bridge',     Icon: Radio,        color: 'text-cyan-600',   bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                    { path: '/loi-browser',         label: 'LOI Browser',    Icon: MapPin,       color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/case-bridge',         label: 'Case Bridge',    Icon: FolderKanban, color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
                  ].map(({ path, label, Icon, color, bg, badge }) => (
                    <button key={path} onClick={() => navigate(path)} aria-label={`Open ${label}`} className={`${moduleTileClass} ${bg}`}>
                      {badge !== undefined && (
                        <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white">{badge}</span>
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
                    { path: '/on-call-periods',   label: 'On-Call Periods',  Icon: CalendarClock, color: 'text-sky-600',    bg: 'bg-sky-50 dark:bg-sky-900/20' },
                    { path: '/callout-shifts',    label: 'Callout Shifts',   Icon: Phone,         color: 'text-amber-700',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    { path: '/officer-skills',    label: 'Skills & Licences',Icon: GraduationCap, color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    { path: '/availability',      label: 'Availability',     Icon: CalendarDays,  color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/asset-management',  label: 'Assets',           Icon: Package2,      color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
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
                    { path: '/reports-hub',         label: 'Reports Hub',         Icon: FileBarChart,  color: 'text-gray-600',   bg: 'bg-gray-100 dark:bg-gray-800/30' },
                    { path: '/ai-analysis',          label: 'Bob Analysis',        Icon: Sparkles,      color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
                    { path: '/compliance-analytics', label: 'Compliance Analytics',Icon: PieChart,      color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { path: '/observations-report',  label: 'Obs. Report',         Icon: LayoutGrid,    color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { path: '/audit-log',            label: 'Audit Log',           Icon: ScrollText,    color: 'text-gray-600',   bg: 'bg-gray-100 dark:bg-gray-800/30' },
                    { path: '/users',                label: 'Users',               Icon: Users,         color: 'text-slate-600',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
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
