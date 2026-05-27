/**
 * DispatchMonitor — WILSAR-style live Despatch Monitor dashboard
 *
 * Shows live stat tiles (Active, Closed/Cancelled, Duress, Auto-Dispatched,
 * Not Dispatched, Not Acknowledged, Over Response Time, Ready to Close) with
 * colour-coded urgency.  Right panel has filter buttons by zone/region,
 * job type, and alarm type.  Auto-refreshes every 30 seconds.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { runDispatchJobsQueryWithAlarmTypeFallback } from '@/lib/dispatchJobs'
import { summarizeDispatchParity } from '@/lib/rapidFieldParity'
import { useFeatureFlag } from '@/hooks/useOperationalCases'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RefreshCw, Radio, AlertTriangle, Clock, CheckCircle, Zap, XCircle, Mic, Database } from 'lucide-react'
import { toast } from 'sonner'
import { AsyncStateWrapper } from '@/components/features/AsyncStateWrapper'

// ── Constants ─────────────────────────────────────────────────────────────────

const JOB_TYPE_FILTERS = [
  'Alarm Response', 'Permanent Patrol', 'Casual Patrol', 'Escort',
  'Key Collection', 'Key Return', 'Let In', 'Let Out', 'Lockup', 'Open',
  'Alarm Reset', 'First Line One Guard', 'First Line Two Guard',
  'Second Line Response', 'Cash In Transit',
]

const ALARM_TYPE_FILTERS = [
  'Alarm Reset', 'Animal Control', 'Cardreader Fault', 'Duress',
  'Hold Up / Duress', 'Intruder Alarm', 'Late To Close', 'Lock Broken',
  'Noise Complaint', 'Parking', 'Traffic', 'Vandalism',
]

const RESPONSE_SLA_THRESHOLD_MIN = 60
const MONITORED_RAPID_CALLSIGNS = ['587', '586', '585', '584'] as const

const DISPATCH_MONITOR_SELECT = 'id, status, alarm_type, title, address, gps_lat, gps_lng, assigned_to, client_site_id, zone_id, dispatched_at, acknowledged_at, en_route_at, on_scene_at, completed_at, cancelled_at, created_at, response_sla_minutes, priority'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonitorStats {
  active: number
  closed_cancelled: number
  duress: number
  auto_dispatched: number
  not_dispatched: number
  not_acknowledged: number
  over_response_time: number
  ready_to_close: number
}

interface StatTile {
  label: string
  value: number
  red?: boolean
  icon: React.FC<{ className?: string }>
}

interface DispatchParitySnapshot {
  coveragePercent: number
  mappedRequired: number
  totalRequired: number
  readyJobs: number
  totalJobs: number
  missingByKey: Array<{
    key: string
    label: string
    count: number
  }>
  assistiveEnrichmentCount: number
  speechErrorCount: number
  monitoredCallsigns: Array<{
    callsign: string
    enrichmentCount: number
    uniqueTargets: number
    uniqueClientSites: number
  }>
  monitoredCoverageCount: number
  monitoredTargetCoverage: number
  monitoredClientSiteCoverage: number
}

function extractRapidReference(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null

  const patrolMatch = normalized.match(/\bpatrol\s*([a-z0-9-]{2,12})\b/i)
  if (patrolMatch?.[1]) return patrolMatch[1].toUpperCase()

  const callsignMatch = normalized.match(/\bcallsign\s*([a-z0-9-]{1,12})\b/i)
  if (callsignMatch?.[1]) return callsignMatch[1].toUpperCase()

  const numericMatch = normalized.match(/\b([0-9]{2,4}[a-z]?)\b/i)
  if (numericMatch?.[1]) return numericMatch[1].toUpperCase()

  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DispatchMonitor() {
  const { user } = useAuthStore()
  const { organizationId: filterOrgId } = useGlobalFiltersStore()
  const orgId = filterOrgId || user?.organization_id
  const { data: phaseBEnabled } = useFeatureFlag('FF_PHASE_B_PATROL_EVENTS')

  const [tick, setTick] = useState(0)
  const [activeJobFilter, setActiveJobFilter] = useState<string | null>(null)
  const [activeAlarmFilter, setActiveAlarmFilter] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  // Auto-refresh every 30 s
  useEffect(() => {
    const t = setInterval(() => {
      setTick(n => n + 1)
      setLastRefresh(new Date())
    }, 30_000)
    return () => clearInterval(t)
  }, [])

  const { data: stats, isLoading, refetch } = useQuery<MonitorStats>({
    queryKey: ['dispatch-monitor-stats', orgId, activeJobFilter, activeAlarmFilter, tick, phaseBEnabled],
    queryFn: async () => {
      const now = new Date()

      // ── Phase B path: operational_cases + dispatch_events ──────────────────
      if (phaseBEnabled) {
        let casesQuery = supabase
          .from('operational_cases')
          .select('id, status, priority, created_at, dispatch_events(*)')
          .gte('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()) as any

        if (orgId) {
          casesQuery = casesQuery.eq('organization_id', orgId)
        }

        const { data: cases, error } = await casesQuery

        if (error) throw error

        const all = (cases ?? []) as any[]
        const active = all.filter((c: any) => !['closed', 'cancelled'].includes(c.status))
        const closedCancelled = all.filter((c: any) => ['closed', 'cancelled'].includes(c.status))
        const duress = all.filter((c: any) => c.priority === 'critical' && !['closed', 'cancelled'].includes(c.status))
        const autoDispatched = all.filter((c: any) => c.status === 'dispatched')
        const notDispatched = all.filter((c: any) => c.status === 'open')
        const notAcknowledged = all.filter((c: any) => c.status === 'dispatched' && !(c.dispatch_events ?? []).some((e: any) => e.event_type === 'acknowledged'))
        const overResponseTime = active.filter((c: any) => {
          if (!c.created_at) return false
          const ageMin = (now.getTime() - new Date(c.created_at).getTime()) / 60_000
          return ageMin > RESPONSE_SLA_THRESHOLD_MIN
        })
        const readyToClose = all.filter((c: any) => {
          if (c.status !== 'on_scene') return false
          const onSceneEvent = (c.dispatch_events ?? []).find((e: any) => e.event_type === 'on_scene')
          if (!onSceneEvent?.created_at) return false
          const ageMin = (now.getTime() - new Date(onSceneEvent.created_at).getTime()) / 60_000
          return ageMin >= 5
        })
        return {
          active: active.length,
          closed_cancelled: closedCancelled.length,
          duress: duress.length,
          auto_dispatched: autoDispatched.length,
          not_dispatched: notDispatched.length,
          not_acknowledged: notAcknowledged.length,
          over_response_time: overResponseTime.length,
          ready_to_close: readyToClose.length,
        }
      }

      // ── Legacy path: dispatch_jobs ─────────────────────────────────────────

      // Fetch all jobs for today onwards
      const { data: jobs, error } = await runDispatchJobsQueryWithAlarmTypeFallback<any[]>((includeAlarmType) => {
        let jobsQuery = (supabase as any)
          .from('dispatch_jobs')
          .select(includeAlarmType ? DISPATCH_MONITOR_SELECT : DISPATCH_MONITOR_SELECT.replace('alarm_type, ', ''))
          .gte('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString())

        if (orgId) {
          jobsQuery = jobsQuery.eq('organization_id', orgId)
        }

        return jobsQuery
      })

      if (error) throw error

      const all = (jobs ?? []) as any[]
      const active = all.filter((j: any) => !['completed', 'cancelled'].includes(j.status))
      const closedCancelled = all.filter((j: any) => ['completed', 'cancelled'].includes(j.status))
      const duress = all.filter((j: any) => j.alarm_type === 'duress_hold_up' && !['completed', 'cancelled'].includes(j.status))
      const autoDispatched = all.filter((j: any) => j.status === 'dispatched' && j.dispatched_at)
      const notDispatched = all.filter((j: any) => j.status === 'pending')
      const notAcknowledged = all.filter((j: any) => j.status === 'dispatched')
      const overResponseTime = active.filter((j: any) => {
        if (!j.created_at) return false
        const ageMin = (now.getTime() - new Date(j.created_at).getTime()) / 60_000
        return ageMin > (j.response_sla_minutes ?? RESPONSE_SLA_THRESHOLD_MIN)
      })
      // "Ready to close" = on_scene for > 5 minutes with no close action
      const readyToClose = all.filter((j: any) => {
        if (j.status !== 'on_scene' || !j.on_scene_at) return false
        const ageMin = (now.getTime() - new Date(j.on_scene_at).getTime()) / 60_000
        return ageMin >= 5
      })

      return {
        active: active.length,
        closed_cancelled: closedCancelled.length,
        duress: duress.length,
        auto_dispatched: autoDispatched.length,
        not_dispatched: notDispatched.length,
        not_acknowledged: notAcknowledged.length,
        over_response_time: overResponseTime.length,
        ready_to_close: readyToClose.length,
      }
    },
    enabled: !!orgId,
  })

  const { data: recentJobs = [] } = useQuery<Array<{ id: string; title: string | null; status: string; created_at: string }>>({
    queryKey: ['dispatch-monitor-recent', orgId, tick],
    queryFn: async () => {
      let recentQuery = (supabase as any)
        .from('dispatch_jobs')
        .select('id, title, status, created_at')
        .order('created_at', { ascending: false })
        .limit(25)

      if (orgId) {
        recentQuery = recentQuery.eq('organization_id', orgId)
      }

      const { data, error } = await recentQuery

      if (error) throw error
      return (data ?? []) as Array<{ id: string; title: string | null; status: string; created_at: string }>
    },
  })

  const { data: myRecentJobs = [] } = useQuery<Array<{ id: string; title: string | null; created_at: string }>>({
    queryKey: ['dispatch-monitor-recent-created-by-me', user?.id, tick],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await (supabase as any)
        .from('dispatch_jobs')
        .select('id, title, created_at')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
        .limit(25)

      if (error) throw error
      return (data ?? []) as Array<{ id: string; title: string | null; created_at: string }>
    },
    enabled: !!user?.id,
  })

  const localRecentTitles = useMemo(() => {
    if (typeof window === 'undefined') return [] as string[]
    try {
      const raw = window.sessionStorage.getItem('fc_recent_dispatch_titles')
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    } catch {
      return []
    }
  }, [])

  const mergedRecentJobTitles = useMemo(() => {
    const fromQuery = recentJobs.map((job) => job.title).filter((item): item is string => Boolean(item && item.trim()))
    const fromCreatedByMe = myRecentJobs.map((job) => job.title).filter((item): item is string => Boolean(item && item.trim()))
    return [...new Set([...localRecentTitles, ...fromCreatedByMe, ...fromQuery])].slice(0, 12)
  }, [localRecentTitles, myRecentJobs, recentJobs])

  const { data: paritySnapshot, isLoading: parityLoading } = useQuery<DispatchParitySnapshot>({
    queryKey: ['dispatch-monitor-parity', orgId, tick],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: jobs, error } = await runDispatchJobsQueryWithAlarmTypeFallback<any[]>((includeAlarmType) => {
        let jobsQuery = (supabase as any)
          .from('dispatch_jobs')
          .select(includeAlarmType ? DISPATCH_MONITOR_SELECT : DISPATCH_MONITOR_SELECT.replace('alarm_type, ', ''))
          .in('status', ['pending', 'dispatched', 'acknowledged', 'en_route', 'on_scene', 'completed'])
          .gte('created_at', since)

        if (orgId) {
          jobsQuery = jobsQuery.eq('organization_id', orgId)
        }

        return jobsQuery
      })

      if (error) throw error

      const parity = summarizeDispatchParity((jobs ?? []) as any[])

      const assistiveEnrichmentQuery = (supabase
        .from('audit_log')
        .select('id', { count: 'exact', head: true }) as any)
        .eq('action', 'speech_activity_enriched')
        .eq('organization_id', orgId ?? '')
        .gte('created_at', since)

      const speechErrorsQuery = (supabase as any)
        .from('speech_audit_events')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId ?? '')
        .not('error_message', 'is', null)
        .gte('created_at', since)

      const monitoredEnrichmentRowsQuery = (supabase as any)
        .from('audit_log')
        .select('new_values')
        .eq('action', 'speech_activity_enriched')
        .eq('organization_id', orgId ?? '')
        .gte('created_at', since)

      const [{ count: assistiveEnrichmentCount }, speechErrorsResult, monitoredEnrichmentRowsResult] = await Promise.all([
        assistiveEnrichmentQuery,
        speechErrorsQuery.catch(() => ({ count: 0 })),
        monitoredEnrichmentRowsQuery.catch(() => ({ data: [] })),
      ])

      const monitoredMap = new Map(
        MONITORED_RAPID_CALLSIGNS.map((callsign) => [
          callsign,
          {
            callsign,
            enrichmentCount: 0,
            targetKeys: new Set<string>(),
            clientSiteKeys: new Set<string>(),
          },
        ]),
      )

      const monitoredRows = Array.isArray(monitoredEnrichmentRowsResult?.data)
        ? monitoredEnrichmentRowsResult.data
        : []
      for (const row of monitoredRows as any[]) {
        const values = row?.new_values && typeof row.new_values === 'object'
          ? row.new_values
          : null
        if (!values) continue

        const directReference = typeof values.rapid_reference === 'string'
          ? values.rapid_reference
          : null
        const fallbackLabelReference = extractRapidReference(values.target_label)
        const normalizedReference = (directReference ?? fallbackLabelReference ?? '').toUpperCase()

        const bucket = monitoredMap.get(normalizedReference)
        if (!bucket) continue

        bucket.enrichmentCount += 1

        const targetKind = typeof values.target_kind === 'string' ? values.target_kind : null
        const targetId = typeof values.target_id === 'string' ? values.target_id : null
        if (targetKind && targetId) {
          bucket.targetKeys.add(`${targetKind}:${targetId}`)
        } else {
          const dispatchJobId = typeof values.dispatch_job_id === 'string' ? values.dispatch_job_id : null
          const patrolRouteInstanceId = typeof values.patrol_route_instance_id === 'string' ? values.patrol_route_instance_id : null
          const fallbackTarget = dispatchJobId ? `dispatch:${dispatchJobId}` : patrolRouteInstanceId ? `patrol:${patrolRouteInstanceId}` : null
          if (fallbackTarget) bucket.targetKeys.add(fallbackTarget)
        }

        const clientSiteId = typeof values.client_site_id === 'string' ? values.client_site_id : null
        if (clientSiteId) {
          bucket.clientSiteKeys.add(clientSiteId)
        }
      }

      const monitoredCallsigns = [...monitoredMap.values()].map((entry) => ({
        callsign: entry.callsign,
        enrichmentCount: entry.enrichmentCount,
        uniqueTargets: entry.targetKeys.size,
        uniqueClientSites: entry.clientSiteKeys.size,
      }))

      const monitoredCoverageCount = monitoredCallsigns.filter((entry) => entry.enrichmentCount > 0).length
      const monitoredTargetCoverage = monitoredCallsigns.reduce((sum, entry) => sum + entry.uniqueTargets, 0)
      const monitoredClientSiteCoverage = monitoredCallsigns.reduce((sum, entry) => sum + entry.uniqueClientSites, 0)

      return {
        ...parity,
        assistiveEnrichmentCount: assistiveEnrichmentCount ?? 0,
        speechErrorCount: speechErrorsResult.count ?? 0,
        monitoredCallsigns,
        monitoredCoverageCount,
        monitoredTargetCoverage,
        monitoredClientSiteCoverage,
      }
    },
    enabled: !!orgId,
  })

  function handleManualRefresh() {
    refetch()
    setLastRefresh(new Date())
    toast.success('Monitor refreshed')
  }

  const tiles: StatTile[] = stats ? [
    { label: 'Active',              value: stats.active,              icon: Radio },
    { label: 'Closed / Cancelled',  value: stats.closed_cancelled,     icon: CheckCircle },
    { label: 'Duress',              value: stats.duress,               icon: AlertTriangle, red: stats.duress > 0 },
    { label: 'Auto-Dispatched',     value: stats.auto_dispatched,      icon: Zap },
    { label: 'Not Dispatched',      value: stats.not_dispatched,       icon: XCircle,       red: stats.not_dispatched > 0 },
    { label: 'Not Acknowledged',    value: stats.not_acknowledged,     icon: Clock },
    { label: 'Over Response Time',  value: stats.over_response_time,   icon: AlertTriangle, red: stats.over_response_time > 0 },
    { label: 'Ready to Close',      value: stats.ready_to_close,       icon: CheckCircle,   red: stats.ready_to_close > 0 },
  ] : []

  return (
    <AppLayout title="Dispatch Monitor" description="Live despatch status dashboard — auto-refreshes every 30 seconds">
      <GlobalFilterRibbon />
      <div className="space-y-4">

        {/* ── Alert summary strip — visible above fold ── */}
        {!isLoading && stats && (stats.duress > 0 || stats.not_acknowledged > 0 || stats.over_response_time > 0) && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 flex-wrap">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {stats.duress > 0 && <span>{stats.duress} Duress</span>}
            {stats.not_acknowledged > 0 && <span>{stats.not_acknowledged} Not Acknowledged</span>}
            {stats.over_response_time > 0 && <span>{stats.over_response_time} Over SLA</span>}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
            Last refreshed: {lastRefresh.toLocaleTimeString('en-NZ')}
          </div>
          <Button size="sm" variant="outline" onClick={handleManualRefresh} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          <Card className="border-blue-200 dark:border-blue-900">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Database className="h-4 w-4 text-blue-600" />
                Rapid parity readiness
              </div>
              <AsyncStateWrapper isLoading={parityLoading} loadingText="Measuring parity coverage…">
                <div className="space-y-1">
                  <p className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                    {paritySnapshot?.coveragePercent ?? 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {paritySnapshot?.mappedRequired ?? 0}/{paritySnapshot?.totalRequired ?? 0} required canonical fields mapped across recent dispatch jobs
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {paritySnapshot?.readyJobs ?? 0}/{paritySnapshot?.totalJobs ?? 0} jobs currently parity-ready
                  </p>
                </div>
              </AsyncStateWrapper>
            </CardContent>
          </Card>

          <Card className="border-emerald-200 dark:border-emerald-900">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Mic className="h-4 w-4 text-emerald-600" />
                Assistive enrichment
              </div>
              <AsyncStateWrapper isLoading={parityLoading} loadingText="Loading enrichment health…">
                <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-300">
                  {paritySnapshot?.assistiveEnrichmentCount ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">
                  Officer speech enrichments attached in the last 24 hours
                </p>
                <p className="text-xs text-muted-foreground">
                  Speech audit errors in window: {paritySnapshot?.speechErrorCount ?? 0}
                </p>
              </AsyncStateWrapper>
            </CardContent>
          </Card>

          <Card className="border-amber-200 dark:border-amber-900">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Nelson callsign baseline
              </div>
              <AsyncStateWrapper isLoading={parityLoading} loadingText="Loading gap hotspots…">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Monitored callsigns active: {paritySnapshot?.monitoredCoverageCount ?? 0}/{MONITORED_RAPID_CALLSIGNS.length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Target coverage: {paritySnapshot?.monitoredTargetCoverage ?? 0} routes/jobs · Client/site coverage: {paritySnapshot?.monitoredClientSiteCoverage ?? 0}
                  </p>
                  {(paritySnapshot?.monitoredCallsigns.length ?? 0) > 0 ? (
                    paritySnapshot?.monitoredCallsigns.map((entry) => (
                      <div key={entry.callsign} className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs">
                        <span className="font-medium text-amber-900 dark:text-amber-100">
                          {entry.callsign} · {entry.uniqueTargets} targets · {entry.uniqueClientSites} sites
                        </span>
                        <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
                          {entry.enrichmentCount}
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">No monitored callsign activity detected in the last 24 hours.</p>
                  )}
                  {(paritySnapshot?.missingByKey.length ?? 0) > 0 && (
                    <>
                      <p className="pt-1 text-xs font-semibold text-amber-800 dark:text-amber-200">Top parity gaps</p>
                      {paritySnapshot?.missingByKey.slice(0, 2).map((gap) => (
                        <div key={gap.key} className="flex items-center justify-between gap-3 rounded-lg bg-white/80 dark:bg-slate-900/40 px-3 py-2 text-xs">
                          <span className="font-medium text-foreground">{gap.label}</span>
                          <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
                            {gap.count}
                          </Badge>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </AsyncStateWrapper>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* ── Stat tiles (left 3/4) ──────────────────────────────────────── */}
          <div className="lg:col-span-3">
            <AsyncStateWrapper
              isLoading={isLoading}
              loadingText="Loading dispatch stats…"
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {tiles.map(tile => {
                  const Icon = tile.icon
                  return (
                    <div
                      key={tile.label}
                      className={`rounded-xl p-5 text-white flex flex-col items-center justify-center gap-1 shadow-md select-none ${
                        tile.red ? 'bg-red-600' : 'bg-blue-700'
                      }`}
                    >
                      <p className="text-4xl font-extrabold leading-none">{tile.value}</p>
                      <p className="text-sm font-medium text-center leading-tight opacity-90">{tile.label}</p>
                    </div>
                  )
                })}
              </div>
            </AsyncStateWrapper>
          </div>

          {/* ── Filter panel (right 1/4) ───────────────────────────────────── */}
          <div className="space-y-4">

            <div>
              <p className="text-sm font-semibold mb-2">Recent Jobs:</p>
              <div className="space-y-1.5">
                {mergedRecentJobTitles.map((title) => (
                  <div key={title} className="rounded-md border bg-background px-2.5 py-1.5 text-xs">
                    {title}
                  </div>
                ))}
                {mergedRecentJobTitles.length === 0 && (
                  <p className="text-xs text-muted-foreground">No dispatch jobs found for this organization yet.</p>
                )}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold mb-2">Filter by Job Type:</p>
              <div className="flex flex-wrap gap-1.5">
                {JOB_TYPE_FILTERS.map(t => (
                  <button
                    key={t}
                    onClick={() => setActiveJobFilter(activeJobFilter === t ? null : t)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      activeJobFilter === t
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-white dark:bg-[#1E1E1E] text-blue-700 border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold mb-2">Filter by Alarm Type:</p>
              <div className="flex flex-wrap gap-1.5">
                {ALARM_TYPE_FILTERS.map(t => (
                  <button
                    key={t}
                    onClick={() => setActiveAlarmFilter(activeAlarmFilter === t ? null : t)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      activeAlarmFilter === t
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-white dark:bg-[#1E1E1E] text-blue-700 border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {(activeJobFilter || activeAlarmFilter) && (
              <div className="flex gap-2 flex-wrap">
                {activeJobFilter && (
                  <Badge variant="secondary" className="gap-1 pr-1">
                    {activeJobFilter}
                    <button className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => setActiveJobFilter(null)}>×</button>
                  </Badge>
                )}
                {activeAlarmFilter && (
                  <Badge variant="secondary" className="gap-1 pr-1">
                    {activeAlarmFilter}
                    <button className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => setActiveAlarmFilter(null)}>×</button>
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
