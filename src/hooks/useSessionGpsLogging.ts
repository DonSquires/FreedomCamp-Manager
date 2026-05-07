import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalLocationTracking } from '@/hooks/useGlobalLocationTracking'

const GPS_LOG_INTERVAL_MS = 60_000
const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000

function shouldTrackRole(role: string | undefined) {
  if (role === 'officer') return true
  if (role === 'admin_officer' && typeof window !== 'undefined') {
    return window.sessionStorage.getItem('adminOfficerPortalChoice') === 'selected'
  }
  return false
}

export function useSessionGpsLogging(): void {
  const { user, isAuthenticated, loading } = useAuthStore()
  const shouldTrack = !loading && isAuthenticated && !!user?.id && shouldTrackRole(user?.role)
  const lastLoggedAtRef = useRef(0)
  const latestCoordsRef = useRef<{
    latitude: number
    longitude: number
    accuracy: number | null
  } | null>(null)

  const { coords, timestamp } = useGlobalLocationTracking({
    autoStart: shouldTrack,
    highAccuracy: true,
    positionCacheMs: 30_000,
  })

  useEffect(() => {
    latestCoordsRef.current = coords
  }, [coords])

  useEffect(() => {
    if (!shouldTrack || !user?.id) return

    const logHeartbeat = () => {
      const heartbeatCoords = latestCoordsRef.current
      void (async () => {
        const { error } = await (supabase as any).rpc('log_officer_activity', {
          p_user_id: user.id,
          p_activity_type: 'app_heartbeat',
          p_gps_latitude: heartbeatCoords?.latitude ?? null,
          p_gps_longitude: heartbeatCoords?.longitude ?? null,
          p_gps_accuracy: heartbeatCoords?.accuracy ?? null,
          p_metadata: {
            visibility_state: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
          },
        })

        if (error) {
          console.warn('Officer presence heartbeat failed:', error)
        }
      })()
    }

    logHeartbeat()
    const interval = window.setInterval(logHeartbeat, PRESENCE_HEARTBEAT_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [shouldTrack, user?.id])

  useEffect(() => {
    if (!shouldTrack || !user?.id || !coords || !timestamp) return

    const now = Date.now()
    if (now - lastLoggedAtRef.current < GPS_LOG_INTERVAL_MS) return
    lastLoggedAtRef.current = now

    void (async () => {
      const { error } = await (supabase as any).rpc('log_officer_gps_update', {
        p_user_id: user.id,
        p_latitude: coords.latitude,
        p_longitude: coords.longitude,
        p_accuracy: coords.accuracy ?? 0,
        p_activity_type: 'gps_update',
      })

      if (error) {
        console.warn('Session GPS logging failed:', error)
      }
    })()
  }, [shouldTrack, user?.id, coords, timestamp])
}
