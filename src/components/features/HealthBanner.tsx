/**
 * HealthBanner — compact admin-only inline strip for service health.
 * Shown only when overall status is degraded or down.
 * Self-contained; polls every 60 s.
 */

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, XCircle, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { checkRailwayServicesHealth } from '@/lib/inferenceService'
import { supabase } from '@/lib/supabase'

type HealthStatus = 'operational' | 'degraded' | 'down'

export function HealthBanner() {
  const navigate = useNavigate()

  const { data: railwayHealth, isLoading: railwayLoading, refetch } = useQuery({
    queryKey: ['health-banner-railway'],
    queryFn: checkRailwayServicesHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const { data: dbPing, isLoading: dbLoading } = useQuery({
    queryKey: ['health-banner-db'],
    queryFn: async () => {
      const { error } = await supabase.from('zones').select('id').limit(1)
      return { ok: !error }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  if (railwayLoading || dbLoading) return null

  const railwayOk = railwayHealth?.proxy && railwayHealth?.inference
  const dbOk = dbPing?.ok !== false

  const overallStatus: HealthStatus =
    !dbOk ? 'down'
    : !railwayOk ? 'degraded'
    : 'operational'

  // Only surface non-green states
  if (overallStatus === 'operational') return null

  const isDegraded = overallStatus === 'degraded'

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 text-xs mb-4 rounded-lg border ${
        isDegraded
          ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
          : 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300'
      }`}
    >
      {isDegraded ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <XCircle className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="font-medium">
        {isDegraded ? 'Some services are degraded' : 'Service disruption detected'}
      </span>
      {!railwayOk && (
        <span className="text-xs opacity-75 ml-1">
          (Proxy/Inference
          {!railwayHealth?.proxy ? ' — proxy down' : ''}
          {!railwayHealth?.inference ? ' — inference down' : ''})
        </span>
      )}
      {!dbOk && <span className="text-xs opacity-75 ml-1">(Database unreachable)</span>}
      <button
        onClick={() => navigate('/diagnostics')}
        className="ml-auto underline underline-offset-2 hover:opacity-80 transition-opacity"
      >
        View diagnostics
      </button>
      <button
        onClick={() => refetch()}
        className="p-0.5 hover:opacity-80 transition-opacity"
        title="Refresh"
      >
        <RefreshCw className="h-3 w-3" />
      </button>
    </div>
  )
}
