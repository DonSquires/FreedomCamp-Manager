import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { nzDateToUTCStart } from '@/lib/timezone'
import { HOMELESS_UI_STATUSES } from '@/lib/homelessStatus'

export const HOMELESS_EXEMPT_STATUSES = ['confirmed', 'claimed'] as const

export function useAdminRecentHistoricalObservations(options: {
  organizationId?: string | null
  zoneId?: string | null
  startDate?: string | null
  endDate?: string | null
  enabled?: boolean
}) {
  const { organizationId, zoneId, startDate, endDate, enabled = true } = options

  return useQuery({
    queryKey: ['admin-recent-historical-observations', organizationId, zoneId, startDate, endDate],
    queryFn: async () => {
      let q = (supabase.from('observations') as any)
        .select('observation_id, plate_number, recorded_at, breach_type, is_compliant, zone:zones!zone_id(name)')
        .order('recorded_at', { ascending: false })
        .limit(8)

      if (organizationId) q = q.eq('organization_id', organizationId)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('recorded_at', startDate)
      if (endDate) q = q.lte('recorded_at', endDate)

      const { data: rows, error: rowsError } = await q
      if (rowsError) throw rowsError
      return (rows || []) as any[]
    },
    enabled,
  })
}

export function useAdminWelfareAlertCount(organizationId?: string | null) {
  return useQuery({
    queryKey: ['admin-welfare-alert-count', organizationId],
    queryFn: async () => {
      let q = (supabase.from('officer_welfare_alerts') as any)
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'acknowledged'])
      if (organizationId) q = q.eq('organization_id', organizationId)
      const { count } = await q
      return count ?? 0
    },
    staleTime: 1000 * 30,
  })
}

export function useAdminActivePatrolCount(organizationId?: string | null) {
  return useQuery({
    queryKey: ['admin-active-patrol-count', organizationId],
    queryFn: async () => {
      const nzToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
      let q = (supabase.from('patrols') as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'in_progress')
        .eq('patrol_date', nzToday)
      if (organizationId) q = q.eq('organization_id', organizationId)
      const { count } = await q
      return count ?? 0
    },
    staleTime: 1000 * 30,
  })
}

export function useAdminTodayRosterShifts(organizationId?: string | null) {
  return useQuery({
    queryKey: ['admin-today-roster', organizationId],
    queryFn: async () => {
      const nzToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
      let q = (supabase.from('roster_shifts') as any)
        .select(`id, start_time, end_time, status, position_title, service_type,
          officer:user_profiles!roster_shifts_officer_id_fkey(first_name, last_name)`)
        .eq('shift_date', nzToday)
        .in('status', ['published', 'confirmed', 'in_progress'])
        .order('start_time', { ascending: true })
        .limit(8)
      if (organizationId) q = q.eq('organization_id', organizationId)
      const { data } = await q
      return (data ?? []) as any[]
    },
    staleTime: 1000 * 60,
  })
}

// ── Primary dashboard: all KPI, trend, and count queries ──────────────────────

interface UseAdminPrimaryDashboardOptions {
  organizationId?: string | null
  zoneId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  startDate?: string | null
  endDate?: string | null
  normalizedDateFrom?: string | null
  normalizedDateTo?: string | null
}

export function useAdminPrimaryDashboard(options: UseAdminPrimaryDashboardOptions) {
  const {
    organizationId,
    zoneId,
    dateFrom,
    dateTo,
    startDate,
    endDate,
    normalizedDateFrom,
    normalizedDateTo,
  } = options

  return useQuery({
    queryKey: ['admin-primary-dashboard', organizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const diagnostics: string[] = []
      const nowIso = new Date().toISOString()

      // Keep dashboard reads bounded so UI can render even when summary RPCs are unavailable.
      // 30d and 5000 rows are enough for trend cards without scanning the full observations table.
      const defaultWindowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const trendStartBound = startDate ?? defaultWindowStart
      const trendEndBound = endDate ?? nowIso
      const fallbackRowCap = 5000

      // ── Helper: apply org / zone / date filters to any query ──────────────
      const applyFilters = (q: any) => {
        if (organizationId) q = q.eq('organization_id', organizationId)
        if (zoneId)         q = q.eq('zone_id', zoneId)
        if (startDate)      q = q.gte('recorded_at', startDate)
        if (endDate)        q = q.lte('recorded_at', endDate)
        return q
      }

      const nzToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
      const todayStart = nzDateToUTCStart(nzToday)
      const rpcFrom = normalizedDateFrom ?? '1970-01-01'
      const rpcTo   = normalizedDateTo   ?? new Date().toISOString().slice(0, 10)

      // Groups 1+2: observation counts
      const totalObsQ = applyFilters(supabase.from('observations').select('*', { count: 'exact', head: true }))
      const compliantQ = applyFilters(supabase.from('observations').select('*', { count: 'exact', head: true }).eq('is_compliant', true))

      // Group 3: active vehicles RPC
      const summaryQ = (supabase.rpc as any)('get_observation_summary', {
        p_start_date: rpcFrom,
        p_end_date: rpcTo,
        p_organization_id: organizationId ?? null,
        p_zone_id: zoneId ?? null,
      })

      // Group 5: active breaches
      let breachesQ = (supabase.from('breach_alerts') as any)
        .select('observation_id')
        .in('status', ['pending', 'acknowledged', 'enforcement_started'])
        .not('observation_id', 'is', null)
      if (organizationId) breachesQ = breachesQ.eq('organization_id', organizationId)
      if (zoneId)         breachesQ = breachesQ.eq('zone_id', zoneId)
      if (startDate)      breachesQ = breachesQ.gte('created_at', startDate)
      if (endDate)        breachesQ = breachesQ.lte('created_at', endDate)

      // Group 5b: active investigations
      let investigationsQ = (supabase.from('investigation_jobs') as any)
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'assigned', 'in_progress', 'overdue'])
      if (organizationId) investigationsQ = investigationsQ.eq('organization_id', organizationId)
      if (zoneId)         investigationsQ = investigationsQ.eq('associated_zone_id', zoneId)
      if (startDate)      investigationsQ = investigationsQ.gte('created_at', startDate)
      if (endDate)        investigationsQ = investigationsQ.lte('created_at', endDate)

      // Group 7a: active officers
      let activeOfficersQ = (supabase.from('user_profiles') as any)
        .select('id', { count: 'exact', head: true })
        .in('role', ['officer', 'admin_officer'])
        .eq('is_active', true)
        .gte('last_gps_update', new Date(Date.now() - 20 * 60 * 1000).toISOString())
      if (organizationId) activeOfficersQ = activeOfficersQ.eq('organization_id', organizationId)

      // Group 7b: checks today
      let checksTodayQ = (supabase.from('observations') as any)
        .select('observation_id', { count: 'exact', head: true })
        .gte('recorded_at', todayStart)
      if (organizationId) checksTodayQ = checksTodayQ.eq('organization_id', organizationId)
      if (zoneId)         checksTodayQ = checksTodayQ.eq('zone_id', zoneId)

      // Group 7c: infringements issued today
      let infringementsQ = (supabase.from('infringement_notices') as any)
        .select('id', { count: 'exact', head: true })
        .gte('issued_at', todayStart)
      if (organizationId) infringementsQ = infringementsQ.eq('organization_id', organizationId)

      // Group 7d: disputes pending
      let disputesQ = (supabase.from('infringement_notices') as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'disputed')
      if (organizationId) disputesQ = disputesQ.eq('organization_id', organizationId)

      // Group homeless
      let homelessRecordsQ = (supabase.from('homeless_records') as any)
        .select('plate_number, status')
        .eq('is_active', true)
        .in('status', HOMELESS_UI_STATUSES)
      if (organizationId) homelessRecordsQ = homelessRecordsQ.eq('organization_id', organizationId)

      const canonicalHomelessQ = supabase
        .from('canonical_homeless')
        .select('plate_number, status')
        .in('status', HOMELESS_UI_STATUSES)

      // Fire all independent queries in parallel
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
        totalObsQ, compliantQ, summaryQ, breachesQ, investigationsQ,
        activeOfficersQ, checksTodayQ, infringementsQ, disputesQ,
        homelessRecordsQ, canonicalHomelessQ,
      ])

      if (totalObsRes.error) diagnostics.push(`observations_total: ${totalObsRes.error.message || 'unknown error'}`)
      const totalObservations = totalObsRes.count

      if (compliantRes.error) diagnostics.push(`observations_compliant: ${compliantRes.error.message || 'unknown error'}`)
      const compliantCount = compliantRes.count

      // Active vehicles — unique plates via RPC; fallback to paged scan
      let activeVehicles = 0
      if (!summaryRes.error && summaryRes.data && summaryRes.data[0]) {
        activeVehicles = Number(summaryRes.data[0].unique_vehicles) || 0
      } else {
        diagnostics.push(
          `observation_summary_rpc_missing: ${summaryRes.error?.message || 'unknown rpc error'} (using bounded fallback)`
        )
        const uniquePlates = new Set<string>()
        let vehicleQuery = supabase
          .from('observations')
          .select('plate_number')
          .not('plate_number', 'is', null)
          .order('recorded_at', { ascending: false })
          .gte('recorded_at', trendStartBound)
          .lte('recorded_at', trendEndBound)
          .limit(fallbackRowCap)
        if (organizationId) vehicleQuery = vehicleQuery.eq('organization_id', organizationId)
        if (zoneId)         vehicleQuery = vehicleQuery.eq('zone_id', zoneId)
        const { data: vehicleRows, error: vehicleErr } = await vehicleQuery
        if (vehicleErr) {
          diagnostics.push(`active_vehicles_fallback: ${vehicleErr.message || 'unknown error'}`)
        }
        const rows = vehicleRows ?? []
        rows.forEach((r: any) => {
          if (r?.plate_number) uniquePlates.add(String(r.plate_number).trim().toUpperCase())
        })
        if (rows.length >= fallbackRowCap) {
          diagnostics.push(`active_vehicles_fallback: capped at ${fallbackRowCap} rows`)
        }
        activeVehicles = uniquePlates.size
      }

      // Trend data rows (for chart)
      const trendRows: Array<{ plate_number: string | null; is_compliant: boolean | null; recorded_at: string }> = []
      let trendQuery = supabase
        .from('observations')
        .select('plate_number, is_compliant, recorded_at')
        .order('recorded_at', { ascending: true })
        .gte('recorded_at', trendStartBound)
        .lte('recorded_at', trendEndBound)
        .limit(fallbackRowCap)
      if (organizationId) trendQuery = trendQuery.eq('organization_id', organizationId)
      if (zoneId)         trendQuery = trendQuery.eq('zone_id', zoneId)

      const { data: trendPageRows, error: trendErr } = await trendQuery
      if (trendErr) {
        diagnostics.push(`observations_trend: ${trendErr.message || 'unknown error'}`)
      } else {
        trendRows.push(...((trendPageRows ?? []) as Array<{ plate_number: string | null; is_compliant: boolean | null; recorded_at: string }>))
      }
      if (trendRows.length >= fallbackRowCap) {
        diagnostics.push(`observations_trend: capped at ${fallbackRowCap} rows for dashboard performance`)
      }

      // Homeless plates
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

      // Active breaches (distinct observation_id)
      let activeBreaches = 0
      if (breachesRes.error) {
        diagnostics.push(`breach_alerts_active: ${breachesRes.error.message || 'unknown error'}`)
      } else {
        activeBreaches = new Set((breachesRes.data ?? []).map((r: any) => r.observation_id)).size
      }

      if (investigationsRes.error) diagnostics.push(`investigation_jobs_active: ${investigationsRes.error.message || 'unknown error'}`)
      const activeInvestigations = investigationsRes.count

      if (activeOfficersRes.error) diagnostics.push(`active_officers: ${activeOfficersRes.error.message || 'unknown error'}`)
      const activeOfficers = activeOfficersRes.count

      if (checksTodayRes.error) diagnostics.push(`checks_today: ${checksTodayRes.error.message || 'unknown error'}`)
      const checksToday = checksTodayRes.count

      if (infringementsRes.error) diagnostics.push(`infringements_issued: ${infringementsRes.error.message || 'unknown error'}`)
      const infringementsIssued = infringementsRes.count

      if (disputesRes.error) diagnostics.push(`disputes_pending: ${disputesRes.error.message || 'unknown error'}`)
      const disputesPending = disputesRes.count

      // Open dispute_intake submissions
      let openDisputeIntakeQuery = supabase
        .from('dispute_intake')
        .select('id', { count: 'exact', head: true })
        .in('status', ['received', 'under_review', 'info_requested'])
      if (organizationId) openDisputeIntakeQuery = openDisputeIntakeQuery.eq('organization_id', organizationId)
      const { count: openDisputeIntake, error: disputeIntakeErr } = await openDisputeIntakeQuery
      if (disputeIntakeErr) diagnostics.push(`open_dispute_intake: ${disputeIntakeErr.message || 'unknown error'}`)

      // Vehicle discrepancies requiring review
      let discrepanciesPendingQuery = (supabase.from('vehicle_discrepancies') as any)
        .select('id', { count: 'exact', head: true })
        .eq('requires_review', true)
        .is('reviewed_at', null)
      if (organizationId) discrepanciesPendingQuery = discrepanciesPendingQuery.eq('organization_id', organizationId)
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

      // Active trespass notices
      let activeTrespassQ = (supabase as any)
        .from('trespass_notices')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
      if (organizationId) activeTrespassQ = activeTrespassQ.eq('organization_id', organizationId)
      const { count: activeTrespassCount, error: trespassErr } = await activeTrespassQ
      if (trespassErr) diagnostics.push(`active_trespass_notices: ${trespassErr.message || 'unknown error'}`)

      // Radio transmissions today
      let radioTodayQ = (supabase as any)
        .from('radio_transmissions')
        .select('id', { count: 'exact', head: true })
        .gte('started_at', todayStart)
      if (organizationId) radioTodayQ = radioTodayQ.eq('org_id', organizationId)
      const { count: radioTransmissionsToday, error: radioErr } = await radioTodayQ
      if (radioErr) diagnostics.push(`radio_transmissions_today: ${radioErr.message || 'unknown error'}`)

      // Homeless-exempt breach count
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
        activeTrespassCount:       activeTrespassCount        ?? 0,
        radioTransmissionsToday:   radioTransmissionsToday    ?? 0,
        diagnostics,
      }
    },
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    staleTime: 15000,
  })
}
