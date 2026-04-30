/**
 * OfficerShell
 *
 * Mobile-first layout shell for the Officer experience.
 * Replaces the admin-oriented AppLayout for all officer routes.
 *
 * Design constraints per UX/UI Architecture Blueprint (Weeks 3-4):
 *   - No sidebar — content fills the full viewport
 *   - Sticky top header with title, shift status, and offline queue badge
 *   - Night/high-contrast mode support via `officer-night` class on root
 *   - Reduced-motion safe
 *   - Large tap targets (min 44×44px for interactive elements)
 *   - Reconnect banner when navigator goes offline then comes back online
 */

import { useEffect, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { checkServicesHealth } from '@/lib/inferenceService'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import { Shield, WifiOff, Wifi, ChevronLeft, AlertTriangle, ServerCrash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useOfflineQueueStats, useOnlineStatus } from '@/hooks/useOfflineQueue'
import { useThemePreferencesStore } from '@/stores/themePreferencesStore'
import { cn } from '@/lib/utils'

interface OfficerShellProps {
  children: React.ReactNode
  title?: string
  description?: string
  showBackButton?: boolean
}

/**
 * Reconnect banner — shown for 5 seconds when the device comes back online,
 * and persistently while offline.
 */
function ReconnectBanner({ isOnline }: { isOnline: boolean }) {
  const [showReconnected, setShowReconnected] = useState(false)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true)
      setShowReconnected(false)
    } else if (wasOffline && isOnline) {
      setShowReconnected(true)
      setWasOffline(false)
      const t = setTimeout(() => setShowReconnected(false), 5000)
      return () => clearTimeout(t)
    }
  }, [isOnline, wasOffline])

  if (isOnline && !showReconnected) return null

  if (!isOnline) {
    return (
      <div
        role="status"
        aria-live="assertive"
        className="flex items-center gap-2 bg-amber-500 dark:bg-amber-700 px-4 py-2 text-sm font-semibold text-white"
      >
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>No connection — observations are queued locally and will sync when back online.</span>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 bg-emerald-600 dark:bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
    >
      <Wifi className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Back online — syncing queued observations…</span>
    </div>
  )
}

/**
 * Offline queue badge — shows count of pending/failed items requiring attention.
 */
/**
 * ServiceStatusDot — lightweight indicator for backend service health (inference + DB).
 * Visible only when status is degraded or down. No-op when everything is operational.
 */
function ServiceStatusDot() {
  const { data: serviceHealth } = useQuery({
    queryKey: ['officer-shell-services-health'],
    queryFn: checkServicesHealth,
    refetchInterval: 90_000,
    staleTime: 60_000,
  })
  const { data: dbPing } = useQuery({
    queryKey: ['officer-shell-db-ping'],
    queryFn: async () => {
      const { error } = await supabase.from('zones').select('id').limit(1)
      return { ok: !error }
    },
    refetchInterval: 90_000,
    staleTime: 60_000,
  })

  const inferenceOk = serviceHealth ? serviceHealth.inference : true
  const dbOk = dbPing ? dbPing.ok !== false : true

  if (inferenceOk && dbOk) return null

  const isDown = !dbOk
  const label = isDown ? 'Database unreachable' : 'Inference service degraded — tap for diagnostics'

  return (
    <div
      aria-label={label}
      title={label}
      className={`flex items-center justify-center h-7 w-7 rounded-full shrink-0 ${
        isDown ? 'bg-red-100 dark:bg-red-900/30 text-red-600' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'
      }`}
    >
      <ServerCrash className="h-4 w-4" aria-hidden="true" />
    </div>
  )
}

function OfflineQueueBadge() {
  const { data: stats } = useOfflineQueueStats()
  if (!stats) return null
  const attention = stats.pending + stats.failed
  if (attention === 0) return null

  return (
    <Badge
      variant="destructive"
      className="min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums"
      aria-label={`${attention} observation${attention !== 1 ? 's' : ''} pending sync`}
    >
      {attention > 99 ? '99+' : attention}
    </Badge>
  )
}

export function OfficerShell({ children, title, description, showBackButton }: OfficerShellProps) {
  const navigate = useNavigate()
  const { data: isOnline } = useOnlineStatus()
  const { data: queueStats } = useOfflineQueueStats()

  // Support theme preferences store if available (graceful fallback if not)
  let nightMode = false
  try {
    nightMode = (useThemePreferencesStore as any)((s: any) => s.nightModeEnabled ?? false)
  } catch {
    // store not available
  }

  const handleBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const pendingSync = queueStats ? queueStats.pending + queueStats.failed : 0

  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col bg-background text-foreground antialiased',
        nightMode && 'officer-night',
      )}
    >
      {/* ── Sticky header ───────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {showBackButton && (
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={handleBack}
            aria-label="Go back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            {title && (
              <h1 className="truncate text-base font-semibold leading-tight">
                {title}
              </h1>
            )}
            <OfflineQueueBadge />
          </div>
          {description && (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          )}
        </div>

        {/* Offline indicator in header */}
          {/* Service health dot — only visible when inference/db is degraded */}
          <ServiceStatusDot />

          {/* Offline indicator in header */}
        {isOnline === false && (
          <WifiOff
            className="h-5 w-5 shrink-0 text-amber-500"
            aria-label="Offline"
          />
        )}
        {pendingSync > 0 && isOnline === true && (
          <AlertTriangle
            className="h-5 w-5 shrink-0 text-amber-500"
            aria-label={`${pendingSync} observations pending sync`}
          />
        )}
      </header>

      {/* ── Reconnect / offline banner ───────────────────────────────── */}
      <ReconnectBanner isOnline={isOnline ?? true} />

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-4">
          {children}
        </div>
      </main>
    </div>
  )
}
