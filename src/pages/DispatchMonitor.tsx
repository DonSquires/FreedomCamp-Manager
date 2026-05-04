/**
 * DispatchMonitor — WILSAR-style live Despatch Monitor dashboard
 *
 * Shows live stat tiles (Active, Closed/Cancelled, Duress, Auto-Dispatched,
 * Not Dispatched, Not Acknowledged, Over Response Time, Ready to Close) with
 * colour-coded urgency.  Right panel has filter buttons by zone/region,
 * job type, and alarm type.  Auto-refreshes every 30 seconds.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RefreshCw, Radio, AlertTriangle, Clock, CheckCircle, Zap, XCircle } from 'lucide-react'
import { toast } from 'sonner'

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

const DISPATCH_MONITOR_SELECT = 'id, status, dispatched_at, acknowledged_at, on_scene_at, completed_at, cancelled_at, created_at, response_sla_minutes, priority'

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function DispatchMonitor() {
  const { user } = useAuthStore()
  const { organizationId: filterOrgId } = useGlobalFiltersStore()
  const orgId = filterOrgId || user?.organization_id

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
    queryKey: ['dispatch-monitor-stats', orgId, tick],
    queryFn: async () => {
      const now = new Date()
      const nowIso = now.toISOString()

      // Fetch all jobs for today onwards
      const { data: jobs, error } = await (supabase as any)
        .from('dispatch_jobs')
        .select(DISPATCH_MONITOR_SELECT)
        .eq('organization_id', orgId ?? '')
        .gte('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString())

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
        {!isLoading && (stats.duress > 0 || stats.not_acknowledged > 0 || stats.over_response_time > 0) && (
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

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* ── Stat tiles (left 3/4) ──────────────────────────────────────── */}
          <div className="lg:col-span-3">
            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            ) : (
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
            )}
          </div>

          {/* ── Filter panel (right 1/4) ───────────────────────────────────── */}
          <div className="space-y-4">

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
                        : 'bg-white dark:bg-gray-800 text-blue-700 border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30'
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
                        : 'bg-white dark:bg-gray-800 text-blue-700 border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30'
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
